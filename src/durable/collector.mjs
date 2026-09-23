import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statfsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Archive } from './archive.mjs';
import { parseFeed, parseHtmlSummary, PARSER_VERSION } from '../contract.mjs';
import { INTERVAL_MS, MAX_GAP_MS, DAY_MS, dayOf, maintainRollups } from './rollups.mjs';
import { captureFacts, classifyCandidate, PROJECTION_VERSION } from './projection.mjs';

const time = value => { const ms = Date.parse(value); if (!Number.isFinite(ms)) throw new Error('Invalid capture time'); return ms; };
export class LocalCollector {
  constructor(root, { beforeCommit, archive } = {}) {
    this.root = resolve(root); mkdirSync(this.root, { recursive: true });
    this.archive = archive ?? new Archive(join(this.root, 'archive'));
    this.db = new DatabaseSync(join(this.root, 'index.sqlite'), { timeout: 5000 });
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (![0, 2].includes(version)) {
      this.db.close();
      throw Error(`Unsupported collector schema ${version}; rebuild a separate version-2 index from the archive before switching releases`);
    }
    if (version === 2 && this.db.prepare("SELECT value FROM collector_state WHERE key='projection_version'").get()?.value !== PROJECTION_VERSION) {
      this.db.close();
      throw Error('Unsupported projection policy; rebuild a separate index before switching releases');
    }
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    this.db.prepare("INSERT OR REPLACE INTO collector_state VALUES ('projection_version', ?)").run(PROJECTION_VERSION);
    this.beforeCommit = beforeCommit;
  }
  close() { this.db.close(); }
  has(id) { return Boolean(this.db.prepare('SELECT 1 FROM poll_attempts WHERE id=?').get(id)); }
  acquireLease(owner, now = Date.now(), duration = 120000) {
    return Boolean(this.db.prepare(`INSERT INTO leases VALUES ('collector',?,?)
      ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_ms=excluded.expires_ms
      WHERE leases.expires_ms <= ? OR leases.owner=excluded.owner`).run(owner, now + duration, now).changes);
  }
  releaseLease(owner) { this.db.prepare("DELETE FROM leases WHERE name='collector' AND owner=?").run(owner); }
  import(record, sourceDir, options) {
    const staged = this.archive.stage(record, sourceDir);
    if (!this.has(record.id)) this.unaccountedBytes = (this.unaccountedBytes ?? 0) +
      Object.values(staged.manifest.bodies).reduce((sum, b) => sum + b.compressedBytes, 0) +
      Buffer.byteLength(JSON.stringify(staged.manifest)) + 32768;
    return this.publish(staged, { parseFeed, parseHtmlSummary, PARSER_VERSION }, options);
  }
  publish({ manifest: m, key, hash }, parser, { leaseOwner } = {}) {
    if (m.projectionVersion && m.projectionVersion !== PROJECTION_VERSION) throw Error('Unsupported archived projection version');
    const r = m.record, receivedMs = time(r.feed?.receivedAt ?? r.observedAt), scheduledMs = time(r.scheduledAt);
    if (receivedMs > Date.now() + 60000) throw new Error('Capture time is in the future');
    // Verify archived objects even when replaying an already indexed attempt.
    const body = m.bodies.feed ? this.archive.readBody(m.bodies.feed) : null;
    const html = m.bodies.html ? this.archive.readBody(m.bodies.html) : null;
    if (parser.PARSER_VERSION !== m.parserVersion) throw new Error('Parser version mismatch');
    let parsed, error = r.feed?.error ?? null;
    if (r.feed?.status === 200 && body) {
      try { parsed = parser.parseFeed(body.toString('utf8')); }
      catch (e) { error = e.message; }
    }
    const htmlSummary = html && r.html?.status === 200 ? parser.parseHtmlSummary(html.toString('utf8')) : null;
    const facts = captureFacts(parsed, htmlSummary);
    if (!parsed && r.feed?.status === 200 && body) facts.quality = 'invalid';
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (leaseOwner && !this.db.prepare("SELECT 1 FROM leases WHERE name='collector' AND owner=? AND expires_ms>?").get(leaseOwner, Date.now())) throw new Error('Collector lease expired');
      const existing = this.db.prepare('SELECT manifest_hash FROM poll_attempts WHERE id=?').get(r.id);
      if (existing) {
        if (existing.manifest_hash !== hash) throw new Error('Attempt ID reused with different evidence');
        this.db.exec('COMMIT'); return { id: r.id, status: 'already_indexed' };
      }
      const slot = Math.floor(receivedMs / INTERVAL_MS) * INTERVAL_MS;
      this.db.prepare(`INSERT INTO poll_attempts
        (id,scheduled_ms,received_ms,http_status,outcome,error,raw_key,manifest_key,manifest_hash,parser_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(r.id, scheduledMs, receivedMs,
        r.feed?.status ?? null, facts.quality, error, m.bodies.feed?.key ?? null, key, hash, m.parserHash);
      const eventKeys = parsed?.totalsValid ? parsed.normalized.features.map(f => `${f.id}|${f.properties.started.raw ?? ''}`).sort() : null;
      this.db.prepare('INSERT INTO attempt_facts VALUES (?,?,?,?,?,?,?,?,?,?)').run(r.id, slot, facts.quality,
        parsed?.totals.customers ?? null, parsed?.totals.reportedOutages ?? null, facts.htmlCustomers,
        m.bodies.feed?.hash ?? null, m.parserVersion, JSON.stringify(facts.flags), JSON.stringify(eventKeys));
      this.projectFrom(slot);
      const newest = this.db.prepare("SELECT id FROM snapshots WHERE quality='valid' ORDER BY captured_ms DESC LIMIT 1").get();
      if (newest) this.db.prepare("INSERT OR REPLACE INTO collector_state VALUES ('latest_snapshot', ?)").run(newest.id);
      else this.db.prepare("DELETE FROM collector_state WHERE key='latest_snapshot'").run();
      const cutoff = this.db.prepare('SELECT MAX(received_ms)-? at FROM poll_attempts').get(MAX_GAP_MS).at;
      this.db.prepare("UPDATE snapshots SET event_keys_json='null' WHERE event_keys_json<>'null' AND captured_ms<?").run(cutoff);
      this.db.prepare("UPDATE attempt_facts SET event_keys_json='null' WHERE event_keys_json<>'null' AND slot_ms<?").run(cutoff - INTERVAL_MS);
      // Failed/review observations also invalidate intervals they fall inside.
      for (const offset of [-DAY_MS, 0, DAY_MS]) this.db.prepare('INSERT OR IGNORE INTO maintenance_queue VALUES (?)').run(dayOf(receivedMs + offset));
      this.beforeCommit?.(); this.db.exec('COMMIT');
      return { id: r.id, status: this.db.prepare('SELECT outcome FROM poll_attempts WHERE id=?').get(r.id).outcome,
        snapshotIndexed: Boolean(this.db.prepare('SELECT 1 FROM snapshots WHERE id=?').get(r.id)) };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  projectFrom(startSlot) {
    let slot = startSlot;
    while (slot != null) {
      const old = this.db.prepare('SELECT s.*,t.customers,t.outages FROM snapshots s JOIN totals t ON s.id=t.snapshot_id WHERE slot_ms=?').get(slot);
      const previous = this.db.prepare('SELECT s.*,t.customers FROM snapshots s JOIN totals t ON s.id=t.snapshot_id WHERE slot_ms<? ORDER BY slot_ms DESC LIMIT 1').get(slot);
      const candidates = this.db.prepare(`SELECT f.*,a.received_ms,a.raw_key,a.parser_hash FROM attempt_facts f
        JOIN poll_attempts a ON a.id=f.id WHERE f.slot_ms=? ORDER BY a.received_ms,a.id`).all(slot)
        .map(f => ({ ...f, ...classifyCandidate(f, previous) }));
      // Earliest valid candidate wins; otherwise retain earliest usable totals.
      const selected = candidates.find(f => f.quality === 'valid') ?? candidates.find(f => f.customers != null);
      for (const f of candidates) this.db.prepare('UPDATE poll_attempts SET outcome=? WHERE id=?')
        .run(f.quality === 'valid' && f !== selected ? 'duplicate_slot' : f.quality, f.id);
      const unchanged = old?.id === selected?.id && old?.quality === selected?.quality;
      if (old && !unchanged) {
        this.db.prepare('DELETE FROM totals WHERE snapshot_id=?').run(old.id);
        this.db.prepare('DELETE FROM snapshots WHERE id=?').run(old.id);
      }
      if (selected && !unchanged) {
        this.db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)').run(selected.id, slot, selected.received_ms,
          selected.raw_key, selected.raw_hash, selected.parser_version, selected.parser_hash, selected.quality,
          JSON.stringify(selected.flags), selected.event_keys_json);
        this.db.prepare('INSERT INTO totals VALUES (?,?,?)').run(selected.id, selected.customers, selected.outages);
      }
      for (const offset of [-DAY_MS, 0, DAY_MS]) this.db.prepare('INSERT OR IGNORE INTO maintenance_queue VALUES (?)').run(dayOf(slot + offset));
      // Once the preceding snapshot is unchanged, later classification is unchanged.
      if (slot > startSlot && unchanged) break;
      slot = this.db.prepare('SELECT MIN(slot_ms) slot FROM attempt_facts WHERE slot_ms>?').get(slot).slot;
    }
  }
  async recover({ leaseOwner } = {}) {
    const results = [];
    // Only keys are retained in memory; deterministic projection tolerates any order.
    for (const key of this.archive.manifests()) {
      const staged = this.archive.readManifest(key);
      if (leaseOwner && !this.acquireLease(leaseOwner)) throw new Error('Collector lease lost during recovery');
      results.push(this.publish(staged, await this.archive.parser(staged.manifest), { leaseOwner }));
    }
    return results;
  }
  async replaySnapshot(id) {
    const row = this.db.prepare('SELECT manifest_key FROM poll_attempts WHERE id=?').get(id);
    if (!row) throw new Error('Unknown capture');
    const { manifest: m } = this.archive.readManifest(row.manifest_key);
    const parser = await this.archive.parser(m), body = this.archive.readBody(m.bodies.feed);
    return { id, observedAt: m.record.feed.receivedAt, parserVersion: m.parserVersion, ...parser.parseFeed(body.toString('utf8')) };
  }
  maintain(limit = 3) { return maintainRollups(this.db, limit); }
  health(now = Date.now()) {
    const attempt = this.db.prepare('SELECT * FROM poll_attempts ORDER BY received_ms DESC LIMIT 1').get();
    const retrieval = this.db.prepare('SELECT MAX(received_ms) at FROM poll_attempts WHERE http_status=200').get().at;
    const latest = this.db.prepare(`SELECT s.*,t.customers,t.outages FROM snapshots s JOIN totals t ON s.id=t.snapshot_id
      WHERE s.quality='valid' ORDER BY captured_ms DESC LIMIT 1`).get();
    const age = latest ? Math.max(0, now - latest.captured_ms) : null;
    const counts = this.db.prepare('SELECT outcome,COUNT(*) count FROM poll_attempts GROUP BY outcome').all();
    const times = this.db.prepare('SELECT captured_ms FROM snapshots ORDER BY captured_ms').all();
    const gaps = times.slice(1).flatMap((r, i) => r.captured_ms - times[i].captured_ms > 2 * INTERVAL_MS ?
      [{ from: new Date(times[i].captured_ms).toISOString(), to: new Date(r.captured_ms).toISOString(), minutes: (r.captured_ms - times[i].captured_ms) / 60000 }] : []);
    const previous = latest && this.db.prepare(`SELECT s.*,t.customers,t.outages FROM snapshots s JOIN totals t ON s.id=t.snapshot_id
      WHERE captured_ms < ? ORDER BY captured_ms DESC LIMIT 1`).get(latest.captured_ms);
    const interveningFailure = previous && this.db.prepare(`SELECT 1 FROM poll_attempts WHERE received_ms>? AND received_ms<=?
      AND outcome NOT IN ('valid','duplicate_slot') LIMIT 1`).get(previous.captured_ms, latest.captured_ms);
    let change = null;
    if (previous?.quality === 'valid' && latest.captured_ms - previous.captured_ms <= MAX_GAP_MS && !interveningFailure &&
        previous.event_keys_json !== 'null' && latest.event_keys_json !== 'null') {
      const a = new Set(JSON.parse(previous.event_keys_json)), b = new Set(JSON.parse(latest.event_keys_json));
      change = { customers: latest.customers - previous.customers, newReportedEvents: [...b].filter(v => !a.has(v)).length,
        noLongerReportedEvents: [...a].filter(v => !b.has(v)).length, meaning: 'Provisional event keys; disappearance is not confirmed restoration.' };
    }
    const validSlots = this.db.prepare("SELECT COUNT(*) n FROM snapshots WHERE quality='valid'").get().n;
    const window = this.db.prepare('SELECT MIN(received_ms) first,MAX(received_ms) last FROM poll_attempts').get();
    const expected = window.first == null ? 0 : Math.floor(window.last / INTERVAL_MS) - Math.floor(window.first / INTERVAL_MS) + 1;
    return { checkedAt: new Date(now).toISOString(), runtime: 'local-sqlite',
      lastAttemptAt: attempt ? new Date(attempt.received_ms).toISOString() : null,
      lastSuccessfulRetrievalAt: retrieval == null ? null : new Date(retrieval).toISOString(),
      latest: latest ? { id: latest.id, capturedAt: new Date(latest.captured_ms).toISOString(), customers: latest.customers, outages: latest.outages } : null,
      sourceUpdatedAt: null, sourceFreshness: 'unavailable', ageMinutes: age == null ? null : age / 60000,
      status: age == null || age >= 15 * 60000 ? 'stale' : age > 10 * 60000 || !['valid','duplicate_slot'].includes(attempt?.outcome) ? 'warning' : 'ok',
      attemptsByOutcome: counts, httpOutcomes: this.db.prepare('SELECT http_status,COUNT(*) count FROM poll_attempts GROUP BY http_status').all(),
      snapshots: times.length, validSnapshots: validSlots,
      observedHours: window.first == null ? 0 : (window.last - window.first) / 3600000,
      expectedSlotsInObservedWindow: expected, validSlotCoverage: expected ? validSlots / expected : 0,
      gapsOver10Minutes: gaps, change,
      pendingRollupDays: this.db.prepare('SELECT COUNT(*) n FROM maintenance_queue').get().n };
  }
  storage(config, { now = Date.now(), force = false } = {}) {
    const bytes = dir => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytes(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
    if (force || !this.storageSample || now - this.storageSample.at >= 3600000) {
      this.storageSample = { bytes: bytes(this.root), at: now }; this.unaccountedBytes = 0;
    }
    // New immutable bytes plus conservative index/parser overhead; hourly scans reconcile.
    const used = this.storageSample.bytes + (this.unaccountedBytes ?? 0), disk = statfsSync(this.root), free = disk.bavail * disk.bsize;
    const ratio = used / config.localBudgetBytes;
    return { bytes: used, freeDiskBytes: free, budgetBytes: config.localBudgetBytes,
      pressure: free < config.minimumFreeDiskBytes || ratio >= config.urgentFraction ? 'urgent' : ratio >= config.offloadFraction ? 'offload_due' : ratio >= config.warningFraction ? 'warning' : 'ok',
      measuredAt: new Date(this.storageSample.at).toISOString(), cleanupEnabled: false, detailDeleted: false,
      retentionPolicy: { protectedYearDays: config.protectedYearDays ?? 365, offlineReserveDays: config.offlineReserveDays ?? 30, automaticOffloadInstalled: false } };
  }
}

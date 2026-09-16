import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statfsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Archive } from './archive.mjs';
import { parseFeed, parseHtmlSummary, PARSER_VERSION } from '../contract.mjs';
import { INTERVAL_MS, MAX_GAP_MS, DAY_MS, dayOf, maintainRollups } from './rollups.mjs';

const time = value => { const ms = Date.parse(value); if (!Number.isFinite(ms)) throw new Error('Invalid capture time'); return ms; };
export class LocalCollector {
  constructor(root, { beforeCommit, archive } = {}) {
    this.root = resolve(root); mkdirSync(this.root, { recursive: true });
    this.archive = archive ?? new Archive(join(this.root, 'archive'));
    this.db = new DatabaseSync(join(this.root, 'index.sqlite'), { timeout: 5000 });
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
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
    return this.publish(staged, { parseFeed, parseHtmlSummary, PARSER_VERSION }, options);
  }
  publish({ manifest: m, key, hash }, parser, { leaseOwner } = {}) {
    const r = m.record, receivedMs = time(r.feed?.receivedAt ?? r.observedAt), scheduledMs = time(r.scheduledAt);
    if (receivedMs > Date.now() + 60000) throw new Error('Capture time is in the future');
    // Verify archived objects even when replaying an already indexed attempt.
    const body = m.bodies.feed ? this.archive.readBody(m.bodies.feed) : null;
    const html = m.bodies.html ? this.archive.readBody(m.bodies.html) : null;
    if (parser.PARSER_VERSION !== m.parserVersion) throw new Error('Parser version mismatch');
    let parsed, outcome = 'failed', error = r.feed?.error ?? null;
    if (r.feed?.status === 200 && body) {
      try { parsed = parser.parseFeed(body.toString('utf8')); outcome = parsed.totalsValid ? (parsed.issues.length ? 'review' : 'valid') : 'invalid'; }
      catch (e) { outcome = 'invalid'; error = e.message; }
    }
    const htmlSummary = html && r.html?.status === 200 ? parser.parseHtmlSummary(html.toString('utf8')) : null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (leaseOwner && !this.db.prepare("SELECT 1 FROM leases WHERE name='collector' AND owner=? AND expires_ms>?").get(leaseOwner, Date.now())) throw new Error('Collector lease expired');
      const existing = this.db.prepare('SELECT manifest_hash FROM poll_attempts WHERE id=?').get(r.id);
      if (existing) {
        if (existing.manifest_hash !== hash) throw new Error('Attempt ID reused with different evidence');
        this.db.exec('COMMIT'); return { id: r.id, status: 'already_indexed' };
      }
      const slot = Math.floor(receivedMs / INTERVAL_MS) * INTERVAL_MS;
      const flags = [...(parsed?.issues ?? [])];
      if (htmlSummary?.customers != null && parsed?.totals.customers != null && htmlSummary.customers !== parsed.totals.customers) {
        flags.push({ code: 'html_customer_mismatch' }); outcome = 'review';
      }
      const previous = this.db.prepare(`SELECT s.*,t.customers,t.outages FROM snapshots s JOIN totals t ON s.id=t.snapshot_id
        WHERE captured_ms < ? ORDER BY captured_ms DESC LIMIT 1`).get(receivedMs);
      // Hold an unexplained large-to-zero transition once. A subsequent empty
      // capture or independent HTML zero can confirm recovery without inventing it.
      if (outcome === 'valid' && parsed.totals.customers === 0 && previous &&
          (previous.customers >= 100 || previous.quality === 'quarantined') && htmlSummary?.customers !== 0) {
        const confirms = previous.quality === 'quarantined' && previous.customers === 0 && receivedMs - previous.captured_ms <= MAX_GAP_MS;
        if (!confirms) { outcome = 'quarantined'; flags.push({ code: 'unconfirmed_zero' }); }
      }
      let occupied = this.db.prepare('SELECT id,quality FROM snapshots WHERE slot_ms=?').get(slot);
      if (occupied && occupied.quality !== 'valid' && outcome === 'valid') {
        // A suspect observation does not consume the slot's one valid result.
        // Its original attempt and immutable archive remain in the journal.
        this.db.prepare('DELETE FROM totals WHERE snapshot_id=?').run(occupied.id);
        this.db.prepare('DELETE FROM snapshots WHERE id=?').run(occupied.id);
        occupied = null;
      }
      const canIndex = parsed?.totalsValid && !occupied;
      const attemptOutcome = occupied && outcome === 'valid' ? 'duplicate_slot' : outcome;
      this.db.prepare(`INSERT INTO poll_attempts
        (id,scheduled_ms,received_ms,http_status,outcome,error,raw_key,manifest_key,manifest_hash,parser_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(r.id, scheduledMs, receivedMs,
        r.feed?.status ?? null, attemptOutcome, error, m.bodies.feed?.key ?? null, key, hash, m.parserHash);
      if (canIndex) {
        const eventKeys = parsed.normalized.features.map(f => `${f.id}|${f.properties.started.raw ?? ''}`).sort();
        this.db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)').run(r.id, slot, receivedMs, m.bodies.feed.key,
          m.bodies.feed.hash, m.parserVersion, m.parserHash, outcome, JSON.stringify(flags), JSON.stringify(eventKeys));
        this.db.prepare('INSERT INTO totals VALUES (?,?,?)').run(r.id, parsed.totals.customers, parsed.totals.reportedOutages);
        // Event-key arrays are only a short-lived comparison cache. Keeping one
        // array per historical snapshot would defeat the compact index budget.
        this.db.prepare(`UPDATE snapshots SET event_keys_json='null'
          WHERE captured_ms < (SELECT MAX(captured_ms) FROM snapshots)-? AND event_keys_json<>'null'`).run(MAX_GAP_MS);
        if (outcome === 'valid') {
          const newest = this.db.prepare("SELECT id FROM snapshots WHERE quality='valid' ORDER BY captured_ms DESC LIMIT 1").get();
          this.db.prepare("INSERT OR REPLACE INTO collector_state VALUES ('latest_snapshot', ?)").run(newest.id);
        }
      }
      // Failed/review observations also invalidate intervals they fall inside.
      for (const offset of [-DAY_MS, 0, DAY_MS]) this.db.prepare('INSERT OR IGNORE INTO maintenance_queue VALUES (?)').run(dayOf(receivedMs + offset));
      this.beforeCommit?.(); this.db.exec('COMMIT');
      return { id: r.id, status: attemptOutcome, snapshotIndexed: Boolean(canIndex) };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async recover({ leaseOwner } = {}) {
    const results = [];
    const manifests = this.archive.manifests().map(key => this.archive.readManifest(key)).sort((a, b) =>
      time(a.manifest.record.feed?.receivedAt ?? a.manifest.record.observedAt) - time(b.manifest.record.feed?.receivedAt ?? b.manifest.record.observedAt));
    for (const staged of manifests) {
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
  storage(config) {
    const bytes = dir => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytes(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
    const used = bytes(this.root), disk = statfsSync(this.root), free = disk.bavail * disk.bsize;
    const ratio = used / config.localBudgetBytes;
    return { bytes: used, freeDiskBytes: free, budgetBytes: config.localBudgetBytes,
      pressure: free < config.minimumFreeDiskBytes || ratio >= config.urgentFraction ? 'urgent' : ratio >= config.offloadFraction ? 'offload_due' : ratio >= config.warningFraction ? 'warning' : 'ok',
      cleanupEnabled: false, detailDeleted: false, protectedYearDays: 365, offlineReserveDays: 30 };
  }
}

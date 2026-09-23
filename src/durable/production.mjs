import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { collectWithRetries, retryDecision } from './scheduling.mjs';
import { INTERVAL_MS } from './rollups.mjs';
import { syncDirectory } from '../runtime/durable-files.mjs';

// Only redundant production staging files are removed. The verified canonical
// archive, manifests, pinned parsers and local trial inbox are never pruned here.
export function finishStagedAttempt(collector, directory, record) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(record.id) || !collector.has(record.id)) throw Error('Attempt is not durably indexed');
  const { manifest, hash } = collector.archive.readManifest(`manifests/${record.id}.json`);
  if (collector.db.prepare('SELECT manifest_hash FROM poll_attempts WHERE id=?').get(record.id).manifest_hash !== hash)
    throw Error('Indexed attempt differs from its archive');
  if (!isDeepStrictEqual(manifest.record, record)) throw Error('Staged attempt differs from its archive');
  for (const name of ['feed', 'html']) {
    if (record[name]?.file) collector.archive.readBody(manifest.bodies[name]);
  }
  for (const suffix of ['geojson', 'html', 'normalized.json', 'attempt.json']) {
    try { unlinkSync(join(directory, `${record.id}.${suffix}`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  syncDirectory(directory);
}

export async function recoverProduction(collector, directory, owner, now = Date.now, { scanArchive = true } = {}) {
  for (const key of scanArchive ? collector.archive.manifests() : []) {
    if (collector.has(key.slice('manifests/'.length, -'.json'.length))) continue;
    if (!collector.acquireLease(owner, now())) throw Error('Collector lease lost during recovery');
    const staged = collector.archive.readManifest(key);
    collector.publish(staged, await collector.archive.parser(staged.manifest), { leaseOwner: owner });
  }
  for (const name of readdirSync(directory).filter(name => name.endsWith('.attempt.json')).sort()) {
    if (!collector.acquireLease(owner, now())) throw Error('Collector lease lost during staging recovery');
    const record = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    let canonical;
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(record.id) || name !== `${record.id}.attempt.json`) throw Error('Invalid staging identity');
    try { canonical = collector.archive.readManifest(`manifests/${record.id}.json`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (canonical) {
      if (!isDeepStrictEqual(canonical.manifest.record, record)) throw Error('Staged attempt differs from its archive');
      if (!collector.has(record.id)) collector.publish(canonical, await collector.archive.parser(canonical.manifest), { leaseOwner: owner });
    } else collector.import(record, directory, { leaseOwner: owner });
    finishStagedAttempt(collector, directory, record);
  }
  while (collector.maintain()) { /* drain recovered rollups before serving */ }
  const last = collector.db.prepare('SELECT manifest_key FROM poll_attempts ORDER BY received_ms DESC LIMIT 1').get();
  if (!last) return null;
  const { manifest } = collector.archive.readManifest(last.manifest_key);
  return { record: manifest.record, decision: retryDecision(manifest.record, 2, now()) };
}

export async function productionStep({ collector, config, state, owner, capture, persist, now = Date.now, sleepImpl }) {
  if (state.stopReason) return { action: 'stopped', reason: state.stopReason };
  if (!collector.acquireLease(owner, now())) return { action: 'lease_busy' };
  state.storage = collector.storage(config, { now: now() });
  if (state.storage.pressure === 'urgent') {
    state.stopReason = 'storage_pressure'; await persist(state);
    return { action: 'stopped', reason: state.stopReason };
  }
  const due = Math.max(Date.parse(state.nextDueAt ?? '') || 0, Date.parse(state.retryAt ?? '') || 0);
  const slot = Math.floor(now() / INTERVAL_MS) * INTERVAL_MS;
  const last = collector.db.prepare('SELECT MAX(received_ms) at FROM poll_attempts').get().at;
  if (now() < due || (last != null && Math.floor(last / INTERVAL_MS) * INTERVAL_MS >= slot)) return { action: 'waiting' };
  const result = await collectWithRetries({ slot, now, ...(sleepImpl ? { sleepImpl } : {}), capture,
    publish: record => collector.import(record, config.staging, { leaseOwner: owner }) });
  state.lastCaptureAt = result.record.observedAt;
  state.nextDueAt = new Date((Math.floor(now() / INTERVAL_MS) + 1) * INTERVAL_MS).toISOString();
  state.retryAt = result.decision.action === 'backoff' ? new Date(result.decision.until).toISOString() : null;
  if (result.decision.action === 'stop') state.stopReason = result.decision.reason;
  await persist(state);
  collector.maintain();
  return { action: state.stopReason ? 'stopped' : 'captured', ...result };
}

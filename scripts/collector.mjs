import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { LocalCollector } from '../src/durable/collector.mjs';
import { capture, writeJsonAtomic } from '../src/pilot-io.mjs';
import { collectWithRetries, pilotMode } from '../src/durable/scheduling.mjs';
import { INTERVAL_MS } from '../src/durable/rollups.mjs';

const mode = process.argv[2] ?? 'status';
if (!['import', 'status', 'recover', 'replay', 'run'].includes(mode)) throw new Error('Use import, status, recover, replay <id>, or run');
const config = JSON.parse(await readFile(new URL('../config/collector.local.json', import.meta.url), 'utf8'));
if (config.mode !== 'local' || config.automaticDeletion !== false || config.pollIntervalMs !== INTERVAL_MS) throw new Error('Unsupported collector configuration');
const root = resolve(config.root), pilotDir = resolve(config.pilotDirectory);
const inbox = pathToFileURL(resolve(root, 'inbox') + '/'), statePath = pathToFileURL(resolve(root, 'run-state.json'));
await mkdir('reports', { recursive: true });
const collector = new LocalCollector(root), owner = randomUUID();
let stop = false;
process.on('SIGINT', () => { stop = true; }); process.on('SIGTERM', () => { stop = true; });
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function importDirectory(dir, leaseOwner) {
  const files = (await readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; })).filter(n => n.endsWith('.attempt.json')).sort();
  let imported = 0;
  for (const name of files) {
    let record;
    try { record = await readJson(resolve(dir, name)); }
    catch (e) { if (!(e instanceof SyntaxError)) throw e; console.error(`Incomplete or malformed capture metadata: ${name}`); continue; }
    if (!record) continue;
    if (leaseOwner && !collector.acquireLease(leaseOwner)) throw new Error('Collector lease lost during import');
    if (!collector.has(record.id)) { collector.import(record, dir, { leaseOwner }); imported++; }
  }
  return imported;
}
async function report(state = null) {
  const health = collector.health(), storage = collector.storage(config);
  const runnerAgeSeconds = state?.heartbeatAt ? Math.max(0, Date.now() - Date.parse(state.heartbeatAt)) / 1000 : null;
  const result = { ...health, storage, run: state, runnerAgeSeconds,
    runnerStatus: state?.stopReason ? 'stopped' : state?.completedAt ? 'completed' : runnerAgeSeconds == null ? 'not_started' : runnerAgeSeconds > 120 ? 'stale' : 'ok',
    cloudDeployment: 'deferred' };
  await writeJsonAtomic(pathToFileURL(resolve('reports/collector-health.json')), result);
  return result;
}
try {
  if (mode === 'status') console.log(JSON.stringify(await report(await readJson(statePath)), null, 2));
  else if (mode === 'replay') console.log(JSON.stringify(await collector.replaySnapshot(process.argv[3]), null, 2));
  else if (mode === 'recover') {
    if (!collector.acquireLease(owner)) throw new Error('Another collector holds the lease');
    const results = await collector.recover({ leaseOwner: owner });
    while (collector.maintain()) { /* drain bounded day batches */ }
    console.log(JSON.stringify({ recovered: results.filter(r => r.status !== 'already_indexed').length, checked: results.length }));
  } else if (mode === 'import') {
    if (!collector.acquireLease(owner)) throw new Error('Another collector holds the lease');
    const imported = await importDirectory(pilotDir, owner) + await importDirectory(resolve(root, 'inbox'), owner);
    while (collector.maintain()) { /* drain bounded day batches */ }
    console.log(JSON.stringify({ imported, health: await report() }, null, 2));
  } else {
    let state = await readJson(statePath);
    if (!state) state = { startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + config.runDays * 86400000).toISOString() };
    if (state.stopReason || state.completedAt) throw new Error('Run has stopped or finished; review its saved state before starting another window');
    const persist = async () => {
      state.pid = process.pid; state.heartbeatAt = new Date().toISOString();
      await writeJsonAtomic(statePath, state);
    };
    while (!stop && Date.now() <= Date.parse(state.endsAt)) {
      if (!collector.acquireLease(owner)) throw new Error('Another collector holds the lease');
      try {
        state.lastImported = await importDirectory(pilotDir, owner) + await importDirectory(resolve(root, 'inbox'), owner);
        const pilot = await readJson(resolve(pilotDir, 'state.json'));
        const decision = pilotMode(pilot); state.mode = decision.mode;
        const pressure = collector.storage(config);
        if (pressure.pressure === 'urgent') { state.stopReason = 'Local storage pressure; preserve all existing history'; break; }
        if (decision.mode === 'stop') { state.stopReason = decision.reason; break; }
        const backoff = Math.max(decision.until ?? 0, Date.parse(state.retryAt ?? '') || 0);
        if (decision.mode === 'capture' && Date.now() >= backoff && Date.now() >= (Date.parse(state.nextDueAt ?? '') || 0)) {
          const slot = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS;
          const latest = collector.db.prepare('SELECT MAX(received_ms) at FROM poll_attempts').get().at;
          if (latest == null || Math.floor(latest / INTERVAL_MS) * INTERVAL_MS < slot) {
            const result = await collectWithRetries({ slot, capture: slot => capture(slot, { dir: inbox }),
              publish: record => collector.import(record, resolve(root, 'inbox'), { leaseOwner: owner }) });
            state.lastCaptureAt = result.record.observedAt;
            state.retryAt = result.decision.action === 'backoff' ? new Date(result.decision.until).toISOString() : null;
            if (result.decision.action === 'stop') state.stopReason = result.decision.reason;
          }
          state.nextDueAt = new Date((Math.floor(Date.now() / INTERVAL_MS) + 1) * INTERVAL_MS).toISOString();
        }
        collector.maintain(); await persist();
        const health = await report(state);
        if (state.lastImported || state.mode !== 'mirror') console.log(JSON.stringify({ at: state.heartbeatAt, mode: state.mode, imported: state.lastImported, status: health.status, snapshots: health.snapshots }));
        if (state.stopReason) break;
      } catch (error) {
        state.lastError = error.message; state.lastErrorAt = new Date().toISOString();
        console.error(JSON.stringify({ at: state.lastErrorAt, error: state.lastError }));
        await persist(); await report(state);
      } finally { collector.releaseLease(owner); }
      await sleep(config.checkIntervalMs);
    }
    if (Date.now() > Date.parse(state.endsAt)) state.completedAt = new Date().toISOString();
    if (stop) state.interruptedAt = new Date().toISOString();
    await persist(); await report(state);
  }
} finally { collector.releaseLease(owner); collector.close(); }

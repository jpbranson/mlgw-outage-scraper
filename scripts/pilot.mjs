import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DATA_DIR, capture, writeJsonAtomic } from '../src/pilot-io.mjs';

const once = process.argv.includes('--once');
const intervalMs = 5 * 60 * 1000;
await mkdir(DATA_DIR, { recursive: true });
const lockPath = new URL('pilot.lock', DATA_DIR);
let lock;
try { lock = await open(lockPath, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const old = JSON.parse(await readFile(lockPath, 'utf8'));
  let alive = true;
  try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
  if (alive) throw new Error(`Pilot lock belongs to running PID ${old.pid}`);
  await unlink(lockPath); lock = await open(lockPath, 'wx');
}
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
await lock.close();
let stop = false;
process.on('SIGINT', () => { stop = true; });
process.on('SIGTERM', () => { stop = true; });
const statePath = new URL('state.json', DATA_DIR);
try {
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state) {
    const now = Date.now();
    state = { startedAt: new Date(now).toISOString(), endsAt: new Date(now + 24 * 3600000).toISOString(), intervalMs, attempts: 0 };
  }
  if (state.stopReason) throw new Error(`Pilot stopped: ${state.stopReason}`);
  if (state.completedAt && !once) throw new Error('Pilot already ended; analyze its coverage before starting another window.');
  const persist = () => writeJsonAtomic(statePath, { ...state, pid: process.pid, heartbeatAt: new Date().toISOString() });
  await persist();
  while (!stop) {
    const now = Date.now();
    if (!once && state.lastAttemptAt && now > Date.parse(state.endsAt) + intervalMs) break;
    const next = Math.max(Date.parse(state.nextDueAt ?? state.startedAt), Date.parse(state.retryAt ?? 0) || 0);
    if (now < next) { await sleep(Math.min(1000, next - now)); continue; }
    // A resumed machine records the current slot. Missed slots stay missing.
    const record = await capture(Math.floor(now / intervalMs) * intervalMs);
    state.attempts++;
    state.lastAttemptAt = record.observedAt;
    state.lastStatus = record.status;
    if (record.status === 'valid' || record.status === 'review') state.lastValidAt = record.feed.receivedAt;
    state.failures = record.status === 'failed' ? (state.failures ?? 0) + 1 : 0;
    state.retryAt = record.retryAt ?? null;
    state.stopReason = record.stopReason ?? null;
    state.nextDueAt = new Date((Math.floor(Date.now() / intervalMs) + 1) * intervalMs +
      (state.failures ? Math.min(3600000, intervalMs * (2 ** Math.min(state.failures - 1, 4) - 1)) : 0)).toISOString();
    console.log(JSON.stringify({ at: record.observedAt, status: record.status, totals: record.totals, comparison: record.comparison, errors: [record.feed?.error, record.html?.error].filter(Boolean) }));
    await persist();
    if (once || state.stopReason || Date.now() >= Date.parse(state.endsAt)) break;
  }
  if (!once) { state.completedAt = new Date().toISOString(); await persist(); }
} finally { await unlink(lockPath); }

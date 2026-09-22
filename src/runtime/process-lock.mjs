import { readFileSync, unlinkSync, openSync, writeFileSync, closeSync } from 'node:fs';

// A live or unreadable owner always wins. Used only on this host's production
// state; exported migration bundles exclude locks from the source PC.
export function clearDeadLock(path) {
  let bytes;
  try { bytes = readFileSync(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const { pid } = JSON.parse(bytes);
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid lock owner; inspect before resuming');
  try { process.kill(pid, 0); throw Error(`Writer is already active (PID ${pid})`); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!readFileSync(path).equals(bytes)) throw Error('Lock changed while checking its owner');
  unlinkSync(path);
}
export function processLock(path) {
  clearDeadLock(path);
  const fd = openSync(path, 'wx');
  writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return () => { closeSync(fd); unlinkSync(path); };
}

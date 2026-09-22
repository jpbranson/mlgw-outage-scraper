import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { WeatherCache } from '../src/weather/cache.mjs';
import { publishWeather } from '../src/weather/publish.mjs';
import { maintenanceRequests, pruneRollingCache, directoryBytes } from '../src/weather/maintenance.mjs';
import { clearDeadLock, processLock } from '../src/runtime/process-lock.mjs';
import { writeJsonAtomic } from '../src/pilot-io.mjs';

if (process.env.MLGW_DEPLOYMENT !== 'production') throw Error('Production weather runs only on the intended cloud host');
const root = resolve('data/weather'), stateRoot = join(root, 'production');
mkdirSync(stateRoot, { recursive: true }); mkdirSync(join(root, 'cache'), { recursive: true });
const unlock = processLock(join(stateRoot, 'runner.lock')), statePath = join(stateRoot, 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : { startedAt: new Date().toISOString() };
const controller = new AbortController(); let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; controller.abort(); });
const persist = async () => { state.pid = process.pid; state.heartbeatAt = new Date().toISOString(); await writeJsonAtomic(pathToFileURL(statePath), state); };
try {
  while (!stopped && !state.stopReason && !existsSync(join(stateRoot, 'stop'))) {
    if (Date.now() >= (Date.parse(state.nextDueAt ?? '') || 0)) {
      let cache;
      try {
        const evidenceBytes = directoryBytes(join(root, 'cache'));
        const totalCap = JSON.parse(readFileSync('config/weather.local.json')).cacheBytes;
        const rollingBudget = Math.min(256 * 1024 * 1024, totalCap - evidenceBytes);
        if (rollingBudget < 64 * 1024 * 1024) throw Error('Weather storage headroom insufficient; evidence preserved');
        clearDeadLock(join(root, 'live-cache/writer.lock'));
        clearDeadLock(join(root, 'budget-writer.lock'));
        cache = new WeatherCache(join(root, 'live-cache'), { limits: { cacheBytes: rollingBudget, minimumFreeBytes: 5000000000 } });
        const now = Date.now(), retention = pruneRollingCache(cache, { now });
        const outcomes = await publishWeather(cache, maintenanceRequests(now), { offline: false });
        state.lastRun = { at: new Date(now).toISOString(), retention, outcomes, requests: cache.requests, downloadBytes: cache.downloadBytes, evidenceBytes, rollingBytes: cache.used, totalCap };
        state.lastError = null;
        state.status = outcomes.some(o => ['failed', 'restricted', 'provider-paused', 'rate-limited'].includes(o.status)) ? 'degraded' : 'ok';
        if (outcomes.some(o => o.status === 'restricted')) state.stopReason = 'source_restricted';
      } catch (error) { state.lastError = error.message; state.status = 'degraded'; }
      finally { cache?.close(); }
      state.nextDueAt = new Date(Date.now() + 30 * 60000).toISOString();
      await persist(); console.log(JSON.stringify(state));
    }
    await persist();
    if (state.stopReason) break;
    await sleep(30000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
  }
  if (existsSync(join(stateRoot, 'stop'))) state.stopReason = 'operator_stop';
  state.lastStoppedAt = new Date().toISOString(); await persist();
} finally { unlock(); }

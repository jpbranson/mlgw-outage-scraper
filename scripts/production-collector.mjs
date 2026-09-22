import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { LocalCollector } from '../src/durable/collector.mjs';
import { productionStep, recoverProduction } from '../src/durable/production.mjs';
import { capture, writeJsonAtomic } from '../src/pilot-io.mjs';

if (process.env.MLGW_DEPLOYMENT !== 'production') throw Error('Set MLGW_DEPLOYMENT=production only on the intended cloud host');
const config = JSON.parse(readFileSync(process.env.MLGW_COLLECTOR_CONFIG ?? 'config/collector.production.json', 'utf8'));
if (config.mode !== 'production' || config.pollIntervalMs !== 300000 || config.automaticDeletion !== false) throw Error('Unsupported production configuration');
const root = resolve(config.root); config.staging = join(root, 'staging'); mkdirSync(config.staging, { recursive: true });
const statePath = join(root, 'production-state.json'), stopPath = join(root, 'production.stop');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : { startedAt: new Date().toISOString(), mode: 'production' };
const collector = new LocalCollector(root), owner = randomUUID(), controller = new AbortController();
let stop = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop = true; controller.abort(); });
const persist = async () => {
  state.pid = process.pid; state.heartbeatAt = new Date().toISOString();
  await writeJsonAtomic(pathToFileURL(statePath), state);
};
try {
  let recovered = false;
  while (!stop && !state.stopReason && !existsSync(stopPath)) {
    if (collector.acquireLease(owner)) {
      if (!recovered) {
        const restored = await recoverProduction(collector, config.staging, owner);
        if (restored && Date.parse(restored.record.observedAt) > (Date.parse(state.lastCaptureAt ?? '') || 0)) {
          if (restored.decision.action === 'stop') state.stopReason = restored.decision.reason;
          if (restored.decision.action === 'backoff') state.retryAt = new Date(restored.decision.until).toISOString();
          state.lastCaptureAt = restored.record.observedAt;
          await persist();
        }
        recovered = true;
      }
      const result = await productionStep({ collector, config, state, owner, persist,
        capture: slot => capture(slot, { dir: pathToFileURL(config.staging + '/') }) });
      // Includes failed/transient attempts, all of which are retained in the archive.
      await recoverProduction(collector, config.staging, owner, Date.now, { scanArchive: false });
      await persist();
      if (result.action !== 'waiting') console.log(JSON.stringify({ at: state.heartbeatAt, action: result.action, stopReason: state.stopReason ?? null, latest: state.lastCaptureAt }));
    }
    if (state.stopReason) break;
    await sleep(config.checkIntervalMs, undefined, { signal: controller.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
  }
  if (existsSync(stopPath)) state.stopReason = 'operator_stop';
  state.lastStoppedAt = new Date().toISOString(); await persist();
} finally { collector.releaseLease(owner); collector.close(); }

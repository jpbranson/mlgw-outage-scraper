import { readFileSync, statfsSync } from 'node:fs';
const now = Date.now(), issues = [];
const config = JSON.parse(readFileSync('config/collector.production.json'));
const response = await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(10000) });
if (!response.ok) throw Error(`Dashboard health returned ${response.status}`);
const dashboard = await response.json();
if (dashboard.status !== 'ok') issues.push(`outage freshness: ${dashboard.status}`);
const collector = JSON.parse(readFileSync('data/collector/production-state.json'));
const weather = JSON.parse(readFileSync('data/weather/production/state.json'));
for (const [name, state] of [['collector', collector], ['weather', weather]]) {
  if (!Number.isFinite(Date.parse(state.heartbeatAt)) || now - Date.parse(state.heartbeatAt) > 120000) issues.push(`${name} heartbeat stale`);
  if (state.stopReason) issues.push(`${name} stopped: ${state.stopReason}`);
}
if (weather.status !== 'ok' || !Number.isFinite(Date.parse(weather.lastRun?.at)) || now - Date.parse(weather.lastRun.at) > 45 * 60000) issues.push('weather refresh degraded or stale');
const disk = statfsSync(config.root), freeBytes = disk.bavail * disk.bsize;
if (freeBytes < config.minimumFreeDiskBytes) issues.push('disk free space below reserve');
console.log(JSON.stringify({ checkedAt: new Date(now).toISOString(), status: issues.length ? 'degraded' : 'ok', latest: dashboard.latest, freeBytes, issues }));
process.exitCode = issues.length ? 1 : 0;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardService } from '../src/dashboard/service.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';
import { WeatherService } from '../src/dashboard/weather.mjs';
import { LegacyService } from '../src/dashboard/legacy.mjs';
import { ComparisonService } from '../src/dashboard/comparisons.mjs';

const config = JSON.parse(readFileSync(process.env.MLGW_COLLECTOR_CONFIG ?? 'config/collector.local.json', 'utf8'));
const service = new DashboardService(resolve(config.root), { localOnly: config.mode !== 'production' });
const legacy = new LegacyService(resolve('data/legacy/dashboard'));
const port = Number(process.env.DASHBOARD_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DASHBOARD_PORT must be 1024–65535');
const server = createDashboardServer(service, { staticRoot: resolve('dist/dashboard'), legacy, comparisons: new ComparisonService(resolve('data/comparisons')), weather: new WeatherService(resolve('data/weather/cache'),{rollingRoot:resolve('data/weather/live-cache')}),
  trustLoopbackProxy: process.env.DASHBOARD_TRUST_PROXY === '1',
  ...(process.env.PUBLIC_ORIGIN ? { publicOrigin: process.env.PUBLIC_ORIGIN } : {}),
  ...(process.env.DASHBOARD_TILES !== undefined ? { tiles: process.env.DASHBOARD_TILES } : {}),
  ...(process.env.DASHBOARD_TILE_ATTRIBUTION ? { attribution: process.env.DASHBOARD_TILE_ATTRIBUTION } : {}),
  ...(process.env.DASHBOARD_TILE_ATTRIBUTION_URL ? { attributionUrl: process.env.DASHBOARD_TILE_ATTRIBUTION_URL } : {}) });
server.listen(port, '127.0.0.1', () => console.log(`Local dashboard: http://127.0.0.1:${port} (PID ${process.pid})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { service.close(); legacy.close(); process.exit(0); }));
server.on('error', error => { console.error(error.message); service.close(); legacy.close(); process.exitCode = 1; });

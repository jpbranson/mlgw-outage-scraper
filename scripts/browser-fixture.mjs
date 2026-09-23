import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocalCollector } from '../src/durable/collector.mjs';
import { digest } from '../src/durable/archive.mjs';
import { DashboardService } from '../src/dashboard/service.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';

const root = mkdtempSync(join(tmpdir(), 'mlgw-browser-')), collector = new LocalCollector(root);
const fixture = JSON.parse(readFileSync('test/fixtures/ordinary.geojson'));
const now = Math.floor(Date.now() / 300000) * 300000;
for (const [id, offset, count] of [['browser-a', -300000, 10], ['browser-b', 0, 20]]) {
  const feature = structuredClone(fixture.features[0]); feature.properties.CUR_CUST_AFF = count;
  feature.properties.STATUS = '<img src=x onerror=alert(1)>';
  feature.properties.NEW_SOURCE_FIELD = 'additive change';
  const body = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [feature] })), at = new Date(now + offset).toISOString();
  writeFileSync(join(root, `${id}.geojson`), body);
  collector.import({ id, scheduledAt: at, observedAt: at, feed: { status: 200, receivedAt: at, file: `${id}.geojson`, sha256: digest(body) } }, root);
}
while (collector.maintain()) {}
const service = new DashboardService(root);
const weather = { at: params => ({ selectedAt: params.get('at'), radar: { availability: 'unavailable' }, rainfall: { availability: 'unavailable' },
  station: { availability: 'unavailable', records: [] } }), periods: () => ({ periods: [] }) };
const server = createDashboardServer(service, { staticRoot: resolve('dist/dashboard'), weather, tiles: '' });
server.listen(4189, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { service.close(); collector.close(); rmSync(root, { recursive: true, force: true }); process.exit(0); }));

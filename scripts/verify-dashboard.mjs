// Offline stress/replay verification, isolated from the live collector.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { LocalCollector } from '../src/durable/collector.mjs';
import { DashboardService } from '../src/dashboard/service.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';
import { digest } from '../src/durable/archive.mjs';
import { makeStressFeed } from '../src/stress.mjs';

const seed = JSON.parse(readFileSync('test/fixtures/ordinary.geojson', 'utf8'));
const results = [];
for (const size of [4000, 10000]) {
  const dir = mkdtempSync(join(tmpdir(), 'mlgw-dashboard-stress-'));
  const collector = new LocalCollector(join(dir, 'collector'));
  const body = JSON.stringify(makeStressFeed(seed, size)), at = '2026-09-16T12:00:00.000Z';
  writeFileSync(join(dir, 'synthetic.geojson'), body);
  collector.import({ id: `synthetic-${size}`, scheduledAt: at, observedAt: at, feed: { status: 200, receivedAt: at,
    file: 'synthetic.geojson', sha256: digest(body) } }, dir);
  const service = new DashboardService(collector.root);
  const server = createDashboardServer(service, { staticRoot: 'dist/dashboard', tiles: '' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/latest`), serialized = await response.text();
    const elapsedMs = performance.now() - start, data = JSON.parse(serialized);
    assert.equal(response.status, 200); assert.equal(data.detail.available, true);
    assert.equal(data.detail.geojson.features.length, size);
    assert.equal(data.summary.customers, data.detail.geojson.features.reduce((n, f) => n + f.properties.customers, 0));
    assert.ok(Buffer.byteLength(serialized) < 12 * 1024 * 1024);
    results.push({ syntheticFeatures: size, responseBytes: Buffer.byteLength(serialized), elapsedMs: Math.round(elapsedMs), replayedFeatures: data.detail.geojson.features.length });
  } finally { await new Promise(resolve => server.close(resolve)); service.close(); collector.close(); }
}
const report = { checkedAt: new Date().toISOString(), scope: 'Offline local API replay and response budget; not browser rendering or provider CPU.', results };
mkdirSync('reports', { recursive: true });
writeFileSync('reports/dashboard-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

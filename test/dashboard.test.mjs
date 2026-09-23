import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { LocalCollector } from '../src/durable/collector.mjs';
import { digest } from '../src/durable/archive.mjs';
import { DashboardService, DAY, SLOT, period, robustBaseline, sharpRise } from '../src/dashboard/service.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ordinary.geojson', import.meta.url), 'utf8'));
const base = Date.parse('2026-09-15T10:00:00Z');
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlgw-dashboard-')), collector = new LocalCollector(join(dir, 'collector'));
  const service = new DashboardService(collector.root, { now: () => base + 3600000 });
  t.after(() => { service.close(); collector.close(); });
  function add(id, offset, count, { fail = false, status = 'Crew assigned' } = {}) {
    const feature = structuredClone(fixture.features[0]);
    feature.properties.CUR_CUST_AFF = count; feature.properties.STATUS = status;
    feature.properties.TIME_STAMP = '09/14/2026 09:00 PM';
    feature.properties.OUT_CAUSE = 'THIS MUST STAY PRIVATE';
    const body = JSON.stringify({ type: 'FeatureCollection', features: [feature] });
    writeFileSync(join(dir, `${id}.json`), body);
    const at = new Date(base + offset * 60000).toISOString();
    return collector.import({ id, scheduledAt: at, observedAt: at,
      feed: { receivedAt: at, status: fail ? 503 : 200, file: `${id}.json`, sha256: digest(body) } }, dir);
  }
  return { dir, collector, service, add };
}
function params(from = base, to = base + 3600000, resolution = '5m') {
  return new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), resolution });
}
async function serve(t, service, dir, options = {}) {
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Test</title>');
  const server = createDashboardServer(service, { staticRoot: dir, tiles: '', ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('viewer opens SQLite read-only and reproduces selected archived geometry and totals', async t => {
  const { add, service } = setup(t); add('a', 0, 10); add('b', 5, 200);
  assert.throws(() => service.db.prepare('DELETE FROM snapshots').run(), /readonly/i);
  const a = await service.snapshot('a'), b = await service.latest();
  assert.equal(a.summary.customers, 10); assert.equal(b.summary.customers, 200);
  assert.equal(a.detail.geojson.features[0].properties.customers, 10);
  assert.deepEqual(a.detail.geojson.features[0].geometry, fixture.features[0].geometry);
  assert.equal(a.summary.change, null); assert.equal(b.summary.change, 190); assert.equal(b.summary.sharpRise, true);
  assert.equal(a.summary.dailyPeak, 10); assert.equal(b.summary.dailyPeak, 200);
  assert.equal(a.detail.longRunning[0].hours, 8); // duration uses selected capture, not wall clock
  assert.equal(a.source.sourceUpdatedAt, null);
  assert.doesNotMatch(JSON.stringify(a), /THIS MUST STAY PRIVATE|OUT_CAUSE|parserKey|raw_key|manifest_key/);
});
test('untrusted source strings stay data; backend projects only approved fields', async t => {
  const { add, service } = setup(t); add('html', 0, 10, { status: '<img src=x onerror=alert(1)>' });
  const snapshot = await service.snapshot('html');
  assert.equal(snapshot.detail.geojson.features[0].properties.status, '<img src=x onerror=alert(1)>');
  assert.deepEqual(Object.keys(snapshot.detail.geojson.features[0].properties).sort(), ['customers', 'estimatedRepair', 'outageId', 'started', 'status']);
});
test('missing or tampered archive detail keeps known totals and never becomes an empty map', async t => {
  const { add, collector, service } = setup(t); add('a', 0, 10); add('b', 5, 20);
  const first = collector.archive.readManifest('manifests/a.json').manifest;
  unlinkSync(collector.archive.path(first.bodies.feed.key));
  const a = await service.snapshot('a'); assert.equal(a.summary.customers, 10); assert.equal(a.detail.available, false); assert.equal(a.detail.geojson, undefined);
  const manifestPath = collector.archive.path('manifests/b.json');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8') + ' ');
  assert.equal((await service.snapshot('b')).detail.available, false);
});
test('series breaks at failed attempts and long gaps without false rise signals or zero fill', t => {
  const { add, service } = setup(t);
  add('a', 0, 10); add('bad', 2, 10, { fail: true }); add('b', 5, 200); add('c', 20, 500); add('d', 25, 1500);
  const result = service.series(params());
  assert.deepEqual(result.points.map(p => p.customers), [10, null, 200, null, 500, 1500]);
  assert.deepEqual(result.anomalies.map(a => a.id), ['d']);
  assert.equal(result.coverage, 5 / 60); assert.equal(result.quality[0].outcome, 'failed');
  assert.equal(service.summary(service.row('b')).change, null);
});
test('hourly and daily points preserve the actual peak capture and partial coverage', t => {
  const { add, collector, service } = setup(t); add('low', 0, 10); add('peak', 5, 200); add('end', 10, 100);
  while (collector.maintain()) { /* finish queued fixture rollups */ }
  for (const resolution of ['hourly', 'daily']) {
    const result = service.series(params(base, base + 3600000, resolution));
    assert.equal(result.points[0].id, 'peak'); assert.equal(result.points[0].customers, 200);
    assert.equal(result.points[0].capturedAt, new Date(base + 5 * 60000).toISOString());
    assert.ok(result.points[0].coverage > 0 && result.points[0].coverage < 1);
  }
});
test('range, resolution, date and capture limits reject invalid requests', async t => {
  const { service } = setup(t);
  assert.throws(() => period(params(base, base + 3 * DAY), base + 4 * DAY), /limited to two days/);
  assert.throws(() => period(params(base, base + 32 * DAY, 'daily'), base + 33 * DAY), /31 days/);
  assert.throws(() => period(new URLSearchParams('from=garbage')), /ISO/);
  assert.throws(() => period(new URLSearchParams('resolution=yearly')), /summaries/);
  assert.throws(() => service.snapshots('2026-02-30'), /valid archive date/);
  assert.deepEqual(service.snapshots('2026-09-14').snapshots, []);
  await assert.rejects(service.snapshot('../archive'), /Invalid capture/);
  await assert.rejects(service.snapshot('missing'), /not found/);
});
test('sharp rise and robust baseline require adequate comparable history', () => {
  assert.equal(sharpRise({ customers: 0 }, { customers: 100 }, true), true);
  assert.equal(sharpRise({ customers: 100 }, { customers: 199 }, true), false);
  assert.equal(sharpRise({ customers: 100 }, { customers: 300 }, false), false);
  const from = base - 28 * DAY;
  const rows = Array.from({ length: 28 * 288 }, (_, i) => ({ at: from + i * SLOT, customers: 20 }));
  assert.equal(robustBaseline(rows, from, base).threshold, 120);
  assert.equal(robustBaseline(rows.slice(0, 7000), from, base).enabled, false);
  assert.equal(robustBaseline([...rows.slice(0, 100), ...rows.slice(0, 100)], from, base).enabled, false);
});
test('freshness ages even without a new attempt and invalid captures never replace latest', async t => {
  const { add, service } = setup(t); add('a', 0, 10); add('bad', 5, 20, { fail: true });
  service.now = () => base + 6 * 60000; assert.equal(service.health().status, 'warning');
  service.now = () => base + 15 * 60000; assert.equal(service.health().status, 'stale');
  assert.equal(service.health().latest.id, 'a'); assert.equal((await service.latest()).summary.customers, 10);
});
test('HTTP routes bound reads, reject writes and foreign origins, and do not expose archives/admin', async t => {
  const { add, service, dir } = setup(t); add('a', 0, 10);
  const url = await serve(t, service, dir);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}/api/latest`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${url}/api/latest`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${url}/api/latest`, { headers: { Host: 'foreign.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  for (const path of ['/data/collector/index.sqlite', '/archive/manifests/a.json', '/api/admin', '/%2e%2e/README.md'])
    assert.equal((await fetch(url + path)).status, 404);
  const latest = await fetch(`${url}/api/latest`);
  assert.equal(latest.headers.get('cache-control'), 'no-store');
  assert.equal(latest.headers.get('access-control-allow-origin'), null);
  assert.match(latest.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${url}/api/series?resolution=5m&from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z`)).status, 400);
});
test('bounded exports retain selected times/counts and exclude private archive fields', async t => {
  const { add, service, dir } = setup(t); add('a', 0, 10); add('b', 5, 20);
  const url = await serve(t, service, dir);
  const csv = await (await fetch(`${url}/api/export.csv?${params()}`)).text();
  assert.match(csv, /2026-09-15T10:00:00.000Z,10,1/); assert.equal(csv.trim().split('\r\n').length, 3);
  const geo = await (await fetch(`${url}/api/export.geojson?id=a`)).json();
  assert.equal(geo.capturedAt, '2026-09-15T10:00:00.000Z'); assert.equal(geo.features[0].properties.customers, 10);
  assert.doesNotMatch(JSON.stringify(geo), /OUT_CAUSE|THIS MUST STAY PRIVATE|archive/);
});
test('local data request budget responds with retry guidance while health stays available', async t => {
  const { service, dir } = setup(t); const url = await serve(t, service, dir, { requestLimit: 2 });
  await fetch(`${url}/api/config`); await fetch(`${url}/api/config`);
  const response = await fetch(`${url}/api/config`); assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});
test('historical map replays verified originals, deduplicates polls and respects missing evidence', async t => {
  const { add, collector, service } = setup(t); add('a', 0, 10); add('b', 5, 20); add('c', 10, 5);
  const result = await service.spatial(params());
  assert.equal(result.reportedEvents, 1); assert.equal(result.cells.length, 1);
  assert.equal(result.cells[0].peakCustomers, 20); assert.equal(result.coverage, 10 / 60);
  assert.equal(result.verifiedCaptures, 3); assert.equal(result.unavailableCaptures, 0);
  assert.doesNotMatch(JSON.stringify(result), /OUT_CAUSE|THIS MUST STAY PRIVATE|raw_key|manifest_key/);
  const first = collector.archive.readManifest('manifests/a.json').manifest;
  unlinkSync(collector.archive.path(first.bodies.feed.key));
  service.spatialCache.clear(); // External corruption is discovered after the bounded cache expires.
  const partial = await service.spatial(params());
  assert.equal(partial.verifiedCaptures, 2); assert.equal(partial.unavailableCaptures, 1);
  assert.equal(partial.coverage, 5 / 60); assert.equal(partial.firstVerifiedAt, base + 5 * 60000);
  assert.equal(partial.cells[0].firstSeenAt, base + 5 * 60000);
});
test('historical map route uses the same bounded read-only API and rejects invalid windows', async t => {
  const { add, service, dir } = setup(t); add('a', 0, 10);
  const url = await serve(t, service, dir), query = params(); query.set('view', 'spatial');
  const response = await fetch(`${url}/api/series?${query}`);
  assert.equal(response.status, 200); assert.equal((await response.json()).mappedEvents, 1);
  assert.equal((await fetch(`${url}/api/series?${query}`, { method: 'POST' })).status, 405);
  await assert.rejects(service.spatial(params(base - 32 * DAY, base)), /31 days/);
  await assert.rejects(service.spatial(new URLSearchParams('from=garbage')), /ISO/);
  service.spatialCache.clear();
  const replay = service.spatial(params());
  await assert.rejects(service.spatial(params()), error => error.status === 429);
  await replay;
  assert.equal((await service.spatial(params())).verifiedCaptures, 1);
});
test('per-capita API joins matching Census geometry and population without exposing source cause fields', async t => {
  const { add, service, dir } = setup(t); add('a', 0, 10); add('b', 5, 20);
  const url = await serve(t, service, dir), query = params(); query.set('view', 'spatial'); query.set('geography', 'block-group');
  const geometry = await (await fetch(`${url}/api/config?view=census`)).json();
  assert.equal(geometry.features.length, 685);
  const response = await fetch(`${url}/api/series?${query}`); assert.equal(response.status, 200);
  const data = await response.json(), active = data.cells.filter(c => c.events);
  assert.equal(data.geography, 'block-group'); assert.equal(active.length, 1); assert.equal(active[0].events, 1);
  assert.equal(active[0].peakCustomers, 20);
  assert.equal(active[0].customersPer1000, 20000 / active[0].population);
  assert.ok(geometry.features.some(f => f.id === active[0].id));
  assert.doesNotMatch(JSON.stringify(data), /OUT_CAUSE|THIS MUST STAY PRIVATE/);
  query.set('geography', 'arbitrary'); assert.equal((await fetch(`${url}/api/series?${query}`)).status, 400);
});

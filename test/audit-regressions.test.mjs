import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { LocalCollector } from '../src/durable/collector.mjs';
import { recoverProduction } from '../src/durable/production.mjs';
import { digest } from '../src/durable/archive.mjs';
import { capture } from '../src/pilot-io.mjs';
import { retryDecision } from '../src/durable/scheduling.mjs';
import { DashboardService } from '../src/dashboard/service.mjs';
import { WeatherService } from '../src/dashboard/weather.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';
import { healthIssues, monitoringHeartbeat } from '../src/runtime/health.mjs';
import { validateCollectorConfig } from '../src/durable/config.mjs';
import { fileHash } from '../src/runtime/file-hash.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ordinary.geojson', import.meta.url)));
const base = Date.parse('2026-09-20T00:00:00Z');
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'mlgw-audit-regression-'));
  const staging = join(root, 'staging'); mkdirSync(staging);
  const c = new LocalCollector(join(root, 'collector'));
  t.after(() => { c.close(); rmSync(root, { recursive: true, force: true }); });
  const attempt = (id, minute = 0, count = 10, mutate) => {
    const f = structuredClone(fixture.features[0]); f.properties.CUR_CUST_AFF = count; mutate?.(f);
    const body = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: count === 0 ? [] : [f] }));
    const at = new Date(base + minute * 60000).toISOString();
    writeFileSync(join(staging, `${id}.geojson`), body);
    const record = { id, scheduledAt: at, observedAt: at, feed: { file: `${id}.geojson`, sha256: digest(body), receivedAt: at, status: 200 } };
    writeFileSync(join(staging, `${id}.attempt.json`), JSON.stringify(record));
    return record;
  };
  return { root, staging, c, attempt };
}

test('restart after each cleanup boundary preserves the canonical observation', async t => {
  const s = setup(t);
  for (let boundary = 1; boundary <= 3; boundary++) {
    const r = s.attempt(`partial-${boundary}`, boundary * 5);
    writeFileSync(join(s.staging, `${r.id}.html`), 'redundant');
    writeFileSync(join(s.staging, `${r.id}.normalized.json`), '{}');
    s.c.import(r, s.staging);
    for (const suffix of ['geojson', 'html', 'normalized.json'].slice(0, boundary)) unlinkSync(join(s.staging, `${r.id}.${suffix}`));
    await recoverProduction(s.c, s.staging, 'audit');
    assert.equal(s.c.has(r.id), true);
    assert.equal(existsSync(join(s.staging, `${r.id}.attempt.json`)), false);
  }
});

test('pending manifests replay their archived parser even after a parser deployment', async t => {
  const s = setup(t), r = s.attempt('old-parser');
  const staged = s.c.archive.stage(r, s.staging);
  const parser = readFileSync(new URL('../src/contract.mjs', import.meta.url), 'utf8') + '\n// Prior source revision\n';
  const hash = digest(parser), key = `parsers/prior-${hash}.mjs`;
  s.c.archive.put(key, parser);
  staged.manifest.parserKey = key; staged.manifest.parserHash = hash;
  writeFileSync(s.c.archive.path(staged.key), JSON.stringify(staged.manifest));
  unlinkSync(join(s.staging, `${r.id}.geojson`));
  await recoverProduction(s.c, s.staging, 'audit');
  assert.equal(s.c.db.prepare('SELECT parser_hash FROM snapshots WHERE id=?').get(r.id).parser_hash, hash);
});

test('every arrival order yields identical selected captures, quality and rollups', async t => {
  const s = setup(t), records = [s.attempt('large', 0, 500), s.attempt('same-slot', 1, 50),
    s.attempt('zero-one', 5, 0), s.attempt('zero-two', 10, 0), s.attempt('end', 15, 20)];
  const orders = [records, [...records].reverse(), [records[2], records[4], records[1], records[3], records[0]]];
  let expected;
  const snapshot = c => ({ snapshots: c.db.prepare('SELECT s.id,slot_ms,quality,customers,outages FROM snapshots s JOIN totals t ON t.snapshot_id=s.id ORDER BY slot_ms').all(),
    attempts: c.db.prepare('SELECT id,outcome FROM poll_attempts ORDER BY id').all(), rollups: c.db.prepare('SELECT * FROM rollups ORDER BY resolution,bucket_ms').all() });
  for (let i = 0; i < orders.length; i++) {
    const c = new LocalCollector(join(s.root, `order-${i}`));
    try {
      for (const r of orders[i]) c.import(r, s.staging);
      while (c.maintain()) {}
      const actual = snapshot(c); expected ??= actual; assert.deepEqual(actual, expected);
      if (i === 0) {
        assert.equal(actual.snapshots[0].id, 'large');
        assert.equal(actual.snapshots[1].quality, 'quarantined');
        assert.equal(actual.snapshots[2].quality, 'valid');
      }
      const restored = new LocalCollector(join(s.root, `restored-${i}`), { archive: c.archive });
      try { await restored.recover(); while (restored.maintain()) {} assert.deepEqual(snapshot(restored), expected); }
      finally { restored.close(); }
    } finally { c.close(); }
  }
});

test('stream failures retain restriction and backoff headers and prevent a second source request', async t => {
  const s = setup(t);
  for (const status of [403, 429, 200]) {
    let calls = 0;
    const record = await capture(base, { dir: pathToFileURL(s.staging + '/'), diagnostics: false, fetchImpl: async () => {
      calls++; return new Response(new ReadableStream({ start(controller) { controller.error(Error('stream interrupted')); } }),
        { status, headers: { 'retry-after': '3600' } });
    } });
    assert.equal(record.feed.status, status); assert.equal(record.feed.bodyComplete, false);
    const decision = retryDecision(record, 0);
    assert.equal(decision.action, status === 403 ? 'stop' : status === 429 ? 'backoff' : 'retry');
    if (status !== 200) assert.equal(calls, 1);
    if (status === 429) assert.ok(decision.until >= Date.now() + 3599000);
    assert.equal(record.feed.file, undefined);
  }
});

test('additive fields and unusable geometry preserve count validity and expose warnings', async t => {
  const s = setup(t), r = s.attempt('warning', 0, 10, f => { f.properties.NEW_FIELD = 'value'; f.geometry = null; });
  assert.equal(s.c.import(r, s.staging).status, 'valid');
  const service = new DashboardService(s.c.root);
  try { const data = await service.snapshot(r.id); assert.equal(data.summary.customers, 10);
    assert.equal(data.detail.unmapped, 1); assert.ok(data.warnings.includes('unknown_property')); }
  finally { service.close(); }
});

test('unknown and old database schemas fail before changing their version', t => {
  const s = setup(t);
  for (const version of [1, 99]) {
    const root = join(s.root, `schema-${version}`); mkdirSync(root);
    const db = new DatabaseSync(join(root, 'index.sqlite')); db.exec(`PRAGMA user_version=${version}`); db.close();
    assert.throws(() => new LocalCollector(root), /Unsupported collector schema/);
    const check = new DatabaseSync(join(root, 'index.sqlite')); assert.equal(check.prepare('PRAGMA user_version').get().user_version, version); check.close();
  }
});

test('rolling weather remains available without a saved study catalog', t => {
  const s = setup(t), rolling = join(s.root, 'rolling'); mkdirSync(join(rolling, 'published'), { recursive: true });
  writeFileSync(join(rolling, 'published/catalog.json'), JSON.stringify({ version: 1, entries: [
    { product: 'radar', identity: 'live', sha256: 'a'.repeat(64), validAt: new Date(base).toISOString() }] }));
  const entries = new WeatherService(join(s.root, 'absent'), { rollingRoot: rolling }).catalog().entries;
  assert.equal(entries.length, 1); assert.equal(entries[0].rolling, true);
});

test('public client quotas isolate visitors and cannot consume private health checks', async t => {
  const server = createDashboardServer({ health: () => ({ status: 'stale' }) }, {
    staticRoot: '.', publicOrigin: 'https://outages.example', requestLimit: 2, trustLoopbackProxy: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const request = (path, ip) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path,
      headers: { host: 'outages.example', 'x-forwarded-for': ip } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(await request('/api/config', '192.0.2.1'), 200);
  assert.equal(await request('/api/config', '192.0.2.1'), 200);
  assert.equal(await request('/api/config', '192.0.2.1'), 429);
  assert.equal(await request('/api/config', '192.0.2.2'), 200);
  assert.equal(await request('/api/health', '192.0.2.1'), 200);
  assert.equal(await request('/api/ready', '192.0.2.1'), 503);
});

test('spatial cache is bounded, expires, invalidates on collector writes, and honors aborts', async t => {
  const s = setup(t); s.c.import(s.attempt('a'), s.staging);
  let now = base + 3600000;
  const service = new DashboardService(s.c.root, { now: () => now });
  try {
    const params = new URLSearchParams({ from: new Date(base).toISOString(), to: new Date(now).toISOString(), resolution: 'daily' });
    let reads = 0; const read = service.mapDetail.bind(service); service.mapDetail = row => { reads++; return read(row); };
    await service.spatial(params); await service.spatial(params); assert.equal(reads, 1);
    now += 31000; await service.spatial(params); assert.equal(reads, 2);
    s.c.import(s.attempt('b', 5), s.staging); assert.equal((await service.spatial(params)).captures, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.spatial(params, { signal: controller.signal }), { name: 'AbortError' });
  } finally { service.close(); }
});

test('health tolerates a bounded running weather job and flags stale backups', async () => {
  const now = base + 300000, state = { heartbeatAt: new Date(base).toISOString(), status: 'ok', lastRun: { at: new Date(base).toISOString() } };
  const args = { now, dashboard: { status: 'ok' }, collector: { ...state, heartbeatAt: new Date(now).toISOString() },
    weather: { ...state, phase: 'refreshing', runStartedAt: new Date(base).toISOString() },
    backup: { verified: true, downloadedAt: new Date(base).toISOString() }, freeBytes: 100, minimumFreeBytes: 10 };
  assert.deepEqual(healthIssues(args), []);
  assert.match(healthIssues({ ...args, backup: null }).join(), /backup/);
  assert.match(healthIssues({ ...args, now: now + 120000 }).join(), /weather heartbeat/);
  assert.deepEqual(await monitoringHeartbeat(undefined), { configured: false });
  await assert.rejects(monitoringHeartbeat('https://example.invalid/private-secret', { fetchImpl: async () => { throw Error('private-secret'); } }),
    error => error.message === 'External monitoring heartbeat failed');
});

test('configuration rejects unsupported settings and checksums use bounded reads', t => {
  const s = setup(t), config = JSON.parse(readFileSync(new URL('../config/collector.production.json', import.meta.url)));
  assert.equal(validateCollectorConfig(config, 'production'), config);
  assert.throws(() => validateCollectorConfig({ ...config, pollIntervalMs: 60000 }, 'production'));
  assert.throws(() => validateCollectorConfig({ ...config, typo: true }, 'production'));
  const path = join(s.root, 'large.bin'), bytes = Buffer.alloc(4 * 1024 * 1024 + 37, 4); writeFileSync(path, bytes);
  assert.deepEqual(fileHash(path), { sha256: digest(bytes), bytes: bytes.length });
});

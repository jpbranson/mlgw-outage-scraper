import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { LocalCollector } from '../src/durable/collector.mjs';
import { digest } from '../src/durable/archive.mjs';
import { productionStep, recoverProduction, finishStagedAttempt } from '../src/durable/production.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';
import { processLock } from '../src/runtime/process-lock.mjs';

const fixture = readFileSync(new URL('./fixtures/ordinary.geojson', import.meta.url));
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'mlgw-production-')), staging = join(root, 'staging'); mkdirSync(staging);
  const collector = new LocalCollector(root); t.after(() => collector.close());
  const current = Date.now(), at = Math.floor(current / 300000) * 300000, state = {}, owner = 'test-owner';
  const config = { staging, localBudgetBytes: 1e9, minimumFreeDiskBytes: 0, warningFraction: .7, offloadFraction: .8, urgentFraction: .9 };
  let calls = 0, persisted;
  const capture = async () => {
    calls++; const id = `attempt-${calls}`, timestamp = new Date(at).toISOString();
    writeFileSync(join(staging, `${id}.geojson`), fixture);
    const record = { id, scheduledAt: timestamp, observedAt: timestamp,
      feed: { file: `${id}.geojson`, sha256: digest(fixture), status: 200, receivedAt: timestamp } };
    writeFileSync(join(staging, `${id}.attempt.json`), JSON.stringify(record));
    return record;
  };
  return { root, collector, staging, state, owner, config, capture, now: () => current,
    persist: async s => { persisted = structuredClone(s); }, calls: () => calls, persisted: () => persisted };
}
test('production collects once per slot and skips missed slots without inventing history', async t => {
  const s = setup(t); s.state.nextDueAt = '2020-01-01T00:00:00Z';
  assert.equal((await productionStep(s)).action, 'captured');
  assert.equal((await productionStep(s)).action, 'waiting');
  assert.equal(s.calls(), 1); assert.equal(s.collector.health().snapshots, 1);
  assert.equal(s.persisted().lastCaptureAt, new Date(Math.floor(s.now() / 300000) * 300000).toISOString());
});
test('production respects leases, backoff and terminal storage stops', async t => {
  const s = setup(t); s.collector.acquireLease('another-owner', s.now());
  assert.equal((await productionStep(s)).action, 'lease_busy');
  s.collector.releaseLease('another-owner'); s.state.retryAt = new Date(s.now() + 600000).toISOString();
  assert.equal((await productionStep(s)).action, 'waiting'); assert.equal(s.calls(), 0);
  s.config.localBudgetBytes = 1;
  assert.equal((await productionStep(s)).action, 'stopped'); assert.equal(s.persisted().stopReason, 'storage_pressure');
  assert.equal(s.calls(), 0);
});
test('source restriction persists and prevents new requests after restart', async t => {
  const s = setup(t), capture = s.capture;
  s.capture = async () => { const record = await capture(); record.feed.status = 403; record.stopReason = 'Source access restricted (403)'; return record; };
  assert.equal((await productionStep(s)).action, 'stopped');
  s.state = structuredClone(s.persisted()); assert.equal((await productionStep(s)).action, 'stopped');
  assert.equal(s.calls(), 1);
});
test('interrupted staging restores backoff and retains exact archived originals before cleanup', async t => {
  const s = setup(t), record = await s.capture(); record.feed.status = 429;
  record.retryAt = new Date(s.now() + 3600000).toISOString();
  writeFileSync(join(s.staging, `${record.id}.attempt.json`), JSON.stringify(record));
  s.collector.acquireLease(s.owner);
  const result = await recoverProduction(s.collector, s.staging, s.owner, s.now);
  assert.equal(result.decision.action, 'backoff'); assert.equal(result.decision.until, Date.parse(record.retryAt));
  assert.equal(existsSync(join(s.staging, `${record.id}.geojson`)), false);
  const { manifest } = s.collector.archive.readManifest(`manifests/${record.id}.json`);
  assert.deepEqual(s.collector.archive.readBody(manifest.bodies.feed), fixture);
});
test('staging is preserved if the canonical archive is corrupt', async t => {
  const s = setup(t), record = await s.capture(); s.collector.import(record, s.staging);
  const { manifest } = s.collector.archive.readManifest(`manifests/${record.id}.json`);
  writeFileSync(s.collector.archive.path(manifest.bodies.feed.key), 'corrupt');
  assert.throws(() => finishStagedAttempt(s.collector, s.staging, record));
  assert.equal(existsSync(join(s.staging, `${record.id}.geojson`)), true);
});
test('production recovers a pending capture matching an archive from another OS', async t => {
  const s = setup(t), record = await s.capture(), stored = gzipSync(fixture, { level: 6 });
  stored[9] = stored[9] === 10 ? 3 : 10;
  const key = `objects/${digest(fixture)}.gz`;
  s.collector.archive.put(key, stored);
  s.collector.acquireLease(s.owner);
  const result = await recoverProduction(s.collector, s.staging, s.owner, s.now);
  assert.equal(result.record.id, record.id);
  assert.equal(s.collector.health().latest.id, record.id);
  assert.equal(existsSync(join(s.staging, `${record.id}.attempt.json`)), false);
  assert.equal(existsSync(join(s.staging, `${record.id}.geojson`)), false);
  const { manifest } = s.collector.archive.readManifest(`manifests/${record.id}.json`);
  assert.deepEqual(s.collector.archive.readBody(manifest.bodies.feed), fixture);
  assert.deepEqual(readFileSync(s.collector.archive.path(key)), stored);
  assert.equal((await productionStep(s)).action, 'waiting');
  assert.equal(s.calls(), 1);
});
test('production locks refuse a live owner and release cleanly', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'mlgw-lock-')), 'runner.lock'), unlock = processLock(path);
  try { assert.throws(() => processLock(path), /already active/); } finally { unlock(); }
  assert.equal(existsSync(path), false);
});
test('public dashboard accepts only the configured host/origin and keeps archive/write routes closed', async t => {
  const server = createDashboardServer({ health: () => ({ status: 'ok' }) }, { staticRoot: '.', publicOrigin: 'https://outages.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, { host = 'outages.example', origin, method = 'GET' } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { Host: host, ...(origin ? { Origin: origin } : {}) } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(await send('/api/health', { origin: 'https://outages.example' }), 200);
  assert.equal(await send('/api/health', { origin: 'http://outages.example' }), 403);
  assert.equal(await send('/api/health', { host: 'attacker.example' }), 403);
  assert.equal(await send('/api/health', { method: 'POST' }), 405);
  assert.equal(await send('/data/collector/index.sqlite'), 404);
});

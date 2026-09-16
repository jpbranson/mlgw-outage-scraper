import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCollector } from '../src/durable/collector.mjs';
import { digest } from '../src/durable/archive.mjs';
import { collectWithRetries, retryDecision, pilotMode } from '../src/durable/scheduling.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ordinary.geojson', import.meta.url), 'utf8'));
function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlgw-durable-'));
  const collector = new LocalCollector(join(dir, 'collector'), options);
  t.after(() => collector.close());
  return { dir, collector };
}
function attempt(dir, id, at, { count = 10, status = 200, htmlCount, body, scheduledAt = at } = {}) {
  if (body === undefined) {
    const f = structuredClone(fixture.features[0]); f.properties.CUR_CUST_AFF = count;
    body = JSON.stringify({ type: 'FeatureCollection', features: count === 0 ? [] : [f] });
  }
  writeFileSync(join(dir, `${id}.geojson`), body);
  const record = { id, scheduledAt, observedAt: at, feed: { status, receivedAt: at, requestedAt: at, file: `${id}.geojson`, sha256: digest(body), bytes: Buffer.byteLength(body) } };
  if (htmlCount !== undefined) {
    const html = `<p>Customers Without Power</p><p>${htmlCount}</p>`; writeFileSync(join(dir, `${id}.html`), html);
    record.html = { status: 200, receivedAt: at, file: `${id}.html`, sha256: digest(html) };
  }
  return record;
}
const at = (hm, day = '2026-09-15') => `${day}T${hm}:00.000Z`;
const count = (c, table) => c.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const drain = c => { while (c.maintain()) { /* bounded batches */ } };

test('durable archive round-trips and repeated attempts/slots do not double count', async t => {
  const { dir, collector: c } = setup(t);
  const first = attempt(dir, 'a', at('10:00'));
  assert.equal(c.import(first, dir).status, 'valid');
  assert.equal(c.import(first, dir).status, 'already_indexed');
  assert.equal(c.import(attempt(dir, 'b', at('10:01')), dir).status, 'duplicate_slot');
  assert.equal(count(c, 'poll_attempts'), 2); assert.equal(count(c, 'snapshots'), 1);
  assert.equal((await c.replaySnapshot('a')).totals.customers, 10);
  assert.equal(readdirSync(join(c.archive.root, 'objects')).length, 1);
});
test('failed archive write cannot create a database snapshot', t => {
  const { dir, collector: c } = setup(t);
  c.archive.put = () => { throw new Error('simulated disk write failure'); };
  assert.throws(() => c.import(attempt(dir, 'a', at('10:00')), dir), /disk write/);
  assert.equal(count(c, 'poll_attempts'), 0); assert.equal(count(c, 'snapshots'), 0);
});
test('failed DB commit leaves recoverable immutable evidence and rolls back all rows', async t => {
  let fail = true;
  const { dir, collector: c } = setup(t, { beforeCommit: () => { if (fail) throw new Error('simulated commit failure'); } });
  assert.throws(() => c.import(attempt(dir, 'a', at('10:00')), dir), /commit failure/);
  assert.equal(count(c, 'poll_attempts'), 0); assert.equal(count(c, 'snapshots'), 0);
  assert.equal(c.archive.manifests().length, 1);
  fail = false;
  assert.equal((await c.recover())[0].status, 'valid');
  assert.equal((await c.recover())[0].status, 'already_indexed');
  assert.equal(count(c, 'snapshots'), 1);
});
test('a fresh database can rebuild entirely from compressed archive and pinned parser', async t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00')), dir); c.import(attempt(dir, 'b', at('10:05'), { count: 30 }), dir);
  const restored = new LocalCollector(join(dir, 'restored'), { archive: c.archive }); t.after(() => restored.close());
  await restored.recover(); drain(restored);
  assert.equal(restored.health(Date.parse(at('10:05'))).latest.customers, 30);
  assert.equal((await restored.replaySnapshot('a')).totals.customers, 10);
  assert.equal(restored.db.prepare("SELECT covered_minutes FROM rollups WHERE resolution='daily' AND bucket_ms=?").get(Date.parse(at('00:00'))).covered_minutes, 5);
});
test('body/parser tampering is detected before replay', async t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00')), dir);
  const { manifest: m } = c.archive.readManifest('manifests/a.json');
  writeFileSync(c.archive.path(m.bodies.feed.key), 'corrupt');
  await assert.rejects(c.replaySnapshot('a'));
  writeFileSync(c.archive.path(m.parserKey), '// corrupt parser');
  await assert.rejects(c.archive.parser(m), /parser checksum/);
});
test('changed evidence cannot reuse an attempt ID or escape the capture directory', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00')), dir);
  assert.throws(() => c.import(attempt(dir, 'a', at('10:00'), { count: 20 }), dir), /conflict/);
  const r = attempt(dir, 'b', at('10:05')); r.feed.file = '../outside';
  assert.throws(() => c.import(r, dir), /Unsafe/);
  assert.equal(count(c, 'snapshots'), 1);
});
test('invalid payloads and HTTP failures remain attempts and never become zero outages', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00'), { body: 'broken' }), dir);
  c.import(attempt(dir, 'b', at('10:05'), { status: 503 }), dir);
  assert.equal(count(c, 'poll_attempts'), 2); assert.equal(count(c, 'snapshots'), 0);
  assert.equal(c.health().latest, null); assert.equal(c.health().status, 'stale');
});
test('late captures repair rollups without moving latest backward or pretending to backfill', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'new', at('10:05'), { count: 20, scheduledAt: at('09:55') }), dir);
  c.import(attempt(dir, 'old', at('10:00'), { count: 10 }), dir); drain(c);
  assert.equal(c.health(Date.parse(at('10:06'))).latest.id, 'new');
  assert.equal(c.db.prepare('SELECT slot_ms FROM snapshots WHERE id=?').get('new').slot_ms, Date.parse(at('10:05')));
  const r = c.db.prepare("SELECT * FROM rollups WHERE resolution='hourly' AND bucket_ms=?").get(Date.parse(at('10:00')));
  assert.equal(r.covered_minutes, 5); assert.equal(r.customer_minutes, 50); assert.equal(r.peak_customers, 20);
});
test('integration splits across hour and day boundaries and stops at last observation', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('23:58', '2026-09-14'), { count: 10 }), dir);
  c.import(attempt(dir, 'b', at('00:03'), { count: 20 }), dir); drain(c);
  const days = c.db.prepare("SELECT * FROM rollups WHERE resolution='daily' AND covered_minutes>0 ORDER BY bucket_ms").all();
  assert.equal(days.length, 2);
  assert.deepEqual(days.map(r => r.covered_minutes), [2, 3]); assert.deepEqual(days.map(r => r.customer_minutes), [20, 30]);
  assert.equal(days[1].peak_customers, 20);
});
test('long gaps and failed observations between valid captures contribute unknown time', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00')), dir);
  c.import(attempt(dir, 'failure', at('10:02'), { status: 503 }), dir);
  c.import(attempt(dir, 'b', at('10:05')), dir);
  c.import(attempt(dir, 'c', at('10:20')), dir); drain(c);
  const day = c.db.prepare("SELECT * FROM rollups WHERE resolution='daily' AND bucket_ms=?").get(Date.parse(at('00:00')));
  assert.equal(day.covered_minutes, 0); assert.equal(day.mean_customers, null);
  assert.equal(c.health(Date.parse(at('10:21'))).change, null);
});
test('suspicious zero is held, then a subsequent zero confirms recovery', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00'), { count: 500 }), dir);
  assert.equal(c.import(attempt(dir, 'b', at('10:05'), { count: 0 }), dir).status, 'quarantined');
  assert.equal(c.health(Date.parse(at('10:06'))).latest.customers, 500);
  assert.equal(c.import(attempt(dir, 'c', at('10:10'), { count: 0 }), dir).status, 'valid');
  assert.equal(c.health(Date.parse(at('10:10'))).latest.customers, 0);
});
test('HTML zero confirms zero; mismatch is review and a valid retry can replace suspect slot', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00'), { count: 500 }), dir);
  assert.equal(c.import(attempt(dir, 'bad', at('10:05'), { count: 0, htmlCount: 500 }), dir).status, 'review');
  assert.equal(c.import(attempt(dir, 'good', at('10:06'), { count: 0, htmlCount: 0 }), dir).status, 'valid');
  assert.equal(c.health(Date.parse(at('10:06'))).latest.id, 'good');
  assert.equal(count(c, 'poll_attempts'), 3); assert.equal(count(c, 'snapshots'), 2);
});
test('leases exclude other owners, can expire, and fence a delayed publication', t => {
  const { dir, collector: c } = setup(t);
  const second = new LocalCollector(c.root); t.after(() => second.close());
  const now = Date.now();
  assert.equal(c.acquireLease('one', now, 100), true);
  assert.equal(second.acquireLease('two', now + 50), false);
  assert.equal(second.acquireLease('two', now + 101), true);
  assert.throws(() => c.import(attempt(dir, 'a', at('10:00')), dir, { leaseOwner: 'one' }), /lease expired/);
  assert.equal(count(c, 'snapshots'), 0);
});
test('freshness distinguishes retrieval from valid state and does not invent source time', t => {
  const { dir, collector: c } = setup(t);
  c.import(attempt(dir, 'a', at('10:00')), dir);
  assert.equal(c.health(Date.parse(at('10:09'))).status, 'ok');
  assert.equal(c.health(Date.parse(at('10:11'))).status, 'warning');
  assert.equal(c.health(Date.parse(at('10:15'))).status, 'stale');
  c.import(attempt(dir, 'b', at('10:20'), { body: 'broken' }), dir);
  const h = c.health(Date.parse(at('10:20')));
  assert.equal(h.lastSuccessfulRetrievalAt, at('10:20')); assert.equal(h.latest.capturedAt, at('10:00')); assert.equal(h.sourceUpdatedAt, null);
});
test('retry policy is bounded and honors restriction and host-wide Retry-After', async () => {
  let calls = 0, published = 0, waited = 0;
  const result = await collectWithRetries({ slot: 0, capture: async () => { calls++; return { feed: { status: 503 } }; },
    publish: async () => { published++; }, sleepImpl: async () => { waited++; }, random: () => 0 });
  assert.equal(calls, 3); assert.equal(published, 3); assert.equal(waited, 2); assert.equal(result.attempts, 3);
  assert.equal(retryDecision({ feed: { status: 403 } }, 0).action, 'stop');
  assert.equal(retryDecision({ feed: { status: 200 }, html: { status: 429 }, retryAt: at('11:00') }, 0, Date.parse(at('10:00'))).until, Date.parse(at('11:00')));
  assert.equal(retryDecision({ feed: { status: 200, error: 'bad JSON' } }, 0).action, 'next_slot');
});
test('existing pilot owns source traffic until its window ends; backoff survives handoff', () => {
  const pilot = { endsAt: at('11:00') };
  assert.equal(pilotMode(pilot, Date.parse(at('10:00'))).mode, 'mirror');
  assert.equal(pilotMode(pilot, Date.parse(at('11:06'))).mode, 'capture');
  assert.equal(pilotMode({ ...pilot, retryAt: at('12:00') }, Date.parse(at('11:06'))).mode, 'backoff');
  assert.equal(pilotMode({ ...pilot, stopReason: 'Restricted' }).mode, 'stop');
});
test('pressure telemetry never enables automatic deletion', t => {
  const { collector: c } = setup(t);
  const before = readdirSync(c.root);
  const h = c.storage({ localBudgetBytes: 1, minimumFreeDiskBytes: 0, urgentFraction: .9, offloadFraction: .8, warningFraction: .7 });
  assert.equal(h.pressure, 'urgent'); assert.equal(h.cleanupEnabled, false); assert.equal(h.detailDeleted, false);
  assert.deepEqual(readdirSync(c.root), before);
});
test('event-key comparison cache is bounded while older raw detail remains replayable', async t => {
  const { dir, collector: c } = setup(t);
  for (let i = 0; i < 6; i++) c.import(attempt(dir, `a${i}`, at(`10:${String(i * 5).padStart(2, '0')}`)), dir);
  assert.equal(c.db.prepare("SELECT COUNT(*) n FROM snapshots WHERE event_keys_json<>'null'").get().n, 2);
  assert.equal((await c.replaySnapshot('a0')).featureCount, 1);
  assert.equal(c.health(Date.parse(at('10:26'))).validSlotCoverage, 1);
});

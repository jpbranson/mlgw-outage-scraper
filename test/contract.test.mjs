import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEED_URL, parseSourceTime, parseFeed, meaningfulState, parseHtmlSummary } from '../src/contract.mjs';
import { fetchBounded, retryAfterMs, capture, writeJsonAtomic } from '../src/pilot-io.mjs';
import { storageModel, makeStressFeed } from '../src/stress.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/ordinary.geojson', import.meta.url), 'utf8'));
const single = () => ({ type: 'FeatureCollection', features: [structuredClone(fixture.features[0])] });

test('empty is valid zero; malformed and wrong envelope fail', () => {
  assert.deepEqual(parseFeed('{"type":"FeatureCollection","features":[]}').totals, { reportedOutages: 0, customers: 0 });
  for (const body of ['not json', '{}', '{"type":"FeatureCollection","features":{}}']) assert.throws(() => parseFeed(body));
});
test('Central time handles daylight, standard, fall ambiguity, spring gap and invalid dates', () => {
  assert.equal(parseSourceTime('09/16/2026 10:18:45 AM').utc, '2026-09-16T15:18:45.000Z');
  assert.equal(parseSourceTime('01/16/2026 10:18:45 AM').utc, '2026-01-16T16:18:45.000Z');
  assert.equal(parseSourceTime('11/01/2026 01:30:00 AM').candidates.length, 2);
  assert.equal(parseSourceTime('11/01/2026 01:30:00 AM').utc, null);
  for (const time of ['03/08/2026 02:30:00 AM', '02/30/2026 01:00:00 PM', '09/16/2026 00:00:00 AM', 'garbage']) assert.equal(parseSourceTime(time).status, 'invalid');
  assert.equal(parseSourceTime('').status, 'missing');
});
test('duplicate and unsafe IDs invalidate totals; invalid counts never become zero', () => {
  const dup = single(); dup.features.push(structuredClone(dup.features[0]));
  assert.equal(parseFeed(JSON.stringify(dup)).totals.customers, null);
  for (const count of [-1, 1.1, '', '10', null, Number.MAX_SAFE_INTEGER + 1]) {
    const feed = single(); feed.features[0].properties.CUR_CUST_AFF = count;
    assert.equal(parseFeed(JSON.stringify(feed)).totals.customers, null);
  }
  const feed = single(); feed.features[0].properties.OUTAGE_NO = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(parseFeed(JSON.stringify(feed)).totalsValid, false);
});
test('geometry failures and unknown fields are flagged without discarding customer counts', () => {
  const feed = single(); feed.features[0].geometry.coordinates = [500, 35]; feed.features[0].properties.NEW_FIELD = 'x';
  const parsed = parseFeed(JSON.stringify(feed));
  assert.equal(parsed.totals.customers, fixture.features[0].properties.CUR_CUST_AFF);
  assert.equal(parsed.normalized.features[0].geometry, null);
  assert.ok(parsed.issues.some(i => i.code === 'unknown_property'));
  feed.features[0].geometry.coordinates = [0, 0];
  assert.ok(parseFeed(JSON.stringify(feed)).issues.some(i => i.code === 'outside_review_bounds'));
});
test('missing fields and null features are explicit', () => {
  const feed = single(); delete feed.features[0].properties.TIME_STAMP;
  assert.ok(parseFeed(JSON.stringify(feed)).issues.some(i => i.code === 'start_missing'));
  feed.features.push(null); assert.equal(parseFeed(JSON.stringify(feed)).totalsValid, false);
});
test('semantic comparison ignores duration, sequence ID, and order, retains real changes', () => {
  const a = structuredClone(fixture), b = structuredClone(fixture);
  b.features.reverse(); b.features[0].id = 900; b.features[0].properties.DURATION = '99 Mins';
  assert.equal(meaningfulState(JSON.stringify(a)), meaningfulState(JSON.stringify(b)));
  b.features[0].properties.CUR_CUST_AFF++;
  assert.notEqual(meaningfulState(JSON.stringify(a)), meaningfulState(JSON.stringify(b)));
});
test('HTML desktop/mobile agreement, disagreement, and no total', () => {
  const html = '<p>Customers Without Power</p><p>278</p> CURRENT AS  OF 09/16/2026 11:30 AM <p>Customers<br>Without Power</p><p>278</p>';
  assert.equal(parseHtmlSummary(html).customers, 278);
  assert.equal(parseHtmlSummary(html).currentAsOf, '09/16/2026 11:30 AM');
  assert.equal(parseHtmlSummary('<p>Customers Without Power</p><p>0</p>').customers, 0);
  assert.equal(parseHtmlSummary('Customers Without Power 1 Customers Without Power 2').customers, null);
  assert.equal(parseHtmlSummary('<h1>Error</h1>').customers, null);
});
test('size ceiling and endpoint allowlist are enforced', async () => {
  await assert.rejects(fetchBounded(FEED_URL, { maxBytes: 3, fetchImpl: async () => new Response('1234') }), /exceeds/);
  await assert.rejects(fetchBounded('https://example.com'), /allowlisted/);
});
test('Retry-After supports seconds and HTTP dates', () => {
  assert.equal(retryAfterMs('900'), 900000);
  assert.equal(retryAfterMs('Wed, 16 Sep 2026 18:00:00 GMT', Date.parse('2026-09-16T17:00:00Z')), 3600000);
  assert.equal(retryAfterMs('bad'), 0);
});
test('429 prevents second request and persists raw response without zero totals', async () => {
  const dir = pathToFileURL((await mkdtemp(join(tmpdir(), 'mlgw-pilot-test-'))) + '/');
  let calls = 0;
  const record = await capture(Date.now(), { dir, fetchImpl: async () => { calls++; return new Response('limited', { status: 429, headers: { 'retry-after': '900' } }); } });
  assert.equal(calls, 1); assert.equal(record.totals, null); assert.ok(Date.parse(record.retryAt) > Date.now() + 800000);
  assert.ok((await readdir(dir)).some(n => n.endsWith('.geojson')));
});
test('malformed body is archived and error is retained', async () => {
  const dir = pathToFileURL((await mkdtemp(join(tmpdir(), 'mlgw-pilot-test-'))) + '/');
  const record = await capture(Date.now(), { dir, fetchImpl: async () => new Response('broken') });
  assert.equal(record.totals, null); assert.ok(record.feed.error);
  assert.equal(await readFile(new URL(record.feed.file, dir), 'utf8'), 'broken');
});
test('checkpoint replacement is readable and leaves no temporary file', async () => {
  const dir = pathToFileURL((await mkdtemp(join(tmpdir(), 'mlgw-pilot-test-'))) + '/');
  const path = new URL('state.json', dir);
  await writeJsonAtomic(path, { attempts: 1 });
  await writeJsonAtomic(path, { attempts: 2 });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { attempts: 2 });
  assert.deepEqual(await readdir(dir), ['state.json']);
});
test('stress inputs have distinct IDs; annual and offline allowances are additive', () => {
  const feed = makeStressFeed(fixture, 4000);
  assert.equal(new Set(feed.features.map(f => f.properties.OUTAGE_NO)).size, 4000);
  const model = storageModel(1000, 10000, 5);
  assert.equal(model.protectedYear, (358 * 1000 + 7 * 10000) * 288);
  assert.equal(model.totalBytes, model.protectedYear + 44 * 10000 * 288);
});

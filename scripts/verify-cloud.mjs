import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const base = process.argv[2]; if (!base || !/^https?:\/\//.test(base)) throw Error('Pass the deployed dashboard origin');
const requests = [];
async function get(path, { status = 200, json = true, ...options } = {}) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000), ...options });
  assert.equal(response.status, status, `${path}: ${response.status}`); requests.push({ path, status });
  if (status !== 200) { await response.text(); return; }
  return json ? response.json() : response.text();
}
for (const path of ['/', '/legacy.html', '/legacy.html?view=comparisons', '/app.js', '/legacy.js', '/app.css']) await get(path, { json: false });
const health = await get('/api/health'), latest = await get('/api/latest');
assert.equal(health.localOnly, false); assert.equal(latest.summary.id, health.latest.id);
assert.equal(latest.summary.customers, health.latest.customers);
await get(`/api/snapshot/${encodeURIComponent(health.latest.id)}`);
const to = health.latest.capturedAt, from = new Date(Date.parse(to) - 24 * 3600000).toISOString();
const period = new URLSearchParams({ from, to, resolution: 'hourly' });
await get(`/api/series?${period}`); await get(`/api/series?${period}&view=spatial`);
await get(`/api/series?${period}&view=spatial&geography=block-group`);
await get('/api/config?view=census'); await get(`/api/export.csv?${period}`, { json: false });
const legacy = await get('/api/legacy/catalog'), cases = await get('/api/legacy/catalog?view=comparisons');
assert.equal(cases.entries.length, 4);
for (const item of cases.entries) {
  await get(`/api/legacy/series?view=comparisons&id=${item.id}&lag=0`);
  await get(`/api/legacy/export.csv?view=comparisons&id=${item.id}&lag=0`, { json: false });
}
await get(`/api/weather?at=${encodeURIComponent(to)}`); await get('/api/weather/periods');
await get('/data/collector/index.sqlite', { status: 404 }); await get('/api/admin', { status: 404 });
await get('/api/latest', { status: 405, method: 'POST' }); await get('/api/latest', { status: 403, headers: { Origin: 'https://foreign.example' } });
const report = { checkedAt: new Date().toISOString(), base, passed: true, health, comparisonCases: cases.entries.map(e => e.id), legacyAvailable: !!legacy, requests };
writeFileSync('reports/cloud-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checkedAt: report.checkedAt, base, passed: true, checks: requests.length, latest: health.latest, freshness: health.status, comparisonCases: report.comparisonCases }));

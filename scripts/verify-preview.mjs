import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const state = JSON.parse(readFileSync('data/remote-preview/state.json', 'utf8'));
const { password } = JSON.parse(readFileSync('data/remote-preview/credentials.json', 'utf8'));
const origin = state.url;
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin ?? '')) throw new Error('No recognized active preview URL');
const get = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options });
const checks = [];
const root = await get('/'); assert.equal(root.status, 200); assert.match(await root.text(), /Preview password/); checks.push('password_form');
for (const path of ['/api/latest', '/api/health', '/app.js', '/legacy.js', '/legacy.css', '/api/legacy/catalog', '/api/legacy/export.csv', '/api/legacy/catalog?view=comparisons', '/api/legacy/series?view=comparison&id=june-2023', '/api/export.csv', '/api/weather/periods', '/api/weather/period?id=' + 'a'.repeat(64), '/api/weather/image/' + 'a'.repeat(64)]) {
  const response = await get(path); assert.equal(response.status, 401); assert.match(response.headers.get('cache-control'), /no-store/);
}
checks.push('anonymous_data_and_assets_blocked');
const signIn = await get('/preview/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password }), redirect: 'manual' });
assert.equal(signIn.status, 303);
const setCookie = signIn.headers.get('set-cookie'); assert.match(setCookie, /Secure; HttpOnly; SameSite=Lax/);
const headers = { Cookie: setCookie.split(';')[0] };
const result = await get('/api/latest', { headers }); assert.equal(result.status, 200);
const latest = await result.json(); assert.equal(latest.detail.available, true);
assert.equal(latest.summary.customers, latest.detail.geojson.features.reduce((n, f) => n + f.properties.customers, 0));
assert.equal((await get('/data/collector/index.sqlite', { headers })).status, 404);
assert.equal((await get('/api/admin', { headers })).status, 404);
assert.equal((await get('/api/latest', { headers, method: 'POST' })).status, 405);
checks.push('authenticated_capture_matches_geometry', 'archive_admin_and_writes_blocked');
const dashboard = await get('/', { headers }); assert.equal(dashboard.status, 200);
assert.match(await dashboard.text(), /Rainfall/);
const periodList = await get('/api/weather/periods', { headers }); assert.equal(periodList.status, 200);
const { periods } = await periodList.json();
const localPeriods = await (await fetch('http://127.0.0.1:4173/api/weather/periods')).json();
assert.deepEqual(periods.map(p => p.id).sort(), localPeriods.periods.map(p => p.id).sort());
assert.deepEqual([...new Set(periods.map(period => period.hours))].sort((a, b) => a - b), [24, 48, 72]);
for (const period of periods) {
  assert.match(period.id, /^[a-f0-9]{64}$/);
  const response = await get('/api/weather/period?id=' + period.id, { headers }); assert.equal(response.status, 200);
  const detail = await response.json(); assert.equal(detail.hours, period.hours);
  assert.equal(detail.values.length, detail.grid.width * detail.grid.height);
  assert.equal(detail.imageUrl, '/api/weather/image/' + period.id);
  const png = await get(detail.imageUrl, { headers }); assert.equal(png.status, 200);
  assert.match(png.headers.get('content-type'), /^image\/png/);
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
}
checks.push('rainfall_dashboard_and_24_48_72_hour_data_and_images');
const legacyPage = await get('/legacy.html', { headers }); assert.equal(legacyPage.status, 200); assert.match(await legacyPage.text(), /Legacy archive/);
for (const path of ['/legacy.js', '/legacy.css']) assert.equal((await get(path, { headers })).status, 200);
const legacyCatalog = await (await get('/api/legacy/catalog', { headers })).json();
const localCatalog = await (await fetch('http://127.0.0.1:4173/api/legacy/catalog')).json();
assert.deepEqual(legacyCatalog, localCatalog);
const legacyDate = legacyCatalog.months.find(month => month.gridSnapshots > 0).month;
const from = new Date(legacyDate + '-01T00:00:00Z'), to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
const legacyParams = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), resolution: 'daily' });
const legacySeries = await (await get('/api/legacy/series?' + legacyParams, { headers })).json();
const withGrid = legacySeries.points.find(p => p.gridSnapshots > 0);
assert.ok(withGrid);
const day = await (await get('/api/legacy/snapshots?date=' + new Date(withGrid.at).toISOString().slice(0, 10), { headers })).json();
const gridCapture = day.snapshots.find(s => s.gridCaptureKey); assert.ok(gridCapture);
const legacyPath = '/api/legacy/snapshot/' + gridCapture.id;
const remoteSnapshot = await (await get(legacyPath, { headers })).json();
const localSnapshot = await (await fetch('http://127.0.0.1:4173' + legacyPath)).json();
assert.deepEqual(remoteSnapshot, localSnapshot); assert.equal(remoteSnapshot.detail.available, true);
const geojson = await (await get('/api/legacy/export.geojson?id=' + gridCapture.id, { headers })).json();
assert.deepEqual(geojson.features, localSnapshot.detail.geojson.features); assert.equal(geojson.source.format, 'legacy_html');
const csv = await (await get('/api/legacy/export.csv?' + legacyParams, { headers })).text();
assert.equal(csv, await (await fetch('http://127.0.0.1:4173/api/legacy/export.csv?' + legacyParams)).text());
for (const path of ['/data/legacy/dashboard/catalog.json', '/api/legacy/prepare', '/api/legacy/admin'])
  assert.equal((await get(path, { headers })).status, 404);
assert.equal((await get('/api/legacy/catalog', { headers, method: 'POST' })).status, 405);
checks.push('legacy_assets_catalog_series_replay_csv_and_exact_polygons', 'legacy_archives_and_writes_blocked');
const comparisonPage = await get('/legacy.html?view=comparisons', { headers });
assert.equal(comparisonPage.status, 200); assert.match(await comparisonPage.text(), /Weather &amp; observed outages/);
const comparisonCatalog = await (await get('/api/legacy/catalog?view=comparisons', { headers })).json();
assert.deepEqual(comparisonCatalog.entries.map(e=>e.id).sort(),['cold-2022','heat-2023','june-2023','september-2024']);
assert.deepEqual(comparisonCatalog, await (await fetch('http://127.0.0.1:4173/api/legacy/catalog?view=comparisons')).json());
for (const entry of comparisonCatalog.entries) for (const lag of [0,1,3]) {
  const params = new URLSearchParams({ view: 'comparison', id: entry.id, lag: String(lag) });
  const path = '/api/legacy/series?' + params;
  const detail = await (await get(path, { headers })).json();
  assert.deepEqual(detail, await (await fetch('http://127.0.0.1:4173' + path)).json());
  assert.equal(detail.outage.customerHours, null);
  if(detail.kind!=='temperature')assert.equal(detail.outage.gridSnapshots,0);
  assert.equal(detail.comparison.matches.length, 72); assert.equal(detail.comparison.lagHours, lag);
  const reference=detail.matchedReference;assert.ok(reference);assert.equal(reference.comparison.pairs.length,72);assert.equal(reference.comparison.lagHours,lag);
  assert.equal(reference.comparison.includedHours+reference.comparison.excludedHours,72);
  assert.ok(reference.comparison.pairs.filter(p=>p.included).every(p=>p.caseCapture&&p.referenceCapture&&(detail.kind==='temperature'
    ? Number.isFinite(p.referenceTemperatureC)&&(detail.family==='winter'?p.referenceTemperatureC>=0:p.referenceTemperatureC<32)&&p.referenceWindMs<10&&p.referencePrecipitationMm!==null&&p.referencePrecipitationMm<.1
    : p.referenceRainMm<.1&&p.referenceWindMs<10)));
  if(detail.id==='cold-2022')assert.ok(detail.comparison.geography.geojson.features.length>0);
  const csvPath = '/api/legacy/export.csv?' + params;
  const csv = await (await get(csvPath, { headers })).text();
  assert.equal(csv, await (await fetch('http://127.0.0.1:4173' + csvPath)).text());
  assert.equal(csv.trimEnd().split('\r\n').length, 73);
  const referencePath=csvPath+'&table=reference';
  const referenceCsv=await(await get(referencePath,{headers})).text();
  assert.equal(referenceCsv,await(await fetch('http://127.0.0.1:4173'+referencePath)).text());
  assert.equal(referenceCsv.trimEnd().split('\r\n').length,73);assert.match(referenceCsv,/reference_capture_utc/);
}
assert.equal((await get('/data/comparisons/catalog.json', { headers })).status, 404);
assert.equal((await get('/api/legacy/series?view=comparison&id=june-2023&lag=2', { headers })).status, 400);
checks.push('comparison_page_four_cases_all_lags_exact_json_csv_geometry_and_coverage');
checks.push('matched_references_all_lags_exact_pairs_csv_and_low_weather_masks');
const http = await fetch(origin.replace('https:', 'http:') + '/', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.ok([301, 302, 307, 308].includes(http.status)); assert.match(http.headers.get('location'), /^https:/);
checks.push('http_redirects_to_https');
const report = { checkedAt: new Date().toISOString(), url: origin, expiresAt: state.expiresAt, checks,
  verifiedCapture: { at: latest.summary.capturedAt, customers: latest.summary.customers, outages: latest.summary.outages },
  rainfallPeriods: periods.length, legacy: { ...legacyCatalog.counts, verifiedGridCapture: gridCapture.id } };
writeFileSync('reports/preview-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

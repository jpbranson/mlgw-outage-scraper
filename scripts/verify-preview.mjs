import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const state = JSON.parse(readFileSync('data/remote-preview/state.json', 'utf8'));
const { password } = JSON.parse(readFileSync('data/remote-preview/credentials.json', 'utf8'));
const origin = state.url;
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin ?? '')) throw new Error('No recognized active preview URL');
const get = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options });
const checks = [];
const root = await get('/'); assert.equal(root.status, 200); assert.match(await root.text(), /Preview password/); checks.push('password_form');
for (const path of ['/api/latest', '/api/health', '/app.js', '/api/export.csv', '/api/weather/periods', '/api/weather/period?id=' + 'a'.repeat(64), '/api/weather/image/' + 'a'.repeat(64)]) {
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
assert.deepEqual(periods.map(period => period.hours).sort((a, b) => a - b), [24, 48, 72]);
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
const http = await fetch(origin.replace('https:', 'http:') + '/', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.ok([301, 302, 307, 308].includes(http.status)); assert.match(http.headers.get('location'), /^https:/);
checks.push('http_redirects_to_https');
const report = { checkedAt: new Date().toISOString(), url: origin, expiresAt: state.expiresAt, checks,
  verifiedCapture: { at: latest.summary.capturedAt, customers: latest.summary.customers, outages: latest.summary.outages } };
writeFileSync('reports/preview-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

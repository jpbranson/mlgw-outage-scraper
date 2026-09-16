import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const state = JSON.parse(readFileSync('data/remote-preview/state.json', 'utf8'));
const { password } = JSON.parse(readFileSync('data/remote-preview/credentials.json', 'utf8'));
const origin = state.url;
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin ?? '')) throw new Error('No recognized active preview URL');
const get = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options });
const checks = [];
const root = await get('/'); assert.equal(root.status, 200); assert.match(await root.text(), /Preview password/); checks.push('password_form');
for (const path of ['/api/latest', '/api/health', '/app.js', '/api/export.csv']) {
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
const http = await fetch(origin.replace('https:', 'http:') + '/', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.ok([301, 302, 307, 308].includes(http.status)); assert.match(http.headers.get('location'), /^https:/);
checks.push('http_redirects_to_https');
const report = { checkedAt: new Date().toISOString(), url: origin, expiresAt: state.expiresAt, checks,
  verifiedCapture: { at: latest.summary.capturedAt, customers: latest.summary.customers, outages: latest.summary.outages } };
writeFileSync('reports/preview-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

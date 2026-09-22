import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createPreviewGateway, passwordDigest } from '../src/dashboard/preview-gateway.mjs';

const password = 'test-only-144-bit-style-secret', origin = 'https://preview.example.test';
async function setup(t, options = {}) {
  const calls = [];
  const upstream = createServer((req, res) => {
    calls.push({ path: req.url, headers: req.headers, method: req.method });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'self'; img-src https://tile.openstreetmap.org" });
    res.end(JSON.stringify({ customers: 321 }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createPreviewGateway({ passwordHash: passwordDigest(password), getOrigin: () => origin,
    expiresAt: Date.now() + 3600000, upstreamPort: upstream.address().port, requireHttps: false, ...options });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(async () => { gateway.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([
    new Promise(resolve => gateway.close(resolve)), new Promise(resolve => upstream.close(resolve))]); });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const login = (value = password, headers = {}) => fetch(base + '/preview/login', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ password: value }), redirect: 'manual' });
  return { base, login, calls, upstream };
}
test('unauthenticated clients receive only the password page; assets, exports and all API reads are protected', async t => {
  const { base, calls } = await setup(t);
  const root = await fetch(base); assert.equal(root.status, 200); assert.match(await root.text(), /Preview password/);
  for (const path of ['/app.js', '/app.css', '/api/health', '/api/latest', '/api/weather?at=2026-09-17T04:00:00Z', '/api/weather/image/'+'a'.repeat(64), '/api/weather/periods', '/api/weather/period?id='+'a'.repeat(64), '/api/export.csv', '/api/export.geojson?id=a', '/data/collector/index.sqlite']) {
    const response = await fetch(base + path); assert.equal(response.status, 401, path); assert.doesNotMatch(await response.text(), /321/);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(calls.length, 0);
});
test('valid password establishes a secure session and forwards only permitted read routes', async t => {
  const { base, login, calls, upstream } = await setup(t);
  const response = await login(); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-mlgw_preview=/); assert.match(setCookie, /Secure; HttpOnly; SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  const api = await fetch(base + '/api/latest', { headers: { Cookie: cookie, Authorization: 'Bearer do-not-forward', Origin: origin } });
  assert.equal(api.status, 200); assert.deepEqual(await api.json(), { customers: 321 });
  assert.match(api.headers.get('cache-control'), /no-store/); assert.match(api.headers.get('content-security-policy'), /tile.openstreetmap.org/);
  assert.equal(calls[0].headers.cookie, undefined); assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers.host, `127.0.0.1:${upstream.address().port}`);
  for (const path of ['/data/collector/index.sqlite', '/api/admin', '/.env', '/archive/manifests/a.json'])
    assert.equal((await fetch(base + path, { headers: { Cookie: cookie } })).status, 404);
  assert.equal(calls.length, 1);
  for(const path of ['/api/weather?at=2026-09-17T04:00:00Z','/api/weather/image/'+'a'.repeat(64),'/api/weather/periods','/api/weather/period?id='+'a'.repeat(64)])
    assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(base+'/api/weather/image/not-a-hash',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(base+'/data/weather/cache/published/catalog.json',{headers:{Cookie:cookie}})).status,404);
  assert.equal(calls.length,5);
});
test('copied passwords tolerate surrounding padding but retain exact case and internal characters', async t => {
  const { base, login } = await setup(t);
  const page = await (await fetch(base)).text();
  assert.match(page, /autocapitalize="none"/);
  assert.match(page, /autocorrect="off"/);
  assert.match(page, /spellcheck="false"/);
  for (const value of [' ' + password + ' ', '\t\r\n' + password + '\r\n', '\u00a0\u200b' + password + '\u200b\ufeff']) {
    const response = await login(value);
    assert.equal(response.status, 303);
    assert.match(response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  }
  for (const value of [password.toUpperCase(), password.slice(0, 8) + ' ' + password.slice(8), password + 'x']) {
    const response = await login(value);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
test('wrong passwords, forged cookies and cross-origin requests cannot reach data', async t => {
  const { base, login, calls } = await setup(t);
  assert.equal((await login('wrong')).status, 401);
  assert.equal((await login(password, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await login(password, { Origin: '' })).status, 403);
  assert.equal((await fetch(base + '/api/latest', { headers: { Cookie: '__Host-mlgw_preview=' + 'a'.repeat(43) } })).status, 401);
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/latest', { headers: { Cookie: cookie, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal(calls.length, 0);
});
test('legacy pages require login and only the bounded legacy read routes are forwarded', async t => {
  const { base, login, calls } = await setup(t);
  const page = await fetch(base + '/legacy.html'); assert.equal(page.status, 200); assert.match(await page.text(), /Preview password/);
  const paths = ['/legacy.js', '/legacy.css', '/api/legacy/catalog', '/api/legacy/series?from=2022-12-01T00:00:00Z&to=2023-01-01T00:00:00Z',
    '/api/legacy/snapshots?date=2022-12-23', '/api/legacy/snapshot/legacy-' + 'a'.repeat(24), '/api/legacy/export.csv', '/api/legacy/export.geojson?id=legacy-' + 'a'.repeat(24)];
  for (const path of paths) assert.equal((await fetch(base + path)).status, 401, path);
  assert.equal(calls.length, 0);
  const cookie = (await login()).headers.get('set-cookie').split(';')[0], headers = { Cookie: cookie };
  for (const path of ['/legacy.html', ...paths]) assert.equal((await fetch(base + path, { headers })).status, 200, path);
  const allowedCalls = calls.length;
  for (const path of ['/data/legacy/dashboard/catalog.json', '/api/legacy/prepare', '/api/legacy/admin', '/api/legacy/snapshot/current-id', '/api/legacy/catalog/extra'])
    assert.equal((await fetch(base + path, { headers })).status, 404, path);
  assert.equal((await fetch(base + '/api/legacy/catalog', { headers, method: 'POST' })).status, 405);
  assert.equal(calls.length, allowedCalls);
});
test('expiry revokes existing sessions and the login endpoint', async t => {
  const start = Date.now(); let now = start;
  const { base, login, calls } = await setup(t, { now: () => now, expiresAt: start + 10000 });
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/latest', { headers: { Cookie: cookie } })).status, 200);
  now = start + 10000;
  assert.equal((await fetch(base + '/api/latest', { headers: { Cookie: cookie } })).status, 410);
  assert.equal((await login()).status, 410); assert.equal(calls.length, 1);
});
test('login brute-force and oversized bodies are bounded', async t => {
  const { login } = await setup(t, { loginLimit: 2 });
  await login('wrong'); await login('wrong');
  const result = await login(); assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60');
  assert.equal((await login('a'.repeat(2000))).status, 413);
});
test('write methods and unexpected hosts fail closed, including during tunnel startup', async t => {
  const { base, login, calls } = await setup(t);
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/latest', { method: 'POST', headers: { Cookie: cookie } })).status, 405);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'foreign.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403); assert.equal(calls.length, 0);
  const pending = await setup(t, { getOrigin: () => null });
  assert.equal((await fetch(pending.base)).status, 503);
});
test('HTTP requests redirect before presenting a password form; login requires HTTPS', async t => {
  const { base } = await setup(t, { requireHttps: true });
  const plain = await fetch(base, { headers: { 'X-Forwarded-Proto': 'http' }, redirect: 'manual' });
  assert.equal(plain.status, 308); assert.equal(plain.headers.get('location'), origin + '/'); assert.equal(await plain.text(), '');
  assert.equal((await fetch(base, { headers: { 'X-Forwarded-Proto': 'https' } })).status, 200);
  assert.equal((await fetch(base + '/preview/login', { method: 'POST', body: 'password=anything' })).status, 403);
});

import { createServer, request } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-mlgw_preview';
export const passwordDigest = password => createHash('sha256').update(password).digest('hex');
const safeHeaders = {
  'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=28800',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function loginPage(invalid = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MLGW · Private preview</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f5f0;color:#213f37;font:16px 'Segoe UI',sans-serif}main{width:100%;max-width:410px;padding:30px;background:#fcfdf9;border:1px solid #dce2d9;border-radius:12px}small{letter-spacing:1.5px;color:#68766e;font-size:10px;font-weight:700}h1{font-size:29px;letter-spacing:-1px;margin:14px 0}p{color:#68766e;font-size:14px;line-height:1.65}label{display:block;margin:24px 0 8px;font-size:13px;font-weight:600}input{font:inherit;padding:13px;width:100%;border:1px solid #bbc8b8;border-radius:6px}button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:6px;background:#213f37;color:white;font:600 14px 'Segoe UI',sans-serif;cursor:pointer}input:focus,button:focus{outline:2px solid #be693e;outline-offset:3px}.error{color:#9b4028}.note{font-size:11px;margin-top:22px}</style></head>
  <body><main><small>MEMPHIS / PRIVATE PREVIEW</small><h1>Outage observatory.</h1><p>Enter the preview password from our chat to open the live dashboard.</p>
  ${invalid ? '<p class="error" role="alert">That password did not match this preview. Use the password sent with this link; each new preview has a new password.</p>' : ''}
  <form action="/preview/login" method="post" accept-charset="UTF-8"><label for="password">Preview password</label><input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="password-hint" required maxlength="256"><p id="password-hint">Passwords are case-sensitive. Extra spaces around a pasted password are ignored.</p><button type="submit">Open dashboard →</button></form>
  <p class="note">Temporary access. The dashboard runs on your PC; it must stay awake and connected.</p></main></body></html>`;
}
async function formBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024) throw new Error('Body limit exceeded');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
const permitted = path => /^\/(?:|(?:index|legacy)\.html|(?:app|legacy)\.(?:js|css)|assets\/[a-zA-Z0-9_.-]+|api\/(?:config|health|latest|series|snapshots|weather|weather\/(?:periods|period)|weather\/image\/[a-f0-9]{64}|snapshot\/[a-zA-Z0-9_-]{1,120}|export\.(?:csv|geojson)|legacy\/(?:catalog|series|snapshots|snapshot\/legacy-[a-f0-9]{24}|export\.(?:csv|geojson))))$/.test(path);

// Deliberately separate from the collector and local dashboard. Only this
// loopback gateway is pointed at the temporary tunnel; all reads require a session.
export function createPreviewGateway({ passwordHash, getOrigin, expiresAt, upstreamPort = 4173,
  now = () => Date.now(), loginLimit = 20, requireHttps = true }) {
  if (!/^[a-f0-9]{64}$/.test(passwordHash) || !Number.isFinite(expiresAt)) throw new Error('Invalid preview credentials or expiry');
  const expected = Buffer.from(passwordHash, 'hex'), sessions = new Map();
  let loginWindow = 0, loginAttempts = 0;
  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', headers = {}) => {
      res.writeHead(status, { ...safeHeaders, 'Content-Type': type, ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (now() >= expiresAt) return send(410, 'This temporary preview has expired.');
      const origin = getOrigin();
      if (!origin) return send(503, 'The private preview is starting. Please retry shortly.');
      const publicUrl = new URL(origin);
      if (publicUrl.protocol !== 'https:' || publicUrl.origin !== origin) return send(503, 'Invalid preview configuration.');
      const localHost = `127.0.0.1:${req.socket.localPort}`;
      if (![publicUrl.host, localHost, `localhost:${req.socket.localPort}`].includes(req.headers.host)) return send(403, 'Unknown preview host.');
      // Cloudflare overwrites this header with the browser-to-edge protocol.
      // Only the local tunnel process can reach this loopback listener.
      if (requireHttps && req.headers['x-forwarded-proto'] !== 'https') {
        if (req.method === 'GET' || req.method === 'HEAD') return send(308, '', undefined, { Location: origin + '/' });
        return send(403, 'HTTPS is required.');
      }
      if (req.headers.origin && req.headers.origin !== origin) return send(403, 'Same-origin requests only.');
      if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 1500) return send(400, 'Invalid request.');
      const url = new URL(req.url, origin);
      if (req.method === 'POST' && url.pathname === '/preview/login') {
        if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return send(403, 'Open the password page to sign in.');
        if (Number(req.headers['content-length'] ?? 0) > 1024) return send(413, 'Request too large.');
        if (now() - loginWindow >= 60000) { loginWindow = now(); loginAttempts = 0; }
        if (++loginAttempts > loginLimit) return send(429, 'Too many login attempts. Retry in one minute.', undefined, { 'Retry-After': '60' });
        const submitted = (await formBody(req)).get('password') ?? '';
        // Generated preview passwords contain only base64url characters. Ignore
        // surrounding copy/paste padding, retaining exact case and internal text.
        const password = submitted.replace(/^[\s\u200B]+|[\s\u200B]+$/gu, '');
        if (submitted.length > 256 || !timingSafeEqual(Buffer.from(passwordDigest(password), 'hex'), expected)) return send(401, loginPage(true), 'text/html; charset=utf-8');
        const token = randomBytes(32).toString('base64url');
        if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
        sessions.set(passwordDigest(token), expiresAt);
        return send(303, '', undefined, { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - now()) / 1000))}` });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Read-only preview.', undefined, { Allow: 'GET, HEAD' });
      if (url.pathname === '/preview/login') return send(200, loginPage(), 'text/html; charset=utf-8');
      const token = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const authorized = typeof token === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(token) && (sessions.get(passwordDigest(token)) ?? 0) > now();
      if (!authorized) {
        if (['/', '/index.html', '/legacy.html'].includes(url.pathname)) return send(200, loginPage(), 'text/html; charset=utf-8');
        return send(401, '{"error":"Preview sign-in required. Reload the page to sign in."}', 'application/json; charset=utf-8');
      }
      if (!permitted(url.pathname)) return send(404, 'Not found.');
      // Forward no cookies, authorization headers, arbitrary hosts or network targets.
      const upstream = request({ hostname: '127.0.0.1', port: upstreamPort, path: url.pathname + url.search, method: req.method,
        headers: { Host: `127.0.0.1:${upstreamPort}`, Accept: req.headers.accept ?? '*/*' }, timeout: 15000 }, response => {
        const headers = { ...safeHeaders };
        for (const key of ['content-type', 'content-disposition', 'content-security-policy']) if (response.headers[key]) headers[key] = response.headers[key];
        // Match header casing so there is exactly one CSP header after spreading.
        delete headers['Content-Security-Policy'];
        headers['content-security-policy'] ??= safeHeaders['Content-Security-Policy'];
        res.writeHead(response.statusCode ?? 502, headers);
        let received = 0;
        response.on('data', chunk => { received += chunk.length; if (received > 12 * 1024 * 1024) { upstream.destroy(); res.destroy(); } });
        response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
      upstream.on('error', () => { if (!res.headersSent) send(502, 'The local dashboard is temporarily unavailable.'); else res.destroy(); });
      res.on('close', () => upstream.destroy()); upstream.end();
    } catch { if (!res.headersSent) send(400, 'Invalid request.'); else res.destroy(); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000; server.maxHeadersCount = 40;
  return server;
}

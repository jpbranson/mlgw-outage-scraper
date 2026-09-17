import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import { RequestError } from './service.mjs';

export function createDashboardServer(service, { staticRoot, tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution = '© OpenStreetMap contributors', attributionUrl = 'https://www.openstreetmap.org/copyright', requestLimit = 120, weather } = {}) {
  const tileOrigin = tiles ? new URL(tiles).origin : '';
  if (tiles && !tiles.startsWith('https://')) throw new Error('Tile URL must use HTTPS, or be empty to disable tiles.');
  let windowStart = 0, requests = 0;
  return createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8', cache = 'no-store') => {
      const bytes = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
      if (Buffer.byteLength(bytes) > 12 * 1024 * 1024) { res.writeHead(413); res.end('Response limit exceeded'); return; }
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${tileOrigin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      const allowedHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
      if (!allowedHosts.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`))
        throw new RequestError('Local same-origin access only.', 403);
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw new RequestError('Read-only endpoint.', 405); }
      const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
      if (url.search.length > 1024 || path.length > 240) throw new RequestError('Request exceeds limit.');
      if (path.startsWith('/api/')) {
        if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
        if (++requests > requestLimit) { res.setHeader('Retry-After', '60'); throw new RequestError('Local request budget reached. Retry in one minute.', 429); }
        if (path === '/api/weather' && weather) return send(200, weather.at(url.searchParams));
        if (path === '/api/weather/periods' && weather) return send(200, weather.periods(url.searchParams));
        if (path === '/api/weather/period' && weather) return send(200, weather.period(url.searchParams));
        if (path.startsWith('/api/weather/image/') && weather) return send(200, weather.image(path.slice(19)), 'image/png', 'private, max-age=86400, immutable');
        if (path === '/api/config') return url.searchParams.get('view') === 'census'
          ? send(200, service.censusAreas().data, undefined, 'private, max-age=86400')
          : send(200, { tiles, attribution, attributionUrl });
        if (path === '/api/health') return send(200, service.health());
        if (path === '/api/latest') return send(200, await service.latest());
        if (path === '/api/series') return send(200, url.searchParams.get('view') === 'spatial'
          ? await service.spatial(url.searchParams) : service.series(url.searchParams), undefined, 'private, max-age=30');
        if (path === '/api/snapshots') return send(200, service.snapshots(url.searchParams.get('date')));
        if (path.startsWith('/api/snapshot/')) return send(200, await service.snapshot(path.slice(14)), undefined, 'private, max-age=60');
        if (path === '/api/export.csv') {
          const data = service.series(url.searchParams);
          const lines = ['bucket_or_capture_utc,customers,outages,customer_peak_capture_utc,outage_peak_capture_utc,coverage_fraction'];
          for (const p of data.points) lines.push([new Date(p.at).toISOString(), p.customers ?? '', p.outages ?? '', p.capturedAt ?? '', p.outageCapturedAt ?? p.capturedAt ?? '', p.coverage ?? ''].join(','));
          res.setHeader('Content-Disposition', 'attachment; filename="mlgw-outage-series.csv"');
          return send(200, lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
        }
        if (path === '/api/export.geojson') {
          const data = await service.snapshot(url.searchParams.get('id') ?? '');
          if (!data.detail.available) throw new RequestError(data.detail.reason, 409);
          res.setHeader('Content-Disposition', `attachment; filename="mlgw-${data.summary.id}.geojson"`);
          return send(200, { ...data.detail.geojson, capturedAt: data.summary.capturedAt, source: data.source }, 'application/geo+json; charset=utf-8');
        }
        throw new RequestError('Read-only route not found.', 404);
      }
      const file = path === '/' ? '/index.html' : decodeURIComponent(path);
      // Serve the built client only; data, archives and collector operations are never routed.
      if (!/^\/(index\.html|app\.(js|css)|assets\/[a-zA-Z0-9_.-]+)$/.test(file)) throw new RequestError('Not found.', 404);
      const target = resolve(staticRoot, '.' + file), rel = relative(resolve(staticRoot), target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new RequestError('Not found.', 404);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
      let bytes;
      try { bytes = readFileSync(target); } catch { throw new RequestError('Client build missing. Run npm run dashboard:build.', 404); }
      send(200, bytes, types[extname(target)], 'no-cache');
    } catch (error) { send(error instanceof RequestError ? error.status : 503, { error: error instanceof RequestError ? error.message : 'The local archive is temporarily unavailable. Retry shortly.' }); }
  });
}

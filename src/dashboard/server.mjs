import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import { RequestError } from './service.mjs';
import { isIP } from 'node:net';
import { logError } from '../runtime/logging.mjs';

export function createDashboardServer(service, { staticRoot, tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution = '© OpenStreetMap contributors', attributionUrl = 'https://www.openstreetmap.org/copyright', requestLimit = 120,
  aggregateLimit = 600, trustLoopbackProxy = false, logger = logError, weather, legacy, comparisons, publicOrigin } = {}) {
  let publicUrl;
  if (publicOrigin) {
    publicUrl = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash)
      throw Error('PUBLIC_ORIGIN must be one HTTP(S) origin without credentials or a path');
  }
  const tileOrigin = tiles ? new URL(tiles).origin : '';
  if (tiles && !tiles.startsWith('https://')) throw new Error('Tile URL must use HTTPS, or be empty to disable tiles.');
  let windowStart = 0, requests = 0;
  const clients = new Map();
  return createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const send = (status, body, type = 'application/json; charset=utf-8', cache = 'no-store') => {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
      if (Buffer.byteLength(bytes) > 12 * 1024 * 1024) { res.writeHead(413); res.end('Response limit exceeded'); return; }
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${tileOrigin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      const allowedHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
      const isPublic = publicUrl && req.headers.host === publicUrl.host;
      const expectedOrigin = isPublic ? publicUrl.origin : `http://${req.headers.host}`;
      if ((!allowedHosts.includes(req.headers.host) && !isPublic) || (req.headers.origin && req.headers.origin !== expectedOrigin))
        throw new RequestError('Same-origin access only.', 403);
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw new RequestError('Read-only endpoint.', 405); }
      const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
      if (url.search.length > 1024 || path.length > 240) throw new RequestError('Request exceeds limit.');
      if (path.startsWith('/api/')) {
        // Freshness probes cannot be starved by an expensive-query quota.
        if (path === '/api/health') return send(200, service.health());
        if (path === '/api/ready') { const health = service.health(); return send(health.status === 'ok' ? 200 : 503, health); }
        if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; clients.clear(); }
        let client = req.socket.remoteAddress;
        if (trustLoopbackProxy && isPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(client)) {
          const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim();
          if (isIP(forwarded)) client = forwarded;
        }
        const count = (clients.get(client) ?? 0) + 1;
        if (clients.size >= 4096 && !clients.has(client)) throw new RequestError('Request budget reached.', 429);
        clients.set(client, count);
        if (count > requestLimit || ++requests > aggregateLimit) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60000 - Date.now()) / 1000))));
          throw new RequestError('Request budget reached. Retry in one minute.', 429);
        }
        if (path.startsWith('/api/legacy/') && comparisons && ['comparison','comparisons'].includes(url.searchParams.get('view'))) {
          if (path === '/api/legacy/catalog') return send(200, comparisons.catalog());
          if (path === '/api/legacy/series') return send(200, comparisons.series(url.searchParams));
          if (path === '/api/legacy/export.csv') {
            res.setHeader('Content-Disposition', 'attachment; filename="mlgw-weather-comparison.csv"');
            return send(200, comparisons.csv(url.searchParams), 'text/csv; charset=utf-8');
          }
          throw new RequestError('Comparison route not found.', 404);
        }
        if (path.startsWith('/api/legacy/') && legacy) {
          if (path === '/api/legacy/catalog') return send(200, legacy.catalog());
          if (path === '/api/legacy/series') return send(200, legacy.series(url.searchParams));
          if (path === '/api/legacy/snapshots') return send(200, legacy.snapshots(url.searchParams.get('date')));
          if (path.startsWith('/api/legacy/snapshot/')) return send(200, legacy.snapshot(path.slice(21)));
          if (path === '/api/legacy/export.csv') {
            const data = legacy.series(url.searchParams);
            const lines = ['source_format,bucket_or_capture_utc,customers,outages,customer_peak_capture_utc,outage_peak_capture_utc,observations,grid_snapshots'];
            for (const p of data.points) lines.push(['legacy_html', data.resolution === 'observations' && p.capturedAt ? p.capturedAt : new Date(p.at).toISOString(), p.customers ?? '', p.outages ?? '',
              p.capturedAt ?? '', p.outageCapturedAt ?? p.capturedAt ?? '', p.observations ?? (p.id ? 1 : 0), p.gridSnapshots ?? (p.gridCaptureKey ? 1 : 0)].join(','));
            res.setHeader('Content-Disposition', 'attachment; filename="mlgw-legacy-series.csv"');
            return send(200, lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
          }
          if (path === '/api/legacy/export.geojson') {
            const data = legacy.snapshot(url.searchParams.get('id'));
            if (!data.detail.available) throw new RequestError(data.detail.reason, 409);
            res.setHeader('Content-Disposition', `attachment; filename="mlgw-${data.summary.id}.geojson"`);
            return send(200, { ...data.detail.geojson, source: data.source, capturedAt: data.detail.capturedAt,
              totalCapturedAt: data.summary.capturedAt, captureKey: data.detail.captureKey, recovery: data.detail.recovery }, 'application/geo+json; charset=utf-8');
          }
        }
        if (path === '/api/weather' && weather) return send(200, weather.at(url.searchParams));
        if (path === '/api/weather/periods' && weather) return send(200, weather.periods(url.searchParams));
        if (path === '/api/weather/period' && weather) return send(200, weather.period(url.searchParams));
        if (path.startsWith('/api/weather/image/') && weather) return send(200, weather.image(path.slice(19)), 'image/png', 'private, max-age=86400, immutable');
        if (path === '/api/config') return url.searchParams.get('view') === 'census'
          ? send(200, service.censusAreas().data, undefined, 'private, max-age=86400')
          : send(200, { tiles, attribution, attributionUrl });
        if (path === '/api/latest') return send(200, await service.latest());
        if (path === '/api/series') return send(200, url.searchParams.get('view') === 'spatial'
          ? await service.spatial(url.searchParams, { signal: controller.signal }) : service.series(url.searchParams), undefined, 'private, max-age=30');
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
      if (!/^\/((index|legacy)\.html|(app|legacy)\.(js|css)|assets\/[a-zA-Z0-9_.-]+)$/.test(file)) throw new RequestError('Not found.', 404);
      const target = resolve(staticRoot, file === '/legacy.html' && url.searchParams.get('view') === 'comparisons' ? 'comparisons.html' : '.' + file), rel = relative(resolve(staticRoot), target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new RequestError('Not found.', 404);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
      let bytes;
      try { bytes = readFileSync(target); } catch { throw new RequestError('Client build missing. Run npm run dashboard:build.', 404); }
      send(200, bytes, types[extname(target)], 'no-cache');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof RequestError)) logger('dashboard.request', error, { path: req.url?.split('?')[0], method: req.method });
      send(error instanceof RequestError ? error.status : 503, { error: error instanceof RequestError ? error.message : 'The local archive is temporarily unavailable. Retry shortly.' });
    }
  });
}

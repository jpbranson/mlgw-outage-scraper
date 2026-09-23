// Explicit bounded source validation. Reads no outage data and publishes no UI assets.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { WeatherCache } from '../src/weather/cache.mjs';
import { sourceRequest, warningGeometryRequest } from '../src/weather/sources.mjs';
import { EVENT_SAMPLES } from '../src/weather/event-samples.mjs';
import { EVENT_CONTEXT_VERSION, stormEventArchive, stormEventWindow, countyZoneWarnings, warningAreaGeometry } from '../src/weather/event-context.mjs';

const args = process.argv.slice(2), selected = args.find(a => a.startsWith('--case='))?.slice(7);
if (args.some(a => a !== '--download' && a !== `--case=${selected}`) || (selected !== undefined && !EVENT_SAMPLES.some(s => s.name === selected)))
  throw Error(`Usage: node scripts/validate-event-context.mjs [--download] [--case=${EVENT_SAMPLES.map(s => s.name).join('|')}]`);
const samples = EVENT_SAMPLES.filter(s => !selected || s.name === selected), cache = new WeatherCache('data/weather/cache');
const report = { checkedAt: new Date().toISOString(), processingVersion: EVENT_CONTEXT_VERSION,
  mode: args.includes('--download') ? 'download' : 'offline', complete: false, samples: [],
  scope: 'Shelby County TNC157 and public forecast zone TNZ088; event periods and warning instants are distinct.' };
const annuals = new Map(), geometries = new Map();
const source = m => ({ sourceId: m.id, sourceSha256: m.body.sha256, sourceUrl: m.request.url,
  originalBytes: m.body.bytes, retrievedAt: m.retrievedAt });
async function acquire(request) {
  if (Date.now() - cache.started >= cache.limits.maxRunMs) throw Error('Weather context time budget exhausted');
  const manifest = await cache.acquire(request, { offline: !args.includes('--download') });
  if (manifest.availability !== 'retrieved') throw Error(`${request.product}: ${manifest.availability}; missing is not zero`);
  return manifest;
}
function checkpoint() {
  Object.assign(report, { requests: cache.requests, downloadBytes: cache.downloadBytes, cacheBytes: cache.used,
    cacheLimitBytes: cache.limits.cacheBytes, elapsedMs: Date.now() - cache.started });
  mkdirSync('reports', { recursive: true });
  const path = `reports/event-context${selected ? `-${selected}` : ''}-validation.json`;
  writeFileSync(path + '.tmp', JSON.stringify(report, null, 2)); renameSync(path + '.tmp', path);
}
try {
  for (const sample of samples) {
    const year = sample.from.slice(0, 4);
    if (!annuals.has(year)) {
      const manifest = await acquire(sourceRequest('storm-events', sample.from));
      annuals.set(year, { manifest, archive: stormEventArchive(cache.readBody(manifest), manifest.request) });
    }
    const { manifest, archive } = annuals.get(year), events = stormEventWindow(archive, sample.from, sample.to);
    const warningManifest = await acquire(sourceRequest('zone-warnings', sample.warningAt));
    const warnings = countyZoneWarnings(cache.readBody(warningManifest), warningManifest.request);
    for (const record of warnings.records) {
      const key = JSON.stringify(record.event);
      if (!geometries.has(key)) {
        const m = await acquire(warningGeometryRequest(record.event));
        geometries.set(key, { manifest: m, bytes: cache.readBody(m) });
      }
      const geometry = geometries.get(key);
      record.administrativeGeometry = { ...warningAreaGeometry(geometry.bytes, geometry.manifest.request, record.area.ugc), ...source(geometry.manifest) };
    }
    const eventDerived = cache.derived(manifest, events), warningDerived = cache.derived(warningManifest, warnings);
    const result = { ...sample, events: { ...source(manifest), availability: events.availability,
      sourceRows: archive.totalRows, sourceShelbyRecords: archive.records.length, expandedBytes: archive.expandedBytes,
      observedBeginMonths: archive.observedBeginMonths, derived: eventDerived,
      records: events.records.map(r => ({ eventId: r.eventId, episodeId: r.episodeId, eventType: r.eventType,
        beginsAt: r.beginsAt, endsAt: r.endsAt, area: r.area })) },
    warnings: { ...source(warningManifest), availability: warnings.availability, derived: warningDerived,
      sourceRows: warnings.sourceRows, unselectedPolygonRows: warnings.unselectedPolygonRows,
      records: warnings.records.map(r => ({ key: r.key, event: r.event, label: r.label, area: r.area, beginsAt: r.beginsAt,
        endsAt: r.endsAt, archiveUpdatedAt: r.archiveUpdatedAt, archiveStatus: r.archiveStatus,
        geometrySourceId: r.administrativeGeometry.sourceId, geometrySourceSha256: r.administrativeGeometry.sourceSha256,
        geometryVertices: r.administrativeGeometry.vertices })) } };
    report.samples.push(result); checkpoint();
    console.log(JSON.stringify({ name: sample.name, events: result.events.records.length, eventAvailability: result.events.availability,
      warnings: result.warnings.records.map(r => r.label), warningAvailability: result.warnings.availability }));
  }
  report.complete = true; checkpoint();
  console.log(JSON.stringify({ complete: true, requests: report.requests, downloadBytes: report.downloadBytes, cacheBytes: report.cacheBytes, elapsedMs: report.elapsedMs }));
} catch (error) {
  report.error = error.message; checkpoint(); throw error;
} finally { cache.close(); }

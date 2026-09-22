// Offline-only quality checkpoint: bounded windows, verified originals, no upstream requests.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { WeatherCache } from '../src/weather/cache.mjs';
import { sourceRequest } from '../src/weather/sources.mjs';
import { stationSubset } from '../src/weather/decode.mjs';
import { stationQuality, STATION_QUALITY_VERSION } from '../src/weather/station-quality.mjs';

if (process.argv.length !== 2) throw Error('Usage: node scripts/validate-station-quality.mjs (offline only)');
const samples = [
  { name: 'wet', from: '2023-06-25T00:00:00Z', to: '2023-06-27T00:00:00Z' },
  { name: 'dry', from: '2023-09-01T00:00:00Z', to: '2023-09-02T00:00:00Z' },
  { name: 'winter', from: '2022-02-03T00:00:00Z', to: '2022-02-04T00:00:00Z' },
  { name: 'recent-available', from: '2026-09-07T00:00:00Z', to: '2026-09-10T00:00:00Z' },
  { name: 'current-missing', from: '2026-09-16T00:00:00Z', to: '2026-09-17T00:00:00Z' },
];
const cache = new WeatherCache('data/weather/cache', { fetchImpl: async () => { throw Error('Offline quality validation cannot fetch'); } });
const report = { checkedAt: new Date().toISOString(), processingVersion: STATION_QUALITY_VERSION,
  mode: 'offline', scope: 'Station quality only; no historical outage data inferred.', samples: [] };
try {
  for (const sample of samples) {
    const manifest = await cache.acquire(sourceRequest('station', sample.from), { offline: true });
    if (manifest.availability !== 'retrieved') throw Error(`Station original unavailable for ${sample.name}`);
    const raw = stationSubset(cache.readBody(manifest), sample.from, sample.to);
    const result = stationQuality(raw), derived = cache.derived(manifest, result);
    report.samples.push({ ...sample, availability: result.availability, records: result.rows.length,
      sourceId: manifest.id, sourceSha256: manifest.body.sha256, sourceCoverage: result.sourceCoverage,
      derived, summary: result.summary, hourlyPrecipitationStatuses: result.hourlyPrecipitationStatuses });
    console.log(JSON.stringify({ name: sample.name, records: result.rows.length, summary: result.summary,
      hourlyPrecipitationStatuses: result.hourlyPrecipitationStatuses }));
  }
  Object.assign(report, { requests: cache.requests, downloadBytes: cache.downloadBytes,
    cacheBytes: cache.used, cacheLimitBytes: cache.limits.cacheBytes, elapsedMs: Date.now() - cache.started });
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/station-quality-validation.json.tmp', JSON.stringify(report, null, 2));
  renameSync('reports/station-quality-validation.json.tmp', 'reports/station-quality-validation.json');
  console.log(JSON.stringify({ complete: true, requests: report.requests, cacheBytes: report.cacheBytes }));
} finally { cache.close(); }

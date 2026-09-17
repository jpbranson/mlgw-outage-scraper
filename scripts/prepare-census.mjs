// Official public reference data only. This never reads or changes outage captures.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const populationUrl = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat';
const boundaryUrl = new URL('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10/query');
boundaryUrl.search = new URLSearchParams({ where: "STATE='47' AND COUNTY='157'", outFields: 'GEOID,NAME',
  returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson', orderByFields: 'GEOID' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
mkdirSync('data/census', { recursive: true });
if (process.argv.includes('--download')) {
  for (const [name, url] of [['population', populationUrl], ['boundaries', boundaryUrl.href]]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(55000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > 40 * 1024 * 1024) throw new Error('Census download exceeds 40 MiB');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    writeFileSync(`data/census/${name}.raw`, raw);
    writeFileSync(`data/census/${name}.source.json`, JSON.stringify({ url, retrievedAt: new Date().toISOString(), sha256: hash(raw), bytes }));
  }
}
function source(name) {
  const raw = readFileSync(`data/census/${name}.raw`), meta = JSON.parse(readFileSync(`data/census/${name}.source.json`, 'utf8'));
  if (hash(raw) !== meta.sha256) throw new Error(`Changed Census source: ${name}`);
  return { raw, meta };
}
const pop = source('population'), boundary = source('boundaries');
if (pop.meta.url !== populationUrl || boundary.meta.url !== boundaryUrl.href) throw new Error('Unexpected Census source URL');
const lines = pop.raw.toString('utf8').trim().split(/\r?\n/);
if (lines.shift() !== 'GEO_ID|B01003_E001|B01003_M001') throw new Error('Unexpected population schema');
const number = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const population = new Map(); let countyPopulation;
for (const line of lines) {
  const [id, estimate, moe] = line.split('|');
  if (id === '0500000US47157') countyPopulation = number(estimate);
  if (/^1500000US47157\d{7}$/.test(id)) population.set(id.slice(9), { population: number(estimate), populationMoe: number(moe) });
}
const geo = JSON.parse(boundary.raw.toString('utf8'));
if (geo.type !== 'FeatureCollection' || geo.exceededTransferLimit || !geo.features?.length) throw new Error('Incomplete Census boundaries');
const seen = new Set();
const features = geo.features.map(f => {
  const id = f.properties.GEOID;
  if (!population.has(id) || seen.has(id) || !['Polygon', 'MultiPolygon'].includes(f.geometry?.type)) throw new Error(`Invalid/unmatched block group ${id}`);
  seen.add(id);
  return { type: 'Feature', id, properties: { name: f.properties.NAME, ...population.get(id) }, geometry: f.geometry };
});
if (seen.size !== population.size) throw new Error('Population and boundary GEOIDs do not match');
const summedPopulation = features.reduce((n, f) => n + (f.properties.population ?? 0), 0);
if (!countyPopulation || summedPopulation !== countyPopulation) throw new Error('Block group population does not reconcile to county');
const result = { type: 'FeatureCollection', metadata: { county: 'Shelby County, Tennessee', stateFips: '47', countyFips: '157',
  populationPeriod: '2020–2024', populationYear: 2024, boundaryYear: 2024, table: 'B01003',
  populationLabel: '2020–2024 ACS 5-year population estimate', marginOfErrorConfidence: 90,
  populationSource: 'https://data.census.gov/table/ACSDT5Y2024.B01003',
  releaseSource: 'https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html',
  boundarySource: boundaryUrl.href, sources: [pop.meta, boundary.meta], groupCount: features.length, countyPopulation }, features };
mkdirSync('reference', { recursive: true });
const bytes = gzipSync(JSON.stringify(result), { level: 9 });
writeFileSync('reference/shelby-block-groups-2024.json.gz', bytes);
console.log(JSON.stringify({ groups: features.length, countyPopulation, bytes: bytes.length, sha256: hash(bytes) }));

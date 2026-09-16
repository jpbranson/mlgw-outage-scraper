import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { cpus } from 'node:os';
import { parseFeed, meaningfulState } from '../src/contract.mjs';
import { sha256, writeJson } from '../src/pilot-io.mjs';
import { makeStressFeed, storageModel } from '../src/stress.mjs';

await mkdir('reports', { recursive: true });
await mkdir('data/fixtures', { recursive: true });
const ordinary = await readFile('test/fixtures/ordinary.geojson', 'utf8');
const seed = JSON.parse(ordinary);
const cases = [{ name: 'ordinary', text: ordinary }, ...[4000, 10000].map(n => ({ name: `synthetic-${n}`, text: JSON.stringify(makeStressFeed(seed, n)) }))];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
function processBody(text, compression) {
  const parsed = parseFeed(text);
  if (!parsed.totalsValid) throw new Error('Benchmark fixture has invalid totals');
  const normalized = JSON.stringify(parsed.normalized);
  sha256(text); sha256(meaningfulState(text)); sha256(normalized);
  if (compression) { gzipSync(text, { level: 6 }); gzipSync(normalized, { level: 6 }); }
  return parsed;
}
const results = [];
for (const fixture of cases) {
  await writeFile(`data/fixtures/${fixture.name}.geojson`, fixture.text);
  const parsed = parseFeed(fixture.text);
  const normalized = JSON.stringify(parsed.normalized);
  const measurements = {};
  for (const compression of [false, true]) {
    const cpu = [], wall = [];
    // First iteration is reported separately; warm distributions do not hide it.
    for (let i = 0; i < 21; i++) {
      const cpuStart = process.cpuUsage(), start = performance.now();
      processBody(fixture.text, compression);
      const elapsed = performance.now() - start, usage = process.cpuUsage(cpuStart);
      cpu.push((usage.user + usage.system) / 1000); wall.push(elapsed);
    }
    measurements[compression ? 'withGzip' : 'withoutGzip'] = {
      firstCpuMs: cpu[0], firstWallMs: wall[0], warmCpuMedianMs: percentile(cpu.slice(1), .5),
      warmCpuP95Ms: percentile(cpu.slice(1), .95), warmWallMedianMs: percentile(wall.slice(1), .5), warmWallP95Ms: percentile(wall.slice(1), .95),
    };
  }
  results.push({ name: fixture.name, synthetic: fixture.name !== 'ordinary', features: parsed.featureCount,
    issues: parsed.issues.length, rawBytes: Buffer.byteLength(fixture.text), rawGzipBytes: gzipSync(fixture.text, { level: 6 }).length,
    normalizedBytes: Buffer.byteLength(normalized), normalizedGzipBytes: gzipSync(normalized, { level: 6 }).length, measurements });
}
const metadataBytesPerPoll = 4096;
const storage = [];
for (const compression of ['none', 'gzip']) {
  const combined = r => (compression === 'gzip' ? r.rawGzipBytes + r.normalizedGzipBytes : r.rawBytes + r.normalizedBytes) + metadataBytesPerPoll;
  for (const storm of results.slice(1)) for (const minutes of [5, 1]) {
    storage.push({ compression, stormFeatures: storm.features, quietBytesPerPoll: combined(results[0]), stormBytesPerPoll: combined(storm), ...storageModel(combined(results[0]), combined(storm), minutes) });
  }
}
const report = { generatedAt: new Date().toISOString(), runtime: process.version, platform: process.platform,
  cpu: cpus()[0]?.model, verdict: 'LOCAL DIAGNOSTIC ONLY: Cloudflare CPU gate remains untested',
  notes: ['Process CPU on Windows has coarse granularity and includes GC; these are not Cloudflare CPU measurements.',
    'Synthetic storms vary IDs, timestamps, coordinates and counts; no claim of observed new-format storm compression.',
    'Metadata/rollup allowance is a provisional 4096 bytes per poll. D1 budget and other account usage are separate.',
    'No deduplication savings assumed; 7 storm days/year plus 30 full storm days offline, 7 days staging, 7 days cleanup grace.'],
  metadataBytesPerPoll, cases: results, storage };
await writeJson('reports/benchmark.json', report);
console.log(JSON.stringify(report, null, 2));

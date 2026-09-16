import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { strict as assert } from 'node:assert';
import { parseFeed } from '../src/contract.mjs';
import { sha256, writeJson } from '../src/pilot-io.mjs';
import { storageModel } from '../src/stress.mjs';

const benchmark = JSON.parse(await readFile('reports/benchmark.json', 'utf8'));
const replay = [];
for (const entry of benchmark.cases) {
  const raw = await readFile(`data/fixtures/${entry.name}.geojson`);
  const restored = gunzipSync(gzipSync(raw, { level: 6 }));
  assert.deepEqual(restored, raw);
  assert.deepEqual(parseFeed(restored.toString()).normalized, parseFeed(raw.toString()).normalized);
  replay.push({ name: entry.name, sha256: sha256(raw), restoredSha256: sha256(restored), byteExact: true, normalizedReplayEqual: true });
}
const quiet = benchmark.cases[0];
const scenarios = [];
for (const storm of benchmark.cases.slice(1)) for (const minutes of [5, 1]) {
  const model = storageModel(quiet.rawGzipBytes + 4096, storm.rawGzipBytes + 4096, minutes);
  const normalizedCache = 2 * 1440 / minutes * storm.normalizedGzipBytes;
  // Conservative one-day fallback spool if first-write raw objects are kept
  // until compressed objects have a verified hash and manifest reference.
  const rawStaging = 1440 / minutes * storm.rawBytes; // hard cap: 24 storm hours
  const parserArtifactsReserve = 50_000_000;
  const total = model.totalBytes + normalizedCache + rawStaging + parserArtifactsReserve;
  scenarios.push({ stormFeatures: storm.features, ...model, rawArchiveAndReserveBytes: model.totalBytes,
    normalizedCache48HoursBytes: normalizedCache, uncompressedStaging24HoursBytes: rawStaging,
    parserArtifactsReserveBytes: parserArtifactsReserve, totalBytes: total,
    within10GBBeforeOtherAccountUsage: total < 1e10,
    within70PercentOf10GB: total < 7e9 });
}
const report = { generatedAt: new Date().toISOString(), archiveStrategy: 'gzip originals + 48h normalized cache + bounded staging',
  notes: ['Original body hashes survive round-trip compression. Versioned parser artifacts must be retained for historical normalization.',
    'At most 24 hours of uncompressed staging; the runtime must compress, verify and index before removing a staged duplicate.',
    'Deleting a verified staging duplicate is not deletion of the source observation. Canonical compressed raw data remains protected.',
    'The 48-hour normalized cache is disposable only after canonical raw bytes and parser version are verified.',
    'Local replay and synthetic storage tests only; cloud replay, CPU, index growth and actual account free capacity remain unverified.'],
  replay, scenarios };
await writeJson('reports/storage-alternative.json', report);
console.log(JSON.stringify(report, null, 2));

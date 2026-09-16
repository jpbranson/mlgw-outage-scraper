import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import worker, { runBenchmark } from '../workers/benchmark.mjs';
const fixture = await readFile(new URL('./fixtures/ordinary.geojson', import.meta.url), 'utf8');

test('benchmark endpoint fails closed when secret is absent or wrong', async () => {
  assert.equal((await worker.fetch(new Request('https://test/worker'), {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://test/worker', { headers: { authorization: 'Bearer bad' } }), { BENCHMARK_TOKEN: 'test' })).status, 401);
});
test('Worker-compatible probe archives before parsing and produces reversible gzip', async () => {
  const writes = new Map();
  const response = await runBenchmark(new Request('https://test/worker?compression=gzip', { method: 'POST', body: fixture }), {
    BENCHMARK_ARCHIVE: { put: async (key, value) => writes.set(key, value) },
  });
  const result = await response.json();
  assert.equal(result.features, 16); assert.equal(result.archiveWritesTested, true);
  assert.ok([...writes.keys()][0].endsWith('raw.geojson'));
  const compressed = [...writes].find(([key]) => key.endsWith('raw.geojson.gz'))[1];
  assert.equal(gunzipSync(new Uint8Array(compressed)).toString(), fixture);
});
test('malformed cloud fixture is archived before rejection', async () => {
  let written = false;
  await assert.rejects(runBenchmark(new Request('https://test/worker', { method: 'POST', body: 'bad' }), {
    BENCHMARK_ARCHIVE: { put: async () => { written = true; } },
  }));
  assert.equal(written, true);
});

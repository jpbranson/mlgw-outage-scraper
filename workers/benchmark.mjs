import { parseFeed, meaningfulState } from '../src/contract.mjs';

const encoder = new TextEncoder();
async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function gzip(bytes) {
  return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}
async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Body exceeds 10 MiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
export async function runBenchmark(request, env = {}) {
  const url = new URL(request.url);
  const compression = url.searchParams.get('compression') === 'gzip';
  const id = crypto.randomUUID();
  const raw = await boundedBody(request);
  // Optional binding tests archive writes too. No R2 subscription is provisioned
  // by the supplied config. A run without it cannot pass the archive gate.
  if (env.BENCHMARK_ARCHIVE) await env.BENCHMARK_ARCHIVE.put(`phase1/${id}/raw.geojson`, raw);
  const text = new TextDecoder().decode(raw);
  const parsed = parseFeed(text);
  if (!parsed.totalsValid) throw new Error('Invalid fixture totals');
  const normalized = encoder.encode(JSON.stringify(parsed.normalized));
  const hashes = [await hash(raw), await hash(encoder.encode(meaningfulState(text))), await hash(normalized)];
  const storedRaw = compression ? await gzip(raw) : raw;
  const storedNormalized = compression ? await gzip(normalized) : normalized;
  if (env.BENCHMARK_ARCHIVE) {
    if (compression) await env.BENCHMARK_ARCHIVE.put(`phase1/${id}/raw.geojson.gz`, storedRaw);
    await env.BENCHMARK_ARCHIVE.put(`phase1/${id}/normalized${compression ? '.gz' : '.json'}`, storedNormalized);
  }
  const result = { id, features: parsed.featureCount, issues: parsed.issues.length, compression: compression ? 'gzip' : 'none',
    rawBytes: raw.byteLength, normalizedBytes: normalized.byteLength, storedRawBytes: storedRaw.byteLength,
    storedNormalizedBytes: storedNormalized.byteLength, hashes, archiveWritesTested: Boolean(env.BENCHMARK_ARCHIVE),
    cpuMeasurement: 'Use platform invocation CPU metrics; in-Worker elapsed timers are not CPU measurements.' };
  console.log(JSON.stringify({ event: 'phase1-benchmark', ...result }));
  return Response.json(result);
}

// Both paths use exactly the same parser and transforms. Authenticate before
// invoking the Durable Object; it is reachable only through this binding.
export default {
  async fetch(request, env) {
    if (!env.BENCHMARK_TOKEN || request.headers.get('authorization') !== `Bearer ${env.BENCHMARK_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    const path = new URL(request.url).pathname;
    try {
      if (path === '/durable-object') return await env.PROCESSOR.get(env.PROCESSOR.idFromName('phase1')).fetch(request);
      if (path === '/worker') return await runBenchmark(request, env);
      return new Response('Not found', { status: 404 });
    } catch (error) { return Response.json({ error: error.message }, { status: 422 }); }
  },
};

export class SourceBenchmark {
  constructor(state, env) { this.env = env; }
  async fetch(request) { return runBenchmark(request, this.env); }
}

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { FEED_URL, MAP_URL, parseFeed, meaningfulState, parseHtmlSummary } from './contract.mjs';
import { writeAtomic } from './runtime/durable-files.mjs';

export const DATA_DIR = new URL('../data/pilot/', import.meta.url);
export const sha256 = body => createHash('sha256').update(body).digest('hex');
export const gzipBytes = body => gzipSync(body, { level: 6 }).byteLength;
export const writeJson = (path, value, options) => writeFile(path, JSON.stringify(value, null, 2) + '\n', options);
export async function writeJsonAtomic(path, value) {
  writeAtomic(path, JSON.stringify(value, null, 2) + '\n');
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return +value * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export async function fetchBounded(url, { fetchImpl = fetch, maxBytes = 10 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  if (![FEED_URL, MAP_URL].includes(url)) throw new Error('Endpoint is not allowlisted');
  const requestedAt = new Date().toISOString();
  const start = performance.now();
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'mlgw-source-pilot/0.1 (+https://github.com/jpbranson)', accept: url === FEED_URL ? 'application/json' : 'text/html' } });
  const selectedHeaders = {};
  for (const key of ['content-type', 'content-length', 'content-encoding', 'date', 'etag', 'last-modified', 'cache-control', 'retry-after']) {
    if (response.headers.has(key)) selectedHeaders[key] = response.headers.get(key);
  }
  const chunks = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} decoded bytes`);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      error.response = { url, requestedAt, receivedAt: new Date().toISOString(), status: response.status,
        headers: selectedHeaders, latencyMs: performance.now() - start, bytes, bodyComplete: false };
      throw error;
    }
    finally { reader.releaseLock(); }
  }
  return { body: Buffer.concat(chunks), url, requestedAt, receivedAt: new Date().toISOString(),
    status: response.status, headers: selectedHeaders, latencyMs: performance.now() - start, bytes };
}

export async function capture(slot, { dir = DATA_DIR, fetchImpl = fetch, diagnostics = true } = {}) {
  await mkdir(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const record = { id, scheduledAt: new Date(slot).toISOString(), observedAt: new Date().toISOString(), status: 'failed', totals: null };
  for (const [name, url] of [['feed', FEED_URL], ['html', MAP_URL]]) {
    try {
      const { body, ...meta } = await fetchBounded(url, { fetchImpl });
      const filename = `${id}.${name === 'feed' ? 'geojson' : 'html'}`;
      await writeFile(new URL(filename, dir), body, { flag: 'wx', flush: true });
      record[name] = { ...meta, file: filename, sha256: sha256(body), gzipBytes: gzipBytes(body) };
      if (meta.status === 401 || meta.status === 403) { record.stopReason = `Source access restricted (${meta.status})`; break; }
      if (meta.status === 429) {
        record.retryAt = new Date(Date.now() + Math.max(300000, retryAfterMs(meta.headers['retry-after']))).toISOString(); break;
      }
      if (meta.status !== 200) { record[name].error = `HTTP ${meta.status}`; continue; }
      if (!diagnostics) { if (name === 'feed') record.status = 'captured'; continue; }
      if (name === 'feed') {
        const parsed = parseFeed(body.toString('utf8'));
        const normalized = Buffer.from(JSON.stringify(parsed.normalized));
        record.normalized = { bytes: normalized.length, gzipBytes: gzipBytes(normalized) };
        record.meaningfulSha256 = sha256(meaningfulState(body.toString('utf8')));
        record.totals = parsed.totals; record.totalsValid = parsed.totalsValid;
        record.issues = parsed.issues; record.featureCount = parsed.featureCount;
        record.status = parsed.totalsValid ? (parsed.issues.length ? 'review' : 'valid') : 'invalid';
        await writeJson(new URL(`${id}.normalized.json`, dir), parsed, { flag: 'wx' });
      } else record.htmlSummary = parseHtmlSummary(body.toString('utf8'));
    } catch (error) {
      record[name] = { ...error.response, ...record[name], error: error.message };
      if ([401, 403].includes(record[name].status)) { record.stopReason = `Source access restricted (${record[name].status})`; break; }
      if (record[name].status === 429) {
        record.retryAt = new Date(Date.now() + Math.max(300000, retryAfterMs(record[name].headers?.['retry-after']))).toISOString(); break;
      }
    }
  }
  if (record.totals?.customers != null && record.htmlSummary?.customers != null) {
    record.comparison = { customersDelta: record.totals.customers - record.htmlSummary.customers,
      retrievalSeparationMs: Date.parse(record.html.receivedAt) - Date.parse(record.feed.receivedAt) };
  }
  await writeJsonAtomic(new URL(`${id}.attempt.json`, dir), record);
  return record;
}

export async function readAttempts(dir = DATA_DIR) {
  const names = (await readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(n => n.endsWith('.attempt.json')).sort();
  return Promise.all(names.map(n => readFile(new URL(n, dir), 'utf8').then(JSON.parse)));
}

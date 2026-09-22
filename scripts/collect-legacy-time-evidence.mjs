// Read-only, bounded acquisition of historical timestamp evidence. Never runs legacy code.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('data/legacy/time-evidence');
await mkdir(root, { recursive: true });
const download = process.argv.includes('--download');
const pins = JSON.parse(await readFile('data/legacy/pins.json', 'utf8')).repositories;
const known = new Set(['mlgw.outage', 'mlgw.outage.2', 'mlgw.outage.3']);
let requests = 0, totalBytes = 0;
const sha = b => createHash('sha256').update(b).digest('hex');
const ledger = [];
async function save(file, bytes) { await writeFile(`${file}.tmp`, bytes); await rename(`${file}.tmp`, file); }
async function cached(repo, suffix, key, raw = false) {
  if (!known.has(repo)) throw Error('Unexpected repository');
  const file = path.join(root, `${repo}.${key}`);
  const url = `${raw ? 'https://raw.githubusercontent.com' : 'https://api.github.com/repos'}/jpbranson/${repo}/${suffix}`;
  let bytes;
  try { bytes = await readFile(file); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!download) throw Error(`Missing cached evidence: ${file}`);
    if (++requests > 45) throw Error('45-request bound reached; resume from verified cache');
    const response = await fetch(url, { headers: { 'User-Agent': 'mlgw-outage-history-audit', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw Error(`HTTP ${response.status} ${url}; rate-limit remaining ${response.headers.get('x-ratelimit-remaining')}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; totalBytes += chunk.length;
      if (size > 8 * 1024 ** 2 || totalBytes > 32 * 1024 ** 2) throw Error('Evidence byte bound reached');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks); await save(file, bytes);
  }
  ledger.push({ url, file: path.relative(process.cwd(), file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) });
  return raw ? bytes.toString('utf8') : JSON.parse(bytes);
}
const histories = [];
for (const pin of pins) {
  if (!known.has(pin.name) || !/^[a-f0-9]{40}$/.test(pin.commit)) throw Error('Invalid pin');
  for (const sourcePath of ['R/job.R', '.github/workflows/schedule-commit.yaml']) {
    const key = sourcePath === 'R/job.R' ? 'job' : 'workflow';
    const history = await cached(pin.name, `commits?sha=${pin.commit}&path=${encodeURIComponent(sourcePath)}&per_page=100`, `${key}-history.json`);
    if (!Array.isArray(history) || history.length >= 100) throw Error('History may be truncated; explicit pagination required');
    histories.push({ repository: pin.name, sourcePath, revisions: history.map(c => ({ commit: c.sha,
      committedAt: c.commit.committer.date, authoredAt: c.commit.author.date, message: c.commit.message,
      parents: c.parents.map(p => p.sha) })) });
    await cached(pin.name, `${pin.commit}/${sourcePath}`, `${key}-tip.txt`, true);
    if (process.argv.includes('--history-content')) {
      for (const commit of history) {
        if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error('Invalid historical commit');
        await cached(pin.name, `${commit.sha}/${sourcePath}`, `${key}-${commit.sha}.txt`, true);
      }
    }
  }
}
await save(path.join(root, 'histories.json'), JSON.stringify(histories, null, 2));
await save(path.join(root, 'acquisition.json'), JSON.stringify({ requests, totalBytes, files: ledger }, null, 2));
console.log(JSON.stringify({requests,totalBytes,histories},null,2));

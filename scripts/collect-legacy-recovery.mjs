// Bounded, resumable downloads of originals needed for timezone recovery. No legacy code execution.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'data/legacy/recovery-evidence';
await mkdir(root + '/captures', { recursive: true });
const download = process.argv.includes('--download');
const started = Date.now(); let requests = 0, bytesDownloaded = 0;
const sha256 = b => createHash('sha256').update(b).digest('hex');
async function save(file, body) { await writeFile(file + '.tmp', body); await rename(file + '.tmp', file); }
async function get(url, file, limit) {
  try { const body = await readFile(file); if (body.length > limit) throw Error('Cached size limit'); return body; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!download) throw Error('Missing original; explicit --download required: ' + file);
  if (++requests > 2200 || Date.now() - started > 10 * 60000) throw Error('Recovery request/time bound; resume from cache');
  const r = await fetch(url, { headers: { 'User-Agent': 'mlgw-outage-history-audit' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(`HTTP ${r.status}: ${url}`);
  const chunks = []; let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length; bytesDownloaded += chunk.length;
    if (size > limit || bytesDownloaded > 64 * 1024 ** 2) throw Error('Recovery byte bound');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks); await save(file, body); return body;
}
const sources = [
  ['mlgw.outage', 'cce0ec570572157bd966f3b33025d8e452df4ea1', 'early-tree', 'git/trees/cce0ec570572157bd966f3b33025d8e452df4ea1?recursive=1'],
  ['mlgw.outage.2', '76a067a69fe033783cfc13005180a8ec2c467895', 'initial-detail', 'commits/76a067a69fe033783cfc13005180a8ec2c467895'],
  ['mlgw.outage.2', '58afff59c3de8d080b62d7ed78efb0ca9b7631b1', 'april26-detail', 'commits/58afff59c3de8d080b62d7ed78efb0ca9b7631b1'],
  ['mlgw.outage.2', '15c24fa1a7eb2c8530468a8e340920f4d194b54e', 'switch-detail', 'commits/15c24fa1a7eb2c8530468a8e340920f4d194b54e'],
  ['mlgw.outage', 'cce0ec570572157bd966f3b33025d8e452df4ea1', 'early-character-history', 'commits?sha=cce0ec570572157bd966f3b33025d8e452df4ea1&path=data%2F2022-12-24_01_08_56.RData&per_page=10'],
];
const metadata = [];
for (const [repo, commit, label, suffix] of sources) {
  const url = `https://api.github.com/repos/jpbranson/${repo}/${suffix}`;
  const file = `${root}/${label}.json`;
  const body = await get(url, file, 24 * 1024 ** 2); const object = JSON.parse(body);
  if (label === 'early-tree' && object.truncated) throw Error('Historical tree is truncated; do not proceed');
  metadata.push({ repository: repo, commit, file, url, sha256: sha256(body), bytes: body.length });
}
await save(root + '/metadata.json', JSON.stringify(metadata, null, 2));
const historicalTree = JSON.parse(await readFile(root + '/early-tree.json', 'utf8'));
const selection = historicalTree.tree.filter(f => f.type === 'blob' && /^data\/2022-12-.*\.RData$/.test(f.path))
  .map(f => ({ repository: 'mlgw.outage', commit: sources[0][1], path: f.path, blob: f.sha, bytes: f.size }));
for (const label of ['initial-detail', 'april26-detail', 'switch-detail']) {
  const commit = JSON.parse(await readFile(`${root}/${label}.json`, 'utf8'));
  for (const f of commit.files.filter(f => f.status === 'added' && f.filename.endsWith('.RData')))
    selection.push({ repository: 'mlgw.outage.2', commit: commit.sha, path: f.filename, blob: f.sha });
}
await save(root + '/selected.json', JSON.stringify(selection, null, 2));
const captures = [];
const pendingBodies = new Map();
if (process.argv.includes('--captures')) {
  const selected = JSON.parse(await readFile(root + '/selected.json', 'utf8'));
  if (selected.length > 2150) throw Error('Selection bound');
  const queue = [...selected];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!['mlgw.outage', 'mlgw.outage.2'].includes(item.repository) || !/^[a-f0-9]{40}$/.test(item.commit)
        || !/^[a-f0-9]{40}$/.test(item.blob) || !/^data\/\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?\.RData$/.test(item.path)) throw Error('Invalid capture selection');
      const local = `${root}/captures/${item.blob}.RData`;
      if (!pendingBodies.has(item.blob)) pendingBodies.set(item.blob,
        get(`https://raw.githubusercontent.com/jpbranson/${item.repository}/${item.commit}/${item.path}`, local, 1024 ** 2));
      const body = await pendingBodies.get(item.blob);
      const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
      if (blob !== item.blob) throw Error('Original blob mismatch: ' + item.path);
      captures.push({ ...item, local, bytes: body.length, sha256: sha256(body) });
      if (captures.length % 200 === 0) console.log('Verified originals:', captures.length);
    }
  }
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => worker()));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  captures.sort((a,b) => a.path.localeCompare(b.path));
  await save(root + '/captures.json', JSON.stringify(captures, null, 2));
  const columns = ['repository', 'commit', 'path', 'blob', 'local'];
  const csv = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  await save(root + '/capture-inputs.csv', [columns.map(csv).join(','), ...captures.map(r => columns.map(k => csv(r[k])).join(','))].join('\n') + '\n');
}
const report = { checkedAt: new Date().toISOString(), requests, bytesDownloaded, capturesVerified: captures.length, metadata };
await save('reports/legacy-recovery-acquisition.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ requests, bytesDownloaded, capturesVerified: captures.length }));

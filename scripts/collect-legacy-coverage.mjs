// Read-only, bounded capture inventory and selected originals. Offline unless --download.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'data/legacy/coverage';
await mkdir(root + '/metadata', { recursive: true });
await mkdir(root + '/originals', { recursive: true });
const download = process.argv.includes('--download');
let requests = 0, networkBytes = 0;
const started = Date.now(), evidence = [];
const sha = (b, a = 'sha256') => createHash(a).update(b).digest('hex');
const blobHash = b => sha(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]), 'sha1');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
async function save(f, b) { await writeFile(f + '.tmp', b); await rename(f + '.tmp', f); }
async function get(url, file, limit) {
  let body;
  try { body = await readFile(file); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!download) throw Error('Missing cached input; --download required: ' + file);
    if (++requests > 600 || Date.now() - started > 10 * 60000) throw Error('Request/time bound reached; resume from cache');
    const response = await fetch(url, { headers: { 'User-Agent': 'mlgw-outage-history-audit' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; networkBytes += chunk.length;
      if (size > limit || networkBytes > 128 * 1024 ** 2) throw Error('Download byte bound');
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks); await save(file, body);
  }
  if (body.length > limit) throw Error('Cached input exceeds limit');
  evidence.push({ url, file, bytes: body.length, sha256: sha(body) });
  return body;
}
async function tree(repo, commit) {
  const api = async (ref, recursive) => JSON.parse(await get(
    `https://api.github.com/repos/jpbranson/${repo}/git/trees/${ref}${recursive ? '?recursive=1' : ''}`,
    `${root}/metadata/${repo}.${ref}.${recursive ? 'recursive' : 'flat'}.json`, 32 * 1024 ** 2));
  const result = await api(commit, true);
  if (!result.truncated) return result.tree.filter(f => f.type === 'blob');
  const files = [], queue = [{ sha: commit, prefix: '' }];
  while (queue.length) {
    const part = queue.shift(), data = await api(part.sha, false);
    if (data.truncated) throw Error('Nonrecursive tree truncated');
    for (const f of data.tree) {
      if (f.type === 'tree') queue.push({ sha: f.sha, prefix: part.prefix + f.path + '/' });
      if (f.type === 'blob') files.push({ ...f, path: part.prefix + f.path });
    }
    if (files.length > 200000) throw Error('Inventory size bound');
  }
  return files;
}
const pins = (await readJson('data/legacy/pins.json')).repositories;
const first = pins.find(p => p.name === 'mlgw.outage');
const head = await readJson('data/legacy/discovery/mlgw.outage.head.json');
if (head.sha !== first.commit || head.parents.length !== 1 || head.commit.message !== 'Delete data directory') throw Error('Deletion evidence changed');
const revisions = pins.map(p => ({ repository: p.name, commit: p.commit, label: 'pinned-tip', cached: `data/legacy/discovery/${p.name}.tree-${p.tree}.json` }));
revisions.push({ repository: first.name, commit: head.parents[0].sha, label: 'before-data-directory-deletion' });
revisions.push({ repository: first.name, commit: 'cce0ec570572157bd966f3b33025d8e452df4ea1', label: 'December-2022-checkpoint', cached: 'data/legacy/recovery-evidence/early-tree.json' });
const jobHistory = await readJson('data/legacy/time-evidence/mlgw.outage.job-history.json');
revisions.push({ repository: first.name, commit: jobHistory.at(-1).sha, label: 'first-scheduled-scraper-source' });
const entries = [], summaries = [];
for (const revision of revisions) {
  let files;
  if (revision.cached) {
    const body = await readFile(revision.cached), data = JSON.parse(body);
    if (data.truncated) throw Error('Cached tree truncated');
    evidence.push({ file: revision.cached, sha256: sha(body), bytes: body.length });
    files = data.tree.filter(f => f.type === 'blob');
  } else files = await tree(revision.repository, revision.commit);
  const selected = files.filter(f => /^data\/\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?(?:\.csv|\.txt|\.RData|_txt\.rds)$/.test(f.path));
  entries.push(...selected.map(f => ({ repository: revision.repository, commit: revision.commit, path: f.path, blob: f.sha, bytes: f.size })));
  summaries.push({ ...revision, allFiles: files.length, captureFiles: selected.length, captureBytes: selected.reduce((s,f) => s+f.size,0), completeTree: true });
}
await save(root + '/inventory.json', JSON.stringify({ scope: 'Three pinned tips, repo1 pre-deletion parent, December 2022 checkpoint and first scheduled scraper source; not every Git revision', revisions: summaries, entries }));
if (process.argv.includes('--samples')) {
  const selection = await readJson(root + '/selected.json');
  if (selection.length > 500) throw Error('Sample bound');
  const known = new Set(entries.map(f => [f.repository,f.commit,f.path,f.blob].join('|')));
  const pending = new Map(), originals = [], queue = [...selection];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      if (!known.has([f.repository,f.commit,f.path,f.blob].join('|'))) throw Error('Sample not in verified inventory');
      const extension = f.path.endsWith('_txt.rds') ? '.rds' : f.path.slice(f.path.lastIndexOf('.'));
      const local = `${root}/originals/${f.blob}${extension}`;
      if (!pending.has(local)) pending.set(local, get(`https://raw.githubusercontent.com/jpbranson/${f.repository}/${f.commit}/${f.path}`, local, 2 * 1024 ** 2));
      const body = await pending.get(local);
      if (body.length !== f.bytes || blobHash(body) !== f.blob) throw Error('Original hash mismatch: ' + f.path);
      originals.push({ ...f, local, sha256: sha(body) });
    }
  }
  const results = await Promise.allSettled(Array.from({ length: 4 }, worker));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  originals.sort((a,b) => (a.repository+a.path).localeCompare(b.repository+b.path));
  await save(root + '/originals.json', JSON.stringify(originals, null, 2));
  const columns = ['repository','commit','path','blob','local'];
  const csv = v => '"' + String(v ?? '').replaceAll('"','""') + '"';
  await save(root + '/sample-inputs.csv', [columns.map(csv).join(','), ...originals.map(f => columns.map(k => csv(f[k])).join(','))].join('\n')+'\n');
}
await save(root + '/evidence.json', JSON.stringify(evidence, null, 2));
const report = { checkedAt: new Date().toISOString(), requests, networkBytes, revisions: summaries };
await save('reports/legacy-coverage-acquisition.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

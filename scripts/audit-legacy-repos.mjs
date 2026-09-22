// Public repository inventory only. Never clones Git history or executes source scripts.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve('data/legacy');
const download = process.argv.includes('--download');
const repos = ['mlgw.outage', 'mlgw.outage.2', 'mlgw.outage.3'];
const hash = (b, algorithm = 'sha256') => createHash(algorithm).update(b).digest('hex');
let networkBytes = 0, requests = 0;
await mkdir(path.join(root, 'discovery'), { recursive: true });
await mkdir(path.join(root, 'originals'), { recursive: true });
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function save(file, bytes) {
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}
async function get(url, limit) {
  if (!download) throw new Error(`Missing local input; use --download explicitly: ${url}`);
  if (++requests > 55) throw new Error('55-request audit bound reached');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'mlgw-outage-history-audit', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(60000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; networkBytes += chunk.length;
    if (size > limit || networkBytes > 256 * 1024 ** 2) throw new Error('Audit download byte bound reached');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function api(repo, suffix, key) {
  const file = path.join(root, 'discovery', `${repo}.${key}.json`);
  try { return await readJson(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const bytes = await get(`https://api.github.com/repos/jpbranson/${repo}${suffix ? `/${suffix}` : ''}`, 24 * 1024 ** 2);
  const result = JSON.parse(bytes);
  await save(file, bytes);
  return result;
}
const pinFile = path.join(root, 'pins.json');
let pins;
try { pins = await readJson(pinFile); } catch (e) {
  if (e.code !== 'ENOENT') throw e;
  pins = { schemaVersion: 1, createdAt: new Date().toISOString(), repositories: [] };
}
for (const repo of repos) {
  if (pins.repositories.some(r => r.name === repo)) continue;
  const meta = await api(repo, '', 'repository');
  const commit = await api(repo, `commits/${encodeURIComponent(meta.default_branch)}`, 'head');
  pins.repositories.push({ name: repo, owner: 'jpbranson', branch: meta.default_branch,
    commit: commit.sha, tree: commit.commit.tree.sha, committedAt: commit.commit.committer.date,
    repositorySizeKiB: meta.size });
  await save(pinFile, JSON.stringify(pins, null, 2));
}

const entries = [], summaries = [];
for (const pin of pins.repositories) {
  const tree = await api(pin.name, `git/trees/${pin.tree}?recursive=1`, `tree-${pin.tree}`);
  let files;
  if (!tree.truncated) files = tree.tree.filter(e => e.type === 'blob');
  else {
    // GitHub can truncate recursive trees. Walk actual subtrees instead of reporting a partial inventory.
    files = [];
    const queue = [{ sha: pin.tree, prefix: '' }];
    while (queue.length) {
      const item = queue.shift();
      const part = await api(pin.name, `git/trees/${item.sha}`, `flat-tree-${item.sha}`);
      if (part.truncated) throw new Error(`Even nonrecursive tree truncated: ${pin.name}/${item.prefix}`);
      for (const entry of part.tree) {
        const name = item.prefix + entry.path;
        if (entry.type === 'tree') queue.push({ sha: entry.sha, prefix: `${name}/` });
        else if (entry.type === 'blob') files.push({ ...entry, path: name });
      }
      if (files.length > 500000) throw new Error('500,000-file repository bound reached');
    }
  }
  const dataFiles = files.filter(f => (f.path.startsWith('data/') && /\.(rds|rdata)$/i.test(f.path))
    || ['total_outages.rds', 'total_parsed_polygons.rds'].includes(f.path));
  const snapshots = dataFiles.filter(f => /\d{4}-\d{2}-\d{2}/.test(f.path));
  const consolidated = dataFiles.filter(f => ['total_outages.rds', 'total_parsed_polygons.rds'].includes(f.path));
  entries.push(...dataFiles.map(f => ({ repository: pin.name, commit: pin.commit, path: f.path,
    blob: f.sha, bytes: f.size })));
  summaries.push({ ...pin, inventoryComplete: true, recursiveTreeWasTruncated: !!tree.truncated,
    allFiles: files.length, dataFiles: dataFiles.length,
    dataBytes: dataFiles.reduce((n, f) => n + f.size, 0),
    datedSnapshotFiles: snapshots.length, samplePaths: snapshots.slice(0, 3).map(f => f.path),
    consolidated: consolidated.map(f => ({ path: f.path, bytes: f.size, blob: f.sha })) });
}
const byBlob = new Map();
for (const file of entries) {
  if (!byBlob.has(file.blob)) byBlob.set(file.blob, []);
  byBlob.get(file.blob).push(file);
}
const crossRepositoryCopies = [...byBlob.values()].filter(a => new Set(a.map(f => f.repository)).size > 1);
const byPath = new Map();
for (const file of entries) {
  if (!byPath.has(file.path)) byPath.set(file.path, []);
  byPath.get(file.path).push(file);
}
const pathConflicts = [...byPath.values()].filter(a => new Set(a.map(f => f.repository)).size > 1
  && new Set(a.map(f => f.blob)).size > 1);
const originals = [];
for (const summary of summaries) {
  for (const file of summary.consolidated) {
    if (file.bytes > 128 * 1024 ** 2) throw new Error(`Consolidated file exceeds per-file bound: ${file.path}`);
    const local = path.join(root, 'originals', `${file.blob}${path.extname(file.path).toLowerCase()}`);
    let bytes;
    try { bytes = await readFile(local); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const url = `https://raw.githubusercontent.com/jpbranson/${summary.name}/${summary.commit}/${file.path}`;
      bytes = await get(url, 128 * 1024 ** 2);
      const gitHash = hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
      if (gitHash !== file.blob || bytes.length !== file.bytes) throw new Error(`Git blob mismatch: ${url}`);
      await save(local, bytes);
    }
    if (bytes.length !== file.bytes || hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1') !== file.blob)
      throw new Error(`Local original mismatch: ${local}`);
    originals.push({ repository: summary.name, commit: summary.commit, ...file,
      sha256: hash(bytes), local: path.relative(process.cwd(), local).replaceAll('\\', '/') });
  }
}
const inventory = { schemaVersion: 1, scope: 'Files reachable from three pinned branch tips; not all Git history',
  repositories: summaries, entries, crossRepositoryCopies, pathConflicts, originals };
await save(path.join(root, 'inventory.json'), JSON.stringify(inventory));
const report = { checkedAt: new Date().toISOString(), scope: inventory.scope, repositories: summaries,
  dataFileReferences: entries.length, uniqueDataBlobs: byBlob.size,
  crossRepositoryDuplicateBlobs: crossRepositoryCopies.length,
  crossRepositoryDuplicateReferences: crossRepositoryCopies.reduce((n, a) => n + a.length - 1, 0),
  samePathDifferentBlob: pathConflicts.length, consolidatedOriginals: originals,
  requests, networkBytes };
await save(path.resolve('reports/legacy-inventory.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

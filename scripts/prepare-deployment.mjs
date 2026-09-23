import { mkdirSync, readdirSync, writeFileSync, existsSync, lstatSync, copyFileSync, linkSync, statfsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Archive } from '../src/durable/archive.mjs';
import { fileHash } from '../src/runtime/file-hash.mjs';

const base = resolve('.'), id = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(process.env.MLGW_EXPORT_ROOT ?? 'data/deployment'), stage = join(output, `release-${id}`);
mkdirSync(stage, { recursive: true });
const codeOnly = process.argv.includes('--code-only');
const files = [], pending = [];
function put(source, relative) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').includes('..')) throw Error('Unsafe bundle path');
  if (lstatSync(source).isSymbolicLink()) throw Error('Migration cannot follow symbolic links');
  const stat = lstatSync(source);
  const link = relative.startsWith('migration/data/collector/archive/') && stat.dev === lstatSync(stage).dev;
  pending.push({ source, relative, bytes: stat.size, link });
}
function tree(relative, destination = relative) {
  const source = join(base, relative);
  if (lstatSync(source).isSymbolicLink()) throw Error('Migration cannot follow symbolic links');
  if (!lstatSync(source).isDirectory()) return put(source, destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    if (/\.lock$|\.tmp$|-wal$|-shm$/.test(entry.name)) throw Error(`Unexpected mutable file in export: ${relative}/${entry.name}`);
    tree(`${relative}/${entry.name}`, `${destination}/${entry.name}`);
  }
}
if (!existsSync('dist/dashboard/index.html')) throw Error('Build the dashboard before preparing a release');
for (const path of ['src', 'scripts', 'config', 'reference', 'deploy', 'dist/dashboard', 'package.json', 'package-lock.json',
  'test', 'workers', 'web', 'e2e', 'playwright.config.ts', 'tsconfig.json', '.node-version', 'requirements-verification.txt']) if(existsSync(path)) tree(path);
// Snapshot a list of complete immutable manifests first, then only referenced
// objects. A concurrently published later capture belongs to the final cutover.
const archive = new Archive('data/collector/archive', { readOnly: true }), selected = codeOnly ? [] : archive.manifests(), keys = new Set();
for (const key of selected) {
  const { manifest } = archive.readManifest(key);
  await archive.parser(manifest);
  for (const body of Object.values(manifest.bodies)) archive.readBody(body);
  for (const path of [key, manifest.parserKey, ...Object.values(manifest.bodies).map(body => body.key)]) keys.add(path);
}
for (const key of [...keys].sort()) put(archive.path(key), `migration/data/collector/archive/${key}`);
if (!codeOnly) for (const path of ['data/legacy/dashboard', 'data/comparisons', 'data/weather/cache']) if(existsSync(path)) tree(path, `migration/${path}`);
const disk = statfsSync(output), total = pending.reduce((n,f)=>n+f.bytes,0);
const stageBytes = pending.filter(f=>!f.link).reduce((n,f)=>n+f.bytes,0);
// Originals are already compressed. Allow an entire additional tarball plus a
// safety margin, and never consume the production 5 GB free-space reserve.
if (disk.bavail * disk.bsize < stageBytes + total * 1.1 + 100000000 + 5000000000) throw Error('Insufficient packaging headroom; production reserve preserved');
for (const item of pending) {
  const source = fileHash(item.source), destination = join(stage,item.relative);
  if (source.bytes !== item.bytes) throw Error(`Source changed during inventory: ${item.relative}`);
  mkdirSync(dirname(destination),{recursive:true});
  if (item.link) linkSync(item.source,destination); else copyFileSync(item.source,destination);
  const copied = fileHash(destination);
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) throw Error(`Source changed during export: ${item.relative}`);
  files.push({path:item.relative,...copied});
}
const manifest = { version: 1, kind: codeOnly ? 'code' : 'backup', id, createdAt: new Date().toISOString(), archiveAttempts: selected.length, files };
writeFileSync(join(stage, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2));
const filename = `mlgw-${id}.tar.gz`, archivePath = join(output, filename);
execFileSync('tar', ['-czf', archivePath, '-C', stage, '.'], { stdio: 'inherit' });
const receipt = { id, filename, stage, archivePath, ...fileHash(archivePath),
  sourceBytes: files.reduce((sum, f) => sum + f.bytes, 0), files: files.length, archiveAttempts: selected.length };
writeFileSync(join(output, 'release.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));

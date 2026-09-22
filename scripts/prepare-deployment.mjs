import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, lstatSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Archive } from '../src/durable/archive.mjs';

const base = resolve('.'), id = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(process.env.MLGW_EXPORT_ROOT ?? 'data/deployment'), stage = join(output, `release-${id}`);
mkdirSync(stage, { recursive: true });
const files = [], digest = bytes => createHash('sha256').update(bytes).digest('hex');
function put(source, relative) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').includes('..')) throw Error('Unsafe bundle path');
  if (lstatSync(source).isSymbolicLink()) throw Error('Migration cannot follow symbolic links');
  const bytes = readFileSync(source), destination = join(stage, relative);
  mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
  const sha256 = digest(bytes);
  if (digest(readFileSync(destination)) !== sha256) throw Error(`Source changed during export: ${relative}`);
  files.push({ path: relative, bytes: bytes.length, sha256 });
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
for (const path of ['src', 'scripts', 'config', 'reference', 'deploy', 'dist/dashboard', 'package.json', 'package-lock.json']) tree(path);
// Snapshot a list of complete immutable manifests first, then only referenced
// objects. A concurrently published later capture belongs to the final cutover.
const archive = new Archive('data/collector/archive', { readOnly: true }), selected = archive.manifests(), keys = new Set();
for (const key of selected) {
  const { manifest } = archive.readManifest(key);
  await archive.parser(manifest);
  for (const body of Object.values(manifest.bodies)) archive.readBody(body);
  for (const path of [key, manifest.parserKey, ...Object.values(manifest.bodies).map(body => body.key)]) keys.add(path);
}
for (const key of [...keys].sort()) put(archive.path(key), `migration/data/collector/archive/${key}`);
for (const path of ['data/legacy/dashboard', 'data/comparisons', 'data/weather/cache']) tree(path, `migration/${path}`);
const manifest = { version: 1, id, createdAt: new Date().toISOString(), archiveAttempts: selected.length, files };
writeFileSync(join(stage, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2));
const filename = `mlgw-${id}.tar.gz`, archivePath = join(output, filename);
execFileSync('tar', ['-czf', archivePath, '-C', stage, '.'], { stdio: 'inherit' });
const bundle = readFileSync(archivePath), receipt = { id, filename, stage, archivePath, sha256: digest(bundle), bytes: bundle.length,
  sourceBytes: files.reduce((sum, f) => sum + f.bytes, 0), files: files.length, archiveAttempts: selected.length };
writeFileSync(join(output, 'release.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));

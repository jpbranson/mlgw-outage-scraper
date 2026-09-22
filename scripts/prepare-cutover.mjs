import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Archive } from '../src/durable/archive.mjs';
const state = JSON.parse(readFileSync('data/collector/run-state.json'));
if (state.stopReason !== 'cloud_cutover') throw Error('Stop local collection and record the cutover before the final export');
for (const path of ['data/collector/run-state.json', 'data/weather/maintenance/state.json']) {
  const { pid } = JSON.parse(readFileSync(path));
  if (!Number.isSafeInteger(pid)) throw Error('Missing local runner identity');
  try { process.kill(pid, 0); throw Error('A source runner is still alive; final export is blocked'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const id = new Date().toISOString().replace(/[:.]/g, '-'), root = resolve('data/deployment', `cutover-${id}`);
mkdirSync(root, { recursive: true }); const files = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function copy(source, path) {
  if (lstatSync(source).isSymbolicLink() || /\.lock$|\.tmp$/.test(source)) throw Error('Mutable or linked migration file');
  if (lstatSync(source).isDirectory()) { for (const name of readdirSync(source)) copy(join(source, name), `${path}/${name}`); return; }
  const bytes = readFileSync(source), target = join(root, path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
  if (sha256(readFileSync(target)) !== sha256(bytes)) throw Error('Cutover source changed');
  files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
}
const archive = new Archive('data/collector/archive', { readOnly: true }), manifests = archive.manifests(), keys = new Set();
for (const key of manifests) {
  const { manifest } = archive.readManifest(key); await archive.parser(manifest);
  for (const body of Object.values(manifest.bodies)) archive.readBody(body);
  for (const path of [key, manifest.parserKey, ...Object.values(manifest.bodies).map(body => body.key)]) keys.add(path);
}
for (const key of keys) copy(archive.path(key), `data/collector/archive/${key}`);
copy('data/weather/live-cache', 'data/weather/live-cache');
const manifest = { version: 1, id, archiveAttempts: manifests.length, files };
writeFileSync(join(root, 'deployment-manifest.json'), JSON.stringify(manifest));
const filename = `cutover-${id}.tar.gz`, archivePath = resolve('data/deployment', filename);
execFileSync('tar', ['-czf', archivePath, '-C', root, '.']);
const bytes = readFileSync(archivePath), receipt = { id, root, filename, archivePath, sha256: sha256(bytes), bytes: bytes.length, files: files.length, archiveAttempts: manifests.length };
writeFileSync('data/deployment/cutover.json', JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));

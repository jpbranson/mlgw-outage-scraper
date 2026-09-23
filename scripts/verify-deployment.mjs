import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileHash } from '../src/runtime/file-hash.mjs';
const root = resolve(process.argv[2] ?? '.'), manifest = JSON.parse(readFileSync(join(root, 'deployment-manifest.json')));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw Error('Invalid deployment manifest');
const paths = new Set();
for (const file of manifest.files) {
  if (paths.has(file.path)) throw Error('Duplicate deployment file'); paths.add(file.path);
  const path = resolve(root, file.path), child = relative(root, path);
  if (!child || child.startsWith('..') || isAbsolute(child) || lstatSync(path).isSymbolicLink()) throw Error('Invalid deployment path');
  const actual = fileHash(path);
  if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw Error(`Deployment checksum failed: ${file.path}`);
}
console.log(JSON.stringify({ id: manifest.id, verifiedFiles: paths.size, archiveAttempts: manifest.archiveAttempts, passed: true }));

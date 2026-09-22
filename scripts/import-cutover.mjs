import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2]), manifest = JSON.parse(readFileSync(join(root, 'deployment-manifest.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (manifest.version !== 1 || existsSync('data/collector/production-state.json')) throw Error('Cutover import is only permitted before production collection starts');
let imported = 0;
for (const file of manifest.files) {
  if (!/^data\/(collector\/archive\/(objects|manifests|parsers)|weather\/live-cache\/[^/]+)\/[a-zA-Z0-9_.-]+$/.test(file.path)) throw Error('Unexpected cutover path');
  const bytes = readFileSync(join(root, file.path));
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw Error('Cutover checksum mismatch');
  const target = resolve(file.path);
  if (existsSync(target)) { if (sha256(readFileSync(target)) !== file.sha256) throw Error('Cutover conflicts with existing evidence'); }
  else { mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(root, file.path), target); imported++; }
}
console.log(JSON.stringify({ imported, checked: manifest.files.length, archiveAttempts: manifest.archiveAttempts }));

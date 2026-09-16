import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { PARSER_VERSION } from '../contract.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BODY = 10 * 1024 * 1024;
export class Archive {
  constructor(root, { readOnly = false } = {}) {
    this.root = resolve(root);
    if (!readOnly) mkdirSync(this.root, { recursive: true });
  }
  path(key) {
    const target = resolve(this.root, key), child = relative(this.root, target);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Archive key escapes root');
    return target;
  }
  put(key, bytes) {
    const target = this.path(key); mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes, { flag: 'wx', flush: true });
    try {
      // Publish a complete immutable file atomically; never replace an object.
      try { linkSync(temp, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!readFileSync(target).equals(Buffer.from(bytes))) throw new Error(`Immutable object conflict: ${key}`);
      }
    } finally { unlinkSync(temp); }
    return key;
  }
  putBody(body) {
    if (body.length > MAX_BODY) throw new Error('Body exceeds archive limit');
    const hash = digest(body), compressed = gzipSync(body, { level: 6 });
    const key = `objects/${hash}.gz`;
    this.put(key, compressed);
    if (!gunzipSync(readFileSync(this.path(key)), { maxOutputLength: MAX_BODY }).equals(body)) throw new Error('Archive verification failed');
    return { key, hash, bytes: body.length, compressedBytes: compressed.length };
  }
  readBody(ref) {
    const body = gunzipSync(readFileSync(this.path(ref.key)), { maxOutputLength: MAX_BODY });
    if (body.length !== ref.bytes || digest(body) !== ref.hash) throw new Error('Archived body checksum mismatch');
    return body;
  }
  stage(record, sourceDir) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(record.id)) throw new Error('Invalid attempt ID');
    const source = readFileSync(new URL('../contract.mjs', import.meta.url));
    const parserHash = digest(source), parserKey = `parsers/${PARSER_VERSION}-${parserHash}.mjs`;
    this.put(parserKey, source);
    const bodies = {};
    for (const name of ['feed', 'html']) {
      if (!record[name]?.file) continue;
      const filename = record[name].file;
      if (filename !== basename(filename) || /[\\/:]/.test(filename)) throw new Error('Unsafe capture filename');
      const path = resolve(sourceDir, filename);
      if (statSync(path).size > MAX_BODY) throw new Error('Capture exceeds archive limit');
      const body = readFileSync(path);
      if (!record[name].sha256 || digest(body) !== record[name].sha256) throw new Error('Source body checksum mismatch');
      bodies[name] = this.putBody(body);
    }
    const manifest = { archiveVersion: 1, record, bodies, parserVersion: PARSER_VERSION, parserHash, parserKey };
    const bytes = Buffer.from(JSON.stringify(manifest));
    const key = `manifests/${record.id}.json`;
    this.put(key, bytes);
    return { manifest, key, hash: digest(bytes) };
  }
  readManifest(key) {
    const bytes = readFileSync(this.path(key)), manifest = JSON.parse(bytes);
    if (manifest.archiveVersion !== 1 || !manifest.record || !manifest.bodies) throw new Error('Unsupported archive manifest');
    return { manifest, key, hash: digest(bytes) };
  }
  async parser(manifest) {
    const path = this.path(manifest.parserKey);
    if (digest(readFileSync(path)) !== manifest.parserHash) throw new Error('Archived parser checksum mismatch');
    return import(pathToFileURL(path).href);
  }
  manifests() {
    const path = join(this.root, 'manifests');
    try { return readdirSync(path).filter(name => name.endsWith('.json')).sort().map(name => `manifests/${name}`); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
}

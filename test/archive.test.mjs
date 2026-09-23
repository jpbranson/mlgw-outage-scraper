import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Archive, digest } from '../src/durable/archive.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'mlgw-archive-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new Archive(root);
}

test('identical bodies reuse Windows and Unix gzip archives without rewriting them', t => {
  const archive = setup(t);
  for (const os of [3, 10]) {
    const body = Buffer.from(`saved on OS ${os}`), stored = gzipSync(body);
    stored[9] = os;
    const key = `objects/${digest(body)}.gz`;
    archive.put(key, stored);
    const ref = archive.putBody(body);
    assert.deepEqual(archive.readBody(ref), body);
    assert.deepEqual(readFileSync(archive.path(key)), stored);
  }
});

test('body reuse reports the stored compression size and keeps manifest retries identical', t => {
  const archive = setup(t), body = Buffer.from('repeated body '.repeat(100));
  const stored = gzipSync(body, { level: 0 }), key = `objects/${digest(body)}.gz`;
  assert.notEqual(stored.length, gzipSync(body, { level: 6 }).length);
  archive.put(key, stored);
  const ref = archive.putBody(body);
  assert.equal(ref.compressedBytes, stored.length);
  assert.deepEqual(archive.readBody(ref), body);
  assert.deepEqual(readFileSync(archive.path(key)), stored);
  archive.put('manifests/retry.json', JSON.stringify(ref));
  archive.put('manifests/retry.json', JSON.stringify(archive.putBody(body)));
});

test('body reuse rejects corrupt, mismatched and oversized stored originals', t => {
  const archive = setup(t);
  for (const [name, stored] of [
    ['corrupt', Buffer.from('not gzip')],
    ['mismatch', gzipSync(Buffer.from('different original'))],
    ['oversized', gzipSync(Buffer.alloc(10 * 1024 * 1024 + 1))],
  ]) {
    const body = Buffer.from(name), key = `objects/${digest(body)}.gz`;
    archive.put(key, stored);
    assert.throws(() => archive.putBody(body));
    assert.deepEqual(readFileSync(archive.path(key)), stored);
  }
});

test('parser and manifest objects still require exact bytes', t => {
  const archive = setup(t);
  for (const key of ['parsers/parser.mjs', 'manifests/attempt.json']) {
    archive.put(key, 'original');
    assert.throws(() => archive.put(key, 'changed'), /Immutable object conflict/);
    assert.equal(readFileSync(archive.path(key), 'utf8'), 'original');
  }
});

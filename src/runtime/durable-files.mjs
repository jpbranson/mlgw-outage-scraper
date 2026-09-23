import { mkdirSync, openSync, closeSync, fsyncSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Windows does not support opening directories with the Node fs API. Linux is
// the production durability boundary; do not silently ignore fsync errors there.
export function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function durableDirectory(directory) {
  const first = mkdirSync(directory, { recursive: true });
  if (first) {
    let current = directory;
    while (true) {
      syncDirectory(current);
      if (current === first) break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    syncDirectory(dirname(first));
  }
}

export function writeAtomic(path, bytes) {
  const target = path instanceof URL ? fileURLToPath(path) : path;
  const directory = dirname(target), temporary = `${target}.${randomUUID()}.tmp`;
  durableDirectory(directory);
  writeFileSync(temporary, bytes, { flag: 'wx', flush: true });
  try {
    renameSync(temporary, target);
    syncDirectory(directory);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

import { openSync, closeSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function fileHash(path) {
  const fd = openSync(path, 'r'), buffer = Buffer.alloc(1024 * 1024), hash = createHash('sha256');
  let bytes = 0;
  try {
    for (let n; (n = readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
      bytes += n; hash.update(buffer.subarray(0, n));
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally { closeSync(fd); }
}

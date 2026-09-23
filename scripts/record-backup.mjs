import { writeAtomic } from '../src/runtime/durable-files.mjs';
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) throw Error('Receipt limit'); }
const r = JSON.parse(input);
if (!/^[0-9TZ-]+$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes <= 0 ||
    r.verified !== true || !Number.isFinite(Date.parse(r.downloadedAt)) || Math.abs(Date.now() - Date.parse(r.downloadedAt)) > 300000) throw Error('Invalid verified backup receipt');
writeAtomic('data/collector/last-backup.json',JSON.stringify(r));

import { mkdirSync, openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('reports', { recursive: true });
const fd = openSync('reports/scheduled-backup.log', 'a');
try { execFileSync(process.execPath, ['scripts/backup-cloud.mjs'], { stdio: ['ignore', fd, fd], windowsHide: true }); }
catch (error) { process.exitCode = error.status || 1; }
finally { closeSync(fd); }

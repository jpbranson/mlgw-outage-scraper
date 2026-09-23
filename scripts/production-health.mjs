import { readFileSync, statfsSync } from 'node:fs';
import { healthIssues, monitoringHeartbeat } from '../src/runtime/health.mjs';
import { logError } from '../src/runtime/logging.mjs';

try {
  const now = Date.now(), config = JSON.parse(readFileSync('config/collector.production.json'));
  const response = await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Dashboard health returned ${response.status}`);
  const dashboard = await response.json();
  const collector = JSON.parse(readFileSync('data/collector/production-state.json'));
  const weather = JSON.parse(readFileSync('data/weather/production/state.json'));
  let backup;
  try { backup = JSON.parse(readFileSync('data/collector/last-backup.json')); }
  catch (error) { if (error.code !== 'ENOENT') logError('health.backup_receipt', error); }
  const disk = statfsSync(config.root), freeBytes = disk.bavail * disk.bsize;
  const issues = healthIssues({ dashboard, collector, weather, backup, freeBytes, minimumFreeBytes: config.minimumFreeDiskBytes, now });
  const monitoring = issues.length ? { configured: Boolean(process.env.HEALTHCHECKS_URL), sent: false }
    : await monitoringHeartbeat(process.env.HEALTHCHECKS_URL);
  console.log(JSON.stringify({ checkedAt: new Date(now).toISOString(), status: issues.length ? 'degraded' : 'ok', latest: dashboard.latest,
    freeBytes, backupAt: backup?.downloadedAt ?? null, issues, monitoring }));
  process.exitCode = issues.length ? 1 : 0;
} catch (error) { logError('production.health', error); process.exitCode = 1; }

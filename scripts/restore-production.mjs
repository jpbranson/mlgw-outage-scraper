import { readFileSync } from 'node:fs';
import { LocalCollector } from '../src/durable/collector.mjs';
const config = JSON.parse(readFileSync(process.env.MLGW_COLLECTOR_CONFIG ?? 'config/collector.production.json'));
if (config.mode !== 'production') throw Error('Production restore requires production configuration');
const collector = new LocalCollector(config.root);
try {
  const results = await collector.recover();
  while (collector.maintain()) { /* regenerate all coverage-aware rollups */ }
  const check = collector.db.prepare('PRAGMA integrity_check').get();
  if (check.integrity_check !== 'ok') throw Error('Restored SQLite index failed its integrity check');
  const health = collector.health();
  console.log(JSON.stringify({ restored: results.length, snapshots: health.snapshots, latest: health.latest, integrity: 'ok' }));
} finally { collector.close(); }

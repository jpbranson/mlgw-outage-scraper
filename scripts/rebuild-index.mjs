import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Archive } from '../src/durable/archive.mjs';
import { LocalCollector } from '../src/durable/collector.mjs';
import { PROJECTION_VERSION } from '../src/durable/projection.mjs';

const source = resolve(process.argv[2] ?? 'data/collector'), destination = resolve(process.argv[3] ?? 'data/rebuild-v2');
if (source === destination || destination.startsWith(source + '/') || destination.startsWith(source + '\\')) throw Error('Rebuild requires a separate destination');
mkdirSync(destination, { recursive: true });
const collector = new LocalCollector(destination, { archive: new Archive(join(source, 'archive'), { readOnly: true }) });
try {
  let restored = 0;
  for (const key of collector.archive.manifests()) {
    const id = key.slice(10, -5);
    if (collector.has(id)) continue;
    const staged = collector.archive.readManifest(key);
    collector.publish(staged, await collector.archive.parser(staged.manifest)); restored++;
  }
  while (collector.maintain()) {}
  if (collector.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Rebuilt index integrity failed');
  const changes = [], counts = { added: 0, removed: 0, changed: 0 };
  if (existsSync(join(source, 'index.sqlite'))) {
    const prior = new DatabaseSync(join(source, 'index.sqlite'), { readOnly: true });
    try {
      const old = new Map(prior.prepare('SELECT s.id,s.slot_ms,s.quality,t.customers,t.outages FROM snapshots s JOIN totals t ON t.snapshot_id=s.id').all().map(r => [r.slot_ms, r]));
      for (const next of collector.db.prepare('SELECT s.id,s.slot_ms,s.quality,t.customers,t.outages FROM snapshots s JOIN totals t ON t.snapshot_id=s.id ORDER BY s.slot_ms').iterate()) {
        const before = old.get(next.slot_ms); old.delete(next.slot_ms);
        if (before?.id === next.id && (before.customers !== next.customers || before.outages !== next.outages)) throw Error(`Same observation changed its totals: ${next.id}`);
        if (JSON.stringify(before) !== JSON.stringify(next)) {
          counts[before ? 'changed' : 'added']++;
          changes.push({ before: before ?? null, after: next });
        }
      }
      for (const before of old.values()) { counts.removed++; changes.push({ before, after: null }); }
    } finally { prior.close(); }
  }
  const report = { projectionVersion: PROJECTION_VERSION, restored, attempts: collector.db.prepare('SELECT COUNT(*) n FROM poll_attempts').get().n,
    snapshots: collector.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n, counts, changes,
    latest: collector.health().latest, integrity: 'ok' };
  collector.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  writeFileSync(join(destination, 'rebuild-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, changes: changes.slice(0, 20) }));
} finally { collector.close(); }

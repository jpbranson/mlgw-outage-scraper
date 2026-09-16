import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { LocalCollector } from '../src/durable/collector.mjs';
import { Archive, digest } from '../src/durable/archive.mjs';
import { makeStressFeed } from '../src/stress.mjs';
import { parseFeed } from '../src/contract.mjs';
import { writeJson } from '../src/pilot-io.mjs';

const root = mkdtempSync(join(tmpdir(), 'mlgw-restore-verification-'));
const source = JSON.parse(readFileSync('test/fixtures/ordinary.geojson', 'utf8'));
const size = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
const results = [];
for (const n of [4000, 10000]) {
  const raw = JSON.stringify(makeStressFeed(source, n)), id = `synthetic-${n}`;
  writeFileSync(join(root, `${id}.geojson`), raw);
  const c = new LocalCollector(join(root, id));
  const at = '2026-09-15T12:00:00.000Z';
  const record = { id, observedAt: at, scheduledAt: at, feed: { status: 200, requestedAt: at, receivedAt: at,
    file: `${id}.geojson`, bytes: Buffer.byteLength(raw), sha256: digest(raw) } };
  const start = performance.now(), cpu = process.cpuUsage();
  c.import(record, root);
  const usage = process.cpuUsage(cpu), importWallMs = performance.now() - start;
  const replayed = await c.replaySnapshot(id);
  assert.deepEqual(replayed.normalized, parseFeed(raw).normalized);
  const dbRows = c.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;
  c.close();
  results.push({ synthetic: true, features: n, dbSnapshotRows: dbRows, importWallMs, localCpuMs: (usage.user + usage.system) / 1000,
    rawBytes: Buffer.byteLength(raw), totalLocalArchiveAndIndexBytes: size(join(root, id)), replayMatches: true });
}

const restored = new LocalCollector(join(root, 'real-capture-restore'), { archive: new Archive('data/collector/archive') });
const recovery = await restored.recover();
while (restored.maintain()) { /* drain day batches */ }
const health = restored.health();
restored.close();
const report = { checkedAt: new Date().toISOString(), verificationDirectory: root, syntheticStress: results,
  realCaptureRestore: { manifestsChecked: recovery.length, snapshotsRestored: health.snapshots, validSnapshots: health.validSnapshots,
    latest: health.latest, pendingRollupDays: health.pendingRollupDays },
  caveat: 'Filesystem and SQLite on this PC only; these timings do not establish cloud-runtime performance or durability.' };
await writeJson('reports/durable-verification.json', report);
console.log(JSON.stringify(report, null, 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { publishLegacy, sha256 } from '../src/dashboard/legacy-publish.mjs';
import { LegacyService } from '../src/dashboard/legacy.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';

const polygon = { type: 'Polygon', coordinates: [[[-90, 35], [-89.9, 35], [-89.9, 35.1], [-90, 35.1], [-90, 35]]] };
function sourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mlgw-legacy-'));
  for (const dir of ['recovered', 'coverage']) mkdirSync(join(root, 'data/legacy', dir), { recursive: true });
  const save = (path, value, zip = false) => {
    const bytes = zip ? gzipSync(value.map(r => JSON.stringify(r)).join('\n') + '\n') : Buffer.from(JSON.stringify(value));
    writeFileSync(join(root, path), bytes); return { path, sha256: sha256(bytes), bytes: bytes.length };
  };
  const times = ['2024-02-01T00:00:00.000000Z', '2024-02-01T00:30:00.123456Z', '2024-02-01T02:31:00.000000Z', '2024-04-01T00:00:00.000000Z', null];
  const totals = times.map((observedAt, i) => ({ sourceFormat: 'legacy_html', sourceTime: 'stored-' + i, observedAt,
    timeStatus: observedAt ? 'resolved' : 'timezone-unresolved', customers: [8, 20, 5, 2, 10][i], outages: [1, 2, 9, 1, 6][i],
    timeRecovery: { method: observedAt ? 'original-POSIXct-epoch' : 'unresolved', originalEpochSeconds: '1706747400.123456' },
    provenance: [{ source: 'fixture/total_outages.rds', firstSourceRow: i + 1, sourceRowCount: 1 }] }));
  const grids = [{ sourceFormat: 'legacy_html', captureKey: 'grid-fixture', gridCellId: '056', observedAt: '2024-02-01T00:30:00.223456Z',
    timeStatus: 'resolved', customers: 12, geometry: polygon, timeRecovery: { method: 'UTC-filename-with-total-anchor', relatedTotalSourceTime: 'stored-1' } }];
  const outputs = { totals: save('data/legacy/recovered/totals.jsonl.gz', totals, true), grids: save('data/legacy/recovered/grids.jsonl.gz', grids, true) };
  const proof = save('data/legacy/recovered/verified.json', { generation: 'fixture', outputHashes: Object.fromEntries(Object.entries(outputs).map(([k,v]) => [k,v.sha256])),
    sourceAndGeometryPreserved: true, strictUTCOrder: true, independentRVerified: true,
    statistics: { totals: { recordsPreserved: 5, resolvedRecords: 4, unresolvedRecords: 1 }, grids: { recordsPreserved: 1 } } });
  save('data/legacy/recovered/catalog.json', { version: 'legacy-time-recovery-v1', generation: 'fixture', verified: true, outputs, verification: proof.path, verificationSha256: proof.sha256 });
  const files = {};
  const coverageSave = (name, value) => { files[name] = save('data/legacy/coverage/' + name, value); };
  coverageSave('timeline-gaps.json', { thresholdSeconds: 3600, totals: [{ after: times[1], before: times[2], secondsBetweenObservations: 7260 }], grids: [] });
  coverageSave('totals-without-capture.json', [totals[0], totals[4]]);
  coverageSave('sample-verification.json', { independentInventoryVerified: true, allEmptyEventCaptures: 2, allEmptyCapturesWithVerifiedEmptyHead: 1,
    blankSavedHeads: [], rejectedSavedHeads: [{ repository: 'fixture', captureKey: 'rejected' }], nonemptyOriginalsAbsentFromConsolidated: [{ repository: 'fixture', captureKey: 'unreconciled' }], missingSavedPages: [] });
  save('data/legacy/coverage/catalog.json', { version: 'legacy-coverage-v1', verified: true, recoveredGeneration: 'fixture', files, scope: 'Synthetic test data' });
  return { root, totals, grids };
}
async function setup(t) {
  const fixture = sourceFixture(), publication = await publishLegacy({ projectRoot: fixture.root });
  const root = join(fixture.root, 'data/legacy/dashboard'), service = new LegacyService(root);
  t.after(() => service.close()); return { ...fixture, projectRoot: fixture.root, publication, root, service };
}
const params = (from = '2024-02-01T00:00:00Z', to = '2024-02-02T00:00:00Z', resolution = 'observations') => new URLSearchParams({ from, to, resolution });

test('legacy publication preserves exact times and polygons, excludes unresolved records, and opens read-only', async t => {
  const { service, publication, totals } = await setup(t);
  assert.deepEqual(publication.counts, { totals: 4, gridSnapshots: 1, gridCells: 1 });
  assert.throws(() => service.db.exec('DELETE FROM observations'), /readonly/);
  const rows = service.snapshots('2024-02-01').snapshots;
  assert.equal(rows.length, 3); assert.equal(rows[1].capturedAt, totals[1].observedAt);
  const snapshot = service.snapshot(rows[1].id);
  assert.deepEqual(snapshot.detail.geojson.features[0].geometry, polygon);
  assert.equal(snapshot.detail.geojson.features[0].properties.gridCellId, '056');
  assert.equal(snapshot.detail.geojson.features[0].properties.customers, 12);
  assert.equal(snapshot.summary.customers, 20); // Never equate the grid sum with the regional total.
  assert.equal(snapshot.detail.capturedAt, '2024-02-01T00:30:00.223456Z');
  assert.equal(snapshot.recovery.originalEpochSeconds, '1706747400.123456');
  assert.equal(service.catalog().unresolved[0].sourceTime, 'stored-4');
  assert.equal(service.catalog().coverage.emptyEventCaptures, 2);
  assert.equal(service.catalog().months.find(m => m.month === '2024-03').totals, 0);
  assert.equal(service.snapshot(rows[0].id).detail.available, false);
  assert.match(service.snapshot(rows[0].id).originalAvailability, /no candidate/);
  assert.equal(service.snapshot(rows[1].id).summary.sharpRise, undefined);
});
test('legacy gaps stay null, empty months stay unknown, and independent daily peaks select the right capture', async t => {
  const { service } = await setup(t), result = service.series(params());
  assert.deepEqual(result.points.map(p => p.customers), [8, 20, null, 5]);
  assert.equal(result.coverage, null); assert.equal(result.source.format, 'legacy_html');
  const daily = service.series(params('2024-02-01T00:00:00Z', '2024-02-03T00:00:00Z', 'daily'));
  assert.deepEqual(daily.points.map(p => p.customers), [20, null]);
  const peak = daily.points[0]; assert.notEqual(peak.id, peak.outageId);
  assert.equal(service.snapshot(peak.id).summary.customers, 20); assert.equal(service.snapshot(peak.outageId).summary.outages, 9);
  const empty = service.series(params('2024-03-01T00:00:00Z', '2024-04-01T00:00:00Z', 'daily'));
  assert.equal(empty.observedSnapshots, 0); assert.equal(empty.points.length, 31); assert.ok(empty.points.every(p => p.customers === null));
  assert.equal(empty.gaps.length, 1); assert.match(empty.gaps[0].reason, /Over one hour/);
  assert.equal(empty.gaps[0].from, Date.parse('2024-03-01T00:00:00Z'));
  assert.equal(empty.gaps[0].to, Date.parse('2024-04-01T00:00:00Z'));
  assert.deepEqual(service.snapshots('2024-03-01').snapshots, []);
});
test('legacy input and query limits reject unsupported ranges, bad dates and mixed-source IDs', async t => {
  const { service } = await setup(t);
  for (const date of ['2024-02-30', '2024-2-01', '../data']) assert.throws(() => service.snapshots(date));
  for (const id of ['current-capture', '../totals', 'legacy-' + '0'.repeat(24)]) assert.throws(() => service.snapshot(id));
  assert.throws(() => service.series(params('2024-02-01T00:00:00Z', '2024-04-01T00:00:00Z', 'daily')), /31 days/);
  assert.throws(() => service.series(params('2024-02-01T00:00:00Z', '2024-02-04T00:00:00Z')), /two days/);
  assert.throws(() => service.series(params('2024-02-01T00:00:00', '2024-02-02T00:00:00Z')), /UTC/);
  assert.throws(() => service.series(params('2024-02-30T00:00:00Z', '2024-03-02T00:00:00Z')), /UTC/);
});
test('publication is reproducible and rejects changed or unverified inputs without replacing the active catalog', async t => {
  const { root, publication, service, ...fixture } = await setup(t);
  const replay = await publishLegacy({ projectRoot: fixture.projectRoot }); assert.equal(replay.index.sha256, publication.index.sha256);
  const catalogPath = join(root, 'catalog.json'), before = readFileSync(catalogPath);
  const recoveredPath = join(fixture.projectRoot, 'data/legacy/recovered/catalog.json'), recovered = JSON.parse(readFileSync(recoveredPath));
  recovered.verified = false; writeFileSync(recoveredPath, JSON.stringify(recovered));
  await assert.rejects(publishLegacy({ projectRoot: fixture.projectRoot }), /verified/);
  recovered.verified = true; writeFileSync(recoveredPath, JSON.stringify(recovered));
  writeFileSync(join(fixture.projectRoot, recovered.outputs.totals.path), 'tampered');
  await assert.rejects(publishLegacy({ projectRoot: fixture.projectRoot }), /hash mismatch/);
  assert.deepEqual(readFileSync(catalogPath), before); assert.equal(service.catalog().counts.totals, 4);
});
test('unavailable or corrupt publication fails closed without a fake empty archive', async t => {
  const { root, publication } = await setup(t);
  const missing = new LegacyService(join(root, 'missing')); assert.throws(() => missing.catalog(), /unavailable/);
  // Use a separate copied corrupt index so the open service retains its original file.
  writeFileSync(join(root, 'bad.sqlite'), 'not a database');
  writeFileSync(join(root, 'catalog.json'), JSON.stringify({ ...publication, index: { ...publication.index, path: 'bad.sqlite' } }));
  const corrupt = new LegacyService(root); assert.throws(() => corrupt.catalog(), /unavailable/);
});
test('legacy HTTP routes preserve source labels, export polygons only when available and keep writes/archive paths blocked', async t => {
  const { service, root } = await setup(t);
  const server = createDashboardServer({ health: () => ({ source: { format: 'current_geojson' } }) }, { staticRoot: root, tiles: '', legacy: service });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const rows = service.snapshots('2024-02-01').snapshots;
  const snapshot = await fetch(url + '/api/legacy/snapshot/' + rows[1].id); assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).source.format, 'legacy_html');
  assert.equal((await (await fetch(url + '/api/health')).json()).source.format, 'current_geojson');
  const csv = await (await fetch(url + '/api/legacy/export.csv?' + params())).text(); assert.match(csv, /legacy_html/); assert.match(csv, /2024-02-01T00:30:00.123456Z/);
  assert.equal((await fetch(url + '/api/legacy/export.geojson?id=' + rows[0].id)).status, 409);
  const map = await (await fetch(url + '/api/legacy/export.geojson?id=' + rows[1].id)).json(); assert.deepEqual(map.features[0].geometry, polygon);
  assert.equal((await fetch(url + '/api/legacy/catalog', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/api/legacy/catalog', { headers: { Origin: 'https://example.com' } })).status, 403);
  for (const path of ['/data/legacy/dashboard/catalog.json', '/api/legacy/admin', '/api/legacy/prepare']) assert.equal((await fetch(url + path)).status, 404);
});

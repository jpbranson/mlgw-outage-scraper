import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialHistory, locationCell, SpatialLimitError } from '../src/dashboard/spatial.mjs';

const base = Date.parse('2026-09-16T12:00:00Z'), minute = 60000;
const start = '2026-09-16T11:00:00Z', here = [-89.99, 35.151];
function feature(id, customers = 10, coordinates = here, utc = start) {
  return { id, geometry: coordinates ? { type: 'Point', coordinates } : null,
    properties: { customers, started: { utc, raw: utc ? null : 'ambiguous source time' } } };
}
async function history(captures, options = {}) {
  const rows = captures.map((features, i) => ({ id: String(i), at: base + i * 5 * minute, outages: features?.length ?? 1 }));
  return spatialHistory({ rows, from: base, to: base + 60 * minute,
    readDetail: async row => captures[Number(row.id)] === null ? { available: false } :
      { available: true, geojson: { features: captures[Number(row.id)] } },
    comparable: (a, b) => b.at - a.at <= 7.5 * minute, ...options });
}

test('historical cells count reported events once and keep the peak simultaneous customer count', async () => {
  const result = await history([[feature('a', 10), feature('b', 20)], [feature('a', 50)], [feature('a', 20)]]);
  assert.equal(result.reportedEvents, 2); assert.equal(result.mappedEvents, 2);
  assert.equal(result.cells.length, 1); assert.equal(result.cells[0].events, 2);
  assert.equal(result.cells[0].observations, 4); assert.equal(result.cells[0].peakCustomers, 50);
  assert.equal(result.cells[0].firstSeenAt, base); assert.equal(result.cells[0].lastSeenAt, base + 10 * minute);
  assert.equal(result.uncertainEvents, 0); assert.equal(result.coverage, 10 / 60);
});
test('a moving source event remains one event globally and is flagged in both cells', async () => {
  const result = await history([[feature('a')], [feature('a', 10, [-89.97, 35.151])]]);
  assert.equal(result.reportedEvents, 1); assert.equal(result.mappedEvents, 1); assert.equal(result.cells.length, 2);
  assert.equal(result.uncertainEvents, 1);
  assert.ok(result.cells.every(cell => cell.events === 1 && cell.uncertainEvents === 1));
});
test('changed starts, reappearance and ambiguous starts stay provisional', async () => {
  const changed = await history([[feature('a')], [feature('a', 10, here, '2026-09-16T11:05:00Z')]]);
  assert.equal(changed.reportedEvents, 2); assert.equal(changed.uncertainEvents, 2);
  const returned = await history([[feature('a')], [], [feature('a')]]);
  assert.equal(returned.reportedEvents, 1); assert.equal(returned.uncertainEvents, 1);
  const ambiguous = await history([[feature('a', 10, here, null)], [feature('a', 20, here, null)]]);
  assert.equal(ambiguous.reportedEvents, 1); assert.equal(ambiguous.uncertainEvents, 1);
});
test('missing archive evidence and capture gaps cannot imply continuous coverage', async () => {
  const missing = await history([[feature('a')], null, [feature('a')], [feature('a')]]);
  assert.equal(missing.captures, 4); assert.equal(missing.verifiedCaptures, 3); assert.equal(missing.unavailableCaptures, 1);
  assert.equal(missing.coverage, 5 / 60); assert.equal(missing.uncertainEvents, 1);
  const gap = await history([[feature('a')], [feature('a')]], { comparable: () => false });
  assert.equal(gap.coverage, 0); assert.equal(gap.uncertainEvents, 1);
});
test('zero outages, missing detail and unmapped events remain distinguishable', async () => {
  const zero = await history([[]]), absent = await history([null]);
  assert.equal(zero.verifiedCaptures, 1); assert.equal(zero.reportedEvents, 0); assert.equal(zero.cells.length, 0);
  assert.equal(absent.verifiedCaptures, 0); assert.equal(absent.unavailableCaptures, 1);
  assert.equal(absent.firstVerifiedAt, null); assert.equal(absent.lastVerifiedAt, null);
  const unmapped = await history([[feature('a', 10, null), feature('b', 20, [-95, 40])]]);
  assert.equal(unmapped.reportedEvents, 2); assert.equal(unmapped.mappedEvents, 0);
  assert.equal(unmapped.unmappedObservations, 2); assert.equal(unmapped.cells.length, 0);
});
test('grid membership is stable for nearby points and covers both sides of its origin', () => {
  const cell = locationCell(here);
  assert.equal(locationCell([-89.9901, 35.1511]).id, cell.id);
  assert.equal(locationCell(cell.center).id, cell.id);
  const west = locationCell([-90.001, 35.149]);
  assert.equal(west.id, '-1:-1'); assert.equal(locationCell(west.center).id, west.id);
  for (const invalid of [null, [], ['-90', 35], [-90, NaN], [-91, 35], [-90, 36]]) assert.equal(locationCell(invalid), null);
});
test('work limits fail explicitly instead of returning a partial historical map', async () => {
  await assert.rejects(history([[feature('a'), feature('b')]], { maxObservations: 1 }), SpatialLimitError);
  await assert.rejects(history([[feature('a'), feature('b')]], { maxEvents: 1 }), SpatialLimitError);
  await assert.rejects(history([[feature('a')]], { maxMillis: -1 }), SpatialLimitError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CensusAreas, geometryPosition } from '../src/dashboard/census.mjs';
import { spatialHistory } from '../src/dashboard/spatial.mjs';

const ring = (x, y, width = 1) => [[x, y], [x + width, y], [x + width, y + width], [x, y + width], [x, y]];
const area = (id, x, population, populationMoe = 10) => ({ type: 'Feature', id, properties: { name: `Area ${id}`, population, populationMoe },
  geometry: { type: 'Polygon', coordinates: [ring(x, 0)] } });
const dataset = features => ({ type: 'FeatureCollection', metadata: { populationYear: 2024, boundaryYear: 2024 }, features });
const empty = { cells: [], verifiedCaptures: 1 };

test('point assignment handles holes, multipart polygons and exact boundaries', () => {
  const polygon = { type: 'Polygon', coordinates: [ring(0, 0, 4), ring(1, 1)] };
  assert.equal(geometryPosition([.5, .5], polygon), 1);
  assert.equal(geometryPosition([1.5, 1.5], polygon), 0);
  assert.equal(geometryPosition([0, .5], polygon), 2);
  assert.equal(geometryPosition([1, 1.5], polygon), 2);
  assert.equal(geometryPosition([5, 5], polygon), 0);
  const islands = { type: 'MultiPolygon', coordinates: [[ring(0, 0)], [ring(3, 3)]] };
  assert.equal(geometryPosition([3.5, 3.5], islands), 1);
  assert.equal(geometryPosition([2, 2], islands), 0);
});
test('Census assignment uses the original point and leaves ambiguous/outside points unassigned', () => {
  const areas = new CensusAreas(dataset([area('a', 0, 1000), area('b', 1, 2000)]));
  assert.deepEqual(areas.locate([.9999, .5]), { id: 'a' });
  assert.deepEqual(areas.locate([1.0001, .5]), { id: 'b' });
  for (const point of [[1, .5], [4, .5], [NaN, .5], null]) assert.equal(areas.locate(point), null);
  const overlapping = new CensusAreas(dataset([area('a', 0, 1000), area('b', .5, 2000)]));
  assert.equal(overlapping.locate([.75, .5]), null);
});
test('per-capita rates divide by residents, retain MOE and distinguish zero from missing', () => {
  const areas = new CensusAreas(dataset([area('a', 0, 2000, 700), area('b', 1, 0), area('c', 2, null), area('d', 3, 1000)]));
  const result = areas.normalize({ ...empty, cells: [{ id: 'a', events: 3, peakCustomers: 50, firstSeenAt: 1, lastSeenAt: 2, uncertainEvents: 1 }] });
  const [a, b, c, d] = result.cells;
  assert.equal(a.eventsPer1000, 1.5); assert.equal(a.customersPer1000, 25);
  assert.equal(a.populationMoe, 700); assert.equal(a.populationUncertain, true);
  assert.equal(a.uncertainEvents, 1);
  assert.equal(b.eventsPer1000, null); assert.equal(c.eventsPer1000, null);
  assert.equal(d.eventsPer1000, 0); assert.equal(d.events, 0);
  assert.equal(areas.normalize({ ...empty, verifiedCaptures: 0 }).cells[3].eventsPer1000, null);
});
test('block-group aggregation deduplicates events and computes simultaneous customer peaks before normalizing', async () => {
  const areas = new CensusAreas(dataset([area('a', 0, 1000), area('b', 1, 2000)]));
  const feature = (id, x, customers) => ({ id, geometry: { type: 'Point', coordinates: [x, .5] }, properties: { customers, started: { utc: '2026-09-16T10:00:00Z' } } });
  const snapshots = [[feature('one', .4, 10), feature('two', .6, 20)], [feature('one', .4, 50)], [feature('one', 1.1, 30)]];
  const result = areas.normalize(await spatialHistory({ rows: snapshots.map((features, at) => ({ at, outages: features.length })), from: 0, to: 3,
    readDetail: async row => ({ available: true, geojson: { features: snapshots[row.at] } }), comparable: () => true, locate: point => areas.locate(point) }));
  assert.equal(result.reportedEvents, 2); assert.equal(result.mappedEvents, 2);
  assert.equal(result.cells[0].events, 2); assert.equal(result.cells[0].peakCustomers, 50);
  assert.equal(result.cells[0].customersPer1000, 50);
  assert.equal(result.cells[1].eventsPer1000, .5); assert.equal(result.cells[1].customersPer1000, 15);
  assert.equal(result.cells[0].uncertainEvents, 1); assert.equal(result.cells[1].uncertainEvents, 1);
});
test('bundled official data reconciles 685 block groups to Shelby County population', () => {
  const areas = new CensusAreas(), data = areas.data;
  assert.equal(data.metadata.populationYear, 2024); assert.equal(data.metadata.boundaryYear, 2024);
  assert.equal(data.features.length, 685); assert.equal(new Set(data.features.map(f => f.id)).size, 685);
  assert.ok(data.features.every(f => /^47157\d{7}$/.test(f.id)));
  assert.equal(data.features.reduce((n, f) => n + f.properties.population, 0), data.metadata.countyPopulation);
  assert.equal(data.metadata.countyPopulation, 919173);
  assert.ok(areas.locate([-89.99, 35.15])?.id.startsWith('47157'));
  assert.equal(areas.locate([-90.3, 35.15]), null);
});

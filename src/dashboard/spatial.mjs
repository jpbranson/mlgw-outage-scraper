import { setImmediate as yieldTurn } from 'node:timers/promises';

const R = 6371008.8, RAD = Math.PI / 180;
const LAT0 = 35.15, LON0 = -90, CELL = 1000;
const X_SCALE = R * RAD * Math.cos(LAT0 * RAD), Y_SCALE = R * RAD;
export const SPATIAL_GRID = { id: 'memphis-equirectangular-1km-v1', cellMeters: CELL,
  referenceLatitude: LAT0, originLongitude: LON0, originLatitude: LAT0 };
export class SpatialLimitError extends Error {}

export function locationCell(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  const [lng, lat] = coordinates;
  if (![lng, lat].every(Number.isFinite) || lng < -90.4 || lng > -89.3 || lat < 34.7 || lat > 35.7) return null;
  const x = Math.floor((lng - LON0) * X_SCALE / CELL), y = Math.floor((lat - LAT0) * Y_SCALE / CELL);
  return { id: `${x}:${y}`, center: [LON0 + (x + .5) * CELL / X_SCALE, LAT0 + (y + .5) * CELL / Y_SCALE] };
}

// Each source ID/start pair is provisional, not a confirmed unique incident.
// Deduplicate repeated polls within each fixed cell; never sum customer counts over time.
export async function spatialHistory({ rows, from, to, readDetail, comparable, locate = locationCell,
  maxObservations = 1000000, maxEvents = 50000, maxMillis = 10000 }) {
  if (rows.reduce((n, row) => n + row.outages, 0) > maxObservations)
    throw new SpatialLimitError('Too many observations for one historical map. Choose a shorter period, such as 6h.');
  const began = performance.now(), cells = new Map(), events = new Map(), ids = new Map();
  let verifiedCaptures = 0, unavailableCaptures = 0, unmappedObservations = 0, coveredMs = 0, previous = null;
  let firstVerifiedAt = null, lastVerifiedAt = null;
  for (let index = 0; index < rows.length; index++) {
    if (performance.now() - began > maxMillis)
      throw new SpatialLimitError('Historical replay exceeded the local time limit. Choose a shorter period.');
    const row = rows[index], detail = await readDetail(row);
    if (performance.now() - began > maxMillis)
      throw new SpatialLimitError('Historical replay exceeded the local time limit. Choose a shorter period.');
    if (!detail.available) { unavailableCaptures++; previous = null; continue; }
    verifiedCaptures++;
    firstVerifiedAt ??= row.at; lastVerifiedAt = row.at;
    const continuous = previous && comparable(previous, row);
    if (continuous) coveredMs += row.at - Math.max(from, previous.at);
    previous = row;
    const customersThisCapture = new Map();
    for (const feature of detail.geojson.features) {
      const start = feature.properties.started;
      const key = JSON.stringify([feature.id, start.utc ?? start.raw ?? null]);
      let event = events.get(key);
      if (!event) {
        if (events.size >= maxEvents) throw new SpatialLimitError('Too many reported events. Choose a shorter period.');
        event = { uncertain: !start.utc, lastIndex: index, cells: new Set() };
        events.set(key, event);
        if (!ids.has(feature.id)) ids.set(feature.id, new Set());
        const variants = ids.get(feature.id); variants.add(key);
        if (variants.size > 1) for (const variant of variants) events.get(variant).uncertain = true;
      }
      // Absence, gaps or a changed source start time make identity uncertain.
      if (event.lastIndex < index && (!continuous || event.lastIndex < index - 1)) event.uncertain = true;
      event.lastIndex = index;
      const location = locate(feature.geometry?.coordinates);
      if (!location) { unmappedObservations++; continue; }
      event.cells.add(location.id);
      if (event.cells.size > 1) event.uncertain = true;
      let cell = cells.get(location.id);
      if (!cell) {
        cell = { ...location, keys: new Set(), firstSeenAt: row.at, lastSeenAt: row.at,
          peakCustomers: 0, observations: 0 };
        cells.set(location.id, cell);
      }
      cell.keys.add(key); cell.lastSeenAt = row.at; cell.observations++;
      customersThisCapture.set(cell.id, (customersThisCapture.get(cell.id) ?? 0) + feature.properties.customers);
    }
    for (const [id, customers] of customersThisCapture) cells.get(id).peakCustomers = Math.max(cells.get(id).peakCustomers, customers);
    if (index % 8 === 0) await yieldTurn();
  }
  const resultCells = [...cells.values()].map(({ keys, ...cell }) => ({ ...cell, events: keys.size,
    uncertainEvents: [...keys].filter(key => events.get(key).uncertain).length }));
  return { from, to, grid: SPATIAL_GRID, cells: resultCells.sort((a, b) => b.events - a.events || a.id.localeCompare(b.id)),
    reportedEvents: events.size, uncertainEvents: [...events.values()].filter(e => e.uncertain).length,
    mappedEvents: [...events.values()].filter(e => e.cells.size).length, captures: rows.length,
    verifiedCaptures, unavailableCaptures, unmappedObservations, firstVerifiedAt, lastVerifiedAt,
    coverage: coveredMs / (to - from),
    meaning: 'Distinct provisional source ID/start pairs per approximately 1 km cell. Repeated polls count once. A moving event may appear in several cells. Counts are not confirmed separate incidents or unique households. Missing history is unknown.' };
}

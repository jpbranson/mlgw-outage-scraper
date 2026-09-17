import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Returns outside / inside / on boundary. Shared boundaries are left unassigned.
function ringPosition([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return 2;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 1 : 0;
}
export function geometryPosition(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let boundary = false;
  for (const rings of polygons) {
    const outer = ringPosition(point, rings[0]);
    if (outer === 2) { boundary = true; continue; }
    if (!outer) continue;
    let inHole = false;
    for (const hole of rings.slice(1)) {
      const pos = ringPosition(point, hole);
      if (pos) { inHole = true; if (pos === 2) boundary = true; break; }
    }
    if (!inHole) return 1;
  }
  return boundary ? 2 : 0;
}
const gridKey = ([lng, lat]) => `${Math.floor(lng * 50)}:${Math.floor(lat * 50)}`;
export class CensusAreas {
  constructor(data = JSON.parse(gunzipSync(readFileSync(new URL('../../reference/shelby-block-groups-2024.json.gz', import.meta.url))).toString('utf8'))) {
    this.data = data; this.bins = new Map(); this.cache = new Map();
    for (const feature of data.features) {
      const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
      for (const [x, y] of coords) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
      for (let x = Math.floor(west * 50); x <= Math.floor(east * 50); x++) for (let y = Math.floor(south * 50); y <= Math.floor(north * 50); y++) {
        const key = `${x}:${y}`;
        if (!this.bins.has(key)) this.bins.set(key, []);
        this.bins.get(key).push(feature);
      }
    }
  }
  locate(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null;
    const key = coordinates.join(',');
    if (this.cache.has(key)) return this.cache.get(key);
    const matches = (this.bins.get(gridKey(coordinates)) ?? []).filter(f => geometryPosition(coordinates, f.geometry) !== 0);
    const match = matches.length === 1 && geometryPosition(coordinates, matches[0].geometry) === 1 ? { id: matches[0].id } : null;
    if (this.cache.size >= 100000) this.cache.clear();
    this.cache.set(key, match); return match;
  }
  normalize(history) {
    const observed = new Map(history.cells.map(cell => [cell.id, cell]));
    const cells = this.data.features.map(feature => {
      const cell = observed.get(feature.id), { population, populationMoe, name } = feature.properties;
      const known = history.verifiedCaptures > 0, events = known ? cell?.events ?? 0 : null, peakCustomers = known ? cell?.peakCustomers ?? 0 : null;
      const validPopulation = Number.isFinite(population) && population > 0;
      return { id: feature.id, name, population, populationMoe, events, peakCustomers,
        eventsPer1000: known && validPopulation ? events * 1000 / population : null,
        customersPer1000: known && validPopulation ? peakCustomers * 1000 / population : null,
        firstSeenAt: cell?.firstSeenAt ?? null, lastSeenAt: cell?.lastSeenAt ?? null,
        uncertainEvents: cell?.uncertainEvents ?? 0,
        populationUncertain: validPopulation && (populationMoe == null || populationMoe / population >= .3) };
    });
    return { ...history, grid: null, geography: 'block-group', census: this.data.metadata, cells,
      meaning: 'Observed provisional events, or peak simultaneous customers, assigned by approximate reported point to 2024 Shelby County Census block groups and divided by 2020–2024 ACS estimated residents. Repeated polls count once. Customers are utility accounts, not people. This is a location-based proxy, not the fraction of residents affected; outages can serve customers across boundaries. Outside-county, boundary-ambiguous and unusable locations are excluded. Missing history is unknown.' };
  }
}

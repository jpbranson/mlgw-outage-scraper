import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LEGACY_VERSION, verifiedBytes } from './legacy-publish.mjs';
import { RequestError, DAY } from './service.mjs';

const HOUR = 3600000;
const SELECT = `SELECT o.id,o.at,o.observed_at AS capturedAt,o.customers,o.outages,g.capture_key AS gridCaptureKey
  FROM observations o LEFT JOIN grids g ON g.total_id=o.id`;
export const LEGACY_SOURCE = { name: 'MLGW legacy HTML archive', format: 'legacy_html',
  meaning: 'Regional totals and geographic grid polygons from the old map. Separate from current GeoJSON points; no shared incident IDs or anomaly baseline.' };
const dateRange = date => {
  if (!/^\d{4}-\d\d-\d\d$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new RequestError('Choose a valid legacy archive date (UTC).');
  return Date.parse(date + 'T00:00:00Z');
};
function range(params) {
  const parse = key => {
    const value = params.get(key) ?? '', at = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 19) === value.slice(0, 19) ? at : NaN;
  };
  const from = parse('from'), to = parse('to'), resolution = params.get('resolution') ?? 'daily';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 31 * DAY)
    throw new RequestError('Choose an increasing UTC range of at most 31 days.');
  if (!['daily', 'observations'].includes(resolution) || (resolution === 'observations' && to - from > 2 * DAY))
    throw new RequestError('Use daily peaks, or observations for a range of at most two days.');
  return { from, to, resolution };
}
export class LegacyService {
  constructor(root) {
    // Failure is isolated to legacy routes; the current collector view still opens.
    try {
      const catalog = JSON.parse(readFileSync(join(root, 'catalog.json')));
      if (catalog.version !== LEGACY_VERSION || catalog.verified !== true) throw new Error('Unverified publication');
      verifiedBytes(root, catalog.index);
      this.db = new DatabaseSync(join(root, catalog.index.path), { readOnly: true });
      this.metadata = JSON.parse(this.db.prepare('SELECT json FROM metadata').get().json);
      if (this.metadata.version !== LEGACY_VERSION || this.metadata.generation !== catalog.generation) throw new Error('Generation mismatch');
    } catch {
      this.close(); this.db = null;
    }
  }
  close() { this.db?.close(); }
  ready() { if (!this.db) throw new RequestError('Verified legacy archive unavailable. Run npm run legacy:prepare and restart the dashboard.', 503); }
  catalog() { this.ready(); return { ...this.metadata, source: LEGACY_SOURCE }; }
  rows(from, to) {
    this.ready();
    const rows = this.db.prepare(`${SELECT} WHERE o.at>=? AND o.at<? ORDER BY o.at,o.observed_at LIMIT 20001`).all(from, to);
    if (rows.length > 20000) throw new RequestError('Legacy response limit reached. Choose a shorter period.', 413);
    return rows;
  }
  snapshots(date) { const from = dateRange(date); return { date, timezone: 'UTC', snapshots: this.rows(from, from + DAY), source: LEGACY_SOURCE }; }
  snapshot(id) {
    this.ready();
    if (!/^legacy-[a-f0-9]{24}$/.test(id ?? '')) throw new RequestError('Invalid legacy observation ID.');
    const summary = this.db.prepare(`${SELECT} WHERE o.id=?`).get(id);
    if (!summary) throw new RequestError('Legacy observation not found.', 404);
    const meta = this.db.prepare('SELECT source_time,recovery,provenance,original_candidate FROM observations WHERE id=?').get(id);
    const grid = this.db.prepare('SELECT * FROM grids WHERE total_id=?').get(id);
    let detail = { available: false, reason: 'No verified grid geometry for this observation. Regional totals remain available; missing geometry is unknown.' };
    if (grid) {
      const cells = this.db.prepare('SELECT cell_id,customers,geometry FROM cells WHERE capture_key=? ORDER BY cell_id LIMIT 10001').all(grid.capture_key);
      if (cells.length > 10000) throw new RequestError('Legacy map exceeds feature limit.', 413);
      detail = { available: true, capturedAt: grid.observed_at, captureKey: grid.capture_key, recovery: JSON.parse(grid.recovery),
        meaning: 'Geographic grid areas, not individual outage locations. Grid customer counts must not be allocated to modern Census areas or interpreted as unique incidents.',
        geojson: { type: 'FeatureCollection', features: cells.map(c => ({ type: 'Feature', id: c.cell_id, geometry: JSON.parse(c.geometry),
          properties: { gridCellId: c.cell_id, customers: c.customers, sourceFormat: 'legacy_html' } })) } };
    }
    return { summary, detail, source: LEGACY_SOURCE, sourceTime: meta.source_time, recovery: JSON.parse(meta.recovery),
      provenance: JSON.parse(meta.provenance), originalAvailability: meta.original_candidate ? 'Candidate standalone original inventoried; not necessarily content-validated.' : 'Consolidated source preserved; no candidate standalone original in audited trees.' };
  }
  series(params) {
    const period = range(params), { from, to, resolution } = period, rows = this.rows(from, to);
    const gaps = [], points = [];
    const before = this.db.prepare(`${SELECT} WHERE o.at<? ORDER BY o.at DESC LIMIT 1`).get(from);
    const after = this.db.prepare(`${SELECT} WHERE o.at>=? ORDER BY o.at LIMIT 1`).get(to);
    // Include gaps that surround the entire window, including empty months.
    const neighbors = [before, ...rows, after].filter(Boolean);
    for (let i = 1; i < neighbors.length; i++) {
      const a = neighbors[i - 1], b = neighbors[i];
      if (b.at - a.at > HOUR && a.at < to && b.at > from)
        gaps.push({ from: Math.max(from, a.at), to: Math.min(to, b.at), after: a.capturedAt, before: b.capturedAt, reason: 'Over one hour between known observations' });
    }
    if (!rows.length && !gaps.length) gaps.push({ from, to, reason: 'No numeric observations in requested period' });
    if (rows.length && rows[0].at > from && !gaps.some(g => g.from === from))
      gaps.unshift({ from, to: rows[0].at, reason: 'No observation at requested start' });
    if (rows.length && rows.at(-1).at < to && !gaps.some(g => g.to === to))
      gaps.push({ from: rows.at(-1).at, to, reason: 'No observation at requested end' });
    if (resolution === 'observations') for (let i = 0; i < rows.length; i++) {
      if (i && rows[i].at - rows[i - 1].at > HOUR)
        points.push({ at: (rows[i - 1].at + rows[i].at) / 2, customers: null, outages: null, id: null });
      points.push(rows[i]);
    }
    if (resolution === 'daily') {
      const buckets = new Map();
      for (const row of rows) { const day = Math.floor(row.at / DAY) * DAY; if (!buckets.has(day)) buckets.set(day, []); buckets.get(day).push(row); }
      for (let at = Math.floor(from / DAY) * DAY; at < to; at += DAY) {
        const bucket = buckets.get(at);
        if (!bucket) { points.push({ at, customers: null, outages: null, id: null, observations: 0, gridSnapshots: 0 }); continue; }
        const cp = bucket.reduce((a, b) => a.customers >= b.customers ? a : b), op = bucket.reduce((a, b) => a.outages >= b.outages ? a : b);
        points.push({ at, customers: cp.customers, outages: op.outages, id: cp.id, outageId: op.id, capturedAt: cp.capturedAt,
          outageCapturedAt: op.capturedAt, observations: bucket.length, gridSnapshots: bucket.filter(r => r.gridCaptureKey).length });
      }
    }
    return { ...period, source: LEGACY_SOURCE, points, gaps, observedSnapshots: rows.length, gridSnapshots: rows.filter(r => r.gridCaptureKey).length,
      coverage: null, gapThresholdSeconds: 3600, meaning: resolution === 'daily'
        ? 'Observed daily peaks (UTC). Customers and outages can peak at different captures. Points do not imply continuous coverage.'
        : 'Observed totals. Lines break when observations are more than one hour apart; shorter intervals do not prove uninterrupted sampling. No expected-slot coverage is assumed.' };
  }
}

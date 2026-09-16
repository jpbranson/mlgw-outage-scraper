import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Archive } from '../durable/archive.mjs';

export const DAY = 86400000, SLOT = 300000, MAX_GAP = 450000;
export const SOURCE = { name: 'Memphis Light, Gas and Water', url: 'https://outagemap.mlgw.org/OutageSummary.php',
  format: 'current_geojson', sourceUpdatedAt: null, timezoneAssumption: 'America/Chicago' };
const SELECT = 'SELECT s.id,s.captured_ms AS at,t.customers,t.outages FROM snapshots s JOIN totals t ON t.snapshot_id=s.id';
const GOOD = "s.quality='valid'";
const iso = n => n == null ? null : new Date(n).toISOString();
export class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function period(params, now = Date.now()) {
  const parse = value => value && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
  const to = params.has('to') ? parse(params.get('to')) : now;
  const from = params.has('from') ? parse(params.get('from')) : to - DAY;
  const resolution = params.get('resolution') || '5m';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 31 * DAY || to > now + 60000)
    throw new RequestError('Choose an increasing ISO timestamp range of at most 31 days, ending no later than now.');
  if (!['5m', 'hourly', 'daily'].includes(resolution) || (resolution === '5m' && to - from > 2 * DAY))
    throw new RequestError('Five-minute detail is limited to two days. Use hourly or daily summaries for longer ranges.');
  return { from, to, resolution };
}
export function sharpRise(previous, current, comparable) {
  return Boolean(comparable && previous && current.customers - previous.customers >= 100 &&
    (previous.customers === 0 || current.customers >= previous.customers * 2));
}
export function robustBaseline(rows, from, to) {
  const expected = Math.ceil((to - from) / SLOT);
  const coverage = expected ? new Set(rows.map(r => Math.floor(r.at / SLOT))).size / expected : 0;
  if (to - from < 28 * DAY || coverage < .9) return { enabled: false, coverage, threshold: null,
    explanation: 'Learning: requires 28 days of history with at least 90% valid five-minute coverage.' };
  const median = values => { const a = [...values].sort((a, b) => a - b), n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
  const center = median(rows.map(r => r.customers)), mad = median(rows.map(r => Math.abs(r.customers - center)));
  return { enabled: true, coverage, median: center, threshold: center + Math.max(100, 6 * 1.4826 * mad),
    explanation: 'High baseline: above the previous 28-day median plus the greater of 100 customers or six scaled median absolute deviations.' };
}
const publicRow = row => row ? { id: row.id, at: row.at, capturedAt: iso(row.at), customers: row.customers, outages: row.outages } : null;
const text = value => typeof value === 'string' ? value.slice(0, 1000) : null;
const publicTime = value => ({ utc: value?.utc ?? null, raw: text(value?.raw), status: text(value?.status) });

export class DashboardService {
  constructor(root, { now = () => Date.now() } = {}) {
    this.db = new DatabaseSync(join(root, 'index.sqlite'), { readOnly: true, timeout: 5000 });
    this.archive = new Archive(join(root, 'archive'), { readOnly: true });
    this.now = now;
  }
  close() { this.db.close(); }
  row(id) { return this.db.prepare(`${SELECT} WHERE ${GOOD} AND s.id=?`).get(id); }
  latestRow() { return this.db.prepare(`${SELECT} WHERE ${GOOD} ORDER BY s.captured_ms DESC LIMIT 1`).get(); }
  rows(from, to) { return this.db.prepare(`${SELECT} WHERE ${GOOD} AND s.captured_ms>=? AND s.captured_ms<? ORDER BY s.captured_ms`).all(from, to); }
  comparable(previous, current) {
    return Boolean(previous && current.at > previous.at && current.at - previous.at <= MAX_GAP &&
      !this.db.prepare("SELECT 1 FROM poll_attempts WHERE received_ms>? AND received_ms<=? AND outcome NOT IN ('valid','duplicate_slot') LIMIT 1").get(previous.at, current.at));
  }
  health() {
    const latest = this.latestRow();
    const attempt = this.db.prepare('SELECT received_ms,outcome FROM poll_attempts ORDER BY received_ms DESC LIMIT 1').get();
    const first = this.db.prepare("SELECT MIN(captured_ms) at FROM snapshots WHERE quality='valid'").get().at;
    const ageMinutes = latest ? Math.max(0, this.now() - latest.at) / 60000 : null;
    const status = ageMinutes == null || ageMinutes >= 15 ? 'stale' : ageMinutes > 10 || !['valid', 'duplicate_slot'].includes(attempt?.outcome) ? 'warning' : 'ok';
    return { checkedAt: iso(this.now()), status, ageMinutes, latest: publicRow(latest), firstCaptureAt: iso(first),
      lastAttemptAt: iso(attempt?.received_ms), lastAttemptOutcome: attempt?.outcome ?? null,
      source: SOURCE, localOnly: true };
  }
  summary(row) {
    const previous = this.db.prepare(`${SELECT} WHERE ${GOOD} AND s.captured_ms<? ORDER BY s.captured_ms DESC LIMIT 1`).get(row.at);
    const comparable = this.comparable(previous, row);
    const dayStart = Math.floor(row.at / DAY) * DAY;
    const peak = this.db.prepare(`${SELECT} WHERE ${GOOD} AND s.captured_ms>=? AND s.captured_ms<=? ORDER BY t.customers DESC,s.captured_ms LIMIT 1`).get(dayStart, row.at);
    const baseline = robustBaseline(this.rows(row.at - 28 * DAY, row.at), row.at - 28 * DAY, row.at);
    return { ...publicRow(row), change: comparable ? row.customers - previous.customers : null,
      previousAt: comparable ? iso(previous.at) : null, dailyPeak: peak?.customers ?? null, dailyPeakAt: iso(peak?.at),
      peakDay: iso(dayStart).slice(0, 10), peakDayTimezone: 'UTC', baseline,
      sharpRise: sharpRise(previous, row, comparable), highBaseline: baseline.enabled && row.customers > baseline.threshold };
  }
  async latest() { const row = this.latestRow(); return row ? this.snapshot(row.id) : { summary: null, detail: { available: false, reason: 'No accepted captures yet.' }, source: SOURCE }; }
  async snapshot(id) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new RequestError('Invalid capture ID.');
    const row = this.row(id);
    if (!row) throw new RequestError('Accepted capture not found.', 404);
    const result = { summary: this.summary(row), source: SOURCE, quality: 'valid' };
    try {
      const meta = this.db.prepare('SELECT a.manifest_key,a.manifest_hash,s.raw_hash,s.parser_hash FROM poll_attempts a JOIN snapshots s ON s.id=a.id WHERE a.id=?').get(id);
      const { manifest, hash } = this.archive.readManifest(meta.manifest_key);
      if (hash !== meta.manifest_hash || manifest.parserHash !== meta.parser_hash || manifest.bodies.feed.hash !== meta.raw_hash)
        throw new Error('Archive evidence disagrees with index');
      const parser = await this.archive.parser(manifest);
      const parsed = parser.parseFeed(this.archive.readBody(manifest.bodies.feed).toString('utf8'));
      if (!parsed.totalsValid || parsed.totals.customers !== row.customers || parsed.totals.reportedOutages !== row.outages || parsed.featureCount > 10000)
        throw new Error('Replayed totals disagree with index or detail exceeds limit');
      const features = parsed.normalized.features.map(f => ({ type: 'Feature', id: f.id, geometry: f.geometry,
        properties: { outageId: text(f.properties.outageId), customers: f.properties.customers,
          started: publicTime(f.properties.started), estimatedRepair: publicTime(f.properties.estimatedRepair),
          status: text(f.properties.status) } }));
      result.detail = { available: true, geojson: { type: 'FeatureCollection', features },
        unmapped: features.filter(f => !f.geometry).length, flags: parsed.issues.map(i => i.code),
        longRunning: features.filter(f => f.properties.started.utc && row.at - Date.parse(f.properties.started.utc) > 6 * 3600000)
          .map(f => ({ id: f.id, customers: f.properties.customers, startedAt: f.properties.started.utc,
            hours: (row.at - Date.parse(f.properties.started.utc)) / 3600000 })).sort((a, b) => b.hours - a.hours),
        unknownStartTimes: features.filter(f => !f.properties.started.utc).length };
    } catch {
      result.detail = { available: false, reason: 'Archived map detail is unavailable or could not be verified. Accepted totals remain available.' };
    }
    return result;
  }
  snapshots(date) {
    if (!/^\d{4}-\d\d-\d\d$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) || iso(Date.parse(date)).slice(0, 10) !== date)
      throw new RequestError('Choose a valid archive date in YYYY-MM-DD format (UTC).');
    const from = Date.parse(date);
    return { date, timezone: 'UTC', snapshots: this.rows(from, from + DAY).map(publicRow), source: SOURCE };
  }
  series(params) {
    const range = period(params, this.now()), { from, to, resolution } = range;
    const rows = this.rows(from, to), points = [], anomalies = [], gaps = [];
    const previous = this.db.prepare(`${SELECT} WHERE ${GOOD} AND s.captured_ms<? ORDER BY s.captured_ms DESC LIMIT 1`).get(from);
    const failures = this.db.prepare("SELECT received_ms FROM poll_attempts WHERE received_ms>? AND received_ms<? AND outcome NOT IN ('valid','duplicate_slot') ORDER BY received_ms").all(previous?.at ?? from, to);
    let prev = previous, coveredMs = 0, failureIndex = 0, startCovered = false;
    for (const row of rows) {
      while (failureIndex < failures.length && failures[failureIndex].received_ms <= (prev?.at ?? from)) failureIndex++;
      const comparable = prev && row.at - prev.at <= MAX_GAP && !(failures[failureIndex]?.received_ms <= row.at);
      if (row === rows[0]) startCovered = Boolean(comparable && prev.at <= from);
      if (comparable) coveredMs += row.at - Math.max(from, prev.at);
      else if (prev) gaps.push({ from: Math.max(from, prev.at), to: row.at, reason: 'Missing or untrusted observation' });
      if (sharpRise(prev, row, comparable)) anomalies.push({ at: row.at, id: row.id, kind: 'sharp-rise', explanation: 'At least 100 more affected customers and at least double the previous comparable capture (zero uses the absolute threshold).' });
      if (resolution === '5m') {
        if (prev && !comparable && prev.at >= from) points.push({ at: (prev.at + row.at) / 2, customers: null, outages: null, id: null });
        points.push({ ...publicRow(row), coverage: null });
      }
      prev = row;
    }
    if (!startCovered && (!rows.length || rows[0].at > from)) gaps.unshift({ from, to: rows[0]?.at ?? to, reason: 'No observation at start of requested window' });
    if (rows.length && rows.at(-1).at < to) gaps.push({ from: rows.at(-1).at, to, reason: 'No later observation yet' });
    if (resolution !== '5m') {
      const width = resolution === 'hourly' ? 3600000 : DAY;
      // Only compact indexed counts are read; detailed maps are loaded separately on selection.
      const buckets = new Map();
      for (const row of rows) {
        const key = Math.floor(row.at / width) * width;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
      }
      const rollups = new Map(this.db.prepare('SELECT * FROM rollups WHERE resolution=? AND bucket_ms>=? AND bucket_ms<?').all(resolution, Math.floor(from / width) * width, to).map(r => [r.bucket_ms, r]));
      for (let at = Math.floor(from / width) * width; at < to; at += width) {
        const bucket = buckets.get(at), rollup = rollups.get(at);
        if (!bucket) { points.push({ at, customers: null, outages: null, id: null, coverage: 0 }); continue; }
        const cp = bucket.reduce((a, b) => a.customers >= b.customers ? a : b), op = bucket.reduce((a, b) => a.outages >= b.outages ? a : b);
        points.push({ at, customers: cp.customers, outages: op.outages, id: cp.id, outageId: op.id,
          capturedAt: iso(cp.at), outageCapturedAt: iso(op.at), coverage: Math.min(1, (rollup?.covered_minutes ?? 0) / (width / 60000)) });
      }
    }
    const quality = this.db.prepare("SELECT outcome,COUNT(*) count FROM poll_attempts WHERE received_ms>=? AND received_ms<? AND outcome NOT IN ('valid','duplicate_slot') GROUP BY outcome").all(from, to);
    return { ...range, points, gaps, anomalies, quality, coverage: coveredMs / (to - from), observedSnapshots: rows.length,
      firstCaptureAt: iso(rows[0]?.at), lastCaptureAt: iso(rows.at(-1)?.at), source: SOURCE,
      meaning: resolution === '5m' ? 'Accepted five-minute observations; gaps are unknown.' : 'Maximum observed value in each UTC bucket. Partial buckets are unconnected; selecting a peak opens its actual capture.' };
  }
}

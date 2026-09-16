export const INTERVAL_MS = 300000;
export const MAX_GAP_MS = INTERVAL_MS * 1.5;
export const HOUR_MS = 3600000, DAY_MS = 86400000;
export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

// Recompute only queued UTC days and their boundary intervals. This is bounded
// by days, not archive age, and remains correct for late captures and replay.
export function maintainRollups(db, limit = 3) {
  const days = db.prepare('SELECT day FROM maintenance_queue ORDER BY day LIMIT ?').all(limit);
  for (const { day } of days) {
    const start = Date.parse(day + 'T00:00:00Z'), end = start + DAY_MS;
    db.exec('BEGIN IMMEDIATE');
    try {
      const points = db.prepare(`SELECT s.*, t.customers, t.outages FROM snapshots s JOIN totals t ON s.id=t.snapshot_id
        WHERE s.captured_ms >= ? AND s.captured_ms <= ? ORDER BY s.captured_ms`).all(start - MAX_GAP_MS, end + MAX_GAP_MS);
      const blocked = db.prepare(`SELECT received_ms FROM poll_attempts WHERE received_ms >= ? AND received_ms <= ?
        AND outcome NOT IN ('valid','duplicate_slot')`).all(start - MAX_GAP_MS, end + MAX_GAP_MS).map(r => r.received_ms);
      const buckets = Array.from({ length: 24 }, (_, hour) => ({ bucket_ms: start + hour * HOUR_MS,
        customer_minutes: 0, covered_minutes: 0, peak_customers: null, peak_outages: null, observations: 0 }));
      const peak = (b, p) => { b.peak_customers = Math.max(b.peak_customers ?? 0, p.customers); b.peak_outages = Math.max(b.peak_outages ?? 0, p.outages); };
      for (let i = 0; i < points.length; i++) {
        const p = points[i], next = points[i + 1];
        if (p.quality !== 'valid') continue;
        if (p.captured_ms >= start && p.captured_ms < end) {
          const bucket = buckets[Math.floor((p.captured_ms - start) / HOUR_MS)]; bucket.observations++; peak(bucket, p);
        }
        if (!next || next.quality !== 'valid' || next.captured_ms - p.captured_ms > MAX_GAP_MS ||
            blocked.some(t => t > p.captured_ms && t <= next.captured_ms)) continue;
        let left = Math.max(start, p.captured_ms), right = Math.min(end, next.captured_ms);
        while (left < right) {
          const index = Math.floor((left - start) / HOUR_MS), b = buckets[index];
          const stop = Math.min(right, b.bucket_ms + HOUR_MS), minutes = (stop - left) / 60000;
          b.covered_minutes += minutes; b.customer_minutes += p.customers * minutes; peak(b, p); left = stop;
        }
      }
      db.prepare('DELETE FROM rollups WHERE bucket_ms >= ? AND bucket_ms < ?').run(start, end);
      const insert = db.prepare(`INSERT INTO rollups VALUES (?,?,?,?,?,?,?,?)`);
      for (const b of buckets) insert.run('hourly', b.bucket_ms, b.customer_minutes, b.covered_minutes,
        b.covered_minutes ? b.customer_minutes / b.covered_minutes : null, b.peak_customers, b.peak_outages, b.observations);
      const covered = buckets.reduce((n, b) => n + b.covered_minutes, 0), burden = buckets.reduce((n, b) => n + b.customer_minutes, 0);
      const peaks = key => { const values = buckets.map(b => b[key]).filter(v => v != null); return values.length ? Math.max(...values) : null; };
      insert.run('daily', start, burden, covered, covered ? burden / covered : null, peaks('peak_customers'), peaks('peak_outages'), buckets.reduce((n, b) => n + b.observations, 0));
      db.prepare('DELETE FROM maintenance_queue WHERE day=?').run(day);
      db.prepare("INSERT OR REPLACE INTO collector_state VALUES ('last_rollup_day', ?)").run(day);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return days.length;
}

import { readFile, mkdir } from 'node:fs/promises';
import { DATA_DIR, readAttempts, writeJson } from '../src/pilot-io.mjs';
import { parseFeed } from '../src/contract.mjs';

const attempts = await readAttempts();
const valid = attempts.filter(r => r.totalsValid);
const deltaSeconds = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;
const intervals = valid.slice(1).map((r, i) => deltaSeconds(valid[i].feed.receivedAt, r.feed.receivedAt));
const changes = []; const durationOnly = []; const idChanges = []; const reappeared = [];
const lastSeen = new Map(); let previous = new Map();
for (let i = 0; i < valid.length; i++) {
  const r = valid[i];
  if (i && r.meaningfulSha256 !== valid[i - 1].meaningfulSha256) changes.push(r.feed.receivedAt);
  if (i && r.feed.sha256 !== valid[i - 1].feed.sha256 && r.meaningfulSha256 === valid[i - 1].meaningfulSha256) durationOnly.push(r.feed.receivedAt);
  const parsed = parseFeed(await readFile(new URL(r.feed.file, DATA_DIR), 'utf8'));
  const current = new Map(parsed.normalized.features.map(f => [f.id, f]));
  for (const [id, f] of current) {
    if (lastSeen.has(id) && !previous.has(id)) reappeared.push({ id, at: r.feed.receivedAt });
    const old = lastSeen.get(id);
    if (old && (old.properties.started.raw !== f.properties.started.raw || JSON.stringify(old.geometry) !== JSON.stringify(f.geometry))) {
      idChanges.push({ id, at: r.feed.receivedAt, startChanged: old.properties.started.raw !== f.properties.started.raw,
        coordinatesChanged: JSON.stringify(old.geometry) !== JSON.stringify(f.geometry) });
    }
    lastSeen.set(id, f);
  }
  previous = current;
}
const stats = values => values.length ? { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length,
  p95: [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1], max: Math.max(...values) } : null;
const spanHours = valid.length > 1 ? deltaSeconds(valid[0].feed.receivedAt, valid.at(-1).feed.receivedAt) / 3600 : 0;
const expectedSlots = valid.length ? Math.floor(Date.parse(valid.at(-1).feed.receivedAt) / 300000) - Math.floor(Date.parse(valid[0].feed.receivedAt) / 300000) + 1 : 0;
const uniqueSlots = new Set(valid.map(r => Math.floor(Date.parse(r.feed.receivedAt) / 300000))).size;
const report = { generatedAt: new Date().toISOString(), attempts: attempts.length, validTotals: valid.length,
  firstRetrievedAt: valid[0]?.feed.receivedAt ?? null, lastRetrievedAt: valid.at(-1)?.feed.receivedAt ?? null,
  observedSpanHours: spanHours, uniqueFiveMinuteSlots: uniqueSlots,
  observationGatePassed: spanHours >= 24 && intervals.every(v => v <= 600) && uniqueSlots / expectedSlots >= .99,
  observationGateDefinition: 'At least 24 elapsed hours, at least 99% of five-minute slots have valid totals, and no gap over 10 minutes. Quality issues require separate review.',
  expectedSlotsInObservedSpan: expectedSlots, slotCoverage: expectedSlots ? uniqueSlots / expectedSlots : 0,
  intervalsSeconds: stats(intervals), gapsOver10Minutes: intervals.filter(v => v > 600),
  meaningfulTransitions: changes.length, meaningfulTransitionTimes: changes, byteChangesWithoutMeaningfulChange: durationOnly.length,
  updateCadenceConclusion: 'Five-minute polling bounds observations; it cannot identify sub-five-minute source publication frequency.',
  htmlComparisons: attempts.filter(r => r.comparison).length, htmlMismatches: attempts.filter(r => r.comparison?.customersDelta !== 0 && r.comparison).map(r => ({ id: r.id, ...r.comparison })),
  failures: attempts.filter(r => !r.totalsValid).map(r => ({ id: r.id, status: r.status, feedError: r.feed?.error, stopReason: r.stopReason })),
  qualityIssueCount: attempts.reduce((sum, r) => sum + (r.issues?.length ?? 0), 0),
  uniqueIds: lastSeen.size, idsWithChangedStartOrLocation: idChanges, reappearedIds: reappeared,
  rawBytes: stats(valid.map(r => r.feed.bytes)), rawGzipBytes: stats(valid.map(r => r.feed.gzipBytes)),
  combinedGzipPlus4096MetadataBytes: stats(valid.map(r => r.feed.gzipBytes + r.normalized.gzipBytes + 4096)),
  latencyMs: stats(valid.map(r => r.feed.latencyMs)),
  phase1Complete: false, outstanding: ['Deployed runtime CPU and archive-processing headroom', 'Account storage usage and cloud budget verification',
    ...(spanHours < 24 ? ['At least 24 hours of source observation'] : [])] };
await mkdir('reports', { recursive: true });
await writeJson('reports/pilot-summary.json', report);
console.log(JSON.stringify(report, null, 2));

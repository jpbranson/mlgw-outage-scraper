import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

export const LEGACY_VERSION = 'legacy-dashboard-v1';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function inside(root, path) {
  const target = resolve(root, path), rel = relative(resolve(root), target);
  check(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Legacy path must stay inside its data directory');
  return target;
}
export function verifiedBytes(root, entry, maxBytes = 256 * 1024 * 1024) {
  check(entry && /^[a-f0-9]{64}$/.test(entry.sha256), 'Missing legacy content hash');
  const path = inside(root, entry.path);
  check(statSync(path).size <= maxBytes, 'Legacy file exceeds size limit');
  const bytes = readFileSync(path);
  check(sha256(bytes) === entry.sha256, 'Legacy content hash mismatch: ' + entry.path);
  return bytes;
}
export async function* jsonLines(path) {
  const input = createReadStream(path), unzip = createGunzip();
  input.on('error', error => unzip.destroy(error));
  const lines = createInterface({ input: input.pipe(unzip), crlfDelay: Infinity });
  let bytes = 0, count = 0;
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line); count++;
      check(bytes <= 512 * 1024 * 1024 && count <= 250000 && line.length <= 100000, 'Legacy decoded data exceeds limit');
      if (line) yield JSON.parse(line);
    }
  } finally { lines.close(); input.destroy(); unzip.destroy(); }
}
const compactProvenance = rows => rows.map(({ source, firstSourceRow, sourceRowCount }) => ({ source, firstSourceRow, sourceRowCount }));
const validCount = n => Number.isSafeInteger(n) && n >= 0;
function validRecord(row) {
  check(row.sourceFormat === 'legacy_html' && validCount(row.customers), 'Invalid legacy record');
  if (row.observedAt !== null) check(row.timeStatus === 'resolved' && /Z$/.test(row.observedAt) && Number.isFinite(Date.parse(row.observedAt)), 'Invalid legacy UTC time');
}

// Publish a disposable read model. Audited originals, recovery catalogs and the
// live collector are never opened for writing. The catalog switches only last.
export async function publishLegacy({ projectRoot = process.cwd() } = {}) {
  const legacyRoot = join(projectRoot, 'data/legacy');
  const recoveryBytes = readFileSync(join(legacyRoot, 'recovered/catalog.json'));
  const coverageBytes = readFileSync(join(legacyRoot, 'coverage/catalog.json'));
  const recovered = JSON.parse(recoveryBytes), coverage = JSON.parse(coverageBytes);
  check(recovered.version === 'legacy-time-recovery-v1' && coverage.version === 'legacy-coverage-v1', 'Unsupported legacy catalog version');
  check(recovered.verified === true && coverage.verified === true && coverage.recoveredGeneration === recovered.generation, 'Legacy catalogs must be verified and use the same recovery generation');
  // Input paths are relative to the project; constrain them further to legacy/.
  const verify = entry => { inside(legacyRoot, relative(legacyRoot, resolve(projectRoot, entry.path))); return verifiedBytes(projectRoot, entry); };
  const verification = JSON.parse(verify({ path: recovered.verification, sha256: recovered.verificationSha256 }));
  check(verification.generation === recovered.generation && verification.sourceAndGeometryPreserved && verification.strictUTCOrder && verification.independentRVerified, 'Legacy recovery verification is incomplete');
  for (const [kind, file] of Object.entries(recovered.outputs)) {
    check(verification.outputHashes[kind] === file.sha256, 'Recovery verification does not cover these outputs'); verify(file);
  }
  for (const entry of Object.values(coverage.files)) verify(entry);
  const coverageJson = name => JSON.parse(verify(coverage.files[name]));
  const gaps = coverageJson('timeline-gaps.json'), samples = coverageJson('sample-verification.json');
  check(gaps.thresholdSeconds === 3600 && samples.independentInventoryVerified === true, 'Coverage verification is incomplete');
  const withoutOriginal = new Set(coverageJson('totals-without-capture.json').map(r => r.sourceTime));
  const generation = sha256(LEGACY_VERSION + sha256(recoveryBytes) + sha256(coverageBytes)).slice(0, 24);
  const outputRoot = join(legacyRoot, 'dashboard'); mkdirSync(outputRoot, { recursive: true });
  const temp = join(outputRoot, `${generation}.${process.pid}.tmp.sqlite`);
  check(!existsSync(temp), 'A legacy publication temporary file already exists');
  const db = new DatabaseSync(temp);
  const unresolved = [];
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;
      CREATE TABLE observations(id TEXT PRIMARY KEY, at INTEGER NOT NULL, observed_at TEXT UNIQUE NOT NULL,
        source_time TEXT UNIQUE NOT NULL, customers INTEGER NOT NULL, outages INTEGER NOT NULL,
        recovery TEXT NOT NULL, provenance TEXT NOT NULL, original_candidate INTEGER NOT NULL);
      CREATE INDEX observations_at ON observations(at);
      CREATE TABLE grids(capture_key TEXT PRIMARY KEY, total_id TEXT UNIQUE NOT NULL REFERENCES observations(id),
        observed_at TEXT NOT NULL, recovery TEXT NOT NULL);
      CREATE TABLE cells(capture_key TEXT NOT NULL REFERENCES grids(capture_key), cell_id TEXT NOT NULL,
        customers INTEGER NOT NULL, geometry TEXT NOT NULL, PRIMARY KEY(capture_key,cell_id));
      BEGIN;`);
    const addTotal = db.prepare('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?)');
    let prior = -Infinity, totalRecords = 0, gridRecords = 0;
    for await (const row of jsonLines(resolve(projectRoot, recovered.outputs.totals.path))) {
      validRecord(row); check(validCount(row.outages), 'Invalid legacy outage total'); totalRecords++;
      if (row.observedAt === null) { unresolved.push({ sourceTime: row.sourceTime, customers: row.customers, outages: row.outages, recovery: row.timeRecovery }); continue; }
      const at = Date.parse(row.observedAt); check(at >= prior, 'Legacy totals are not ordered'); prior = at;
      addTotal.run('legacy-' + sha256(row.sourceTime).slice(0, 24), at, row.observedAt, row.sourceTime, row.customers, row.outages,
        JSON.stringify(row.timeRecovery), JSON.stringify(compactProvenance(row.provenance)), Number(!withoutOriginal.has(row.sourceTime)));
    }
    const findTotal = db.prepare('SELECT id FROM observations WHERE source_time=?');
    const findGrid = db.prepare('SELECT * FROM grids WHERE capture_key=?');
    const addGrid = db.prepare('INSERT INTO grids VALUES(?,?,?,?)'), addCell = db.prepare('INSERT INTO cells VALUES(?,?,?,?)');
    for await (const row of jsonLines(resolve(projectRoot, recovered.outputs.grids.path))) {
      validRecord(row); check(row.observedAt !== null && row.geometry?.type === 'Polygon', 'Legacy grids require verified polygons and times');
      check(row.geometry.coordinates.length > 0 && row.geometry.coordinates.every(ring => ring.length >= 4 &&
        JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1)) && ring.every(p => p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)), 'Invalid legacy polygon');
      const total = findTotal.get(row.timeRecovery.relatedTotalSourceTime);
      check(total, 'Legacy grid lacks its verified total anchor');
      const existing = findGrid.get(row.captureKey), recovery = JSON.stringify(row.timeRecovery);
      if (!existing) addGrid.run(row.captureKey, total.id, row.observedAt, recovery);
      else check(existing.total_id === total.id && existing.observed_at === row.observedAt && existing.recovery === recovery, 'Inconsistent legacy grid anchor');
      addCell.run(row.captureKey, row.gridCellId, row.customers, JSON.stringify(row.geometry)); gridRecords++;
    }
    check(totalRecords === verification.statistics.totals.recordsPreserved && unresolved.length === verification.statistics.totals.unresolvedRecords &&
      totalRecords - unresolved.length === verification.statistics.totals.resolvedRecords &&
      gridRecords === verification.statistics.grids.recordsPreserved, 'Legacy publication counts disagree with verified sources');
    db.exec('COMMIT;');
    check(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'Legacy index integrity check failed');
    const counts = { totals: totalRecords - unresolved.length, gridSnapshots: db.prepare('SELECT COUNT(*) n FROM grids').get().n, gridCells: gridRecords };
    const range = db.prepare('SELECT MIN(observed_at) first,MAX(observed_at) last FROM observations').get();
    const months = [], firstMonth = range.first.slice(0, 7), lastMonth = range.last.slice(0, 7);
    const monthly = db.prepare(`SELECT substr(o.observed_at,1,7) month,COUNT(*) totals,COUNT(g.capture_key) gridSnapshots
      FROM observations o LEFT JOIN grids g ON g.total_id=o.id GROUP BY month`).all();
    for (let month = firstMonth; month <= lastMonth;) {
      months.push(monthly.find(r => r.month === month) ?? { month, totals: 0, gridSnapshots: 0 });
      const date = new Date(month + '-01T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() + 1); month = date.toISOString().slice(0, 7);
    }
    const compactException = r => ({ repository: r.repository, captureKey: r.captureKey, storedTime: r.storedTime || null, summary: r.summary ?? null });
    const metadata = { version: LEGACY_VERSION, generation, sourceFormat: 'legacy_html', recoveredGeneration: recovered.generation,
      counts, range, months, gapThresholdSeconds: gaps.thresholdSeconds,
      gaps: { totals: gaps.totals.length, grids: gaps.grids.length, largest: [...gaps.totals].sort((a, b) => b.secondsBetweenObservations - a.secondsBetweenObservations)[0] ?? null },
      coverage: { scope: coverage.scope, totalObservationsWithoutOriginal: withoutOriginal.size,
        emptyEventCaptures: samples.allEmptyEventCaptures, emptyHeads: samples.allEmptyCapturesWithVerifiedEmptyHead,
        blankSavedHeads: samples.blankSavedHeads.map(compactException), rejectedSavedHeads: samples.rejectedSavedHeads.map(compactException),
        unmatchedNonempty: samples.nonemptyOriginalsAbsentFromConsolidated.map(compactException), missingSavedPages: samples.missingSavedPages.map(compactException) },
      unresolved, inputs: { recoveryCatalog: sha256(recoveryBytes), coverageCatalog: sha256(coverageBytes), outputs: recovered.outputs,
        recoveryVerification: recovered.verificationSha256, coverageVerification: coverage.files['sample-verification.json'].sha256 } };
    db.exec('CREATE TABLE metadata(json TEXT NOT NULL)'); db.prepare('INSERT INTO metadata VALUES(?)').run(JSON.stringify(metadata));
    db.close();
    // Recheck after streaming so a concurrently replaced input cannot be published
    // under the earlier catalog's hashes.
    check(sha256(readFileSync(join(legacyRoot, 'recovered/catalog.json'))) === sha256(recoveryBytes) &&
      sha256(readFileSync(join(legacyRoot, 'coverage/catalog.json'))) === sha256(coverageBytes), 'Legacy catalogs changed during publication');
    for (const entry of [...Object.values(recovered.outputs), ...Object.values(coverage.files)]) verify(entry);
    const hash = sha256(readFileSync(temp)), filename = `${generation}-${hash.slice(0, 12)}.sqlite`, dest = join(outputRoot, filename);
    if (existsSync(dest)) { check(sha256(readFileSync(dest)) === hash, 'Existing publication hash mismatch'); unlinkSync(temp); }
    else renameSync(temp, dest);
    const catalog = { version: LEGACY_VERSION, generation, verified: true, index: { path: filename, sha256: hash, bytes: statSync(dest).size } };
    const catalogTemp = join(outputRoot, `catalog.${process.pid}.tmp.json`);
    writeFileSync(catalogTemp, JSON.stringify(catalog, null, 2) + '\n'); renameSync(catalogTemp, join(outputRoot, 'catalog.json'));
    return { ...catalog, counts, range, excludedUnresolved: unresolved.length };
  } catch (error) {
    try { db.close(); } catch { /* Already closed after successful indexing. */ }
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

import { DatabaseSync } from 'node:sqlite';

export const DATASET_VERSION = 'reported-outage-locations-v1';
export const RULES = {
  location: 'Exact numeric longitude/latitude, with no rounding, snapping, or inferred footprint.',
  identity: 'Source outage IDs are source records, not confirmed independent physical incidents or customer groups.',
  episodes: 'Split at observed absence or a collection break; start-time edits do not create another record.',
  distribution: 'Customer histograms count captured observations. Record counts count distinct source IDs; a record can occupy multiple count bins.',
  recurrence: 'Different source IDs at the same exact coordinates establish location reuse only.',
  candidates: 'Disappearing and newly appearing IDs in comparable adjacent captures within the configured distance are hypotheses only.',
  geography: 'No service-area boundaries, equipment identities, unique customers, or continuous outage durations are inferred.',
};

export function siteId(coordinates) {
  return `point:${coordinates[0]},${coordinates[1]}`;
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180, lat1 = a[1] * rad, lat2 = b[1] * rad;
  const h = Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((b[0]-a[0])*rad/2)**2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1,h)));
}

function location(feature) {
  const c = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite))
    return { id: null, issue: 'invalid_geometry' };
  if (c[0] < -90.4 || c[0] > -89.3 || c[1] < 34.7 || c[1] > 35.7)
    return { id: null, issue: 'outside_review_bounds' };
  return { id: siteId(c), coordinates: c, issue: null };
}

// This creates a separate database; callers must never pass the collector's path.
export function buildLocationDataset(captures, { path = ':memory:', maxGapMs = 600000,
  candidateDistanceMeters = 250, metadata = {} } = {}) {
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0 || !Number.isFinite(candidateDistanceMeters) || candidateDistanceMeters < 0)
    throw new Error('Invalid comparison parameters');
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value_json TEXT NOT NULL) STRICT;
    CREATE TABLE captures (
      capture_id TEXT PRIMARY KEY, captured_ms INTEGER NOT NULL UNIQUE, slot_ms INTEGER,
      source_customers INTEGER NOT NULL, source_outages INTEGER NOT NULL,
      raw_hash TEXT, manifest_key TEXT, manifest_hash TEXT, parser_hash TEXT,
      comparable_to_previous INTEGER NOT NULL, comparison_reason TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sites (site_id TEXT PRIMARY KEY, longitude REAL NOT NULL, latitude REAL NOT NULL,
      UNIQUE(longitude,latitude)) STRICT;
    CREATE TABLE episodes (episode_id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
      first_capture_id TEXT NOT NULL REFERENCES captures, last_capture_id TEXT NOT NULL REFERENCES captures,
      first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, start_reason TEXT NOT NULL) STRICT;
    CREATE TABLE observations (
      capture_id TEXT NOT NULL REFERENCES captures, source_id TEXT NOT NULL,
      episode_id TEXT NOT NULL REFERENCES episodes, site_id TEXT REFERENCES sites,
      customers INTEGER NOT NULL CHECK(customers>=0), source_start_raw TEXT, source_start_utc TEXT,
      source_start_status TEXT, impact TEXT, status TEXT, geometry_issue TEXT,
      PRIMARY KEY(capture_id,source_id)
    ) STRICT;
    CREATE INDEX observations_site ON observations(site_id,source_id);
    CREATE INDEX observations_source ON observations(source_id,capture_id);
    CREATE TABLE transitions (
      source_id TEXT NOT NULL, from_capture_id TEXT NOT NULL, to_capture_id TEXT NOT NULL,
      from_site_id TEXT REFERENCES sites, to_site_id TEXT REFERENCES sites,
      from_customers INTEGER NOT NULL, to_customers INTEGER NOT NULL, distance_meters REAL,
      location_changed INTEGER NOT NULL, customers_changed INTEGER NOT NULL, start_changed INTEGER NOT NULL,
      comparable INTEGER NOT NULL, relationship TEXT NOT NULL,
      PRIMARY KEY(source_id,from_capture_id,to_capture_id),
      FOREIGN KEY(from_capture_id,source_id) REFERENCES observations(capture_id,source_id),
      FOREIGN KEY(to_capture_id,source_id) REFERENCES observations(capture_id,source_id)
    ) STRICT;
    CREATE TABLE candidate_turnovers (
      from_capture_id TEXT NOT NULL, to_capture_id TEXT NOT NULL,
      from_source_id TEXT NOT NULL, to_source_id TEXT NOT NULL,
      from_site_id TEXT NOT NULL REFERENCES sites, to_site_id TEXT NOT NULL REFERENCES sites,
      distance_meters REAL NOT NULL, from_customers INTEGER NOT NULL, to_customers INTEGER NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship='unconfirmed_nearby_turnover'),
      PRIMARY KEY(from_capture_id,to_capture_id,from_source_id,to_source_id),
      FOREIGN KEY(from_capture_id,from_source_id) REFERENCES observations(capture_id,source_id),
      FOREIGN KEY(to_capture_id,to_source_id) REFERENCES observations(capture_id,source_id)
    ) STRICT;
    CREATE VIEW site_records AS
      SELECT o.site_id,o.source_id,MIN(c.captured_ms) first_ms,MAX(c.captured_ms) last_ms,
        COUNT(*) observation_count,COUNT(DISTINCT o.episode_id) episode_count,
        MIN(o.customers) min_customers,MAX(o.customers) max_customers,
        COUNT(DISTINCT o.source_start_raw) start_versions
      FROM observations o JOIN captures c USING(capture_id) WHERE site_id IS NOT NULL GROUP BY o.site_id,o.source_id;
    CREATE VIEW record_summary AS
      SELECT o.source_id,MIN(c.captured_ms) first_ms,MAX(c.captured_ms) last_ms,
        COUNT(*) observation_count,COUNT(DISTINCT o.site_id) site_count,COUNT(DISTINCT o.episode_id) episode_count,
        COUNT(DISTINCT o.source_start_raw) start_versions,MIN(o.customers) min_customers,MAX(o.customers) max_customers
      FROM observations o JOIN captures c USING(capture_id) GROUP BY o.source_id;
    CREATE VIEW site_customer_distribution AS
      SELECT site_id,customers,COUNT(*) observation_count,COUNT(DISTINCT source_id) source_record_count
      FROM observations WHERE site_id IS NOT NULL GROUP BY site_id,customers;
    CREATE VIEW site_capture_totals AS
      SELECT site_id,capture_id,SUM(customers) customers,COUNT(*) records
      FROM observations WHERE site_id IS NOT NULL GROUP BY site_id,capture_id;
    CREATE VIEW site_summary AS
      SELECT s.*,a.first_ms,a.last_ms,a.observation_count,a.source_record_count,a.episode_count,
        a.min_customers_per_record,a.max_customers_per_record,p.peak_simultaneous_customers,p.peak_simultaneous_records
      FROM sites s JOIN (SELECT o.site_id,MIN(c.captured_ms) first_ms,MAX(c.captured_ms) last_ms,
        COUNT(*) observation_count,COUNT(DISTINCT o.source_id) source_record_count,COUNT(DISTINCT o.episode_id) episode_count,
        MIN(o.customers) min_customers_per_record,MAX(o.customers) max_customers_per_record
        FROM observations o JOIN captures c USING(capture_id) WHERE site_id IS NOT NULL GROUP BY site_id) a USING(site_id)
      JOIN (SELECT site_id,MAX(customers) peak_simultaneous_customers,MAX(records) peak_simultaneous_records
        FROM site_capture_totals GROUP BY site_id) p USING(site_id);
    CREATE TABLE exact_recurrences (
      site_id TEXT NOT NULL REFERENCES sites, source_id_a TEXT NOT NULL,source_id_b TEXT NOT NULL,
      a_first_ms INTEGER NOT NULL,a_last_ms INTEGER NOT NULL,b_first_ms INTEGER NOT NULL,b_last_ms INTEGER NOT NULL,
      disjoint_observed_spans INTEGER NOT NULL,observed_together INTEGER NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship='observed_exact_location_reuse'),
      PRIMARY KEY(site_id,source_id_a,source_id_b)
    ) STRICT;
    BEGIN;`);
  const insertCapture = db.prepare('INSERT INTO captures VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insertSite = db.prepare('INSERT OR IGNORE INTO sites VALUES (?,?,?)');
  const insertEpisode = db.prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?,?)');
  const updateEpisode = db.prepare('UPDATE episodes SET last_capture_id=?,last_ms=? WHERE episode_id=?');
  const insertObservation = db.prepare('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insertTransition = db.prepare('INSERT INTO transitions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insertCandidate = db.prepare('INSERT INTO candidate_turnovers VALUES (?,?,?,?,?,?,?,?,?,?)');
  let previousCapture = null, previous = new Map();
  const lastSeen = new Map();
  try {
    for (const capture of captures) {
      if (!Number.isSafeInteger(capture.at) || (previousCapture && capture.at <= previousCapture.at))
        throw new Error('Captures must have strictly increasing millisecond timestamps');
      const features = capture.features;
      if (!Array.isArray(features) || features.reduce((n,f)=>n+f.properties.customers,0)!==capture.customers || features.length!==capture.outages)
        throw new Error(`Capture totals disagree: ${capture.id}`);
      const comparable = Boolean(previousCapture && capture.at-previousCapture.at<=maxGapMs && capture.comparableToPrevious!==false);
      const reason = !previousCapture ? 'first_capture' : capture.at-previousCapture.at>maxGapMs ? 'collection_gap' :
        capture.comparableToPrevious===false ? 'untrusted_attempt_between_captures' : 'comparable';
      insertCapture.run(capture.id,capture.at,capture.slot??null,capture.customers,capture.outages,
        capture.rawHash??null,capture.manifestKey??null,capture.manifestHash??null,capture.parserHash??null,Number(comparable),reason);
      const current = new Map();
      for (const feature of features) {
        const id = String(feature.id), p = feature.properties, site = location(feature);
        if (!id || current.has(id) || !Number.isSafeInteger(p.customers) || p.customers<0) throw new Error('Invalid or duplicate source record');
        const old = lastSeen.get(id), adjacent = previous.has(id), continuous = comparable && adjacent;
        let episodeId = continuous ? old.episodeId : JSON.stringify([id,capture.id]);
        if (!continuous) insertEpisode.run(episodeId,id,capture.id,capture.id,capture.at,capture.at,
          !old?'first_observation':!comparable?'after_collection_break':'after_observed_absence');
        else updateEpisode.run(capture.id,capture.at,episodeId);
        if (site.id) insertSite.run(site.id,...site.coordinates);
        insertObservation.run(capture.id,id,episodeId,site.id,p.customers,p.started?.raw??null,p.started?.utc??null,
          p.started?.status??null,p.impact??null,p.status??null,site.issue);
        const state = {id,captureId:capture.id,at:capture.at,episodeId,site,customers:p.customers,start:p.started?.raw??null};
        if (old) {
          const moved = old.site.id!==site.id, changedCount=old.customers!==p.customers, changedStart=old.start!==state.start;
          if (moved || changedCount || changedStart || !continuous) insertTransition.run(id,old.captureId,capture.id,
            old.site.id,site.id,old.customers,p.customers,old.site.id&&site.id?distanceMeters(old.site.coordinates,site.coordinates):null,
            Number(moved),Number(changedCount),Number(changedStart),Number(continuous),
            continuous?'observed_source_record_change':adjacent?'source_id_across_collection_break':'source_id_after_absence');
        }
        current.set(id,state); lastSeen.set(id,state);
      }
      if (comparable) {
        const gone=[...previous.values()].filter(s=>!current.has(s.id)&&s.site.id);
        const added=[...current.values()].filter(s=>!previous.has(s.id)&&s.site.id);
        for (const a of gone) for (const b of added) {
          const distance=distanceMeters(a.site.coordinates,b.site.coordinates);
          if (distance<=candidateDistanceMeters) insertCandidate.run(a.captureId,b.captureId,a.id,b.id,
            a.site.id,b.site.id,distance,a.customers,b.customers,'unconfirmed_nearby_turnover');
        }
      }
      previous=current; previousCapture=capture;
    }
    db.exec(`INSERT INTO exact_recurrences
      SELECT a.site_id,a.source_id,b.source_id,a.first_ms,a.last_ms,b.first_ms,b.last_ms,
        CAST(a.last_ms<b.first_ms OR b.last_ms<a.first_ms AS INTEGER),
        EXISTS(SELECT 1 FROM observations x JOIN observations y ON x.capture_id=y.capture_id AND x.site_id=y.site_id
          WHERE x.site_id=a.site_id AND x.source_id=a.source_id AND y.source_id=b.source_id),
        'observed_exact_location_reuse'
      FROM site_records a JOIN site_records b ON a.site_id=b.site_id AND a.source_id<b.source_id;`);
    const meta=db.prepare('INSERT INTO metadata VALUES (?,?)');
    for (const [key,value] of Object.entries({...metadata,datasetVersion:DATASET_VERSION,rules:RULES,maxGapMs,candidateDistanceMeters}))
      meta.run(key,JSON.stringify(value));
    db.exec('COMMIT;');
    return db;
  } catch (error) { db.exec('ROLLBACK;'); db.close(); throw error; }
}

export function summarizeLocationDataset(db) {
  const n = table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return {
    captures:n('captures'),observations:n('observations'),sourceRecords:n('record_summary'),sites:n('sites'),
    episodes:n('episodes'),siteRecordMemberships:n('site_records'),distributionBins:n('site_customer_distribution'),
    reusedSites:db.prepare('SELECT COUNT(*) n FROM site_summary WHERE source_record_count>1').get().n,
    exactRecurrencePairs:n('exact_recurrences'),transitions:n('transitions'),
    coordinateChanges:db.prepare('SELECT COUNT(*) n FROM transitions WHERE location_changed=1 AND from_site_id IS NOT NULL AND to_site_id IS NOT NULL').get().n,
    revisedStartRecords:db.prepare('SELECT COUNT(*) n FROM record_summary WHERE start_versions>1').get().n,
    candidateTurnovers:n('candidate_turnovers'),
    candidateSensitivity:[0,10,25,50,100,250].map(meters=>({meters,pairs:db.prepare('SELECT COUNT(*) n FROM candidate_turnovers WHERE distance_meters<=?').get(meters).n})),
    unmappedObservations:db.prepare('SELECT COUNT(*) n FROM observations WHERE site_id IS NULL').get().n,
    collectionBreaks:db.prepare("SELECT COUNT(*) n FROM captures WHERE comparable_to_previous=0 AND comparison_reason<>'first_capture'").get().n,
    customerTotalsMismatch:db.prepare(`SELECT COUNT(*) n FROM captures c LEFT JOIN
      (SELECT capture_id,SUM(customers) customers,COUNT(*) outages FROM observations GROUP BY capture_id) o USING(capture_id)
      WHERE c.source_customers<>COALESCE(o.customers,0) OR c.source_outages<>COALESCE(o.outages,0)`).get().n,
    histogramObservationMismatch:db.prepare(`SELECT ABS((SELECT COUNT(*) FROM observations WHERE site_id IS NOT NULL)-
      COALESCE((SELECT SUM(observation_count) FROM site_customer_distribution),0)) n`).get().n,
    foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length,
    integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,
  };
}

export function exportLocationGeoJSON(db) {
  return {type:'FeatureCollection',metadata:{datasetVersion:DATASET_VERSION,rules:RULES},
    features:db.prepare('SELECT * FROM site_summary ORDER BY site_id').all().map(({site_id,longitude,latitude,...properties})=>({
      type:'Feature',id:site_id,geometry:{type:'Point',coordinates:[longitude,latitude]},
      properties:{...properties,footprint_available:false},
    }))};
}

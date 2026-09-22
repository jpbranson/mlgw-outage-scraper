import { gunzipSync } from 'node:zlib';
import { instant, windowUtc, validateRequest, BBOX } from './sources.mjs';

export const EVENT_CONTEXT_VERSION = 'weather-event-context-v1';
export const SHELBY_UGCS = Object.freeze(['TNC157', 'TNZ088']);
const check = (ok, message) => { if (!ok) throw Error(message); };
const integer = (raw, label) => {
  check(typeof raw === 'string' && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)), `Invalid ${label}`);
  return Number(raw);
};

// Iterate rather than retaining a national table in memory. Quoted commas,
// escaped quotes and embedded newlines must survive in event narratives.
export function* eventCsvRecords(text, { maxRows = 150000, maxChars = 128 * 1024 * 1024 } = {}) {
  check(typeof text === 'string' && text.length <= maxChars, 'Event CSV expansion limit');
  let row = [], field = '', quoted = false, closed = false, header, count = 0;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      check(c !== undefined, 'Unterminated event CSV quote');
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === '"') {
      check(field === '' && !closed, 'Malformed event CSV quote'); quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(field); field = ''; closed = false;
      check(row.length <= 128, 'Event CSV column limit');
      if (c === ',') continue;
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (row.some(value => value !== '')) {
        if (!header) {
          check(row.every(Boolean) && new Set(row).size === row.length, 'Invalid event CSV header'); header = row;
        } else {
          check(++count <= maxRows, 'Event CSV row limit');
          check(row.length === header.length, 'Malformed event CSV row');
          yield Object.fromEntries(header.map((key, n) => [key, row[n]]));
        }
      }
      row = [];
    } else {
      check(!closed, 'Unexpected text after event CSV quote'); field += c;
    }
    check(field.length <= 1024 * 1024, 'Event CSV field limit');
  }
  check(header, 'Missing event CSV header');
}

// Shelby Storm Events uses the explicit CST-6 source offset, including summer.
// Do not apply America/Chicago DST to these local-standard-time source fields.
export function stormEventTime(row, prefix) {
  check(row.CZ_TIMEZONE === 'CST-6', 'Unsupported Shelby Storm Events time zone');
  const ym = row[`${prefix}_YEARMONTH`], day = integer(row[`${prefix}_DAY`], 'event day');
  check(/^\d{6}$/.test(ym), 'Invalid event year/month');
  const clock = integer(row[`${prefix}_TIME`], 'event time'), hour = Math.floor(clock / 100), minute = clock % 100;
  check(day >= 1 && day <= 31 && hour < 24 && minute < 60, 'Invalid event date/time');
  const local = `${ym.slice(0, 4)}-${ym.slice(4)}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
  return new Date(instant(local) + 6 * 3600000).toISOString();
}

function reportedPoint(raw, prefix, flags) {
  const lat = raw[`${prefix}_LAT`], lon = raw[`${prefix}_LON`];
  if (lat === '' && lon === '') return null;
  const latitude = Number(lat), longitude = Number(lon);
  if (lat === '' || lon === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < BBOX[1] || latitude > BBOX[3] || longitude < BBOX[0] || longitude > BBOX[2]) {
    flags.push(`${prefix.toLowerCase()}-location-unusable-for-local-map`); return null;
  }
  return [longitude, latitude];
}

export function stormEventArchive(bytes, request) {
  validateRequest(request); check(request.product === 'storm-events', 'Expected Storm Events request');
  check(bytes.length <= 32 * 1024 * 1024, 'Storm Events compressed byte limit');
  const expanded = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(expanded);
  const required = ['EVENT_ID', 'EPISODE_ID', 'YEAR', 'STATE', 'STATE_FIPS', 'CZ_TYPE', 'CZ_FIPS', 'CZ_NAME', 'WFO',
    'EVENT_TYPE', 'CZ_TIMEZONE', 'BEGIN_YEARMONTH', 'BEGIN_DAY', 'BEGIN_TIME', 'END_YEARMONTH', 'END_DAY', 'END_TIME',
    'BEGIN_LAT', 'BEGIN_LON', 'END_LAT', 'END_LON'];
  const records = [], months = new Set(), ids = new Set(); let totalRows = 0;
  for (const raw of eventCsvRecords(text)) {
    check(required.every(k => Object.hasOwn(raw, k)), 'Storm Events required columns missing');
    check(raw.YEAR === String(request.year) && new RegExp(`^${request.year}(0[1-9]|1[0-2])$`).test(raw.BEGIN_YEARMONTH), 'Storm Events archive year mismatch');
    totalRows++; months.add(raw.BEGIN_YEARMONTH);
    if (raw.STATE_FIPS !== '47') continue;
    const ugc = raw.CZ_TYPE === 'C' && Number(raw.CZ_FIPS) === 157 ? 'TNC157'
      : raw.CZ_TYPE === 'Z' && Number(raw.CZ_FIPS) === 88 ? 'TNZ088' : null;
    if (!ugc) continue;
    check(raw.STATE === 'TENNESSEE' && raw.CZ_NAME === 'SHELBY' && raw.WFO === 'MEG', 'Shelby event geography identity mismatch');
    const eventId = integer(raw.EVENT_ID, 'event ID'), episodeId = integer(raw.EPISODE_ID, 'episode ID');
    check(eventId > 0 && episodeId > 0 && !ids.has(eventId), 'Duplicate or empty Storm Events ID'); ids.add(eventId);
    const beginsAt = stormEventTime(raw, 'BEGIN'), endsAt = stormEventTime(raw, 'END');
    check(endsAt >= beginsAt, 'Storm Events end precedes beginning');
    const flags = ['county-or-zone-reference-not-damage-footprint', 'retrospective-source-not-outage-causation'];
    const reportedLocations = { begin: reportedPoint(raw, 'BEGIN', flags), end: reportedPoint(raw, 'END', flags) };
    records.push({ eventId, episodeId, eventType: raw.EVENT_TYPE, beginsAt, endsAt,
      timeBasis: 'source CST-6 fixed offset (UTC minus six hours), not daylight time',
      area: { ugc, type: raw.CZ_TYPE === 'C' ? 'county' : 'forecast-zone', name: raw.CZ_NAME },
      geometry: null, reportedLocations, qualityFlags: flags, raw });
  }
  check(totalRows > 0, 'Storm Events archive is empty');
  return { processingVersion: EVENT_CONTEXT_VERSION, year: request.year, revision: request.revision,
    expandedBytes: expanded.length, totalRows, observedBeginMonths: [...months].sort(), records,
    documentation: 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf' };
}

export function stormEventWindow(archive, from, to) {
  const range = windowUtc(from, to), start = instant(from), end = instant(to);
  check(Number(range.from.slice(0, 4)) === archive.year && new Date(end - 1).getUTCFullYear() === archive.year,
    'Event window requires one supported source year');
  const months = new Set([range.from.slice(0, 7).replace('-', ''), new Date(end - 1).toISOString().slice(0, 7).replace('-', '')]);
  const withinObservedMonths = [...months].every(m => archive.observedBeginMonths.includes(m));
  const records = archive.records.filter(r => instant(r.beginsAt) < end &&
    (instant(r.endsAt) > start || (r.beginsAt === r.endsAt && instant(r.beginsAt) >= start)));
  return { processingVersion: EVENT_CONTEXT_VERSION, range, scope: SHELBY_UGCS, records,
    availability: records.length ? 'available' : withinObservedMonths ? 'no-matching-records' : 'outside-observed-archive-months',
    archive: { year: archive.year, revision: archive.revision, totalRows: archive.totalRows,
      observedBeginMonths: archive.observedBeginMonths, withinObservedMonths },
    qualityFlags: ['observed-archive-months-not-completeness-guarantee', 'missing-record-not-no-hazard',
      'event-endpoints-not-damage-polygons', 'historical-weather-does-not-fill-outage-gaps'] };
}

function warningTime(raw) {
  check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw), 'Invalid warning UTC time');
  return new Date(instant(raw.replace(' ', 'T') + ':00Z')).toISOString();
}
const phenomenaNames = { IS: 'Ice Storm', EH: 'Excessive Heat', HT: 'Heat', FA: 'Flood', FL: 'River Flood',
  FF: 'Flash Flood', SV: 'Severe Thunderstorm', TO: 'Tornado', WI: 'Wind', HW: 'High Wind', WS: 'Winter Storm', WW: 'Winter Weather' };
const significanceNames = { W: 'Warning', A: 'Watch', Y: 'Advisory', S: 'Statement', F: 'Forecast', O: 'Outlook', N: 'Synopsis' };
export function countyZoneWarnings(bytes, request) {
  validateRequest(request); check(request.product === 'zone-warnings', 'Expected county/zone warning request');
  const records = [], seen = new Set(); let sourceRows = 0, unselectedPolygonRows = 0;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const required = ['wfo', 'utc_issue', 'utc_expire', 'utc_prodissue', 'utc_updated', 'phenomena', 'significance', 'eventid', 'gtype', 'ugc', 'status', 'vtec_year'];
  // Validate even an empty archive's header; HTML/error bodies must not become no warnings.
  const header = text.trimStart().split(/\r?\n/, 1)[0].split(',');
  check(required.every(k => header.includes(k)), 'Warning required columns missing');
  for (const raw of eventCsvRecords(text, { maxRows: 10000, maxChars: 8 * 1024 * 1024 })) {
    sourceRows++; check(raw.wfo === 'MEG', 'Unexpected warning office');
    if (raw.gtype === 'P') { unselectedPolygonRows++; continue; }
    check(raw.gtype === 'C', 'Unsupported warning geometry class');
    if (!SHELBY_UGCS.includes(raw.ugc)) continue;
    const beginsAt = warningTime(raw.utc_issue), endsAt = warningTime(raw.utc_expire), issuedAt = warningTime(raw.utc_prodissue);
    check(endsAt > beginsAt && issuedAt <= endsAt, 'Invalid warning interval');
    // Some provider queries include their endpoint; our snapshots use [start, end).
    if (!(instant(beginsAt) <= instant(request.validAt) && instant(request.validAt) < instant(endsAt))) continue;
    check(issuedAt <= request.validAt, 'Warning issued after selected instant');
    const year = integer(raw.vtec_year, 'VTEC year'), eventid = integer(raw.eventid, 'VTEC event ID');
    check(/^[A-Z]{2}$/.test(raw.phenomena) && Object.hasOwn(significanceNames, raw.significance), 'Invalid warning phenomenon/significance');
    const event = { year, phenomena: raw.phenomena, significance: raw.significance, eventid };
    const key = `${year}-MEG-${raw.phenomena}-${raw.significance}-${eventid}-${raw.ugc}`;
    check(!seen.has(key), 'Duplicate county/zone warning'); seen.add(key);
    records.push({ key, event, label: `${phenomenaNames[raw.phenomena] ?? raw.phenomena} ${significanceNames[raw.significance]}`,
      area: { ugc: raw.ugc, type: raw.ugc[2] === 'C' ? 'county' : 'forecast-zone' }, beginsAt, endsAt, issuedAt,
      archiveUpdatedAt: raw.utc_updated ? warningTime(raw.utc_updated) : null, archiveStatus: raw.status, raw });
  }
  return { processingVersion: EVENT_CONTEXT_VERSION, validAt: request.validAt, scope: SHELBY_UGCS,
    sourceRows, unselectedPolygonRows, records, availability: records.length ? 'available' : 'no-matching-warnings',
    qualityFlags: ['exact-time-snapshot-not-period-coverage', 'retrospective-final-status-not-issuance-time-replay',
      'county-and-zone-areas-not-storm-polygons', 'no-warning-not-proof-of-no-hazard'] };
}

export function warningAreaGeometry(bytes, request, ugc) {
  validateRequest(request); check(request.product === 'warning-geometry' && SHELBY_UGCS.includes(ugc), 'Invalid warning geometry scope');
  check(bytes.length <= 8 * 1024 * 1024, 'Warning geometry byte limit');
  const data = JSON.parse(bytes.toString('utf8'));
  check(data.type === 'FeatureCollection' && Array.isArray(data.features) && data.features.length <= 1000
    && data.count === data.features.length, 'Invalid warning geometry collection');
  const selected = data.features.filter(f => f.id === ugc);
  check(selected.length === 1, 'Missing or duplicate warning area geometry');
  const feature = selected[0], p = feature.properties, g = feature.geometry;
  check(feature.type === 'Feature' && p?.eventid === request.event.eventid && p.phenomena === request.event.phenomena
    && p.significance === request.event.significance, 'Warning geometry event identity mismatch');
  check(['Polygon', 'MultiPolygon'].includes(g?.type) && Array.isArray(g.coordinates), 'Invalid warning polygon');
  let vertices = 0, west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  check(polygons.length > 0 && polygons.length <= 100, 'Invalid warning polygon count');
  for (const rings of polygons) {
    check(Array.isArray(rings) && rings.length > 0 && rings.length <= 100, 'Invalid warning polygon rings');
    for (const ring of rings) {
      check(Array.isArray(ring) && ring.length >= 4, 'Invalid warning polygon ring');
      for (const point of ring) {
        check(++vertices <= 100000 && Array.isArray(point) && point.length === 2 && point.every(Number.isFinite), 'Invalid warning vertex');
        const [x, y] = point;
        check(x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3], 'Warning geometry outside Shelby extent');
        west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y);
      }
      check(ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], 'Unclosed warning ring');
    }
  }
  check(west < east && south < north, 'Degenerate warning geometry');
  return { feature, vertices, bbox: [west, south, east, north], crs: 'EPSG:4326',
    interpretation: 'Preserved IEM administrative county/zone geometry; boundary vintage not independently certified; not a hazard footprint.' };
}

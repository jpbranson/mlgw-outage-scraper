import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { sourceRequest, warningGeometryRequest, validateRequest } from '../src/weather/sources.mjs';
import { eventCsvRecords, stormEventTime, stormEventArchive, stormEventWindow, countyZoneWarnings, warningAreaGeometry } from '../src/weather/event-context.mjs';

const event = (extra = {}) => ({ EVENT_ID: '1001', EPISODE_ID: '100', YEAR: '2023', STATE: 'TENNESSEE', STATE_FIPS: '47',
  CZ_TYPE: 'C', CZ_FIPS: '157', CZ_NAME: 'SHELBY', WFO: 'MEG', EVENT_TYPE: 'Thunderstorm Wind', CZ_TIMEZONE: 'CST-6',
  BEGIN_YEARMONTH: '202306', BEGIN_DAY: '25', BEGIN_TIME: '1736', END_YEARMONTH: '202306', END_DAY: '25', END_TIME: '1741',
  BEGIN_LAT: '35.3414', BEGIN_LON: '-89.9101', END_LAT: '', END_LON: '', EVENT_NARRATIVE: 'Trees down, with "reported" damage.\nSecond line.', ...extra });
const csv = (rows, header = Object.keys(rows[0])) => [header.join(','), ...rows.map(r => header.map(k => '"' + r[k].replaceAll('"', '""') + '"').join(','))].join('\r\n') + '\r\n';
const request = sourceRequest('storm-events', '2023-01-01T00:00:00Z');
const archive = rows => stormEventArchive(gzipSync(Buffer.from(csv(rows))), request);
const snapshot = sourceRequest('zone-warnings', '2023-06-25T23:00:00Z');
const warning = (extra = {}) => ({ wfo: 'MEG', utc_issue: '2023-06-25 22:00', utc_expire: '2023-06-26 01:00',
  utc_prodissue: '2023-06-25 21:00', utc_updated: '2023-06-26 01:05', phenomena: 'HT', significance: 'Y',
  eventid: '1', gtype: 'C', ugc: 'TNZ088', status: 'EXP', vtec_year: '2023', ...extra });
const warningData = rows => countyZoneWarnings(Buffer.from(csv(rows)), snapshot);
const geometryRequest = warningGeometryRequest({ year: 2023, phenomena: 'HT', significance: 'Y', eventid: 1 });
const feature = () => ({ type: 'Feature', id: 'TNZ088', properties: { phenomena: 'HT', significance: 'Y', eventid: 1 },
  geometry: { type: 'MultiPolygon', coordinates: [[[[-90.1, 35], [-89.7, 35], [-89.7, 35.4], [-90.1, 35.4], [-90.1, 35]]]] } });
const geometryBody = features => Buffer.from(JSON.stringify({ type: 'FeatureCollection', count: features.length, features }));

test('source requests pin event releases, constrain minute snapshots and reject arbitrary URLs or geometry identities', () => {
  validateRequest(request); validateRequest(snapshot); validateRequest(geometryRequest);
  assert.match(request.url, /d2023_c20260323\.csv\.gz$/);
  assert.throws(() => validateRequest({ ...request, url: 'https://example.com/events.gz' }), /allowlist/);
  assert.throws(() => validateRequest({ ...request, revision: '20260918' }), /allowlist/);
  assert.throws(() => sourceRequest('storm-events', '2025-01-01T00:00:00Z'), /pinned/);
  assert.throws(() => sourceRequest('zone-warnings', '2023-06-25T23:00:01Z'), /minute/);
  assert.throws(() => warningGeometryRequest({ year: 2023, phenomena: '../', significance: 'W', eventid: 1 }), /identity/);
  assert.throws(() => warningGeometryRequest({ year: 2023, phenomena: 'IS', significance: 'W', eventid: 0 }), /identity/);
});
test('bounded CSV preserves commas, escaped quotes and narrative newlines, rejecting malformed/truncated input', () => {
  const original = event(); assert.deepEqual([...eventCsvRecords('\ufeff' + csv([original]))], [original]);
  for (const text of ['a,a\n1,2', 'a,b\n1', 'a\n"truncated', 'a\n"a"suffix', 'a\nab"cd'])
    assert.throws(() => [...eventCsvRecords(text)], /CSV|quote/);
  assert.throws(() => [...eventCsvRecords('a\n1\n2', { maxRows: 1 })], /row limit/);
  assert.throws(() => [...eventCsvRecords('a\n123', { maxChars: 4 })], /expansion limit/);
});
test('event UTC conversion uses explicit CST-6 in summer and around DST transitions', () => {
  assert.equal(stormEventTime(event(), 'BEGIN'), '2023-06-25T23:36:00.000Z');
  assert.equal(stormEventTime(event({ BEGIN_YEARMONTH: '202311', BEGIN_DAY: '5', BEGIN_TIME: '130' }), 'BEGIN'), '2023-11-05T07:30:00.000Z');
  assert.equal(stormEventTime(event({ BEGIN_YEARMONTH: '202303', BEGIN_DAY: '12', BEGIN_TIME: '230' }), 'BEGIN'), '2023-03-12T08:30:00.000Z');
  assert.throws(() => stormEventTime(event({ CZ_TIMEZONE: 'America/Chicago' }), 'BEGIN'), /time zone/);
  assert.throws(() => stormEventTime(event({ BEGIN_YEARMONTH: '202302', BEGIN_DAY: '30' }), 'BEGIN'), /Invalid UTC/);
  assert.throws(() => stormEventTime(event({ BEGIN_TIME: '2400' }), 'BEGIN'), /date\/time/);
});
test('county and forecast-zone identity stay separate; reported points never become a damage polygon', () => {
  const a = archive([event(), event({ EVENT_ID: '1002', CZ_TYPE: 'Z', CZ_FIPS: '88', EVENT_TYPE: 'Excessive Heat', BEGIN_LAT: '', BEGIN_LON: '' }),
    event({ EVENT_ID: '1003', STATE: 'KENTUCKY', STATE_FIPS: '21' }), event({ EVENT_ID: '1004', CZ_TYPE: 'C', CZ_FIPS: '88' })]);
  assert.equal(a.totalRows, 4); assert.equal(a.records.length, 2);
  assert.deepEqual(a.records.map(r => r.area.ugc), ['TNC157', 'TNZ088']);
  assert.equal(a.records[0].geometry, null); assert.deepEqual(a.records[0].reportedLocations.begin, [-89.9101, 35.3414]);
  assert.equal(a.records[1].reportedLocations.begin, null);
  assert.equal(a.records[0].raw.EVENT_NARRATIVE, event().EVENT_NARRATIVE);
  const invalid = archive([event({ BEGIN_LAT: '0', BEGIN_LON: '0' })]).records[0];
  assert.equal(invalid.reportedLocations.begin, null); assert.ok(invalid.qualityFlags.includes('begin-location-unusable-for-local-map'));
});
test('event duplicates, inconsistent geography/year and reversed intervals fail validation', () => {
  assert.throws(() => archive([event(), event()]), /Duplicate/);
  assert.throws(() => archive([event({ CZ_NAME: 'DIFFERENT' })]), /geography/);
  assert.throws(() => archive([event({ YEAR: '2022' })]), /year/);
  assert.throws(() => archive([event({ END_TIME: '1700' })]), /precedes/);
  assert.throws(() => stormEventArchive(Buffer.from('not gzip'), request));
});
test('period overlap includes instantaneous events but excludes the ending boundary', () => {
  const a = archive([event(), event({ EVENT_ID: '1002', BEGIN_TIME: '1736', END_TIME: '1736' })]);
  assert.equal(stormEventWindow(a, '2023-06-25T23:36:00Z', '2023-06-25T23:40:00Z').records.length, 2);
  assert.equal(stormEventWindow(a, '2023-06-25T23:00:00Z', '2023-06-25T23:36:00Z').records.length, 0);
  assert.equal(stormEventWindow(a, '2023-06-25T23:41:00Z', '2023-06-26T00:00:00Z').records.length, 0);
});
test('empty historical matches and dates beyond observed archive months remain different states', () => {
  const a = archive([event()]);
  assert.equal(stormEventWindow(a, '2023-06-01T00:00:00Z', '2023-06-02T00:00:00Z').availability, 'no-matching-records');
  assert.equal(stormEventWindow(a, '2023-09-01T00:00:00Z', '2023-09-02T00:00:00Z').availability, 'outside-observed-archive-months');
  assert.throws(() => stormEventWindow(a, '2023-12-31T00:00:00Z', '2024-01-02T00:00:00Z'), /source year/);
});
test('county/zone snapshots include prior-issued active warnings despite retrospective cancellation/expiry', () => {
  const data = warningData([warning({ status: 'CAN' })]);
  assert.equal(data.records.length, 1); assert.equal(data.records[0].archiveStatus, 'CAN');
  assert.equal(data.records[0].archiveUpdatedAt, '2023-06-26T01:05:00.000Z');
  assert.ok(data.qualityFlags.includes('retrospective-final-status-not-issuance-time-replay'));
  assert.equal(data.records[0].area.type, 'forecast-zone');
  assert.equal(data.records[0].label, 'Heat Advisory');
});
test('warning instants use half-open intervals and reject future issuances, duplicate areas and unexpected offices', () => {
  assert.equal(warningData([warning({ utc_expire: '2023-06-25 23:00' })]).records.length, 0);
  assert.equal(warningData([warning({ utc_issue: '2023-06-25 23:00' })]).records.length, 1);
  assert.throws(() => warningData([warning({ utc_prodissue: '2023-06-25 23:30' })]), /issued after/);
  assert.throws(() => warningData([warning(), warning()]), /Duplicate/);
  assert.throws(() => warningData([warning({ wfo: 'JAN' })]), /office/);
});
test('storm polygons and other counties are counted separately, and schema errors never become no warnings', () => {
  const data = warningData([warning({ gtype: 'P', ugc: '' }), warning({ ugc: 'TNC001' })]);
  assert.equal(data.sourceRows, 2); assert.equal(data.unselectedPolygonRows, 1); assert.equal(data.availability, 'no-matching-warnings');
  assert.equal(countyZoneWarnings(Buffer.from(csv([], Object.keys(warning()))), snapshot).availability, 'no-matching-warnings');
  assert.throws(() => countyZoneWarnings(Buffer.from('<html>failure</html>'), snapshot), /columns/);
  assert.throws(() => warningData([warning({ gtype: 'X' })]), /geometry class/);
});
test('administrative geometry keeps the matching original feature and validates rings, bounds and event identity', () => {
  const f = feature(), decoded = warningAreaGeometry(geometryBody([f]), geometryRequest, 'TNZ088');
  assert.deepEqual(decoded.feature, f); assert.equal(decoded.vertices, 5);
  assert.deepEqual(decoded.bbox, [-90.1, 35, -89.7, 35.4]);
  assert.throws(() => warningAreaGeometry(geometryBody([f, f]), geometryRequest, 'TNZ088'), /duplicate/);
  assert.throws(() => warningAreaGeometry(geometryBody([]), geometryRequest, 'TNZ088'), /Missing/);
  const wrong = feature(); wrong.properties.phenomena = 'IS';
  assert.throws(() => warningAreaGeometry(geometryBody([wrong]), geometryRequest, 'TNZ088'), /identity/);
  const open = feature(); open.geometry.coordinates[0][0].pop();
  assert.throws(() => warningAreaGeometry(geometryBody([open]), geometryRequest, 'TNZ088'), /Unclosed/);
  const far = feature(); far.geometry.coordinates[0][0][0] = [0, 0];
  assert.throws(() => warningAreaGeometry(geometryBody([far]), geometryRequest, 'TNZ088'), /outside/);
});

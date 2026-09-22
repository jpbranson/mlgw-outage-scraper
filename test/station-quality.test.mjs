import test from 'node:test';
import assert from 'node:assert/strict';
import { stationField, stationQuality } from '../src/weather/station-quality.mjs';
import { stationSubset } from '../src/weather/decode.mjs';
const row = (at = '2023-11-05T06:54:00.000Z') => ({
  STATION: 'USW00013893', DATE: at, LATITUDE: '35.0564', LONGITUDE: '-89.9864',
  temperature: '12.3', temperature_Source_Code: '223', temperature_Quality_Code: '1',
  precipitation: '2.5', precipitation_Source_Code: '223', precipitation_Quality_Code: '1',
  precipitation_Report_Type: 'FM15', REM_Report_Type: 'FM15',
});
const subset = rows => ({ station: 'USW00013893', range: { from: '2023-11-05T06:00:00Z', to: '2023-11-05T08:00:00Z' }, rows });

test('QC code meaning depends on source; gross-limit checks are not full QC', () => {
  const r = row(); r.temperature_Quality_Code = '5';
  assert.equal(stationField(r, 'temperature').status, 'removed');
  r.temperature_Source_Code = '343';
  assert.equal(stationField(r, 'temperature').value, 12.3);
  for (const code of ['0', '4', '9']) {
    r.temperature_Quality_Code = code;
    assert.equal(stationField(r, 'temperature').status, 'gross-limits-only');
    assert.equal(stationField(r, 'temperature').value, null);
  }
  for (const [code, status] of [['2', 'suspect'], ['7', 'erroneous'], ['A', 'suspect-accepted-by-source'], ['U', 'edited']]) {
    r.temperature_Quality_Code = code;
    assert.equal(stationField(r, 'temperature').status, status);
    assert.equal(stationField(r, 'temperature').eligible, false);
  }
});
test('integrated flags, unknown sources, missing QC and invalid numbers fail closed per field', () => {
  const r = row(); r.temperature_Quality_Code = '1s';
  assert.equal(stationField(r, 'temperature').status, 'flagged-integrated-check');
  assert.equal(stationField(r, 'precipitation').value, 2.5); // another field remains usable
  r.temperature_Source_Code = '413'; r.temperature_Quality_Code = '1';
  assert.equal(stationField(r, 'temperature').status, 'unknown-source');
  r.temperature_Source_Code = '223'; r.temperature_Quality_Code = '';
  assert.equal(stationField(r, 'temperature').status, 'quality-not-reported');
  r.temperature_Quality_Code = '1';
  for (const value of ['', '-9999']) { r.temperature = value; assert.equal(stationField(r, 'temperature').status, 'missing'); }
  for (const value of ['NaN', 'Infinity', '12 C', '-999.9', '0x10']) {
    r.temperature = value; assert.equal(stationField(r, 'temperature').status, 'invalid-number');
  }
});
test('trace, missing, measured zero and unsupported precipitation measurements stay distinct', () => {
  const r = row(); r.precipitation = '0.0';
  assert.equal(stationField(r, 'precipitation').value, 0);
  for (const code of ['T', '2']) {
    r.precipitation_Measurement_Code = code;
    const f = stationField(r, 'precipitation');
    assert.equal(f.status, 'trace'); assert.equal(f.eligible, true); assert.equal(f.value, null);
  }
  r.precipitation = '2.0'; assert.equal(stationField(r, 'precipitation').status, 'inconsistent-trace');
  for (const code of ['1', '4', 'I', 'J', 'E', 'Z']) {
    r.precipitation_Measurement_Code = code;
    assert.equal(stationField(r, 'precipitation').status, 'unsupported-precipitation-measurement');
  }
  r.precipitation = ''; assert.equal(stationField(r, 'precipitation').status, 'missing');
});
test('wind calm and alternative averaging codes are checked without converting units', () => {
  const r = { wind_speed: '0.0', wind_speed_Source_Code: '343', wind_speed_Quality_Code: '5', wind_speed_Measurement_Code: 'C' };
  assert.equal(stationField(r, 'wind_speed').value, 0);
  r.wind_speed = '3.6'; assert.equal(stationField(r, 'wind_speed').status, 'inconsistent-calm');
  r.wind_speed_Measurement_Code = 'R'; assert.equal(stationField(r, 'wind_speed').status, 'unsupported-wind-measurement');
  r.wind_speed_Measurement_Code = 'N'; assert.equal(stationField(r, 'wind_speed').value, 3.6);
  assert.equal(stationField(r, 'wind_speed').units, 'm/s');
});
test('hourly precipitation selects one final routine report and never adds SPECI running totals', () => {
  const first = row('2023-11-05T06:15:00.000Z'); first.precipitation = '0.5'; first.precipitation_Report_Type = 'FM16';
  const last = row(); const input = subset([last, first]); const before = JSON.stringify(input);
  const result = stationQuality(input);
  assert.equal(result.hourlyPrecipitation[0].value, 2.5);
  assert.equal(result.hourlyPrecipitation[0].selectedReportAt, last.DATE);
  assert.equal(result.hourlyPrecipitation[1].status, 'missing-report');
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.summary.precipitation.hoursWithAcceptedReports, 1);
  assert.equal(result.summary.precipitation.requestedHours, 2);
});
test('a final flagged or missing report blocks earlier valid rainfall; no fallback or artificial dry hour', () => {
  const early = row('2023-11-05T06:15:00.000Z'), last = row(); early.precipitation_Report_Type = 'FM16';
  last.precipitation_Quality_Code = '2';
  assert.equal(stationQuality(subset([early, last])).hourlyPrecipitation[0].status, 'suspect');
  last.precipitation = ''; last.precipitation_Report_Type = '';
  assert.equal(stationQuality(subset([early, last])).hourlyPrecipitation[0].status, 'missing');
  last.precipitation = '0'; last.precipitation_Report_Type = 'FM16'; last.precipitation_Quality_Code = '1';
  assert.equal(stationQuality(subset([early, last])).hourlyPrecipitation[0].status, 'incomplete-or-unsupported-hour');
  last.precipitation_Report_Type = 'FM15'; last.precipitation_Measurement_Code = 'T';
  assert.equal(stationQuality(subset([last])).hourlyPrecipitation[0].status, 'trace');
  assert.equal(stationQuality(subset([last])).hourlyPrecipitation[0].value, null);
});
test('UTC DST hours remain separate and malformed identity, location and duplicate timestamps stop validation', () => {
  const a = row(), b = row('2023-11-05T07:54:00.000Z');
  assert.equal(stationQuality(subset([a, b])).summary.temperature.hoursWithAcceptedReports, 2);
  assert.throws(() => stationQuality(subset([a, a])), /duplicate/);
  assert.throws(() => stationQuality(subset([{ ...a, STATION: 'other' }])), /identity/);
  assert.throws(() => stationQuality(subset([{ ...a, LATITUDE: '' }])), /location/);
  assert.throws(() => stationQuality(subset([row('2023-11-05T08:00:00.000Z')])), /time/);
  assert.throws(() => stationQuality({ ...subset([]), range: { from: '2023-11-05T06:30:00Z', to: '2023-11-05T08:00:00Z' } }), /align/);
  const missing = stationQuality(subset([]));
  assert.equal(missing.availability, 'no-observations'); assert.equal(missing.summary.temperature.min, null);
  assert.deepEqual(missing.hourlyPrecipitationStatuses, { 'missing-report': 2 });
});
test('PSV decode feeds interpretation without dropping raw flags or silently accepting unavailable field metadata', () => {
  const header = 'STATION|DATE|LATITUDE|LONGITUDE|temperature|temperature_Quality_Code|temperature_Source_Code|wind_speed|wind_speed_Quality_Code|precipitation_Measurement_Code';
  const raw = stationSubset(Buffer.from(header + '\nUSW00013893|2023-11-05T06:54:00|35.05|-89.98|12.3|5|343|2.5|1|T'),
    '2023-11-05T06:00:00Z', '2023-11-05T08:00:00Z');
  const interpreted = stationQuality(raw);
  assert.equal(raw.rows[0].temperature_Quality_Code, '5');
  assert.equal(interpreted.rows[0].fields.temperature.value, 12.3);
  assert.equal(interpreted.rows[0].fields.wind_speed.status, 'unknown-source');
  assert.equal(interpreted.rows[0].fields.precipitation.status, 'missing');
});

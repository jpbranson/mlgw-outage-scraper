import { instant, STATION, windowUtc } from './sources.mjs';

export const STATION_QUALITY_VERSION = 'ghcnh-station-quality-v1';
export const STATION_QUALITY_DOCUMENT = {
  url: 'https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf',
  version: '1.1.0, March 10, 2026',
  sha256: 'df5694efdc2d498f006a343165bae65701d14809174b9bed660149bd4fe591b7',
  sections: ['IV (units)', 'V (measurement codes)', 'VI (source-specific QC)', 'IX (running precipitation totals)'],
};
const HOUR = 3600000;
const legacy = new Set(['313', '314', '315', '322', '335', '343', '344', '346']);
const surface = new Set(['220', '221', '222', '223', '347', '348']);
const integratedChecks = new Set('abcdefhiklmnoprstuvwxz');
export const STATION_FIELDS = Object.freeze({
  temperature: { units: 'degC', integrated: true },
  dew_point_temperature: { units: 'degC', integrated: true },
  wind_speed: { units: 'm/s', integrated: true },
  wind_gust: { units: 'm/s', integrated: false },
  precipitation: { units: 'mm', integrated: false },
});

// Deliberately conservative eligibility, not a claim of independent measurement accuracy.
// Unknown sources/codes and edited/calculated values remain available in raw provenance.
function qualityStatus(field, source, code) {
  if (STATION_FIELDS[field].integrated && [...code].some(c => integratedChecks.has(c))) return 'flagged-integrated-check';
  if (!legacy.has(source) && !surface.has(source)) return 'unknown-source';
  if (code === '') return 'quality-not-reported';
  if (surface.has(source)) return ({
    '0': 'unchecked', '1': 'passed', '2': 'suspect', '3': 'erroneous', '4': 'calculated', '5': 'removed',
  })[code] ?? 'unknown-quality-code';
  return ({
    '0': 'gross-limits-only', '1': 'passed', '2': 'suspect', '3': 'erroneous',
    '4': 'gross-limits-only', '5': 'passed', '6': 'suspect', '7': 'erroneous',
    '9': 'gross-limits-only', A: 'suspect-accepted-by-source', U: 'edited', P: 'edited',
    I: 'inserted', M: 'manually-changed', R: 'calculated',
  })[code] ?? 'unknown-quality-code';
}

export function stationField(row, field) {
  const spec = STATION_FIELDS[field];
  if (!spec) throw Error('Unsupported station quality field');
  const raw = {
    value: row[field] ?? '', qualityCode: row[`${field}_Quality_Code`] ?? '',
    measurementCode: row[`${field}_Measurement_Code`] ?? '', sourceCode: row[`${field}_Source_Code`] ?? '',
    reportType: row[`${field}_Report_Type`] ?? '', sourceStationId: row[`${field}_Source_Station_ID`] ?? '',
  };
  const q = qualityStatus(field, raw.sourceCode, raw.qualityCode);
  const result = { units: spec.units, raw, qualityStatus: q, status: null, value: null, eligible: false };
  const finish = status => ({ ...result, status });
  const valueText = raw.value.trim(), measurement = raw.measurementCode;
  if (valueText === '' || valueText === '-9999') return finish('missing');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(valueText)) return finish('invalid-number');
  const value = Number(valueText);
  if (!Number.isFinite(value) || (spec.units === 'degC' ? value < -273.15 : value < 0)) return finish('invalid-number');
  if (q !== 'passed') return finish(q);
  if (field === 'precipitation') {
    if (measurement === 'T' || measurement === '2') {
      if (value !== 0) return finish('inconsistent-trace');
      return { ...result, status: 'trace', eligible: true }; // qualitative presence only; never numeric zero
    }
    if (measurement !== '') return finish('unsupported-precipitation-measurement');
  } else if (field === 'wind_speed') {
    if (!['', 'N', 'C', 'V'].includes(measurement)) return finish('unsupported-wind-measurement');
    if (measurement === 'C' && value !== 0) return finish('inconsistent-calm');
  } else if (measurement !== '') return finish('unknown-measurement-code');
  return { ...result, status: 'accepted', value, eligible: true };
}

// These are nominal clock-hour report totals, not exact one-hour intervals or a
// daily accumulation. Never sum SPECI running totals or substitute an earlier
// good reading for a later unusable report. A final routine report at/after :45
// is required here, stricter than the general last-report rule in NOAA section IX.
function precipitationHours(rows, from, to) {
  const byHour = new Map();
  for (const row of rows) {
    const rain = row.fields.precipitation;
    const reportType = rain.raw.reportType || row.rawRemarkReportType;
    if (!['FM15', 'FM16'].includes(reportType) && rain.status === 'missing') continue;
    const hour = row.at.slice(0, 13);
    const prior = byHour.get(hour);
    if (!prior || row.at > prior.at) byHour.set(hour, { ...rain, at: row.at, reportType });
  }
  const output = [];
  for (let time = instant(from); time < instant(to); time += HOUR) {
    const fromHour = new Date(time).toISOString(), last = byHour.get(fromHour.slice(0, 13));
    let status = 'missing-report', value = null;
    if (last) {
      status = last.status;
      if (last.reportType !== 'FM15' || Number(last.at.slice(14, 16)) < 45) status = 'incomplete-or-unsupported-hour';
      if (status === 'accepted') value = last.value;
    }
    output.push({ reportHour: fromHour, selectedReportAt: last?.at ?? null, status, value,
      units: 'mm', sourceCode: last?.raw.sourceCode ?? null });
  }
  return output;
}

export function stationQuality(subset) {
  const { from, to } = windowUtc(subset.range.from, subset.range.to);
  if (subset.station !== STATION || !Array.isArray(subset.rows) || subset.rows.length > 100000) throw Error('Invalid station quality input');
  if (instant(from) % HOUR || instant(to) % HOUR) throw Error('Station quality windows must align to UTC hours');
  const seen = new Set();
  const rows = subset.rows.map(raw => {
    const at = new Date(instant(raw.DATE)).toISOString();
    if (raw.STATION !== STATION || at < from || at >= to || seen.has(at)) throw Error('Station quality identity, time or duplicate row mismatch');
    seen.add(at);
    const latitude = Number(raw.LATITUDE), longitude = Number(raw.LONGITUDE);
    if (!raw.LATITUDE?.trim() || !raw.LONGITUDE?.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw Error('Invalid station quality location');
    return { at, station: raw.STATION, latitude, longitude, rawRemarkReportType: raw.REM_Report_Type ?? '',
      fields: Object.fromEntries(Object.keys(STATION_FIELDS).map(field => [field, stationField(raw, field)])) };
  }).sort((a, b) => a.at.localeCompare(b.at));
  const requestedHours = (instant(to) - instant(from)) / HOUR;
  const summary = Object.fromEntries(Object.keys(STATION_FIELDS).map(field => {
    const counts = {}, acceptedHours = new Set(), traceHours = new Set(), values = [];
    for (const row of rows) {
      const f = row.fields[field]; counts[f.status] = (counts[f.status] ?? 0) + 1;
      if (f.status === 'accepted') { acceptedHours.add(row.at.slice(0, 13)); values.push(f.value); }
      if (f.status === 'trace') traceHours.add(row.at.slice(0, 13));
    }
    return [field, { units: STATION_FIELDS[field].units, records: rows.length, statuses: counts,
      hoursWithAcceptedReports: acceptedHours.size, hoursWithTraceReports: traceHours.size, requestedHours,
      min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }];
  }));
  const hourlyPrecipitation = precipitationHours(rows, from, to);
  return { processingVersion: STATION_QUALITY_VERSION, documentation: STATION_QUALITY_DOCUMENT,
    station: STATION, range: { from, to }, availability: rows.length ? 'available' : 'no-observations',
    sourceCoverage: subset.sourceCoverage, rows, summary, hourlyPrecipitation,
    hourlyPrecipitationStatuses: hourlyPrecipitation.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1; return counts;
    }, {}),
    interpretation: [
      'Eligibility requires explicitly passed source QC and supported measurement semantics; it is not independent certification.',
      'Missing, unchecked, unknown, edited, calculated and flagged values are retained but excluded from numeric comparisons.',
      'Station report-hour coverage is field-specific and does not establish continuous measurement coverage.',
      'Precipitation is liquid equivalent, including melted snow; trace has no numeric amount and intermediate reports are running totals.',
      'Nominal precipitation hours require the final report to be routine FM15 at/after minute 45; no earlier-report fallback or period sum.',
      'An airport measurement is regional context, not neighborhood conditions or proof of ice accretion or outage causation.',
    ] };
}

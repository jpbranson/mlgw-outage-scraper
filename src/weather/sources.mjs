export const PROCESSING_VERSION = 'weather-source-pilot-v1';
export const BBOX = Object.freeze([-90.4, 34.9, -89.6, 35.5]); // Covers all preserved Shelby County polygons.
export const SUBSET_VERSION = 'weather-subset-v2'; // Wider western extent; source request identities stay unchanged.
export const STATION = 'USW00013893';
export const HOUR = 3600000;

export function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw Error('An explicit UTC timestamp is required');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z','Z') !== value.replace('.000Z','Z')) throw Error('Invalid UTC timestamp');
  return ms;
}
export function windowUtc(from, to) {
  const start = instant(from), end = instant(to);
  if (end <= start || end - start > 72 * HOUR) throw Error('Weather windows must be positive and at most 72 hours');
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}
export function eligibleFrame(selected, frames, toleranceMs = 5 * 60000) {
  const time = instant(selected);
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0 || toleranceMs > HOUR) throw Error('Invalid matching tolerance');
  const found = frames.filter(f => f.availability === 'available' && instant(f.validAt) <= time && time - instant(f.validAt) <= toleranceMs)
    .sort((a,b) => instant(b.validAt)-instant(a.validAt))[0];
  return found ? { ...found, offsetMs: time-instant(found.validAt) } : null;
}
const iem = 'https://mesonet.agron.iastate.edu';
const ncei = 'https://www.ncei.noaa.gov';
const aws = 'https://noaa-mrms-pds.s3.amazonaws.com';
const qpe = 'MultiSensor_QPE_01H_Pass2';
export function sourceRequest(product, at) {
  const ms = instant(at), iso = new Date(ms).toISOString(), stamp = iso.slice(0,16).replace(/[-:T]/g,''), date = stamp.slice(0,8);
  const base = { product, validAt: iso, processingVersion: PROCESSING_VERSION };
  if (product === 'radar' || product === 'radar-world') {
    if (ms % 300000) throw Error('Radar requires an exact five-minute timestamp');
    const ext = product === 'radar' ? 'png' : 'wld';
    return { ...base, provider:'Iowa Environmental Mesonet', productVersion:'N0Q mosaic (N0B input since 2022-04-18)', units:'dBZ', crs:'EPSG:4326',
      url:`${iem}/archive/data/${iso.slice(0,10).replaceAll('-','/')}/GIS/uscomp/n0q_${stamp}.${ext}`, kind:ext,
      qualityFlags:['mosaic-time-not-individual-scan-time','no-echo-does-not-prove-dry','reflectivity-not-rain-depth'] };
  }
  if (product === 'rainfall') {
    if (ms % HOUR || ms < Date.parse('2020-10-15T00:00:00Z')) throw Error('MRMS requires an hourly endpoint after the version-12 transition');
    return { ...base, provider:'NOAA MRMS via NOAA Open Data', productVersion:qpe, units:'mm', crs:'native GRIB latitude/longitude grid',
      intervalStart:new Date(ms-HOUR).toISOString(), intervalEnd:iso, nominalLatencyMinutes:60,
      url:`${aws}/CONUS/${qpe}_00.00/${date}/MRMS_${qpe}_00.00_${date}-${stamp.slice(8)}00.grib2.gz`,kind:'grib2.gz',
      qualityFlags:['estimated-precipitation','one-hour-pass2','not-available-in-real-time-at-valid-time','frozen-precipitation-uncertain'] };
  }
  if (product === 'station') {
    const year=iso.slice(0,4);
    return { ...base, validAt:null, year:Number(year), station:STATION, provider:'NOAA NCEI', productVersion:'GHCNh station/year PSV',
      url:`${ncei}/oa/global-historical-climatology-network/hourly/access/by-year/${year}/psv/GHCNh_${STATION}_${year}.psv`,kind:'psv',
      qualityFlags:['regional-station-not-neighborhood-measurement','source-specific-quality-codes-retained'] };
  }
  if (product === 'metar') {
    if (ms % HOUR) throw Error('METAR retrieval requires an hourly UTC endpoint');
    const from=new Date(ms-24*HOUR).toISOString();
    const params=new URLSearchParams({station:'MEM',network:'TN_ASOS',sts:from,ets:iso,tz:'Etc/UTC',format:'onlycomma',latlon:'yes',elev:'yes',missing:'M',trace:'0.0001'});
    for(const field of ['tmpf','sknt','gust','p01i','wxcodes','metar'])params.append('data',field);
    for(const type of ['3','4'])params.append('report_type',type);
    return {...base,provider:'Iowa Environmental Mesonet / NWS METAR',productVersion:'Routine and special KMEM METAR',station:'KMEM',
      intervalStart:from,intervalEnd:iso,url:`${iem}/cgi-bin/request/asos.py?${params}`,kind:'csv',
      qualityFlags:['regional-airport-observations','not-additionally-quality-controlled','trace-and-missing-preserved','not-a-GHCNh-replacement-series']};
  }
  if (product === 'warnings') return { ...base, provider:'NWS via Iowa Environmental Mesonet',productVersion:'storm-based warnings MEG',crs:'EPSG:4326',kind:'geojson',
    url:`${iem}/geojson/sbw.geojson?ts=${encodeURIComponent(iso)}&wfo=MEG`,qualityFlags:['warned-area-not-confirmed-damage','storm-based-warnings-only'] };
  throw Error('Unsupported weather product');
}
// A caller cannot turn the cache into an arbitrary URL downloader.
export function validateRequest(request) {
  const expected=sourceRequest(request.product, request.product === 'station' ? `${request.year}-01-01T00:00:00Z` : request.validAt);
  if (JSON.stringify(expected) !== JSON.stringify(request)) throw Error('Weather source request does not match the allowlist');
}

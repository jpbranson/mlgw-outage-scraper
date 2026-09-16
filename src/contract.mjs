// Portable source-contract probe; no Node-specific APIs, suitable for a Worker.
export const PARSER_VERSION = 'source-pilot-v1';
export const FEED_URL = 'https://outagemap.mlgw.org/geojson.php';
export const MAP_URL = 'https://outagemap.mlgw.org/OutageSummary.php';
const fields = ['OUTAGE_NO', 'CUR_CUST_AFF', 'TIME_STAMP', 'EST_REPAIR_TIME', 'DURATION', 'IMPACT', 'STATUS', 'OUT_CAUSE'];
const central = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// Match both candidate offsets against the IANA timezone. Ambiguous fall-back
// times remain unresolved; never guess one of their two possible instants.
export function parseSourceTime(raw) {
  if (raw === '' || raw == null) return { raw: raw ?? null, utc: null, status: 'missing', candidates: [] };
  const m = typeof raw === 'string' && raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? (AM|PM)$/);
  const invalid = { raw, utc: null, status: 'invalid', candidates: [] };
  if (!m) return invalid;
  const [, mo, d, y, h, mi, s = '00', ampm] = m;
  if (+y < 2007 || +h < 1 || +h > 12 || +mi > 59 || +s > 59) return invalid;
  const target = { year: +y, month: +mo, day: +d, hour: +h % 12 + (ampm === 'PM' ? 12 : 0), minute: +mi, second: +s };
  const local = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const candidates = [5, 6].map(offset => new Date(local + offset * 3600000)).filter(date => {
    const actual = Object.fromEntries(central.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
    return Object.entries(target).every(([k, v]) => actual[k] === v);
  }).map(date => date.toISOString());
  return { raw, utc: candidates.length === 1 ? candidates[0] : null,
    status: candidates.length === 1 ? 'assumed_central' : candidates.length === 2 ? 'ambiguous' : 'invalid', candidates };
}

export function parseFeed(text) {
  const feed = JSON.parse(text);
  if (feed?.type !== 'FeatureCollection' || !Array.isArray(feed.features)) throw new Error('Expected GeoJSON FeatureCollection');
  const issues = [];
  const issue = (code, index = null, detail = null) => issues.push({ code, index, detail });
  for (const key of Object.keys(feed)) if (!['type', 'features'].includes(key)) issue('unknown_collection_field', null, key);
  const seen = new Set();
  let identityValid = true, countsValid = true, customers = 0;
  const features = feed.features.map((feature, index) => {
    const p = feature?.properties;
    if (feature?.type !== 'Feature' || !p || typeof p !== 'object' || Array.isArray(p)) {
      issue('invalid_feature', index); identityValid = false; countsValid = false; return null;
    }
    for (const key of fields) if (!(key in p)) issue('missing_field', index, key);
    for (const key of Object.keys(p)) if (!fields.includes(key)) issue('unknown_property', index, key);
    let id = null;
    if ((typeof p.OUTAGE_NO === 'string' && p.OUTAGE_NO.trim() !== '') ||
        (Number.isSafeInteger(p.OUTAGE_NO) && p.OUTAGE_NO >= 0)) id = String(p.OUTAGE_NO).trim();
    if (id === null) { issue('invalid_id', index); identityValid = false; }
    else if (seen.has(id)) { issue('duplicate_id', index, id); identityValid = false; }
    else seen.add(id);
    const count = p.CUR_CUST_AFF;
    if (!Number.isSafeInteger(count) || count < 0) { issue('invalid_customer_count', index); countsValid = false; }
    else customers += count;
    const coords = feature.geometry?.coordinates;
    const validPoint = feature.geometry?.type === 'Point' && Array.isArray(coords) && coords.length === 2 &&
      coords.every(Number.isFinite) && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
    if (!validPoint) issue('invalid_geometry', index);
    else if (coords[0] < -90.4 || coords[0] > -89.3 || coords[1] < 34.7 || coords[1] > 35.7) issue('outside_review_bounds', index);
    const start = parseSourceTime(p.TIME_STAMP), repair = parseSourceTime(p.EST_REPAIR_TIME);
    if (start.status !== 'assumed_central') issue('start_' + start.status, index);
    if (!['missing', 'assumed_central'].includes(repair.status)) issue('repair_' + repair.status, index);
    for (const key of ['DURATION', 'IMPACT', 'STATUS', 'OUT_CAUSE']) {
      if (key in p && typeof p[key] !== 'string') issue('invalid_text_field', index, key);
    }
    return { type: 'Feature', id, geometry: validPoint ? { type: 'Point', coordinates: coords } : null,
      properties: { outageId: id, customers: Number.isSafeInteger(count) && count >= 0 ? count : null,
        started: start, estimatedRepair: repair, durationText: p.DURATION ?? null,
        status: p.STATUS ?? null, impact: p.IMPACT ?? null } };
  });
  if (!Number.isSafeInteger(customers)) { countsValid = false; issue('customer_sum_overflow'); }
  const totalsValid = identityValid && countsValid;
  return { parserVersion: PARSER_VERSION, sourceFormat: 'current_geojson',
    sourceUpdatedAt: null, timezoneAssumption: 'America/Chicago', featureCount: feed.features.length,
    totals: { reportedOutages: totalsValid ? features.length : null, customers: totalsValid ? customers : null },
    totalsValid, issues, normalized: { type: 'FeatureCollection', features: features.filter(Boolean) } };
}

// Ignore order, ephemeral feature.id, and DURATION-only changes. Keep causes and
// unknown properties in this comparison so schema drift cannot disappear.
export function meaningfulState(text) {
  const feed = JSON.parse(text);
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
    return value;
  }
  const features = feed.features.map(f => {
    const { DURATION, ...properties } = f?.properties ?? {};
    return JSON.stringify(stable({ type: f?.type, properties, geometry: f?.geometry }));
  }).sort();
  const { features: ignored, ...collection } = feed;
  return JSON.stringify({ collection: stable(collection), features });
}

export function parseHtmlSummary(html) {
  const plain = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const counts = [...plain.matchAll(/Customers\s+Without\s+Power\s+([\d,]+)/gi)].map(m => +m[1].replaceAll(',', ''));
  const times = [...plain.matchAll(/CURRENT AS\s+OF\s+(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (?:AM|PM))/g)].map(m => m[1]);
  return { customers: counts.length && new Set(counts).size === 1 ? counts[0] : null,
    currentAsOf: new Set(times).size === 1 ? times[0] : null,
    consistent: counts.length > 0 && new Set(counts).size === 1,
    reportedOutages: null };
}

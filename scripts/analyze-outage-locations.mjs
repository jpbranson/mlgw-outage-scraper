// Read-only audit of accepted observations. Writes only a separate analysis JSON.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Archive } from '../src/durable/archive.mjs';

const root = resolve('data/collector');
const through = process.argv[2] ? Date.parse(process.argv[2]) : Date.now();
if (!Number.isFinite(through)) throw new Error('Optional first argument must be an ISO timestamp');
const db = new DatabaseSync(join(root, 'index.sqlite'), { readOnly: true, timeout: 5000 });
const rows = db.prepare(`SELECT s.*, a.manifest_key, a.manifest_hash, t.customers, t.outages
  FROM snapshots s JOIN poll_attempts a ON a.id=s.id JOIN totals t ON t.snapshot_id=s.id
  WHERE s.quality='valid' AND s.captured_ms<=? ORDER BY s.captured_ms`).all(through);
const qualities = db.prepare('SELECT quality, count(*) captures FROM snapshots WHERE captured_ms<=? GROUP BY quality').all(through);
db.close();
if (!rows.length) throw new Error('No accepted observations');
const archive = new Archive(join(root, 'archive'), { readOnly: true });
const sites = new Map(), ids = new Map(), impacts = new Map(), labelsByCount = new Map();
const transitions = [], samples = [], idStartPairs = new Set(), invalid = [];
let observations = 0, previousIds = new Set(), repeatPolls = 0, countChanges = 0, countChangesWithoutMoving = 0;
const iso = ms => new Date(ms).toISOString();
const distance = (a, b) => {
  const rad = Math.PI / 180, lat1 = a[1] * rad, lat2 = b[1] * rad;
  const h = Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((b[0]-a[0])*rad/2)**2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1,h)));
};
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  const q = p => sorted[Math.max(0, Math.ceil(p*sorted.length)-1)] ?? null;
  return { n: sorted.length, min: sorted[0] ?? null, median: q(.5), p90: q(.9), p95: q(.95), max: sorted.at(-1) ?? null };
};
for (const [index, row] of rows.entries()) {
  const { manifest, hash } = archive.readManifest(row.manifest_key);
  if (hash !== row.manifest_hash || manifest.parserHash !== row.parser_hash || manifest.bodies.feed.hash !== row.raw_hash)
    throw new Error(`Index/archive disagreement: ${row.id}`);
  const text = archive.readBody(manifest.bodies.feed).toString('utf8');
  const parser = await archive.parser(manifest), parsed = parser.parseFeed(text);
  if (!parsed.totalsValid || parsed.totals.customers !== row.customers || parsed.totals.reportedOutages !== row.outages)
    throw new Error(`Replay/index disagreement: ${row.id}`);
  const feed = JSON.parse(text), at = row.captured_ms, currentIds = new Set();
  const captureSites = new Map();
  for (const f of feed.features) {
    const p = f.properties, id = String(p.OUTAGE_NO).trim(), c = f.geometry?.coordinates;
    idStartPairs.add(JSON.stringify([id,p.TIME_STAMP]));
    if (f.geometry?.type !== 'Point' || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || c[0] < -90.4 || c[0] > -89.3 || c[1] < 34.7 || c[1] > 35.7) {
      invalid.push({ capture: row.id, id }); continue;
    }
    observations++; currentIds.add(id);
    const key = JSON.stringify(c);
    let rec = ids.get(id);
    if (!rec) {
      rec = { id, first: at, last: at, observations: 0, coordinates: new Set(), starts: new Set(), customers: new Set(), impacts: new Set(), episodes: 0, lastPoint: null };
      ids.set(id, rec);
    }
    if (!previousIds.has(id)) rec.episodes++;
    if (rec.lastPoint && previousIds.has(id) && at-rec.last<=600000 && rec.lastPoint.customers!==p.CUR_CUST_AFF) {
      countChanges++;
      if (rec.lastPoint.key===key) countChangesWithoutMoving++;
    }
    if (rec.lastPoint && rec.lastPoint.key !== key) transitions.push({ id, at: iso(at), previousAt: iso(rec.last),
      from: rec.lastPoint.coordinates, to: c, meters: distance(rec.lastPoint.coordinates,c),
      presentInPreviousCapture: previousIds.has(id), gapMinutes: (at-rec.last)/60000,
      previousCustomers: rec.lastPoint.customers, customers: p.CUR_CUST_AFF });
    if (rec.lastPoint?.key === key && previousIds.has(id)) repeatPolls++;
    rec.lastPoint = { key, coordinates:c, customers:p.CUR_CUST_AFF };
    rec.last=at; rec.observations++; rec.coordinates.add(key); rec.starts.add(p.TIME_STAMP);
    rec.customers.add(p.CUR_CUST_AFF); rec.impacts.add(p.IMPACT);
    let site = sites.get(key);
    if (!site) { site = { coordinates:c, first:at, last:at, observations:0, ids:new Map(), maxSimultaneousIds:0 }; sites.set(key,site); }
    site.last=at; site.observations++;
    let usage=site.ids.get(id);
    if (!usage) { usage={id,first:at,last:at,observations:0,customers:new Set(),starts:new Set()}; site.ids.set(id,usage); }
    usage.last=at; usage.observations++; usage.customers.add(p.CUR_CUST_AFF); usage.starts.add(p.TIME_STAMP);
    captureSites.set(key,(captureSites.get(key)??0)+1);
    let impact=impacts.get(p.IMPACT);
    if (!impact) { impact={label:p.IMPACT,counts:new Set(),ids:new Set(),observations:0}; impacts.set(p.IMPACT,impact); }
    impact.counts.add(p.CUR_CUST_AFF); impact.ids.add(id); impact.observations++;
    if (!labelsByCount.has(p.CUR_CUST_AFF)) labelsByCount.set(p.CUR_CUST_AFF,new Set());
    labelsByCount.get(p.CUR_CUST_AFF).add(p.IMPACT);
    if (index===0 || index===Math.floor(rows.length/2) || index===rows.length-1) samples.push({capture:row.id,id,coordinates:c,customers:p.CUR_CUST_AFF,impact:p.IMPACT});
  }
  for (const [key,n] of captureSites) sites.get(key).maxSimultaneousIds=Math.max(sites.get(key).maxSimultaneousIds,n);
  previousIds=currentIds;
}
const allSites=[...sites.values()], allIds=[...ids.values()];
const siteSummary = s => ({coordinates:s.coordinates,first:iso(s.first),last:iso(s.last),observations:s.observations,
  distinctIds:s.ids.size,maxSimultaneousIds:s.maxSimultaneousIds,
  uses:[...s.ids.values()].sort((a,b)=>a.first-b.first).map(u=>({id:u.id,first:iso(u.first),last:iso(u.last),
    observations:u.observations,customerCounts:[...u.customers].sort((a,b)=>a-b),sourceStarts:[...u.starts]}))});
const reusedSites=allSites.filter(s=>s.ids.size>1);
let disjointIdPairs=0, overlappingSpans=0;
for (const s of reusedSites) {
  const uses=[...s.ids.values()];
  for(let i=0;i<uses.length;i++) for(let j=i+1;j<uses.length;j++) {
    if(uses[i].last<uses[j].first || uses[j].last<uses[i].first) disjointIdPairs++;
    else overlappingSpans++;
  }
}
const nearestSites=[], nearestOtherIds=[];
for (const s of allSites) {
  let nearest=Infinity, different=Infinity;
  for (const t of allSites) {
    if(s===t) continue;
    const d=distance(s.coordinates,t.coordinates); nearest=Math.min(nearest,d);
    if([...t.ids.keys()].some(id=>!s.ids.has(id))) different=Math.min(different,d);
  }
  nearestSites.push(nearest);
  nearestOtherIds.push(s.ids.size>1 ? 0 : different);
}
const histogram = (values,keyFn) => {
  const out={}; for(const v of values){const k=keyFn(v);out[k]=(out[k]??0)+1;} return out;
};
const decimals=n=>String(n).split('.')[1]?.length??0;
const adjacentAxisSteps = axis => {
  const sorted=[...new Set(allSites.map(s=>s.coordinates[axis]))].sort((a,b)=>a-b);
  return stats(sorted.slice(1).map((n,i)=>(n-sorted[i])*111195*(axis===0?Math.cos(35.15*Math.PI/180):1)));
};
const rounding=[0,1,2,3,4,5,6].map(d=>({decimalPlaces:d,
  sitesExactlyOnLattice:allSites.filter(s=>s.coordinates.every(c=>Math.abs(c*10**d-Math.round(c*10**d))<1e-6)).length}));
const report={ generatedAt:iso(Date.now()), methodology:{
  source:'All quality=valid indexed snapshots, selected once at audit start; read-only SQLite and hash-verified original feeds with archived parser replay.',
  identity:'Source OUTAGE_NO counted once regardless of start-time revisions. Different IDs are different source records, not necessarily independent physical incidents.',
  exactSite:'Exact numeric longitude/latitude pair; trailing zero formatting is irrelevant. No rounding or clustering used.',
  episodes:'An ID appearing after absence from the previous accepted capture. Missing collection slots alone do not prove restoration.',
  precision:'Decimal lattice and neighbor spacing describe published coordinates, not geolocation accuracy or service-area size.',
  nonoverlap:'First/last observed spans of distinct IDs at the same exact coordinate are disjoint; this alone does not establish restoration or separate physical incidents.'},
  coverage:{first:iso(rows[0].captured_ms),last:iso(rows.at(-1).captured_ms),captures:rows.length,qualities,
    elapsedDays:(rows.at(-1).captured_ms-rows[0].captured_ms)/86400000,
    expectedFiveMinuteSlots:Math.floor(rows.at(-1).slot_ms/300000)-Math.floor(rows[0].slot_ms/300000)+1,
    gapsOver10Minutes:rows.slice(1).flatMap((r,i)=>r.captured_ms-rows[i].captured_ms>600000?[{from:iso(rows[i].captured_ms),to:iso(r.captured_ms),minutes:(r.captured_ms-rows[i].captured_ms)/60000}]:[])},
  counts:{featureObservations:observations,excludedGeometry:invalid.length,distinctOutageIds:ids.size,distinctIdStartPairs:idStartPairs.size,
    distinctCoordinates:sites.size,consecutivePollSameIdSameCoordinate:repeatPolls,
    sitesWithMultipleIds:reusedSites.length,idsAtReusedSites:new Set(reusedSites.flatMap(s=>[...s.ids.keys()])).size,
    sitesWithSimultaneousDifferentIds:reusedSites.filter(s=>s.maxSimultaneousIds>1).length,
    disjointDifferentIdPairsAtSameSite:disjointIdPairs,overlappingSpanIdPairsAtSameSite:overlappingSpans,
    idsWithMultipleCoordinates:allIds.filter(r=>r.coordinates.size>1).length,
    idsWithMultipleStarts:allIds.filter(r=>r.starts.size>1).length,idsSeenOnce:allIds.filter(r=>r.observations===1).length,
    idsWithReappearance:allIds.filter(r=>r.episodes>1).length,locationTransitions:transitions.length,
    repeatedlyObservedIds:allIds.filter(r=>r.observations>1).length,
    repeatedlyObservedIdsAlwaysAtSameCoordinate:allIds.filter(r=>r.observations>1&&r.coordinates.size===1).length,
    reusedSitesOnlySingleCustomer:reusedSites.filter(s=>[...s.ids.values()].every(u=>[...u.customers].every(n=>n===1))).length,
    consecutiveCountChanges:countChanges,consecutiveCountChangesWithoutMoving:countChangesWithoutMoving,
    locationTransitionsWithCustomerCountChange:transitions.filter(t=>t.previousCustomers!==t.customers).length},
  coordinateResolution:{longitudeDecimalPlaces:histogram(allSites,s=>decimals(s.coordinates[0])),latitudeDecimalPlaces:histogram(allSites,s=>decimals(s.coordinates[1])),rounding,
    uniqueLongitudes:new Set(allSites.map(s=>s.coordinates[0])).size,uniqueLatitudes:new Set(allSites.map(s=>s.coordinates[1])).size,
    nearestDistinctSiteMeters:stats(nearestSites),nearestSiteWithDifferentIdMeters:stats(nearestOtherIds),
    sitesWithDifferentIdWithinMeters:[0,5,10,25,50,100,250].map(m=>({meters:m,sites:nearestOtherIds.filter(d=>d<=m).length})),
    adjacentUniqueLongitudeMeters:adjacentAxisSteps(0),adjacentUniqueLatitudeMeters:adjacentAxisSteps(1)},
  movementMeters:stats(transitions.map(t=>t.meters)),
  continuousMovementMeters:stats(transitions.filter(t=>t.presentInPreviousCapture&&t.gapMinutes<=10).map(t=>t.meters)),
  sitesPerId:histogram(allIds,r=>r.coordinates.size),
  impactLabels:[...impacts.values()].map(r=>({label:r.label,distinctIds:r.ids.size,observations:r.observations,
    minCustomers:Math.min(...r.counts),maxCustomers:Math.max(...r.counts),observedCounts:[...r.counts].sort((a,b)=>a-b)})).sort((a,b)=>a.minCustomers-b.minCustomers),
  customerCountsWithMultipleImpactLabels:[...labelsByCount].filter(([,ls])=>ls.size>1).map(([customers,labels])=>({customers,labels:[...labels]})),
  reusedSites:reusedSites.sort((a,b)=>b.ids.size-a.ids.size||b.observations-a.observations).map(siteSummary),
  transitions:transitions.sort((a,b)=>b.meters-a.meters),
  allSites:allSites.map(siteSummary), sampleFeatures:samples,
  snapshotProvenance:rows.map(r=>({id:r.id,at:iso(r.captured_ms),hash:r.raw_hash}))};
mkdirSync('reports',{recursive:true});
writeFileSync('reports/point-location-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({coverage:report.coverage,counts:report.counts,coordinateResolution:report.coordinateResolution,
  movementMeters:report.movementMeters,continuousMovementMeters:report.continuousMovementMeters,sitesPerId:report.sitesPerId,
  impactLabels:report.impactLabels.map(({observedCounts,...rest})=>rest),
  customerCountsWithMultipleImpactLabels:report.customerCountsWithMultipleImpactLabels,
  reusedSites:report.reusedSites.slice(0,4),largestMovements:report.transitions.slice(0,3)},null,2));

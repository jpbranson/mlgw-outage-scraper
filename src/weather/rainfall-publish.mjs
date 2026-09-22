import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from './cache.mjs';
import {displayImage,RAIN_PERIOD_DISPLAY_VERSION} from './display.mjs';
import {BBOX} from './sources.mjs';

// Write immutable assets first, then replace the catalog once. A failed period
// cannot expose a half-published selection or remove previously prepared dates.
export function publishRainfallPeriods(cache,report,plan) {
  if(Date.parse(report.config.from)!==Date.parse(plan.from)||Date.parse(report.config.to)!==Date.parse(plan.to)||
    report.windows.length!==plan.periodHours.length||new Set(report.windows.map(w=>w.hours)).size!==plan.periodHours.length||
    !report.faultChecks?.length||report.faultChecks.some(c=>!c.passed))throw Error('Validate this selected rainfall window first');
  let catalog={version:1,entries:[]};
  try{catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(catalog.version!==1||!Array.isArray(catalog.entries)||catalog.entries.length>500)throw Error('Invalid weather catalog');
  const periods=[];
  for(const window of report.windows) {
    if(cache.now()-cache.started>=cache.limits.maxRunMs)throw Error('Rainfall publication time budget exhausted');
    if(!plan.periodHours.includes(window.hours)||Date.parse(window.to)!==Date.parse(plan.to)||Date.parse(window.to)-Date.parse(window.from)!==window.hours*3600000||
      !/^derived\/[a-f0-9]{64}\.json$/.test(window.derived.key))throw Error('Invalid rainfall period metadata');
    const bytes=readFileSync(join(cache.root,window.derived.key));
    if(sha256(bytes)!==window.derived.sha256)throw Error('Aggregate checksum mismatch');
    const {accumulation:a,areas,reference}=JSON.parse(bytes),g=a.grid;
    const bounds=[g.x0-g.dx/2,g.y0+(g.height-.5)*g.dy,g.x0+(g.width-.5)*g.dx,g.y0-g.dy/2];
    if(bounds.some((n,i)=>Math.abs(n-BBOX[i])>1e-6)||a.hours!==window.hours||Date.parse(a.to)!==Date.parse(window.to)||Date.parse(a.from)!==Date.parse(window.from))throw Error('Revalidate the expanded period grid first');
    const data={...displayImage({...a,bbox:BBOX},'rainfall-period'),product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,
      grid:g,values:a.values,hoursPerCell:a.hoursPerCell,summary:a.summary,areaSummary:areas.bbox,
      completeBlockGroups:areas.blockGroups.filter(x=>x.meanMm!==null).length,blockGroupCount:areas.blockGroups.length,
      geometrySha256:reference.sha256,aggregateSha256:window.derived.sha256,sources:a.sources,
      provider:'NOAA MRMS via NOAA Open Data',sourceUrl:'https://registry.opendata.aws/noaa-mrms-pds/',
      qualityFlags:[...a.qualityFlags,'full-cell-total-requires-every-hour','native-grid-no-interpolation']};
    const output=Buffer.from(JSON.stringify(data)),hash=sha256(output);cache.put(`derived/${hash}.json`,output);
    catalog.entries=catalog.entries.filter(e=>e.product!=='rainfall-period'||e.validAt!==a.to||e.hours!==a.hours);
    if(catalog.entries.length>=500)throw Error('Weather catalog limit');
    catalog.entries.push({identity:`${RAIN_PERIOD_DISPLAY_VERSION}:rainfall-period:${a.from}:${a.to}`,product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,sha256:hash});
    periods.push({hours:a.hours,from:a.from,to:a.to,sha256:hash,bytes:output.length,completeBlockGroups:data.completeBlockGroups});
  }
  catalog.updatedAt=new Date().toISOString();cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));
  return {checkedAt:catalog.updatedAt,requests:cache.requests,cacheBytes:cache.used,periods};
}

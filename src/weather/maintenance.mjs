import {readdirSync,readFileSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sourceRequest,instant,BBOX,HOUR} from './sources.mjs';
import {sha256} from './objects.mjs';
import {accumulateHourly} from './accumulation.mjs';
import {cellAreaWeights,rectangle,summarizeArea} from './area-weights.mjs';
import {displayImage} from './display.mjs';
import {rainfallSubset} from './decode.mjs';
import {rainfallNumeric} from './publish.mjs';
// Rainfall keeps four extra hours so a complete sliding 24-hour total survives Pass 2 publication latency.
export const LIVE_RETENTION_HOURS=Object.freeze({radar:4,'radar-world':4,rainfall:28,metar:24});
export const ROLLING_PERIOD_VERSION='rolling-rainfall-period-v1';
const iso=ms=>new Date(ms).toISOString();
const weightMemo=new Map();
function areaWeights(grid,referencePath) {
  const key=JSON.stringify([grid,referencePath]);
  if(!weightMemo.has(key)) {
    const bytes=readFileSync(referencePath),reference=JSON.parse(gunzipSync(bytes,{maxOutputLength:64*1024*1024}));
    if(!Array.isArray(reference.features)||!reference.features.length||reference.features.length>2000)throw Error('Invalid block-group reference');
    weightMemo.clear();
    weightMemo.set(key,{sha256:sha256(bytes),bbox:cellAreaWeights(grid,rectangle(BBOX)),
      areas:reference.features.map(f=>({id:f.id,weights:cellAreaWeights(grid,f.geometry)}))});
  }
  return weightMemo.get(key);
}
// Sliding 24-hour totals from retained one-hour frames. A period is published
// only when all 24 verified numeric frames are present; nothing is extrapolated.
// Each total is tied to its final hour's manifest, so ordinary retention removes it.
export function publishRollingRainfall(cache,{maxNew=3,maxUpgrades=26,referencePath=resolve('reference/shelby-block-groups-2024.json.gz')}={}) {
  let catalog={version:1,entries:[]};
  try{catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(catalog.version!==1||!Array.isArray(catalog.entries))throw Error('Invalid rolling catalog');
  const frames=new Map();let upgraded=0;
  for(const e of catalog.entries.filter(e=>e.product==='rainfall')) {
    const bytes=readFileSync(join(cache.root,'derived',`${e.sha256}.json`));
    if(sha256(bytes)!==e.sha256)throw Error('Rolling rainfall checksum mismatch');
    let d=JSON.parse(bytes);
    // Frames derived before numeric subsets were kept are upgraded once from their retained, hash-checked original.
    if(!d.numeric&&upgraded<maxUpgrades&&/^[a-f0-9]{64}$/.test(d.sourceId??'')) {
      const m=JSON.parse(readFileSync(join(cache.root,'manifests',`${d.sourceId}.json`)));
      if(m.availability==='retrieved'&&m.request?.product==='rainfall'&&instant(m.request.validAt)===instant(e.validAt)) {
        const {sourceId,sourceSha256,...display}=d,next=cache.derived(m,{...display,numeric:rainfallNumeric(rainfallSubset(cache.readBody(m),m.request.validAt))});
        e.sha256=next.sha256;d=JSON.parse(readFileSync(join(cache.root,next.key)));upgraded++;
      }
    }
    if(d.numeric)frames.set(iso(instant(e.validAt)),{validAt:iso(instant(e.validAt)),data:d.numeric,sourceId:d.sourceId,source:{manifestId:d.sourceId,derivedSha256:e.sha256}});
  }
  const published=[];
  for(const end of [...frames.keys()].sort().reverse()) {
    if(published.length>=maxNew)break;
    const to=Date.parse(end),from=to-24*HOUR,identity=`${ROLLING_PERIOD_VERSION}:rainfall-period:${iso(from)}:${end}`;
    if(catalog.entries.some(e=>e.identity===identity))continue;
    const window=[];for(let t=from+HOUR;t<=to&&frames.has(iso(t));t+=HOUR)window.push(frames.get(iso(t)));
    if(window.length!==24)continue;
    const a=accumulateHourly(iso(from),end,window),g=a.grid;
    const bounds=[g.x0-g.dx/2,g.y0+(g.height-.5)*g.dy,g.x0+(g.width-.5)*g.dx,g.y0-g.dy/2];
    if(bounds.some((n,i)=>Math.abs(n-BBOX[i])>1e-6))throw Error('Rolling rainfall grid differs from the prepared extent');
    const weights=areaWeights(g,referencePath),blockGroups=weights.areas.map(x=>summarizeArea(a,x.weights));
    const data={...displayImage({...a,bbox:BBOX},'rainfall-period'),product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,
      sourceId:window.at(-1).sourceId,rolling:true,rollingVersion:ROLLING_PERIOD_VERSION,
      grid:g,values:a.values,hoursPerCell:a.hoursPerCell,summary:a.summary,areaSummary:summarizeArea(a,weights.bbox),
      completeBlockGroups:blockGroups.filter(x=>x.meanMm!==null).length,blockGroupCount:blockGroups.length,
      geometrySha256:weights.sha256,sources:a.sources,provider:'NOAA MRMS via NOAA Open Data',sourceUrl:'https://registry.opendata.aws/noaa-mrms-pds/',
      qualityFlags:[...a.qualityFlags,'full-cell-total-requires-every-hour','native-grid-no-interpolation','rolling-display-period-not-saved-evidence']};
    const output=Buffer.from(JSON.stringify(data)),hash=sha256(output);cache.put(`derived/${hash}.json`,output);
    if(catalog.entries.length>=500)throw Error('Weather catalog limit');
    catalog.entries.push({identity,product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,sha256:hash});
    published.push({from:a.from,to:a.to,sha256:hash,bytes:output.length,maxMm:a.summary.maxMm});
  }
  if(published.length||upgraded){catalog.updatedAt=new Date().toISOString();cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));}
  return {published,upgraded};
}
export function directoryBytes(root) {
  return readdirSync(root,{withFileTypes:true}).reduce((sum,e)=>{
    const p=join(root,e.name);if(lstatSync(p).isSymbolicLink())throw Error('Weather directory cannot contain links');
    return sum+(e.isDirectory()?directoryBytes(p):statSync(p).size);
  },0);
}
// Bounded catch-up: at most 35 recent minutes, never an unbounded offline backlog.
export function maintenanceRequests(now) {
  if(!Number.isFinite(now))throw Error('Invalid maintenance clock');
  const end=Math.floor((now-5*60000)/300000)*300000,requests=[];
  for(let t=end-30*60000;t<=end;t+=300000)requests.push(sourceRequest('radar',new Date(t).toISOString()));
  // Pass 2 is retrospective: retry the last three hourly endpoints on later runs.
  for(let i=1;i<=3;i++)requests.push(sourceRequest('rainfall',new Date(Math.floor(now/HOUR)*HOUR-i*HOUR).toISOString()));
  requests.push(sourceRequest('metar',new Date(Math.floor(now/HOUR)*HOUR).toISOString()));
  return requests;
}
// Only the disposable rolling root is accepted. Saved-analysis cache is never pruned.
// Caller must hold WeatherCache's exclusive writer lock throughout this operation.
export function pruneRollingCache(cache,{now=Date.now(),expectedRoot=resolve('data/weather/live-cache')}={}) {
  if(resolve(cache.root)!==resolve(expectedRoot))throw Error('Not the dedicated rolling weather cache');
  if(cache.fd===undefined)throw Error('Rolling retention requires a writer lock');
  const manifests=[],remove=[],derived=[];
  for(const name of readdirSync(join(cache.root,'manifests'))) {
    if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('Unexpected rolling manifest');
    const bytes=readFileSync(join(cache.root,'manifests',name)),m=JSON.parse(bytes);
    if(m.id+'.json'!==name||sha256(Buffer.from(JSON.stringify(m.request)))!==m.id)throw Error('Rolling manifest identity mismatch');
    if(!['radar','radar-world','rainfall','metar'].includes(m.request.product))throw Error('Evidence product in disposable cache; preserve and stop');
    if(!Number.isFinite(Date.parse(m.request.validAt)))throw Error('Invalid rolling weather time');
    (Date.parse(m.request.validAt)<now-LIVE_RETENTION_HOURS[m.request.product]*HOUR?remove:manifests).push(m);
  }
  const ids=new Set(manifests.map(m=>m.id)),objects=new Set(manifests.flatMap(m=>m.body?[m.body.sha256]:[]));
  for(const name of readdirSync(join(cache.root,'derived'))) {
    if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('Unexpected rolling derivative');
    const bytes=readFileSync(join(cache.root,'derived',name));if(sha256(bytes)+'.json'!==name)throw Error('Rolling derivative checksum mismatch');
    const d=JSON.parse(bytes);derived.push({name,keep:ids.has(d.sourceId)});
  }
  let catalog={version:1,entries:[]};try{catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(catalog.version!==1||!Array.isArray(catalog.entries))throw Error('Invalid rolling catalog');
  const keepDerived=new Set(derived.filter(d=>d.keep).map(d=>d.name.slice(0,-5)));
  catalog.entries=catalog.entries.filter(e=>keepDerived.has(e.sha256));
  // Stop serving expired content before deleting files. A crashed prune is safe to replay.
  cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));
  let bytesRemoved=0,filesRemoved=0;
  const removeFile=(directory,name)=>{
    const path=join(cache.root,directory,name);if(lstatSync(path).isSymbolicLink())throw Error('Rolling file cannot be a link');
    bytesRemoved+=statSync(path).size;unlinkSync(path);filesRemoved++;
  };
  for(const d of derived.filter(d=>!d.keep))removeFile('derived',d.name);
  for(const m of remove)removeFile('manifests',m.id+'.json');
  for(const name of readdirSync(join(cache.root,'objects'))) {
    if(!/^[a-f0-9]{64}\.raw(?:\.gz)?$/.test(name))throw Error('Unexpected rolling object');
    if(!objects.has(name.slice(0,64)))removeFile('objects',name);
  }
  cache.used=directoryBytes(cache.root);return {filesRemoved,bytesRemoved,cacheBytes:cache.used,retentionHours:LIVE_RETENTION_HOURS};
}

import {readdirSync,readFileSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sourceRequest,HOUR} from './sources.mjs';
import {sha256} from './objects.mjs';
export const LIVE_RETENTION_HOURS=Object.freeze({radar:4,'radar-world':4,rainfall:24,metar:24});
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

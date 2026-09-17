import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, statfsSync, unlinkSync, openSync, closeSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateRequest } from './sources.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const defaults = JSON.parse(readFileSync(new URL('../../config/weather.local.json',import.meta.url),'utf8'));
function sizeOf(dir) {
  return readdirSync(dir,{withFileTypes:true}).reduce((n,e)=> {
    const path=join(dir,e.name);
    if (e.isSymbolicLink()) throw Error('Weather cache cannot contain symbolic links');
    return n+(e.isDirectory()?sizeOf(path):statSync(path).size);
  },0);
}
export class WeatherCache {
  constructor(root, { limits={}, fetchImpl=fetch, now=()=>Date.now(), wait=sleep }={}) {
    this.root=resolve(root); this.limits={...defaults,...limits}; this.fetch=fetchImpl; this.now=now; this.wait=wait;
    this.started=now(); this.requests=0; this.downloadBytes=0;
    mkdirSync(this.root,{recursive:true});
    if (lstatSync(this.root).isSymbolicLink()) throw Error('Weather cache root cannot be a symbolic link');
    this.lock=join(this.root,'writer.lock');
    this.fd=openSync(this.lock,'wx');
    try {
      writeFileSync(this.fd,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}));
      for (const sub of ['objects','manifests','derived','published']) mkdirSync(join(this.root,sub),{recursive:true});
      this.used=sizeOf(this.root);
      this.reserve(0);
    } catch(error) { this.close(); throw error; }
  }
  close() { if(this.fd!==undefined) { closeSync(this.fd);this.fd=undefined;unlinkSync(this.lock); } }
  reserve(bytes) {
    if(this.used+bytes>this.limits.cacheBytes) throw Error('Weather cache budget exhausted; no files were deleted');
    const disk=statfsSync(this.root);
    if(disk.bavail*disk.bsize-bytes<this.limits.minimumFreeBytes) throw Error('Weather free-space floor reached');
  }
  put(relative, bytes) {
    if (!/^(objects\/[a-f0-9]{64}\.raw|manifests\/[a-f0-9]{64}\.json|derived\/[a-f0-9]{64}\.json|published\/catalog\.json)$/.test(relative)) throw Error('Invalid weather cache key');
    const target=join(this.root,relative);
    try { const existing=readFileSync(target); if(existing.equals(bytes)) return; if(relative.startsWith('objects/')) throw Error('Weather object checksum conflict'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    this.reserve(bytes.length);
    const temporary=join(this.root,`${randomUUID()}.tmp`);
    writeFileSync(temporary,bytes,{flag:'wx',flush:true});
    try { const old=(()=>{try{return statSync(target).size;}catch(e){if(e.code==='ENOENT')return 0;throw e;}})();renameSync(temporary,target); this.used+=bytes.length-old; }
    finally { try{unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT')throw e;} }
  }
  readBody(manifest) {
    if(!manifest.body || !/^[a-f0-9]{64}$/.test(manifest.body.sha256)) throw Error('Missing weather object');
    const path=join(this.root,`objects/${manifest.body.sha256}.raw`);
    if(statSync(path).size>this.limits.maxResponseBytes) throw Error('Cached weather object exceeds response limit');
    const body=readFileSync(path);
    if(body.length!==manifest.body.bytes||sha256(body)!==manifest.body.sha256) throw Error('Weather cache checksum mismatch');
    return body;
  }
  derived(manifest, data) {
    const bytes=Buffer.from(JSON.stringify({sourceId:manifest.id,sourceSha256:manifest.body.sha256,...data}));
    const hash=sha256(bytes);this.put(`derived/${hash}.json`,bytes);return {key:`derived/${hash}.json`,sha256:hash,bytes:bytes.length};
  }
  async acquire(request, { offline=false }={}) {
    validateRequest(request);
    const id=sha256(Buffer.from(JSON.stringify(request))), key=`manifests/${id}.json`;
    let prior;
    try { prior=JSON.parse(readFileSync(join(this.root,key),'utf8')); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(prior?.availability==='retrieved') { this.readBody(prior); return {...prior,cacheHit:true}; }
    if(offline) return prior ?? {id,request,availability:'not-cached',qualityFlags:['missing-is-not-zero']};
    if(prior?.retryAt && Date.parse(prior.retryAt)>this.now()) return {...prior,cacheHit:true};
    if(prior?.availability==='restricted') return prior;
    // Persisted provider backoff survives a new process and applies to other products on that host.
    const host=new URL(request.url).host;
    for(const filename of readdirSync(join(this.root,'manifests'))) {
      const m=JSON.parse(readFileSync(join(this.root,'manifests',filename),'utf8'));
      if(new URL(m.request.url).host===host && (m.availability==='restricted'||(['rate-limited','failed'].includes(m.availability)&&Date.parse(m.retryAt)>this.now())))
        return {id,request,availability:'provider-paused',retryAt:m.retryAt??null,qualityFlags:['missing-is-not-zero']};
    }
    this.reserve(this.limits.maxResponseBytes+16384);
    let result, attempts=[];
    for(let attempt=0;attempt<=this.limits.maxRetries;attempt++) {
      if(this.requests>=this.limits.maxRequests||this.downloadBytes>=this.limits.maxRunBytes||this.now()-this.started>=this.limits.maxRunMs) throw Error('Weather run budget exhausted');
      this.requests++;
      const began=this.now();
      let status=null;
      try {
        const remainingMs=this.limits.maxRunMs-(this.now()-this.started);
        const response=await this.fetch(request.url,{redirect:'manual',signal:AbortSignal.timeout(Math.min(this.limits.timeoutMs,remainingMs)),headers:{'User-Agent':'mlgw-outage-scraper/local-weather-validation (https://github.com/jpbranson/mlgw-outage-scraper)'}});
        status=response.status;
        const headers=Object.fromEntries(['content-type','last-modified','etag','retry-after'].map(k=>[k,response.headers.get(k)]));
        let body;
        if(status===200) {
          const length=Number(response.headers.get('content-length')??0);
          if(length>this.limits.maxResponseBytes||length>this.limits.maxRunBytes-this.downloadBytes) {await response.body?.cancel();throw Error('Weather response exceeds byte budget');}
          const chunks=[];let bytes=0;
          for await(const chunk of response.body) {
            bytes+=chunk.length;this.downloadBytes+=chunk.length;
            if(bytes>this.limits.maxResponseBytes||this.downloadBytes>this.limits.maxRunBytes) throw Error('Weather response exceeds byte budget');
            chunks.push(chunk);
          }
          body=Buffer.concat(chunks);
        } else await response.body?.cancel();
        attempts.push({status,elapsedMs:this.now()-began,at:new Date(began).toISOString()});
        result={id,request,retrievedAt:new Date(this.now()).toISOString(),status,headers,attempts,availability:status===200?'retrieved':status===404?'unavailable':[401,403].includes(status)?'restricted':status===429?'rate-limited':'failed',qualityFlags:['missing-is-not-zero']};
        if(body) { const hash=sha256(body);this.put(`objects/${hash}.raw`,body);result.body={sha256:hash,bytes:body.length}; break; }
        if(status===429) {
          const raw=headers['retry-after'], seconds=raw&&/^\d+$/.test(raw)?Number(raw):NaN;
          const retry=Number.isFinite(seconds)?this.now()+seconds*1000:Date.parse(raw);
          result.retryAt=new Date(Math.max(this.now()+60000,Number.isFinite(retry)?retry:0)).toISOString();break;
        }
        if(status<500) break;
      } catch(error) {
        attempts.push({status,elapsedMs:this.now()-began,at:new Date(began).toISOString(),error:String(error.message).slice(0,300)});
        result={id,request,availability:'failed',attempts,qualityFlags:['missing-is-not-zero']};
        if(/budget|limit|checksum/.test(error.message)) break;
      }
      if(attempt<this.limits.maxRetries) await this.wait((request.product==='metar'?1000:500)*2**attempt);
    }
    const recentMissing=request.validAt&&Math.abs(this.now()-Date.parse(request.validAt))<24*3600000;
    if(!['retrieved','restricted','rate-limited'].includes(result.availability)) result.retryAt=new Date(this.now()+(result.availability==='unavailable'?(recentMissing?300000:HOURS_6):60000)).toISOString();
    this.put(key,Buffer.from(JSON.stringify(result)));return result;
  }
}
const HOURS_6=6*3600000;

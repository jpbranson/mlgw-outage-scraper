import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, statfsSync, unlinkSync, openSync, closeSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import { validateRequest } from './sources.mjs';
import {sha256,readWeatherObject} from './objects.mjs';
export {sha256} from './objects.mjs';
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
  constructor(root, { limits={}, fetchImpl=fetch, now=()=>Date.now(), wait=sleep, sharedBudget }={}) {
    this.root=resolve(root); this.limits={...defaults,...limits}; this.fetch=fetchImpl; this.now=now; this.wait=wait;
    this.started=now(); this.requests=0; this.downloadBytes=0;
    mkdirSync(this.root,{recursive:true});
    if (lstatSync(this.root).isSymbolicLink()) throw Error('Weather cache root cannot be a symbolic link');
    this.lock=join(this.root,'writer.lock');
    this.fd=openSync(this.lock,'wx');
    try {
      writeFileSync(this.fd,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}));
      const productionRoots=['data/weather/cache','data/weather/live-cache'].map(p=>resolve(p));
      this.sharedBudget=sharedBudget??(productionRoots.includes(this.root)?{root:resolve('data/weather'),cacheRoots:productionRoots,maxBytes:defaults.cacheBytes}:null);
      if(this.sharedBudget) {
        const b=this.sharedBudget;
        if(!Number.isSafeInteger(b.maxBytes)||b.maxBytes<=0||!b.cacheRoots.map(p=>resolve(p)).includes(this.root))throw Error('Invalid shared weather budget');
        mkdirSync(b.root,{recursive:true});if(lstatSync(b.root).isSymbolicLink())throw Error('Shared weather budget root cannot be a link');
        this.budgetLock=join(b.root,'budget-writer.lock');this.budgetFd=openSync(this.budgetLock,'wx');
        writeFileSync(this.budgetFd,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}));
      }
      for (const sub of ['objects','manifests','revisions','derived','published']) mkdirSync(join(this.root,sub),{recursive:true});
      this.used=sizeOf(this.root);
      this.reserve(0);
    } catch(error) { this.close(); throw error; }
  }
  close() {
    if(this.fd!==undefined) {closeSync(this.fd);this.fd=undefined;unlinkSync(this.lock);}
    if(this.budgetFd!==undefined) {closeSync(this.budgetFd);this.budgetFd=undefined;unlinkSync(this.budgetLock);}
  }
  reserve(bytes) {
    if(this.used+bytes>this.limits.cacheBytes) throw Error('Weather cache budget exhausted; no files were deleted');
    if(this.sharedBudget) {
      const other=this.sharedBudget.cacheRoots.map(p=>resolve(p)).filter(p=>p!==this.root).reduce((sum,p)=>sum+(existsSync(p)?sizeOf(p):0),0);
      if(this.used+other+bytes>this.sharedBudget.maxBytes)throw Error('Shared weather cache budget exhausted; all evidence preserved');
    }
    const disk=statfsSync(this.root);
    if(disk.bavail*disk.bsize-bytes<this.limits.minimumFreeBytes) throw Error('Weather free-space floor reached');
  }
  put(relative, bytes) {
    if (!/^(objects\/[a-f0-9]{64}\.raw(?:\.gz)?|(?:manifests|revisions|derived)\/[a-f0-9]{64}\.json|published\/catalog\.json)$/.test(relative)) throw Error('Invalid weather cache key');
    const target=join(this.root,relative);
    try { const existing=readFileSync(target); if(existing.equals(bytes)) return; if(relative.startsWith('objects/')||relative.startsWith('revisions/')) throw Error('Weather object checksum conflict'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    this.reserve(bytes.length);
    const temporary=join(this.root,`${randomUUID()}.tmp`);
    writeFileSync(temporary,bytes,{flag:'wx',flush:true});
    try { const old=(()=>{try{return statSync(target).size;}catch(e){if(e.code==='ENOENT')return 0;throw e;}})();renameSync(temporary,target); this.used+=bytes.length-old; }
    finally { try{unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT')throw e;} }
  }
  readBody(manifest) {
    return readWeatherObject(this.root,manifest,{maxBytes:this.limits.maxResponseBytes});
  }
  storeBody(request,body) {
    const manifest={body:{sha256:sha256(body),bytes:body.length}},station=request.product==='station';
    if(station) {
      try {
        const existing=readWeatherObject(this.root,manifest,{maxBytes:this.limits.maxResponseBytes,format:'gzip'});
        if(!existing.equals(body))throw Error('Station compressed replay mismatch');
        return manifest.body;
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const stored=station?gzipSync(body):body;
    if(station&&!gunzipSync(stored,{maxOutputLength:Math.max(1,body.length)}).equals(body))throw Error('Station compression verification failed');
    this.put(`objects/${manifest.body.sha256}.raw${station?'.gz':''}`,stored);
    // Verify the file on disk before a manifest can reference it.
    readWeatherObject(this.root,manifest,{maxBytes:this.limits.maxResponseBytes,format:station?'gzip':'raw'});
    return manifest.body;
  }
  compressStationOriginals({apply=false,onProgress=()=>{}}={}) {
    const originals=new Map();
    for(const dir of ['manifests','revisions'])for(const file of readdirSync(join(this.root,dir))) {
      const m=JSON.parse(readFileSync(join(this.root,dir,file),'utf8'));
      if(m.request.product!=='station'||!m.body)continue;
      validateRequest(m.request);
      if(originals.has(m.body.sha256)&&originals.get(m.body.sha256).body.bytes!==m.body.bytes)throw Error('Conflicting station original metadata');
      originals.set(m.body.sha256,m);
    }
    const report={checkedAt:new Date(this.now()).toISOString(),mode:apply?'apply':'plan',cacheBeforeBytes:this.used,objects:[],removedRawBytes:0};
    for(const m of originals.values()) {
      if(this.now()-this.started>=this.limits.maxRunMs)throw Error('Station compression time budget exhausted');
      const hash=m.body.sha256,rawPath=join(this.root,'objects',`${hash}.raw`);
      let raw;
      try{raw=readWeatherObject(this.root,m,{maxBytes:this.limits.maxResponseBytes,format:'raw'});}
      catch(error){if(error.code!=='ENOENT')throw error;}
      const original=raw??this.readBody(m),compressed=gzipSync(original);
      if(!gunzipSync(compressed,{maxOutputLength:Math.max(1,original.length)}).equals(original))throw Error('Station compression verification failed');
      const item={sha256:hash,originalBytes:original.length,compressedBytes:compressed.length,rawPresent:!!raw,rawRemoved:false,verified:true};
      if(apply) {
        // Atomic immutable write, followed by byte-exact disk replay. A crash
        // before cleanup leaves both representations; rerunning is safe.
        this.storeBody(m.request,original);
        item.compressedBytes=statSync(join(this.root,'objects',`${hash}.raw.gz`)).size;
        const replay=readWeatherObject(this.root,m,{maxBytes:this.limits.maxResponseBytes,format:'gzip'});
        if(!replay.equals(original))throw Error('Station compressed replay mismatch');
        if(raw) {
          // Only this fixed hash-named file beneath the locked cache is removed.
          // Verify it again immediately before removing the redundant copy.
          if(!readWeatherObject(this.root,m,{maxBytes:this.limits.maxResponseBytes,format:'raw'}).equals(replay))throw Error('Station original changed during compression');
          unlinkSync(rawPath);this.used-=raw.length;report.removedRawBytes+=raw.length;item.rawRemoved=true;
        }
      }
      report.objects.push(item);onProgress(report,item);
    }
    return {...report,cacheAfterBytes:this.used,savedBytes:report.cacheBeforeBytes-this.used,requests:this.requests,downloadBytes:this.downloadBytes,
      elapsedMs:this.now()-this.started,complete:true};
  }
  derived(manifest, data) {
    const bytes=Buffer.from(JSON.stringify({sourceId:manifest.id,sourceSha256:manifest.body.sha256,...data}));
    const hash=sha256(bytes);this.put(`derived/${hash}.json`,bytes);return {key:`derived/${hash}.json`,sha256:hash,bytes:bytes.length};
  }
  async acquire(request, { offline=false, refresh=false }={}) {
    validateRequest(request);
    if(refresh&&(offline||request.product!=='station'))throw Error('Explicit online refresh is supported only for station/year snapshots');
    const id=sha256(Buffer.from(JSON.stringify(request))), key=`manifests/${id}.json`;
    let prior;
    try { prior=JSON.parse(readFileSync(join(this.root,key),'utf8')); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(prior?.availability==='retrieved') { this.readBody(prior); if(!refresh)return {...prior,cacheHit:true}; }
    if(offline) return prior ?? {id,request,availability:'not-cached',qualityFlags:['missing-is-not-zero']};
    if(prior?.retryAt && Date.parse(prior.retryAt)>this.now()) return {...prior,cacheHit:true};
    if(prior?.availability==='restricted') return prior;
    // Persisted provider backoff survives a new process and applies to other products on that host.
    const host=new URL(request.url).host;
    for(const file of ['manifests','revisions'].flatMap(dir=>readdirSync(join(this.root,dir)).map(name=>join(this.root,dir,name)))) {
      const m=JSON.parse(readFileSync(file,'utf8'));
      if(new URL(m.request.url).host===host && (m.availability==='restricted'||(['rate-limited','failed'].includes(m.availability)&&Date.parse(m.retryAt)>this.now())))
        return {id,request,availability:'provider-paused',retryAt:m.retryAt??null,qualityFlags:['missing-is-not-zero']};
    }
    // Preserve the exact previous manifest before an explicit refresh. Ordinary
    // reads stay pinned; failed refreshes never replace a verified snapshot.
    if(refresh&&prior) {
      const bytes=Buffer.from(JSON.stringify(prior));this.put(`revisions/${sha256(bytes)}.json`,bytes);
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
        if(body) { result.body=this.storeBody(request,body); break; }
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
    if(refresh) {
      result.refresh={previousBodySha256:prior?.body?.sha256??null,changed:result.body?result.body.sha256!==prior?.body?.sha256:null};
      const bytes=Buffer.from(JSON.stringify(result));this.put(`revisions/${sha256(bytes)}.json`,bytes);
    }
    if(!refresh||result.availability==='retrieved'||prior?.availability!=='retrieved')this.put(key,Buffer.from(JSON.stringify(result)));
    return result;
  }
}
const HOURS_6=6*3600000;

// Portable transfer protocol. Cloud deployment and destructive cleanup are not enabled here.
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync,statfsSync,appendFileSync,renameSync,lstatSync,openSync,closeSync,unlinkSync,linkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const DAY=86400000,MAX_PART=8*1024*1024,MAX_EXPANDED=32*1024*1024;
export const TRANSFER_VERSION='archive-transfer-v1';
export const hash=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const safeKey=k=>typeof k==='string'&&/^(?:objects\/[a-f0-9]{64}\.gz|manifests\/[A-Za-z0-9_-]{1,120}\.json|parsers\/[A-Za-z0-9_-]{1,160}\.mjs|normalized\/[A-Za-z0-9_-]{1,120}\.json)$/.test(k);
export function protectedYearCutoff(now) {
  const d=new Date(now);requireValue(Number.isFinite(d.getTime()),'Invalid retention clock');
  const month=d.getUTCMonth(),day=d.getUTCDate();d.setUTCDate(1);d.setUTCFullYear(d.getUTCFullYear()-1);
  const last=new Date(Date.UTC(d.getUTCFullYear(),month+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.getTime();
}
export function storageForecast({usedBytes,budgetBytes,otherAccountBytes=0,dailyGrowthBytes,stormDailyBytes,stagingBytes=0}) {
  for(const n of [usedBytes,budgetBytes,otherAccountBytes,dailyGrowthBytes,stormDailyBytes,stagingBytes])requireValue(Number.isFinite(n)&&n>=0,'Invalid storage forecast');
  const availableBudget=budgetBytes-otherAccountBytes;requireValue(availableBudget>0,'No available account budget');
  const growth=Math.max(dailyGrowthBytes,stormDailyBytes),reserveBytes=growth*37+stagingBytes,freeBytes=availableBudget-usedBytes,fraction=usedBytes/availableBudget;
  return {fraction,reserveDays:30,cleanupGraceDays:7,reserveBytes,freeBytes,projectedDays: growth?freeBytes/growth:null,
    status:freeBytes<reserveBytes||fraction>=.9?'urgent':fraction>=.8?'offload':fraction>=.7?'prepare':'ok',
    protectedYearProjectionBytes:growth*366,protectedYearFits:growth*366+reserveBytes<=availableBudget};
}
function immutable(root,key,bytes) {
  const path=join(root,key);if(existsSync(path)){requireValue(readFileSync(path).equals(bytes),'Immutable transfer conflict');return;}
  const temporary=path+'.'+randomUUID()+'.partial';writeFileSync(temporary,bytes,{flag:'wx',flush:true});
  try {try{linkSync(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;requireValue(readFileSync(path).equals(bytes),'Immutable transfer conflict');}}finally{unlinkSync(temporary);}
}
export function buildBundle(root,{partition,observations,files}) {
  requireValue(/^\d{4}-\d\d-\d\d$/.test(partition)&&new Date(partition).toISOString().slice(0,10)===partition,'Invalid UTC partition');
  const from=Date.parse(partition+'T00:00:00Z'),to=from+DAY;
  requireValue(observations.length>0&&observations.length<=2000&&new Set(observations.map(o=>o.id)).size===observations.length,'Invalid bundle observations');
  for(const o of observations)requireValue(/^[A-Za-z0-9_-]{1,120}$/.test(o.id)&&Number.isFinite(Date.parse(o.observedAt))&&Date.parse(o.observedAt)>=from&&Date.parse(o.observedAt)<to,'Observation outside partition');
  requireValue(files.length>0&&files.length<=10000&&new Set(files.map(f=>f.key)).size===files.length,'Invalid transfer file list');
  requireValue(files.reduce((n,f)=>n+f.bytes.length,0)<=128*1024*1024,'Bundle byte budget exceeded; split the date partition');
  mkdirSync(root,{recursive:true});const parts=[],objects=[];let group=[],size=0;
  const flush=()=>{if(!group.length)return;const bytes=gzipSync(Buffer.from(JSON.stringify({version:TRANSFER_VERSION,files:group}))),sha256=hash(bytes);requireValue(bytes.length<=MAX_PART,'Compressed part exceeds limit');immutable(root,sha256+'.part.gz',bytes);parts.push({key:sha256+'.part.gz',sha256,bytes:bytes.length});group=[];size=0;};
  for(const {key,bytes} of [...files].sort((a,b)=>a.key.localeCompare(b.key))) {
    requireValue(safeKey(key)&&Buffer.isBuffer(bytes)&&bytes.length<=4*1024*1024,'Invalid or oversized transfer file');
    const ref={key,sha256:hash(bytes),bytes:bytes.length},entry={...ref,base64:bytes.toString('base64')},n=Buffer.byteLength(JSON.stringify(entry));
    if(size+n>6*1024*1024)flush();group.push(entry);size+=n;objects.push(ref);
  }
  flush();const manifest={version:TRANSFER_VERSION,partition,observations:[...observations].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)),objects,parts};
  const bytes=Buffer.from(JSON.stringify(manifest)),id=hash(bytes);requireValue(bytes.length<=4*1024*1024,'Transfer manifest limit');immutable(root,id+'.manifest.json',bytes);
  return {id,manifest};
}
export function validateManifest(manifest,id) {
  requireValue(/^[a-f0-9]{64}$/.test(id)&&hash(Buffer.from(JSON.stringify(manifest)))===id&&manifest.version===TRANSFER_VERSION,'Transfer manifest checksum/version mismatch');
  requireValue(Array.isArray(manifest.objects)&&manifest.objects.length>0&&manifest.objects.length<=10000&&new Set(manifest.objects.map(o=>o.key)).size===manifest.objects.length,'Invalid manifest objects');
  requireValue(Array.isArray(manifest.parts)&&manifest.parts.length>0&&manifest.parts.length<=2000&&new Set(manifest.parts.map(p=>p.key)).size===manifest.parts.length,'Invalid manifest parts');
  for(const o of manifest.objects)requireValue(safeKey(o.key)&&/^[a-f0-9]{64}$/.test(o.sha256)&&Number.isSafeInteger(o.bytes)&&o.bytes>=0&&o.bytes<=4*1024*1024,'Invalid manifest object');
  for(const p of manifest.parts)requireValue(p.key===p.sha256+'.part.gz'&&/^[a-f0-9]{64}$/.test(p.sha256)&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_PART,'Invalid manifest part');
  requireValue(manifest.objects.reduce((n,o)=>n+o.bytes,0)<=128*1024*1024&&manifest.parts.reduce((n,p)=>n+p.bytes,0)<=160*1024*1024,'Bundle byte budget exceeded');
  requireValue(Array.isArray(manifest.observations)&&manifest.observations.length>0&&manifest.observations.length<=2000,'Invalid observation index');
  const start=Date.parse(manifest.partition+'T00:00:00Z');requireValue(Number.isFinite(start),'Invalid partition');
  for(const o of manifest.observations)requireValue(Date.parse(o.observedAt)>=start&&Date.parse(o.observedAt)<start+DAY&&manifest.objects.some(f=>f.key===`manifests/${o.id}.json`),'Invalid observation membership');
}
export function verifyBundle(root,manifest,id) {
  validateManifest(manifest,id);const files=new Map();
  for(const p of manifest.parts) {
    const path=join(root,p.key);requireValue(!lstatSync(path).isSymbolicLink()&&statSync(path).size===p.bytes,'Transfer part size or link mismatch');
    const bytes=readFileSync(path);requireValue(hash(bytes)===p.sha256,'Transfer part checksum mismatch');
    const payload=JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_EXPANDED}));requireValue(payload.version===TRANSFER_VERSION&&Array.isArray(payload.files),'Invalid part schema');
    for(const f of payload.files) {
      const expected=manifest.objects.find(o=>o.key===f.key);requireValue(expected&&!files.has(f.key),'Unexpected or duplicate part file');
      const data=Buffer.from(f.base64,'base64');requireValue(data.length===expected.bytes&&hash(data)===expected.sha256&&f.sha256===expected.sha256,'Transfer file checksum mismatch');files.set(f.key,data);
    }
  }
  requireValue(files.size===manifest.objects.length,'Incomplete transfer bundle');
  for(const observation of manifest.observations){const m=JSON.parse(files.get(`manifests/${observation.id}.json`));requireValue(m.record.id===observation.id&&Date.parse(m.record.feed?.receivedAt??m.record.observedAt)===Date.parse(observation.observedAt),'Capture identity/time mismatch');
    for(const body of Object.values(m.bodies)){const data=files.get(body.key);requireValue(data,'Capture payload omitted');const raw=gunzipSync(data,{maxOutputLength:10*1024*1024});requireValue(hash(raw)===body.hash&&raw.length===body.bytes,'Capture source hash mismatch');}
    requireValue(files.has(m.parserKey)&&hash(files.get(m.parserKey))===m.parserHash,'Capture parser omitted or changed');
  }
  return files;
}
export async function downloadBundle({manifest,id,destination,readRange,minimumFreeBytes=20_000_000_000,freeBytes}) {
  validateManifest(manifest,id);mkdirSync(destination,{recursive:true});requireValue(!lstatSync(destination).isSymbolicLink(),'Transfer destination cannot be a link');
  const lock=join(destination,'transfer.lock'),fd=openSync(lock,'wx');
  try {
    for(const p of manifest.parts) {
      const target=join(destination,p.key),partial=target+'.partial';
      for(const path of [target,partial])if(existsSync(path))requireValue(!lstatSync(path).isSymbolicLink(),'Transfer file cannot be a link');
      if(existsSync(target)){requireValue(statSync(target).size===p.bytes&&hash(readFileSync(target))===p.sha256,'Completed transfer part corrupted');continue;}
      let offset=existsSync(partial)?statSync(partial).size:0;requireValue(offset<=p.bytes,'Invalid partial transfer size');
      const disk=statfsSync(destination),available=freeBytes??Number(disk.bavail)*Number(disk.bsize);
      requireValue(available-(p.bytes-offset)>=minimumFreeBytes,'Archive free-space floor reached');
      while(offset<p.bytes) {
        const length=Math.min(1024*1024,p.bytes-offset),bytes=await readRange(p.key,offset,length);
        requireValue(Buffer.isBuffer(bytes)&&bytes.length===length,'Transfer range length mismatch');appendFileSync(partial,bytes,{flush:true});offset+=bytes.length;
      }
      requireValue(hash(readFileSync(partial))===p.sha256,'Downloaded part checksum mismatch');renameSync(partial,target);
    }
    const files=verifyBundle(destination,manifest,id);immutable(destination,id+'.manifest.json',Buffer.from(JSON.stringify(manifest)));
    const catalogPath=join(destination,'catalog.sqlite');if(existsSync(catalogPath))requireValue(!lstatSync(catalogPath).isSymbolicLink(),'Transfer catalog cannot be a link');
    const db=new DatabaseSync(catalogPath);
    try {
      db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS transfers (manifest_id TEXT PRIMARY KEY, utc_partition TEXT NOT NULL, observations INTEGER NOT NULL, files INTEGER NOT NULL, parts INTEGER NOT NULL, verified_at TEXT NOT NULL) STRICT');
      db.prepare('INSERT INTO transfers VALUES (?,?,?,?,?,?) ON CONFLICT(manifest_id) DO UPDATE SET verified_at=excluded.verified_at').run(id,manifest.partition,manifest.observations.length,files.size,manifest.parts.length,new Date().toISOString());
    }finally{db.close();}
    return {manifestId:id,verifiedFiles:files.size,parts:manifest.parts.length};
  }finally{closeSync(fd);unlinkSync(lock);}
}
export function httpsRangeReader(baseUrl,token,{fetchImpl=fetch}={}) {
  const base=new URL(baseUrl);requireValue(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname.endsWith('/'),'Archive endpoint requires an HTTPS directory URL');
  requireValue(typeof token==='string'&&token.length>=32&&!/[\r\n]/.test(token),'Archive machine credential unavailable');
  return async(key,offset,length)=>{
    requireValue(/^[a-f0-9]{64}\.part\.gz$/.test(key)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>0&&length<=1024*1024,'Invalid transfer range');
    const response=await fetchImpl(new URL(key,base),{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,Range:`bytes=${offset}-${offset+length-1}`}});
    const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
    if(response.status!==206||!range||Number(range[1])!==offset||Number(range[2])!==offset+length-1||Number(range[3])<offset+length){await response.body?.cancel();throw Error('Archive server did not honor the exact range');}
    const chunks=[];let n=0;for await(const chunk of response.body){n+=chunk.length;requireValue(n<=length,'Archive response exceeded range');chunks.push(chunk);}return Buffer.concat(chunks);
  };
}
export function restoreBundle(root,manifest,id,destination) {
  const files=verifyBundle(root,manifest,id);mkdirSync(destination,{recursive:true});requireValue(!lstatSync(destination).isSymbolicLink(),'Restore root cannot be a link');
  for(const [key,bytes] of files){const path=resolve(destination,key),rel=relative(resolve(destination),path);requireValue(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Restore escapes root');
    const directory=join(destination,key.split('/')[0]);mkdirSync(directory,{recursive:true});requireValue(!lstatSync(directory).isSymbolicLink(),'Restore directory cannot be a link');
    if(existsSync(path))requireValue(!lstatSync(path).isSymbolicLink(),'Restore file cannot be a link');immutable(directory,key.split('/')[1],bytes);}
  return {files:files.size,manifestId:id};
}
export function createReceipt(root,manifest,id,secret,{now=Date.now(),verificationId=randomUUID()}={}) {
  verifyBundle(root,manifest,id);requireValue(Buffer.byteLength(secret)>=32,'Receipt key too short');
  const body={version:TRANSFER_VERSION,manifestId:id,verificationId,verifiedAt:new Date(now).toISOString(),objects:manifest.objects,parts:manifest.parts};
  return {body,signature:createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex')};
}
function verifyReceipt(receipt,manifest,id,secret) {
  requireValue(receipt?.body?.manifestId===id&&receipt.body.version===TRANSFER_VERSION&&/^[a-f0-9]{64}$/.test(receipt.signature??''),'Invalid transfer receipt');
  const expected=createHmac('sha256',secret).update(JSON.stringify(receipt.body)).digest();requireValue(timingSafeEqual(expected,Buffer.from(receipt.signature,'hex')),'Receipt authentication failed');
  requireValue(JSON.stringify(receipt.body.objects)===JSON.stringify(manifest.objects)&&JSON.stringify(receipt.body.parts)===JSON.stringify(manifest.parts),'Receipt object membership mismatch');
}
// Returns a plan only. A provider transaction, trusted receipt-receive timestamps,
// complete reference inventory and provider-specific deletion journal remain deployment gates.
export function cleanupEligibility({manifest,id,first,second,firstReceivedAt,secondReceivedAt,secret,now,protectedKeys,restoreVerified=false}) {
  validateManifest(manifest,id);verifyReceipt(first,manifest,id,secret);verifyReceipt(second,manifest,id,secret);
  requireValue(restoreVerified&&first.body.verificationId!==second.body.verificationId,'Independent restore and second verification required');
  requireValue(Number.isFinite(now)&&Number.isFinite(firstReceivedAt)&&Number.isFinite(secondReceivedAt)&&secondReceivedAt-firstReceivedAt>=7*DAY&&now>=secondReceivedAt,'Cleanup grace period incomplete');
  const cutoff=protectedYearCutoff(now);requireValue(manifest.observations.every(o=>Date.parse(o.observedAt)<cutoff),'Newest calendar year is protected');
  requireValue(protectedKeys instanceof Set,'Complete protected reference inventory required');
  return {manifestId:id,deleteKeys:manifest.objects.filter(o=>/^(objects|normalized)\//.test(o.key)&&!protectedKeys.has(o.key)).map(o=>o.key),keepMetadata:true,executable:false};
}

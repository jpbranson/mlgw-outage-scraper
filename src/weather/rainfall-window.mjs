import {hourlyEndpoints} from './accumulation.mjs';
import {sourceRequest} from './sources.mjs';
import {rainfallSubset} from './decode.mjs';

// Each invocation stays bounded. Re-running a batch verifies saved originals.
export function rainfallPlan(config) {
  const endpoints=hourlyEndpoints(config.from,config.to);
  if(![24,48,72].includes(endpoints.length))throw Error('Select a 24-, 48- or 72-hour rainfall window');
  const hoursPerBatch=config.hoursPerBatch??24;
  if(!Number.isInteger(hoursPerBatch)||hoursPerBatch<1||hoursPerBatch>24)throw Error('Rainfall batches must contain 1–24 hours');
  const periodHours=config.periodHours??[24,48,72].filter(h=>h<=endpoints.length);
  if(!Array.isArray(periodHours)||!periodHours.length||new Set(periodHours).size!==periodHours.length||periodHours.some(h=>![24,48,72].includes(h)||h>endpoints.length))throw Error('Invalid rainfall period lengths');
  const reportId=config.reportId??'rainfall-window';
  if(typeof reportId!=='string'||!/^rainfall-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reportId))throw Error('Invalid rainfall report ID');
  for(const at of endpoints)sourceRequest('rainfall',at);
  return {from:new Date(Date.parse(config.from)).toISOString(),to:new Date(Date.parse(config.to)).toISOString(),
    endpoints,hoursPerBatch,periodHours,reportId,batches:Math.ceil(endpoints.length/hoursPerBatch)};
}

export async function collectRainfallBatch(cache,plan,batch,{download=false,onProgress=()=>{},shouldStop=()=>false}={}) {
  if(!Number.isInteger(batch)||batch<1||batch>plan.batches)throw Error(`Batch must be between 1 and ${plan.batches}`);
  const endpoints=plan.endpoints.slice((batch-1)*plan.hoursPerBatch,batch*plan.hoursPerBatch);
  const report={checkedAt:new Date().toISOString(),batch,range:{from:plan.from,to:plan.to},expectedInputs:endpoints.length,
    mode:download?'download':'offline',cacheBeforeBytes:cache.used,inputs:[],stopReason:null};
  const finish=()=>Object.assign(report,{requests:cache.requests,downloadBytes:cache.downloadBytes,cacheAfterBytes:cache.used,
    elapsedMs:cache.now()-cache.started,peakRssBytes:process.resourceUsage().maxRSS*1024,limits:cache.limits,
    complete:report.inputs.length===endpoints.length&&report.inputs.every(i=>i.availability==='available')});
  for(const validAt of endpoints) {
    if(shouldStop()){report.stopReason='interrupted';break;}
    if(cache.now()-cache.started>=cache.limits.maxRunMs){report.stopReason='Weather run time budget exhausted';break;}
    const began=performance.now(),item={validAt};report.inputs.push(item);
    try {
      const manifest=await cache.acquire(sourceRequest('rainfall',validAt),{offline:!download});
      Object.assign(item,{manifestId:manifest.id,availability:manifest.availability,sourceBytes:manifest.body?.bytes??0,cacheHit:manifest.cacheHit??false});
      if(manifest.availability==='retrieved') {
        const native=rainfallSubset(cache.readBody(manifest),validAt);
        item.derived=cache.derived(manifest,native);item.summary=native.summary;item.availability='available';
      }
      if(['restricted','rate-limited','provider-paused'].includes(item.availability))report.stopReason=item.availability;
      if(manifest.attempts?.some(a=>/budget|floor|limit/.test(a.error??'')))report.stopReason='Weather resource budget exhausted';
    }catch(error){Object.assign(item,{availability:'failed',error:error.message});if(/budget|floor|limit/.test(error.message))report.stopReason=error.message;}
    item.elapsedMs=Math.round(performance.now()-began);onProgress(finish(),item);
    if(report.stopReason)break;
  }
  return finish();
}

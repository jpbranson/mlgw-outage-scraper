// One explicit batch, with the existing request/byte/cache/deadline limits.
import {readFileSync,writeFileSync} from 'node:fs';
import {WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest,windowUtc,instant,HOUR} from '../src/weather/sources.mjs';
import {rainfallSubset} from '../src/weather/decode.mjs';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--download'&&!/^--batch=[123]$/.test(a))||args.filter(a=>a.startsWith('--batch=')).length!==1)throw Error('Usage: node scripts/collect-rainfall-window.mjs --batch=1|2|3 [--download]');
const config=JSON.parse(readFileSync('config/rainfall-window.json','utf8')),range=windowUtc(config.from,config.to);
if(instant(range.from)%HOUR||instant(range.to)%HOUR||config.hoursPerBatch!==24||instant(range.to)-instant(range.from)!==72*HOUR)throw Error('Expected a pinned 72-hour window and 24-hour batches');
const batch=Number(args.find(a=>a.startsWith('--batch=')).slice(8)),cache=new WeatherCache('data/weather/cache');
const report={checkedAt:new Date().toISOString(),batch,range,mode:args.includes('--download')?'download':'offline',cacheBeforeBytes:cache.used,inputs:[]};
let peakRss=process.memoryUsage().rss;
try {
  for(let h=(batch-1)*24+1;h<=batch*24;h++) {
    const validAt=new Date(instant(range.from)+h*HOUR).toISOString(),began=performance.now();
    const item={validAt};report.inputs.push(item);
    try {
      const manifest=await cache.acquire(sourceRequest('rainfall',validAt),{offline:!args.includes('--download')});
      Object.assign(item,{manifestId:manifest.id,availability:manifest.availability,sourceBytes:manifest.body?.bytes??0,cacheHit:manifest.cacheHit??false});
      if(manifest.availability==='retrieved') {
        const native=rainfallSubset(cache.readBody(manifest),validAt);
        item.derived=cache.derived(manifest,native);item.summary=native.summary;item.availability='available';
      }
    }catch(error){Object.assign(item,{availability:'failed',error:error.message});}
    item.elapsedMs=Math.round(performance.now()-began);peakRss=Math.max(peakRss,process.memoryUsage().rss);
    console.log(JSON.stringify({validAt,availability:item.availability,sourceBytes:item.sourceBytes,elapsedMs:item.elapsedMs}));
    if(item.availability==='failed'&&/budget|floor|limit/.test(item.error))break;
  }
  Object.assign(report,{requests:cache.requests,downloadBytes:cache.downloadBytes,cacheAfterBytes:cache.used,elapsedMs:Date.now()-cache.started,
    peakRssBytes:Math.max(peakRss,process.resourceUsage().maxRSS*1024),limits:cache.limits});
  writeFileSync(`reports/rainfall-window-batch-${batch}${args.includes('--download')?'-download':''}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({batch,available:report.inputs.filter(i=>i.availability==='available').length,requests:report.requests,downloadBytes:report.downloadBytes,cacheBytes:report.cacheAfterBytes,elapsedMs:report.elapsedMs,peakRssBytes:report.peakRssBytes}));
  if(report.inputs.length!==24||report.inputs.some(i=>i.availability!=='available'))process.exitCode=1;
}finally{cache.close();}

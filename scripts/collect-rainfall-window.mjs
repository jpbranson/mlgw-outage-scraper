// One explicit, resumable batch under the existing resource limits.
import {writeFileSync,renameSync} from 'node:fs';
import {WeatherCache} from '../src/weather/cache.mjs';
import {collectRainfallBatch} from '../src/weather/rainfall-window.mjs';
import {rainfallOptions} from './rainfall-options.mjs';
const {configPath,plan,batch,download}=rainfallOptions(process.argv.slice(2),{collect:true});
const cache=new WeatherCache('data/weather/cache'),path=`reports/${plan.reportId}-batch-${batch}${download?'-download':''}.json`;
let interrupted=false;
const stop=()=>{interrupted=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const save=report=>{writeFileSync(path+'.tmp',JSON.stringify({...report,configPath},null,2));renameSync(path+'.tmp',path);};
try {
  const report=await collectRainfallBatch(cache,plan,batch,{download,shouldStop:()=>interrupted,onProgress:(report,item)=>{
    save(report);console.log(JSON.stringify({validAt:item.validAt,availability:item.availability,cacheHit:item.cacheHit,sourceBytes:item.sourceBytes,elapsedMs:item.elapsedMs}));
  }});
  save(report);
  console.log(JSON.stringify({batch,complete:report.complete,available:report.inputs.filter(i=>i.availability==='available').length,
    requests:report.requests,downloadBytes:report.downloadBytes,cacheBytes:report.cacheAfterBytes,elapsedMs:report.elapsedMs,peakRssBytes:report.peakRssBytes,stopReason:report.stopReason}));
  if(!report.complete)process.exitCode=1;
}finally{cache.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);}

import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {WeatherCache} from '../src/weather/cache.mjs';
import {publishWeather} from '../src/weather/publish.mjs';
import {maintenanceRequests,pruneRollingCache,directoryBytes} from '../src/weather/maintenance.mjs';
const args=process.argv.slice(2);if(args.some(a=>!['--download','--run'].includes(a))||new Set(args).size!==args.length)throw Error('Usage: node scripts/maintain-weather.mjs [--download] [--run]');
const stateRoot=resolve('data/weather/maintenance');mkdirSync(stateRoot,{recursive:true});
const lock=join(stateRoot,'runner.lock'),fd=openSync(lock,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
let stopped=false;for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{stopped=true;});
const statePath=join(stateRoot,'state.json');let state={};if(existsSync(statePath))state=JSON.parse(readFileSync(statePath));
const endsAt=JSON.parse(readFileSync('data/collector/run-state.json')).endsAt;
function persist(){writeFileSync(statePath+'.tmp',JSON.stringify(state,null,2));renameSync(statePath+'.tmp',statePath);}
try {
  do {
    const now=Date.now();if(now>=Date.parse(endsAt)||existsSync(join(stateRoot,'stop'))){state.stopReason=now>=Date.parse(endsAt)?'collector-trial-ended':'owner-requested';break;}
    state={...state,pid:process.pid,heartbeatAt:new Date(now).toISOString(),endsAt,mode:args.includes('--download')?'download':'offline',stopReason:null};
    if(now>=(Date.parse(state.nextDueAt??'')||0)) {
      let cache;
      try {
        const evidenceBytes=directoryBytes('data/weather/cache'),totalCap=JSON.parse(readFileSync('config/weather.local.json')).cacheBytes;
        const rollingBudget=Math.min(256*1024*1024,totalCap-evidenceBytes);
        if(rollingBudget<64*1024*1024)throw Error('Shared weather storage headroom insufficient; all evidence preserved');
        cache=new WeatherCache('data/weather/live-cache',{limits:{cacheBytes:rollingBudget}});
        const retention=pruneRollingCache(cache,{now}),outcomes=await publishWeather(cache,maintenanceRequests(now),{offline:!args.includes('--download')});
        state.lastRun={at:new Date(now).toISOString(),retention,outcomes,requests:cache.requests,downloadBytes:cache.downloadBytes,evidenceBytes,rollingBytes:cache.used,totalCap};
        state.lastError=null;state.status=outcomes.some(o=>['failed','restricted','provider-paused','rate-limited'].includes(o.status))?'degraded':'ok';
      }catch(e){state.lastError=String(e.message);state.lastErrorAt=new Date().toISOString();state.status='degraded';}
      finally{cache?.close();}
      state.nextDueAt=new Date(Date.now()+30*60000).toISOString();console.log(JSON.stringify(state));
    }
    persist();if(!args.includes('--run'))break;await sleep(30000);
  }while(!stopped);
  if(stopped)state.stopReason='interrupted';state.heartbeatAt=new Date().toISOString();persist();
  if(state.lastError)process.exitCode=1;
}finally{closeSync(fd);unlinkSync(lock);}

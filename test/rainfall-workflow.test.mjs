import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {rainfallPlan,collectRainfallBatch} from '../src/weather/rainfall-window.mjs';
import {publishRainfallPeriods} from '../src/weather/rainfall-publish.mjs';
import {rainfallGrib} from './fixtures/rainfall-grib.mjs';
import {rainfallSubset,decodePng} from '../src/weather/decode.mjs';
import {displayImage,RAIN_LEGEND,RAIN_PERIOD_LEGEND} from '../src/weather/display.mjs';
import {accumulateHourly} from '../src/weather/accumulation.mjs';
import {WeatherService} from '../src/dashboard/weather.mjs';
const config={from:'2024-09-12T00:00:00Z',to:'2024-09-13T00:00:00Z',hoursPerBatch:12,reportId:'rainfall-test'};
const root=()=>mkdtempSync(join(tmpdir(),'mlgw-rainfall-workflow-'));
const make=(dir,extra={})=>new WeatherCache(dir,{...extra,limits:{minimumFreeBytes:0,maxResponseBytes:16384,cacheBytes:10000000,...extra.limits}});
const fetchHour=async url=>{
  const m=/(\d{4})(\d{2})(\d{2})-(\d{2})0000\.grib2/.exec(url);
  return new Response(rainfallGrib(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00Z`));
};
test('selected rainfall windows constrain intervals, batch sizes, reports and products',()=>{
  assert.equal(rainfallPlan(config).batches,2);
  assert.deepEqual(rainfallPlan({...config,to:'2024-09-14T00:00:00Z'}).periodHours,[24,48]);
  for(const changed of [{to:'2024-09-16T00:00:00Z'},{to:'2024-09-13T00:30:00Z'},{hoursPerBatch:25},{reportId:'../escape'},{periodHours:[48]},{periodHours:[24,24]},
    {from:'2019-01-01T00:00:00Z',to:'2019-01-02T00:00:00Z'}])assert.throws(()=>rainfallPlan({...config,...changed}));
});
test('multi-day rainfall colors distinguish heavy totals while preserving zero and missing',()=>{
  const data={bbox:[0,0,4,1],grid:{width:4,height:1,x0:.5,y0:.5,dx:1,dy:-1},values:[0,null,75,175],qualityFlags:[]};
  const period=displayImage(data,'rainfall-period'),hour=displayImage(data,'rainfall');
  assert.deepEqual(period.legend,RAIN_PERIOD_LEGEND);assert.deepEqual(hour.legend,RAIN_LEGEND);
  const pixels=decodePng(Buffer.from(period.imageBase64,'base64')).pixels;
  const at=x=>[...pixels.subarray((256*512+x)*4,(256*512+x)*4+4)];
  assert.equal(at(64)[3],0);assert.deepEqual(at(192),[136,136,136,255]);assert.notDeepEqual(at(320),at(448));
});
test('interrupted batches checkpoint progress and resume from verified originals with no duplicate downloads',async()=>{
  const dir=root(),plan=rainfallPlan(config);let calls=0,stop=false,checkpoints=0;
  let cache=make(dir,{fetchImpl:async url=>{calls++;return fetchHour(url);}});
  const first=await collectRainfallBatch(cache,plan,1,{download:true,shouldStop:()=>stop,onProgress:r=>{checkpoints++;if(r.inputs.length===3)stop=true;}});
  cache.close();assert.equal(first.stopReason,'interrupted');assert.equal(first.complete,false);assert.equal(checkpoints,3);assert.equal(calls,3);
  cache=make(dir,{fetchImpl:async url=>{calls++;return fetchHour(url);}});
  try{
    const resumed=await collectRainfallBatch(cache,plan,1,{download:true});
    assert.equal(resumed.complete,true);assert.equal(resumed.requests,9);assert.equal(calls,12);
    assert.equal(resumed.inputs.filter(i=>i.cacheHit).length,3);
    const replay=await collectRainfallBatch(cache,plan,1);assert.equal(replay.complete,true);assert.equal(calls,12);
  }finally{cache.close();}
});
test('mid-stream failure preserves previous hours and retry resumes after persisted backoff',async()=>{
  const dir=root(),plan=rainfallPlan({...config,hoursPerBatch:2});let now=Date.parse('2026-09-17T00:00:00Z'),calls=0;
  let cache=make(dir,{now:()=>now,limits:{minimumFreeBytes:0,maxRetries:0},fetchImpl:async url=>{
    if(++calls===1)return fetchHour(url);
    return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.error(Error('interrupted transfer'));}}));
  }});
  const failed=await collectRainfallBatch(cache,plan,1,{download:true});cache.close();
  assert.equal(failed.complete,false);assert.equal(failed.inputs[0].availability,'available');assert.equal(failed.inputs[1].availability,'failed');
  assert.equal(readdirSync(join(dir,'objects')).length,1);
  now+=61000;cache=make(dir,{now:()=>now,fetchImpl:fetchHour});
  try{const resumed=await collectRainfallBatch(cache,plan,1,{download:true});assert.equal(resumed.complete,true);assert.equal(resumed.requests,1);}finally{cache.close();}
});
test('request/deadline exhaustion and provider pauses stop batches without inventing hours',async()=>{
  const plan=rainfallPlan(config);
  for(const limit of [{maxRequests:1},{maxRunMs:0}]){
    const cache=make(root(),{limits:{minimumFreeBytes:0,...limit},fetchImpl:fetchHour});
    try{const r=await collectRainfallBatch(cache,plan,1,{download:true});assert.equal(r.complete,false);assert.match(r.stopReason,/budget/);assert.ok(r.requests<=1);}finally{cache.close();}
  }
  const cache=make(root(),{fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':'60'}})});
  try{const r=await collectRainfallBatch(cache,plan,1,{download:true});assert.equal(r.stopReason,'rate-limited');assert.equal(r.inputs.length,1);}finally{cache.close();}
});
function validation(cache,cfg) {
  const plan=rainfallPlan(cfg),frames=plan.endpoints.map(at=>({validAt:at,data:rainfallSubset(rainfallGrib(at),at)}));
  const accumulation=accumulateHourly(plan.from,plan.to,frames),areas={bbox:{meanMm:12},blockGroups:[{meanMm:12}]};
  const bytes=Buffer.from(JSON.stringify({accumulation,areas,reference:{sha256:'a'.repeat(64)}})),hash=sha256(bytes),key=`derived/${hash}.json`;cache.put(key,bytes);
  return {plan,report:{config:cfg,faultChecks:[{passed:true}],windows:[{hours:24,from:plan.from,to:plan.to,derived:{key,sha256:hash}}]}};
}
test('publication keeps multiple end dates, stays idempotent and preserves catalog on failed verification',()=>{
  const cache=make(root(),{fetchImpl:async()=>assert.fail('offline only')});
  try{
    const a=validation(cache,config);publishRainfallPeriods(cache,a.report,a.plan);
    const b=validation(cache,{...config,from:'2024-09-13T00:00:00Z',to:'2024-09-14T00:00:00Z'});publishRainfallPeriods(cache,b.report,b.plan);
    publishRainfallPeriods(cache,a.report,a.plan);
    const service=new WeatherService(cache.root);assert.equal(service.periods(new URLSearchParams()).periods.length,2);
    const original=readFileSync(join(cache.root,'published/catalog.json'));
    const bad=structuredClone(b.report);bad.windows[0].derived.sha256='0'.repeat(64);
    assert.throws(()=>publishRainfallPeriods(cache,bad,b.plan),/checksum/);
    assert.deepEqual(readFileSync(join(cache.root,'published/catalog.json')),original);
    assert.throws(()=>publishRainfallPeriods(cache,a.report,b.plan),/selected/);
    assert.equal(cache.requests,0);
  }finally{cache.close();}
});

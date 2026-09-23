import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest,HOUR} from '../src/weather/sources.mjs';
import {publishWeather} from '../src/weather/publish.mjs';
import {rainfallSubset} from '../src/weather/decode.mjs';
import {rainfallGrib} from './fixtures/rainfall-grib.mjs';
import {maintenanceRequests,pruneRollingCache,publishRollingRainfall} from '../src/weather/maintenance.mjs';
import {WeatherService} from '../src/dashboard/weather.mjs';
const now=Date.parse('2026-09-18T18:30:00Z');
test('maintenance bounds downtime catch-up and retrospective rainfall endpoints',()=>{
  const requests=maintenanceRequests(now);assert.equal(requests.length,11);assert.equal(requests.filter(r=>r.product==='radar').length,7);
  assert.ok(requests.every(r=>Date.parse(r.validAt)<=now));assert.equal(requests.filter(r=>r.product==='rainfall').at(-1).validAt,'2026-09-18T15:00:00.000Z');
});
test('rolling retention preserves shared objects, recent data and the saved study cache',async t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-maintenance-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cache=new WeatherCache(root,{limits:{minimumFreeBytes:0},fetchImpl:async()=>new Response('same retained bytes'),now:()=>now});
  try {
    const old=await cache.acquire(sourceRequest('radar','2026-09-18T10:00:00Z')),recent=await cache.acquire(sourceRequest('radar','2026-09-18T18:00:00Z'));
    const a=cache.derived(old,{validAt:old.request.validAt}),b=cache.derived(recent,{validAt:recent.request.validAt});
    cache.put('published/catalog.json',Buffer.from(JSON.stringify({version:1,entries:[{product:'radar',validAt:old.request.validAt,sha256:a.sha256},{product:'radar',validAt:recent.request.validAt,sha256:b.sha256}]})));
    assert.throws(()=>pruneRollingCache(cache,{now}),/dedicated/);
    const result=pruneRollingCache(cache,{now,expectedRoot:root});assert.equal(result.filesRemoved,2);
    assert.ok(existsSync(join(root,'objects',recent.body.sha256+'.raw')));assert.ok(!existsSync(join(root,'manifests',old.id+'.json')));
    assert.equal(new WeatherService(root).catalog().entries.length,1);assert.equal(pruneRollingCache(cache,{now,expectedRoot:root}).filesRemoved,0);
  }finally{cache.close();}
});
test('evidence source families cause rolling cleanup to fail without deleting them',async t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const c=new WeatherCache(root,{limits:{minimumFreeBytes:0},fetchImpl:async()=>new Response('annual station'),now:()=>now});
  try{const m=await c.acquire(sourceRequest('station','2023-01-01T00:00:00Z'));assert.throws(()=>pruneRollingCache(c,{now,expectedRoot:root}),/Evidence product/);assert.equal(c.readBody(m).toString(),'annual station');}finally{c.close();}
});
test('saved and rolling writers share a budget lock and aggregate byte cap',t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-shared-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const saved=join(root,'saved'),rolling=join(root,'rolling'),sharedBudget={root,cacheRoots:[saved,rolling],maxBytes:2000};
  let c=new WeatherCache(saved,{sharedBudget,limits:{minimumFreeBytes:0}});
  assert.throws(()=>new WeatherCache(rolling,{sharedBudget,limits:{minimumFreeBytes:0}}),/EEXIST/);
  c.put('objects/'+'a'.repeat(64)+'.raw',Buffer.alloc(1200));c.close();
  c=new WeatherCache(rolling,{sharedBudget,limits:{minimumFreeBytes:0}});
  try{assert.throws(()=>c.put('objects/'+'b'.repeat(64)+'.raw',Buffer.alloc(1000)),/Shared weather cache budget/);assert.ok(existsSync(join(saved,'objects','a'.repeat(64)+'.raw')));}finally{c.close();}
});
test('rolling rainfall publishes complete sliding 24-hour totals tied to their final hour',async t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-rolling-rain-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const fetchHour=async url=>{const m=/(\d{4})(\d{2})(\d{2})-(\d{2})0000\.grib2/.exec(url);return new Response(rainfallGrib(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00Z`));};
  const cache=new WeatherCache(root,{limits:{minimumFreeBytes:0,maxRequests:100},fetchImpl:fetchHour,now:()=>now});
  try {
    const end=Date.parse('2026-09-18T16:00:00Z'),hours=Array.from({length:26},(_,i)=>new Date(end-(25-i)*HOUR).toISOString());
    // The oldest hour is missing: that window is never published as a zero or a shorter total.
    const outcomes=await publishWeather(cache,hours.filter(at=>at!=='2026-09-17T15:00:00.000Z').map(at=>sourceRequest('rainfall',at)),{offline:false});
    assert.ok(outcomes.every(o=>o.status==='published'));
    // Frames derived before numeric subsets were kept are upgraded once from their retained originals.
    const catalog=JSON.parse(readFileSync(join(root,'published/catalog.json')));
    for(const e of catalog.entries.slice(0,2)){const {sourceId,sourceSha256,numeric,...display}=JSON.parse(readFileSync(join(root,'derived',e.sha256+'.json')));
      e.sha256=cache.derived(JSON.parse(readFileSync(join(root,'manifests',sourceId+'.json'))),display).sha256;}
    cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));
    const first=publishRollingRainfall(cache);assert.equal(first.upgraded,2);
    assert.deepEqual(first.published.map(p=>p.to),['2026-09-18T16:00:00.000Z','2026-09-18T15:00:00.000Z']);
    assert.deepEqual(publishRollingRainfall(cache),{published:[],upgraded:0});
    const service=new WeatherService(join(root,'no-saved-cache'),{rollingRoot:root}),periods=service.periods(new URLSearchParams()).periods;
    assert.deepEqual(periods.map(p=>[p.to,p.hours,p.rolling]),[['2026-09-18T16:00:00.000Z',24,true],['2026-09-18T15:00:00.000Z',24,true]]);
    const latest=service.period(new URLSearchParams({id:periods[0].id})),frame=rainfallSubset(rainfallGrib(periods[0].to),periods[0].to);
    assert.equal(latest.rolling,true);assert.deepEqual(latest.grid,Object.fromEntries(["width","height","x0","y0","dx","dy"].map(k=>[k,frame.grid[k]])));
    assert.deepEqual(latest.values,frame.values.map(v=>v===null?null:Number((v*24).toFixed(6))));assert.ok(latest.hoursPerCell.every(h=>h===24));
    assert.equal(latest.blockGroupCount,685);
    // Ordinary retention removes a total with its final hour's manifest.
    pruneRollingCache(cache,{now:Date.parse('2026-09-19T19:30:00Z'),expectedRoot:root});
    assert.deepEqual(service.periods(new URLSearchParams()).periods.map(p=>p.to),['2026-09-18T16:00:00.000Z']);
  }finally{cache.close();}
});

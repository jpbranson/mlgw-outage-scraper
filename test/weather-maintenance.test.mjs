import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {maintenanceRequests,pruneRollingCache} from '../src/weather/maintenance.mjs';
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

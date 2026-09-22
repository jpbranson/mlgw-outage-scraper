import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outageHours, windHours, conditionGroups, COMPARISON_VERSION } from '../src/weather/comparisons.mjs';
import { ComparisonService } from '../src/dashboard/comparisons.mjs';
import { createDashboardServer } from '../src/dashboard/server.mjs';
import { sha256 } from '../src/weather/objects.mjs';
const from='2023-06-24T00:00:00Z',to='2023-06-24T02:00:00Z',start=Date.parse(from),HOUR=3600000;
const row=(minutes,customers,outages=1)=>({at:start+minutes*60000,id:'capture-'+minutes,capturedAt:new Date(start+minutes*60000).toISOString(),customers,outages,gridCaptureKey:null});
test('comparison burden splits a short interval at hour boundary and never bridges long gaps',()=>{
  const result=outageHours([row(58,60),row(63,30),row(90,900)],from,to);
  assert.equal(result.hours[0].coveredMinutes,2);assert.equal(result.hours[1].coveredMinutes,3);
  assert.equal(result.summary.observedCustomerHours,5);assert.equal(result.summary.customerHours,null);
  assert.equal(result.summary.peakCustomers,900);assert.equal(result.summary.coveredMinutes,5);
});
test('comparison distinguishes observed zero, empty hours and independent count peaks',()=>{
  const r=outageHours([row(5,0,7),row(10,20,1)],from,to);
  assert.equal(r.hours[0].peakCustomers,20);assert.equal(r.hours[0].peakOutages,7);
  assert.equal(r.hours[0].customerCaptureId,'capture-10');assert.equal(r.hours[0].outageCaptureId,'capture-5');
  assert.equal(r.hours[1].peakCustomers,null);assert.equal(r.summary.uniqueEvents,null);
  const empty=outageHours([],from,to);assert.equal(empty.summary.peakCustomers,null);assert.equal(empty.summary.observedCustomerHours,null);
  assert.equal(empty.hours[0].observedCustomerHours,null);
  const continuous=outageHours(Array.from({length:24},(_,i)=>row(i*5,60)),from,to);
  assert.equal(continuous.summary.customerHours,115);assert.equal(continuous.summary.burdenStatus,'observed-coverage-sufficient');
  assert.equal(outageHours([row(5,0)],from,to).summary.peakCustomers,0);
});
test('comparison refuses unsupported cadence, duplicate observations and inclusive end',()=>{
  assert.throws(()=>outageHours([],from,to,30),/policy/);
  assert.throws(()=>outageHours([row(5,1),row(5,2)],from,to),/observations/);
  assert.throws(()=>outageHours([row(120,1)],from,to),/observations/);
});
test('comparison station maxima exclude rejected and unsupported fields; gust absence stays null',()=>{
  const field=(value,status='accepted',eligible=true)=>({value,status,eligible});
  const station={rows:[{at:row(5,0).capturedAt,fields:{wind_speed:field(3),wind_gust:field(null,'missing',false)}},
    {at:row(6,0).capturedAt,fields:{wind_speed:field(50,'rejected',false),wind_gust:field(70,'unsupported',false)}},
    {at:row(7,0).capturedAt,fields:{wind_speed:field(5),wind_gust:field(null,'missing',false)}}]};
  const hours=windHours(station,from,to);assert.equal(hours[0].sustained.value,5);assert.equal(hours[0].sustained.acceptedReports,2);assert.equal(hours[0].gust.value,null);assert.equal(hours[1].sustained.value,null);
});
const rules={rainThresholdMm:.1,windThresholdMs:10,minimumGroupHours:6};
test('all supported lags use only completed earlier weather hours and preserve missing exposures',()=>{
  const hours=Array.from({length:8},(_,i)=>({from:new Date(start+i*HOUR).toISOString(),to:new Date(start+(i+1)*HOUR).toISOString(),observations:i===4?0:1,peakCustomers:i===4?null:i}));
  const rain=hours.map((h,i)=>({...h,meanMm:i===2?null:i})),wind=hours.map((h,i)=>({...h,sustained:{value:i,at:h.from,acceptedReports:1},gust:{value:null}}));
  for(const lag of [0,1,3]){const r=conditionGroups(hours,rain,wind,lag,rules);for(let i=0;i<8;i++){
    const p=r.matches[i],j=i-1-lag;if(j<0){assert.equal(p.rainMm,null);assert.equal(p.windMs,null);}else{assert.equal(p.rainMm,rain[j].meanMm);assert.ok(Date.parse(p.exposureTo)<=Date.parse(p.from));assert.ok(Date.parse(p.windReportAt)<Date.parse(p.from));}}
    assert.equal(r.groups.find(g=>g.id==='wind').medianHourlyPeakCustomers,null);
  }
  assert.throws(()=>conditionGroups(hours,rain,wind,2,rules),/lag/);
});
test('six joint hours enable a median; weather-only hours do not count and overlapping groups remain separate',()=>{
  const hours=Array.from({length:8},(_,i)=>({from:new Date(start+i*HOUR).toISOString(),observations:i===7?0:1,peakCustomers:i}));
  const rain=hours.map(h=>({...h,meanMm:1})),wind=hours.map(h=>({...h,sustained:{value:12},gust:{value:null}}));
  const r=conditionGroups(hours,rain,wind,0,rules),rainGroup=r.groups[0];assert.equal(rainGroup.weatherHours,7);assert.equal(rainGroup.jointHours,6);assert.equal(rainGroup.medianHourlyPeakCustomers,3.5);assert.equal(r.groups[4].jointHours,6);
});
test('comparison publications enforce checksums, IDs, lag bounds and read-only existing routes',async t=>{
  const root=mkdtempSync(join(tmpdir(),'comparison-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const d={version:COMPARISON_VERSION,id:'test',from,to,byLag:[{lagHours:0,matches:[{from,to,observations:0,peakCustomers:null}]}],matchedReference:{byLag:[{lagHours:0,pairs:[{hour:0,included:false,caseCapture:null,referenceCapture:{id:'ref',capturedAt:from,customers:0,outages:0},reasons:['case-capture-missing']}]}]}};
  const bytes=Buffer.from(JSON.stringify(d)),hash=sha256(bytes),entry={id:'test',name:'Test',from,to,path:hash+'.json',sha256:hash,bytes:bytes.length};
  writeFileSync(join(root,entry.path),bytes);writeFileSync(join(root,'catalog.json'),JSON.stringify({version:COMPARISON_VERSION,entries:[entry]}));
  writeFileSync(join(root,'comparisons.html'),'comparison page');const service=new ComparisonService(root),params=new URLSearchParams('view=comparison&id=test&lag=0');
  assert.equal(service.series(params).comparison.matches.length,1);
  for(const query of ['id=test&lag=2','id=test&id=test','id=test&lag=0&lag=1','id=test&from=x'])assert.throws(()=>service.series(new URLSearchParams(query)),e=>e.status===400);
  assert.throws(()=>service.series(new URLSearchParams('id=../file')),e=>e.status===404);
  const server=createDashboardServer({}, {staticRoot:root,comparisons:service,tiles:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await(await fetch(base+'/legacy.html?view=comparisons')).text(),'comparison page');
  assert.equal((await fetch(base+'/api/legacy/series?'+params)).status,200);
  const csv=await(await fetch(base+'/api/legacy/export.csv?'+params)).text();assert.match(csv,/legacy_html,test,0/);assert.doesNotMatch(csv,/null/);
  const paired=await(await fetch(base+'/api/legacy/export.csv?'+params+'&table=reference')).text();assert.match(paired,/reference_capture_utc/);assert.match(paired,/,ref,2023-06-24T00:00:00Z,0,0,case-capture-missing/);assert.doesNotMatch(paired,/null/);
  assert.equal(service.series(params).matchedReference.comparison.lagHours,0);assert.equal(service.series(params).matchedReference.byLag,undefined);
  for(const q of ['table=other','table=case&table=reference'])assert.throws(()=>service.csv(new URLSearchParams(params+'&'+q)),e=>e.status===400);
  assert.equal((await fetch(base+'/api/legacy/series?'+params,{method:'POST'})).status,405);
  writeFileSync(join(root,entry.path),Buffer.alloc(bytes.length));assert.throws(()=>service.series(params),e=>e.status===503);
  assert.equal((await fetch(base+'/api/legacy/series?'+params)).status,503);
});

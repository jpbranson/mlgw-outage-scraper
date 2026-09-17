import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {accumulateHourly,hourlyEndpoints} from '../src/weather/accumulation.mjs';
import {cellAreaWeights,summarizeArea,rectangle} from '../src/weather/area-weights.mjs';
const from='2023-11-05T06:00:00Z',to='2023-11-05T08:00:00Z';
const grid={width:2,height:1,x0:.5,y0:.5,dx:1,dy:-1};
const frame=(at,values)=>({validAt:at,data:{grid,product:'MultiSensor_QPE_01H_Pass2',units:'mm',validAt:at,intervalStart:new Date(Date.parse(at)-3600000).toISOString(),intervalEnd:at,
  processingVersion:'test-v1',crs:'native lat/lon',earthShapeCode:2,sourceTables:{master:2,local:1,process:1},values,quality:values.map(v=>v===null?'missing':'estimate')}});
const frames=()=>[frame('2023-11-05T07:00:00Z',[0,1.2]),frame('2023-11-05T08:00:00Z',[.3,2.4])];
test('hourly accumulation is UTC-based across DST and uses every preceding interval exactly once',()=>{
  const result=accumulateHourly(from,to,frames().reverse());assert.deepEqual(result.values,[.3,3.6]);assert.deepEqual(result.hoursPerCell,[2,2]);assert.equal(result.summary.cellHourCoverage,1);
  assert.deepEqual(hourlyEndpoints(from,to),['2023-11-05T07:00:00.000Z','2023-11-05T08:00:00.000Z']);
  assert.throws(()=>hourlyEndpoints(from,'2023-11-05T08:05:00Z'),/hourly/);
  assert.throws(()=>hourlyEndpoints(from,'2023-11-09T08:00:00Z'),/72/);
});
test('one missing hour makes all full-window totals unknown while retaining partial evidence',()=>{
  const result=accumulateHourly(from,to,frames().slice(0,1));assert.deepEqual(result.values,[null,null]);assert.deepEqual(result.knownSumMm,[0,1.2]);
  assert.equal(result.summary.cellHourCoverage,.5);assert.equal(result.summary.maxMm,null);assert.equal(result.missingHours.length,1);
  assert.throws(()=>accumulateHourly(from,to,[]),/No verified/);
});
test('missing/no-coverage cells remain null; valid neighboring zeros stay real zero',()=>{
  const rows=[frame('2023-11-05T07:00:00Z',[null,0]),frame('2023-11-05T08:00:00Z',[2,0])];
  rows[0].data.quality[0]='no-coverage';const result=accumulateHourly(from,to,rows);
  assert.deepEqual(result.values,[null,0]);assert.deepEqual(result.knownSumMm,[2,0]);assert.deepEqual(result.hoursPerCell,[1,2]);
  assert.equal(result.summary.completeCells,1);assert.equal(result.summary.cellHourCoverage,.75);
});
test('duplicates, overlapping products, future hours and incompatible metadata fail explicitly',()=>{
  assert.throws(()=>accumulateHourly(from,to,[...frames(),frames()[0]]),/Duplicate/);
  assert.throws(()=>accumulateHourly(from,to,[frame('2023-11-05T09:00:00Z',[1,2])]),/outside/);
  for(const mutate of [d=>d.intervalStart=from,d=>d.product='MultiSensor_QPE_24H_Pass2',d=>d.units='in',d=>d.grid={...grid,dx:.5},d=>d.processingVersion='other',d=>d.sourceTables={...d.sourceTables,process:3}]) {
    const rows=frames();mutate(rows[1].data);assert.throws(()=>accumulateHourly(from,to,rows),/interval|Only one-hour|changed/);
  }
  for(const value of [-1,NaN,Infinity,'2']) {const rows=frames();rows[1].data.values[0]=value;assert.throws(()=>accumulateHourly(from,to,rows),/value/);}
});
test('partial-cell spatial weighting uses intersection area, not polygon centroid or cell count',()=>{
  const result=accumulateHourly(from,to,[frame('2023-11-05T07:00:00Z',[10,0]),frame('2023-11-05T08:00:00Z',[0,0])]);
  const weights=cellAreaWeights(grid,rectangle([.5,0,2,1])),summary=summarizeArea(result,weights);
  assert.ok(Math.abs(summary.meanMm-10/3)<1e-10);assert.ok(Math.abs(weights.spatialCoverage-1)<1e-12);assert.equal(weights.cells.length,2);
  const tiny=summarizeArea(result,cellAreaWeights(grid,rectangle([.7,.2,.8,.3])));assert.equal(tiny.nativeCells,1);assert.ok(Math.abs(tiny.meanMm-10)<1e-12);
});
test('holes, multipart geometry, concavity and reversed winding preserve intersections',()=>{
  const outer=rectangle([0,0,2,1]).coordinates[0],hole=rectangle([0,0,1,1]).coordinates[0];
  const withHole=cellAreaWeights(grid,{type:'Polygon',coordinates:[outer,hole]});assert.equal(withHole.cells.length,1);assert.equal(withHole.cells[0].index,1);
  const reversed=cellAreaWeights(grid,{type:'Polygon',coordinates:[outer.toReversed(),hole.toReversed()]});assert.deepEqual(reversed.cells,withHole.cells);assert.ok(Math.abs(reversed.areaM2/withHole.areaM2-1)<1e-12);
  const multi=cellAreaWeights(grid,{type:'MultiPolygon',coordinates:[rectangle([0,0,.5,1]).coordinates,rectangle([1.5,0,2,1]).coordinates]});
  assert.equal(multi.cells.length,2);assert.ok(Math.abs(multi.cells[0].areaM2-multi.cells[1].areaM2)<1e-5);
  const concave={type:'Polygon',coordinates:[[[0,0],[2,0],[2,.25],[.5,.25],[.5,.75],[2,.75],[2,1],[0,1],[0,0]]]};
  const c=cellAreaWeights(grid,concave);assert.ok(Math.abs(c.spatialCoverage-1)<1e-10);
});
test('area weighting accounts for latitude and reports uncovered target area instead of extrapolating',()=>{
  const g={width:1,height:2,x0:.5,y0:60,dx:1,dy:-30},w=cellAreaWeights(g,rectangle([0,15,1,75]));
  const expected=(Math.sin(75*Math.PI/180)-Math.sin(45*Math.PI/180))/(Math.sin(45*Math.PI/180)-Math.sin(15*Math.PI/180));
  assert.ok(Math.abs(w.cells[0].areaM2/w.cells[1].areaM2-expected)<1e-12);
  const result=accumulateHourly(from,to,frames()),summary=summarizeArea(result,cellAreaWeights(grid,rectangle([-1,0,2,1])));
  assert.ok(Math.abs(summary.spatialCoverage-2/3)<1e-12);assert.equal(summary.meanMm,null);assert.ok(Math.abs(summary.meanOverCompleteAreaMm-1.95)<1e-12);
  const absent=summarizeArea(result,cellAreaWeights(grid,rectangle([10,0,11,1])));assert.equal(absent.meanMm,null);assert.equal(absent.meanOverCompleteAreaMm,null);assert.equal(absent.spatialCoverage,0);
});
test('area/time coverage prevents a partial-cell mean from masquerading as the full-target mean',()=>{
  const rows=frames();rows[0].data.values[0]=null;rows[0].data.quality[0]='missing';
  const summary=summarizeArea(accumulateHourly(from,to,rows),cellAreaWeights(grid,rectangle([0,0,2,1])));
  assert.equal(summary.meanMm,null);assert.equal(summary.meanOverCompleteAreaMm,3.6);assert.ok(Math.abs(summary.completePeriodAreaFraction-.5)<1e-12);assert.ok(Math.abs(summary.areaTimeCoverage-.75)<1e-12);
  assert.throws(()=>cellAreaWeights(grid,{type:'Point',coordinates:[1,1]}),/Polygon/);
});
test('storage pressure stops new hours while preserved originals remain readable offline',async()=>{
  const root=mkdtempSync(join(tmpdir(),'mlgw-rainfall-pressure-'));let fetches=0;
  const cache=new WeatherCache(root,{limits:{minimumFreeBytes:0,maxResponseBytes:1024,cacheBytes:30000},fetchImpl:async()=>{fetches++;return new Response('preserved fixture');}});
  try {
    const request=sourceRequest('rainfall','2023-06-26T00:00:00Z'),saved=await cache.acquire(request);
    const before=readdirSync(join(root,'objects')),original=readFileSync(join(root,'objects',saved.body.sha256+'.raw'));
    cache.limits.cacheBytes=cache.used+128;
    await assert.rejects(cache.acquire(sourceRequest('rainfall','2023-06-26T01:00:00Z')),/cache budget/);
    assert.equal(fetches,1);assert.deepEqual(readdirSync(join(root,'objects')),before);
    assert.deepEqual(cache.readBody(await cache.acquire(request,{offline:true})),original);
  }finally{cache.close();}
});

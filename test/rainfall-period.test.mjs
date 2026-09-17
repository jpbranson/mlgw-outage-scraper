import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {sha256} from '../src/weather/cache.mjs';
import {BBOX} from '../src/weather/sources.mjs';
import {encodeRgba} from '../src/weather/decode.mjs';
import {cellAreaWeights} from '../src/weather/area-weights.mjs';
import {WeatherService} from '../src/dashboard/weather.mjs';
import {createDashboardServer} from '../src/dashboard/server.mjs';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'mlgw-rainfall-period-'));
  mkdirSync(join(root,'derived'));mkdirSync(join(root,'published'));
  const data={product:'rainfall-period',validAt:'2023-06-27T00:00:00.000Z',intervalStart:'2023-06-24T00:00:00.000Z',intervalEnd:'2023-06-27T00:00:00.000Z',hours:72,
    grid:{width:2,height:1,x0:.5,y0:.5,dx:1,dy:-1},values:[0,null],hoursPerCell:[72,71],summary:{availableHours:72,completeCells:1,cells:2},areaSummary:{meanMm:null,areaTimeCoverage:143/144},
    imageBase64:encodeRgba(2,1,Buffer.from([255,255,255,0,136,136,136,255])).toString('base64'),sourceSha256:'internal-provenance-only'};
  const bytes=Buffer.from(JSON.stringify(data)),id=sha256(bytes);
  writeFileSync(join(root,'derived',id+'.json'),bytes);
  const entry={product:data.product,validAt:data.validAt,intervalStart:data.intervalStart,intervalEnd:data.intervalEnd,hours:72,sha256:id};
  writeFileSync(join(root,'published/catalog.json'),JSON.stringify({version:1,entries:[entry]}));
  return {root,id,data,entry,service:new WeatherService(root)};
}
test('prepared period routes are bounded read-only IDs and never accept upstream URLs or arbitrary ranges',async t=>{
  const {root,id,service}=fixture(),server=createDashboardServer({latest:async()=>({customers:10})},{staticRoot:root,tiles:'',weather:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const list=await (await fetch(base+'/api/weather/periods')).json();assert.equal(list.periods[0].id,id);assert.equal(list.periods[0].hours,72);
  const result=await (await fetch(base+'/api/weather/period?id='+id)).json();assert.deepEqual(result.values,[0,null]);assert.equal(result.areaSummary.meanMm,null);
  assert.equal(result.sourceSha256,undefined);assert.equal((await fetch(base+result.imageUrl)).status,200);
  for(const path of ['/api/weather/periods?download=true','/api/weather/period?from=2023-01-01','/api/weather/period?id='+id+'&id='+id,'/api/weather/period?id='+id+'&url=https://example.com'])
    assert.equal((await fetch(base+path)).status,400);
  assert.equal((await fetch(base+'/api/weather/period?id='+'0'.repeat(64))).status,404);
  assert.equal((await fetch(base+'/api/weather/periods',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/weather/periods',{headers:{Origin:'https://foreign.example'}})).status,403);
});
test('period rasters cannot become one-hour capture weather and corrupted assets do not break outage routes',async t=>{
  const {root,id,service}=fixture();
  assert.equal(service.at(new URLSearchParams({at:'2023-06-27T00:00:00Z'})).rainfall.availability,'unavailable');
  writeFileSync(join(root,'derived',id+'.json'),'{}');
  assert.throws(()=>service.period(new URLSearchParams({id})),/checksum/);assert.throws(()=>service.image(id),/checksum/);
  const server=createDashboardServer({latest:async()=>({customers:10})},{staticRoot:root,tiles:'',weather:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/weather/period?id='+id)).status,503);
  assert.equal((await (await fetch(base+'/api/latest')).json()).customers,10);
});
test('period catalog rejects unsupported lengths and mismatched interval metadata',()=>{
  const {root,entry,service}=fixture();
  writeFileSync(join(root,'published/catalog.json'),JSON.stringify({version:1,entries:[{...entry,hours:96}]}));
  assert.throws(()=>service.periods(new URLSearchParams()),/Invalid rainfall period/);
  writeFileSync(join(root,'published/catalog.json'),JSON.stringify({version:1,entries:[{...entry,intervalStart:'2023-06-25T00:00:00.000Z'}]}));
  assert.throws(()=>service.periods(new URLSearchParams()),/Invalid rainfall period/);
});
test('expanded native rainfall grid covers all 685 preserved Census polygons, including the western boundary',()=>{
  const reference=JSON.parse(gunzipSync(readFileSync(new URL('../reference/shelby-block-groups-2024.json.gz',import.meta.url))));
  const grid={x0:BBOX[0]+.005,y0:BBOX[3]-.005,dx:.01,dy:-.01,width:80,height:60};
  assert.equal(reference.features.length,685);
  for(const f of reference.features)assert.ok(cellAreaWeights(grid,f.geometry).spatialCoverage>=1-1e-8,f.id);
});

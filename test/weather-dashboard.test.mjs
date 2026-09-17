import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {sha256,WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {decodeMetar} from '../src/weather/metar.mjs';
import {displayImage,radarDbz} from '../src/weather/display.mjs';
import {decodePng,encodeRgba} from '../src/weather/decode.mjs';
import {WeatherService} from '../src/dashboard/weather.mjs';
import {createDashboardServer} from '../src/dashboard/server.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'mlgw-weather-ui-')),entries=[];
  mkdirSync(join(root,'derived'));mkdirSync(join(root,'published'));
  const add=(product,validAt,extra={})=>{
    const data={validAt,product,bbox:[-90.3,34.9,-89.6,35.5],legend:[],units:'mm',
      imageBase64:encodeRgba(1,1,Buffer.from([0,0,0,0])).toString('base64'),...extra};
    const bytes=Buffer.from(JSON.stringify(data)),hash=sha256(bytes);
    writeFileSync(join(root,'derived',hash+'.json'),bytes);
    entries.push({product,validAt,sha256:hash,intervalStart:data.intervalStart,intervalEnd:data.intervalEnd});
    writeFileSync(join(root,'published/catalog.json'),JSON.stringify({version:1,entries}));return hash;
  };
  return {root,add,service:new WeatherService(root)};
}
const at=time=>new URLSearchParams({at:time});
test('weather matching excludes future and expired frames, including DST overlap',()=>{
  const {add,service}=fixture();
  add('radar','2023-11-05T06:55:00.000Z');add('radar','2023-11-05T07:05:00.000Z');
  add('rainfall','2023-11-05T07:00:00.000Z');
  assert.equal(service.at(at('2023-11-05T06:59:59Z')).radar.offsetSeconds,299);
  assert.equal(service.at(at('2023-11-05T07:00:00Z')).radar.availability,'unavailable');
  assert.equal(service.at(at('2023-11-05T07:05:01Z')).radar.offsetSeconds,1);
  assert.equal(service.at(at('2023-11-05T07:59:59Z')).rainfall.availability,'available');
  assert.equal(service.at(at('2023-11-05T08:00:00Z')).rainfall.availability,'unavailable');
  for(const params of [new URLSearchParams(),new URLSearchParams('at=2023-11-05T01:00:00'),new URLSearchParams('at=x&at=y'),new URLSearchParams('at=2023-11-05T07:00:00Z&download=true')])
    assert.throws(()=>service.at(params),e=>e.status===400);
});
test('weather corruption cannot hide known outage data or become zero rainfall',async t=>{
  const {root,add,service}=fixture(),id=add('rainfall','2026-09-17T04:00:00.000Z',{summary:{max:0}});
  assert.equal(service.at(at('2026-09-17T04:00:01Z')).rainfall.summary.max,0);
  const image=service.image(id);assert.equal(decodePng(image).width,1);
  writeFileSync(join(root,'derived',id+'.json'),'{}');
  assert.equal(service.at(at('2026-09-17T04:00:01Z')).rainfall.availability,'unavailable');
  const server=createDashboardServer({latest:async()=>({summary:{customers:812}})},{staticRoot:root,tiles:'',weather:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/api/weather?at=2026-09-17T04:00:00Z')).status,200);
  assert.equal((await fetch(url+'/api/weather/image/'+id)).status,503);
  assert.equal((await (await fetch(url+'/api/latest')).json()).summary.customers,812);
  assert.equal((await fetch(url+'/api/weather?at=bad')).status,400);
  assert.equal((await fetch(url+'/api/weather',{method:'POST'})).status,405);
  assert.equal((await fetch(url+'/api/weather?at=2026-09-17T04:00:00Z',{headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(url+'/data/weather/cache/published/catalog.json')).status,404);
});
test('only published weather images are served with verified bytes',async t=>{
  const {root,add,service}=fixture(),id=add('radar','2026-09-17T04:00:00.000Z');
  const station=add('metar','2026-09-17T04:00:00.000Z',{records:[]});
  assert.throws(()=>service.image(station),e=>e.status===404);
  assert.throws(()=>service.image('../catalog.json'),e=>e.status===404);
  const server=createDashboardServer({},{staticRoot:root,tiles:'',weather:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/weather/image/${id}`);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.match(response.headers.get('cache-control'),/private.*immutable/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),service.image(id));
});
test('airport data retains missing/trace/zero values and never uses future reports',()=>{
  const request=sourceRequest('metar','2026-09-17T04:00:00Z');
  const csv='station,valid,lon,lat,tmpf,sknt,gust,p01i,wxcodes,metar\n'+
    'MEM,2026-09-17 01:54,-89.985,35.061,0,0,M,0.00,M,"KMEM, calm"\n'+
    'MEM,2026-09-17 02:54,-89.985,35.061,M,5,12,0.0001,-RA,KMEM trace\n'+
    'MEM,2026-09-17 03:54,-89.985,35.061,88,4,M,M,M,KMEM missing\n';
  const data=decodeMetar(Buffer.from(csv),request);
  assert.equal(data.records[0].temperatureF,0);assert.equal(data.records[0].windKnots,0);assert.equal(data.records[0].gustKnots,null);
  assert.equal(data.records[0].precipitation.inches,0);assert.equal(data.records[0].rawMetar,'KMEM, calm');
  assert.equal(data.records[1].temperatureF,null);assert.equal(data.records[1].precipitation.state,'trace');assert.equal(data.records[1].precipitation.inches,null);
  assert.equal(data.records[2].precipitation.state,'missing');
  const {add,service}=fixture();add('metar',request.validAt,data);
  const selection=service.at(at('2026-09-17T03:00:00Z')).station;
  assert.equal(selection.records.length,2);assert.equal(selection.observation.at,'2026-09-17T02:54:00.000Z');
  assert.equal(selection.observation.rawMetar,undefined);
  assert.equal(service.at(at('2026-09-17T05:25:00Z')).station.availability,'unavailable');
  assert.throws(()=>decodeMetar(Buffer.from(csv.replace('MEM,2026','XXX,2026')),request),/station/);
  assert.throws(()=>sourceRequest('metar','2026-09-17T04:05:00Z'),/hourly/);
});
test('display projection preserves north/south position, real zero and missing cells',()=>{
  assert.equal(radarDbz(0),null);assert.equal(radarDbz(1),-32);assert.equal(radarDbz(75),5);
  const output=displayImage({bbox:[-90,34,-89,36],grid:{x0:-89.75,y0:35.5,dx:.5,dy:-1,width:2,height:2},values:[null,0,30,.5],qualityFlags:[]},'rainfall');
  const png=decodePng(Buffer.from(output.imageBase64,'base64'));
  const pixel=(x,y)=>[...png.pixels.subarray((y*512+x)*4,(y*512+x)*4+4)];
  assert.deepEqual(pixel(128,128),[136,136,136,255]);assert.deepEqual(pixel(384,128),[255,255,255,0]);
  assert.deepEqual(pixel(128,384),[8,69,148,255]);assert.deepEqual(pixel(384,384),[222,235,247,255]);
});
test('a not-yet-published recent file retries later without pausing unrelated files',async()=>{
  const root=mkdtempSync(join(tmpdir(),'mlgw-weather-retry-'));let calls=0;
  const cache=new WeatherCache(root,{now:()=>Date.parse('2026-09-17T04:30:00Z'),limits:{minimumFreeBytes:0},fetchImpl:async()=>{calls++;return new Response('',{status:404});}});
  try {
    const first=await cache.acquire(sourceRequest('rainfall','2026-09-17T04:00:00Z'));
    assert.equal(first.retryAt,'2026-09-17T04:35:00.000Z');
    await cache.acquire(sourceRequest('rainfall','2026-09-17T03:00:00Z'));assert.equal(calls,2);
    await cache.acquire(sourceRequest('rainfall','2026-09-17T04:00:00Z'));assert.equal(calls,2);
  }finally{cache.close();}
});

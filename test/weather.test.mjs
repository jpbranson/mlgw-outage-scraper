import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, gzipSync, crc32 } from 'node:zlib';
import { WeatherCache } from '../src/weather/cache.mjs';
import { sourceRequest, instant, eligibleFrame, windowUtc } from '../src/weather/sources.mjs';
import { decodePng, encodeRgba, rainfallSubset, stationSubset, warningSubset } from '../src/weather/decode.mjs';

const root=()=>mkdtempSync(join(tmpdir(),'mlgw-weather-test-'));
const request=()=>sourceRequest('radar','2023-06-25T23:00:00Z');
const options={limits:{minimumFreeBytes:0,maxResponseBytes:1024,cacheBytes:100000,maxRunBytes:4096},wait:async()=>{}};
const make=(dir,extra={})=>new WeatherCache(dir,{...options,...extra,limits:{...options.limits,...extra.limits}});

test('weather URLs and UTC boundaries are constrained; matching never uses a future frame',()=>{
  assert.throws(()=>instant('2023-06-25T18:00:00'),/UTC/);
  assert.throws(()=>instant('2023-02-30T00:00:00Z'),/Invalid/);
  assert.throws(()=>sourceRequest('radar','2023-06-25T23:01:00Z'),/five-minute/);
  assert.throws(()=>sourceRequest('rainfall','2020-10-01T00:00:00Z'),/transition/);
  assert.throws(()=>windowUtc('2023-06-01T00:00:00Z','2023-06-05T00:00:00Z'),/72/);
  const frames=[{validAt:'2023-11-05T06:55:00Z',availability:'available'},{validAt:'2023-11-05T07:05:00Z',availability:'available'}];
  assert.equal(eligibleFrame('2023-11-05T07:00:00Z',frames).offsetMs,300000);
  assert.equal(eligibleFrame('2023-11-05T07:11:00Z',frames),null);
  assert.equal(eligibleFrame('2023-11-05T06:50:00Z',frames),null);
});
test('weather cache verifies original bytes and replays offline without fetching',async()=>{
  let calls=0;const dir=root(),cache=make(dir,{fetchImpl:async()=>{calls++;return new Response('radar');}});
  try {
    const a=await cache.acquire(request());assert.equal(a.availability,'retrieved');
    assert.equal((await cache.acquire(request(),{offline:true})).body.sha256,a.body.sha256);assert.equal(calls,1);
    writeFileSync(join(dir,'objects',`${a.body.sha256}.raw`),'bad');
    await assert.rejects(cache.acquire(request()),/checksum/);assert.equal(calls,1);
  } finally{cache.close();}
});
test('cache refuses arbitrary URLs and multiple writers',async()=>{
  const dir=root(),cache=make(dir,{fetchImpl:async()=>assert.fail('must not fetch')});
  try {await assert.rejects(cache.acquire({...request(),url:'https://example.com'}),/allowlist/);assert.throws(()=>make(dir),/EEXIST/);}
  finally{cache.close();}
});
test('cache distinguishes missing observations and retains a negative cache',async()=>{
  let calls=0;const cache=make(root(),{fetchImpl:async()=>{calls++;return new Response('missing',{status:404});}});
  try {const a=await cache.acquire(request());assert.equal(a.availability,'unavailable');assert.equal(a.body,undefined);await cache.acquire(request());assert.equal(calls,1);}
  finally{cache.close();}
});
test('rate limits persist across processes and pause other products from the provider',async()=>{
  const dir=root(),now=()=>Date.parse('2026-09-17T00:00:00Z');let calls=0;
  let cache=make(dir,{now,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});}});
  const a=await cache.acquire(request());cache.close();assert.equal(a.retryAt,'2026-09-17T00:02:00.000Z');
  cache=make(dir,{now,fetchImpl:async()=>assert.fail('backoff must persist')});
  try{assert.equal((await cache.acquire(sourceRequest('warnings','2023-06-25T23:00:00Z'))).availability,'provider-paused');assert.equal(calls,1);}
  finally{cache.close();}
});
test('access restrictions and redirects are not followed or retried',async()=>{
  for(const status of [403,302]) {
    let calls=0;const cache=make(root(),{fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response('',{status});}});
    try{const a=await cache.acquire(request());assert.equal(a.availability,status===403?'restricted':'failed');assert.equal(calls,1);}
    finally{cache.close();}
  }
});
test('transient requests retry within bounds and keep failure evidence',async()=>{
  let calls=0;const cache=make(root(),{fetchImpl:async()=>++calls<3?new Response('',{status:503}):new Response('ok')});
  try{const a=await cache.acquire(request());assert.equal(a.availability,'retrieved');assert.deepEqual(a.attempts.map(x=>x.status),[503,503,200]);}
  finally{cache.close();}
});
test('oversized responses, request caps and cache pressure stop without deletion',async()=>{
  const dir=root(),cache=make(dir,{fetchImpl:async()=>new Response('x'.repeat(1025))});
  try{const a=await cache.acquire(request());assert.equal(a.availability,'failed');assert.equal(readdirSync(join(dir,'objects')).length,0);}
  finally{cache.close();}
  const noRequests=make(root(),{limits:{maxRequests:0}});
  try{await assert.rejects(noRequests.acquire(request()),/run budget/);}finally{noRequests.close();}
  const tiny=make(root(),{limits:{cacheBytes:1000}});
  try{await assert.rejects(tiny.acquire(request()),/cache budget/);}finally{tiny.close();}
});
test('a fetch timeout remains unavailable, never a zero-weather result',async()=>{
  const cache=make(root(),{limits:{timeoutMs:10,maxRetries:0},fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(new Response('too late')),1000);
    signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('timeout'));},{once:true});
  })});
  try{const a=await cache.acquire(request());assert.equal(a.availability,'failed');assert.match(a.attempts[0].error,/timeout/);assert.equal(a.body,undefined);}
  finally{cache.close();}
});

function pngGray(width,height,values) {
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=16;
  const raw=Buffer.alloc((width*2+1)*height);
  values.forEach((v,i)=>raw.writeUInt16BE(v,Math.floor(i/width)*(width*2+1)+1+(i%width)*2));
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function grib({parameter=37,reference=-30}={}) {
  const section=(number,length)=>{const b=Buffer.alloc(length);b.writeUInt32BE(length);b[4]=number;return b;};
  const s1=section(1,21);s1.writeUInt16BE(161,5);s1.writeUInt16BE(2023,12);s1[14]=6;s1[15]=26;
  const s3=section(3,72);s3.writeUInt32BE(4200,6);s3[14]=2;s3.writeUInt32BE(70,30);s3.writeUInt32BE(60,34);s3.writeUInt32BE(1,38);s3.writeUInt32BE(1000000,42);
  s3.writeUInt32BE(35495000,46);s3.writeUInt32BE(269705000,50);s3.writeUInt32BE(34905000,55);s3.writeUInt32BE(270395000,59);s3.writeUInt32BE(10000,63);s3.writeUInt32BE(10000,67);
  const s4=section(4,34);s4[9]=6;s4[10]=parameter;
  const s5=section(5,21);s5.writeUInt32BE(4200,5);s5.writeUInt16BE(41,9);s5.writeFloatBE(reference,11);s5.writeUInt16BE(1,17);s5[19]=16;
  const s6=section(6,6);s6[5]=255;
  const values=Array.from({length:4200},(_,i)=>[0,20,30,47][i%4]),png=pngGray(70,60,values),s7=section(7,png.length+5);png.copy(s7,5);
  const header=Buffer.alloc(16);header.write('GRIB');header[6]=209;header[7]=2;
  const b=Buffer.concat([header,s1,s3,s4,s5,s6,s7,Buffer.from('7777')]);b.writeBigUInt64BE(BigInt(b.length),8);return gzipSync(b);
}
test('native rainfall decode preserves zero, missing, no coverage and scaling',()=>{
  const data=rainfallSubset(grib(),'2023-06-26T00:00:00Z',[-90.3,34.9,-89.6,35.5]);
  assert.deepEqual(data.values.slice(0,4),[null,null,0,1.7]);assert.deepEqual(data.quality.slice(0,4),['no-coverage','missing','estimate','estimate']);
  assert.equal(data.summary.validCells,2100);assert.ok(Math.abs(data.grid.x0+90.295)<1e-6);assert.equal(data.intervalStart,'2023-06-25T23:00:00.000Z');
});
test('wrong products, timestamps and corrupt images fail closed',()=>{
  assert.throws(()=>rainfallSubset(grib({parameter:38}),'2023-06-26T00:00:00Z'),/product/);
  assert.throws(()=>rainfallSubset(grib(),'2023-06-26T01:00:00Z'),/time/);
  const png=encodeRgba(2,1,Buffer.from([0,0,0,0,255,30,1,255]));assert.equal(decodePng(png).pixels[4],255);
  png[40]^=1;assert.throws(()=>decodePng(png),/checksum/);
});
test('station subsets retain trace, blank and source-specific quality information',()=>{
  const header='STATION|DATE|LATITUDE|LONGITUDE|temperature|temperature_Quality_Code|wind_speed|wind_speed_Quality_Code|precipitation|precipitation_Measurement_Code';
  const rows=['USW00013893|2023-11-05T06:54:00|35.05|-89.98||9|0.0|1|0.0|T','USW00013893|2023-11-05T07:54:00|35.05|-89.98|12.0|1||9||'];
  const data=stationSubset(Buffer.from([header,...rows].join('\n')),'2023-11-05T06:00:00Z','2023-11-05T08:00:00Z');
  assert.equal(data.rows.length,2);assert.equal(data.rows[0].temperature,'');assert.equal(data.rows[0].precipitation_Measurement_Code,'T');
  assert.equal(data.rows[1].DATE,'2023-11-05T07:54:00.000Z');assert.equal(data.coverage.hoursWithReports,2);
  assert.throws(()=>stationSubset(Buffer.from('temperature\n12'),'2023-06-25T00:00:00Z','2023-06-26T00:00:00Z'),/lacks timestamps/);
});
test('warning timestamps are validated and empty collections remain distinct from source failure',()=>{
  const empty=warningSubset(Buffer.from('{"type":"FeatureCollection","features":[]}'),'2023-06-25T23:00:00Z');assert.equal(empty.collection.features.length,0);
  const bad={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon'},properties:{issue:'2023-06-26T00:00:00Z',expire:'2023-06-26T01:00:00Z'}}]};
  assert.throws(()=>warningSubset(Buffer.from(JSON.stringify(bad)),'2023-06-25T23:00:00Z'),/outside/);
});

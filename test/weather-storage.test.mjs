import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {readWeatherObject} from '../src/weather/objects.mjs';
const root=()=>mkdtempSync(join(tmpdir(),'mlgw-weather-storage-'));
const options={limits:{minimumFreeBytes:0,maxResponseBytes:65536,cacheBytes:2000000},fetchImpl:async()=>assert.fail('offline migration must not fetch')};
function legacy(cache,text,{revision=false,product='station'}={}) {
  const bytes=Buffer.from(text),request=sourceRequest(product,'2026-01-01T00:00:00Z');
  const manifest={id:sha256(Buffer.from(JSON.stringify(request))),request,availability:'retrieved',body:{sha256:sha256(bytes),bytes:bytes.length}};
  cache.put(`objects/${manifest.body.sha256}.raw`,bytes);
  const json=Buffer.from(JSON.stringify(manifest));cache.put(`${revision?'revisions/'+sha256(json):'manifests/'+manifest.id}.json`,json);
  return {manifest,bytes};
}
test('migration preserves current and revised originals, hashes and non-station bodies',()=>{
  const cache=new WeatherCache(root(),options);
  try {
    const a=legacy(cache,'original station report\n'.repeat(200),{revision:true}),b=legacy(cache,'revised station report\n'.repeat(200)),radar=legacy(cache,'radar bytes',{product:'radar'});
    const manifestBytes=readFileSync(join(cache.root,'manifests',b.manifest.id+'.json'));
    const before=cache.used,plan=cache.compressStationOriginals();assert.equal(plan.mode,'plan');assert.equal(cache.used,before);assert.equal(plan.objects.length,2);
    assert.equal(readdirSync(join(cache.root,'objects')).filter(n=>n.endsWith('.gz')).length,0);
    const result=cache.compressStationOriginals({apply:true});assert.equal(result.requests,0);assert.ok(result.savedBytes>8000);
    for(const saved of [a,b]) {
      assert.equal(existsSync(join(cache.root,'objects',saved.manifest.body.sha256+'.raw')),false);
      assert.deepEqual(cache.readBody(saved.manifest),saved.bytes);
    }
    assert.deepEqual(cache.readBody(radar.manifest),radar.bytes);assert.equal(existsSync(join(cache.root,'objects',radar.manifest.body.sha256+'.raw')),true);
    assert.deepEqual(readFileSync(join(cache.root,'manifests',b.manifest.id+'.json')),manifestBytes);
    const repeat=cache.compressStationOriginals({apply:true});assert.equal(repeat.removedRawBytes,0);assert.equal(repeat.savedBytes,0);
  }finally{cache.close();}
});
test('an interrupted migration retains the raw copy and safely resumes in a new process',()=>{
  const dir=root();let cache=new WeatherCache(dir,options);const saved=legacy(cache,'station history\n'.repeat(400));
  const put=cache.put.bind(cache);
  cache.put=(key,bytes)=>{put(key,bytes);if(key.endsWith('.raw.gz'))throw Error('simulated interruption after atomic gzip write');};
  assert.throws(()=>cache.compressStationOriginals({apply:true}),/simulated interruption/);
  assert.equal(existsSync(join(dir,'objects',saved.manifest.body.sha256+'.raw')),true);cache.close();
  cache=new WeatherCache(dir,options);
  try{assert.equal(cache.compressStationOriginals({apply:true}).objects[0].rawRemoved,true);assert.deepEqual(cache.readBody(saved.manifest),saved.bytes);}finally{cache.close();}
});
test('corrupt compressed data fails closed and never causes deletion of a valid raw copy',()=>{
  const cache=new WeatherCache(root(),options);
  try {
    const saved=legacy(cache,'preserved station data\n'.repeat(100)),file=join(cache.root,'objects',saved.manifest.body.sha256+'.raw.gz');
    writeFileSync(file,'corrupt');
    assert.throws(()=>cache.readBody(saved.manifest));
    assert.throws(()=>cache.compressStationOriginals({apply:true}));
    assert.deepEqual(readFileSync(join(cache.root,'objects',saved.manifest.body.sha256+'.raw')),saved.bytes);
  }finally{cache.close();}
});
test('pressure stops compression before raw cleanup; decompression is bounded by original size',()=>{
  const cache=new WeatherCache(root(),options);
  try {
    const saved=legacy(cache,'station preserved\n'.repeat(100));cache.limits.cacheBytes=cache.used+1;
    assert.throws(()=>cache.compressStationOriginals({apply:true}),/budget/);assert.deepEqual(cache.readBody(saved.manifest),saved.bytes);
    const expansion=Buffer.alloc(10000,65),hash=sha256(expansion);writeFileSync(join(cache.root,'objects',hash+'.raw.gz'),gzipSync(expansion));
    assert.throws(()=>readWeatherObject(cache.root,{body:{sha256:hash,bytes:10000}},{maxBytes:9999}),/limit/);
    assert.throws(()=>readWeatherObject(cache.root,{body:{sha256:hash,bytes:10}},{maxBytes:65536}),/larger|length|size|limit/i);
    assert.throws(()=>readWeatherObject(cache.root,{body:{sha256:'../escape',bytes:10}},{maxBytes:65536}),/invalid/);
  }finally{cache.close();}
});
test('new station downloads use gzip while offline reads retain original identity and byte counts',async()=>{
  const bytes=Buffer.from('station report\n'.repeat(300));let calls=0;
  const cache=new WeatherCache(root(),{...options,fetchImpl:async()=>{calls++;return new Response(bytes);}});
  try {
    const request=sourceRequest('station','2026-01-01T00:00:00Z'),m=await cache.acquire(request);
    assert.equal(m.availability,'retrieved');assert.equal(m.body.sha256,sha256(bytes));assert.equal(m.body.bytes,bytes.length);
    assert.deepEqual(readdirSync(join(cache.root,'objects')),[m.body.sha256+'.raw.gz']);
    assert.deepEqual(cache.readBody(await cache.acquire(request,{offline:true})),bytes);assert.equal(calls,1);
  }finally{cache.close();}
});
test('migration reuses a verified gzip representation from a different compression level',()=>{
  const cache=new WeatherCache(root(),options);
  try {
    const saved=legacy(cache,'station report with repeated measurements\n'.repeat(400)),gzip=gzipSync(saved.bytes,{level:1});
    const path=join(cache.root,'objects',saved.manifest.body.sha256+'.raw.gz');writeFileSync(path,gzip);cache.used+=gzip.length;
    const r=cache.compressStationOriginals({apply:true});assert.equal(r.objects[0].compressedBytes,gzip.length);
    assert.deepEqual(readFileSync(path),gzip);assert.deepEqual(cache.readBody(saved.manifest),saved.bytes);
  }finally{cache.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildBundle,downloadBundle,restoreBundle,verifyBundle,createReceipt,cleanupEligibility,protectedYearCutoff,storageForecast,httpsRangeReader,hash} from '../src/durable/transfer.mjs';
const DAY=86400000,secret=Buffer.alloc(32,7);
function fixture(t,{large=false}={}) {
  const root=mkdtempSync(join(tmpdir(),'archive-transfer-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=join(root,'source'),destination=join(root,'desktop');
  const raw=large?randomBytes(2*1024*1024):Buffer.from('source'),body=gzipSync(raw),key=`objects/${hash(raw)}.gz`,parser=Buffer.from('export const version=1;'),parserKey=`parsers/parser-${hash(parser)}.mjs`;
  const m={record:{id:'capture',observedAt:'2022-01-01T12:00:00Z'},bodies:{feed:{key,hash:hash(raw),bytes:raw.length}},parserKey,parserHash:hash(parser)};
  const f=[{key,bytes:body},{key:parserKey,bytes:parser},{key:'manifests/capture.json',bytes:Buffer.from(JSON.stringify(m))}];
  const result=buildBundle(source,{partition:'2022-01-01',observations:[{id:'capture',observedAt:m.record.observedAt}],files:f});
  return {...result,root,source,destination,key,readRange:async(k,o,n)=>readFileSync(join(source,k)).subarray(o,o+n)};
}
test('calendar-year cutoff clamps leap day and preserves exact instant',()=>{
  assert.equal(new Date(protectedYearCutoff(Date.parse('2024-02-29T12:34:56Z'))).toISOString(),'2023-02-28T12:34:56.000Z');
  assert.equal(new Date(protectedYearCutoff(Date.parse('2025-03-01T00:00:00Z'))).toISOString(),'2024-03-01T00:00:00.000Z');
});
test('offline headroom includes storm growth, seven-day grace and staging',()=>{
  const p=storageForecast({usedBytes:10,budgetBytes:1000,dailyGrowthBytes:1,stormDailyBytes:30,stagingBytes:40});
  assert.equal(p.reserveBytes,1150);assert.equal(p.status,'urgent');assert.equal(p.protectedYearFits,false);
  assert.throws(()=>storageForecast({usedBytes:0,budgetBytes:100,otherAccountBytes:101,dailyGrowthBytes:0,stormDailyBytes:0}),/budget/);
});
test('partial downloads resume, verify content and produce an idempotent restore',async t=>{
  const f=fixture(t,{large:true});let reads=0;
  await assert.rejects(downloadBundle({...f,minimumFreeBytes:0,readRange:async(...args)=>{if(++reads===2)throw Error('offline');return f.readRange(...args);}}),/offline/);
  assert.equal(existsSync(join(f.destination,f.id+'.manifest.json')),false);
  let firstOffset;await downloadBundle({...f,minimumFreeBytes:0,readRange:async(k,o,n)=>{firstOffset??=o;return f.readRange(k,o,n);}});assert.equal(firstOffset,1024*1024);
  assert.equal(verifyBundle(f.destination,f.manifest,f.id).size,3);
  const restored=join(f.root,'restored');restoreBundle(f.destination,f.manifest,f.id,restored);restoreBundle(f.destination,f.manifest,f.id,restored);
  assert.deepEqual(readFileSync(join(restored,f.key)),verifyBundle(f.destination,f.manifest,f.id).get(f.key));
  assert.ok(existsSync(join(f.destination,'catalog.sqlite')));
  await downloadBundle({...f,minimumFreeBytes:0,readRange:()=>{throw Error('duplicate transfer must not download');}});
});
test('full disk, corrupted parts and changed manifests cannot produce receipts',async t=>{
  const f=fixture(t);await assert.rejects(downloadBundle({...f,freeBytes:0,minimumFreeBytes:1}),/free-space/);
  await downloadBundle({...f,minimumFreeBytes:0});const p=join(f.destination,f.manifest.parts[0].key),bytes=readFileSync(p);bytes[10]^=1;writeFileSync(p,bytes);
  assert.throws(()=>createReceipt(f.destination,f.manifest,f.id,secret),/checksum/);
  assert.throws(()=>verifyBundle(f.source,{...f.manifest,partition:'2021-01-01'},f.id),/checksum/);
});
test('cleanup requires authenticated second verification, grace, restore and protected references',async t=>{
  const f=fixture(t);await downloadBundle({...f,minimumFreeBytes:0});const now=Date.parse('2026-01-01T00:00:00Z');
  const first=createReceipt(f.destination,f.manifest,f.id,secret,{now:now-8*DAY}),second=createReceipt(f.destination,f.manifest,f.id,secret,{now});
  const args={...f,first,second,firstReceivedAt:now-8*DAY,secondReceivedAt:now,secret,now,protectedKeys:new Set(),restoreVerified:true};
  assert.deepEqual(cleanupEligibility(args).deleteKeys,[f.key]);assert.equal(cleanupEligibility(args).executable,false);
  assert.deepEqual(cleanupEligibility({...args,protectedKeys:new Set([f.key])}).deleteKeys,[]);
  assert.throws(()=>cleanupEligibility({...args,second:first}),/second verification/);
  assert.throws(()=>cleanupEligibility({...args,firstReceivedAt:now-DAY}),/grace/);
  assert.throws(()=>cleanupEligibility({...args,restoreVerified:false}),/restore/);
  assert.throws(()=>cleanupEligibility({...args,secret:Buffer.alloc(32,1)}),/authentication/);
  const young=Date.parse('2023-01-01T12:00:00Z');assert.throws(()=>cleanupEligibility({...args,now:young,firstReceivedAt:young-8*DAY,secondReceivedAt:young}),/calendar year/);
});
test('unsafe keys and duplicate observation identities are rejected',t=>{
  const f=fixture(t);assert.throws(()=>buildBundle(f.source,{partition:'2022-01-01',observations:f.manifest.observations,files:[{key:'../escape',bytes:Buffer.from('x')}]}),/Invalid/);
  assert.throws(()=>buildBundle(f.source,{partition:'2022-01-01',observations:[...f.manifest.observations,...f.manifest.observations],files:[]}),/observations/);
});
test('HTTPS transfer requires exact ranges and does not follow redirects',async()=>{
  const key='a'.repeat(64)+'.part.gz';let request;
  const reader=httpsRangeReader('https://archive.example/parts/','x'.repeat(32),{fetchImpl:async(url,options)=>{request=options;return new Response(Buffer.from('abc'),{status:206,headers:{'content-range':'bytes 2-4/5'}});}});
  assert.equal((await reader(key,2,3)).toString(),'abc');assert.equal(request.redirect,'error');assert.equal(request.headers.Range,'bytes=2-4');
  const bad=httpsRangeReader('https://archive.example/parts/','x'.repeat(32),{fetchImpl:async()=>new Response('full file',{status:200})});await assert.rejects(bad(key,2,3),/exact range/);
  assert.throws(()=>httpsRangeReader('http://archive.example/','x'.repeat(32)),/HTTPS/);
});

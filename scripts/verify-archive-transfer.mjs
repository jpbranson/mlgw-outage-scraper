// A real captured UTC date, copied through range downloads and restored in an isolated directory.
import {readFileSync,mkdtempSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {Archive} from '../src/durable/archive.mjs';
import {LocalCollector} from '../src/durable/collector.mjs';
import {buildBundle,downloadBundle,verifyBundle,restoreBundle,createReceipt,storageForecast} from '../src/durable/transfer.mjs';
const scratch=mkdtempSync(join(tmpdir(),'mlgw-transfer-')),source=new Archive('data/collector/archive',{readOnly:true});
const manifests=source.manifests().map(k=>({key:k,...source.readManifest(k)}));
const date=manifests.map(m=>(m.manifest.record.feed?.receivedAt??m.manifest.record.observedAt).slice(0,10)).sort()[0];
const selected=manifests.filter(m=>(m.manifest.record.feed?.receivedAt??m.manifest.record.observedAt).slice(0,10)===date),files=new Map(),observations=[];
for(const {key,manifest:m} of selected) {
  const at=m.record.feed?.receivedAt??m.record.observedAt;observations.push({id:m.record.id,observedAt:at});
  for(const k of [key,m.parserKey,...Object.values(m.bodies).map(b=>b.key)])files.set(k,readFileSync(source.path(k)));
  if(m.bodies.feed){const parser=await source.parser(m),parsed=parser.parseFeed(source.readBody(m.bodies.feed).toString('utf8'));
    files.set(`normalized/${m.record.id}.json`,Buffer.from(JSON.stringify({id:m.record.id,observedAt:at,parserVersion:m.parserVersion,parserHash:m.parserHash,...parsed})));}
}
const server=join(scratch,'server'),desktop=join(scratch,'desktop'),restoredRoot=join(scratch,'restored');
const {id,manifest}=buildBundle(server,{partition:date,observations,files:[...files].map(([key,bytes])=>({key,bytes}))});
let ranges=0;const readRange=async(key,offset,length)=>{ranges++;return readFileSync(join(server,key)).subarray(offset,offset+length);};
const downloaded=await downloadBundle({manifest,id,destination:desktop,readRange});
restoreBundle(desktop,manifest,id,restoredRoot);
const restored=new LocalCollector(join(scratch,'index'),{archive:new Archive(restoredRoot)});const recovered=await restored.recover();
let replayed=0;for(const row of restored.db.prepare('SELECT id FROM snapshots').all()){
  const actual=await restored.replaySnapshot(row.id),expected=JSON.parse(files.get(`normalized/${row.id}.json`));assert.deepEqual(actual.normalized,expected.normalized);assert.deepEqual(actual.totals,expected.totals);replayed++;
}
restored.close();const secret=randomBytes(32);const receipt=createReceipt(desktop,manifest,id,secret);
assert.equal(receipt.body.objects.length,verifyBundle(desktop,manifest,id).size);
const before=ranges;await downloadBundle({manifest,id,destination:desktop,readRange});assert.equal(ranges,before);
const report={checkedAt:new Date().toISOString(),scratch,partition:date,manifestId:id,observations:observations.length,files:downloaded.verifiedFiles,parts:manifest.parts.length,
  compressedBytes:manifest.parts.reduce((s,p)=>s+p.bytes,0),rangeRequests:ranges,recovered:recovered.length,replayed,duplicateDownloadRequests:ranges-before,receiptVerified:true,
  forecastExample:storageForecast({usedBytes:700_000_000,budgetBytes:10_000_000_000,dailyGrowthBytes:4_000_000,stormDailyBytes:12_000_000,stagingBytes:100_000_000}),
  cloudDeleted:false,productionDeployment:false,passed:true};
writeFileSync('reports/archive-transfer-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

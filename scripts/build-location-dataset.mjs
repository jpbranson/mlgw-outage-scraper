import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { Archive } from '../src/durable/archive.mjs';
import { buildLocationDataset, summarizeLocationDataset, exportLocationGeoJSON } from '../src/analysis/location-dataset.mjs';

const through=process.argv[2]?Date.parse(process.argv[2]):Date.now();
if(!Number.isFinite(through)) throw new Error('Usage: node scripts/build-location-dataset.mjs [through-ISO] [output-directory]');
const root=resolve('data/collector');
const output=resolve(process.argv[3]??`data/derived/locations-${new Date(through).toISOString().replace(/[:.]/g,'-')}`);
const child=relative(root,output);
if(!child || (!child.startsWith('..')&&!isAbsolute(child))) throw new Error('Output must be outside the collector directory');
const target=join(output,'locations.sqlite');
if(existsSync(target)) throw new Error('Output database already exists; choose a new output directory');
const source=new DatabaseSync(join(root,'index.sqlite'),{readOnly:true,timeout:5000});
source.exec('BEGIN;');
const rows=source.prepare(`SELECT s.*,a.manifest_key,a.manifest_hash,t.customers,t.outages FROM snapshots s
  JOIN poll_attempts a ON a.id=s.id JOIN totals t ON t.snapshot_id=s.id
  WHERE s.quality='valid' AND s.captured_ms<=? ORDER BY s.captured_ms`).all(through);
const badTimes=source.prepare("SELECT received_ms FROM poll_attempts WHERE received_ms<=? AND outcome NOT IN ('valid','duplicate_slot') ORDER BY received_ms").all(through).map(r=>r.received_ms);
source.exec('COMMIT;');source.close();
if(!rows.length) throw new Error('No accepted captures at the requested cutoff');
const archive=new Archive(join(root,'archive'),{readOnly:true}),captures=[];
const started=performance.now();
for(const [i,row] of rows.entries()){
  const {manifest,hash}=archive.readManifest(row.manifest_key);
  if(hash!==row.manifest_hash || manifest.parserHash!==row.parser_hash || manifest.bodies.feed.hash!==row.raw_hash)
    throw new Error(`Archive disagrees with index: ${row.id}`);
  const parser=await archive.parser(manifest),parsed=parser.parseFeed(archive.readBody(manifest.bodies.feed).toString('utf8'));
  if(!parsed.totalsValid || parsed.totals.customers!==row.customers || parsed.totals.reportedOutages!==row.outages)
    throw new Error(`Replayed totals disagree: ${row.id}`);
  captures.push({id:row.id,at:row.captured_ms,slot:row.slot_ms,customers:row.customers,outages:row.outages,
    features:parsed.normalized.features,rawHash:row.raw_hash,manifestKey:row.manifest_key,manifestHash:row.manifest_hash,parserHash:row.parser_hash,
    comparableToPrevious:i>0&&!badTimes.some(t=>t>rows[i-1].captured_ms&&t<=row.captured_ms)});
}
mkdirSync(output,{recursive:true});
const provenanceDigest=createHash('sha256').update(JSON.stringify(captures.map(c=>[c.id,c.rawHash,c.manifestHash,c.parserHash]))).digest('hex');
const metadata={generatedAt:new Date().toISOString(),through:new Date(through).toISOString(),
  firstCaptureAt:new Date(rows[0].captured_ms).toISOString(),lastCaptureAt:new Date(rows.at(-1).captured_ms).toISOString(),
  provenanceDigest,source:'Hash-verified archived MLGW public GeoJSON and archived parser replay; accepted snapshots only.',
  expectedFiveMinuteSlots:Math.floor(rows.at(-1).slot_ms/300000)-Math.floor(rows[0].slot_ms/300000)+1};
const db=buildLocationDataset(captures,{path:target,metadata});
const summary=summarizeLocationDataset(db),geojson=exportLocationGeoJSON(db);
if(summary.customerTotalsMismatch || summary.histogramObservationMismatch || summary.foreignKeyErrors || summary.integrity!=='ok')
  throw new Error('Derived dataset failed verification');
writeFileSync(join(output,'locations.geojson'),JSON.stringify(geojson)+'\n');
db.close();
const result={...metadata,...summary,seconds:(performance.now()-started)/1000,databaseBytes:statSync(target).size,
  geojsonBytes:statSync(join(output,'locations.geojson')).size};
writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,...result},null,2));

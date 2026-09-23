import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {temperatureHours,temperatureCondition,matchTemperature,temperatureGeography,temperatureText} from '../src/weather/temperature-comparisons.mjs';
import {ComparisonService} from '../src/dashboard/comparisons.mjs';
import {sha256} from '../src/weather/objects.mjs';
const policy=JSON.parse(readFileSync(new URL('../config/weather-reference-policy.json',import.meta.url))),HOUR=3600000;
const from='2022-12-22T00:00:00Z',to='2022-12-25T00:00:00Z',rf='2022-12-15T00:00:00Z',rt='2022-12-18T00:00:00Z';
const hours=(start,value)=>Array.from({length:72},(_,i)=>({from:new Date(Date.parse(start)+i*HOUR).toISOString(),to:new Date(Date.parse(start)+(i+1)*HOUR).toISOString(),minC:value,maxC:value,minimumAt:new Date(Date.parse(start)+(i+.5)*HOUR).toISOString(),maximumAt:new Date(Date.parse(start)+(i+.5)*HOUR).toISOString(),windMs:2,precipitationMm:0,precipitationStatus:'accepted'}));
const rows=start=>Array.from({length:72},(_,i)=>({at:Date.parse(start)+(i+.5)*HOUR,capturedAt:new Date(Date.parse(start)+(i+.5)*HOUR).toISOString(),id:'capture-'+i,customers:i===0?0:100,outages:2}));
const input=()=>({from,to,referenceFrom:rf,referenceTo:rt,rows:rows(from),referenceRows:rows(rf),hours:hours(from,-5),referenceHours:hours(rf,5),family:'winter',lagHours:0});
test('temperature field eligibility retains negatives and excludes future/bad reports',()=>{
  const row=(at,value,status='accepted')=>({at,fields:{temperature:{value,status,eligible:status==='accepted'}}});
  const h=temperatureHours({rows:[row('2022-12-22T00:10:00Z',-5),row('2022-12-22T00:20:00Z',-90,'suspect'),row('2022-12-22T01:00:00Z',3)]},from,to);
  assert.equal(h[0].minC,-5);assert.equal(h[0].maxC,-5);assert.equal(h[1].minC,3);assert.equal(h[2].minC,null);
  assert.equal(temperatureCondition(h[2],'winter'),null);assert.equal(temperatureCondition({minC:0},'winter'),false);assert.equal(temperatureCondition({maxC:32},'heat'),true);
});
test('temperature pairing is backward-only and preserves missing/cold reference exclusions',()=>{
  const a=input();a.referenceHours[1].minC=-1;a.hours[2].minC=null;
  a.referenceHours[3].precipitationStatus='missing-report';const r=matchTemperature(a,policy);assert.equal(r.pairs[0].included,false);assert.equal(r.pairs[1].caseTemperatureC,-5);assert.ok(r.pairs[4].reasons.includes('reference-station-weather-missing'));
  assert.deepEqual(r.pairs[2].reasons,['reference-temperature-reaches-threshold']);assert.deepEqual(r.pairs[3].reasons,['temperature-missing']);
  for(const p of r.pairs.filter(p=>p.included))assert.ok(Date.parse(p.caseExposureTo)<=Date.parse(p.caseFrom));
  const lagged=matchTemperature({...input(),lagHours:3},policy);assert.equal(lagged.includedHours,68);
  assert.throws(()=>matchTemperature({...input(),referenceFrom:'2022-11-01T00:00:00Z'},policy),/pairing/);
});
test('temperature sparse groups remain unavailable and recorded zeros are real observations',()=>{
  const a=input();a.rows=a.rows.slice(0,6);a.rows[1].customers=0;const r=matchTemperature(a,policy);
  assert.equal(r.includedHours,5);assert.equal(r.groups[0].caseMedianCustomers,null);assert.equal(r.pairs[1].caseCapture.customers,0);
});
test('geographic cell absences never become zero and changing geometry is suppressed',()=>{
  const pairs=matchTemperature(input(),policy).pairs.slice(1,3),geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
  const snapshots=[{summary:{id:pairs[0].caseCapture.id},detail:{available:true,geojson:{features:[{geometry,properties:{gridCellId:'A',customers:4}}]}}},
    {summary:{id:pairs[1].caseCapture.id},detail:{available:true,geojson:{features:[]}}}];
  let g=temperatureGeography(snapshots,pairs);assert.equal(g.gridHours,2);assert.equal(g.geojson.features[0].properties.reports,1);assert.equal(g.geojson.features[0].properties.peakCustomers,4);assert.equal(g.geojson.features[0].properties.medianCustomers,null);
  snapshots[1].detail.geojson.features.push({geometry:{...geometry,coordinates:[]},properties:{gridCellId:'A',customers:8}});
  g=temperatureGeography(snapshots,pairs);assert.equal(g.geojson.features[0].geometry,null);assert.equal(g.geojson.features[0].properties.geometryChanged,true);
});
test('temperature publications stay separate, verified and downloadable through bounded comparison routes',t=>{
  const root=mkdtempSync(join(tmpdir(),'temperature-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'conditions'));
  writeFileSync(join(root,'catalog.json'),JSON.stringify({version:'weather-comparison-v1',entries:[]}));
  const d={version:'weather-comparison-v1',analysisVersion:'temperature-comparison-v1',kind:'temperature',id:'cold',from,to,byLag:[{lagHours:0,matches:[{from,temperatureC:-5}]}],matchedReference:{byLag:[{lagHours:0,pairs:matchTemperature(input(),policy).pairs}]}};
  const bytes=Buffer.from(JSON.stringify(d)),hash=sha256(bytes),entry={id:d.id,kind:d.kind,name:'Cold',from,to,path:hash+'.json',sha256:hash,bytes:bytes.length};
  writeFileSync(join(root,'conditions',entry.path),bytes);writeFileSync(join(root,'conditions','catalog.json'),JSON.stringify({version:d.version,analysisVersion:'temperature-comparison-v1',entries:[entry]}));
  const s=new ComparisonService(root),p=new URLSearchParams('id=cold&lag=0');assert.equal(s.catalog().entries.length,1);assert.match(s.csv(p),/temperatureC/);p.set('table','reference');assert.match(s.csv(p),/caseTemperatureC/);
  writeFileSync(join(root,'conditions',entry.path),'broken');assert.throws(()=>s.series(p),/verified/);
});
test('temperature case names and confounder notes come only from the configured episode',()=>{
  const candidates=JSON.parse(readFileSync(new URL('../config/weather-candidates.json',import.meta.url))).candidates,byId=Object.fromEntries(candidates.map(c=>[c.id,c]));
  const heat=temperatureText(byId['heat-2023']),other=temperatureText(byId['heat-june-2022']),cold=temperatureText(byId['cold-2022']);
  assert.equal(heat.name,'June 29–July 1, 2023 · Heat');assert.equal(cold.name,'December 22–24, 2022 · Cold');assert.equal(other.name,'June 13–15, 2022 · Heat');
  assert.match(heat.interpretation.at(-1),/June 25 storm/);for(const t of [other,cold,temperatureText(byId['heat-august-2024'])])assert.ok(t.interpretation.every(x=>!/June 25/.test(x)));
  assert.ok(heat.interpretation.every(x=>!/One independent case/.test(x)));assert.equal(other.interpretation.length,heat.interpretation.length-1);
  assert.throws(()=>temperatureText({...byId['heat-june-2022'],name:undefined}),/name/);assert.throws(()=>temperatureText({...byId['heat-june-2022'],notes:[1]}),/notes/);
  assert.throws(()=>temperatureText({...byId['wind-march-2023']}),/notes/);
  for(const c of candidates)if(['winter','heat'].includes(c.family)&&c.name)assert.doesNotThrow(()=>temperatureText(c));
});

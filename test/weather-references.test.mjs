import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hourlyAnchors, screenReference, referenceCalendar, matchReference } from '../src/weather/references.mjs';
const policy=JSON.parse(readFileSync(new URL('../config/weather-reference-policy.json',import.meta.url)));
const H=3600000,caseFrom='2024-09-12T00:00:00Z',caseTo='2024-09-15T00:00:00Z',referenceFrom='2024-08-22T00:00:00Z',referenceTo='2024-08-25T00:00:00Z';
const capture=(from,h,minute=30,customers=100)=>({at:Date.parse(from)+h*H+minute*60000,id:`${from}-${h}-${minute}`,capturedAt:new Date(Date.parse(from)+h*H+minute*60000).toISOString(),customers,outages:1});
const weather=(from,rain=0,wind=2)=>Array.from({length:72},(_,i)=>({from:new Date(Date.parse(from)+i*H).toISOString(),to:new Date(Date.parse(from)+(i+1)*H).toISOString(),meanMm:rain,
  sustained:{value:wind,at:new Date(Date.parse(from)+(i+.8)*H).toISOString(),acceptedReports:1}}));
const fixture=()=>({caseFrom,caseTo,referenceFrom,referenceTo,caseRows:Array.from({length:72},(_,i)=>capture(caseFrom,i)),referenceRows:Array.from({length:72},(_,i)=>capture(referenceFrom,i,34,10)),
  caseRain:weather(caseFrom),caseWind:weather(caseFrom),referenceRain:weather(referenceFrom),referenceWind:weather(referenceFrom),lagHours:0});
test('reference anchor selection is independent of outage levels, keeps observed zero and resolves time ties earlier',()=>{
  const rows=[capture(caseFrom,0,14,9000),capture(caseFrom,0,29,0),capture(caseFrom,0,31,100000),capture(caseFrom,1,45,2)];
  const anchors=hourlyAnchors(rows,caseFrom,caseTo,policy);assert.equal(anchors[0].customers,0);assert.equal(anchors[1].customers,2);assert.equal(anchors[2],null);
  const poison=rows.map(({at,id})=>({at,id,get customers(){throw Error('Outcome read during selection');},get outages(){throw Error('Outcome read during selection');}}));
  assert.deepEqual(hourlyAnchors(poison,caseFrom,caseTo,policy).map(r=>r?.id??null),anchors.map(r=>r?.id??null));
  assert.throws(()=>hourlyAnchors([rows[1],rows[1]],caseFrom,caseTo,policy),/timestamps/);
});
test('reference screening rejects station rain, trace, high wind, missing coverage and DST mismatches',()=>{
  const f=fixture(),station={summary:{wind_speed:{max:2,hoursWithAcceptedReports:72}},hourlyPrecipitation:Array.from({length:72},()=>({status:'accepted',value:0}))};
  const input={caseFrom,caseAnchors:hourlyAnchors(f.caseRows,caseFrom,caseTo,policy),from:referenceFrom,to:referenceTo,rows:f.referenceRows,station};
  assert.equal(screenReference(input,policy).eligible,true);
  station.hourlyPrecipitation[0]={status:'trace',value:null};assert.equal(screenReference(input,policy).eligible,false);
  station.hourlyPrecipitation[0]={status:'accepted',value:.1};assert.equal(screenReference(input,policy).eligible,false);
  station.hourlyPrecipitation[0]={status:'accepted',value:0};station.summary.wind_speed.max=10;assert.equal(screenReference(input,policy).eligible,false);
  station.summary.wind_speed.max=2;station.summary.wind_speed.hoursWithAcceptedReports=64;assert.equal(screenReference(input,policy).eligible,false);
  assert.equal(referenceCalendar('2024-03-16T00:00:00Z','2024-03-09T00:00:00Z',policy),false);
});
test('reference pairing uses the same clock-hour mask at every lag and never future weather',()=>{
  const f=fixture();f.referenceRain[0].meanMm=.1;f.referenceWind[2].sustained.value=10;f.caseRain[3].meanMm=null;
  for(const lagHours of [0,1,3]) {
    const r=matchReference({...f,lagHours},policy);assert.equal(r.pairs.length,72);
    for(let i=0;i<72;i++){const p=r.pairs[i],k=i-1-lagHours;if(k<0){assert.equal(p.included,false);assert.ok(p.reasons.includes('weather-missing'));}else {
      assert.equal(p.referenceRainMm,f.referenceRain[k].meanMm);assert.ok(Date.parse(p.caseExposureTo)<=Date.parse(p.caseFrom));assert.ok(Date.parse(p.referenceExposureTo)<=Date.parse(p.referenceFrom));
      assert.ok(Date.parse(p.caseWindReportAt)<p.caseCapture.at);assert.ok(Date.parse(p.referenceWindReportAt)<p.referenceCapture.at);
    }}
    assert.ok(r.pairs[1+lagHours].reasons.includes('reference-rain-at-or-above-threshold'));
    assert.ok(r.pairs[3+lagHours].reasons.includes('reference-wind-at-or-above-threshold'));
    assert.ok(r.pairs[4+lagHours].reasons.includes('weather-missing'));
    assert.equal(r.includedHours+r.excludedHours,72);
  }
});
test('reference pairing does not replace a missing/poorly aligned anchor with a favorable observation',()=>{
  const f=fixture();f.caseRows[1]=capture(caseFrom,1,14,9000);f.referenceRows[2]=capture(referenceFrom,2,41,0);f.referenceRows[3]=capture(referenceFrom,3,30,0);
  const r=matchReference(f,policy);assert.equal(r.pairs[1].caseCapture,null);assert.equal(r.pairs[1].included,false);
  assert.equal(r.pairs[2].included,false);assert.ok(r.pairs[2].reasons.includes('capture-times-differ-over-10-minutes'));
  assert.equal(r.pairs[3].included,true);assert.equal(r.pairs[3].referenceCapture.customers,0);
});
test('reference group medians use identical six-pair sets and retain sparse groups as null',()=>{
  const f=fixture(),caseValues=[0,0,100,200,300,400],refValues=[5,20,30,40,50,500];
  for(let i=0;i<6;i++){f.caseRain[i].meanMm=1;f.caseRows[i+1].customers=caseValues[i];f.referenceRows[i+1].customers=refValues[i];}
  let group=matchReference(f,policy).groups.find(g=>g.id==='rain');
  assert.equal(group.pairs,6);assert.equal(group.caseMedianCustomers,150);assert.equal(group.referenceMedianCustomers,35);assert.equal(group.medianPairedDifference,32.5);
  f.referenceRain[0].meanMm=.2;group=matchReference(f,policy).groups.find(g=>g.id==='rain');assert.equal(group.pairs,5);assert.equal(group.caseMedianCustomers,null);assert.equal(group.referenceMedianCustomers,null);
});
test('reference matching rejects unaligned weather, future station reports, unsupported lags and calendars',()=>{
  const f=fixture();assert.throws(()=>matchReference({...f,lagHours:2},policy),/lag/);
  assert.throws(()=>matchReference({...f,referenceFrom:'2024-08-23T00:00:00Z'},policy),/calendar/);
  const shifted=structuredClone(f);shifted.referenceRain[0].to=shifted.referenceRain[1].to;assert.throws(()=>matchReference(shifted,policy),/interval/);
  const future=structuredClone(f);future.referenceWind[0].sustained.at=future.referenceWind[0].to;assert.throws(()=>matchReference(future,policy),/outside/);
});
test('every comparison episode has a 72-hour, calendar-matched reference rainfall window from the fixed offsets',()=>{
  const config=JSON.parse(readFileSync(new URL('../config/weather-comparisons.json',import.meta.url)));
  for(const e of config.episodes) {
    const id=/^reports\/(rainfall-[a-z0-9-]+)-validation\.json$/.exec(e.referenceRainfallReport)[1],r=JSON.parse(readFileSync(new URL(`../config/${id}.json`,import.meta.url)));
    assert.equal(r.reportId,id);assert.equal(Date.parse(r.to)-Date.parse(r.from),72*H);assert.deepEqual(r.periodHours,[72]);
    assert.ok(policy.candidateDaysBefore.includes((Date.parse(e.from)-Date.parse(r.from))/(24*H)),e.id);assert.equal(referenceCalendar(e.from,r.from,policy),true);
  }
});

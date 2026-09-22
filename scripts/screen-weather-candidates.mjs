// Offline, outcome-blind eligibility screen. Retains failures rather than relaxing policy.
import {readFileSync,writeFileSync} from 'node:fs';
import {LegacyService} from '../src/dashboard/legacy.mjs';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {sourceRequest,HOUR} from '../src/weather/sources.mjs';
import {stationSubset} from '../src/weather/decode.mjs';
import {stationQuality} from '../src/weather/station-quality.mjs';
import {hourlyAnchors,screenReference} from '../src/weather/references.mjs';
import {stormEventArchive,stormEventWindow} from '../src/weather/event-context.mjs';

if(process.argv.length!==2)throw Error('Usage: node scripts/screen-weather-candidates.mjs (offline)');
const bytes=readFileSync('config/weather-candidates.json'),config=JSON.parse(bytes);
const policy=JSON.parse(readFileSync('config/weather-reference-policy.json'));
const legacy=new LegacyService('data/legacy/dashboard'),cache=new WeatherCache('data/weather/cache');
const timestamps=(from,to)=>legacy.rows(Date.parse(from),Date.parse(to)).map(({at,gridCaptureKey})=>({at,gridCaptureKey}));
const sources=new Map(),annuals=new Map(),cases=[];
try {
  for(const episode of config.candidates) {
    const {from,to}=episode,start=Date.parse(from),end=Date.parse(to),year=from.slice(0,4);
    if(end-start!==72*HOUR)throw Error('Candidate must contain 72 hours');
    if(!sources.has(year)) {const m=await cache.acquire(sourceRequest('station',from),{offline:true});sources.set(year,m.availability==='retrieved'?{manifest:m,raw:cache.readBody(m)}:null);}
    if(!annuals.has(year)) {const m=await cache.acquire(sourceRequest('storm-events',from),{offline:true});annuals.set(year,m.availability==='retrieved'?{manifest:m,archive:stormEventArchive(cache.readBody(m),m.request)}:null);}
    const source=sources.get(year),rows=timestamps(from,to),anchors=hourlyAnchors(rows,from,to,policy);
    const station=source?stationQuality(stationSubset(source.raw,from,to)):null;
    const references=source?policy.candidateDaysBefore.map(days=>{
      const a=new Date(start-days*24*HOUR).toISOString(),b=new Date(end-days*24*HOUR).toISOString();
      return screenReference({caseFrom:from,caseAnchors:anchors,from:a,to:b,rows:timestamps(a,b),station:stationQuality(stationSubset(source.raw,a,b))},policy);
    }):[];
    const events=annuals.get(year),context=events?stormEventWindow(events.archive,from,to):null;
    const anchorHours=anchors.filter(Boolean).length,temperatureHours=station?.summary.temperature.hoursWithAcceptedReports??0;
    const reasons=[];
    if(anchorHours<48)reasons.push('fewer than 48 hourly capture anchors');
    if((episode.family==='rain-wind'?station?.summary.wind_speed.hoursWithAcceptedReports??0:temperatureHours)/72<.9)reasons.push('relevant station coverage below 90%');
    if(episode.family==='rain-wind'&&!references.some(r=>r.eligible))reasons.push('no eligible unchanged-policy reference');
    if(episode.family!=='rain-wind'&&!context?.records.length)reasons.push('no finalized Shelby event context in selected window');
    const item={...episode,observations:rows.length,anchorHours,gridSnapshots:rows.filter(r=>r.gridCaptureKey).length,
      temperatureHours,stationSummary:station?.summary??null,stationSource:source?{id:source.manifest.id,sha256:source.manifest.body.sha256}:null,
      events:context?.records.map(({eventId,eventType,beginsAt,endsAt})=>({eventId,eventType,beginsAt,endsAt}))??[],
      eventSource:events?{id:events.manifest.id,sha256:events.manifest.body.sha256}:null,
      references,selectedReference:references.find(r=>r.eligible)??null,eligible:!reasons.length,reasons};
    cases.push(item);console.log(JSON.stringify({id:item.id,eligible:item.eligible,anchors:anchorHours,grid:item.gridSnapshots,events:item.events.map(e=>e.eventType),reference:item.selectedReference?.from,reasons}));
  }
  writeFileSync('reports/weather-candidate-screen.json',JSON.stringify({version:config.version,selection:config.selection,configSha256:sha256(bytes),legacyIndex:JSON.parse(readFileSync('data/legacy/dashboard/catalog.json')).index,cases,requests:cache.requests},null,2));
}finally{cache.close();legacy.close();}

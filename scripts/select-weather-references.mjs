// Deterministic screening; outage VALUES never participate in date selection.
import { readFileSync, writeFileSync } from 'node:fs';
import { LegacyService } from '../src/dashboard/legacy.mjs';
import { WeatherCache, sha256 } from '../src/weather/cache.mjs';
import { sourceRequest, HOUR } from '../src/weather/sources.mjs';
import { stationSubset } from '../src/weather/decode.mjs';
import { stationQuality } from '../src/weather/station-quality.mjs';
import { hourlyAnchors, screenReference, validateReferencePolicy, REFERENCE_VERSION } from '../src/weather/references.mjs';
if(process.argv.length!==2)throw Error('Usage: node scripts/select-weather-references.mjs (offline only)');
const policyBytes=readFileSync('config/weather-reference-policy.json'),policy=JSON.parse(policyBytes);validateReferencePolicy(policy);
const config=JSON.parse(readFileSync('config/weather-comparisons.json')),legacy=new LegacyService('data/legacy/dashboard');
const catalog=JSON.parse(readFileSync('data/legacy/dashboard/catalog.json')),cache=new WeatherCache('data/weather/cache',{fetchImpl:async()=>{throw Error('Reference selection is offline');}});
try {
  const report={version:REFERENCE_VERSION,policy,policySha256:sha256(policyBytes),legacyIndex:catalog.index,cases:[],selection:'Nearest eligible earlier same-weekday period from 7/14/21/28 days. Only timestamps, calendar and source-QC station weather determine eligibility. Outage counts are never ranked or screened.'};
  for(const episode of config.episodes) {
    const start=Date.parse(episode.from),end=Date.parse(episode.to),caseAnchors=hourlyAnchors(legacy.rows(start,end),episode.from,episode.to,policy);
    const manifest=await cache.acquire(sourceRequest('station',episode.from),{offline:true});if(manifest.availability!=='retrieved')throw Error('Station source unavailable');
    const raw=cache.readBody(manifest),candidates=[];
    for(const days of policy.candidateDaysBefore) {
      const from=new Date(start-days*24*HOUR).toISOString(),to=new Date(end-days*24*HOUR).toISOString();
      const station=stationQuality(stationSubset(raw,from,to)),derived=cache.derived(manifest,station);
      candidates.push({...screenReference({caseFrom:episode.from,caseAnchors,from,to,rows:legacy.rows(Date.parse(from),Date.parse(to)),station},policy),stationDerived:derived});
    }
    const selected=candidates.find(c=>c.eligible)??null;
    report.cases.push({id:episode.id,caseFrom:episode.from,caseTo:episode.to,caseAnchorHours:caseAnchors.filter(Boolean).length,
      stationSource:{id:manifest.id,sha256:manifest.body.sha256},candidates,selected});
    console.log(JSON.stringify({id:episode.id,selected,candidates:candidates.map(({from,eligible,reasons})=>({from,eligible,reasons}))}));
  }
  writeFileSync('reports/weather-reference-selection.json',JSON.stringify(report,null,2));
  if(report.cases.some(c=>!c.selected))throw Error('No eligible reference for one or more cases; no weather dates selected');
}finally{cache.close();legacy.close();}

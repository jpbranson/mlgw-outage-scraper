// Offline publication of a small, fixed set of bounded, reproducible case studies.
import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WeatherCache, sha256 } from '../src/weather/cache.mjs';
import { BBOX, sourceRequest } from '../src/weather/sources.mjs';
import { stationSubset } from '../src/weather/decode.mjs';
import { stationQuality } from '../src/weather/station-quality.mjs';
import { compareEpisode, summarizeWeather, outageHours, validateComparisonPlan, COMPARISON_VERSION } from '../src/weather/comparisons.mjs';
import { matchReference, validateReferencePolicy } from '../src/weather/references.mjs';
import { LegacyService } from '../src/dashboard/legacy.mjs';
import { WeatherService } from '../src/dashboard/weather.mjs';

if(process.argv.length!==2)throw Error('Usage: node scripts/prepare-weather-comparisons.mjs (offline only)');
const configBytes=readFileSync('config/weather-comparisons.json'), config=JSON.parse(configBytes);
validateComparisonPlan(config);
const root='data/comparisons', cacheRoot='data/weather/cache', legacyRoot='data/legacy/dashboard';
const legacyCatalogBytes=readFileSync(join(legacyRoot,'catalog.json')),legacyCatalog=JSON.parse(legacyCatalogBytes);
const policyBytes=readFileSync(config.referencePolicy),policy=JSON.parse(policyBytes);validateReferencePolicy(policy);
const selectionBytes=readFileSync(config.referenceSelection),selection=JSON.parse(selectionBytes);
if(selection.policySha256!==sha256(policyBytes)||selection.legacyIndex.sha256!==legacyCatalog.index.sha256)throw Error('Re-run reference selection for these inputs');
const legacy=new LegacyService(legacyRoot),weather=new WeatherService(cacheRoot);
const cache=new WeatherCache(cacheRoot,{fetchImpl:async()=>{throw Error('Comparison preparation is offline');}});
const eventReport=JSON.parse(readFileSync('reports/event-context-validation.json'));
const tracked=[];
function verified(path, hash, bytes) {
  if(statSync(path).size>20*1024*1024)throw Error('Comparison input size limit');
  const data=readFileSync(path);if(sha256(data)!==hash||(bytes!==undefined&&data.length!==bytes))throw Error('Comparison input checksum mismatch');
  tracked.push({path,hash});return JSON.parse(data);
}
function derived(ref) {
  if(!/^derived\/[a-f0-9]{64}\.json$/.test(ref.key)||ref.key!==`derived/${ref.sha256}.json`)throw Error('Invalid comparison derived reference');
  return verified(join(cacheRoot,ref.key),ref.sha256,ref.bytes);
}
function original(id,hash) {
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid comparison source ID');
  const m=JSON.parse(readFileSync(join(cacheRoot,'manifests',id+'.json')));
  if(m.id!==id||sha256(Buffer.from(JSON.stringify(m.request)))!==id||m.body.sha256!==hash)throw Error('Comparison source revision mismatch');
  cache.readBody(m);return m;
}
function publish(data) {
  const bytes=Buffer.from(JSON.stringify(data)),hash=sha256(bytes),path=hash+'.json';
  if(bytes.length>12*1024*1024)throw Error('Comparison publication size limit');
  writeFileSync(join(root,path+'.tmp'),bytes);renameSync(join(root,path+'.tmp'),join(root,path));
  return {path,sha256:hash,bytes:bytes.length};
}
function readFrames(report,from,to) {
  if(Date.parse(report.config.from)!==Date.parse(from)||Date.parse(report.config.to)!==Date.parse(to)||!report.faultChecks?.length||report.faultChecks.some(c=>!c.passed))throw Error('Validate rainfall period first');
  return report.inputs.map(i=>{
    if(i.availability!=='available')return {validAt:i.validAt,availability:i.availability};
    const d=derived(i.derived),m=original(i.manifestId,i.sourceSha256);
    if(JSON.stringify(m.request)!==JSON.stringify(sourceRequest('rainfall',i.validAt))||d.sourceId!==m.id||d.sourceSha256!==m.body.sha256)throw Error('Rainfall source association mismatch');
    return {validAt:i.validAt,data:d,source:{id:m.id,sha256:m.body.sha256,derivedSha256:i.derived.sha256}};
  });
}
const rainfallProvenance=report=>report.inputs.map(i=>({validAt:i.validAt,availability:i.availability,sourceId:i.manifestId,sourceSha256:i.sourceSha256,derived:i.derived}));
try {
  mkdirSync(root,{recursive:true});const entries=[];
  for(const episode of config.episodes) {
    if(!/^[a-z0-9-]{1,40}$/.test(episode.id))throw Error('Invalid comparison ID');
    const report=JSON.parse(readFileSync(episode.rainfallReport));
    const frames=readFrames(report,episode.from,episode.to);
    const stationManifest=await cache.acquire(sourceRequest('station',episode.from),{offline:true});
    if(stationManifest.availability!=='retrieved')throw Error('Station original missing');
    const station=stationQuality(stationSubset(cache.readBody(stationManifest),episode.from,episode.to));
    const stationRef=cache.derived(stationManifest,station);
    const selected=eventReport.samples.find(s=>s.name===episode.eventCase);
    if(!selected)throw Error('Event context missing');
    const events=derived(selected.events.derived),warnings=derived(selected.warnings.derived);
    for(const [record,data] of [[selected.events,events],[selected.warnings,warnings]]) {
      original(record.sourceId,record.sourceSha256);
      if(data.sourceId!==record.sourceId||data.sourceSha256!==record.sourceSha256)throw Error('Event context source mismatch');
    }
    const context={meaning:'Retrospective county/zone context, not outage causes or damage footprints. Warning selection is one archived instant, not complete period coverage.',
      events:{range:events.range,availability:events.availability,sourceUrl:selected.events.sourceUrl,sourceSha256:events.sourceSha256,
        records:events.records.map(({eventId,episodeId,eventType,beginsAt,endsAt,area})=>({eventId,episodeId,eventType,beginsAt,endsAt,area}))},
      warnings:{validAt:warnings.validAt,availability:warnings.availability,sourceUrl:selected.warnings.sourceUrl,sourceSha256:warnings.sourceSha256,
        records:warnings.records.map(({key,label,beginsAt,endsAt,area})=>({key,label,beginsAt,endsAt,area}))}};
    const start=Date.parse(episode.from),end=Date.parse(episode.to),observations=legacy.rows(start,end),referenceObservations=legacy.rows(start-(end-start),start);
    const screen=selection.cases.find(c=>c.id===episode.id),matched=screen?.selected;
    if(!matched?.eligible||Date.parse(screen.caseFrom)!==start||Date.parse(screen.caseTo)!==end||screen.stationSource.sha256!==stationManifest.body.sha256)throw Error('Reference selection/source mismatch');
    const refReport=JSON.parse(readFileSync(episode.referenceRainfallReport)),refFrames=readFrames(refReport,matched.from,matched.to);
    const refRows=legacy.rows(Date.parse(matched.from),Date.parse(matched.to));
    const refStation=derived(matched.stationDerived);
    if(refStation.sourceId!==stationManifest.id||refStation.sourceSha256!==stationManifest.body.sha256||refStation.range.from!==matched.from||refStation.range.to!==matched.to)throw Error('Reference station source mismatch');
    const refWeather=summarizeWeather(refFrames,refStation,matched.from,matched.to,BBOX);
    const refInput={from:matched.from,to:matched.to,observations:refRows,policy,selection:screen,
      provenance:{policySha256:sha256(policyBytes),selectionSha256:sha256(selectionBytes),rainfall:rainfallProvenance(refReport),
        station:{id:stationManifest.id,sha256:stationManifest.body.sha256,derived:matched.stationDerived}}};
    const period=weather.catalog().entries.find(e=>e.product==='rainfall-period'&&e.hours===72&&Date.parse(e.intervalStart)===start&&Date.parse(e.intervalEnd)===end);
    if(!period)throw Error('Publish rainfall map first');const map=weather.read(period);
    const input={episode,observations,referenceObservations,station,frames,bbox:BBOX,context,matchedReference:refInput,
      provenance:{version:COMPARISON_VERSION,configSha256:sha256(configBytes),legacyIndex:legacyCatalog.index,
        rainfall:rainfallProvenance(report),
        station:{id:stationManifest.id,sha256:stationManifest.body.sha256,url:stationManifest.request.url,derived:stationRef},
        context:{events:selected.events.derived,warnings:selected.warnings.derived}},
      rainfallImage:{id:period.sha256,url:`/api/weather/image/${period.sha256}`,bbox:map.bbox,legend:map.legend}};
    const bundle=publish({...input,frames:undefined,station:undefined});
    const result=compareEpisode(input,config.rules);
    result.matchedReference={...refInput,observations:undefined,...refWeather,
      outage:outageHours(refRows,matched.from,matched.to).summary,
      byLag:config.rules.lagHours.map(lagHours=>matchReference({caseFrom:episode.from,caseTo:episode.to,caseRows:observations,
        caseRain:result.rainfall.hours,caseWind:result.wind.hours,referenceFrom:matched.from,referenceTo:matched.to,referenceRows:refRows,
        referenceRain:refWeather.rainfall.hours,referenceWind:refWeather.wind.hours,lagHours},policy)),
      limitations:['Dates were screened using calendar, capture timing and station weather only; no outage counts entered selection.',
        'Only reference hours with regional rain below 0.1 mm and airport sustained wind below 10 m/s enter the paired summary. Low rain is not proof of dry weather everywhere.',
        'A 7- to 28-day separation does not control vegetation, maintenance, heat, demand, prior storms, unmeasured weather or outage carryover. These are descriptive reference contrasts, not causal estimates.',
        'Each side contributes one timed snapshot per included hour. This differs from the hourly peaks above. All excluded pairs and exact capture anchors remain downloadable.']};
    const output=publish({...result,provenance:{...result.provenance,inputBundle:bundle}});
    entries.push({id:episode.id,name:episode.name,from:result.from,to:result.to,...output});
    console.log(JSON.stringify({id:episode.id,referenceFrom:matched.from,referenceRainMm:refWeather.rainfall.meanMm,
      pairedHours:result.matchedReference.byLag.map(l=>({lag:l.lagHours,included:l.includedHours,excluded:l.exclusions,groups:l.groups}))}));
  }
  // Verify mutable source pointers again before promoting this generation.
  if(!legacyCatalogBytes.equals(readFileSync(join(legacyRoot,'catalog.json')))||!configBytes.equals(readFileSync('config/weather-comparisons.json')))throw Error('Comparison inputs changed during publication');
  if(!policyBytes.equals(readFileSync(config.referencePolicy))||!selectionBytes.equals(readFileSync(config.referenceSelection)))throw Error('Reference selection changed during publication');
  for(const {path,hash} of tracked)if(sha256(readFileSync(path))!==hash)throw Error('Comparison input changed');
  const catalog={version:COMPARISON_VERSION,rules:config.rules,entries};
  writeFileSync(join(root,'catalog.json.tmp'),JSON.stringify(catalog));renameSync(join(root,'catalog.json.tmp'),join(root,'catalog.json'));
  writeFileSync('reports/weather-comparison-preparation.json',JSON.stringify({checkedAt:new Date().toISOString(),requests:cache.requests,downloadBytes:cache.downloadBytes,catalogSha256:sha256(Buffer.from(JSON.stringify(catalog))),...catalog},null,2));
  console.log(JSON.stringify({complete:true,requests:cache.requests,episodes:entries.length}));
} finally {cache.close();legacy.close();}

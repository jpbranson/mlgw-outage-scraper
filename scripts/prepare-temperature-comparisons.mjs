// Independent, immutable publication: never rewrites rainfall comparison files.
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {stationSubset} from '../src/weather/decode.mjs';
import {stationQuality} from '../src/weather/station-quality.mjs';
import {outageHours,COMPARISON_VERSION} from '../src/weather/comparisons.mjs';
import {temperatureHours,matchTemperature,temperatureGeography,TEMPERATURE_VERSION} from '../src/weather/temperature-comparisons.mjs';
import {LegacyService} from '../src/dashboard/legacy.mjs';
import {hourlyAnchors,screenReference} from '../src/weather/references.mjs';
import {stormEventArchive,stormEventWindow} from '../src/weather/event-context.mjs';

if(process.argv.length!==2)throw Error('Usage: node scripts/prepare-temperature-comparisons.mjs (offline)');
const screenBytes=readFileSync('reports/weather-candidate-screen.json'),screen=JSON.parse(screenBytes),configBytes=readFileSync('config/weather-candidates.json');
if(screen.configSha256!==sha256(configBytes))throw Error('Repeat candidate screen');
const catalogBytes=readFileSync('data/legacy/dashboard/catalog.json'),legacyCatalog=JSON.parse(catalogBytes),policyBytes=readFileSync('config/weather-reference-policy.json'),policy=JSON.parse(policyBytes);
if(screen.legacyIndex.sha256!==legacyCatalog.index.sha256)throw Error('Legacy screen is stale');
const root='data/comparisons/conditions',legacy=new LegacyService('data/legacy/dashboard'),cache=new WeatherCache('data/weather/cache'),entries=[];
const tracked=[];
function publish(value){const bytes=Buffer.from(JSON.stringify(value)),hash=sha256(bytes);if(bytes.length>12*1024*1024)throw Error('Temperature publication size limit');const path=hash+'.json';writeFileSync(join(root,path+'.tmp'),bytes);renameSync(join(root,path+'.tmp'),join(root,path));return {path,sha256:hash,bytes:bytes.length};}
try {
  mkdirSync(root,{recursive:true});
  for(const episode of screen.cases.filter(c=>c.eligible&&['winter','heat'].includes(c.family))) {
    const {from,to,family}=episode,start=Date.parse(from),end=Date.parse(to),rows=legacy.rows(start,end);
    const manifest=await cache.acquire(sourceRequest('station',from),{offline:true});
    if(manifest.body?.sha256!==episode.stationSource.sha256)throw Error('Station screen revision changed');
    tracked.push(manifest);const raw=cache.readBody(manifest),station=stationQuality(stationSubset(raw,from,to)),hours=temperatureHours(station,from,to);
    const caseAnchors=hourlyAnchors(rows,from,to,policy),candidates=policy.candidateDaysBefore.map(days=>{
      const a=new Date(start-days*86400000).toISOString(),b=new Date(end-days*86400000).toISOString(),r=legacy.rows(Date.parse(a),Date.parse(b)),s=stationQuality(stationSubset(raw,a,b));
      const selected=screenReference({caseFrom:from,caseAnchors,from:a,to:b,rows:r,station:s},policy);
      if(s.summary.temperature.hoursWithAcceptedReports/72<.9){selected.reasons.push('temperature coverage below 90%');selected.eligible=false;}
      return {...selected,stationDerived:cache.derived(manifest,s)};
    });
    const selected=candidates.find(c=>c.eligible);if(!selected)throw Error('No eligible temperature reference');
    const referenceRows=legacy.rows(Date.parse(selected.from),Date.parse(selected.to)),referenceStation=stationQuality(stationSubset(raw,selected.from,selected.to));
    const referenceHours=temperatureHours(referenceStation,selected.from,selected.to),outage=outageHours(rows,from,to);
    const eventManifest=await cache.acquire(sourceRequest('storm-events',from),{offline:true});
    if(eventManifest.body?.sha256!==episode.eventSource.sha256)throw Error('Event screen revision changed');tracked.push(eventManifest);
    const context=stormEventWindow(stormEventArchive(cache.readBody(eventManifest),eventManifest.request),from,to);
    const snapshots=caseAnchors.filter(r=>r?.gridCaptureKey).map(r=>legacy.snapshot(r.id));
    const referenceByLag=[0,1,3].map(lagHours=>matchTemperature({from,to,rows,hours,referenceFrom:selected.from,referenceTo:selected.to,referenceRows,referenceHours,family,lagHours},policy));
    const byLag=referenceByLag.map(m=>({lagHours:m.lagHours,matches:outage.hours.map((h,i)=>({...h,exposureFrom:hours[i-1-m.lagHours]?.from??null,exposureTo:hours[i-1-m.lagHours]?.to??null,
      temperatureC:(family==='winter'?hours[i-1-m.lagHours]?.minC:hours[i-1-m.lagHours]?.maxC)??null})),geography:temperatureGeography(snapshots,m.pairs)}));
    const inputBundle=publish({episode,observations:rows,referenceObservations:referenceRows,snapshots,station:cache.derived(manifest,station),referenceStation:cache.derived(manifest,referenceStation),context:cache.derived(eventManifest,context)});
    const result={version:COMPARISON_VERSION,analysisVersion:TEMPERATURE_VERSION,kind:'temperature',id:episode.id,name:family==='winter'?'December 22–24, 2022 · Cold':'June 29–July 1, 2023 · Heat',family,from:new Date(start).toISOString(),to:new Date(end).toISOString(),
      sourceFormat:'legacy_html',outage:outage.summary,outageHours:outage.hours,temperature:{hours,summary:station.summary.temperature,station:station.station},context,byLag,
      matchedReference:{from:selected.from,to:selected.to,selection:{selected,candidates},outage:outageHours(referenceRows,selected.from,selected.to).summary,temperature:{hours:referenceHours,summary:referenceStation.summary.temperature},byLag:referenceByLag},
      interpretation:['Airport temperature is regional context. Hourly report minima/maxima are not continuous exposure measurements.',
        'Below 0°C and at least 32°C are fixed analytical thresholds, not proof of snow, ice accumulation, a heat wave or utility equipment damage. Finalized hazard records are separate context.',
        'One independent case per temperature category; six pairs support only a descriptive median. No uncertainty interval or stable geographic ranking is supported.',
        'The earlier dry/low-wind reference is chosen by calendar, timing and station coverage before reading outage values. Each paired reference exposure also requires known low airport wind and nominal report-hour precipitation, and temperature outside the case threshold.',
        'No radar rainfall is inferred for these station cases. New events, population rates and complete customer-hours are unavailable from this sparse legacy history.',
        ...(family==='heat'?['The heat case follows the June 25 storm. Outages already present may persist; its contrast cannot isolate heat from storm recovery.']:[])],
      provenance:{configSha256:sha256(configBytes),screenSha256:sha256(screenBytes),policySha256:sha256(policyBytes),legacyIndex:legacyCatalog.index,
        station:{id:manifest.id,sha256:manifest.body.sha256,url:manifest.request.url},events:{id:eventManifest.id,sha256:eventManifest.body.sha256,url:eventManifest.request.url},inputBundle}};
    const output=publish(result);entries.push({id:result.id,name:result.name,kind:'temperature',from:result.from,to:result.to,...output});
    console.log(JSON.stringify({id:result.id,observations:rows.length,reference:selected.from,pairs:referenceByLag.map(m=>({lag:m.lagHours,included:m.includedHours})),gridCells:byLag[0].geography.geojson.features.length}));
  }
  if(!catalogBytes.equals(readFileSync('data/legacy/dashboard/catalog.json'))||!screenBytes.equals(readFileSync('reports/weather-candidate-screen.json'))||!policyBytes.equals(readFileSync('config/weather-reference-policy.json'))||!configBytes.equals(readFileSync('config/weather-candidates.json')))throw Error('Inputs changed during publication');
  for(const m of tracked){const current=JSON.parse(readFileSync(join(cache.root,'manifests',m.id+'.json')));if(current.body.sha256!==m.body.sha256)throw Error('Source revision changed');cache.readBody(m);}
  const catalog={version:COMPARISON_VERSION,analysisVersion:TEMPERATURE_VERSION,entries};
  writeFileSync(join(root,'catalog.json.tmp'),JSON.stringify(catalog));renameSync(join(root,'catalog.json.tmp'),join(root,'catalog.json'));
  writeFileSync('reports/temperature-comparison-preparation.json',JSON.stringify({catalogSha256:sha256(Buffer.from(JSON.stringify(catalog))),entries,requests:cache.requests,cacheBytes:cache.used},null,2));
}finally{cache.close();legacy.close();}

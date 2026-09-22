// Offline replay from checksum-verified originals. Does not publish UI layers.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {sourceRequest,BBOX} from '../src/weather/sources.mjs';
import {rainfallSubset} from '../src/weather/decode.mjs';
import {accumulateHourly,hourlyEndpoints} from '../src/weather/accumulation.mjs';
import {cellAreaWeights,summarizeArea,rectangle} from '../src/weather/area-weights.mjs';
import {rainfallOptions} from './rainfall-options.mjs';
const {configPath,config,plan}=rainfallOptions(process.argv.slice(2)),cache=new WeatherCache('data/weather/cache');
const report={checkedAt:new Date().toISOString(),configPath,config,inputs:[],windows:[],faultChecks:[],cacheBeforeBytes:cache.used};
const deadline=()=>{if(Date.now()-cache.started>=cache.limits.maxRunMs)throw Error('Rainfall analysis time budget exceeded');};
try {
  const frames=[];
  for(const validAt of hourlyEndpoints(config.from,config.to)) {
    deadline();const began=performance.now(),manifest=await cache.acquire(sourceRequest('rainfall',validAt),{offline:true});
    const frame={validAt,availability:manifest.availability};frames.push(frame);
    const item={validAt,availability:manifest.availability,manifestId:manifest.id};report.inputs.push(item);
    if(manifest.availability==='retrieved') {
      frame.data=rainfallSubset(cache.readBody(manifest),validAt);
      const derived=cache.derived(manifest,frame.data);
      frame.source={manifestId:manifest.id,sourceSha256:manifest.body.sha256,derivedSha256:derived.sha256};
      Object.assign(item,{availability:'available',...frame.source,sourceBytes:manifest.body.bytes,derived,summary:frame.data.summary});
    }
    item.decodeMs=Math.round(performance.now()-began);
  }
  const native=frames.find(f=>f.data)?.data;if(!native)throw Error('No available grid; collect bounded batches first');
  const referenceBytes=readFileSync('reference/shelby-block-groups-2024.json.gz'),reference=JSON.parse(gunzipSync(referenceBytes));
  const weights={bbox:cellAreaWeights(native.grid,rectangle(BBOX)),areas:[]};
  const weightingStarted=performance.now();
  for(const feature of reference.features) {
    deadline();weights.areas.push({id:feature.id,weights:cellAreaWeights(native.grid,feature.geometry)});
  }
  report.weightingMs=Math.round(performance.now()-weightingStarted);
  report.reference={file:'reference/shelby-block-groups-2024.json.gz',sha256:sha256(referenceBytes),features:reference.features.length,metadata:reference.metadata};
  let full;
  for(const hours of plan.periodHours.toSorted((a,b)=>a-b)) {
    const from=new Date(Date.parse(config.to)-hours*3600000).toISOString();
    const accumulation=accumulateHourly(from,config.to,frames.filter(f=>Date.parse(f.validAt)>Date.parse(from)));
    const areas={bbox:summarizeArea(accumulation,weights.bbox),blockGroups:weights.areas.map(a=>({id:a.id,...summarizeArea(accumulation,a.weights)}))};
    const bytes=Buffer.from(JSON.stringify({accumulation,areas,reference:report.reference,scope:config.purpose}));
    const hash=sha256(bytes);cache.put(`derived/${hash}.json`,bytes);
    report.windows.push({hours,from,to:config.to,summary:accumulation.summary,bbox:areas.bbox,
      blockGroupCount:areas.blockGroups.length,completeBlockGroups:areas.blockGroups.filter(a=>a.meanMm!==null).length,
      spatiallyPartialBlockGroups:areas.blockGroups.filter(a=>a.spatialCoverage<1-1e-8).map(a=>({id:a.id,spatialCoverage:a.spatialCoverage})),
      derived:{key:`derived/${hash}.json`,sha256:hash,bytes:bytes.length}});
    if(hours===plan.endpoints.length)full=accumulation;
  }
  full??=accumulateHourly(config.from,config.to,frames);
  // Describe temporal distribution without claiming an official event category.
  const hourly=frames.map(f=>({validAt:f.validAt,meanMm:f.data?summarizeArea({grid:f.data.grid,values:f.data.values,knownSumMm:f.data.values.map(v=>v??0),hoursPerCell:f.data.values.map(v=>v===null?0:1),hours:1},weights.bbox).meanMm:null}));
  report.rainDistribution={definition:'Wet hour: outlined-area mean at least 0.1 mm; descriptive validation threshold, not an official storm label.',
    wetHours:hourly.filter(h=>h.meanMm!==null&&h.meanMm>=.1).length,
    utcDays:[...new Set(hourly.map(h=>new Date(Date.parse(h.validAt)-3600000).toISOString().slice(0,10)))].map(day=>{
      const rows=hourly.filter(h=>new Date(Date.parse(h.validAt)-3600000).toISOString().startsWith(day));
      return {day,availableHours:rows.filter(h=>h.meanMm!==null).length,wetHours:rows.filter(h=>h.meanMm!==null&&h.meanMm>=.1).length,
        meanMm:rows.every(h=>h.meanMm!==null)?rows.reduce((sum,h)=>sum+h.meanMm,0):null};
    }),hourly};
  // Deliberate in-memory faults only; originals and normal aggregates stay intact.
  const wettest=frames.filter(f=>f.data).sort((a,b)=>b.data.values.reduce((s,v)=>s+(v??0),0)-a.data.values.reduce((s,v)=>s+(v??0),0))[0];
  const interrupted=accumulateHourly(config.from,config.to,frames.filter(f=>f!==wettest));
  report.faultChecks.push({scenario:'Artificial missing wettest hour',omittedAt:wettest.validAt,summary:interrupted.summary,bbox:summarizeArea(interrupted,weights.bbox),
    passed:interrupted.summary.completeCells===0&&interrupted.values.every(v=>v===null)});
  const masked=structuredClone(wettest),indices=full.values.flatMap((v,i)=>v===null?[]:[i]).slice(0,10);
  for(const i of indices){masked.data.values[i]=null;masked.data.quality[i]='missing';}
  const partial=accumulateHourly(config.from,config.to,frames.map(f=>f===wettest?masked:f));
  report.faultChecks.push({scenario:'Artificial missing cells in one hour',modifiedAt:wettest.validAt,cellCount:indices.length,summary:partial.summary,bbox:summarizeArea(partial,weights.bbox),
    passed:indices.length>0&&partial.summary.completeCells===full.summary.completeCells-indices.length&&indices.every(i=>partial.values[i]===null)});
  Object.assign(report,{requests:cache.requests,downloadBytes:cache.downloadBytes,cacheAfterBytes:cache.used,elapsedMs:Date.now()-cache.started,peakRssBytes:process.resourceUsage().maxRSS*1024});
  writeFileSync(`reports/${plan.reportId}-validation.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({windows:report.windows,faultChecks:report.faultChecks,requests:report.requests,cacheBytes:report.cacheAfterBytes,elapsedMs:report.elapsedMs,weightingMs:report.weightingMs,peakRssBytes:report.peakRssBytes},null,2));
  if(report.inputs.some(i=>i.availability!=='available')||report.faultChecks.some(c=>!c.passed))process.exitCode=1;
}finally{cache.close();}

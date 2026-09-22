// Explicit, bounded weather source pilot. No collector imports or dashboard routes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { WeatherCache } from '../src/weather/cache.mjs';
import { sourceRequest, PROCESSING_VERSION } from '../src/weather/sources.mjs';
import { radarSubset, rainfallSubset, stationSubset, warningSubset } from '../src/weather/decode.mjs';
import { stationQuality } from '../src/weather/station-quality.mjs';

const args=process.argv.slice(2);
if(args.some(a=>a!=='--download'&&!/^--case=(wet|dry|winter|current)$/.test(a))) throw Error('Usage: node scripts/weather.mjs [--download] [--case=wet|dry|winter|current]');
const samples=[
  {name:'wet',radar:'2023-06-25T23:00:00Z',rainfall:'2023-06-26T00:00:00Z',from:'2023-06-25T00:00:00Z',to:'2023-06-27T00:00:00Z'},
  {name:'dry',radar:'2023-09-01T18:00:00Z',rainfall:'2023-09-01T18:00:00Z',from:'2023-09-01T00:00:00Z',to:'2023-09-02T00:00:00Z'},
  {name:'winter',radar:'2022-02-03T18:00:00Z',rainfall:'2022-02-03T18:00:00Z',from:'2022-02-03T00:00:00Z',to:'2022-02-04T00:00:00Z'},
  {name:'current',radar:'2026-09-16T18:00:00Z',rainfall:'2026-09-16T18:00:00Z',from:'2026-09-16T00:00:00Z',to:'2026-09-17T00:00:00Z'},
].filter(s=>!args.some(a=>a.startsWith('--case='))||args.includes(`--case=${s.name}`));
const cache=new WeatherCache('data/weather/cache');
const report={processingVersion:PROCESSING_VERSION,checkedAt:new Date().toISOString(),mode:args.includes('--download')?'download':'offline',
  limits:cache.limits,scope:'Weather-only source samples; historical outage records are not imported or inferred.',samples:[]};
try {
  for(const sample of samples) {
    const result={...sample,products:{}};
    for(const product of ['radar','rainfall','station','warnings']) {
      const started=performance.now();
      try {
        const at=product==='station'?sample.from:product==='rainfall'?sample.rainfall:sample.radar;
        const request=sourceRequest(product,at),manifest=await cache.acquire(request,{offline:!args.includes('--download')});
        const detail={manifestId:manifest.id,availability:manifest.availability,sourceUrl:request.url,bytes:manifest.body?.bytes??0,cacheHit:manifest.cacheHit??false};
        result.products[product]=detail;
        if(manifest.availability!=='retrieved') { console.log(sample.name,product,JSON.stringify(detail));continue; }
        const body=cache.readBody(manifest);let data;
        if(product==='radar') {
          const world=await cache.acquire(sourceRequest('radar-world',at),{offline:!args.includes('--download')});
          if(world.availability!=='retrieved') {detail.availability='missing-georeference';continue;}
          data=radarSubset(body,cache.readBody(world));data.georeferenceSha256=world.body.sha256;
          detail.summary={width:data.grid.width,height:data.grid.height,transparentPixels:data.transparentPixels};
        } else if(product==='rainfall') {data=rainfallSubset(body,at);detail.summary=data.summary;}
        else if(product==='station') {
          data=stationSubset(body,sample.from,sample.to);
          const quality=stationQuality(data);
          detail.qualityDerived=cache.derived(manifest,quality);
          detail.summary={...data.coverage,sourceCoverage:data.sourceCoverage,fieldQuality:quality.summary,
            hourlyPrecipitationStatuses:quality.hourlyPrecipitationStatuses};
        }
        else {data=warningSubset(body,at);detail.summary={features:data.collection.features.length};}
        detail.derived=cache.derived(manifest,data);detail.availability=product==='station'&&data.rows.length===0?'no-observations':'available';
        detail.decodeMs=Math.round(performance.now()-started);
      } catch(error) {result.products[product]={...result.products[product],availability:'failed-validation',error:error.message};}
      console.log(sample.name,product,JSON.stringify(result.products[product]));
    }
    report.samples.push(result);
  }
  report.requests=cache.requests;report.downloadBytes=cache.downloadBytes;report.cacheBytes=cache.used;
  report.elapsedMs=Date.now()-cache.started;
  mkdirSync('reports',{recursive:true});writeFileSync('reports/weather-validation.json',JSON.stringify(report,null,2));
  if(args.includes('--download'))writeFileSync('reports/weather-download.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({requests:report.requests,downloadBytes:report.downloadBytes,cacheBytes:report.cacheBytes,elapsedMs:report.elapsedMs}));
  if(report.samples.some(s=>Object.values(s.products).some(p=>p.availability==='failed-validation')))process.exitCode=1;
} finally {cache.close();}

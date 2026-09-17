// Publishes verified offline aggregate assets; never fetches upstream data.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
import {displayImage,DISPLAY_VERSION} from '../src/weather/display.mjs';
import {publishWeather} from '../src/weather/publish.mjs';
import {BBOX,sourceRequest} from '../src/weather/sources.mjs';
if(process.argv.length!==2)throw Error('Prepare saved rainfall periods without arguments');
const report=JSON.parse(readFileSync('reports/rainfall-window-validation.json','utf8')),cache=new WeatherCache('data/weather/cache');
try {
  let catalog={version:1,entries:[]};
  try{catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  // Reproject existing single-capture layers from retained originals at the new extent.
  const upgraded=await publishWeather(cache,catalog.entries.filter(e=>['radar','rainfall','metar'].includes(e.product)).map(e=>sourceRequest(e.product,e.validAt)));
  if(upgraded.some(x=>x.status==='failed'))throw Error('An existing weather layer could not be upgraded');
  catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json'),'utf8'));
  const periods=[];
  for(const window of report.windows) {
    if(![24,48,72].includes(window.hours))throw Error('Unsupported period length');
    const bytes=readFileSync(join(cache.root,window.derived.key));
    if(sha256(bytes)!==window.derived.sha256)throw Error('Aggregate checksum mismatch');
    const {accumulation:a,areas,reference}=JSON.parse(bytes),g=a.grid;
    const bounds=[g.x0-g.dx/2,g.y0+(g.height-.5)*g.dy,g.x0+(g.width-.5)*g.dx,g.y0-g.dy/2];
    if(bounds.some((n,i)=>Math.abs(n-BBOX[i])>1e-6)||a.hours!==window.hours||Date.parse(a.to)!==Date.parse(window.to))throw Error('Revalidate the expanded period grid first');
    const data={...displayImage({...a,bbox:BBOX},'rainfall'),product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,
      grid:g,values:a.values,hoursPerCell:a.hoursPerCell,summary:a.summary,areaSummary:areas.bbox,
      completeBlockGroups:areas.blockGroups.filter(x=>x.meanMm!==null).length,blockGroupCount:areas.blockGroups.length,
      geometrySha256:reference.sha256,aggregateSha256:window.derived.sha256,sources:a.sources,
      provider:'NOAA MRMS via NOAA Open Data',sourceUrl:'https://registry.opendata.aws/noaa-mrms-pds/',
      qualityFlags:[...a.qualityFlags,'full-cell-total-requires-every-hour','native-grid-no-interpolation']};
    const output=Buffer.from(JSON.stringify(data)),hash=sha256(output);cache.put(`derived/${hash}.json`,output);
    catalog.entries=catalog.entries.filter(e=>e.product!=='rainfall-period'||e.validAt!==a.to||e.hours!==a.hours);
    if(catalog.entries.length>=500)throw Error('Weather catalog limit');
    catalog.entries.push({identity:`${DISPLAY_VERSION}:rainfall-period:${a.from}:${a.to}`,product:'rainfall-period',validAt:a.to,intervalStart:a.from,intervalEnd:a.to,hours:a.hours,sha256:hash});
    periods.push({hours:a.hours,from:a.from,to:a.to,sha256:hash,bytes:output.length,completeBlockGroups:data.completeBlockGroups});
  }
  catalog.updatedAt=new Date().toISOString();cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));
  const result={checkedAt:catalog.updatedAt,requests:cache.requests,cacheBytes:cache.used,upgraded,periods};
  writeFileSync('reports/rainfall-period-preparation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{cache.close();}

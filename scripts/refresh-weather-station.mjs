// Explicit bounded refresh; ordinary station reads continue to use a pinned snapshot.
import {writeFileSync} from 'node:fs';
import {WeatherCache} from '../src/weather/cache.mjs';
import {sourceRequest} from '../src/weather/sources.mjs';
import {stationSubset} from '../src/weather/decode.mjs';
const args=process.argv.slice(2);
if(args.length!==2||!args.includes('--download')||args.filter(a=>/^--year=\d{4}$/.test(a)).length!==1)throw Error('Usage: node scripts/refresh-weather-station.mjs --year=YYYY --download');
const year=args.find(a=>a.startsWith('--year=')).slice(7),request=sourceRequest('station',`${year}-01-01T00:00:00Z`),cache=new WeatherCache('data/weather/cache');
try {
  const manifest=await cache.acquire(request,{refresh:true});
  const sourceCoverage=manifest.availability==='retrieved'?stationSubset(cache.readBody(manifest),`${year}-01-01T00:00:00Z`,`${year}-01-02T00:00:00Z`).sourceCoverage:null;
  const report={checkedAt:new Date().toISOString(),year:Number(year),availability:manifest.availability,refresh:manifest.refresh??null,
    body:manifest.body??null,sourceCoverage,requests:cache.requests,downloadBytes:cache.downloadBytes,cacheBytes:cache.used,
    meaning:'Explicit source snapshot refresh. Previous originals and manifests remain preserved; saved derived analyses keep their original source hashes. No dashboard timeline is republished.'};
  writeFileSync(`reports/weather-station-${year}-refresh.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(manifest.availability!=='retrieved')process.exitCode=1;
}finally{cache.close();}

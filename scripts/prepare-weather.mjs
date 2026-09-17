import {readFileSync,writeFileSync} from 'node:fs';
import {WeatherCache} from '../src/weather/cache.mjs';
import {publishWeather} from '../src/weather/publish.mjs';
import {sourceRequest,instant} from '../src/weather/sources.mjs';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--download'&&!a.startsWith('--from=')&&!a.startsWith('--to=')&&a!=='--samples'))throw Error('Usage: node scripts/prepare-weather.mjs [--download] [--from=UTC --to=UTC] [--samples]');
const suppliedFrom=args.find(a=>a.startsWith('--from='))?.slice(7),suppliedTo=args.find(a=>a.startsWith('--to='))?.slice(5);
if(Boolean(suppliedFrom)!==Boolean(suppliedTo))throw Error('Supply both from and to');
const to=suppliedTo?instant(suppliedTo):Math.floor(Date.now()/300000)*300000,from=suppliedFrom?instant(suppliedFrom):to-30*60000;
if(from%300000||to%300000||to<from||to-from>45*60000)throw Error('Prepare at most 45 minutes on five-minute boundaries per job');
const requests=[];
if(args.includes('--samples')) {
  const report=JSON.parse(readFileSync('reports/weather-validation.json','utf8'));
  for(const sample of report.samples)for(const product of ['radar','rainfall'])requests.push(sourceRequest(product,sample[product]));
} else {
  for(let t=from;t<=to;t+=300000)requests.push(sourceRequest('radar',new Date(t).toISOString()));
  const hours=new Set([Math.floor(from/3600000)*3600000,Math.floor(to/3600000)*3600000]);
  for(const t of hours)requests.push(sourceRequest('rainfall',new Date(t).toISOString()));
  requests.push(sourceRequest('metar',new Date(Math.min(Math.ceil(to/3600000)*3600000,Math.floor(Date.now()/3600000)*3600000)).toISOString()));
}
const cache=new WeatherCache('data/weather/cache');
try{
  const outcomes=await publishWeather(cache,requests,{offline:!args.includes('--download')});
  const report={checkedAt:new Date().toISOString(),from:new Date(from).toISOString(),to:new Date(to).toISOString(),outcomes,requests:cache.requests,downloadBytes:cache.downloadBytes,cacheBytes:cache.used};
  writeFileSync('reports/weather-preparation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(outcomes.some(o=>o.status==='failed'))process.exitCode=1;
}finally{cache.close();}

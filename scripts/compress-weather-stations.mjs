// Offline migration: preserve source identities, verify gzip on disk, then
// remove only the redundant uncompressed representation under the writer lock.
import {readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {WeatherCache,sha256} from '../src/weather/cache.mjs';
const args=process.argv.slice(2);
if(args.length>1||args.some(a=>a!=='--apply'))throw Error('Usage: node scripts/compress-weather-stations.mjs [--apply]');
const cache=new WeatherCache('data/weather/cache'),path='reports/weather-station-compression.json';
const metadata=()=>Object.fromEntries(['manifests','revisions','published','derived'].flatMap(dir=>readdirSync(join(cache.root,dir)).map(name=>{
  const key=`${dir}/${name}`;return [key,sha256(readFileSync(join(cache.root,key)))];
})));
const save=r=>{writeFileSync(path+'.tmp',JSON.stringify(r,null,2));renameSync(path+'.tmp',path);};
try {
  const before=metadata();
  const result=cache.compressStationOriginals({apply:args.includes('--apply'),onProgress:(report)=>save({...report,complete:false})});
  result.metadataUnchanged=JSON.stringify(before)===JSON.stringify(metadata());
  if(!result.metadataUnchanged)throw Error('Weather metadata changed during compression');
  save(result);console.log(JSON.stringify(result,null,2));
}finally{cache.close();}

// Publishes verified offline aggregate assets; never fetches upstream data.
import {readFileSync,writeFileSync} from 'node:fs';
import {WeatherCache} from '../src/weather/cache.mjs';
import {publishRainfallPeriods} from '../src/weather/rainfall-publish.mjs';
import {rainfallOptions} from './rainfall-options.mjs';
const {configPath,plan}=rainfallOptions(process.argv.slice(2));
const report=JSON.parse(readFileSync(`reports/${plan.reportId}-validation.json`,'utf8')),cache=new WeatherCache('data/weather/cache');
try {
  const result={...publishRainfallPeriods(cache,report,plan),configPath};
  writeFileSync(`reports/${plan.reportId==='rainfall-window'?'rainfall-period':plan.reportId+'-period'}-preparation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}finally{cache.close();}

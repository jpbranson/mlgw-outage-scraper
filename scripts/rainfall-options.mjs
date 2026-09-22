import {readFileSync} from 'node:fs';
import {rainfallPlan} from '../src/weather/rainfall-window.mjs';
export function rainfallOptions(args,{collect=false}={}) {
  const options=new Map();
  for(const arg of args) {
    const match=/^--(config|batch)=(.+)$/.exec(arg),key=match?.[1]??(arg==='--download'?'download':null);
    if(!key||(!collect&&key!=='config')||options.has(key))throw Error('Use [--config=path.json]'+(collect?' --batch=N [--download]':''));
    options.set(key,match?.[2]??true);
  }
  const configPath=options.get('config')??'config/rainfall-window.json',config=JSON.parse(readFileSync(configPath,'utf8')),plan=rainfallPlan(config);
  const batch=Number(options.get('batch'));
  if(collect&&(!Number.isInteger(batch)||batch<1||batch>plan.batches))throw Error(`Supply --batch=1 through --batch=${plan.batches}`);
  return {configPath,config,plan,batch,download:options.has('download')};
}

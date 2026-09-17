import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {radarSubset,rainfallSubset} from './decode.mjs';
import {decodeMetar} from './metar.mjs';
import {displayImage,DISPLAY_VERSION} from './display.mjs';
import {sourceRequest} from './sources.mjs';

export async function publishWeather(cache,requests,{offline=true}={}) {
  let catalog={version:1,entries:[]};
  try{catalog=JSON.parse(readFileSync(join(cache.root,'published/catalog.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(catalog.version!==1||catalog.entries.length>500)throw Error('Invalid or full weather display catalog');
  const outcomes=[];
  for(const request of requests) {
    const identity=`${DISPLAY_VERSION}:${request.product}:${request.validAt}`;
    if(catalog.entries.some(e=>e.identity===identity)){outcomes.push({product:request.product,at:request.validAt,status:'already-published'});continue;}
    try {
      const m=await cache.acquire(request,{offline});
      if(m.availability!=='retrieved'){outcomes.push({product:request.product,at:request.validAt,status:m.availability});continue;}
      const raw=cache.readBody(m);let data;
      if(request.product==='radar') {
        const world=await cache.acquire(sourceRequest('radar-world',request.validAt),{offline});
        if(world.availability!=='retrieved')throw Error('Radar georeference unavailable');
        const native=radarSubset(raw,cache.readBody(world));data=displayImage(native,'radar',raw);
        data.georeferenceSha256=world.body.sha256;data.sourceText=native.sourceText;
      } else if(request.product==='rainfall') {
        const native=rainfallSubset(raw,request.validAt);data=displayImage(native,'rainfall');
        data.intervalStart=native.intervalStart;data.intervalEnd=native.intervalEnd;data.summary=native.summary;
      } else if(request.product==='metar')data=decodeMetar(raw,request);
      else throw Error('Unsupported display product');
      const derived=cache.derived(m,{...data,validAt:request.validAt,provider:request.provider,sourceUrl:request.url,retrievedAt:m.retrievedAt});
      if(catalog.entries.length>=500)throw Error('Weather catalog reached 500 entries');
      catalog.entries=catalog.entries.filter(e=>e.product!==request.product||e.validAt!==request.validAt);
      catalog.entries.push({identity,product:request.product,validAt:request.validAt,sha256:derived.sha256,
        intervalStart:request.intervalStart??null,intervalEnd:request.intervalEnd??null});
      outcomes.push({product:request.product,at:request.validAt,status:'published'});
    }catch(e){outcomes.push({product:request.product,at:request.validAt,status:'failed',error:e.message});}
  }
  catalog.updatedAt=new Date().toISOString();
  cache.put('published/catalog.json',Buffer.from(JSON.stringify(catalog)));return outcomes;
}

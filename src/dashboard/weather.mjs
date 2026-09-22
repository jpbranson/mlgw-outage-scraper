import {readFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {instant} from '../weather/sources.mjs';
import {RequestError} from './service.mjs';
const HOUR=3600000;
const digest=b=>createHash('sha256').update(b).digest('hex');
export class WeatherService {
  constructor(root,{rollingRoot}={}){this.root=resolve(root);this.rolling=rollingRoot?new WeatherService(rollingRoot):null;}
  catalog() {
    const path=join(this.root,'published/catalog.json');
    try {
      if(statSync(path).size>1024*1024)throw Error('Weather catalog limit');
      const c=JSON.parse(readFileSync(path,'utf8'));
      if(c.version!==1||!Array.isArray(c.entries)||c.entries.length>500)throw Error('Weather catalog invalid');
      for(const e of c.entries) {
        if(!['radar','rainfall','metar','rainfall-period'].includes(e.product)||!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isFinite(instant(e.validAt)))throw Error('Weather catalog entry invalid');
        if(e.product==='rainfall-period'&&(![24,48,72].includes(e.hours)||instant(e.intervalEnd)!==instant(e.validAt)||instant(e.intervalEnd)-instant(e.intervalStart)!==e.hours*HOUR))throw Error('Invalid rainfall period');
      }
      if(this.rolling) {
        try {const live=this.rolling.catalog();const known=new Set(c.entries.map(e=>e.identity));c.entries.push(...live.entries.filter(e=>!known.has(e.identity)).map(e=>({...e,rolling:true})));c.updatedAt=[c.updatedAt,live.updatedAt].filter(Boolean).sort().at(-1)??null;}
        catch {c.rollingUnavailable=true;}
      }
      return c;
    }catch(e){if(e.code==='ENOENT')return {version:1,entries:[],updatedAt:null};throw e;}
  }
  read(entry) {
    if(entry.rolling&&this.rolling)return this.rolling.read({...entry,rolling:false});
    const path=join(this.root,'derived',`${entry.sha256}.json`);
    if(statSync(path).size>2*1024*1024)throw Error('Weather asset limit');
    const bytes=readFileSync(path);
    if(digest(bytes)!==entry.sha256)throw Error('Weather asset checksum mismatch');
    const data=JSON.parse(bytes);
    if(data.validAt!==entry.validAt)throw Error('Weather asset time mismatch');
    if(entry.product==='rainfall-period'&&(data.product!==entry.product||data.hours!==entry.hours||data.intervalStart!==entry.intervalStart||data.intervalEnd!==entry.intervalEnd))throw Error('Rainfall interval mismatch');
    return data;
  }
  at(params) {
    let at;try{if([...params.keys()].some(k=>k!=='at')||params.getAll('at').length!==1)throw Error();at=instant(params.get('at'));}catch{throw new RequestError('One explicit UTC weather timestamp is required.',400);}
    const selectedAt=new Date(at).toISOString(),result={selectedAt,radar:{availability:'unavailable'},rainfall:{availability:'unavailable'},station:{availability:'unavailable',records:[]}};
    let catalog;try{catalog=this.catalog();}catch{return {...result,reason:'The weather cache is temporarily unavailable.'};}
    result.preparedAt=catalog.updatedAt;
    for(const product of ['radar','rainfall']) {
      const tolerance=product==='radar'?300000:HOUR;
      const frames=catalog.entries.filter(e=>e.product===product),eligible=frames.filter(e=>instant(e.validAt)<=at&&at-instant(e.validAt)<tolerance).sort((a,b)=>instant(b.validAt)-instant(a.validAt));
      result[product]={availability:'unavailable',reason:product==='radar'?'No cached radar frame within five minutes before this capture.':'No cached one-hour rainfall estimate ending within 60 minutes before this capture.',
        availableFrom:frames.length?frames.map(e=>e.validAt).sort()[0]:null,availableTo:frames.length?frames.map(e=>e.validAt).sort().at(-1):null};
      const entry=eligible[0];if(!entry)continue;
      try {
        const data=this.read(entry);
        result[product]={availability:'available',validAt:entry.validAt,offsetSeconds:(at-instant(entry.validAt))/1000,
          imageUrl:`/api/weather/image/${entry.sha256}`,bbox:data.bbox,legend:data.legend,units:data.units,
          intervalStart:data.intervalStart??null,intervalEnd:data.intervalEnd??null,summary:data.summary??null,qualityFlags:data.qualityFlags,
          provider:data.provider,sourceUrl:data.sourceUrl,nativeGrid:data.nativeGrid};
      }catch{result[product].reason='The selected weather image could not be verified.';}
    }
    const records=new Map();let broken=false;
    // A rolling 24-hour plot needs at most two hourly-ending METAR batches. Each
    // batch may contain special reports; never use an observation after selection.
    const batches=catalog.entries.filter(e=>e.product==='metar'&&instant(e.intervalStart)<at&&instant(e.intervalEnd)>at-24*HOUR)
      .sort((a,b)=>instant(b.validAt)-instant(a.validAt)).slice(0,2);
    for(const entry of batches)try {
      const data=this.read(entry);
      if(!Array.isArray(data.records)||data.records.length>2000)throw Error('Station limit');
      for(const r of data.records)if(instant(r.at)<=at&&instant(r.at)>=at-24*HOUR&&!records.has(r.at))records.set(r.at,{
        at:r.at,station:r.station,latitude:r.latitude,longitude:r.longitude,temperatureF:r.temperatureF,windKnots:r.windKnots,gustKnots:r.gustKnots,precipitation:r.precipitation,weatherCodes:r.weatherCodes});
    }catch{broken=true;}
    const rows=[...records.values()].sort((a,b)=>instant(a.at)-instant(b.at)),latest=rows.at(-1);
    result.station={availability:latest&&at-instant(latest.at)<=90*60000?'available':'unavailable',records:rows,
      observation:latest&&at-instant(latest.at)<=90*60000?latest:null,offsetSeconds:latest?(at-instant(latest.at))/1000:null,
      reason:broken?'Some airport history could not be verified.':!latest?'No cached Memphis airport observations for this period.':at-instant(latest.at)>90*60000?'No airport report within 90 minutes before this capture.':null,
      provider:'Iowa Environmental Mesonet / NWS METAR',sourceUrl:'https://mesonet.agron.iastate.edu/request/download.phtml?network=TN_ASOS',
      quality:'As reported; no additional quality control. Regional airport conditions, not neighborhood measurements.'};
    return result;
  }
  periods(params) {
    if([...params.keys()].length)throw new RequestError('Prepared periods take no query parameters.',400);
    return {periods:this.catalog().entries.filter(e=>e.product==='rainfall-period').sort((a,b)=>instant(b.validAt)-instant(a.validAt)||a.hours-b.hours)
      .map(e=>({id:e.sha256,from:e.intervalStart,to:e.intervalEnd,hours:e.hours}))};
  }
  period(params) {
    const id=params.get('id');
    if([...params.keys()].some(k=>k!=='id')||params.getAll('id').length!==1||!/^[a-f0-9]{64}$/.test(id??''))throw new RequestError('One prepared rainfall period ID is required.',400);
    const e=this.catalog().entries.find(e=>e.product==='rainfall-period'&&e.sha256===id);
    if(!e)throw new RequestError('Prepared rainfall period not found.',404);
    const d=this.read(e);
    return {id,from:e.intervalStart,to:e.intervalEnd,hours:e.hours,imageUrl:`/api/weather/image/${id}`,bbox:d.bbox,legend:d.legend,units:d.units,
      grid:d.grid,values:d.values,hoursPerCell:d.hoursPerCell,summary:d.summary,areaSummary:d.areaSummary,
      completeBlockGroups:d.completeBlockGroups,blockGroupCount:d.blockGroupCount,provider:d.provider,sourceUrl:d.sourceUrl,qualityFlags:d.qualityFlags};
  }
  image(id) {
    if(!/^[a-f0-9]{64}$/.test(id))throw new RequestError('Weather image not found.',404);
    const entry=this.catalog().entries.find(e=>e.sha256===id&&['radar','rainfall','rainfall-period'].includes(e.product));
    if(!entry)throw new RequestError('Weather image not found.',404);
    const data=this.read(entry),bytes=Buffer.from(data.imageBase64??'','base64');
    if(bytes.length>1024*1024||bytes.subarray(1,4).toString()!=='PNG')throw Error('Invalid published weather PNG');
    return bytes;
  }
}

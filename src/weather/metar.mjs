import { instant } from './sources.mjs';
// Quoted commas and doubled quotes occur in METAR remarks. Do not split CSV blindly.
export function csvRows(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Unterminated weather CSV quote');
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  return rows;
}
export function decodeMetar(bytes,request) {
  const rows=csvRows(bytes.toString('utf8').split(/\r?\n/).filter(s=>!s.startsWith('#')).join('\n'));
  const header=rows.shift()??[];
  for(const field of ['station','valid','lon','lat','tmpf','sknt','gust','p01i','wxcodes','metar'])if(!header.includes(field))throw Error(`Missing METAR column: ${field}`);
  if(rows.length>2000)throw Error('METAR row limit');
  const number=(raw,min,max)=>{if(raw==='M'||raw==='')return null;const v=Number(raw);if(!Number.isFinite(v)||v<min||v>max)throw Error('Invalid METAR numeric value');return v;};
  const records=[];
  for(const cells of rows) {
    if(cells.length!==header.length)throw Error('Malformed METAR row');
    const r=Object.fromEntries(header.map((k,i)=>[k,cells[i]]));
    if(r.station!=='MEM'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.valid))throw Error('Unexpected METAR station/time');
    const at=new Date(instant(r.valid.replace(' ','T')+':00Z')).toISOString();
    if(instant(at)<instant(request.intervalStart)||instant(at)>=instant(request.intervalEnd))continue;
    const temperatureF=number(r.tmpf,-120,140),windKnots=number(r.sknt,0,300),gustKnots=number(r.gust,0,300),precip=number(r.p01i,0,30);
    const longitude=number(r.lon,-90.1,-89.8),latitude=number(r.lat,34.9,35.2);
    if(longitude===null||latitude===null)throw Error('Missing station location');
    records.push({at,station:'KMEM',latitude,longitude,temperatureF,windKnots,gustKnots,
      precipitation:{inches:precip===0.0001?null:precip,state:precip===null?'missing':precip===0.0001?'trace':'reported',raw:r.p01i},
      weatherCodes:r.wxcodes==='M'?null:r.wxcodes,rawMetar:r.metar,quality:'As reported; no additional quality control'});
  }
  records.sort((a,b)=>instant(a.at)-instant(b.at));
  return {records,intervalStart:request.intervalStart,intervalEnd:request.intervalEnd,provider:request.provider,
    qualityFlags:request.qualityFlags,units:{temperature:'°F',wind:'knots',precipitation:'inches'},
    meaning:'Regional airport reports; missing gust is not calm wind. Reported hourly precipitation is not an additive time series.'};
}

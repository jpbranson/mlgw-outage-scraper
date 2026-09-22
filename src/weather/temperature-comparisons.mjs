import {HOUR,windowUtc} from './sources.mjs';
import {hourlyAnchors,referenceCalendar} from './references.mjs';

export const TEMPERATURE_VERSION='temperature-comparison-v1';
const iso=t=>new Date(t).toISOString();
const median=values=>{const v=[...values].sort((a,b)=>a-b),n=v.length;return n?n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2:null;};
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
export function temperatureHours(station,from,to) {
  const r=windowUtc(from,to),start=Date.parse(r.from),end=Date.parse(r.to);
  requireValue(start%HOUR===0&&end-start===72*HOUR,'Temperature case requires 72 UTC hours');
  return Array.from({length:72},(_,i)=>{
    const at=start+i*HOUR,rows=station.rows.filter(r=>Date.parse(r.at)>=at&&Date.parse(r.at)<at+HOUR);
    const good=rows.filter(r=>r.fields.temperature.eligible&&r.fields.temperature.status==='accepted'&&Number.isFinite(r.fields.temperature.value));
    const minimum=good.length?good.reduce((a,b)=>a.fields.temperature.value<=b.fields.temperature.value?a:b):null;
    const maximum=good.length?good.reduce((a,b)=>a.fields.temperature.value>=b.fields.temperature.value?a:b):null;
    const winds=rows.map(r=>r.fields.wind_speed).filter(f=>f?.eligible&&f.status==='accepted'&&Number.isFinite(f.value));
    const precipitation=station.hourlyPrecipitation?.find(h=>Date.parse(h.reportHour)===at);
    return {from:iso(at),to:iso(at+HOUR),acceptedReports:good.length,minC:minimum?.fields.temperature.value??null,maxC:maximum?.fields.temperature.value??null,
      minimumAt:minimum?.at??null,maximumAt:maximum?.at??null,windMs:winds.length?Math.max(...winds.map(f=>f.value)):null,
      precipitationStatus:precipitation?.status??'missing-report',precipitationMm:precipitation?.value??null};
  });
}
export function temperatureCondition(hour,family) {
  requireValue(['winter','heat'].includes(family),'Unsupported temperature family');
  const value=family==='winter'?hour?.minC:hour?.maxC;
  return value===null||value===undefined?null:family==='winter'?value<0:value>=32;
}
export function matchTemperature({from,to,rows,hours,referenceFrom,referenceTo,referenceRows,referenceHours,family,lagHours},policy) {
  requireValue([0,1,3].includes(lagHours)&&referenceCalendar(from,referenceFrom,policy),'Unsupported temperature pairing');
  for(const [list,start] of [[hours,from],[referenceHours,referenceFrom]]) {
    requireValue(list.length===72,'Temperature hours missing');
    list.forEach((h,i)=>requireValue(Date.parse(h.from)===Date.parse(start)+i*HOUR&&Date.parse(h.to)===Date.parse(start)+(i+1)*HOUR,'Temperature interval mismatch'));
  }
  const a=hourlyAnchors(rows,from,to,policy),b=hourlyAnchors(referenceRows,referenceFrom,referenceTo,policy),shift=Date.parse(from)-Date.parse(referenceFrom);
  const pairs=a.map((caseCapture,i)=>{
    const referenceCapture=b[i],k=i-1-lagHours,h=hours[k],r=referenceHours[k],condition=temperatureCondition(h,family),referenceCondition=temperatureCondition(r,family),reasons=[];
    if(!caseCapture)reasons.push('case-capture-missing');if(!referenceCapture)reasons.push('reference-capture-missing');
    const offset=caseCapture&&referenceCapture?Math.abs(caseCapture.at-referenceCapture.at-shift)/60000:null;
    if(offset!==null&&offset>10)reasons.push('capture-times-differ-over-10-minutes');
    if(condition===null||referenceCondition===null)reasons.push('temperature-missing');
    if(referenceCondition===true)reasons.push('reference-temperature-reaches-threshold');
    if(!Number.isFinite(r?.windMs)||r?.precipitationStatus!=='accepted'||!Number.isFinite(r?.precipitationMm))reasons.push('reference-station-weather-missing');
    if(r?.windMs>=10||r?.precipitationMm>=.1)reasons.push('reference-station-weather-reaches-threshold');
    const capture=c=>c?{id:c.id,at:c.at,capturedAt:c.capturedAt,customers:c.customers,outages:c.outages}:null;
    return {hour:i,caseFrom:iso(Date.parse(from)+i*HOUR),referenceFrom:iso(Date.parse(referenceFrom)+i*HOUR),caseCapture:capture(caseCapture),referenceCapture:capture(referenceCapture),captureOffsetMinutes:offset,
      caseExposureFrom:h?.from??null,caseExposureTo:h?.to??null,referenceExposureFrom:r?.from??null,referenceExposureTo:r?.to??null,
      caseTemperatureC:(family==='winter'?h?.minC:h?.maxC)??null,referenceTemperatureC:(family==='winter'?r?.minC:r?.maxC)??null,
      referenceWindMs:r?.windMs??null,referencePrecipitationMm:r?.precipitationMm??null,
      caseTemperatureAt:(family==='winter'?h?.minimumAt:h?.maximumAt)??null,referenceTemperatureAt:(family==='winter'?r?.minimumAt:r?.maximumAt)??null,
      condition,included:reasons.length===0,reasons};
  });
  const groups=[['all','All eligible pairs',()=>true],['threshold',family==='winter'?'Temperature below 0°C':'Temperature at least 32°C',p=>p.condition],['other','Other observed temperatures',p=>!p.condition]].map(([id,label,predicate])=>{
    const selected=pairs.filter(p=>p.included&&predicate(p)),enough=selected.length>=6;
    return {id,label,pairs:selected.length,status:enough?'descriptive-only':'sparse',caseMedianCustomers:enough?median(selected.map(p=>p.caseCapture.customers)):null,
      referenceMedianCustomers:enough?median(selected.map(p=>p.referenceCapture.customers)):null,medianPairedDifference:enough?median(selected.map(p=>p.caseCapture.customers-p.referenceCapture.customers)):null};
  });
  return {lagHours,pairs,groups,includedHours:pairs.filter(p=>p.included).length,excludedHours:pairs.filter(p=>!p.included).length,
    exclusions:Object.fromEntries([...new Set(pairs.flatMap(p=>p.reasons))].sort().map(r=>[r,pairs.filter(p=>p.reasons.includes(r)).length]))};
}

// Absent polygons are unknown. Only actual reported cell counts enter summaries.
// All cells share regional station context, never a claimed local temperature.
export function temperatureGeography(snapshots,pairs) {
  const cells=new Map(),eligible=pairs.filter(p=>p.included&&p.condition),byId=new Map(snapshots.map(s=>[s.summary.id,s]));
  for(const pair of eligible) {
    const snapshot=byId.get(pair.caseCapture.id);if(!snapshot?.detail.available)continue;
    for(const feature of snapshot.detail.geojson.features) {
      const id=feature.properties.gridCellId,count=feature.properties.customers;
      requireValue(Number.isSafeInteger(count)&&count>=0,'Invalid geographic count');
      let cell=cells.get(id);
      if(!cell){cell={id,geometry:feature.geometry,reports:[],geometryChanged:false};cells.set(id,cell);}
      if(JSON.stringify(cell.geometry)!==JSON.stringify(feature.geometry))cell.geometryChanged=true;
      cell.reports.push({captureId:pair.caseCapture.id,at:pair.caseCapture.capturedAt,customers:count,exposureTo:pair.caseExposureTo});
    }
  }
  return {available:[...cells.values()].some(c=>!c.geometryChanged),eligibleHours:eligible.length,gridHours:eligible.filter(p=>byId.get(p.caseCapture.id)?.detail.available).length,
    meaning:'Reported customer counts in original legacy polygons during paired threshold hours. Missing cells are unknown, not zero. All cells share airport temperature context; no local weather, per-capita rate, event frequency or vulnerability ranking is inferred.',
    geojson:{type:'FeatureCollection',features:[...cells.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(c=>({type:'Feature',id:c.id,geometry:c.geometryChanged?null:c.geometry,properties:{gridCellId:c.id,reports:c.reports.length,
      peakCustomers:Math.max(...c.reports.map(r=>r.customers)),medianCustomers:c.reports.length>=6?median(c.reports.map(r=>r.customers)):null,geometryChanged:c.geometryChanged,observations:c.reports}}))}};
}

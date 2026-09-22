import { HOUR, windowUtc } from './sources.mjs';

export const REFERENCE_VERSION='matched-weather-reference-v1';
const iso=ms=>new Date(ms).toISOString();
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const median=values=>{const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
export function validateReferencePolicy(p) {
  requireValue(p?.version===REFERENCE_VERSION&&JSON.stringify(p.candidateDaysBefore)==='[7,14,21,28]'&&p.timezone==='America/Chicago'&&p.hours===72&&p.anchorMinute===30&&p.anchorToleranceMinutes===15&&p.pairToleranceMinutes===10&&p.minimumAnchorPairs===48&&p.minimumStationCoverage===.9&&p.referenceRainThresholdMm===.1&&p.referenceWindThresholdMs===10&&p.minimumGroupPairs===6,'Unsupported reference policy');
}
// Selection reads only timestamps. Counts must never determine the selected
// date or capture, including when the nearest capture is a recorded zero.
export function hourlyAnchors(rows,from,to,policy) {
  validateReferencePolicy(policy);const range=windowUtc(from,to),start=Date.parse(range.from),end=Date.parse(range.to);
  requireValue(end-start===policy.hours*HOUR&&start%HOUR===0,'Reference requires 72 hourly UTC bins');
  requireValue(rows.length<=20000,'Reference observation limit');
  let previous=-Infinity;
  for(const r of rows){requireValue(Number.isSafeInteger(r.at)&&r.at>previous&&r.at>=start&&r.at<end,'Invalid reference observation timestamps');previous=r.at;}
  return Array.from({length:policy.hours},(_,i)=>{
    const target=start+i*HOUR+policy.anchorMinute*60000;
    const candidates=rows.filter(r=>Math.abs(r.at-target)<=policy.anchorToleranceMinutes*60000);
    return candidates.sort((a,b)=>Math.abs(a.at-target)-Math.abs(b.at-target)||a.at-b.at)[0]??null;
  });
}
function calendarKey(at,timezone) {
  const f=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'});
  return f.format(new Date(at));
}
export function referenceCalendar(caseFrom,referenceFrom,policy) {
  const start=Date.parse(caseFrom),ref=Date.parse(referenceFrom),days=(start-ref)/(24*HOUR);
  return policy.candidateDaysBefore.includes(days)&&Array.from({length:policy.hours},(_,i)=>calendarKey(start+i*HOUR,policy.timezone)===calendarKey(ref+i*HOUR,policy.timezone)).every(Boolean);
}
export function screenReference({caseFrom,caseAnchors,from,to,rows,station},policy) {
  const anchors=hourlyAnchors(rows,from,to,policy),shift=Date.parse(caseFrom)-Date.parse(from);
  const paired=caseAnchors.filter((a,i)=>a&&anchors[i]&&Math.abs(a.at-anchors[i].at-shift)<=policy.pairToleranceMinutes*60000).length;
  const precipitation=station.hourlyPrecipitation,wind=station.summary.wind_speed;
  const report={from:iso(Date.parse(from)),to:iso(Date.parse(to)),daysBefore:shift/(24*HOUR),
    anchorHours:anchors.filter(Boolean).length,pairedAnchorHours:paired,calendarMatched:referenceCalendar(caseFrom,from,policy),
    stationWindHours:wind.hoursWithAcceptedReports,stationWindPeakMs:wind.max,
    stationPrecipitationKnownHours:precipitation.filter(h=>h.status==='accepted').length,
    stationWetHours:precipitation.filter(h=>h.status==='accepted'&&h.value>=policy.referenceRainThresholdMm).length,
    stationTraceHours:precipitation.filter(h=>h.status==='trace').length,reasons:[]};
  if(!report.calendarMatched)report.reasons.push('weekday, local hour or UTC offset differs');
  if(paired<policy.minimumAnchorPairs)report.reasons.push('fewer than 48 timestamp-matched capture pairs');
  if(report.stationWindHours/policy.hours<policy.minimumStationCoverage||report.stationPrecipitationKnownHours/policy.hours<policy.minimumStationCoverage)report.reasons.push('station weather coverage below 90%');
  if(report.stationWetHours||report.stationTraceHours)report.reasons.push('station rain or trace reported');
  if(report.stationWindPeakMs===null||report.stationWindPeakMs>=policy.referenceWindThresholdMs)report.reasons.push('station wind reaches threshold or is unavailable');
  return {...report,eligible:!report.reasons.length};
}

export function matchReference({caseFrom,caseTo,caseRows,caseRain,caseWind,referenceFrom,referenceTo,referenceRows,referenceRain,referenceWind,lagHours},policy) {
  validateReferencePolicy(policy);requireValue([0,1,3].includes(lagHours),'Unsupported reference lag');
  requireValue(referenceCalendar(caseFrom,referenceFrom,policy),'Reference calendar mismatch');
  const a=hourlyAnchors(caseRows,caseFrom,caseTo,policy),b=hourlyAnchors(referenceRows,referenceFrom,referenceTo,policy),shift=Date.parse(caseFrom)-Date.parse(referenceFrom);
  for(const [hours,from] of [[caseRain,caseFrom],[caseWind,caseFrom],[referenceRain,referenceFrom],[referenceWind,referenceFrom]]) {
    requireValue(hours.length===policy.hours,'Reference weather length mismatch');
    for(let i=0;i<hours.length;i++)requireValue(Date.parse(hours[i].from)===Date.parse(from)+i*HOUR&&Date.parse(hours[i].to)===Date.parse(from)+(i+1)*HOUR,'Reference weather interval mismatch');
  }
  const pairs=a.map((caseCapture,i)=>{
    const referenceCapture=b[i],k=i-1-lagHours,cr=caseRain[k],cw=caseWind[k],rr=referenceRain[k],rw=referenceWind[k];
    const reasons=[];
    if(!caseCapture)reasons.push('case-capture-missing');if(!referenceCapture)reasons.push('reference-capture-missing');
    const offset=caseCapture&&referenceCapture?Math.abs(caseCapture.at-referenceCapture.at-shift)/60000:null;
    if(offset!==null&&offset>policy.pairToleranceMinutes)reasons.push('capture-times-differ-over-10-minutes');
    const values=[cr?.meanMm,cw?.sustained.value,rr?.meanMm,rw?.sustained.value];
    if(values.some(v=>v===null||v===undefined||!Number.isFinite(v)))reasons.push('weather-missing');
    if(rr?.meanMm!==null&&rr?.meanMm!==undefined&&rr.meanMm>=policy.referenceRainThresholdMm)reasons.push('reference-rain-at-or-above-threshold');
    if(rw?.sustained.value!==null&&rw?.sustained.value!==undefined&&rw.sustained.value>=policy.referenceWindThresholdMs)reasons.push('reference-wind-at-or-above-threshold');
    for(const w of [cw,rw])if(w?.sustained.value!==null&&w?.sustained.value!==undefined)
      requireValue(Date.parse(w.sustained.at)>=Date.parse(w.from)&&Date.parse(w.sustained.at)<Date.parse(w.to),'Wind report outside paired exposure hour');
    const capture=r=>r?{id:r.id,capturedAt:r.capturedAt,at:r.at,customers:r.customers,outages:r.outages}:null;
    return {hour:i,caseFrom:iso(Date.parse(caseFrom)+i*HOUR),referenceFrom:iso(Date.parse(referenceFrom)+i*HOUR),
      caseCapture:capture(caseCapture),referenceCapture:capture(referenceCapture),captureOffsetMinutes:offset,
      caseExposureFrom:cr?.from??null,caseExposureTo:cr?.to??null,referenceExposureFrom:rr?.from??null,referenceExposureTo:rr?.to??null,
      caseRainMm:cr?.meanMm??null,caseWindMs:cw?.sustained.value??null,caseWindReportAt:cw?.sustained.at??null,
      referenceRainMm:rr?.meanMm??null,referenceWindMs:rw?.sustained.value??null,referenceWindReportAt:rw?.sustained.at??null,
      included:!reasons.length,reasons};
  });
  const predicates=[['all','All eligible paired hours',p=>true],['rain','Case rain ≥0.1 mm',p=>p.caseRainMm>=policy.referenceRainThresholdMm],
    ['lower-rain','Case rain <0.1 mm',p=>p.caseRainMm<policy.referenceRainThresholdMm],['wind','Case wind ≥10 m/s',p=>p.caseWindMs>=policy.referenceWindThresholdMs],
    ['lower-wind','Case wind <10 m/s',p=>p.caseWindMs<policy.referenceWindThresholdMs],['rain-and-wind','Case rain + wind thresholds',p=>p.caseRainMm>=policy.referenceRainThresholdMm&&p.caseWindMs>=policy.referenceWindThresholdMs]];
  const groups=predicates.map(([id,label,predicate])=>{
    const group=pairs.filter(p=>p.included&&predicate(p)),enough=group.length>=policy.minimumGroupPairs;
    return {id,label,pairs:group.length,status:enough?'descriptive-only':'sparse',
      caseMedianCustomers:enough?median(group.map(p=>p.caseCapture.customers)):null,
      referenceMedianCustomers:enough?median(group.map(p=>p.referenceCapture.customers)):null,
      medianPairedDifference:enough?median(group.map(p=>p.caseCapture.customers-p.referenceCapture.customers)):null};
  });
  const exclusions=Object.fromEntries([...new Set(pairs.flatMap(p=>p.reasons))].sort().map(reason=>[reason,pairs.filter(p=>p.reasons.includes(reason)).length]));
  return {version:REFERENCE_VERSION,lagHours,totalHours:pairs.length,includedHours:pairs.filter(p=>p.included).length,excludedHours:pairs.filter(p=>!p.included).length,exclusions,groups,pairs,
    meaning:'One actual capture nearest minute 30 (within 15 minutes) per hour; paired clock times differ by at most 10 minutes. Identical paired-hour sets on both sides. References require earlier rain <0.1 mm and sustained wind <10 m/s. Medians use six or more pairs; no causal effect, incident count, population rate or customer-hour estimate is inferred.'};
}

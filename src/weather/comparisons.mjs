import { HOUR, windowUtc } from './sources.mjs';
import { cellAreaWeights, summarizeArea, rectangle } from './area-weights.mjs';
import { accumulateHourly } from './accumulation.mjs';

export const COMPARISON_VERSION = 'weather-comparison-v1';
const check = (ok, message) => { if (!ok) throw Error(message); };
const iso = at => new Date(at).toISOString();
const median = values => { const sorted = [...values].sort((a,b) => a-b), n=sorted.length; return n ? n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2 : null; };

// Bounded, fixed plan: each episode is a distinct 72-hour UTC window with its own validated rainfall reports.
export function validateComparisonPlan(config) {
  check(config?.version===COMPARISON_VERSION&&Array.isArray(config.episodes)&&config.episodes.length>=1&&config.episodes.length<=8,'Unsupported comparison plan');
  check(new Set(config.episodes.map(e=>e.id)).size===config.episodes.length,'Duplicate comparison ID');
  for(const e of config.episodes) {
    check(/^[a-z0-9-]{1,40}$/.test(e.id??'')&&typeof e.name==='string'&&e.name.length>0&&e.name.length<=80,'Invalid comparison ID');
    const start=Date.parse(e.from),end=Date.parse(e.to);
    check(Number.isFinite(start)&&start%HOUR===0&&end-start===72*HOUR,'Comparison episode must contain 72 UTC hours');
    for(const k of ['rainfallReport','referenceRainfallReport'])check(/^reports\/rainfall-[a-z0-9-]+-validation\.json$/.test(e[k]??''),'Invalid rainfall report path');
    check(/^[a-z0-9-]{1,40}$/.test(e.eventCase??''),'Invalid event context sample');
  }
  return config;
}

export function outageHours(rows, from, to, maxGapMinutes = 7.5, minimumCoverage = .9) {
  const range = windowUtc(from, to), start=Date.parse(range.from), end=Date.parse(range.to);
  check(start%HOUR===0 && end%HOUR===0 && maxGapMinutes===7.5 && minimumCoverage===.9, 'Unsupported outage comparison policy');
  check(rows.length<=20000, 'Comparison observation limit');
  let prior=-Infinity;
  for(const r of rows) { check(r.at>prior && r.at>=start && r.at<end && Number.isSafeInteger(r.customers) && r.customers>=0 && Number.isSafeInteger(r.outages) && r.outages>=0, 'Invalid comparison observations'); prior=r.at; }
  const hours=Array.from({length:(end-start)/HOUR},(_,i)=>({from:iso(start+i*HOUR),to:iso(start+(i+1)*HOUR),at:start+i*HOUR,
    observations:0,gridSnapshots:0,peakCustomers:null,peakOutages:null,customerCaptureId:null,outageCaptureId:null,customerPeakAt:null,outagePeakAt:null,
    coveredMinutes:0,observedCustomerHours:0}));
  for(const row of rows) {
    const h=hours[Math.floor((row.at-start)/HOUR)]; h.observations++; if(row.gridCaptureKey)h.gridSnapshots++;
    if(h.peakCustomers===null || row.customers>h.peakCustomers) {h.peakCustomers=row.customers;h.customerCaptureId=row.id;h.customerPeakAt=row.capturedAt;}
    if(h.peakOutages===null || row.outages>h.peakOutages) {h.peakOutages=row.outages;h.outageCaptureId=row.id;h.outagePeakAt=row.capturedAt;}
  }
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1],b=rows[i]; if(b.at-a.at>maxGapMinutes*60000)continue;
    // Never bridge longer gaps, extrapolate before/after observations, or add
    // totals across captures and call them distinct affected customers.
    for(let at=a.at;at<b.at;) {const index=Math.floor((at-start)/HOUR),stop=Math.min(b.at,start+(index+1)*HOUR),minutes=(stop-at)/60000;
      hours[index].coveredMinutes+=minutes;hours[index].observedCustomerHours+=a.customers*minutes/60;at=stop;}
  }
  const coveredMinutes=hours.reduce((sum,h)=>sum+h.coveredMinutes,0), coverage=coveredMinutes/((end-start)/60000);
  for(const h of hours)if(h.coveredMinutes===0)h.observedCustomerHours=null;
  const contribution=hours.reduce((sum,h)=>sum+(h.observedCustomerHours??0),0);
  const best=(field)=>rows.length?rows.reduce((a,b)=>a[field]>=b[field]?a:b):null, cp=best('customers'),op=best('outages');
  return {hours,summary:{observations:rows.length,gridSnapshots:rows.filter(r=>r.gridCaptureKey).length,hoursWithObservations:hours.filter(h=>h.observations).length,
    expectedHours:hours.length,peakCustomers:cp?.customers??null,customerPeakAt:cp?.capturedAt??null,customerCaptureId:cp?.id??null,
    peakOutages:op?.outages??null,outagePeakAt:op?.capturedAt??null,firstObservedAt:rows[0]?.capturedAt??null,lastObservedAt:rows.at(-1)?.capturedAt??null,
    firstObservedCustomers:rows[0]?.customers??null,coveredMinutes,coverage,observedCustomerHours:coveredMinutes?contribution:null,
    customerHours:coverage>=minimumCoverage?contribution:null,uniqueEvents:null,newlyReportedEvents:null,
    burdenStatus:coverage>=minimumCoverage?'observed-coverage-sufficient':'insufficient-coverage',
    meaning:'Peaks are observed counts, not unique customers or events. First observed customers can include carried-over outages. Customer-hours use left steps only across gaps ≤7.5 minutes; the displayed period metric requires 90% coverage and is never extrapolated.'}};
}

export function windHours(station, from, to) {
  const start=Date.parse(from), end=Date.parse(to), rows=station?.rows??[];
  return Array.from({length:(end-start)/HOUR},(_,i)=>{
    const at=start+i*HOUR, records=rows.filter(r=>Date.parse(r.at)>=at&&Date.parse(r.at)<at+HOUR);
    const field=name=>{const accepted=records.filter(r=>r.fields[name].status==='accepted'&&r.fields[name].eligible&&Number.isFinite(r.fields[name].value));
      const peak=accepted.length?accepted.reduce((a,b)=>a.fields[name].value>=b.fields[name].value?a:b):null;
      return {value:peak?.fields[name].value??null,at:peak?.at??null,acceptedReports:accepted.length};};
    return {from:iso(at),to:iso(at+HOUR),reports:records.length,sustained:field('wind_speed'),gust:field('wind_gust')};
  });
}

export function conditionGroups(hours, rain, wind, lagHours, rules) {
  check([0,1,3].includes(lagHours),'Unsupported comparison lag');
  const match=hours.map((h,index)=>{
    // Exposure is a completed hour BEFORE the outcome hour. Even at zero
    // additional lag, no future rainfall or station reports enter the match.
    const exposure=index-1-lagHours, r=rain[exposure], w=wind[exposure];
    return {...h,rainMm:r?.meanMm??null,windMs:w?.sustained.value??null,gustMs:w?.gust.value??null,
      exposureFrom:r?.from??w?.from??null,exposureTo:r?.to??w?.to??null,
      windReportAt:w?.sustained.at??null,windAcceptedReports:w?.sustained.acceptedReports??0};
  });
  const definitions=[['rain','Rain ≥0.1 mm',h=>h.rainMm!==null&&h.rainMm>=rules.rainThresholdMm],
    ['lower-rain','Rain <0.1 mm',h=>h.rainMm!==null&&h.rainMm<rules.rainThresholdMm],
    ['wind','Wind ≥10 m/s',h=>h.windMs!==null&&h.windMs>=rules.windThresholdMs],
    ['lower-wind','Wind <10 m/s',h=>h.windMs!==null&&h.windMs<rules.windThresholdMs],
    ['rain-and-wind','Rain + wind thresholds',h=>h.rainMm!==null&&h.windMs!==null&&h.rainMm>=rules.rainThresholdMm&&h.windMs>=rules.windThresholdMs]];
  const groups=definitions.map(([id,label,test])=>{
    const weather=match.filter(test), observed=weather.filter(h=>h.observations>0), values=observed.map(h=>h.peakCustomers), enough=values.length>=rules.minimumGroupHours;
    return {id,label,weatherHours:weather.length,jointHours:observed.length,observations:observed.reduce((sum,h)=>sum+h.observations,0),
      medianHourlyPeakCustomers:enough?median(values):null,peakCustomers:values.length?Math.max(...values):null,
      status:enough?'descriptive-only':'sparse',minimumGroupHours:rules.minimumGroupHours};
  });
  return {lagHours,exposure:'One completed weather hour, followed by the selected additional lag, then the outcome hour. Same fixed UTC bins; no future weather.',
    jointRainHours:match.filter(h=>h.observations&&h.rainMm!==null).length,jointWindHours:match.filter(h=>h.observations&&h.windMs!==null).length,
    groups,matches:match};
}

export function summarizeWeather(frames,station,from,to,bbox) {
  const range=windowUtc(from,to), hours=Array.from({length:(Date.parse(to)-Date.parse(from))/HOUR},(_,i)=>({from:iso(Date.parse(from)+i*HOUR),to:iso(Date.parse(from)+(i+1)*HOUR)}));
  const native=frames.find(f=>f.data)?.data; check(native,'No verified rainfall for comparison');
  const weights=cellAreaWeights(native.grid,rectangle(bbox)), accumulated=accumulateHourly(range.from,range.to,frames);
  const byTime=new Map(frames.map(f=>[Date.parse(f.validAt),f]));
  const rain=hours.map(h=>{
    const endpoint=Date.parse(h.to),frame=byTime.get(endpoint);
    if(!frame?.data)return {from:h.from,to:h.to,meanMm:null,areaTimeCoverage:0};
    const a=accumulateHourly(h.from,h.to,[frame]), area=summarizeArea(a,weights);
    return {from:h.from,to:h.to,meanMm:area.meanMm,areaTimeCoverage:area.areaTimeCoverage,source:frame.source};
  });
  const wind=windHours(station,range.from,range.to);
  return {rainfall:{...summarizeArea(accumulated,weights),bbox,grid:native.grid,hours:rain,expectedHours:hours.length,
      availableHours:rain.filter(h=>h.meanMm!==null).length,provider:'NOAA MRMS MultiSensor QPE 01H Pass 2',units:'mm',
      meaning:'Area-weighted estimated rainfall over the outlined Memphis-area rectangle, not the MLGW service boundary. Retrospective Pass 2; no population weighting or neighborhood interpolation.'},
    wind:{station:station?.station??null,hours:wind,acceptedHours:wind.filter(w=>w.sustained.value!==null).length,
      acceptedGustHours:wind.filter(w=>w.gust.value!==null).length,qualityVersion:station?.processingVersion??null,
      peakMs:wind.some(w=>w.sustained.value!==null)?Math.max(...wind.flatMap(w=>w.sustained.value===null?[]:[w.sustained.value])):null,
      meaning:'Memphis airport observations with supported passing source QC. Hourly maxima are maxima of reports, not continuous wind exposure. Missing gust reports do not mean zero gusts.'}};
}

export function compareEpisode(input, rules) {
  const {episode,observations,referenceObservations,frames,station,bbox}=input;
  check(rules.rainThresholdMm===.1&&rules.windThresholdMs===10&&rules.minimumGroupHours===6&&JSON.stringify(rules.lagHours)==='[0,1,3]', 'Unsupported condition definitions');
  const range=windowUtc(episode.from,episode.to), start=Date.parse(range.from),end=Date.parse(range.to);
  const outage=outageHours(observations,range.from,range.to,rules.outageMaxGapMinutes,rules.minimumBurdenCoverage);
  const referenceFrom=iso(start-(end-start)),reference=outageHours(referenceObservations,referenceFrom,range.from,rules.outageMaxGapMinutes,rules.minimumBurdenCoverage);
  const weather=summarizeWeather(frames,station,range.from,range.to,bbox);
  return {version:COMPARISON_VERSION,id:episode.id,name:episode.name,from:range.from,to:range.to,sourceFormat:'legacy_html',rules,
    outage:outage.summary,reference:{from:referenceFrom,to:range.from,...reference.summary,
      meaning:'Equal-length preceding window, descriptive context only. Rainfall and joint weather coverage have not been prepared for it; it is not a matched dry-weather control.'},
    ...weather,outageHours:outage.hours,byLag:rules.lagHours.map(lag=>conditionGroups(outage.hours,weather.rainfall.hours,weather.wind.hours,lag,rules)),
    spatial:{available:false,reason:outage.summary.gridSnapshots?'Spatial attribution is not part of this regional comparison.':'No verified legacy grid snapshots in this period. Only regional totals are compared; no outage locations are inferred.'},
    interpretation:['Selected case studies; hours within a storm are not independent events. Descriptive co-occurrence does not identify outage causes.',
      'Condition thresholds are analytical cutoffs, not official storm categories. Rain and wind groups overlap and must not be added.',
      'At least six matched hours are required for a group median. Counts, missing hours and sparse groups remain visible.',
      'No new-event frequency or per-capita rates: consolidated totals do not establish event identities or an appropriate population denominator.'],
    context:input.context,provenance:input.provenance,rainfallImage:input.rainfallImage};
}

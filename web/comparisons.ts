import { Chart, registerables } from 'chart.js';
import { ggplotMinimalGrid } from './ggplot-theme';
import {renderTemperature,clearTemperature} from './temperature-comparisons';
Chart.register(...registerables, ggplotMinimalGrid);
Chart.defaults.font.family = 'Arial, Helvetica, sans-serif'; Chart.defaults.font.size = 16; Chart.defaults.color = '#333';
type Hour = {from:string;to:string;at:number;observations:number;peakCustomers:number|null;peakOutages:number|null;exposureTo:string|null;rainMm:number|null;windMs:number|null};
type Summary = {observations:number;hoursWithObservations:number;expectedHours:number;peakCustomers:number|null;customerPeakAt:string|null;firstObservedCustomers:number|null;firstObservedAt:string|null;coveredMinutes:number;coverage:number;customerHours:number|null;meaning:string};
type Reference = {from:string;to:string;outage:Summary;rainfall:{meanMm:number|null;availableHours:number};wind:{acceptedHours:number;peakMs:number|null};
  selection:{selected:{daysBefore:number};candidates:{from:string;to:string;daysBefore:number;eligible:boolean;reasons:string[]}[]};
  comparison:{includedHours:number;excludedHours:number;exclusions:Record<string,number>;
    groups:{label:string;pairs:number;status:string;caseMedianCustomers:number|null;referenceMedianCustomers:number|null}[];
    pairs:{included:boolean;reasons:string[];caseCapture:{capturedAt:string;customers:number}|null;referenceCapture:{capturedAt:string;customers:number}|null}[]}};
type Case = {id:string;name:string;from:string;to:string;outage:Summary;outageHours:Hour[];reference:Summary&{from:string;to:string};
  rainfall:{meanMm:number|null;areaKm2:number;availableHours:number;meaning:string;hours:{meanMm:number|null}[]};
  wind:{peakMs:number|null;acceptedHours:number;acceptedGustHours:number;meaning:string;hours:{sustained:{value:number|null}}[]};
  spatial:{reason:string};rainfallImage:{url:string};interpretation:string[];publicationSha256:string;matchedReference?:Reference;
  comparison:{lagHours:number;jointRainHours:number;jointWindHours:number;matches:Hour[];groups:{label:string;weatherHours:number;jointHours:number;medianHourlyPeakCustomers:number|null;status:string}[]};
  context:{meaning:string;events:{range:{from:string;to:string};availability:string;records:{eventType:string;eventId:number;beginsAt:string;endsAt:string}[]};warnings:{validAt:string;records:{label:string;beginsAt:string;endsAt:string}[]}};
  provenance:{legacyIndex:{sha256:string};station:{sha256:string};configSha256:string}};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const put=(id:string,text:string)=>{el(id).textContent=text;};
const number=(n:number|null,digits=0)=>n===null?'Unavailable':n.toLocaleString('en-US',{maximumFractionDigits:digits});
const utc=(s:string|null)=>s? s.replace('T',' ').replace(/\.\d+Z$/,'Z').replace('Z',' UTC'):'Unavailable';
const cell=(text:string,header=false)=>{const e=document.createElement(header?'th':'td');e.textContent=text;if(header)e.setAttribute('scope','row');return e;};
const row=(values:string[])=>{const r=document.createElement('tr');r.append(...values.map((v,i)=>cell(v,i===0)));return r;};
const list=(id:string,values:string[])=>el(id).replaceChildren(...values.map(v=>{const e=document.createElement('li');e.textContent=v;return e;}));
const exclusionLabels:Record<string,string>={'case-capture-missing':'No case capture near the half hour','reference-capture-missing':'No reference capture near the half hour','capture-times-differ-over-10-minutes':'Capture times differ by more than 10 minutes','weather-missing':'Weather unavailable for the required earlier hour','reference-rain-at-or-above-threshold':'Reference rainfall reaches the threshold','reference-wind-at-or-above-threshold':'Reference wind reaches the threshold'};
const episode=el<HTMLSelectElement>('episode'),lag=el<HTMLSelectElement>('lag');
let request=0;const charts:Chart<'line',{x:number;y:number|null}[]>[]=[];
async function api<T>(url:string):Promise<T>{const r=await fetch(url,{signal:AbortSignal.timeout(15000)}),d=await r.json();if(!r.ok)throw Error(d.error??'Comparison unavailable');return d;}
const run=(p:Promise<unknown>)=>{el('error').hidden=true;void p.catch(e=>{put('error-text',e.message);el('error').hidden=false;});};
function plot(id:string,label:string,values:(number|null)[],d:Case,dots=false) {
  const chart=new Chart(el<HTMLCanvasElement>(id),{type:'line',data:{datasets:[{label,data:values.map((y,i)=>({x:Date.parse(d.from)+(i+.5)*3600000,y})),borderColor:'#222',backgroundColor:'#222',borderWidth:1,pointRadius:dots?2.5:0,pointHoverRadius:5,showLine:!dots,spanGaps:false}]},options:{animation:false,responsive:true,maintainAspectRatio:false,parsing:false,interaction:{intersect:false,mode:'nearest'},
    plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>utc(d.outageHours[items[0].dataIndex].from),afterLabel:items=>dots?`${d.outageHours[items.dataIndex].observations} observed captures`:''}}},
    scales:{x:{type:'linear',min:Date.parse(d.from),max:Date.parse(d.to),border:{display:false},grid:{color:'#e5e5e5',drawTicks:false},ticks:{maxTicksLimit:5,maxRotation:0,callback:value=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23'}).format(Number(value))}},y:{beginAtZero:true,afterFit:axis=>{axis.width=76;},border:{display:false},grid:{color:'#e5e5e5',drawTicks:false},ticks:{maxTicksLimit:4}}}}});charts.push(chart);
}
function render(d:Case) {
  put('period',`${d.name} · ${utc(d.from)} through ${utc(d.to)} (end exclusive)`);
  put('peak',number(d.outage.peakCustomers));put('peak-time',utc(d.outage.customerPeakAt));put('rain-total',number(d.rainfall.meanMm,1)+' mm');put('wind-peak',number(d.wind.peakMs,1)+' m/s');
  put('burden',number(d.outage.customerHours));put('burden-coverage',`${number(d.outage.coveredMinutes,1)} of 4,320 minutes covered by eligible intervals (${number(d.outage.coverage*100,2)}%); 90% required.`);
  put('hour-coverage',`${d.outage.observations} outage captures in ${d.outage.hoursWithObservations}/72 hours · Rainfall ${d.rainfall.availableHours}/72 hours · Accepted sustained wind ${d.wind.acceptedHours}/72 hours · Accepted gust reports ${d.wind.acceptedGustHours}/72 hours.`);
  put('lag-note',`Each outage hour uses the previous completed weather hour, then ${d.comparison.lagHours} additional hour${d.comparison.lagHours===1?'':'s'} of lag. Weather after the outcome hour begins is excluded. The timeline above stays on actual observation times.`);
  put('joint-coverage',`Hours with both outage and eligible earlier weather data: rain ${d.comparison.jointRainHours}/72; sustained wind ${d.comparison.jointWindHours}/72. Leading hours without earlier weather and hours without observations are excluded.`);
  el('groups').replaceChildren(...d.comparison.groups.map(g=>row([g.label,String(g.weatherHours),String(g.jointHours),g.status==='sparse'?'Too few matched hours':number(g.medianHourlyPeakCustomers,1)])));
  const ref=d.matchedReference;
  el('matched-reference').hidden=!ref;document.querySelector<HTMLAnchorElement>('a[href="#matched-reference"]')!.hidden=!ref;
  if(ref) {
  put('matched-range',`${utc(ref.from)} through ${utc(ref.to)} (end exclusive) · ${ref.selection.selected.daysBefore} days before the case study.`);
  put('matched-selection','Same weekdays, local clock hours and UTC offset. Selected as the nearest eligible earlier period from 7, 14, 21 and 28 days before the case, using capture timing and station weather only.');
  put('matched-coverage',`${ref.comparison.includedHours} of 72 hour pairs included · ${ref.comparison.excludedHours} excluded · ${d.comparison.lagHours}-hour additional lag on both sides.`);
  put('matched-weather',`Reference weather: ${number(ref.rainfall.meanMm,3)} mm estimated regional rain over 72 hours; highest accepted sustained wind ${number(ref.wind.peakMs,1)} m/s. Rainfall ${ref.rainfall.availableHours}/72 hours; accepted sustained wind ${ref.wind.acceptedHours}/72 hours.`);
  el('matched-groups').replaceChildren(...ref.comparison.groups.map(g=>row([g.label,String(g.pairs),g.status==='sparse'?'Too few pairs':number(g.caseMedianCustomers,1),g.status==='sparse'?'Too few pairs':number(g.referenceMedianCustomers,1)])));
  put('matched-exclusions','Exclusion reasons can overlap: '+Object.entries(ref.comparison.exclusions).map(([reason,count])=>`${exclusionLabels[reason]??reason}: ${count}`).join('; ')+'.');
  put('matched-carryover',`At the first available capture, ${number(d.outage.firstObservedCustomers)} customers were affected in the case and ${number(ref.outage.firstObservedCustomers)} in the reference. These can include outages carried over from earlier periods.`);
  list('matched-candidates',ref.selection.candidates.map(c=>`${utc(c.from)} · ${c.daysBefore} days earlier: ${c.from===ref.from?'selected':c.eligible?'eligible but farther away':c.reasons.join('; ')}.`));
  el('matched-pairs').replaceChildren(...ref.comparison.pairs.map(p=>row([utc(p.caseCapture?.capturedAt??null),p.caseCapture?number(p.caseCapture.customers):'—',utc(p.referenceCapture?.capturedAt??null),p.referenceCapture?number(p.referenceCapture.customers):'—',p.included?'Included':p.reasons.map(r=>exclusionLabels[r]??r).join('; ')])));
  }
  put('reference-range',`${utc(d.reference.from)} to ${utc(d.reference.to)}`);
  put('reference',`${number(d.reference.peakCustomers)} customers at the observed peak; ${d.reference.observations} captures in ${d.reference.hoursWithObservations}/72 hours. Comparable coverage must be considered before interpreting different peaks.`);
  put('carryover',`The case study begins with ${number(d.outage.firstObservedCustomers)} customers already affected at its first capture (${utc(d.outage.firstObservedAt)}). The records do not identify which outages began earlier.`);
  put('spatial',d.spatial.reason);put('rain-area',`Rainfall mean covers ${number(d.rainfall.areaKm2)} km²: 34.9–35.5°N, 90.4–89.6°W. This rectangle is not the utility service boundary.`);
  el<HTMLAnchorElement>('rainfall-map').href=d.rainfallImage.url;
  put('event-scope',`NOAA Storm Events · Shelby County/zone · ${utc(d.context.events.range.from)} to ${utc(d.context.events.range.to)}. Context may cover a shorter period than the chart.`);
  const eventGroups=new Map<string,{count:number;first:string;last:string}>();
  for(const e of d.context.events.records){const g=eventGroups.get(e.eventType)??{count:0,first:e.beginsAt,last:e.endsAt};g.count++;if(e.beginsAt<g.first)g.first=e.beginsAt;if(e.endsAt>g.last)g.last=e.endsAt;eventGroups.set(e.eventType,g);}
  list('events',eventGroups.size?[...eventGroups].map(([name,g])=>`${name}: ${g.count} archive record${g.count===1?'':'s'}, ${utc(g.first)} to ${utc(g.last)}.`):['No matching records in this saved Storm Events selection.']);
  put('warning-scope',`Iowa Environmental Mesonet archive · county/zone watch, warning and advisory selection at ${utc(d.context.warnings.validAt)}. One instant, not full-period coverage.`);
  list('warnings',d.context.warnings.records.length?d.context.warnings.records.map(w=>`${w.label}: ${utc(w.beginsAt)} to ${utc(w.endsAt)}.`):['No matching warnings in this saved selection.']);
  el('hourly').replaceChildren(...d.comparison.matches.map(h=>row([utc(h.from),String(h.observations),h.peakCustomers===null?'—':number(h.peakCustomers),h.peakOutages===null?'—':number(h.peakOutages),h.exposureTo?utc(h.exposureTo):'—',h.rainMm===null?'—':number(h.rainMm,3),h.windMs===null?'—':number(h.windMs,1)])));
  const params=new URLSearchParams({view:'comparison',id:d.id,lag:String(d.comparison.lagHours)});
  el<HTMLAnchorElement>('csv').href='/api/legacy/export.csv?'+params;el<HTMLAnchorElement>('json').href='/api/legacy/series?'+params;
  if(ref)el<HTMLAnchorElement>('matched-csv').href='/api/legacy/export.csv?'+new URLSearchParams({...Object.fromEntries(params),table:'reference'});
  put('outage-note',d.outage.meaning);put('rain-note',d.rainfall.meaning);put('wind-note',d.wind.meaning);list('interpretation',d.interpretation);put('context-note',d.context.meaning);
  put('provenance',`Publication SHA-256: ${d.publicationSha256}. Legacy index: ${d.provenance.legacyIndex.sha256}. Station source: ${d.provenance.station.sha256}. Rules: ${d.provenance.configSha256}. Individual rainfall sources and capture times are preserved in the JSON download.`);
  el('comparison-content').hidden=false;for(const c of charts)c.destroy();charts.length=0;
  plot('outage-chart','Observed customers',d.outageHours.map(h=>h.peakCustomers),d,true);plot('rain-chart','Rainfall (mm)',d.rainfall.hours.map(h=>h.meanMm),d);plot('wind-chart','Reported sustained wind (m/s)',d.wind.hours.map(h=>h.sustained.value),d);
}
async function load(){const n=++request;el('comparison-content').hidden=true;clearTemperature();put('period','Loading prepared comparison…');const d=await api<Case&{kind?:string}>('/api/legacy/series?'+new URLSearchParams({view:'comparison',id:episode.value,lag:lag.value}));if(n===request){if(d.kind==='temperature'){for(const c of charts)c.destroy();charts.length=0;renderTemperature(d);}else render(d);}}
async function initialize(){const c=await api<{entries:{id:string;name:string}[]}>('/api/legacy/catalog?view=comparisons');episode.replaceChildren(...c.entries.map(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.name;return o;}));episode.disabled=false;await load();}
episode.addEventListener('change',()=>run(load()));lag.addEventListener('change',()=>run(load()));el('retry').addEventListener('click',()=>run(initialize()));run(initialize());

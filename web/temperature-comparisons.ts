import {Chart} from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
type AnyCase=any; // Hash-verified, versioned offline publication; interpreted only as text/data.
const el=(tag:string,text?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const num=(n:number|null)=>n===null?'Unavailable':n.toLocaleString('en-US',{maximumFractionDigits:2});
const utc=(s:string)=>s.replace('T',' ').replace('.000Z',' UTC');
let root:HTMLElement|null=null,map:L.Map|null=null;const charts:Chart[]=[];
export function clearTemperature(){for(const c of charts)c.destroy();charts.length=0;map?.remove();map=null;root?.remove();root=null;}
function table(headers:string[],rows:(string|number)[][]){const wrap=el('div');wrap.className='comparison-table-wrap';const t=el('table');t.className='comparison-table';const head=el('thead'),tr=el('tr');for(const h of headers){const c=el('th',h);c.setAttribute('scope','col');tr.append(c);}head.append(tr);const body=el('tbody');for(const row of rows){const r=el('tr');for(const value of row)r.append(el('td',String(value)));body.append(r);}t.append(head,body);wrap.append(t);return wrap;}
function section(title:string){const s=el('section');s.className='panel comparison-section';s.append(el('h2',title));root!.append(s);return s;}
function plot(parent:HTMLElement,title:string,values:(number|null)[],from:string,dots=false){parent.append(el('h3',title));const box=el('div');box.className='comparison-chart';const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+'; exact values in data table');box.append(canvas);parent.append(box);charts.push(new Chart(canvas,{type:'line',data:{datasets:[{label:title,data:values.map((y,i)=>({x:Date.parse(from)+(i+.5)*3600000,y})),borderColor:'#333',backgroundColor:'#333',borderWidth:1,pointRadius:dots?2.5:0,showLine:!dots,spanGaps:false}]},options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{type:'linear',ticks:{maxTicksLimit:5,maxRotation:0,callback:v=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23'}).format(Number(v))}},y:{beginAtZero:dots}}}}));}
export function renderTemperature(d:AnyCase){
  clearTemperature();root=el('div');root.id='temperature-content';const main=document.querySelector('main')!;main.insertBefore(root,main.querySelector('footer'));
  document.getElementById('period')!.textContent=`${d.name} · ${utc(d.from)} through ${utc(d.to)} (end exclusive)`;
  document.querySelector<HTMLAnchorElement>('a[href="#matched-reference"]')!.hidden=true;
  const summary=section('Observed outages and airport temperature');
  summary.append(el('p',`${num(d.outage.peakCustomers)} customers at the observed peak · ${d.outage.observations} captures in ${d.outage.hoursWithObservations}/72 hours · ${d.temperature.summary.hoursWithAcceptedReports}/72 hours with accepted temperature reports.`));
  summary.append(el('p',`Temperature range ${num(d.temperature.summary.min)} to ${num(d.temperature.summary.max)} °C. Customer-hours: ${num(d.outage.customerHours)} (${num(d.outage.coverage*100)}% eligible interval coverage; 90% required). ${num(d.outage.firstObservedCustomers)} customers were already affected at the first observation.`));
  const timeline=section('Hourly timeline · UTC');plot(timeline,'Customers affected · observed hourly peak',d.outageHours.map((h:any)=>h.peakCustomers),d.from,true);
  plot(timeline,d.family==='winter'?'Lowest reported temperature · °C':'Highest reported temperature · °C',d.temperature.hours.map((h:any)=>d.family==='winter'?h.minC:h.maxC),d.from);
  const ref=d.matchedReference,match=ref.comparison,s=section('Matched reference period');
  s.append(el('p',`${utc(ref.from)} through ${utc(ref.to)}. ${match.includedHours}/72 paired hours; ${d.comparison.lagHours}-hour additional lag after the preceding completed weather hour on both sides.`));
  s.append(el('p','Each pair uses a capture within 15 minutes of the half hour; paired times differ by at most 10 minutes. The nearest eligible earlier same-weekday reference is selected from 7/14/21/28 days using timestamps and dry, low-wind airport reports. Each paired reference exposure requires known airport precipitation below 0.1 mm, wind below 10 m/s and temperature outside the case threshold. Six pairs are required for a median.'));
  s.append(table(['Case temperature','Pairs','Case median customers','Reference median customers'],match.groups.map((g:any)=>[g.label,g.pairs,num(g.caseMedianCustomers),num(g.referenceMedianCustomers)])));
  s.append(el('p','Exclusions (can overlap): '+Object.entries(match.exclusions).map(([k,v])=>`${k.replaceAll('-',' ')}: ${v}`).join('; ')+'.'));
  const selection=document.createElement('details');selection.append(el('summary','Candidate references and exact paired observations'));
  for(const c of ref.selection.candidates)selection.append(el('p',`${utc(c.from)}: ${c.from===ref.from?'selected':c.eligible?'eligible, farther away':c.reasons.join('; ')}`));
  selection.append(table(['Case capture UTC','Case customers','Reference capture UTC','Reference customers','Included / exclusions'],match.pairs.map((p:any)=>[p.caseCapture?.capturedAt??'Unavailable',p.caseCapture?.customers??'—',p.referenceCapture?.capturedAt??'Unavailable',p.referenceCapture?.customers??'—',p.included?'Included':p.reasons.join('; ')])));s.append(selection);
  const g=d.comparison.geography,spatial=section('Original legacy grid areas');spatial.append(el('p',g.meaning));
  if(g.available){spatial.append(el('p',`${g.gridHours} of ${g.eligibleHours} eligible threshold hours have geometry. Color shows observed peak customers per reported cell. Cells absent from a capture remain unknown.`));
    const div=el('div');div.className='temperature-map';spatial.append(div);map=L.map(div,{zoomControl:true,attributionControl:false,preferCanvas:true,scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false});
    const features=g.geojson.features.filter((f:any)=>f.geometry),max=Math.max(1,...features.map((f:any)=>f.properties.peakCustomers));
    const layer=L.geoJSON({type:'FeatureCollection',features} as any,{style:(f:any)=>({color:'#555',weight:.7,fillColor:'#246b85',fillOpacity:.15+.75*f.properties.peakCustomers/max}),onEachFeature:(f,l)=>{const p=f.properties,box=el('div');box.append(el('strong',`Legacy cell ${p.gridCellId}`),el('p',`${num(p.peakCustomers)} peak customers · ${p.reports} reported captures`));l.bindPopup(box);}}).addTo(map);
    const drawnMap=map,bounds=layer.getBounds();requestAnimationFrame(()=>{if(map===drawnMap&&bounds.isValid()){drawnMap.invalidateSize();drawnMap.fitBounds(bounds,{padding:[16,16],animate:false});}});
    spatial.append(el('p',`Color scale: lighter = 0; darker = ${num(max)} observed customers. Select a polygon for its exact count and number of reports.`));
    const cells=document.createElement('details');cells.append(el('summary','Reported counts by original grid cell'));cells.append(table(['Grid cell','Reported captures','Observed peak customers','Median (≥6 reports)'],g.geojson.features.map((f:any)=>[f.properties.gridCellId,f.properties.reports,num(f.properties.peakCustomers),num(f.properties.medianCustomers)])));spatial.append(cells);
  }else spatial.append(el('p','No verified grid geometry for eligible paired hours. Regional totals remain available.'));
  const events=section('Finalized weather context');events.append(el('p','NOAA Storm Events for Shelby County / forecast zone. Reported hazards are separate from airport measurements and are not outage causes.'));
  for(const e of d.context.records)events.append(el('p',`${e.eventType} · ${utc(e.beginsAt)} to ${utc(e.endsAt)} · event ${e.eventId}`));
  const notes=section('Data and interpretation');for(const text of d.interpretation)notes.append(el('p',text));
  const provenance=el('p',`Publication SHA-256: ${d.publicationSha256}. Original station, event archive, legacy index and input hashes are included in the JSON download.`);provenance.className='comparison-hash';notes.append(provenance);
  const params=new URLSearchParams({view:'comparison',id:d.id,lag:String(d.comparison.lagHours)});
  for(const [label,path] of [['Download hourly CSV','/api/legacy/export.csv?'+params],['Download paired CSV','/api/legacy/export.csv?'+params+'&table=reference'],['Download full JSON and geometry','/api/legacy/series?'+params]]){const p=el('p'),a=document.createElement('a');a.textContent=label;a.href=path;p.append(a);notes.append(p);}
  const details=document.createElement('details');details.append(el('summary','Hourly data'));details.append(table(['Hour UTC','Captures','Peak customers','Prior exposure ends','Temperature °C'],d.comparison.matches.map((h:any)=>[utc(h.from),h.observations,num(h.peakCustomers),h.exposureTo??'Unavailable',num(h.temperatureC)])));notes.append(details);
}

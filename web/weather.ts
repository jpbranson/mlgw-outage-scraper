import L from 'leaflet';
import {Chart} from 'chart.js';
type Frame={availability:string;validAt?:string;offsetSeconds?:number;imageUrl?:string;bbox?:[number,number,number,number];legend?:{label:string;color:string}[];units?:string;intervalStart?:string;intervalEnd?:string;reason?:string;summary?:{minMm:number;maxMm:number};provider?:string};
type Observation={at:string;temperatureF:number|null;windKnots:number|null;gustKnots:number|null;weatherCodes:string|null;latitude:number;longitude:number};
type Weather={selectedAt:string;radar:Frame;rainfall:Frame;station:{availability:string;observation?:Observation|null;records:Observation[];reason?:string;quality?:string};reason?:string};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const put=(id:string,text:string)=>{el(id).textContent=text;};
const time=(at:string|number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(at));
export class WeatherControls {
  private ticket=0;
  private image?:L.ImageOverlay;
  private boundary?:L.Rectangle;
  private data:Weather|null=null;
  private chart:Chart<'line',{x:number;y:number|null}[]>;
  private enabled=true;
  private selectedAt:string|null=null;
  constructor(private map:L.Map) {
    map.createPane('weather');map.getPane('weather')!.style.zIndex='350';map.getPane('weather')!.style.pointerEvents='none';
    el('weather-layer').addEventListener('change',()=>this.renderLayer());
    el<HTMLInputElement>('weather-opacity').addEventListener('input',()=>{const opacity=Number(el<HTMLInputElement>('weather-opacity').value);this.image?.setOpacity(opacity/100);put('weather-opacity-value',`${opacity}%`);});
    el('weather-retry').addEventListener('click',()=>void this.select(this.selectedAt,this.enabled));
    el('station-metric').addEventListener('change',()=>this.renderStation());
    el('station-weather').addEventListener('toggle',()=>this.chart.resize());
    this.chart=new Chart(el<HTMLCanvasElement>('station-chart'),{type:'line',data:{datasets:[]},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
      onResize:(chart,size)=>{chart.options.scales!.x!.ticks!.maxTicksLimit=size.width<500?3:5;},
      scales:{x:{type:'linear',border:{display:false},grid:{color:'#ebebeb',drawTicks:false},ticks:{font:{size:16},maxRotation:0,maxTicksLimit:4,callback:v=>[
        new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(Number(v)),
        new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric'}).format(Number(v))]}},
        y:{border:{display:false},grid:{color:'#ebebeb',drawTicks:false},ticks:{font:{size:16},maxTicksLimit:4}}},
      plugins:{legend:{display:false},tooltip:{titleFont:{size:16},bodyFont:{size:16},cornerRadius:0,callbacks:{title:items=>time(items[0].parsed.x!)}}}}});
  }
  private clearLayer(){this.image?.remove();this.image=undefined;this.boundary?.remove();this.boundary=undefined;}
  async select(at:string|null,enabled:boolean) {
    const ticket=++this.ticket;this.selectedAt=at;this.enabled=enabled;this.data=null;this.clearLayer();
    el('weather-controls').hidden=el('station-weather').hidden=!enabled;
    el('weather-status').hidden=el('weather-legend').hidden=true;
    el('weather-retry').hidden=true;
    this.chart.data.datasets=[];this.chart.update('none');
    put('station-summary',at?'Loading airport observations…':'Select an outage capture to inspect airport weather.');
    put('station-coverage','');put('weather-notes','Weather follows one selected outage capture. Period heatmaps have no weather overlay.');
    if(!enabled||!at)return;
    this.renderLayer();
    try{
      const response=await fetch(`/api/weather?${new URLSearchParams({at})}`,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Weather data is temporarily unavailable.');
      const data=await response.json() as Weather;
      if(ticket!==this.ticket)return;
      if(data.selectedAt!==new Date(at).toISOString())throw Error('Weather selection did not match the capture.');
      this.data=data;this.renderLayer();this.renderStation();
      put('weather-notes',`Selected capture: ${data.selectedAt}. Radar uses a prior frame less than five minutes old; its nominal mosaic time is not every radar scan's observation time. Reflectivity below 5 dBZ is hidden. Transparent radar does not prove dry weather. Rainfall is a retrospective NOAA MRMS Pass 2 estimate with about one hour of publication latency; it measures the stated preceding hour, not ice or snow depth. Transparent rainfall means a zero estimate; gray means missing. The outlined area is the prepared weather extent. Airport reports are from KMEM via IEM, as reported without additional quality control; missing gusts do not mean calm. GHCNh historical quality flags are kept separately. No weather is fetched by opening this page.`);
    }catch(error){if(ticket!==this.ticket)return;put('station-summary','Airport weather unavailable.');put('weather-status',(error as Error).message);el('weather-status').hidden=false;el('weather-retry').hidden=false;}
  }
  private renderLayer() {
    this.clearLayer();const product=el<HTMLSelectElement>('weather-layer').value;
    el('weather-opacity-label').hidden=product==='off';el('weather-status').hidden=product==='off'||!this.enabled;el('weather-legend').hidden=true;
    if(product==='off'||!this.enabled)return;
    const frame=this.data?.[product as 'radar'|'rainfall'];
    if(!frame){put('weather-status',this.selectedAt?'Loading weather for this capture…':'Select a capture to inspect weather.');return;}
    if(frame.availability!=='available'||!frame.imageUrl||!frame.bbox){put('weather-status',frame.reason??this.data?.reason??'Weather unavailable for this capture.');return;}
    const [west,south,east,north]=frame.bbox;
    const ticket=this.ticket;
    this.image=L.imageOverlay(frame.imageUrl,[[south,west],[north,east]],{pane:'weather',opacity:Number(el<HTMLInputElement>('weather-opacity').value)/100,interactive:false});
    const overlay=this.image;
    overlay.on('error',()=>{if(ticket===this.ticket&&this.image===overlay){this.clearLayer();put('weather-status','Weather image unavailable. Outage locations remain usable.');el('weather-legend').hidden=true;el('weather-retry').hidden=false;}});
    overlay.addTo(this.map);
    this.boundary=L.rectangle([[south,west],[north,east]],{pane:'weather',color:'#555',weight:1,dashArray:'3 4',fill:false,interactive:false}).addTo(this.map);
    const offset=Math.round((frame.offsetSeconds??0)/60);
    put('weather-status',product==='radar'?`Radar · ${time(frame.validAt!)} · ${offset<1?'less than 1':offset} min before capture`:
      `Rainfall · ${time(frame.intervalStart!)} – ${time(frame.intervalEnd!)}${frame.summary?.maxMm===0?' · zero estimated rainfall in this area':''}`);
    const legend=el('weather-legend');legend.replaceChildren();legend.hidden=false;
    const title=document.createElement('span');title.textContent=product==='radar'?'Reflectivity (dBZ)':'One-hour estimate (mm)';legend.append(title);
    for(const stop of frame.legend??[]){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=stop.color;swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(stop.label));legend.append(item);}
    const source=document.createElement('a');source.href=product==='radar'?'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/':'https://www.nssl.noaa.gov/projects/mrms/';source.textContent=product==='radar'?'Iowa Environmental Mesonet':'NOAA MRMS';source.target='_blank';source.rel='noopener noreferrer';legend.append(source);
  }
  private renderStation() {
    const data=this.data?.station;if(!data)return;
    const o=data.observation;
    const number=(v:number|null)=>v===null?'unreported':v.toLocaleString('en-US',{maximumFractionDigits:1});
    put('station-summary',o?`${time(o.at)} · ${number(o.temperatureF)} °F · wind ${number(o.windKnots)} kt · gust ${number(o.gustKnots)}${o.gustKnots===null?'':' kt'}${o.weatherCodes?` · ${o.weatherCodes}`:''}`:data.reason??'No eligible airport report.');
    const wind=el<HTMLSelectElement>('station-metric').value==='wind';
    const points=(key:'temperatureF'|'windKnots'|'gustKnots')=>{
      const result:{x:number;y:number|null}[]=[];let prior=0;
      for(const r of data.records){const x=Date.parse(r.at);if(prior&&x-prior>90*60000)result.push({x:prior+1,y:null});result.push({x,y:r[key]});prior=x;}
      return result;
    };
    this.chart.data.datasets=[{label:wind?'Wind (kt)':'Temperature (°F)',data:points(wind?'windKnots':'temperatureF'),borderColor:'#000',backgroundColor:'#000',borderWidth:1.5,pointRadius:2,spanGaps:false}];
    if(wind)this.chart.data.datasets.push({label:'Gust (kt)',data:points('gustKnots'),borderColor:'#000',backgroundColor:'#000',borderDash:[4,4],borderWidth:1,pointRadius:3,pointStyle:'triangle',spanGaps:false});
    this.chart.options.scales!.x!.min=Date.parse(this.data!.selectedAt)-86400000;this.chart.options.scales!.x!.max=Date.parse(this.data!.selectedAt);
    this.chart.update('none');
    put('station-coverage',`${data.records.length} reports in the preceding 24 hours · Central time · gaps are unknown${wind?' · dashed triangles = reported gusts':''}`);
    el('station-chart-wrap').hidden=data.records.length===0;
  }
}

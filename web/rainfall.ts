import L from 'leaflet';
type Range={id:string;from:string;to:string;hours:number};
type Period=Range&{bbox:[number,number,number,number];imageUrl:string;legend:{label:string;color:string}[];
  grid:{width:number;height:number;x0:number;y0:number;dx:number;dy:number};values:(number|null)[];hoursPerCell:number[];
  summary:{availableHours:number;completeCells:number;cells:number;maxMm:number|null};
  areaSummary:{meanMm:number|null;areaTimeCoverage:number;completePeriodAreaFraction:number};completeBlockGroups:number;blockGroupCount:number};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const put=(id:string,value:string)=>{el(id).textContent=value;};
const date=(at:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(at));
async function read<T>(url:string):Promise<T>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Prepared rainfall is unavailable. Retry shortly.');return r.json();}
export class RainfallControls {
  private active=false;private ticket=0;private periods:Range[]=[];private data:Period|null=null;
  private image?:L.ImageOverlay;private border?:L.Rectangle;
  constructor(private map:L.Map,private onRange:(range:Range|null)=>void) {
    map.createPane('rainfall-period');map.getPane('rainfall-period')!.style.zIndex='350';map.getPane('rainfall-period')!.style.pointerEvents='none';
    el('rainfall-hours').addEventListener('change',()=>{this.options();void this.load();});
    el('rainfall-ending').addEventListener('change',()=>void this.load());
    el('rainfall-retry').addEventListener('click',()=>void this.activate(true));
    el<HTMLInputElement>('rainfall-opacity').addEventListener('input',()=>{const value=Number(el<HTMLInputElement>('rainfall-opacity').value);this.image?.setOpacity(value/100);put('rainfall-opacity-value',`${value}%`);});
    map.on('click',event=>this.inspect(event.latlng));
  }
  private clear(){this.image?.remove();this.border?.remove();this.image=undefined;this.border=undefined;this.data=null;this.map.closePopup();el('rainfall-legend').hidden=true;put('rainfall-coverage','');}
  async activate(active:boolean) {
    this.active=active;const ticket=++this.ticket;this.clear();
    for(const id of ['rainfall-controls','rainfall-status','rainfall-coverage'])el(id).hidden=!active;
    if(!active)return;
    this.onRange(null);put('rainfall-status','Loading prepared rainfall periods…');
    el<HTMLSelectElement>('rainfall-ending').disabled=el<HTMLSelectElement>('rainfall-hours').disabled=true;
    try {
      const {periods}=await read<{periods:Range[]}>('/api/weather/periods');if(ticket!==this.ticket||!this.active)return;
      this.periods=periods;this.options();el<HTMLSelectElement>('rainfall-hours').disabled=false;
      await this.load();
    }catch(error){if(ticket===this.ticket&&this.active){put('rainfall-status',(error as Error).message);this.onRange(null);}}
  }
  private options() {
    const hours=Number(el<HTMLSelectElement>('rainfall-hours').value),select=el<HTMLSelectElement>('rainfall-ending'),priorTo=this.periods.find(p=>p.id===select.value)?.to;
    select.replaceChildren();
    for(const range of this.periods.filter(p=>p.hours===hours)){const option=document.createElement('option');option.value=range.id;option.textContent=date(range.to);select.append(option);}
    const matching=this.periods.find(p=>p.hours===hours&&p.to===priorTo);
    if(matching)select.value=matching.id;
    select.disabled=!select.options.length;
  }
  private async load() {
    const ticket=++this.ticket;this.clear();if(!this.active)return;
    const range=this.periods.find(p=>p.id===el<HTMLSelectElement>('rainfall-ending').value);
    this.onRange(range??null);
    if(!range){put('rainfall-status','No prepared rainfall period of this length. Weather remains unknown.');return;}
    put('rainfall-status',`Loading ${range.hours}-hour rainfall…`);
    try {
      const data=await read<Period>(`/api/weather/period?${new URLSearchParams({id:range.id})}`);
      if(ticket!==this.ticket||!this.active)return;
      if(data.id!==range.id||data.from!==range.from||data.to!==range.to||data.hours!==range.hours)throw Error('Rainfall period did not match the selection.');
      this.data=data;const [w,s,e,n]=data.bbox;
      const overlay=L.imageOverlay(data.imageUrl,[[s,w],[n,e]],{pane:'rainfall-period',opacity:Number(el<HTMLInputElement>('rainfall-opacity').value)/100,interactive:false});this.image=overlay;
      overlay.on('error',()=>{if(ticket===this.ticket&&this.image===overlay){this.clear();put('rainfall-status','Rainfall image unavailable. The selected outage history remains usable.');}});overlay.addTo(this.map);
      this.border=L.rectangle([[s,w],[n,e]],{pane:'rainfall-period',color:'#555',weight:1,dashArray:'3 4',fill:false,interactive:false}).addTo(this.map);
      put('rainfall-status',`${data.hours}-hour estimated rainfall · ${date(data.from)} – ${date(data.to)}`);
      const a=data.areaSummary,pct=(n:number)=>`${(n*100).toFixed(1)}%`;
      put('rainfall-coverage',`${data.summary.availableHours}/${data.hours} hourly files · ${pct(a.areaTimeCoverage)} area/time coverage · ${pct(a.completePeriodAreaFraction)} area with a complete total. Mean across the outlined area: ${a.meanMm===null?'unavailable':`${a.meanMm.toFixed(1)} mm`}. Tap the map for a native cell.`);
      const legend=el('rainfall-legend');legend.replaceChildren();legend.hidden=false;
      const label=document.createElement('span');label.textContent='Estimated depth (mm)';legend.append(label);
      for(const stop of data.legend){const span=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=stop.color;swatch.setAttribute('aria-hidden','true');span.append(swatch,document.createTextNode(stop.label));legend.append(span);}
      const source=document.createElement('a');source.href='https://registry.opendata.aws/noaa-mrms-pds/';source.textContent='NOAA MRMS';source.target='_blank';source.rel='noopener noreferrer';legend.append(source);
      put('weather-notes',`Rainfall period: ${data.from} to ${data.to}. Sum of non-overlapping hourly MRMS Pass 2 estimates. A cell needs all ${data.hours} hours for a total; gray is missing and transparent is zero estimated depth. The native grid is 0.01 degrees; display enlargement does not create finer measurements. The outlined-area mean uses native cell areas. ${data.completeBlockGroups}/${data.blockGroupCount} Census block groups have complete rainfall coverage. Values are retrospective estimates, not ice/snow depth or proof of dry weather. Outage history uses the same period and shows only collected records; historical weather creates no outage observations. Opening this page does not download upstream weather.`);
    }catch(error){if(ticket===this.ticket&&this.active){this.clear();put('rainfall-status',(error as Error).message);}}
  }
  private inspect(latlng:L.LatLng) {
    if(!this.active||!this.data)return;const d=this.data,g=d.grid;
    const x=Math.floor((latlng.lng-g.x0)/g.dx+.5),y=Math.floor((latlng.lat-g.y0)/g.dy+.5);
    const node=document.createElement('div');
    if(x<0||y<0||x>=g.width||y>=g.height)node.textContent='Outside the prepared rainfall area.';
    else {const index=y*g.width+x,value=d.values[index];node.textContent=`${d.hours}-hour rainfall: ${value===null?'unknown':`${value.toFixed(1)} mm estimated`}. ${d.hoursPerCell[index]}/${d.hours} valid hours. Native cell, approximately 1 km; not a neighborhood measurement.`;}
    L.popup({maxWidth:280}).setLatLng(latlng).setContent(node).openOn(this.map);
  }
}

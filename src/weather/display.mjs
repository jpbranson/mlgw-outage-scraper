import { decodePng, encodeRgba } from './decode.mjs';
export const DISPLAY_VERSION='weather-display-v3';
// IEM's published lookup table: index 0 is missing; index 1 is -32 dBZ.
export const radarDbz=index=>index===0?null:(index-1)*.5-32;
export const RADAR_LEGEND=[{label:'5–20',color:'#04e9e7'},{label:'20–35',color:'#019f00'},{label:'35–50',color:'#ffff00'},{label:'50–65',color:'#fd0000'},{label:'≥65',color:'#f800fd'}];
export const RAIN_LEGEND=[{label:'0',color:'#ffffff'},{label:'0–1',color:'#deebf7'},{label:'1–5',color:'#9ecae1'},{label:'5–10',color:'#4292c6'},{label:'10–25',color:'#2171b5'},{label:'≥25',color:'#084594'},{label:'Missing',color:'#888888'}];
const color=(hex,alpha=255)=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),alpha];
const mercator=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
// Resample the preserved lat/lon grid into a Web Mercator image. This keeps the
// Leaflet overlay correctly aligned; nearest-neighbor never invents finer values.
export function displayImage(data,product,sourcePng) {
  const [west,south,east,north]=data.bbox,width=512,height=512,pixels=Buffer.alloc(width*height*4),g=data.grid;
  const radar=product==='radar'?decodePng(sourcePng):null;
  const mercNorth=mercator(north),mercSouth=mercator(south);
  for(let y=0;y<height;y++) {
    const my=mercNorth+(y+.5)/height*(mercSouth-mercNorth),lat=(2*Math.atan(Math.exp(my))-Math.PI/2)*180/Math.PI;
    const sy=Math.round((lat-g.y0)/g.dy);
    for(let x=0;x<width;x++) {
      const lon=west+(x+.5)/width*(east-west),sx=Math.round((lon-g.x0)/g.dx);
      if(sx<0||sx>=g.width||sy<0||sy>=g.height)continue;
      let rgba;
      if(radar) {
        // Use preserved palette indices to obtain dBZ, not colors from a tile.
        const index=radar.pixels[(sy+g.top)*radar.width+sx+g.left],dbz=radarDbz(index);
        rgba=dbz===null||dbz<5?[0,0,0,0]:color(RADAR_LEGEND[dbz<20?0:dbz<35?1:dbz<50?2:dbz<65?3:4].color);
      } else {
        const v=data.values[sy*g.width+sx];
        rgba=v===null?color('#888888'):v===0?[255,255,255,0]:color(RAIN_LEGEND[v<1?1:v<5?2:v<10?3:v<25?4:5].color);
      }
      for(let k=0;k<4;k++)pixels[(y*width+x)*4+k]=rgba[k];
    }
  }
  return {version:DISPLAY_VERSION,product,bbox:data.bbox,crs:'EPSG:3857',nativeGrid:{dx:g.dx,dy:g.dy},
    imageBase64:encodeRgba(width,height,pixels).toString('base64'),legend:product==='radar'?RADAR_LEGEND:RAIN_LEGEND,
    units:product==='radar'?'dBZ':'mm',qualityFlags:product==='radar'?['below-5-dBZ-hidden','no-echo-not-proof-of-dry','nominal-mosaic-time']:data.qualityFlags};
}

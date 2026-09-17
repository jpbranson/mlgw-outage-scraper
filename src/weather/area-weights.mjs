import {validateGrid} from './accumulation.mjs';
const DEG=Math.PI/180,R=6371008.8;
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
export const AREA_METHOD='Spherical cylindrical equal-area; straight segments in projected coordinates; R=6371008.8 m';
export const rectangle=([w,s,e,n])=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});
const signedArea=ring=>{let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;};
function clip(ring,axis,edge,greater) {
  if(!ring.length)return [];
  const out=[],inside=p=>greater?p[axis]>=edge:p[axis]<=edge;
  let a=ring.at(-1);
  for(const b of ring) {
    if(inside(a)!==inside(b)) {
      const t=(edge-a[axis])/(b[axis]-a[axis]),p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];p[axis]=edge;out.push(p);
    }
    if(inside(b))out.push(b);a=b;
  }
  return out;
}
// Clip preserved polygons, including holes and multipart pieces, against each
// native weather cell. A polygon can share cells with others; no finer weather
// measurement is created. Inputs must be valid, non-overlapping GeoJSON rings.
export function cellAreaWeights(grid,geometry) {
  const g=validateGrid(grid);
  requireValue(geometry&&['Polygon','MultiPolygon'].includes(geometry.type),'Polygon or MultiPolygon required');
  const raw=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  requireValue(Array.isArray(raw)&&raw.length>0&&raw.length<=10000,'Invalid polygon count');
  const project=([x,y])=>[(x-g.x0)*DEG,Math.sin(y*DEG)-Math.sin(g.y0*DEG)];
  let vertices=0,total=0;const weights=new Map();
  for(const polygon of raw) {
    requireValue(Array.isArray(polygon)&&polygon.length>0,'Invalid polygon');
    const rings=polygon.map(r=>{
      requireValue(Array.isArray(r)&&r.length>=4,'Invalid polygon ring');vertices+=r.length;requireValue(vertices<=100000,'Polygon vertex limit');
      for(const p of r)requireValue(Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=-180&&p[0]<=180&&p[1]>-90&&p[1]<90,'Invalid polygon coordinate');
      requireValue(r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1],'Polygon ring is not closed');
      return r.map(project);
    });
    const area=rings.reduce((sum,r,i)=>sum+(i?-1:1)*Math.abs(signedArea(r)),0);
    requireValue(area>0,'Non-positive polygon area');total+=area;
    const xs=polygon[0].map(p=>p[0]),ys=polygon[0].map(p=>p[1]);
    const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys);
    requireValue(e-w<180,'Dateline polygons are not supported');
    const x1=Math.max(0,Math.floor((w-g.x0)/g.dx+.5)),x2=Math.min(g.width-1,Math.floor((e-g.x0)/g.dx+.5));
    const y1=Math.max(0,Math.floor((n-g.y0)/g.dy+.5)),y2=Math.min(g.height-1,Math.floor((s-g.y0)/g.dy+.5));
    requireValue((x2-x1+1)*(y2-y1+1)*vertices<50000000,'Spatial work limit');
    for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++) {
      const west=g.x0+(x-.5)*g.dx,east=west+g.dx,north=g.y0+(y-.5)*g.dy,south=north+g.dy;
      const [left,bottom]=project([west,south]),[right,top]=project([east,north]);
      let covered=0;
      for(let r=0;r<rings.length;r++) {
        let clipped=rings[r];for(const [axis,edge,greater] of [[0,left,true],[0,right,false],[1,bottom,true],[1,top,false]])clipped=clip(clipped,axis,edge,greater);
        covered+=(r?-1:1)*Math.abs(signedArea(clipped));
      }
      requireValue(covered>=-1e-14,'Invalid hole overlap');
      if(covered>1e-18){const i=y*g.width+x;weights.set(i,(weights.get(i)??0)+covered);}
    }
  }
  const cells=[...weights].map(([index,area])=>({index,areaM2:area*R*R})),areaM2=total*R*R,coveredAreaM2=cells.reduce((s,c)=>s+c.areaM2,0);
  requireValue(coveredAreaM2<=areaM2*(1+1e-8),'Spatial coverage exceeds target area');
  return {method:AREA_METHOD,grid:g,areaM2,coveredAreaM2,spatialCoverage:Math.min(1,coveredAreaM2/areaM2),cells};
}
export function summarizeArea(accumulation,weights) {
  requireValue(JSON.stringify(validateGrid(accumulation.grid))===JSON.stringify(weights.grid),'Area weights belong to a different grid');
  let completeArea=0,completeWeightedSum=0,knownWeightedSum=0,areaHours=0;
  for(const {index,areaM2} of weights.cells) {
    const value=accumulation.values[index];
    if(value!==null){completeArea+=areaM2;completeWeightedSum+=value*areaM2;}
    knownWeightedSum+=accumulation.knownSumMm[index]*areaM2;areaHours+=accumulation.hoursPerCell[index]*areaM2;
  }
  const fraction=Math.min(1,completeArea/weights.areaM2);
  return {method:weights.method,areaKm2:weights.areaM2/1e6,nativeCells:weights.cells.length,spatialCoverage:weights.spatialCoverage,
    completePeriodAreaFraction:fraction,areaTimeCoverage:Math.min(1,areaHours/(weights.areaM2*accumulation.hours)),
    meanMm:fraction>=1-1e-8?completeWeightedSum/completeArea:null,
    meanOverCompleteAreaMm:completeArea?completeWeightedSum/completeArea:null,
    observedContributionMm:knownWeightedSum/weights.areaM2,
    meaning:'Area-weighted estimated depth, not population-weighted. Full-target mean is unavailable if any time/area coverage is missing. Complete-area mean uses only fully observed cells. Observed contribution is partial, not a full-period total.'};
}

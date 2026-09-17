import {instant,windowUtc,HOUR} from './sources.mjs';
export const ACCUMULATION_VERSION='hourly-rainfall-v1';
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
export function hourlyEndpoints(from,to) {
  const range=windowUtc(from,to),start=instant(range.from),end=instant(range.to);
  requireValue(start%HOUR===0&&end%HOUR===0,'Rainfall window must use hourly UTC boundaries');
  return Array.from({length:(end-start)/HOUR},(_,i)=>new Date(start+(i+1)*HOUR).toISOString());
}
export function validateGrid(g) {
  requireValue(g&&Number.isInteger(g.width)&&Number.isInteger(g.height)&&g.width>0&&g.height>0&&g.width*g.height<=1000000&&
    [g.x0,g.y0,g.dx,g.dy].every(Number.isFinite)&&g.dx>0&&g.dy<0,'Invalid rainfall grid');
  requireValue(g.x0-g.dx/2>=-180&&g.x0+(g.width-.5)*g.dx<=180&&g.y0-g.dy/2<90&&g.y0+(g.height-.5)*g.dy>-90,'Grid outside supported lon/lat bounds');
  return Object.fromEntries(['width','height','x0','y0','dx','dy'].map(k=>[k,g[k]]));
}
// Each input covers exactly the preceding hour. Missing hours/cells do not
// become zeros, nor is a sum inflated to compensate for incomplete coverage.
export function accumulateHourly(from,to,frames) {
  const endpoints=hourlyEndpoints(from,to),expected=new Set(endpoints),byTime=new Map();
  requireValue(Array.isArray(frames)&&frames.length<=72,'Rainfall input limit');
  for(const frame of frames) {
    const at=new Date(instant(frame.validAt)).toISOString();
    requireValue(expected.has(at),'Rainfall endpoint outside requested window');
    requireValue(!byTime.has(at),'Duplicate rainfall endpoint; revisions must be resolved explicitly');
    byTime.set(at,frame);
  }
  const available=frames.filter(f=>f.data);
  requireValue(available.length>0,'No verified rainfall grid is available');
  const first=available[0].data,grid=validateGrid(first.grid),n=grid.width*grid.height;
  const identity=d=>JSON.stringify({grid:validateGrid(d.grid),product:d.product,units:d.units,crs:d.crs,
    earthShapeCode:d.earthShapeCode,sourceTables:d.sourceTables,processingVersion:d.processingVersion});
  const expectedIdentity=identity(first),knownSumMm=Array(n).fill(0),hoursPerCell=Array(n).fill(0),missingHours=[],sources=[];
  for(const endpoint of endpoints) {
    const frame=byTime.get(endpoint),d=frame?.data;
    if(!d){missingHours.push({validAt:endpoint,reason:frame?.availability??'not-provided'});continue;}
    requireValue(d.product==='MultiSensor_QPE_01H_Pass2'&&d.units==='mm','Only one-hour MRMS Pass 2 depths in mm can be accumulated');
    requireValue(instant(d.validAt)===instant(endpoint)&&instant(d.intervalEnd)===instant(endpoint)&&instant(d.intervalStart)===instant(endpoint)-HOUR,'Invalid/overlapping rainfall interval');
    requireValue(identity(d)===expectedIdentity,'Rainfall grid/product/version changed within window');
    requireValue(Array.isArray(d.values)&&d.values.length===n&&Array.isArray(d.quality)&&d.quality.length===n,'Rainfall cell count mismatch');
    for(let i=0;i<n;i++) {
      const v=d.values[i],quality=d.quality[i];
      requireValue(v===null?['missing','no-coverage'].includes(quality):Number.isFinite(v)&&v>=0&&v<=2000&&quality==='estimate','Invalid rainfall value/quality');
      if(v!==null){knownSumMm[i]+=v;hoursPerCell[i]++;}
    }
    sources.push({validAt:endpoint,...frame.source});
  }
  const round=v=>Number(v.toFixed(6));
  const values=knownSumMm.map((v,i)=>hoursPerCell[i]===endpoints.length?round(v):null),complete=values.filter(v=>v!==null);
  return {version:ACCUMULATION_VERSION,from:new Date(instant(from)).toISOString(),to:new Date(instant(to)).toISOString(),hours:endpoints.length,
    product:first.product,units:'mm',grid,crs:first.crs,earthShapeCode:first.earthShapeCode,sourceTables:first.sourceTables,
    values,knownSumMm:knownSumMm.map(round),hoursPerCell,missingHours,sources,
    summary:{expectedHours:endpoints.length,availableHours:sources.length,cells:n,completeCells:complete.length,
      minMm:complete.length?Math.min(...complete):null,maxMm:complete.length?Math.max(...complete):null,
      cellHourCoverage:hoursPerCell.reduce((a,b)=>a+b,0)/(n*endpoints.length)},
    meaning:'Sum of non-overlapping one-hour retrospective estimates. Full-period depth is null unless every hour is present. Known sums are partial contributions, never substitute totals; no extrapolation or interpolation.',
    qualityFlags:['estimated-rainfall','retrospective-pass2','frozen-precipitation-uncertain','no-outage-observations-inferred']};
}

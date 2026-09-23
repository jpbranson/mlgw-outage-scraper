import { inflateSync, deflateSync, gunzipSync, crc32 } from 'node:zlib';
import { BBOX, STATION, instant, windowUtc, PROCESSING_VERSION, SUBSET_VERSION } from './sources.mjs';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
// Deliberately narrow PNG support: source N0Q indices, WMS RGBA and GRIB grayscale.
// Reject unknown encoding instead of silently publishing a misleading field.
export function decodePng(body) {
  check(body.subarray(0,8).equals(signature),'Invalid PNG signature');
  let header,palette,alpha,ended=false;const compressed=[];const text={};
  for(let p=8;p<body.length;) {
    check(p+12<=body.length,'Truncated PNG chunk');const n=body.readUInt32BE(p),name=body.toString('ascii',p+4,p+8),end=p+12+n;
    check(end<=body.length,'Truncated PNG data');
    check(crc32(body.subarray(p+4,p+8+n))===body.readUInt32BE(p+8+n),'PNG checksum mismatch');
    const bytes=body.subarray(p+8,p+8+n);
    if(name==='IHDR') {check(!header&&n===13&&p===8,'Invalid PNG header');header=bytes;}
    else if(name==='PLTE') palette=bytes;
    else if(name==='tRNS') alpha=bytes;
    else if(name==='tEXt') {const i=bytes.indexOf(0);if(i>0&&n<4096)text[bytes.toString('utf8',0,i)]=bytes.toString('utf8',i+1);}
    else if(name==='IDAT')compressed.push(bytes);
    else if(name==='IEND') {check(n===0&&end===body.length,'Unexpected bytes after PNG');ended=true;}
    else check(name[0]===name[0].toLowerCase(),'Unsupported critical PNG chunk');
    p=end;
  }
  check(header&&ended&&compressed.length,'Incomplete PNG');
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],type=header[9];
  check(width>0&&height>0&&width*height<=70000000&&header[10]===0&&header[11]===0&&header[12]===0,'Unsupported PNG geometry/encoding');
  const bpp=type===3&&depth===8?1:type===0&&depth===16?2:type===0&&depth===8?1:type===6&&depth===8?4:0;
  check(bpp>0,'Unsupported PNG pixel type');
  if(type===3)check(palette?.length&&palette.length%3===0,'PNG palette missing');
  const stride=width*bpp,expected=(stride+1)*height;
  check(expected<=140000000,'PNG expansion limit');
  const raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});check(raw.length===expected,'PNG decompressed size mismatch');
  const pixels=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];check(filter<=4,'Invalid PNG filter');
    for(let x=0;x<stride;x++) {
      const idx=y*stride+x,a=x>=bpp?pixels[idx-bpp]:0,b=y?pixels[idx-stride]:0,c=y&&x>=bpp?pixels[idx-stride-bpp]:0;
      let predictor=0;
      if(filter===1)predictor=a;
      if(filter===2)predictor=b;
      if(filter===3)predictor=Math.floor((a+b)/2);
      if(filter===4){const v=a+b-c,pa=Math.abs(v-a),pb=Math.abs(v-b),pc=Math.abs(v-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      pixels[idx]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,depth,type,bpp,pixels,palette,alpha,text};
}
export function encodeRgba(width,height,pixels) {
  check(pixels.length===width*height*4&&width*height<=1000000,'Invalid cropped PNG dimensions');
  const chunk=(name,bytes)=> {const b=Buffer.alloc(bytes.length+12);b.writeUInt32BE(bytes.length);b.write(name,4);bytes.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,b.length-4)),b.length-4);return b;};
  const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)pixels.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([signature,chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function indices(grid,bbox) {
  check(Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)&&bbox[0]<bbox[2]&&bbox[1]<bbox[3],'Invalid bounding box');
  const [west,south,east,north]=bbox,{x0,y0,dx,dy,width,height}=grid;
  const epsilon=1e-7;
  check(dx>0&&dy<0&&west>=x0-dx/2-epsilon&&east<=x0+(width-.5)*dx+epsilon&&north<=y0-dy/2+epsilon&&south>=y0+(height-.5)*dy-epsilon,'Bounding box outside grid');
  const left=Math.ceil((west-x0)/dx-1e-6),right=Math.floor((east-x0)/dx+1e-6),top=Math.ceil((north-y0)/dy-1e-6),bottom=Math.floor((south-y0)/dy+1e-6);
  const w=right-left+1,h=bottom-top+1;check(w>0&&h>0&&w*h<=1000000,'Subset exceeds local cell budget');
  return {left,top,width:w,height:h,x0:x0+left*dx,y0:y0+top*dy,dx,dy};
}
export function radarSubset(pngBytes,worldBytes) {
  const png=decodePng(pngBytes);check(png.type===3,'Expected indexed N0Q source');
  const values=worldBytes.toString('utf8').trim().split(/\s+/).map(Number);
  check(values.length===6&&values.every(Number.isFinite),'Invalid radar world file');
  const [dx,r1,r2,dy,x0,y0]=values;check(r1===0&&r2===0,'Rotated radar grid unsupported');
  const grid={x0,y0,dx,dy,width:png.width,height:png.height},subset=indices(grid,BBOX),rgba=Buffer.alloc(subset.width*subset.height*4);
  let transparent=0;
  for(let y=0;y<subset.height;y++)for(let x=0;x<subset.width;x++) {
    const v=png.pixels[(y+subset.top)*png.width+x+subset.left],dest=(y*subset.width+x)*4;
    check(v*3+2<png.palette.length,'Invalid radar palette index');
    png.palette.copy(rgba,dest,v*3,v*3+3);rgba[dest+3]=png.alpha?.[v]??255;if(rgba[dest+3]===0)transparent++;
  }
  return {processingVersion:SUBSET_VERSION,crs:'EPSG:4326',bbox:BBOX,grid:subset,sourceGrid:grid,sourceText:png.text,
    transparentPixels:transparent,interpretation:'Display only; transparent/low-reflectivity pixels do not establish dry weather or valid radar coverage.',
    pngBase64:encodeRgba(subset.width,subset.height,rgba).toString('base64')};
}
const signed16=(b,p)=>{const n=b.readUInt16BE(p);return n&0x8000?-(n&0x7fff):n;};
const signed32=(b,p)=>{const n=b.readUInt32BE(p);return n>=0x80000000?-(n-0x80000000):n;};
export function rainfallSubset(compressed,validAt,bbox=BBOX) {
  const bytes=gunzipSync(compressed,{maxOutputLength:32*1024*1024});
  check(bytes.toString('ascii',0,4)==='GRIB'&&bytes[7]===2&&bytes[6]===209&&bytes.readBigUInt64BE(8)===BigInt(bytes.length)&&bytes.toString('ascii',bytes.length-4)==='7777','Invalid MRMS GRIB2 envelope');
  const sections={};let p=16;
  while(p<bytes.length-4) {check(p+5<=bytes.length-4,'Truncated GRIB header');const n=bytes.readUInt32BE(p),s=bytes[p+4];check(n>=5&&p+n<=bytes.length-4&&!sections[s],'Invalid or repeated GRIB section');sections[s]=bytes.subarray(p,p+n);p+=n;}
  check(p===bytes.length-4&&[1,3,4,5,6,7].every(s=>sections[s]),'Incomplete GRIB message');
  const s1=sections[1],s3=sections[3],s4=sections[4],s5=sections[5],s6=sections[6];
  check(s1.length===21&&s1.readUInt16BE(5)===161,'Unexpected MRMS originating centre');
  const sourceAt=new Date(Date.UTC(s1.readUInt16BE(12),s1[14]-1,s1[15],s1[16],s1[17],s1[18])).toISOString();
  check(instant(sourceAt)===instant(validAt),'MRMS time differs from requested endpoint');
  check(s3.length===72&&s3.readUInt16BE(12)===0&&s3[71]===0&&s3[10]===0,'Unsupported MRMS grid template/scan');
  check(s4.length===34&&s4.readUInt16BE(7)===0&&s4[9]===6&&s4[10]===37&&s4.readUInt32BE(18)===0,'Unexpected MRMS product/forecast');
  // Template 5.41 stores 8- or 16-bit grayscale PNG values; both decode with the same exact scaling.
  const bits=s5[19];check(s5.length===21&&s5.readUInt16BE(9)===41&&[8,16].includes(bits)&&s6.length===6&&s6[5]===255,'Unsupported MRMS packing/bitmap');
  const basic=s3.readUInt32BE(38),div=s3.readUInt32BE(42),unit=basic===0?1e-6:basic/div;
  check(Number.isFinite(unit)&&unit>0,'Invalid GRIB angle unit');
  const grid={width:s3.readUInt32BE(30),height:s3.readUInt32BE(34),x0:signed32(s3,50)*unit,y0:signed32(s3,46)*unit,dx:s3.readUInt32BE(63)*unit,dy:-s3.readUInt32BE(67)*unit};
  if(grid.x0>180)grid.x0-=360;
  let xlast=signed32(s3,59)*unit;if(xlast>180)xlast-=360;
  check(Math.abs(grid.x0+(grid.width-1)*grid.dx-xlast)<1e-5&&Math.abs(grid.y0+(grid.height-1)*grid.dy-signed32(s3,55)*unit)<1e-5,'MRMS endpoint/grid inconsistency');
  check(grid.width*grid.height===s3.readUInt32BE(6)&&grid.width*grid.height===s5.readUInt32BE(5),'MRMS grid point count mismatch');
  const png=decodePng(sections[7].subarray(5));check(png.width===grid.width&&png.height===grid.height&&png.type===0&&png.depth===bits,'MRMS PNG/grid mismatch');
  const subset=indices(grid,bbox),reference=s5.readFloatBE(11),binary=signed16(s5,15),decimal=signed16(s5,17);
  check(Number.isFinite(reference)&&Math.abs(binary)<=30&&Math.abs(decimal)<=10,'Unsupported MRMS scaling');
  const values=[],quality=[];
  for(let y=0;y<subset.height;y++)for(let x=0;x<subset.width;x++) {
    const i=(y+subset.top)*grid.width+x+subset.left,packed=bits===16?png.pixels.readUInt16BE(i*2):png.pixels[i],value=(reference+packed*2**binary)*10**(-decimal);
    const missing=Math.abs(value+1)<1e-6,noCoverage=Math.abs(value+3)<1e-6;
    check(missing||noCoverage||(Number.isFinite(value)&&value>=0&&value<=2000),'Unrecognized rainfall value');
    values.push(missing||noCoverage?null:Number(value.toFixed(6)));quality.push(missing?'missing':noCoverage?'no-coverage':'estimate');
  }
  const present=values.filter(v=>v!==null);
  return {processingVersion:SUBSET_VERSION,product:'MultiSensor_QPE_01H_Pass2',units:'mm',validAt:sourceAt,intervalStart:new Date(instant(sourceAt)-3600000).toISOString(),intervalEnd:sourceAt,
    crs:'GRIB template 3.0 native latitude/longitude',earthShapeCode:s3[14],bbox,grid:subset,sourceGrid:grid,packing:{template:41,reference,binaryScale:binary,decimalScale:decimal},
    sourceTables:{master:s1[9],local:s1[10],process:s4[13]},values,quality,
    summary:{cells:values.length,validCells:present.length,missingCells:values.length-present.length,minMm:present.length?Math.min(...present):null,maxMm:present.length?Math.max(...present):null},
    qualityFlags:['retrospective-pass2-estimate','zero-not-proof-of-dry-weather','frozen-precipitation-uncertain']};
}
export function stationSubset(bytes,from,to) {
  const range=windowUtc(from,to),start=instant(range.from),end=instant(range.to),lines=bytes.toString('utf8').trimEnd().split(/\r?\n/),header=lines.shift().split('|');
  const required=['STATION','DATE','LATITUDE','LONGITUDE','temperature','temperature_Quality_Code','wind_speed','wind_speed_Quality_Code','precipitation_Measurement_Code'];
  check(new Set(header).size===header.length&&required.every(x=>header.includes(x)),'Station file lacks timestamps, identity or quality columns');
  check(lines.length<=100000,'Station row budget exceeded');
  const dateIndex=header.indexOf('DATE'),stationIndex=header.indexOf('STATION'),rows=[];
  let sourceFirst=Infinity,sourceLast=-Infinity;
  for(const line of lines) {
    const cells=line.split('|');check(cells.length===header.length,'Malformed station row');
    check(cells[stationIndex]===STATION,'Unexpected station');
    const at=cells[dateIndex].endsWith('Z')?cells[dateIndex]:`${cells[dateIndex]}Z`,time=instant(at);
    sourceFirst=Math.min(sourceFirst,time);sourceLast=Math.max(sourceLast,time);
    if(time<start||time>=end)continue;
    const row=Object.fromEntries(header.map((key,i)=>[key,cells[i]]));row.DATE=new Date(time).toISOString();rows.push(row);
  }
  const hours=new Set(rows.map(r=>r.DATE.slice(0,13)));
  return {processingVersion:PROCESSING_VERSION,station:STATION,range,rows,
    sourceCoverage:{first:lines.length?new Date(sourceFirst).toISOString():null,last:lines.length?new Date(sourceLast).toISOString():null},
    coverage:{records:rows.length,hoursWithReports:hours.size,requestedHours:(end-start)/3600000},
    qualityFlags:['raw-source-quality-and-measurement-codes-retained','not-quality-filtered','blank-and-trace-not-zero','report-hours-not-complete-measurement-coverage']};
}
export function warningSubset(bytes,validAt) {
  const collection=JSON.parse(bytes.toString('utf8'));
  check(collection.type==='FeatureCollection'&&Array.isArray(collection.features)&&collection.features.length<=5000,'Invalid warning collection');
  const at=instant(validAt);
  for(const feature of collection.features) {
    check(feature.type==='Feature'&&['Polygon','MultiPolygon'].includes(feature.geometry?.type),'Unsupported warning geometry');
    const props=feature.properties;
    check(props&&typeof props.issue==='string'&&typeof props.expire==='string','Missing warning times');
    check(instant(props.issue)<=at&&at<instant(props.expire),'Warning outside requested valid time');
  }
  return {processingVersion:PROCESSING_VERSION,validAt,collection,qualityFlags:['MEG-forecast-area-not-Shelby-only','warned-area-not-confirmed-damage','no-warning-not-proof-of-no-hazard']};
}

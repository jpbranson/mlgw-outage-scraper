// Synthetic, time-stamped GRIB/PNG fixture. Never import into the live cache.
import {deflateSync,gzipSync,crc32} from 'node:zlib';
export function rainfallGrib(at) {
  const width=80,height=60,n=width*height;
  const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=16;
  const raw=Buffer.alloc((width*2+1)*height);
  for(let i=0;i<n;i++)raw.writeUInt16BE(i%2?10:0,Math.floor(i/width)*(width*2+1)+1+(i%width)*2);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  const section=(number,length)=>{const b=Buffer.alloc(length);b.writeUInt32BE(length);b[4]=number;return b;};
  const time=new Date(at),s1=section(1,21);s1.writeUInt16BE(161,5);s1.writeUInt16BE(time.getUTCFullYear(),12);s1[14]=time.getUTCMonth()+1;s1[15]=time.getUTCDate();s1[16]=time.getUTCHours();
  const s3=section(3,72);s3.writeUInt32BE(n,6);s3[14]=2;s3.writeUInt32BE(width,30);s3.writeUInt32BE(height,34);s3.writeUInt32BE(1,38);s3.writeUInt32BE(1000000,42);
  s3.writeUInt32BE(35495000,46);s3.writeUInt32BE(269605000,50);s3.writeUInt32BE(34905000,55);s3.writeUInt32BE(270395000,59);s3.writeUInt32BE(10000,63);s3.writeUInt32BE(10000,67);
  const s4=section(4,34);s4[9]=6;s4[10]=37;
  const s5=section(5,21);s5.writeUInt32BE(n,5);s5.writeUInt16BE(41,9);s5.writeUInt16BE(1,17);s5[19]=16;
  const s6=section(6,6);s6[5]=255;
  const s7=section(7,png.length+5);png.copy(s7,5);
  const header=Buffer.alloc(16);header.write('GRIB');header[6]=209;header[7]=2;
  const b=Buffer.concat([header,s1,s3,s4,s5,s6,s7,Buffer.from('7777')]);b.writeBigUInt64BE(BigInt(b.length),8);return gzipSync(b);
}

import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// Identity and manifest byte counts always describe the original provider body.
// Compression is a storage representation, not a new source revision.
export function readWeatherObject(root,manifest,{maxBytes,format='auto'}={}) {
  const body=manifest.body;
  if(!body||!/^[a-f0-9]{64}$/.test(body.sha256)||!Number.isSafeInteger(body.bytes)||body.bytes<0)throw Error('Missing or invalid weather object');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||body.bytes>maxBytes)throw Error('Cached weather object exceeds response limit');
  if(!['auto','raw','gzip'].includes(format))throw Error('Invalid weather object format');
  for(const representation of format==='auto'?['gzip','raw']:[format]) {
    const path=join(root,'objects',body.sha256+(representation==='gzip'?'.raw.gz':'.raw'));
    let stat;
    try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT'&&format==='auto'&&representation==='gzip')continue;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Weather object must be a regular file');
    if(stat.size>maxBytes+(representation==='gzip'?65536:0))throw Error('Cached weather object exceeds response limit');
    const stored=readFileSync(path),bytes=representation==='gzip'?gunzipSync(stored,{maxOutputLength:Math.max(1,body.bytes)}):stored;
    if(bytes.length!==body.bytes||sha256(bytes)!==body.sha256)throw Error('Weather cache checksum mismatch');
    return bytes;
  }
}

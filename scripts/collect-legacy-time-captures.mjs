import {readFile,writeFile,mkdir} from 'node:fs/promises';import{createHash}from'node:crypto';
const root='data/legacy/time-evidence';await mkdir(root+'/captures',{recursive:true});let requests=0,total=0;
const download = process.argv.includes('--download');
async function get(url, key) {
  let data;
  try { data = await readFile(root + '/' + key); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!download) throw Error('Missing evidence; use --download explicitly: ' + key);
    if (++requests > 35) throw Error('request bound');
    const r = await fetch(url, { headers: { 'User-Agent': 'mlgw-outage-history-audit' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!r.ok) throw Error(r.status + ' ' + url);
    const chunks = []; let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length; total += chunk.length;
      if (size > 4 * 1024 ** 2 || total > 16 * 1024 ** 2) throw Error('byte bound');
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks); await writeFile(root + '/' + key, data);
  }
  return data;
}
const wanted=['83d631d311c6d9e897c06651d0a0f875c274bd69','ad1e9add60650049f4fbb9d7227a2567a008e4b4','f0eec4138d00a517109058420f5d19822a01f24c','3ed0553af385ba0e454c3556b9a160e07baad50b','c2d260a1aa30cc9b190fb96a6e6db46ffd5a6022','b8801751e658cfd39a4aebe5242b5d2f5dcb4b45','1cbca96c3fbca08e7e0594762658ab1ea49242ca','ea0c8309337171b398ffadd5d6105d997f9b354b'];
const samples=JSON.parse(await readFile(root+'/sample-commits.json'));const result=[];
for(const sample of samples.filter(c=>wanted.includes(c.commit))){const c=JSON.parse(await get(`https://api.github.com/repos/jpbranson/${sample.repo}/commits/${sample.commit}`,sample.commit+'-detail.json'));const files=c.files.filter(f=>f.status==='added'&&/^data\/.*\.(RData|txt|rds)$/.test(f.filename));for(const f of files){if((f.filename.endsWith('.txt')||f.filename.endsWith('_txt.rds'))&&!['switch2024','summer2024','winter2025'].includes(sample.label))continue;const ext=f.filename.endsWith('.RData')?'.RData':f.filename.endsWith('.rds')?'.rds':'.txt';const key='captures/'+f.sha+ext;const data=await get(`https://raw.githubusercontent.com/jpbranson/${sample.repo}/${sample.commit}/${f.filename}`,key);if(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`),data])).digest('hex')!==f.sha)throw Error('blob mismatch');result.push({...sample,path:f.filename,blob:f.sha,sha256:createHash('sha256').update(data).digest('hex'),local:root+'/'+key});}}
await writeFile(root+'/captures.json',JSON.stringify(result,null,2));console.log(JSON.stringify({requests,total,captures:result.map(r=>({repo:r.repo,time:r.time,path:r.path,blob:r.blob}))},null,2));
const columns = Object.keys(result[0] ?? {});
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
await writeFile(root + '/capture-inputs.csv', [columns.map(csv).join(','),
  ...result.map(row => columns.map(key => csv(row[key])).join(','))].join('\n') + '\n');

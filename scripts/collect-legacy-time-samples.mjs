import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='data/legacy/time-evidence';
const download = process.argv.includes('--download');
const pins=JSON.parse(await readFile('data/legacy/pins.json')).repositories;
const windows=[
['mlgw.outage','2022-12-02T15:00:00Z','2022-12-02T16:00:00Z','dec02'],
['mlgw.outage','2022-12-24T06:45:00Z','2022-12-24T07:40:00Z','dec24'],
['mlgw.outage','2023-06-26T03:45:00Z','2023-06-26T04:05:00Z','storm2023'],
['mlgw.outage.2','2024-04-28T20:30:00Z','2024-04-28T22:00:00Z','switch2024'],
['mlgw.outage.3','2024-09-12T18:00:00Z','2024-09-12T18:45:00Z','summer2024'],
['mlgw.outage.3','2025-02-20T20:00:00Z','2025-02-20T20:45:00Z','winter2025']];
let requests=0,total=0;
async function get(url, key) {
  let data;
  try { data = await readFile(root + '/' + key); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!download) throw Error('Missing evidence; use --download explicitly: ' + key);
    if (++requests > 24) throw Error('request bound');
    const r = await fetch(url, { headers: { 'User-Agent': 'mlgw-outage-history-audit' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!r.ok) throw Error(r.status + ' ' + url);
    const chunks = []; let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length; total += chunk.length;
      if (total > 16 * 1024 ** 2 || size > 4 * 1024 ** 2) throw Error('byte bound');
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks); await writeFile(root + '/' + key, data);
  }
  return data;
}
let all=[];
for(const [repo,since,until,label]of windows){const pin=pins.find(p=>p.name===repo);const raw=await get(`https://api.github.com/repos/jpbranson/${repo}/commits?sha=${pin.commit}&since=${since}&until=${until}&per_page=30`,label+'-commits.json');const commits=JSON.parse(raw);if(commits.length>=30)throw Error('pagination needed');for(const c of commits)all.push({repo,label,commit:c.sha,time:c.commit.committer.date,message:c.commit.message,author:c.commit.author.name});}
await writeFile(root+'/sample-commits.json',JSON.stringify(all,null,2));console.log(JSON.stringify({requests,total,commits:all},null,2));

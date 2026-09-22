import {readFileSync,existsSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);if(args.length>1||(args.length&&args[0]!=='stop'))throw Error('Usage: node scripts/weather-maintenance-status.mjs [stop]');
const root='data/weather/maintenance';
if(args[0]==='stop') {writeFileSync(root+'/stop','Owner requested stop\n');console.log('Weather stop requested; the runner checks every 30 seconds. Collector and preview are unaffected.');}
else {
  const s=JSON.parse(readFileSync(root+'/state.json')),age=(Date.now()-Date.parse(s.heartbeatAt))/1000;
  console.log(JSON.stringify({pid:s.pid,runner:existsSync(root+'/runner.lock')&&!s.stopReason?(age<=90?'running':'stale'):'stopped',heartbeatAt:s.heartbeatAt,
    endsAt:s.endsAt,nextDueAt:s.nextDueAt,lastRunAt:s.lastRun?.at,status:s.status??null,lastError:s.lastError??null,requests:s.lastRun?.requests,downloadBytes:s.lastRun?.downloadBytes,
    rollingBytes:s.lastRun?.rollingBytes,evidenceBytes:s.lastRun?.evidenceBytes,totalCap:s.lastRun?.totalCap},null,2));
}

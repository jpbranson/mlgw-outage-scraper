import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assessTrial} from '../src/durable/trial-acceptance.mjs';
if(process.argv.length!==2)throw Error('Usage: node scripts/accept-collector-trial.mjs');
const health=JSON.parse(execFileSync(process.execPath,['scripts/collector.mjs','status'],{encoding:'utf8',maxBuffer:8*1024*1024}));
const state=JSON.parse(readFileSync('data/collector/run-state.json'));
let result=assessTrial(health,state);
if(result.status!=='awaiting-trial-end') {
  execFileSync(process.execPath,['scripts/verify-durable.mjs'],{stdio:'pipe',maxBuffer:8*1024*1024});
  result=assessTrial(health,state,{restore:JSON.parse(readFileSync('reports/durable-verification.json'))});
}
const report={checkedAt:new Date().toISOString(),...result,health};
writeFileSync('reports/collector-trial-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(result,null,2));
if(result.status==='review-required')process.exitCode=1;

const DAY=86400000;
export function assessTrial(health,state,{now=Date.now(),restore=null}={}) {
  const start=Date.parse(state?.startedAt),end=Date.parse(state?.endsAt),completed=Date.parse(state?.completedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<7*DAY)throw Error('Original seven-day trial bounds unavailable');
  const ready=now>=end&&Number.isFinite(completed)&&completed>=end,failures=[];
  if(!ready)return {status:'awaiting-trial-end',accepted:false,endsAt:state.endsAt,completedAt:state.completedAt??null,failures:['Original trial must end and its runner must record completion before acceptance.']};
  // Observed-window coverage alone can conceal missing time at either end.
  if(health.validSlotCoverage<.99)failures.push('Observed valid slot coverage below 99%');
  if(health.observedHours<7*24-5/60)failures.push('Capture history does not span the full trial');
  if((health.gapsOver10Minutes??[]).some(g=>g.minutes>15))failures.push('Gaps over 15 minutes require documented explanation');
  if(health.pendingRollupDays!==0)failures.push('Rollup maintenance is incomplete');
  if(!health.latest||Math.abs(Date.parse(health.latest.capturedAt)-end)>5*60000)failures.push('Final capture is not within five minutes of original trial end');
  if(health.storage?.pressure!=='ok')failures.push('Storage pressure requires review');
  if(!restore||Date.parse(restore.checkedAt)<end||restore.realCaptureRestore?.validSnapshots!==health.validSnapshots||restore.realCaptureRestore?.snapshotsRestored!==health.snapshots)failures.push('A fresh complete archive restore is required');
  const rejected=(health.attemptsByOutcome??[]).filter(o=>!['valid','duplicate_slot'].includes(o.outcome)&&o.count>0);
  if(rejected.length)failures.push('Source failures or rejected captures require review');
  return {status:failures.length?'review-required':'passed',accepted:failures.length===0,startedAt:state.startedAt,endsAt:state.endsAt,completedAt:state.completedAt,failures,
    scope:'Local seven-day observation/storage/restore gate. Cloud provider gates are independent.'};
}

const key = id => `activity_logs:${id}`;

export function hasResult(log) {
  if(log.method==='yes_no')return log.yesNo!=null;
  if(log.method==='duration')return log.actualMinutes!=null;
  return (log.sets||[]).some(set=>set.actual!=null);
}

function sameResult(a,b) {
  if(a.method!==b.method)return false;
  if(a.method==='yes_no')return a.yesNo===b.yesNo;
  if(a.method==='duration')return a.actualMinutes===b.actualMinutes;
  return JSON.stringify((a.sets||[]).map(set=>set.actual??null))===
    JSON.stringify((b.sets||[]).map(set=>set.actual??null));
}

function samePlan(a,b) {
  return a.time===b.time&&a.name===b.name&&a.description===b.description&&
    a.categoryId===b.categoryId&&a.missionId===b.missionId&&
    a.method===b.method&&a.unit===b.unit&&a.targetMinutes===b.targetMinutes&&
    JSON.stringify((a.sets||[]).map(set=>set.target))===JSON.stringify((b.sets||[]).map(set=>set.target));
}

function copyResult(from,to) {
  if(from.method==='yes_no')to.yesNo=from.yesNo;
  else if(from.method==='duration'){to.actualMinutes=from.actualMinutes;to.doneAt=from.doneAt}
  else {to.sets=to.sets.map((set,index)=>({...set,actual:from.sets[index]?.actual??null}));to.doneAt=from.doneAt}
}

export function adoptCloudOccurrence(data,meta,pending,remote,revisions) {
  const local=data.logs.find(log=>log.id===pending.id);
  if(!local)return;
  data.logs=data.logs.filter(log=>log.id!==remote.id||log===local);
  local.id=remote.id;
  pending.id=remote.id;
  pending.key=key(remote.id);
  pending.baseRevision=revisions[pending.key];
  meta.revisions[pending.key]=pending.baseRevision;
}

export function reconcilePendingLogs(data,meta,cloudState,revisions) {
  for(const pending of [...meta.pending.filter(item=>item.table==='activity_logs')]) {
    const local=data.logs.find(log=>log.id===pending.id);
    if(!local?.scheduleId||revisions[pending.key]!=null)continue;
    const remote=cloudState.logs.find(log=>log.scheduleId===local.scheduleId&&log.date===local.date);
    if(!remote)continue;
    if(hasResult(local)&&hasResult(remote)&&!sameResult(local,remote)) {
      meta.conflictKey=pending.key;
      meta.occurrenceConflict={localId:local.id,remoteId:remote.id};
      throw new Error('Conflict: this scheduled activity was recorded on another device. Choose which result to keep in Settings.');
    }
    if(samePlan(local,remote)&&(!hasResult(local)||sameResult(local,remote))) {
      data.logs=data.logs.filter(log=>log.id!==local.id);
      meta.pending=meta.pending.filter(item=>item!==pending);
      continue;
    }
    if(!hasResult(local)&&hasResult(remote))copyResult(remote,local);
    adoptCloudOccurrence(data,meta,pending,remote,revisions);
  }
}

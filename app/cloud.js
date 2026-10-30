import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const cloud = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});

const assert = ({data, error}) => { if (error) throw error; return data; };
const iso = () => new Date().toISOString();
const entities = ['category_legend','missions','activities','schedules','schedule_exceptions','activity_logs'];
export const entityKey = (table,id) => `${table}:${id}`;

async function allRows(table) {
  const rows=[];
  for(let start=0;;start+=1000) {
    const batch=assert(await cloud.from(table).select('*').range(start,start+999));
    rows.push(...batch);
    if(batch.length<1000) return rows;
  }
}
async function dataUrl(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
  });
}
async function mediaFor(path,cache) {
  if(!path) return '';
  if(cache[path]) return cache[path];
  const blob=assert(await cloud.storage.from('activity-media').download(path));
  cache[path]=await dataUrl(blob);
  return cache[path];
}
async function uploadMedia(record) {
  if(record.mediaPath) return record.mediaPath;
  if(!record.media?.startsWith('data:image/')) throw new Error('Image or GIF is missing.');
  const mime=record.media.slice(5,record.media.indexOf(';'));
  const ext=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':mime==='image/gif'?'gif':mime==='image/webp'?'webp':'img';
  const path=`${record.id}.${ext}`;
  const blob=await (await fetch(record.media)).blob();
  const uploaded=await cloud.storage.from('activity-media').upload(path,blob,{contentType:mime,upsert:false});
  if(uploaded.error && String(uploaded.error.statusCode)!=='409') throw uploaded.error;
  record.mediaPath=path;
  return path;
}
function payload(table,item) {
  switch(table) {
    case 'category_legend': return {id:item.id,name:item.name,emoji:item.emoji,archived_at:item.archived?item.archivedAt||iso():null};
    case 'missions': return {id:item.id,name:item.name,archived_at:item.archived?item.archivedAt||iso():null};
    case 'activities': return {id:item.id,name:item.name,description:item.description,category_id:item.categoryId,mission_id:item.missionId||null,media_path:item.mediaPath,tracking_method:item.method,amount_unit:item.method==='amount'?item.unit:null,target_segments:item.method==='amount'?item.targets:null,target_duration_minutes:item.method==='duration'?item.targetMinutes:null,archived_at:item.archived?item.archivedAt||iso():null};
    case 'schedules': return {id:item.id,activity_id:item.activityId,kind:item.kind==='date'?'one_date':'weekdays',on_date:item.kind==='date'?item.date:null,weekdays:item.kind==='weekdays'?item.weekdays:null,start_time:item.time,starts_on:item.startsOn,ends_on:item.endsOn||null};
    case 'schedule_exceptions': return {id:item.id,schedule_id:item.scheduleId,on_date:item.date,is_cancelled:!!item.cancelled,start_time:item.time||null,target_segments:item.targets||null,target_duration_minutes:item.targetMinutes??null,mission_override_set:!!item.missionSet,mission_id:item.missionSet?item.missionId:null,display_order:item.displayOrder??null};
    case 'activity_logs': return {id:item.id,activity_date:item.date,start_time:item.time,activity_id:item.activityId||null,schedule_id:item.scheduleId||null,name:item.name,description:item.description,category_id:item.categoryId||null,category_name:item.categoryName,category_emoji:item.categoryEmoji,mission_id:item.missionId||null,mission_name:item.missionName||null,media_path:item.mediaPath,tracking_method:item.method,amount_unit:item.method==='amount'?item.unit:null,target_duration_minutes:item.method==='duration'?item.targetMinutes:null,actual_duration_minutes:item.method==='duration'?item.actualMinutes:null,yes_no_result:item.method==='yes_no'?item.yesNo:null,done_at:item.method==='yes_no'?null:item.doneAt||null};
  }
}
function local(table,row) {
  switch(table) {
    case 'category_legend': return {id:row.id,name:row.name,emoji:row.emoji,archived:!!row.archived_at,archivedAt:row.archived_at};
    case 'missions': return {id:row.id,name:row.name,archived:!!row.archived_at,archivedAt:row.archived_at};
    case 'activities': return {id:row.id,name:row.name,description:row.description,categoryId:row.category_id,missionId:row.mission_id,mediaPath:row.media_path,method:row.tracking_method,unit:row.amount_unit,targets:row.target_segments||[],targetMinutes:row.target_duration_minutes,archived:!!row.archived_at,archivedAt:row.archived_at};
    case 'schedules': return {id:row.id,activityId:row.activity_id,kind:row.kind==='one_date'?'date':'weekdays',date:row.on_date,weekdays:row.weekdays||[],time:row.start_time.slice(0,5),startsOn:row.starts_on,endsOn:row.ends_on};
    case 'schedule_exceptions': return {id:row.id,scheduleId:row.schedule_id,date:row.on_date,cancelled:row.is_cancelled,time:row.start_time?.slice(0,5)||null,targets:row.target_segments,targetMinutes:row.target_duration_minutes,missionSet:row.mission_override_set,missionId:row.mission_id,displayOrder:row.display_order};
    case 'activity_logs': return {id:row.id,date:row.activity_date,time:row.start_time.slice(0,5),activityId:row.activity_id,scheduleId:row.schedule_id,name:row.name,description:row.description,categoryId:row.category_id,categoryName:row.category_name,categoryEmoji:row.category_emoji,missionId:row.mission_id,missionName:row.mission_name,mediaPath:row.media_path,method:row.tracking_method,unit:row.amount_unit,targetMinutes:row.target_duration_minutes,actualMinutes:row.actual_duration_minutes,yesNo:row.yes_no_result,doneAt:row.done_at,createdAt:row.created_at,sets:[]};
  }
}
export async function pullCloud(cache={}) {
  const [settings,...groups]=await Promise.all([allRows('settings'),...entities.map(allRows),allRows('set_results')]);
  const sets=groups.pop();
  const state={settings:{timeZone:settings[0]?.tracker_time_zone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'},categories:[],missions:[],activities:[],schedules:[],exceptions:[],logs:[]};
  const map={category_legend:'categories',missions:'missions',activities:'activities',schedules:'schedules',schedule_exceptions:'exceptions',activity_logs:'logs'};
  const revisions={};
  for(let index=0;index<entities.length;index++) for(const row of groups[index]) {
    const table=entities[index], item=local(table,row);
    state[map[table]].push(item);revisions[entityKey(table,item.id)]=row.revision;
  }
  for(const set of sets) {
    const log=state.logs.find(item=>item.id===set.activity_log_id);
    if(log) log.sets.push({target:Number(set.target_amount),actual:set.actual_amount==null?null:Number(set.actual_amount),number:set.segment_number});
  }
  for(const log of state.logs) log.sets.sort((a,b)=>a.number-b.number);
  const paths=new Set([...state.activities,...state.logs].map(item=>item.mediaPath).filter(Boolean));
  await Promise.all([...paths].map(path=>mediaFor(path,cache)));
  for(const item of [...state.activities,...state.logs]) item.media=cache[item.mediaPath]||'';
  return {state,revisions,mediaCache:cache,settingsRevision:settings[0]?.revision||null,ownerReady:!!settings.length};
}
async function stableSetId(logId,number) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${logId}:${number}`))).slice(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function pushRecord(table,item,baseRevision) {
  if(table==='activities'||table==='activity_logs') await uploadMedia(item);
  const values=payload(table,item);
  let result;
  if(baseRevision==null) result=assert(await cloud.from(table).insert(values).select('revision').single());
  else {
    const response=await cloud.from(table).update(values).eq('id',item.id).eq('revision',baseRevision).select('revision').maybeSingle();
    result=assert(response);
    if(!result) throw new Error(`Conflict: ${table} changed on another device. Local edit kept for review.`);
  }
  if(table==='activity_logs'&&item.method==='amount') {
    const rows=await Promise.all(item.sets.map(async (set,index)=>({id:await stableSetId(item.id,index+1),activity_log_id:item.id,segment_number:index+1,unit:item.unit,target_amount:set.target,actual_amount:set.actual??null})));
    try {assert(await cloud.from('set_results').upsert(rows,{onConflict:'activity_log_id,segment_number'}));}
    catch(error) {error.syncedRevision=result.revision;throw error;}
  }
  return result.revision;
}
export async function updateTimeZone(value,baseRevision) {
  const result=assert(await cloud.from('settings').update({tracker_time_zone:value}).eq('id',true).eq('revision',baseRevision).select('revision').maybeSingle());
  if(!result) throw new Error('Conflict: time zone changed on another device. Local value kept.');
  return result.revision;
}

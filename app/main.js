import {cloud, entityKey, pullCloud, pushRecord, updateTimeZone} from './cloud.js';
import {APP_AUTH_EMAIL} from './config.js';

const DB_NAME = 'stride-local-v1';
const STORE = 'app';
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function writeData(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, 'state');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
const starter = () => ({
  settings:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'},
  categories:[['💪','Strength'],['🏃','Cardio'],['🧘','Mobility'],['🏋️','Other']].map(([emoji,name])=>({id:uid(),emoji,name,archived:false})),
  missions:[], activities:[], schedules:[], exceptions:[], logs:[]
});
let data;
let lastSavedState;
let session=null;
let unlocked=false;
let syncing=false;
let syncTimer;
let syncError='';
const ui = {page:'home',date:'',expanded:null,editingActivity:null,modal:null};
const arrays={category_legend:'categories',missions:'missions',activities:'activities',schedules:'schedules',schedule_exceptions:'exceptions',activity_logs:'logs'};
function syncMeta() {
  data._sync ||= {pending:[],revisions:{},settingsRevision:null,remoteInitialized:false,mediaCache:{}};
  return data._sync;
}
async function passcodeHash(passcode,salt) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(passcode),'PBKDF2',false,['deriveBits']);
  return [...new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},key,256))];
}
async function saveOfflineVerifier(passcode) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  syncMeta().offlineVerifier={salt:[...salt],hash:await passcodeHash(passcode,salt)};
  await writeData(data);
}
async function unlockWithPasscode(passcode) {
  if(navigator.onLine) {
    const result=await cloud.auth.signInWithPassword({email:APP_AUTH_EMAIL,password:passcode});
    if(result.error)throw new Error('Incorrect passcode or sign-in unavailable.');
    session=result.data.session;
    unlocked=true;
    await saveOfflineVerifier(passcode);
    render();scheduleSync(0);
  } else {
    const verifier=syncMeta().offlineVerifier;
    if(!verifier)throw new Error('Connect once to enable offline access on this device.');
    const hash=await passcodeHash(passcode,new Uint8Array(verifier.salt));
    if(hash.length!==verifier.hash.length||!hash.every((byte,index)=>byte===verifier.hash[index]))throw new Error('Incorrect passcode.');
    unlocked=true;render();
  }
}
function queueChange(table,id) {
  const meta=syncMeta(), key=entityKey(table,id);
  const current=meta.pending.find(item=>item.key===key);
  if(current) current.changeId=uid();
  else meta.pending.push({key,table,id,baseRevision:meta.revisions[key]??null,changeId:uid()});
}
function recordChanges() {
  const before=lastSavedState||{settings:{},categories:[],missions:[],activities:[],schedules:[],exceptions:[],logs:[]};
  for(const [table,field] of Object.entries(arrays)) {
    const old=new Map((before[field]||[]).map(item=>[item.id,item]));
    for(const item of data[field]) if(JSON.stringify(item)!==JSON.stringify(old.get(item.id))) queueChange(table,item.id);
  }
  if(data.settings.timeZone!==before.settings?.timeZone) queueChange('settings','owner');
}
function localHasWork() {
  return data.activities.length||data.missions.length||data.schedules.length||data.exceptions.length||data.logs.length||
    data.categories.some(item=>!['Strength','Cardio','Mobility','Other'].includes(item.name)||item.archived);
}
function queueExistingLocalData() {
  for(const [table,field] of Object.entries(arrays)) for(const item of data[field]) queueChange(table,item.id);
}
function syncLabel() {
  if(!navigator.onLine)return `Offline · ${syncMeta().pending.length} pending`;
  if(!session)return 'Saved on device · sign in to sync';
  if(syncing)return 'Syncing…';
  if(syncError)return `Sync needs attention · ${syncMeta().pending.length} pending`;
  if(!syncMeta().ownerReady)return 'Cloud account setup needed';
  return syncMeta().pending.length?`${syncMeta().pending.length} changes pending`:'Synced';
}
function scheduleSync(delay=500) {
  clearTimeout(syncTimer);
  if(session&&navigator.onLine&&!syncMeta().conflictKey)syncTimer=setTimeout(()=>syncNow().catch(error=>{syncError=error.message;render()}),delay);
}
async function syncNow() {
  if(syncing||!session||!navigator.onLine||syncMeta().conflictKey)return;
  syncing=true;syncError='';render();
  try {
    const meta=syncMeta();
    const initial=await pullCloud(meta.mediaCache);
    meta.ownerReady=initial.ownerReady;
    if(!initial.ownerReady) throw new Error('Cloud account setup is incomplete.');
    if(!meta.remoteInitialized) {
      if(localHasWork()) queueExistingLocalData();
      else if(!initial.state.categories.length) for(const item of data.categories)queueChange('category_legend',item.id);
      meta.remoteInitialized=true;
    }
    const order=['settings','category_legend','missions','activities','schedules','schedule_exceptions','activity_logs'];
    for(const table of order) for(const pending of [...meta.pending.filter(entry=>entry.table===table)]) {
      const current=meta.pending.find(entry=>entry.key===pending.key);
      if(!current)continue;
      const changeId=current.changeId;
      if(table==='settings') {
        if(current.baseRevision==null) current.baseRevision=initial.settingsRevision;
        let revision;
        try {revision=await updateTimeZone(data.settings.timeZone,current.baseRevision);}
        catch(error) {if(error.message?.startsWith('Conflict:'))meta.conflictKey=current.key;throw error;}
        meta.settingsRevision=revision;
        current.baseRevision=revision;
      } else {
        const item=data[arrays[table]].find(row=>row.id===current.id);
        if(!item)continue;
        if(table==='activity_logs'&&item.activityId&&!item.mediaPath)item.mediaPath=data.activities.find(row=>row.id===item.activityId)?.mediaPath||null;
        if(current.baseRevision==null&&initial.revisions[current.key]!=null)current.baseRevision=initial.revisions[current.key];
        const snapshot=structuredClone(item);
        let revision;
        try {revision=await pushRecord(table,snapshot,current.baseRevision);}
        catch(error) {
          if(error.syncedRevision!=null)current.baseRevision=error.syncedRevision;
          if(error.message?.startsWith('Conflict:'))meta.conflictKey=current.key;
          if(snapshot.mediaPath&&item.media===snapshot.media)item.mediaPath=snapshot.mediaPath;
          await writeData(data);
          throw error;
        }
        if(snapshot.mediaPath&&item.media===snapshot.media)item.mediaPath=snapshot.mediaPath;
        meta.revisions[current.key]=revision;
        current.baseRevision=revision;
      }
      if(current.changeId===changeId) meta.pending=meta.pending.filter(entry=>entry!==current);
      await writeData(data);
    }
    const fresh=await pullCloud(meta.mediaCache);
    const dirty=new Set(meta.pending.map(item=>item.key));
    for(const [table,field] of Object.entries(arrays)) {
      const localRows=new Map(data[field].map(item=>[item.id,item]));
      data[field]=fresh.state[field].map(item=>dirty.has(entityKey(table,item.id))?localRows.get(item.id)||item:item);
      for(const item of localRows.values())if(dirty.has(entityKey(table,item.id))&&!data[field].some(row=>row.id===item.id))data[field].push(item);
    }
    if(!dirty.has(entityKey('settings','owner')))data.settings=fresh.state.settings;
    meta.revisions={...fresh.revisions,...Object.fromEntries(meta.pending.map(item=>[item.key,meta.revisions[item.key]]).filter(([,revision])=>revision!=null))};
    meta.settingsRevision=fresh.settingsRevision;
    meta.mediaCache=fresh.mediaCache;
    lastSavedState=structuredClone(data);
    await writeData(data);
  } catch(error) {syncError=error.message||'Sync failed';await writeData(data);}
  finally {syncing=false;render();}
}
async function resolveConflict(useLocal) {
  const meta=syncMeta(), key=meta.conflictKey;
  if(!key)return;
  const fresh=await pullCloud(meta.mediaCache);
  const pending=meta.pending.find(item=>item.key===key);
  if(useLocal&&pending)pending.baseRevision=key==='settings:owner'?fresh.settingsRevision:fresh.revisions[key]??null;
  else meta.pending=meta.pending.filter(item=>item.key!==key);
  meta.conflictKey=null;syncError='';await writeData(data);scheduleSync(0);render();
}

function dateParts(date = new Date()) {
  const pieces = new Intl.DateTimeFormat('en-US',{timeZone:data.settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get = type => pieces.find(item=>item.type===type)?.value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}
const today = () => dateParts().date;
const isPast = date => date < today();
const isBeforeStart = (date,time) => `${date}T${time}` > `${dateParts().date}T${dateParts().time}`;
const weekday = date => {const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day===0?7:day};
const nextDate = date => {const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+1);return value.toISOString().slice(0,10)};
const fmtDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'});
const fmtDuration = minutes => minutes==null?'—':`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
function parseDuration(value) {
  if (!/^\d{1,3}:\d{2}$/.test(value)) return null;
  const [hours,minutes]=value.split(':').map(Number);
  return minutes<60?hours*60+minutes:null;
}
function toast(message) {
  const element=$('#toast'); element.textContent=message; element.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>element.classList.add('hidden'),2600);
}
async function persist(message) {recordChanges();await writeData(data);lastSavedState=structuredClone(data);render();if(message)toast(message);scheduleSync()}
function category(id) {return data.categories.find(item=>item.id===id)}
function mission(id) {return data.missions.find(item=>item.id===id)}
function activity(id) {return data.activities.find(item=>item.id===id)}
function exception(scheduleId,date) {return data.exceptions.find(item=>item.scheduleId===scheduleId&&item.date===date)}
function matches(schedule,date) {
  if (date<schedule.startsOn || (schedule.endsOn&&date>schedule.endsOn)) return false;
  return schedule.kind==='date' ? schedule.date===date : schedule.weekdays.includes(weekday(date));
}
function planFor(schedule,date) {
  const source=activity(schedule.activityId);
  if (!source || source.archived || !matches(schedule,date)) return null;
  const change=exception(schedule.id,date);
  if (change?.cancelled) return null;
  const cat=category(source.categoryId), group=mission(change?.missionSet?change.missionId:source.missionId);
  return {
    id:`virtual:${schedule.id}:${date}`, date, scheduleId:schedule.id, activityId:source.id,
    time:change?.time||schedule.time, name:source.name, description:source.description,
    categoryId:source.categoryId, categoryName:cat?.name||'Category', categoryEmoji:cat?.emoji||'🏋️',
    missionId:group?.id||null, missionName:group?.name||null, media:source.media,
    method:source.method, unit:source.unit||null,
    targets:change?.targets||source.targets||[], targetMinutes:change?.targetMinutes??source.targetMinutes??null,
    sets:(change?.targets||source.targets||[]).map(target=>({target,actual:null})),
    actualMinutes:null,yesNo:null,doneAt:null
  };
}
function scheduleRows(date) {return data.schedules.map(schedule=>planFor(schedule,date)).filter(Boolean)}
function rowsFor(date) {
  const logs=data.logs.filter(log=>log.date===date);
  const loggedSchedules=new Set(logs.map(log=>log.scheduleId).filter(Boolean));
  const virtual=scheduleRows(date).filter(row=>!loggedSchedules.has(row.scheduleId));
  return [...logs,...virtual].sort((a,b)=>a.time.localeCompare(b.time)||a.name.localeCompare(b.name));
}
function makeLog(plan) {return {...plan,id:uid(),sets:plan.sets.map(set=>({...set})),createdAt:new Date().toISOString()}}
function getOrCreateLog(row) {
  if (!row.id.startsWith('virtual:')) return row;
  const log=makeLog(row);data.logs.push(log);return log;
}
function materializeMissedDates() {
  const end=today(); let changed=false;
  for(const schedule of data.schedules) {
    let date=schedule.startsOn;
    let guard=0;
    while(date<=end && (!schedule.endsOn||date<=schedule.endsOn) && guard++<3650) {
      if(!data.logs.some(log=>log.scheduleId===schedule.id&&log.date===date)) {
        const plan=planFor(schedule,date);
        if(plan&&(date<end||!isBeforeStart(date,plan.time))){data.logs.push(makeLog(plan));changed=true}
      }
      date=nextDate(date);
    }
  }
  return changed;
}
function pageHead(eyebrow,title,description,action='') {return `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`}
function rowSummary(row) {
  if(row.method==='yes_no')return 'Yes / No';
  if(row.method==='duration')return `Target ${fmtDuration(row.targetMinutes)} · ${row.actualMinutes==null?'unmarked':`actual ${fmtDuration(row.actualMinutes)}`}`;
  const targets=row.sets.map(set=>set.target).join(' / ');
  const marked=row.sets.filter(set=>set.actual!=null).length;
  return `${row.sets.length} ${row.unit==='reps'?'sets':'target'} · ${targets} ${esc(row.unit)} · ${marked} logged`;
}
function resultStatus(row) {
  if(row.method==='yes_no')return row.yesNo===true?'Yes':row.yesNo===false?'No':isPast(row.date)?'Skipped':'Pending';
  if(row.method==='duration')return row.actualMinutes!=null?(row.actualMinutes>=row.targetMinutes?'Met target':'Below target'):isPast(row.date)?'Skipped':'Pending';
  const done=row.sets.filter(set=>set.actual!=null);
  if(!done.length)return isPast(row.date)?'Skipped':'Pending';
  return done.length===row.sets.length&&done.every(set=>set.actual>=set.target)?'Met target':`${done.length}/${row.sets.length} logged`;
}
function renderActivityRow(row) {
  const expanded=ui.expanded===row.id;
  const locked=isPast(row.date);
  const quick=row.method==='yes_no'?`<div class="yes-no" role="group" aria-label="${esc(row.name)} result"><button type="button" data-answer="yes" data-id="${row.id}" class="${row.yesNo===true?'chosen':''}" ${locked?'disabled':''}>Yes</button><button type="button" data-answer="no" data-id="${row.id}" class="${row.yesNo===false?'chosen':''}" ${locked?'disabled':''}>No</button></div>`:`<span class="status-pill ${resultStatus(row)==='Pending'?'muted':resultStatus(row)==='Skipped'?'warn':''}">${esc(resultStatus(row))}</span>`;
  let inputs='';
  if(row.method==='amount')inputs=row.sets.map((set,index)=>`<div class="set-row"><strong>${row.unit==='reps'?`Set ${index+1}`:'Amount'}</strong><span>Target ${esc(set.target)} ${esc(row.unit)}</span><input class="actual-set" type="number" min="0" step="any" value="${set.actual??''}" placeholder="Actual" ${locked?'disabled':''} aria-label="Actual ${esc(row.unit)} for segment ${index+1}"></div>`).join('');
  if(row.method==='duration')inputs=`<div class="set-row"><strong>Time</strong><span>Target ${fmtDuration(row.targetMinutes)}</span><input id="actual-duration" value="${row.actualMinutes==null?'':fmtDuration(row.actualMinutes)}" placeholder="hh:mm" inputmode="numeric" ${locked?'disabled':''} aria-label="Actual duration"></div>`;
  if(row.method==='yes_no')inputs='<p>Use Yes or No in the compact row.</p>';
  const canEditPlan=!locked&&isBeforeStart(row.date,row.time);
  const action=row.method==='yes_no'?'':locked?'':`<button class="primary-button" type="button" data-done="${row.id}">${row.doneAt?'Update result':'Done'}</button>`;
  return `<article class="activity-card ${expanded?'expanded':''}"><div class="activity-summary" role="button" tabindex="0" data-expand="${row.id}"><span class="time">${esc(row.time)}</span><span class="category-icon">${esc(row.categoryEmoji)}</span><span class="activity-copy"><strong>${esc(row.name)}</strong><small>${esc(row.description)}</small><em>${row.missionName?`${esc(row.missionName)} · `:''}${rowSummary(row)}</em></span><span class="activity-right">${quick}<span class="chevron">${expanded?'⌃':'⌄'}</span></span></div>${expanded?`<div class="activity-expanded"><img class="media-preview" src="${esc(row.media)}" alt="${esc(row.name)}"><div class="expanded-content"><p>${esc(row.description)}</p>${inputs}<div class="expanded-actions"><span>${canEditPlan?`<button class="text-button" type="button" data-edit-date="${row.id}">Edit this date</button>`:`<span class="muted">${locked?'Date locked':'Plan locked after start'}</span>`}</span>${action}</div></div></div>`:''}</article>`;
}
function renderHome() {
  const selected=ui.date, rows=rowsFor(selected), locked=isPast(selected);
  const recorded=rows.filter(row=>row.method==='yes_no'?row.yesNo!=null:row.method==='duration'?row.actualMinutes!=null:row.sets.some(set=>set.actual!=null)).length;
  return `${pageHead('Your day',selected===today()?'Today, '+fmtDate(selected):fmtDate(selected),locked?'Locked · results cannot be changed':'Activities in start-time order')}
  <div class="stats"><div class="stat"><strong>${rows.length}</strong><span>Planned</span></div><div class="stat"><strong>${recorded}</strong><span>Recorded</span></div><div class="stat"><strong>${rows.length?rows.at(-1).time:'—'}</strong><span>Last start</span></div></div>
  <div class="section-heading"><span>Timeline</span><span class="status-pill ${locked?'muted':''}">${locked?'🔒 Locked':selected===today()?'● Today':'Upcoming'}</span></div>
  ${rows.length?rows.map(renderActivityRow).join(''):`<div class="empty"><strong>Nothing planned for this date</strong><p>Use + to add an activity for this date, or create a repeating activity in Activities.</p></div>`}`;
}
function renderActivities() {
  const items=data.activities.filter(item=>!item.archived).sort((a,b)=>a.name.localeCompare(b.name));
  return `${pageHead('Library','Activities','Reusable activities, targets, media, and schedules.',`<button class="primary-button" type="button" data-new-activity>+ New activity</button>`)}
  <button class="outline-button" type="button" data-page="categories">Manage emoji categories</button>
  <div class="section-heading"><span>Active activities</span><span>${items.length}</span></div>
  ${items.length?items.map(item=>{const cat=category(item.categoryId);return `<div class="list-card"><span class="icon">${esc(cat?.emoji||'🏋️')}</span><span class="details"><strong>${esc(item.name)}</strong><small>${esc(item.description)} · ${esc(item.method)}</small></span><button class="text-button" type="button" data-edit-activity="${item.id}">Edit</button></div>`}).join(''):`<div class="empty"><strong>No reusable activities yet</strong><p>Create one here with its target, image or GIF, and schedule.</p></div>`}`;
}
function renderCategories() {
  const rows=data.categories.filter(item=>!item.archived);
  return `${pageHead('Activities','Category legend','Editable emoji choices used by activities.',`<button class="primary-button" type="button" data-add-category>+ Category</button>`)}<div class="panel">${rows.map(item=>`<div class="list-card"><span class="icon">${esc(item.emoji)}</span><span class="details"><strong>${esc(item.name)}</strong></span><button class="text-button" type="button" data-edit-category="${item.id}">Edit</button></div>`).join('')}</div>`;
}
function renderMissions() {
  const rows=data.missions.filter(item=>!item.archived);
  return `${pageHead('Group activities','Missions','Optional groups. Each activity keeps its own schedule.',`<button class="primary-button" type="button" data-add-mission>+ Mission</button>`)}
  ${rows.length?rows.map(item=>`<div class="list-card"><span class="icon">▦</span><span class="details"><strong>${esc(item.name)}</strong><small>${data.activities.filter(a=>!a.archived&&a.missionId===item.id).length} activities</small></span><button class="text-button" type="button" data-edit-mission="${item.id}">Edit</button></div>`).join(''):`<div class="empty"><strong>No Missions yet</strong><p>Missions are optional. Activities without one still appear on Home by start time.</p></div>`}`;
}
function renderSettings() {
  const zones=Intl.supportedValuesOf?.('timeZone')||['UTC','Asia/Kolkata','Europe/London','America/New_York'];
  if(!zones.includes(data.settings.timeZone))zones.unshift(data.settings.timeZone);
  return `${pageHead('Preferences','Settings','One time zone applies throughout the tracker.')}
  <div class="panel"><div class="field"><label for="timezone">Tracker time zone</label><select id="timezone">${zones.map(zone=>`<option value="${esc(zone)}" ${zone===data.settings.timeZone?'selected':''}>${esc(zone)}</option>`).join('')}</select></div><p class="muted">The device time zone supplied the initial value. This setting governs dates and midnight locking.</p></div>
  <div class="panel"><strong>Cloud sync</strong><p class="muted">${esc(syncLabel())}${syncError?` · ${esc(syncError)}`:''}</p>${!session&&navigator.onLine?'<form id="passcode-form"><div class="field"><label for="passcode">Passcode to reconnect</label><input id="passcode" name="passcode" type="password" inputmode="numeric" autocomplete="current-password" required></div><button class="primary-button" type="submit">Reconnect</button></form>':''}<div class="form-actions"><button class="outline-button" type="button" data-sync-now ${!session||!navigator.onLine||syncing?'disabled':''}>Sync now</button><button class="text-button" type="button" data-sign-out>Lock app</button></div>${syncMeta().conflictKey?`<p>This record changed on another device. Choose which version to keep.</p><div class="form-actions"><button class="outline-button" type="button" data-use-cloud>Use cloud</button><button class="primary-button" type="button" data-use-local>Keep mine</button></div>`:''}<p class="muted">Changes stay on this device while offline. Synced changes leave the pending queue; cached data stays available offline.</p></div>`;
}
function renderLock() {
  return `<div class="panel" style="max-width:420px;margin:8vh auto"><p class="eyebrow">Stride</p><h1>Unlock tracker</h1><p class="muted">Enter your fixed passcode. Connect once on each device to use it offline.</p><form id="passcode-form"><div class="field"><label for="passcode">Passcode</label><input id="passcode" name="passcode" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></div><div class="form-actions"><button class="primary-button" type="submit">Unlock</button></div></form>${syncError?`<p class="muted">${esc(syncError)}</p>`:''}</div>`;
}
function targetRows(values) {return values.map((value,index)=>`<div class="target-editor"><span>${index+1}</span><input class="target-value" type="number" min="0.001" step="any" value="${esc(value)}" aria-label="Target ${index+1}"><button type="button" data-remove-target aria-label="Remove target">×</button></div>`).join('')}
function activityEditor(mode='library',existing=null) {
  const schedule=existing?data.schedules.find(item=>item.activityId===existing.id):null;
  const selectedCategory=existing?.categoryId||data.categories.find(item=>!item.archived)?.id;
  const selectedMission=existing?.missionId||'';
  const selectedMethod=existing?.method||'amount';
  const selectedKind=mode==='date-only'?'date':schedule?.kind||'weekdays';
  const targetValues=existing?.targets?.length?existing.targets:[10];
  return `<form id="activity-form" data-mode="${mode}" data-id="${existing?.id||''}">
    <div class="form-grid"><div class="field"><label for="activity-name">Activity name</label><input id="activity-name" name="name" required value="${esc(existing?.name||'')}" placeholder="e.g. Bench press"></div><div class="field"><label for="category-id">Category</label><select id="category-id" name="categoryId" required>${data.categories.filter(item=>!item.archived||item.id===selectedCategory).map(item=>`<option value="${item.id}" ${item.id===selectedCategory?'selected':''}>${esc(item.emoji)} ${esc(item.name)}</option>`).join('')}</select></div></div>
    <div class="field"><label for="description">One-line description</label><input id="description" name="description" required maxlength="160" value="${esc(existing?.description||'')}" placeholder="A short cue for this activity"></div>
    <div class="form-grid"><div class="field"><label for="mission-id">Mission · optional</label><select id="mission-id" name="missionId"><option value="">No Mission</option>${data.missions.filter(item=>!item.archived||item.id===selectedMission).map(item=>`<option value="${item.id}" ${item.id===selectedMission?'selected':''}>${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label for="activity-time">Start time</label><input id="activity-time" name="time" type="time" required value="${esc(schedule?.time||'07:00')}"></div></div>
    <div class="field"><label for="activity-media">Image or GIF · required</label>${existing?`<img class="media-preview" src="${esc(existing.media)}" alt="Activity media" style="max-width:160px;height:100px">`:`<input id="activity-media" name="media" type="file" accept="image/*" required>`}</div>
    <div class="field"><label for="method">Tracking method</label><select id="method" name="method"><option value="amount" ${selectedMethod==='amount'?'selected':''}>Amount / target</option><option value="duration" ${selectedMethod==='duration'?'selected':''}>Duration</option><option value="yes_no" ${selectedMethod==='yes_no'?'selected':''}>Yes / No</option></select></div>
    <div id="amount-fields" ${selectedMethod!=='amount'?'class="hidden"':''}><div class="form-grid"><div class="field"><label for="unit">Unit</label><input id="unit" name="unit" value="${esc(existing?.unit||'reps')}" placeholder="reps, km, etc."></div><div class="field"><label>Targets · one minimum</label><div id="target-list">${targetRows(targetValues)}</div><button class="text-button" type="button" data-add-target>+ Add set / segment</button></div></div></div>
    <div id="duration-fields" ${selectedMethod!=='duration'?'class="hidden"':''}><div class="field"><label for="duration-target">Target duration · hh:mm</label><input id="duration-target" name="targetDuration" inputmode="numeric" value="${existing?.targetMinutes!=null?fmtDuration(existing.targetMinutes):'00:30'}" placeholder="00:30"></div></div>
    ${mode==='library'?`<div class="field"><label>Schedule</label><div class="radio-row"><label><input type="radio" name="kind" value="weekdays" ${selectedKind==='weekdays'?'checked':''}> Selected weekdays</label><label><input type="radio" name="kind" value="date" ${selectedKind==='date'?'checked':''}> One date</label></div></div>
    <div id="weekdays-fields" ${selectedKind!=='weekdays'?'class="hidden"':''}><div class="field"><label>Days of week · one shared start time</label><div class="weekday-row">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((name,index)=>`<label><input type="checkbox" name="weekday" value="${index+1}" ${(schedule?.weekdays||[]).includes(index+1)?'checked':''}>${name}</label>`).join('')}</div></div><div class="form-grid"><div class="field"><label for="starts-on">Starts on</label><input id="starts-on" name="startsOn" type="date" value="${schedule?.startsOn||today()}"></div><div class="field"><label for="ends-on">Ends on · optional</label><input id="ends-on" name="endsOn" type="date" value="${schedule?.endsOn||''}"></div></div></div>
    <div id="date-fields" ${selectedKind!=='date'?'class="hidden"':''}><div class="field"><label for="on-date">Date</label><input id="on-date" name="onDate" type="date" value="${schedule?.date||ui.date}"></div></div>`:`<div class="notice">This new activity exists only on ${fmtDate(ui.date)}. It will not appear in the reusable library.</div>`}
    <div class="form-actions"><button class="outline-button" type="button" data-cancel-editor>Cancel</button><button class="primary-button" type="submit">${existing?'Save changes':'Create activity'}</button></div>
  </form>`;
}
function renderEditor() {
  const existing=ui.editingActivity?activity(ui.editingActivity):null;
  return `${pageHead('Activities',existing?'Edit activity':'Create activity','Set a clear target, required media, and the schedule.')}<div class="panel">${activityEditor('library',existing)}${existing?`<button class="danger-button" type="button" data-archive-activity="${existing.id}">Archive activity</button>`:''}</div>`;
}
function render() {
  const locked=!unlocked;
  $('#menu-button').classList.toggle('hidden',locked);
  $('#date-button').classList.toggle('hidden',locked);
  $('#date-picker').value=ui.date;
  $('#date-button').textContent=ui.date===today()?`Today · ${fmtDate(ui.date)} ▾`:`${fmtDate(ui.date)} ▾`;
  // Keep the live editor node while background sync/auth updates arrive.
  // Replacing it would clear text, targets, and the selected media file.
  if(locked||ui.page!=='editor'||!$('#activity-form')||!$('#main').contains($('#activity-form')))
    $('#main').innerHTML=locked?renderLock():ui.page==='home'?renderHome():ui.page==='activities'?renderActivities():ui.page==='categories'?renderCategories():ui.page==='missions'?renderMissions():ui.page==='editor'?renderEditor():renderSettings();
  $('#add-button').classList.toggle('hidden',locked||ui.page!=='home'||isPast(ui.date));
  $('#storage-state').textContent=locked?'Locked':syncLabel();
}
function openModal(title,body) {
  $('#modal').innerHTML=`<div class="modal-head"><div><p class="eyebrow">${esc(ui.date)}</p><h2>${esc(title)}</h2></div><button class="icon-button" type="button" data-close-modal aria-label="Close">×</button></div>${body}`;
  $('#modal-backdrop').classList.remove('hidden');
}
function closeModal() {$('#modal-backdrop').classList.add('hidden');$('#modal').innerHTML=''}
function addChoice() {
  openModal('Add to this date',`<button class="option" type="button" data-add-existing>Choose existing activity<small>Add it once on ${fmtDate(ui.date)}</small></button><button class="option" type="button" data-add-new>Create new activity<small>Stored only on this date</small></button>`);
}
function addExisting() {
  const options=data.activities.filter(item=>!item.archived).map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('');
  openModal('Choose activity',options?`<form id="existing-form"><div class="field"><label for="existing-activity">Activity</label><select id="existing-activity" name="activityId">${options}</select></div><div class="field"><label for="existing-time">Start time</label><input id="existing-time" type="time" name="time" required value="18:00"></div><div class="form-actions"><button class="outline-button" type="button" data-back-add>Back</button><button class="primary-button" type="submit">Add to date</button></div></form>`:`<div class="empty"><strong>No reusable activities yet</strong><p>Create one in Activities, or make a new date-only activity here.</p></div><button class="outline-button" type="button" data-back-add>Back</button>`);
}
function addNew() {openModal('New activity for this date',activityEditor('date-only'))}
function fileToDataUrl(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
}
function readTargets(form) {
  const values=[...form.querySelectorAll('.target-value')].map(input=>Number(input.value));
  if(!values.length||values.some(value=>!Number.isFinite(value)||value<=0))throw new Error('Enter a positive target for every set or segment.');
  return values;
}
async function saveActivity(form) {
  const values=new FormData(form), mode=form.dataset.mode, existing=form.dataset.id?activity(form.dataset.id):null;
  const method=values.get('method'), file=values.get('media');
  if(file?.size && !file.type.startsWith('image/'))throw new Error('Choose an image or GIF.');
  const media=file?.size?await fileToDataUrl(file):existing?.media;
  if(!media)throw new Error('An image or GIF is required.');
  const targets=method==='amount'?readTargets(form):[];
  const targetMinutes=method==='duration'?parseDuration(String(values.get('targetDuration'))):null;
  if(method==='duration'&&(!targetMinutes||targetMinutes<1))throw new Error('Enter a target duration in hh:mm.');
  const unit=method==='amount'?String(values.get('unit')).trim():null;
  if(method==='amount'&&!unit)throw new Error('Enter a unit such as reps or km.');
  const time=String(values.get('time'));
  const base={name:String(values.get('name')).trim(),description:String(values.get('description')).trim(),categoryId:String(values.get('categoryId')),missionId:String(values.get('missionId'))||null,media,method,unit,targets,targetMinutes};
  if(!base.name||!base.description)throw new Error('Name and description are required.');
  if(mode==='date-only') {
    if(!isBeforeStart(ui.date,time))throw new Error('Choose a start time that has not passed.');
    const cat=category(base.categoryId),group=mission(base.missionId);
    data.logs.push({id:uid(),date:ui.date,time,activityId:null,scheduleId:null,...base,categoryName:cat.name,categoryEmoji:cat.emoji,missionName:group?.name||null,sets:targets.map(target=>({target,actual:null})),actualMinutes:null,yesNo:null,doneAt:null,createdAt:new Date().toISOString()});
    closeModal();ui.page='home';await persist('Activity added to this date');return;
  }
  materializeMissedDates();
  const kind=String(values.get('kind'));
  let schedule=existing?data.schedules.find(item=>item.activityId===existing.id):null;
  const onDate=String(values.get('onDate'));
  const startsOn=kind==='date'?onDate:String(values.get('startsOn'));
  const endsOn=kind==='date'?onDate:String(values.get('endsOn'))||null;
  const weekdays=kind==='weekdays'?values.getAll('weekday').map(Number):[];
  if(kind==='weekdays'&&!weekdays.length)throw new Error('Choose at least one weekday.');
  if(!startsOn||endsOn&&endsOn<startsOn)throw new Error('Check the schedule dates.');
  if(existing)Object.assign(existing,base);
  else {data.activities.push({id:uid(),...base,archived:false});}
  const activityId=existing?.id||data.activities.at(-1).id;
  if(schedule)Object.assign(schedule,{kind,date:onDate,weekdays,time,startsOn,endsOn});
  else data.schedules.push({id:uid(),activityId,kind,date:onDate,weekdays,time,startsOn,endsOn});
  ui.page='activities';ui.editingActivity=null;await persist(existing?'Activity updated':'Activity created');
}
function editDate(row) {
  if(!isBeforeStart(row.date,row.time)){toast('Planning closes at the activity start time');return}
  const missionOptions=`<option value="">No Mission</option>${data.missions.filter(item=>!item.archived).map(item=>`<option value="${item.id}" ${item.id===row.missionId?'selected':''}>${esc(item.name)}</option>`).join('')}`;
  const targetInput=row.method==='amount'?`<div class="field"><label>Targets</label>${row.sets.map((set,index)=>`<div class="target-editor"><span>${index+1}</span><input class="exception-target" type="number" min="0.001" step="any" value="${esc(set.target)}"></div>`).join('')}</div>`:row.method==='duration'?`<div class="field"><label for="exception-duration">Target duration · hh:mm</label><input id="exception-duration" value="${fmtDuration(row.targetMinutes)}"></div>`:'';
  openModal('Edit this date',`<form id="exception-form" data-id="${row.id}"><div class="field"><label for="exception-time">Start time</label><input id="exception-time" name="time" type="time" required value="${esc(row.time)}"></div><div class="field"><label for="exception-mission">Mission · optional</label><select id="exception-mission" name="missionId">${missionOptions}</select></div>${targetInput}<div class="form-actions"><button class="outline-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Save this date</button></div></form>`);
}
async function saveException(form) {
  const row=rowsFor(ui.date).find(item=>item.id===form.dataset.id);
  if(!row)throw new Error('Activity not found.');
  if(!isBeforeStart(row.date,row.time))throw new Error('This activity has already started.');
  const time=String(new FormData(form).get('time'));
  if(!isBeforeStart(row.date,time))throw new Error('Choose a future start time.');
  const missionId=String(new FormData(form).get('missionId'))||null;
  const targets=row.method==='amount'?[...form.querySelectorAll('.exception-target')].map(input=>Number(input.value)):null;
  if(targets?.some(value=>!Number.isFinite(value)||value<=0))throw new Error('Every target must be positive.');
  const targetMinutes=row.method==='duration'?parseDuration($('#exception-duration').value):null;
  if(row.method==='duration'&&(!targetMinutes||targetMinutes<1))throw new Error('Enter a target duration in hh:mm.');
  if(row.scheduleId) {
    let change=exception(row.scheduleId,row.date);
    if(!change){change={id:uid(),scheduleId:row.scheduleId,date:row.date};data.exceptions.push(change)}
    Object.assign(change,{time,missionSet:true,missionId,targets,targetMinutes});
  }
  const log=data.logs.find(item=>item.id===row.id||item.scheduleId===row.scheduleId&&item.date===row.date);
  if(log){log.time=time;log.missionId=missionId;log.missionName=mission(missionId)?.name||null;if(targets)log.sets=targets.map((target,index)=>({target,actual:log.sets[index]?.actual??null}));if(targetMinutes)log.targetMinutes=targetMinutes}
  closeModal();await persist('This date updated');
}
async function saveResult(id) {
  const row=rowsFor(ui.date).find(item=>item.id===id);
  if(!row||isPast(row.date))return;
  const card=$('.activity-card.expanded');
  if(!card)throw new Error('Open the activity first.');
  let actuals=null,minutes=null;
  if(row.method==='amount') {
    actuals=[...card.querySelectorAll('.actual-set')].map(input=>input.value.trim()===''?null:Number(input.value));
    if(actuals.every(value=>value==null))throw new Error('Enter at least one actual value before Done.');
    if(actuals.some(value=>value!=null&&(!Number.isFinite(value)||value<0)))throw new Error('Actual values must be zero or higher.');
  } else {
    minutes=parseDuration(card.querySelector('#actual-duration').value.trim());
    if(minutes==null)throw new Error('Enter actual duration in hh:mm.');
  }
  const log=getOrCreateLog(row);
  if(actuals)log.sets=log.sets.map((set,index)=>({...set,actual:actuals[index]}));
  else log.actualMinutes=minutes;
  log.doneAt=new Date().toISOString();ui.expanded=log.id;await persist('Result saved');
}
async function answer(id,value) {
  const row=rowsFor(ui.date).find(item=>item.id===id);
  if(!row||isPast(row.date))return;
  const log=getOrCreateLog(row);log.yesNo=value;ui.expanded=ui.expanded===id?log.id:ui.expanded;await persist(value?'Marked Yes':'Marked No');
}
function changeMethodFields(form) {
  const method=form.querySelector('#method')?.value;
  form.querySelector('#amount-fields')?.classList.toggle('hidden',method!=='amount');
  form.querySelector('#duration-fields')?.classList.toggle('hidden',method!=='duration');
  const kind=form.querySelector('[name="kind"]:checked')?.value;
  form.querySelector('#weekdays-fields')?.classList.toggle('hidden',kind!=='weekdays');
  form.querySelector('#date-fields')?.classList.toggle('hidden',kind!=='date');
}
function setPage(page) {
  ui.page=page;ui.expanded=null;$('#drawer-backdrop').classList.add('hidden');closeModal();render();window.scrollTo({top:0,behavior:'instant'});
}
async function handleClick(event) {
  const target=event.target.closest('button,[data-expand]');
  if(!target)return;
  try {
    if(target.id==='menu-button'){$('#drawer-backdrop').classList.remove('hidden');return}
    if(target.id==='close-drawer'){$('#drawer-backdrop').classList.add('hidden');return}
    if(target.id==='date-button'){const picker=$('#date-picker');if(picker.showPicker)picker.showPicker();else picker.click();return}
    if(target.id==='add-button'){addChoice();return}
    if(target.dataset.signOut!==undefined){if(navigator.onLine)await cloud.auth.signOut();session=null;unlocked=false;$('#drawer-backdrop').classList.add('hidden');render();return}
    if(target.dataset.syncNow!==undefined){await syncNow();if(syncError)toast(syncError);else toast('Synced');return}
    if(target.dataset.useCloud!==undefined){await resolveConflict(false);return}
    if(target.dataset.useLocal!==undefined){await resolveConflict(true);return}
    if(target.dataset.closeModal!==undefined){closeModal();return}
    if(target.dataset.page){setPage(target.dataset.page);return}
    if(target.dataset.addExisting!==undefined){addExisting();return}
    if(target.dataset.addNew!==undefined){addNew();return}
    if(target.dataset.backAdd!==undefined){addChoice();return}
    if(target.dataset.newActivity!==undefined){ui.editingActivity=null;setPage('editor');return}
    if(target.dataset.editActivity){ui.editingActivity=target.dataset.editActivity;setPage('editor');return}
    if(target.dataset.cancelEditor!==undefined){setPage('activities');return}
    if(target.dataset.archiveActivity){const item=activity(target.dataset.archiveActivity);if(!item)return;materializeMissedDates();item.archived=true;ui.editingActivity=null;ui.page='activities';await persist('Activity archived');return}
    if(target.dataset.addTarget!==undefined){const list=target.closest('form').querySelector('#target-list');list.insertAdjacentHTML('beforeend',targetRows(['']));list.lastElementChild.querySelector('span').textContent=list.children.length;return}
    if(target.dataset.removeTarget!==undefined){const list=target.closest('#target-list');if(list.children.length<=1){toast('At least one target is required');return}target.closest('.target-editor').remove();[...list.children].forEach((child,index)=>{child.querySelector('span').textContent=index+1;child.querySelector('input').setAttribute('aria-label',`Target ${index+1}`)});return}
    if(target.dataset.expand){if(event.target.closest('.yes-no'))return;ui.expanded=ui.expanded===target.dataset.expand?null:target.dataset.expand;render();return}
    if(target.dataset.answer){event.stopPropagation();await answer(target.dataset.id,target.dataset.answer==='yes');return}
    if(target.dataset.done){await saveResult(target.dataset.done);return}
    if(target.dataset.editDate){editDate(rowsFor(ui.date).find(row=>row.id===target.dataset.editDate));return}
    if(target.dataset.addCategory!==undefined||target.dataset.editCategory){const existing=target.dataset.editCategory?category(target.dataset.editCategory):null;const name=prompt('Category name',existing?.name||'');if(name===null)return;const emoji=prompt('Category emoji',existing?.emoji||'');if(emoji===null)return;if(!name.trim()||!emoji.trim())throw new Error('Name and emoji are required.');if(existing)Object.assign(existing,{name:name.trim(),emoji:emoji.trim()});else data.categories.push({id:uid(),name:name.trim(),emoji:emoji.trim(),archived:false});await persist('Category saved');return}
    if(target.dataset.addMission!==undefined||target.dataset.editMission){const existing=target.dataset.editMission?mission(target.dataset.editMission):null;const name=prompt('Mission name',existing?.name||'');if(name===null)return;if(!name.trim())throw new Error('Mission name is required.');if(existing)existing.name=name.trim();else data.missions.push({id:uid(),name:name.trim(),archived:false});await persist('Mission saved');return}
  } catch(error){toast(error.message||'Could not save change')}
}
async function handleSubmit(event) {
  const form=event.target;
  if(!['activity-form','existing-form','exception-form','passcode-form'].includes(form.id))return;
  event.preventDefault();
  try {
    form.querySelector('[data-form-error]')?.remove();
    if(form.id==='passcode-form'){const passcode=String(new FormData(form).get('passcode')||'');await unlockWithPasscode(passcode);return}
    if(form.id==='activity-form')await saveActivity(form);
    if(form.id==='exception-form')await saveException(form);
    if(form.id==='existing-form'){
      const values=new FormData(form),time=String(values.get('time'));
      if(!isBeforeStart(ui.date,time))throw new Error('Choose a start time that has not passed.');
      const source=activity(String(values.get('activityId'))),cat=category(source.categoryId),group=mission(source.missionId);
      data.logs.push({id:uid(),date:ui.date,time,activityId:source.id,scheduleId:null,name:source.name,description:source.description,categoryId:source.categoryId,categoryName:cat.name,categoryEmoji:cat.emoji,missionId:source.missionId,missionName:group?.name||null,media:source.media,method:source.method,unit:source.unit,targets:[...source.targets],targetMinutes:source.targetMinutes,sets:source.targets.map(target=>({target,actual:null})),actualMinutes:null,yesNo:null,doneAt:null,createdAt:new Date().toISOString()});
      closeModal();await persist('Activity added to this date');
    }
  } catch(error){
    const message=error.message||'Could not save';
    if(form.id==='activity-form') {
      const errorNode=document.createElement('p');
      errorNode.dataset.formError='';errorNode.className='form-error';errorNode.setAttribute('role','alert');errorNode.textContent=message;
      form.querySelector('.form-actions')?.before(errorNode);
      errorNode.scrollIntoView({block:'nearest'});
    } else toast(message);
  }
}
async function handleChange(event) {
  const target=event.target;
  try {
    if(target.id==='date-picker'){if(target.value){ui.date=target.value;ui.expanded=null;render()}return}
    if(target.id==='timezone'){data.settings.timeZone=target.value;ui.date=today();materializeMissedDates();await persist('Time zone updated');return}
    if(target.id==='method'||target.name==='kind'){changeMethodFields(target.closest('form'));return}
  } catch(error){toast(error.message||'Could not update')}
}
document.addEventListener('click',handleClick);
document.addEventListener('submit',handleSubmit);
document.addEventListener('change',handleChange);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeModal();$('#drawer-backdrop').classList.add('hidden')}
  if((event.key==='Enter'||event.key===' ')&&event.target.dataset.expand){event.preventDefault();event.target.click()}
});
$('#modal-backdrop').addEventListener('click',event=>{if(event.target.id==='modal-backdrop')closeModal()});
$('#drawer-backdrop').addEventListener('click',event=>{if(event.target.id==='drawer-backdrop')event.target.classList.add('hidden')});
window.addEventListener('online',()=>{render();scheduleSync(0)});
window.addEventListener('offline',render);
window.addEventListener('focus',()=>scheduleSync(0));

async function init() {
  try {
    data=await readData()||starter();
    syncMeta();
    lastSavedState=structuredClone(data);
    ui.date=today();
    if(materializeMissedDates()){recordChanges();await writeData(data);}
    else if(!await readData())await writeData(data);
    lastSavedState=structuredClone(data);
    render();
    if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
    try {
      const auth=await cloud.auth.getSession();
      if(auth.error)throw auth.error;
      session=auth.data.session;
      unlocked=!!session;
      cloud.auth.onAuthStateChange((_event,next)=>{session=next;if(next)unlocked=true;render();if(next)scheduleSync(0)});
      render();
      if(session)scheduleSync(0);
    } catch(error) {syncError=error.message||'Sign-in unavailable';render();}
  } catch(error) {
    $('#main').innerHTML=`<div class="empty"><strong>Local storage is unavailable</strong><p>${esc(error.message)}. Open this app through localhost or HTTPS in a browser that supports IndexedDB.</p></div>`;
  }
}
init();

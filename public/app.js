const today = new Date();
const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const expectedReturnDate = (start, days) => {
  if (!start || !Number.isFinite(Number(days)) || Number(days) <= 0) return start;
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.floor(Number(days)));
  return date.toISOString().slice(0,10);
};
const nice = (d) => /^\d{4}-\d{2}-\d{2}/.test(d||'')?d.slice(0,10).split('-').reverse().join('/'):'—';
function displayDates(text){return String(text??'').replace(/\b\d{4}-\d{2}-\d{2}\b/g,date=>nice(date));}
const initials = (n) => String(n||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const esc = (s) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function employeeNumber(person){return String(person?.idCardNumber||'').trim()||'Not entered';}
let db = {people:[],attendance:[],leaves:[],device:{online:false,lastSeen:null,serial:null,count:0}};
let authenticated = false;
let authGeneration = 0;
let stateWriteVersion = 0;
let loginBusy = false;
let editingLeaveId = null;
let editingLeaveRevision = null;
let balanceEditorGeneration=0;
let leavePlanBusy = false;
let pendingMcUpload=null;
let leaveView='leaves';
const isSickLeave=type=>type==='Sick with MC'||type==='Sick without MC';
function closeStaffLeave(){document.getElementById('staff-leave-toggle')?.setAttribute('aria-expanded','false');const menu=document.getElementById('staff-leave-submenu');if(menu)menu.hidden=true;}
function toggleStaffLeave(){closeAppraisalMenu();closeAttendanceMenu();const toggle=document.getElementById('staff-leave-toggle');const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));document.getElementById('staff-leave-submenu').hidden=!expanded;}
let leavePreviewVersion = 0;
let leavePreviewPending = null;

function leaveTripInput(){return {basis:val('lp-trip-basis'),office:val('lp-trip-office'),charter:val('lp-trip-charter')==='yes',flightReturn:val('lp-trip-return'),atollBefore:Number(val('lp-trip-before')),firstHajjConfirmed:document.getElementById('lp-trip-first').checked,permissionReference:val('lp-trip-permission')};}

function dutyTravelInput(){return {...(db.leaves.find(l=>l.id===editingLeaveId)?.duty||{}),simplified:true};}
function leaveRequirementsUI(){
  const type=val('lp-type'),trip=type==='Hajj'||type==='Umra';
  document.getElementById('lp-days').readOnly=type==='Maternity';
  document.getElementById('lp-days').step=type==='Duty travel'?'1':'0.5';document.getElementById('lp-days').min=type==='Duty travel'?'1':'0.5';
  document.getElementById('medical-fields').hidden=type!=='Sick with MC';
  document.getElementById('circumcision-fields').hidden=type!=='Circumcision';
  document.getElementById('pilgrimage-fields').hidden=!trip;
  const basis=document.getElementById('lp-trip-basis');
  [...basis.options].find(o=>o.value==='First paid Hajj').disabled=type==='Umra';
  if(type==='Umra'&&basis.value==='First paid Hajj')basis.value='';
  const special=trip&&basis.value!=='Annual';
  document.getElementById('trip-first-field').hidden=!special||basis.value!=='First paid Hajj';
  for(const id of ['trip-office-field','trip-charter-field','trip-permission-field'])document.getElementById(id).hidden=!special;
  document.getElementById('trip-return-field').hidden=!special||val('lp-trip-charter')!=='yes';
  document.getElementById('trip-before-field').hidden=!special||val('lp-trip-office')!=='Atoll';
  const record=db.leaves.find(l=>l.id===editingLeaveId);
  const mc=record?.mcDocument;
  document.getElementById('mc-current-document').innerHTML=mc?`Attached: <a href="/api/mc-documents/${encodeURIComponent(mc.id)}">${esc(mc.name)}</a><br>Uploaded ${esc(new Date(mc.uploadedAt).toLocaleString('en-GB',{hour12:true}))}`:'';
}

async function previewLeavePlan(){
  leaveRequirementsUI();
  const note=document.getElementById('leave-policy-note');
  if(!val('lp-employee')||!val('lp-start')){++leavePreviewVersion;leavePreviewPending=null;note.hidden=true;return;}
  const q=new URLSearchParams({employeeId:val('lp-employee'),type:val('lp-type'),start:val('lp-start'),days:val('lp-days'),excludeId:editingLeaveId||''});
  q.set('trip',JSON.stringify(leaveTripInput()));q.set('eventReference',val('lp-event-ref'));if(val('lp-type')==='Duty travel')q.set('duty',JSON.stringify(dutyTravelInput()));
  const key=q.toString()+JSON.stringify(db.people.find(person=>person.id===val('lp-employee'))||{})+JSON.stringify(db.leaves)+JSON.stringify(db.holidays);
  if(leavePreviewPending===key)return;
  leavePreviewPending=key;const version=++leavePreviewVersion;
  try{
    const plan=await api('/api/leave-preview?'+q);
    if(version!==leavePreviewVersion)return;
    note.hidden=true;
    document.getElementById('lp-end').value=plan.end;
    const days=document.getElementById('lp-days');days.readOnly=plan.readOnlyDays;
    if(days.readOnly)days.value=plan.days;
    const balance=document.querySelector('.leave-balance-strip');
    if(balance)balance.innerHTML=`<strong>${esc(val('lp-type'))} leave</strong><dl><div><dt>Entitlement</dt><dd>${val('lp-type')==='Maternity'?'6 calendar months':plan.entitlement+' days'}</dd></div><div><dt>Used / reserved</dt><dd>${plan.used} days</dd></div><div><dt>Remaining</dt><dd>${plan.available} days</dd></div></dl><button type="button" class="text-btn" onclick="openModal('profile')">Set leave profile</button>`;
    if(plan.isNoPay){if(balance)balance.innerHTML='<strong>No pay leave</strong><p>'+esc(plan.days)+' calendar day(s).</p>';document.getElementById('leave-policy-note').textContent=plan.note;return;}
    if(plan.isDutyTravel){if(balance)balance.innerHTML='<strong>Official duty</strong><p>'+esc(plan.days)+' calendar day(s).</p>';document.getElementById('leave-policy-note').textContent=plan.note;return;}
    document.getElementById('leave-policy-note').textContent=plan.note+(plan.preservedPeriod?` ${plan.deductibleDays} deductible day(s) in the saved approved period. `:'')+(plan.payBasis?' Leave basis: '+plan.payBasis+'. ':'')+(plan.trip?.baseStart?"Departure from Male': "+nice(plan.trip.baseStart)+'. ':'')+(plan.balancePeriod?` Balance period: ${displayDates(plan.balancePeriod.label)} (${plan.balancePeriod.basis}). Requests crossing a reset are checked in each period. `:' Per-occasion / trip allowance. ')+(plan.holidayCount?'':'No closed dates configured. Add official dates under Attendance / Closed Days.');
  }catch(error){if(version===leavePreviewVersion){document.getElementById('lp-end').value=error.preview?.end||'';if(error.preview){const days=document.getElementById('lp-days');days.readOnly=error.preview.readOnlyDays;if(days.readOnly)days.value=error.preview.days;}document.getElementById('leave-policy-note').hidden=false;document.getElementById('leave-policy-note').textContent=error.message;}}
  finally{if(version===leavePreviewVersion)leavePreviewPending=null;}
}

let staffSearchOpen=false;
function matchingLeaveStaff() {
  const query=val('lp-staff-search').trim().toLocaleLowerCase(),role=val('lp-staff-role'),dept=val('lp-staff-department');
  const terms=query.split(/\s+/).filter(Boolean);
  return db.people.filter(person=>(!role||person.role===role)&&(!dept||person.dept===dept)&&terms.every(term=>[person.name,person.id,person.idCardNumber,person.devicePin,person.dept,person.role].join(' ').toLocaleLowerCase().includes(term))).sort((a,b)=>a.name.localeCompare(b.name));
}
function renderStaffSearchResults() {
  const results=document.getElementById('lp-staff-results'),matches=matchingLeaveStaff();
  const filterCount=[val('lp-staff-role'),val('lp-staff-department')].filter(Boolean).length;
  document.getElementById('lp-staff-filter-button').textContent=filterCount?`Filters (${filterCount})`:'Filters';
  if(!val('lp-staff-search').trim())staffSearchOpen=false;
  results.hidden=!staffSearchOpen||!!editingLeaveId;
  if(!val('lp-staff-search').trim()&&!editingLeaveId)document.getElementById('lp-staff-hint').textContent='';
  if(results.hidden)return;
  const markup=matches.length?matches.slice(0,8).map(person=>`<button type="button" class="staff-picker-result" data-select-staff="${esc(person.id)}"><span class="mini-avatar" aria-hidden="true">${esc(initials(person.name))}</span><span><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${esc(person.dept||'No department')}<br>ID: ${esc(employeeNumber(person))} · PIN: ${esc(person.devicePin)}</small></span><span aria-hidden="true">→</span></button>`).join(''):'<p class="staff-picker-empty">No staff match. Try another name or change the filters.</p>';
  if(results.innerHTML!==markup)results.innerHTML=markup;
  document.getElementById('lp-staff-hint').textContent='';
}
function syncLeaveStaffSelection() {
  const person=db.people.find(p=>p.id===val('lp-employee'));
  const search=document.getElementById('lp-staff-search');
  for(const id of ['lp-staff-search','lp-staff-search-button','lp-staff-filter-button','lp-staff-reset','lp-staff-role','lp-staff-department'])document.getElementById(id).disabled=!!editingLeaveId;
  if(person&&!staffSearchOpen)search.value=person.name;
  if(editingLeaveId){staffSearchOpen=false;document.getElementById('lp-staff-results').hidden=true;}
  document.getElementById('lp-staff-hint').textContent='';
}
function refreshLeaveStaff() {
  const select=document.getElementById('lp-staff-department'),current=select.value;
  const departments=[...new Set(db.people.map(person=>person.dept).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const options='<option value="">All departments</option>'+departments.map(dept=>`<option value="${esc(dept)}">${esc(dept)}</option>`).join('');
  if(select.innerHTML!==options){select.innerHTML=options;select.value=departments.includes(current)?current:'';}
  if(!db.people.some(person=>person.id===val('lp-employee')))document.getElementById('lp-employee').value='';
  renderLeavePlanSummary();renderStaffSearchResults();
}
function searchLeaveStaff() {
  if(editingLeaveId)return;
  staffSearchOpen=!!val('lp-staff-search').trim();renderStaffSearchResults();
}
function closeStaffSearch() {
  staffSearchOpen=false;
  document.getElementById('lp-staff-results').hidden=true;
}
function changeStaffSearch() {
  if(editingLeaveId)return;
  document.getElementById('lp-employee').value='';renderLeavePlanSummary();searchLeaveStaff();
}
function selectLeaveStaff(id) {
  if(editingLeaveId||!db.people.some(person=>person.id===id))return;
  document.getElementById('lp-employee').value=id;staffSearchOpen=false;
  document.getElementById('lp-staff-results').hidden=true;renderLeavePlanSummary();
}
function syncLeavePageMode() {
  const managing=leaveView==='manage';
  document.getElementById('leave-workspace').hidden=leaveView==='staff-on-leave'||(managing&&!editingLeaveId);
  document.getElementById('lp-save').hidden=managing;
  document.getElementById('lp-update').hidden=!managing;
  document.getElementById('lp-clear').textContent=managing?'Cancel editing':'Clear';
  document.getElementById('leave-editor-title').textContent=managing?'Edit applied leave':leaveView==='sick'?'Apply for sick leave':'Apply for leave';
}
function filteredManagedLeaves(leaves) {
  const query=val('manage-leave-search').trim().toLocaleLowerCase(),type=val('manage-leave-type');
  return leaves.filter(leave=>(!type||type==='all'||leave.type===type)&&query.split(/\s+/).filter(Boolean).every(term=>{const person=db.people.find(person=>person.id===leave.employeeId);return [leave.name,leave.employeeId,leave.type,leave.status,leave.reason,person?.idCardNumber,person?.devicePin,person?.dept,person?.role].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);}));
}
function renderLeavePlanSummary() {
  syncLeaveStaffSelection();syncLeavePageMode();
  const person=db.people.find(p=>p.id===val('lp-employee'));
  const summary=document.getElementById('leave-staff-summary');
  if(person){const balance=leaveBalance(person,val('lp-type'));
    const snapshot=JSON.stringify([person,val('lp-type'),balance]);
    if(summary.dataset.snapshot!==snapshot){summary.dataset.snapshot=snapshot;
    summary.innerHTML=`<div class="leave-staff-identity"><span class="mini-avatar">${esc(initials(person.name))}</span><dl><div><dt>Staff name</dt><dd>${esc(person.name)}</dd></div><div><dt>Role</dt><dd>${esc(person.role)}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'Not set')}</dd></div><div><dt>Employee ID</dt><dd>${esc(employeeNumber(person))}</dd></div></dl></div><div class="leave-balance-strip"><strong>${esc(val('lp-type'))} leave</strong><dl><div><dt>Entitlement</dt><dd>${balance.entitlement} days</dd></div><div><dt>Used / reserved</dt><dd>${balance.used} days</dd></div><div><dt>Remaining</dt><dd>${balance.available==null?'Not available':balance.available+' days'}</dd></div></dl></div>`;
    if(val('lp-type')==='No pay'){const strip=summary.querySelector('.leave-balance-strip');if(strip)strip.innerHTML='<strong>No pay leave</strong>';}
    if(val('lp-type')==='Duty travel'){const strip=summary.querySelector('.leave-balance-strip');if(strip)strip.innerHTML='<strong>Official duty</strong>';}
    }
  }else {summary.textContent='';delete summary.dataset.snapshot;}
  const active=!editingLeaveId||db.leaves.some(l=>l.id===editingLeaveId);
  document.getElementById('leave-edit-reason').hidden=!editingLeaveId;

  document.getElementById('lp-save').disabled=leavePlanBusy||!!editingLeaveId||!person;
  document.getElementById('lp-update').disabled=leavePlanBusy||!editingLeaveId||!person||!active;
  document.getElementById('leave-editor-mode').textContent=editingLeaveId?'Editing record':'New record';
  document.getElementById('leave-plan-message').textContent=!active?'This record is no longer editable.':'';
  previewLeavePlan();
}
function clearLeavePlan() {
  editingLeaveId=null;
  pendingMcUpload=null;
  editingLeaveRevision=null;
  document.getElementById('leave-edit-history').innerHTML='';
  document.getElementById('leave-plan-form').reset();
  document.querySelectorAll('#lp-type option[data-legacy]').forEach(option=>option.remove());
  document.getElementById('lp-type').value=leaveView==='sick'?'Sick with MC':'Annual';
  document.getElementById('lp-days').readOnly=false;
  staffSearchOpen=false;
  for(const id of ['lp-staff-search','lp-staff-role','lp-staff-department'])document.getElementById(id).value='';
  document.getElementById('lp-staff-filters').hidden=true;
  document.getElementById('lp-staff-filter-button').setAttribute('aria-expanded','false');
  document.getElementById('lp-staff-results').hidden=true;
  document.getElementById('lp-employee').value='';
  document.getElementById('lp-start').value=iso(new Date());
  document.getElementById('lp-end').value=expectedReturnDate(val('lp-start'),1);
  document.getElementById('lp-end').min=val('lp-start');
  refreshLeaveStaff();
}

async function api(path, options={}) {
  const {resume=false,...requestOptions}=options;
  const privateRequest=!path.startsWith('/api/auth/');
  if((privateRequest&&!authenticated&&!resume)||(authenticated&&path!=='/api/auth/logout'&&sessionHasExpired())){
    if(authenticated)lockSession('You were inactive for 30 minutes. Please sign in again.');
    const error=new Error('Please sign in again.');error.status=401;throw error;
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),path.startsWith('/api/auth/')?15000:30000);
  try{
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store',...requestOptions,signal:controller.signal,headers:{'content-type':'application/json',...(requestOptions.headers||{})}});
    const result = await response.json().catch(error=>{if(controller.signal.aborted)throw error;return {};});
    if (!response.ok) { const error=new Error(displayDates(result.error || `Request failed (${response.status})`)); error.status=response.status;error.preview=result.preview;if(response.status===401&&authenticated)lockSession('Your session has expired. Please sign in again.');throw error; }
    return result;
  }catch(error){if(controller.signal.aborted)throw new Error('Connection timed out. Check Tailscale and try again.');throw error;}
  finally{clearTimeout(timeout);}
}
function setAuthenticated(value,loading=false) {
  if (!value) authGeneration++;
  authenticated = value;
  if (!value) { document.getElementById('login-password').value=''; document.getElementById('login-password').type='password'; document.getElementById('toggle-password').setAttribute('aria-pressed','false'); document.getElementById('toggle-password').setAttribute('aria-label','Show password'); }
  const loginWall=document.getElementById('login-wall');
  loginWall.hidden=value||loading;loginWall.style.display=value||loading?'none':'grid';
  document.getElementById('session-loading').hidden=!loading;
  document.getElementById('app-container').classList.toggle('authenticated',value);
}
function showLoginError(message) { const error=document.getElementById('login-error');error.textContent = message || '';error.setAttribute('data-kind','error'); }
async function refreshState() {
  if (!authenticated) return;
  const generation = authGeneration,writeVersion=stateWriteVersion;
  const state = await api('/api/state');
  if (!authenticated || generation !== authGeneration || writeVersion!==stateWriteVersion) return;
  if(JSON.stringify(db)===JSON.stringify(state))return;
  db = state;
  render();
}
function toast(message) { const t=document.getElementById('toast'); t.textContent=displayDates(message); t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
function setDate() {
  document.getElementById('today').textContent=today.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
  document.getElementById('greet-date').textContent=today.toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).toUpperCase();
}
const avatarColors=['#e9eee8|#52705b','#f4e9e1|#9b6b4e','#eee9f3|#76648f','#e7eef4|#54728b','#f3eddd|#947947'];
function personCell(name) {
  const i=Math.max(0,db.people.findIndex(p=>p.name===name)); const [bg,fg]=avatarColors[i%avatarColors.length].split('|');
  return `<div class="person"><span class="mini-avatar" style="background:${bg};color:${fg}">${esc(initials(name))}</span><strong>${esc(name)}</strong></div>`;
}
function statusTag(status) {
  const color={Present:'present',Late:'late',Absent:'absent','On leave':'leave','On duty':'duty',Incomplete:'late','No logs':'off',Approved:'present',Completed:'present',Declined:'absent',Pending:'late'}[status]||'late';
  return `<span class="status ${color}">${esc(status==='Incomplete'?'Punch review needed':status)}</span>`;
}
function hours(record) {
  if(!record.checkIn||!record.checkOut||record.checkOut==='—')return '—';
  const mins=s=>{const[h,m]=s.split(':').map(Number);return h*60+m;}; const d=mins(record.checkOut)-mins(record.checkIn);
  return d>=0?`${Math.floor(d/60)}h ${String(d%60).padStart(2,'0')}m`:'—';
}
function usedDays(employeeId,type) {
  const snapshot=db.people?.find(p=>p.id===employeeId)?.balancePeriods?.[type];if(snapshot?.available!==null&&snapshot?.rawUsed!==undefined)return snapshot.rawUsed;
  const opening=Number(db.people?.find(p=>p.id===employeeId)?.leaveOpeningBalances?.[iso(new Date()).slice(0,4)]?.used?.[type])||0;
  return opening+db.leaves.filter(l=>!l.medical?.unauthorizedAbsence&&l.employeeId===employeeId&&(l.type===type||(type==='Annual'&&l.chargeType==='Annual'))&&l.payBasis!=='No pay'&&(type==='Annual'||l.chargeType!=='Annual')&&l.start?.slice(0,4)===iso(new Date()).slice(0,4)&&['Pending','Approved','Completed'].includes(l.status)).reduce((sum,l)=>sum+Number(l.status==='Completed'?(l.usedDays??l.deductibleDays??l.days):(l.deductibleDays??l.days)||0),0);
}
function leaveBalance(person,type) {
  if(person.balancePeriods?.[type])return person.balancePeriods[type];
  const key=type.toLowerCase(); const entitlement=Number(person.entitlements?.[type]??person[key]??0); let used=usedDays(person.id,type);
  if(type.startsWith('Sick')){const total=usedDays(person.id,'Sick with MC')+usedDays(person.id,'Sick without MC');used=entitlement-Math.max(0,Math.min(30-total,type==='Sick without MC'?15-usedDays(person.id,type):30));}
  return {entitlement,used,available:Math.max(0,entitlement-used)};
}
function renderOverviewLeaveSummary(date) {
  const activeIds=new Set(db.people.map(person=>person.id));
  const personalLeaves=db.leaves.filter(leave=>activeIds.has(leave.employeeId)&&leave.type!=='Duty travel'&&!leave.medical?.unauthorizedAbsence);
  const horizon=new Date(`${date}T00:00:00Z`);horizon.setUTCDate(horizon.getUTCDate()+30);
  const through=horizon.toISOString().slice(0,10);
  const onLeave=new Set(buildAttendanceRows({from:date,to:date,staff:'all'}).filter(row=>row.status==='On leave').map(row=>row.employeeId)).size;
  const upcoming=personalLeaves.filter(leave=>leave.status==='Approved'&&leave.start>date&&leave.start<=through).length;
  const pending=personalLeaves.filter(leave=>leave.status==='Pending').length;
  const items=[['On leave today',onLeave,'Staff away on approved leave'],['Upcoming leave',upcoming,'Approved requests starting in the next 30 days'],['Pending requests',pending,'Awaiting administrator approval']];
  document.getElementById('overview-leave-summary').innerHTML=items.map(([label,count,note])=>`<div class="overview-leave-row"><div class="overview-leave-copy"><span class="leave-label"><i class="leave-dot" aria-hidden="true"></i>${label}</span></div><strong class="overview-leave-number">${count}</strong></div>`).join('');
}
function closeAttendanceMenu(){document.getElementById('attendance-toggle')?.setAttribute('aria-expanded','false');const menu=document.getElementById('attendance-submenu');if(menu)menu.hidden=true;}
function toggleAttendanceMenu(){closeAppraisalMenu();const button=document.getElementById('attendance-toggle'),open=button.getAttribute('aria-expanded')!=='true';closeStaffLeave();button.setAttribute('aria-expanded',String(open));document.getElementById('attendance-submenu').hidden=!open;}
function closedDayEntries(){return db.closedDays||(db.holidays||[]).map(date=>({date,category:'Other official closure',reason:'Previously configured closed date'}));}
function renderClosedDays(){
  const entries=closedDayEntries().slice().sort((a,b)=>a.date.localeCompare(b.date));
  document.getElementById('closed-day-count').textContent=`${entries.length} saved date${entries.length===1?'':'s'}`;
  const markup=entries.length?entries.map(day=>`<tr><td>${esc(nice(day.date))}</td><td>${esc(day.category)}</td><td>${esc(day.reason)}</td><td><button type="button" class="text-btn" data-edit-closed="${esc(day.date)}">Edit</button><button type="button" class="text-btn" data-remove-closed="${esc(day.date)}">Remove</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">No additional closed dates.</td></tr>';
  const body=document.getElementById('closed-day-table');if(body.innerHTML!==markup)body.innerHTML=markup;
}
let closedDaysBusy=false;
async function persistClosedDays(days){
  if(closedDaysBusy)return false;closedDaysBusy=true;document.getElementById('closed-day-save').disabled=true;
  try{const saved=await saveAction('closed-days.save',{days});if(saved)document.getElementById('closed-day-message').textContent='Closed dates saved. Applicable leave return dates, usage and balances updated.';return saved;}
  finally{closedDaysBusy=false;document.getElementById('closed-day-save').disabled=false;}
}
function appraisalToday(){return new Date(Date.now()+5*60*60*1000).toISOString().slice(0,10);}
const appraisalState={year:Number(appraisalToday().slice(0,4)),basis:'working',search:'',supervisor:'all',view:'appraisal-required',active:false,rows:[],cache:null};
const appraisalTitles={'appraisal-required':'Days Required to Attend','appraisal-attended':'Days Attended','appraisal-on-time':'Days Attended (On Time)','appraisal-absent':'Absent Days','appraisal-disciplinary':'Disciplinary Actions','appraisal-report':'Appraisal Report','appraisal-supervisor':'Supervisor'};
function closeAppraisalMenu(){document.getElementById('appraisal-toggle')?.setAttribute('aria-expanded','false');const menu=document.getElementById('appraisal-submenu');if(menu)menu.hidden=true;}
function toggleAppraisalMenu(){const button=document.getElementById('appraisal-toggle'),open=button.getAttribute('aria-expanded')!=='true';closeStaffLeave();closeAttendanceMenu();button.setAttribute('aria-expanded',String(open));document.getElementById('appraisal-submenu').hidden=!open;}
function appraisalDate(date){return date?date.slice(0,10).split('-').reverse().join('/'):'—';}
function supervisorKey(supervisor){return !supervisor?'unassigned':supervisor.kind==='minister'?'minister':'staff:'+supervisor.id;}
function supervisorFromKey(key){return key==='minister'?{kind:'minister'}:key.startsWith('staff:')?{kind:'staff',id:key.slice(6)}:null;}
function supervisorLabel(supervisor,data=db){return !supervisor?'Unassigned':supervisor.kind==='minister'?'Ministry of Education':data.people.find(person=>person.id===supervisor.id)?.name||'Former supervisor';}
function appraisalSupervision(data,employeeId,year,through){
  const person=data.people.find(person=>person.id===employeeId);if(!person)return [];
  const first=`${year}-01-01`,start=person.joinedOn&&person.joinedOn>first?person.joinedOn:first,end=through<`${year}-12-31`?through:`${year}-12-31`;
  if(start>end)return [];
  const add=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const records=(data.supervisorAssignments||[]).filter(record=>record.employeeId===employeeId&&record.from<=end&&(!record.to||record.to>=start)).slice().sort((a,b)=>a.from.localeCompare(b.from));
  const periods=[];let cursor=start;
  const implicit=(from,to)=>({id:null,employeeId,supervisor:null,from,to,fixed:false,ongoing:to===end&&end===appraisalToday()});
  for(const record of records){const from=record.from>start?record.from:start,to=record.to&&record.to<end?record.to:end;if(cursor<from)periods.push(implicit(cursor,add(from,-1)));periods.push({...record,from,to,ongoing:!record.to&&to===appraisalToday()});if(to>=cursor)cursor=add(to,1);}
  if(cursor<=end)periods.push(implicit(cursor,end));return periods;
}
function periodLabel(period){return appraisalDate(period.from)+' – '+(period.ongoing?'Current':appraisalDate(period.to));}
function matchesSchoolStaff(person,query){const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return terms.every(term=>[person.name,person.id,person.devicePin,person.idCardNumber,person.role,person.dept].filter(Boolean).join(' ').toLocaleLowerCase().includes(term));}
function renderAppraisalSupervisorOptions(){
  const query=val('appraisal-supervisor-search'),options=[['all','All supervisors'],['minister','Ministry of Education'],['unassigned','Unassigned']].filter(([key,name])=>key==='all'||!query||name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if(query.trim())for(const person of db.people.filter(person=>!person.removedAt&&matchesSchoolStaff(person,query)).slice(0,12))options.push(['staff:'+person.id,person.name]);
  document.getElementById('appraisal-supervisor-options').innerHTML=options.map(([key,name])=>`<button type="button" class="staff-picker-result" data-appraisal-supervisor="${esc(key)}" aria-pressed="${key===appraisalState.supervisor}">${esc(name)}</button>`).join('')||'<div class="empty">No supervisors match.</div>';
}
const supervisorEditor={id:null,revision:null,selected:new Set()};
function resetSupervisorEditor(){
  supervisorEditor.id=null;supervisorEditor.revision=null;supervisorEditor.selected.clear();document.getElementById('supervisor-assignment-form').reset();document.getElementById('assignment-supervisor-id').value='';document.getElementById('supervisor-editor-title').textContent='Assign supervisor';document.getElementById('assignment-save').textContent='Save assignments';searchAssignmentSupervisor();renderAssignmentStaff();
}
function assignmentEligibleStaff(){
  const supervisor=supervisorFromKey(val('assignment-supervisor-id')),existing=supervisorEditor.id?(db.supervisorAssignments||[]).find(record=>record.id===supervisorEditor.id):null;
  return db.people.filter(person=>!person.removedAt&&(!existing||person.id===existing.employeeId)&&(supervisor?.kind!=='staff'||person.id!==supervisor.id)).sort((a,b)=>a.name.localeCompare(b.name));
}
function renderAssignmentStaff(){
  const people=assignmentEligibleStaff().filter(person=>matchesSchoolStaff(person,val('assignment-staff-search')));
  const markup=people.map(person=>`<label class="supervisor-staff-option"><input type="checkbox" data-assignment-staff="${esc(person.id)}" ${supervisorEditor.selected.has(person.id)?'checked':''} ${supervisorEditor.id?'disabled':''}><span><strong>${esc(person.name)}</strong><small>${esc(person.role)}${person.dept?' · '+esc(person.dept):''}</small></span></label>`).join('')||'<div class="empty">No staff match.</div>';
  const body=document.getElementById('assignment-staff-options');if(body.innerHTML!==markup)body.innerHTML=markup;
  document.getElementById('assignment-selected-count').textContent=`${supervisorEditor.selected.size} selected`;
  for(const id of ['assignment-select-all','assignment-select-none'])document.getElementById(id).disabled=!!supervisorEditor.id;
}
function selectAssignmentSupervisor(key){
  const supervisor=supervisorFromKey(key);if(!supervisor)return;
  if(supervisorEditor.id){const record=(db.supervisorAssignments||[]).find(item=>item.id===supervisorEditor.id);if(record&&supervisor.kind==='staff'&&supervisor.id===record.employeeId){searchAssignmentSupervisor();return toast('A staff member cannot supervise themselves.');}}
  document.getElementById('assignment-supervisor-id').value=key;searchAssignmentSupervisor();
  const allowed=new Set(assignmentEligibleStaff().map(person=>person.id));for(const id of supervisorEditor.selected)if(!allowed.has(id))supervisorEditor.selected.delete(id);renderAssignmentStaff();
}
function searchAssignmentSupervisor(){
  const query=val('assignment-supervisor-search').trim(),results=document.getElementById('assignment-supervisor-results'),selected=val('assignment-supervisor-id');
  document.getElementById('assignment-supervisor-selected').textContent=selected?supervisorLabel(supervisorFromKey(selected)):'None selected';
  const people=db.people.filter(person=>!person.removedAt&&(matchesSchoolStaff(person,query)||selected==='staff:'+person.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const options=[{key:'minister',name:'Ministry of Education',detail:''},...people.map(person=>({key:'staff:'+person.id,name:person.name,detail:[person.role,person.dept].filter(Boolean).join(' · ')}))];
  const focused=document.activeElement?.dataset.assignmentSupervisor,scroll=results.scrollTop;
  const markup=options.map(option=>`<label class="supervisor-staff-option supervisor-choice-option"><input type="radio" name="assignment-supervisor-choice" ${option.key==='minister'?'id="assignment-minister"':''} data-assignment-supervisor="${esc(option.key)}" value="${esc(option.key)}" ${selected===option.key?'checked':''}><span><strong>${esc(option.name)}</strong>${option.detail?`<small>${esc(option.detail)}</small>`:''}</span></label>`).join('');
  if(results.innerHTML!==markup){results.innerHTML=markup;results.scrollTop=scroll;if(focused)[...results.querySelectorAll('[data-assignment-supervisor]')].find(input=>input.dataset.assignmentSupervisor===focused)?.focus({preventScroll:true});}
}
function editSupervisorRecord(id,employeeId){
  resetSupervisorEditor();const record=(db.supervisorAssignments||[]).find(record=>record.id===id);
  if(record){supervisorEditor.id=record.id;supervisorEditor.revision=record.revision;selectAssignmentSupervisor(supervisorKey(record.supervisor));supervisorEditor.selected.add(record.employeeId);document.getElementById('supervisor-editor-title').textContent='Edit supervisor assignment';document.getElementById('assignment-save').textContent='Update assignment';}
  else if(employeeId)supervisorEditor.selected.add(employeeId);
  renderAssignmentStaff();document.getElementById('supervisor-workspace').scrollIntoView({block:'start'});
}
function disciplinaryForRows(rows){const ids=new Set(rows.map(row=>row.employeeId)),from=`${appraisalState.year}-01-01`,to=appraisalState.year===Number(appraisalToday().slice(0,4))?appraisalToday():`${appraisalState.year}-12-31`;return(db.disciplinaryActions||[]).filter(record=>ids.has(record.employeeId)&&record.date>=from&&record.date<=to).slice().sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));}
function disciplinaryMarkup(records){return records.length?records.map(record=>`<article class="disciplinary-record"><strong>${esc(appraisalDate(record.date))} · ${esc(record.action)}</strong>${record.reference?`<p>${esc(record.reference)}</p>`:''}${record.details?`<p>${esc(record.details)}</p>`:''}</article>`).join(''):'<p>None recorded</p>';}
function openDisciplinaryAction(id){
  const existing=(db.disciplinaryActions||[]).find(record=>record.id===id),person=db.people.find(person=>person.id===existing?.employeeId);if(id&&!existing)return toast('Disciplinary record not found.');
  document.getElementById('modal-title').textContent=existing?'Edit disciplinary action':'Record disciplinary action';
  document.getElementById('modal-body').innerHTML=`<div class="field staff-picker" id="disciplinary-staff-picker"><label for="disciplinary-staff-search">Staff member</label><input id="disciplinary-staff-search" type="search" value="${esc(person?.name||'')}" placeholder="Search name, ID or PIN" ${existing?'readonly':''}><input id="disciplinary-employee" type="hidden" value="${esc(existing?.employeeId||'')}"><div id="disciplinary-staff-results" class="staff-picker-results" hidden></div></div><div class="field"><label for="disciplinary-date">Action date</label><input id="disciplinary-date" type="date" max="${appraisalToday()}" value="${esc(existing?.date||(appraisalState.year===Number(appraisalToday().slice(0,4))?appraisalToday():''))}" required></div><div class="field"><label for="disciplinary-details">Details (optional)</label><textarea id="disciplinary-details" rows="3" maxlength="3000">${esc(existing?.details||'')}</textarea></div>${existing?'<div class="field"><label for="disciplinary-change-reason">Reason for change</label><textarea id="disciplinary-change-reason" rows="2" maxlength="1000" required></textarea></div>':''}`;
  document.getElementById('disciplinary-staff-search').addEventListener('input',()=>{if(existing)return;document.getElementById('disciplinary-employee').value='';const query=val('disciplinary-staff-search').trim(),results=document.getElementById('disciplinary-staff-results');results.hidden=!query;if(query)results.innerHTML=db.people.filter(person=>!person.removedAt&&matchesSchoolStaff(person,query)).slice(0,8).map(person=>`<button type="button" class="staff-picker-result" data-disciplinary-staff="${esc(person.id)}">${esc(person.name)} · ${esc(person.role)}</button>`).join('')||'<div class="empty">No staff match.</div>';});
  document.getElementById('disciplinary-staff-results').addEventListener('click',event=>{const button=event.target.closest('[data-disciplinary-staff]');if(!button)return;const selected=db.people.find(person=>person.id===button.dataset.disciplinaryStaff);if(!selected)return;document.getElementById('disciplinary-employee').value=selected.id;document.getElementById('disciplinary-staff-search').value=selected.name;document.getElementById('disciplinary-staff-results').hidden=true;});
  const save=document.getElementById('modal-save');save.style.display='';save.disabled=false;save.textContent=existing?'Update action':'Save action';save.onclick=async()=>{if(save.disabled)return;const employeeId=val('disciplinary-employee'),date=val('disciplinary-date'),reason=val('disciplinary-change-reason').trim();if(!employeeId||!date)return toast('Select staff and action date.');if(existing&&!reason)return toast('Enter a reason for the change.');save.disabled=true;const record={...(existing?{id:existing.id}:{}),employeeId,date,action:existing?.action||'Disciplinary action',reference:existing?.reference||'',details:val('disciplinary-details')};if(await saveAction('disciplinary.save',{record,expectedRevision:existing?.revision,reason})){closeModal();toast(existing?'Disciplinary action updated.':'Disciplinary action recorded.');}else save.disabled=false;};
  document.getElementById('modal-back').classList.add('open');
}
function viewAppraisalEmployee(employeeId){
  const row=appraisalState.rows.find(row=>row.employeeId===employeeId);if(!row)return;
  document.getElementById('modal-title').textContent=row.name;
  document.getElementById('modal-body').innerHTML=`<dl class="att-detail"><div><dt>Employee</dt><dd>${esc(row.role)} · ${esc(employeeNumber(row))}</dd></div><div><dt>Appraisal year</dt><dd>${row.year}</dd></div><div><dt>Scheduled working days</dt><dd>${row.periodDays}</dd></div><div><dt>Approved leave on working days</dt><dd>${row.leaveTaken}</dd></div><div><dt>Days Required to Attend</dt><dd>${row.required}</dd></div><div><dt>Days Attended</dt><dd>${row.attended??'—'}</dd></div><div><dt>Days Attended (On Time)</dt><dd>${row.onTime??'—'}</dd></div><div><dt>Absent Days</dt><dd>${row.absent}</dd></div><div><dt>Late days</dt><dd>${row.late}</dd></div><div><dt>On-time proportion</dt><dd>${row.onTimePercent===null?'—':row.onTimePercent.toFixed(2)+'%'}</dd></div><div><dt>Data status</dt><dd>${esc(row.coverage)}</dd></div></dl>${row.lateDates.length?'<h3>Late dates</h3><p>'+row.lateDates.map(date=>esc(appraisalDate(date))).join(', ')+'</p>':''}${row.absentDates.length?'<h3>Absent dates</h3><p>'+row.absentDates.map(date=>esc(appraisalDate(date))).join(', ')+'</p>':''}<h3>Supervision</h3>${row.supervision.map(period=>`<article class="disciplinary-record"><strong>${esc(supervisorLabel(period.supervisor))}</strong><p>${esc(periodLabel(period))}</p></article>`).join('')}<h3>Disciplinary actions (${row.disciplinaryCount})</h3>${disciplinaryMarkup(row.disciplinaryActions)}`;
  document.getElementById('modal-save').style.display='none';document.getElementById('modal-back').classList.add('open');
}
function calculateAppraisal(data,year,options={}) {
  const asOf=options.asOf||appraisalToday(),start=`${year}-01-01`,yearEnd=`${year+1}-01-01`,end=asOf<`${year}-12-31`?asOf:`${year}-12-31`;
  if(!Number.isInteger(year)||year<2000||year>Number(asOf.slice(0,4)))return [];
  const add=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const offDays=new Set(data.attendanceSchedule?.offDays||[5,6]);
  const off=date=>offDays.has(new Date(date+'T00:00:00Z').getUTCDay())||(data.holidays||[]).includes(date);
  const calendarDays=(Date.parse(yearEnd+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  const sourceRows=options.rows||data.attendance||[],recordMap=new Map([...(data.attendance||[]),...sourceRows].map(row=>[row.employeeId+'|'+row.date,row]));
  const firstLog=data.punchHistory?.[0]?.slice(0,10)||[...(data.attendance||[])].map(row=>row.date).sort()[0];
  return data.people.filter(person=>!person.removedAt).map(person=>{
    const joined=person.joinedOn,employmentStart=typeof joined==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(joined)&&Number.isFinite(Date.parse(joined+'T00:00:00Z'))&&new Date(joined+'T00:00:00Z').toISOString().slice(0,10)===joined&&joined>start?joined:start;
    const leaveWeights=new Map();let leaveReview=false;
    for(const leave of (data.leaves||[]).filter(leave=>leave.employeeId===person.id&&leave.type!=='Duty travel'&&!leave.medical?.unauthorizedAbsence&&['Approved','Completed'].includes(leave.status))){
      const actual=leave.returnedAt?.slice(0,10),through=actual&&actual>leave.start&&actual<leave.end?actual:leave.end;
      if(!leave.start||!through||through<=employmentStart||leave.start>end)continue;
      const dates=[];
      for(let day=leave.start,steps=0;day<through&&steps<2000;day=add(day),steps++){
        const weekends=[5,6].includes(new Date(day+'T00:00:00Z').getUTCDay()),holiday=(data.holidays||[]).includes(day),type=leave.chargeType==='Annual'?'Annual':leave.type;
        const extra=leave.trip&&leave.trip.basis!=='Annual'&&leave.trip.baseStart&&leave.trip.baseEnd&&(day<leave.trip.baseStart||day>=leave.trip.baseEnd);
        if(leave.type==='No pay'||extra||(!holiday&&!(weekends&&(data.leavePolicy?.excludeWeekends?.[type]??['Annual','Family','Sick with MC','Sick without MC','Medical','Casual'].includes(type)))))dates.push(day);
      }
      let budget=Number(leave.status==='Completed'?(leave.usedDays??leave.deductibleDays??leave.days):(leave.deductibleDays??leave.days));
      if(!Number.isFinite(budget)||budget<0){leaveReview=true;continue;}
      const expected=Math.min(Number(leave.days)||dates.length,dates.length);
      if(leave.status==='Completed'&&Math.abs(budget-expected)>.001)leaveReview=true;
      for(const day of dates){if(budget<=0)break;const weight=Math.min(1,budget);budget-=weight;if(day>=start&&day<=end)leaveWeights.set(day,Math.max(leaveWeights.get(day)||0,weight));}
      if(budget>.001)leaveReview=true;
    }
    let periodDays=0,leaveTaken=0,absent=0,late=0,unverified=0;
    const lateDates=[],absentDates=[];
    for(let day=employmentStart;day<=end;day=add(day)){
      if(off(day))continue;
      periodDays++;const leaveWeight=leaveWeights.get(day)||0;leaveTaken+=leaveWeight;const required=1-leaveWeight;if(required<=0)continue;
      const row=recordMap.get(person.id+'|'+day),duty=(data.leaves||[]).some(leave=>leave.employeeId===person.id&&leave.type==='Duty travel'&&['Approved','Completed'].includes(leave.status)&&leave.start<=day&&day<leave.end),status=duty?'Present':row?.status;
      if(['Present','On duty'].includes(status))continue;
      if(status==='Late'){late+=required;lateDates.push(day);continue;}
      if(['Incomplete','No logs','Awaiting punch'].includes(status)||((!status||status==='Absent')&&(!firstLog||day<=firstLog||(person.attendanceFrom&&day<person.attendanceFrom.slice(0,10))))){unverified+=required;continue;}
      if(status==='Absent'||!status){absent+=required;absentDates.push(day);}
      else unverified+=required;
    }
    const required=periodDays-leaveTaken,complete=unverified===0&&!leaveReview;
    const attended=complete?Math.max(0,required-absent):null,onTime=attended===null?null:Math.max(0,attended-late);
    const disciplinaryActions=(data.disciplinaryActions||[]).filter(record=>record.employeeId===person.id&&record.date>=start&&record.date<=end);
    return {disciplinaryCount:disciplinaryActions.length,disciplinaryActions,employeeId:person.id,name:person.name,dept:person.dept||'',role:person.role,pin:person.devicePin,idCardNumber:person.idCardNumber||'',basis:'working',year,calendarDays,periodDays,employmentStart,leaveTaken,required,absent,late,lateDates,absentDates,unverified,offDaysCredited:0,attended,onTime,onTimePercent:onTime===null||required===0?null:Number((100*onTime/required).toFixed(2)),coverage:leaveReview?'Leave review':unverified?'Incomplete data':'Complete',asOf:end};
  });
}
function appraisalColumns(){
  if(appraisalState.view==='appraisal-report')return [['name','Employee'],['supervisorText','Supervisor'],['supervisionPeriod','Supervision Period'],['required','Days Required to Attend'],['attended','Days Attended'],['onTime','Days Attended (On Time)'],['absent','Absent Days'],['disciplinaryCount','Disciplinary Actions'],['view','Action']];
  const base=[['name','Employee'],['dept','Department']];
  const metrics=appraisalState.view==='appraisal-required'?[['calendarDays','Days in year'],['periodDays','Scheduled working days'],['leaveTaken','Approved leave on working days'],['required','Days Required to Attend']]:appraisalState.view==='appraisal-attended'?[['required','Days Required to Attend'],['absent','Absent Days'],['attended','Days Attended'],['unverified','Unverified days']]:appraisalState.view==='appraisal-absent'?[['required','Days Required to Attend'],['absent','Absent Days'],['late','Late days'],['unverified','Unverified days']]:[['attended','Days Attended'],['late','Late days'],['onTime','Days Attended (On Time)'],['unverified','Unverified days']];
  return [...base,...metrics,['coverage','Data status']];
}
function renderAppraisal(){
  if(!appraisalState.active)return;
  appraisalState.basis='working';
  const state=appraisalState,asOf=appraisalToday(),key=`${state.year}|${state.basis}|${asOf}`,discipline=state.view==='appraisal-disciplinary',supervisors=state.view==='appraisal-supervisor',combined=state.view==='appraisal-report';
  if(!state.cache||state.cache.data!==db||state.cache.key!==key){const to=state.year===Number(asOf.slice(0,4))?asOf:`${state.year}-12-31`;state.cache={data:db,key,rows:calculateAppraisal(db,state.year,{basis:state.basis,asOf,rows:buildAttendanceRows({staff:'all',from:`${state.year}-01-01`,to})})};}
  const terms=state.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  state.rows=state.cache.rows.filter(row=>terms.every(term=>[row.name,row.employeeId,row.pin,row.idCardNumber,row.dept,row.role].join(' ').toLocaleLowerCase().includes(term))).map(row=>{
    const allPeriods=appraisalSupervision(db,row.employeeId,state.year,row.asOf),periods=state.supervisor==='all'||supervisors?allPeriods:allPeriods.filter(period=>supervisorKey(period.supervisor)===state.supervisor);
    return {...row,supervision:periods,supervisorText:[...new Set(periods.map(period=>supervisorLabel(period.supervisor)))].join(', ')||'Unassigned',supervisionPeriod:periods.map(periodLabel).join('; ')};
  }).filter(row=>supervisors||state.supervisor==='all'||row.supervision.length);
  const number=value=>value===null?'—':Number.isInteger(value)?String(value):Number(value.toFixed(2)).toString();
  document.getElementById('appraisal-basis-field').hidden=true;
  document.getElementById('appraisal-supervisor-button').hidden=supervisors;
  if(supervisors)document.getElementById('appraisal-supervisor-panel').hidden=true;
  document.getElementById('appraisal-supervisor-button').textContent=state.supervisor==='all'?'Supervisor':supervisorLabel(supervisorFromKey(state.supervisor));
  document.getElementById('disciplinary-toolbar').hidden=!discipline;document.getElementById('supervisor-workspace').hidden=!supervisors;document.getElementById('appraisal-kpis').hidden=combined||discipline||supervisors;
  document.getElementById('appraisal-roster-title').textContent=discipline?'Disciplinary actions':supervisors?'Supervision assignments':'Employees';
  const through=state.cache.rows[0]?.asOf||(state.year+'-12-31');
  document.getElementById('appraisal-roster-period').textContent=`${appraisalDate(state.year+'-01-01')} – ${appraisalDate(through)}`;
  if(discipline){
    const records=disciplinaryForRows(state.rows);
    document.getElementById('appraisal-head').innerHTML='<tr><th>Employee</th><th>Date</th><th>Disciplinary Action</th><th>Reference</th><th>Recorded by</th><th>Action</th></tr>';
    document.getElementById('appraisal-table').innerHTML=records.length?records.map(record=>{const person=db.people.find(person=>person.id===record.employeeId);return `<tr><td><strong>${esc(person?.name||record.employeeId)}</strong><small>${esc(person?.role||'')}</small></td><td>${esc(appraisalDate(record.date))}</td><td>${esc(record.action)}${record.details?`<br><small>${esc(record.details)}</small>`:''}</td><td>${esc(record.reference||'—')}</td><td>${esc(record.actor)}</td><td><button type="button" class="text-btn" data-edit-disciplinary="${esc(record.id)}">Edit</button></td></tr>`;}).join(''):'<tr><td colspan="6" class="empty">No disciplinary actions recorded for this period.</td></tr>';
  }else if(supervisors){
    document.getElementById('appraisal-head').innerHTML='<tr><th>Employee</th><th>Supervisor</th><th>Supervision Period</th><th>Action</th></tr>';
    const entries=state.rows.flatMap(row=>row.supervision.map(period=>({row,period})));
    document.getElementById('appraisal-table').innerHTML=entries.length?entries.map(({row,period})=>`<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.role)}</small></td><td>${esc(supervisorLabel(period.supervisor))}</td><td>${esc(periodLabel(period))}</td><td>${period.id?`<button type="button" class="text-btn" data-edit-supervisor="${esc(period.id)}">Edit</button>`:period.fixed?'Fixed':`<button type="button" class="text-btn" data-assign-staff="${esc(row.employeeId)}">Assign</button>`}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">No staff match.</td></tr>';searchAssignmentSupervisor();renderAssignmentStaff();
  }else{
    const columns=appraisalColumns();
    document.getElementById('appraisal-head').innerHTML='<tr>'+columns.map(([,label])=>`<th>${label}</th>`).join('')+'</tr>';
    document.getElementById('appraisal-table').innerHTML=state.rows.length?state.rows.map(row=>'<tr>'+columns.map(([key])=>{
      let value=typeof row[key]==='number'||row[key]===null?number(row[key]):esc(row[key]);
      if(key==='name')value=`<strong>${esc(row.name)}</strong><small>${esc(row.role)}</small>${row.coverage!=='Complete'?`<small class="appraisal-data-status">${esc(row.coverage)}</small>`:''}`;
      if(key==='absent'&&row.unverified>0)value+='<small>Confirmed only</small>';
      if(key==='disciplinaryCount')value=row.disciplinaryCount?`<button type="button" class="text-btn disciplinary-count" data-view-appraisal="${esc(row.employeeId)}">${row.disciplinaryCount} recorded</button>`:'None';
      if(key==='supervisionPeriod')value=row.supervision.map(period=>`<span class="supervision-period-line">${esc(periodLabel(period))}</span>`).join('')||'—';
      if(key==='view')value=`<button type="button" class="btn appraisal-view" data-view-appraisal="${esc(row.employeeId)}" aria-label="View appraisal for ${esc(row.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
      return `<td>${value}</td>`;
    }).join('')+'</tr>').join(''):`<tr><td class="empty" colspan="${columns.length}">No staff match.</td></tr>`;
    if(!combined){const fields=state.view==='appraisal-required'?[['required','Days Required to Attend'],['leaveTaken','Leave taken'],['periodDays','Scheduled working days']]:state.view==='appraisal-attended'?[['attended','Days Attended'],['absent','Absent Days'],['unverified','Unverified days']]:state.view==='appraisal-absent'?[['absent','Absent Days'],['required','Days Required to Attend'],['unverified','Unverified days']]:[['onTime','Days Attended (On Time)'],['late','Late days'],['unverified','Unverified days']];document.getElementById('appraisal-kpis').innerHTML=fields.map(([key,label])=>`<div class="card"><div class="card-head">${label}</div><div class="metric">${state.rows.some(row=>row[key]===null)?'—':number(state.rows.reduce((sum,row)=>sum+row[key],0))}</div></div>`).join('');}
  }
  document.getElementById('appraisal-year').value=state.year;document.getElementById('appraisal-year').max=asOf.slice(0,4);document.getElementById('appraisal-basis').value=state.basis;
  document.getElementById('appraisal-period').textContent=`${state.year} · ${state.basis==='calendar'?'Calendar days':'Working days'} · ${state.year===Number(asOf.slice(0,4))?'Year to date':'Full year'} · Through ${appraisalDate(through)}`;
  document.getElementById('appraisal-count').textContent=discipline?`${disciplinaryForRows(state.rows).length} actions · ${state.rows.length} employees`:supervisors?`${state.rows.length} employees · ${state.rows.filter(row=>row.supervision.some(period=>!period.supervisor)).length} unassigned`:`${state.rows.length} employees · ${state.rows.filter(row=>row.coverage!=='Complete').length} require review`;
  renderAppraisalSupervisorOptions();
}
function exportAppraisal(format='csv',button){
  let columns,records;
  if(appraisalState.view==='appraisal-disciplinary'){columns=[['employeeId','Employee ID'],['name','Employee'],['date','Date'],['action','Disciplinary action'],['reference','Reference'],['details','Details']];records=disciplinaryForRows(appraisalState.rows).map(record=>({...record,name:db.people.find(person=>person.id===record.employeeId)?.name||''}));}
  else if(appraisalState.view==='appraisal-supervisor'){columns=[['employeeId','Employee ID'],['name','Employee'],['supervisorName','Supervisor'],['from','From'],['to','Through']];records=appraisalState.rows.flatMap(row=>row.supervision.map(period=>({employeeId:row.employeeId,name:row.name,supervisorName:supervisorLabel(period.supervisor),from:period.from,to:period.to})));}
  else{columns=[['employeeId','Employee ID'],['name','Employee'],['year','Year'],['basis','Calculation basis'],['asOf','Through'],['calendarDays','Days in year'],['periodDays','Scheduled working days'],['supervisorText','Supervisor'],['supervisionPeriod','Supervision Period'],['leaveTaken','Leave taken'],['required','Days Required to Attend'],['absent','Absent Days'],['attended','Days Attended'],['late','Late days'],['onTime','Days Attended (On Time)'],['onTimePercent','On-time percentage'],['disciplinaryCount','Disciplinary action count'],['disciplinarySummary','Disciplinary actions'],['unverified','Unverified days'],['coverage','Data status']];records=appraisalState.rows.map(row=>({...row,disciplinarySummary:row.disciplinaryActions.map(record=>`${appraisalDate(record.date)}: ${record.action}${record.reference?' ('+record.reference+')':''}`).join('; ')}));}
  const rows=[columns.map(([,title])=>title),...records.map(row=>columns.map(([key])=>key==='employeeId'?employeeNumber(db.people.find(person=>person.id===row.employeeId)):['date','from','to','asOf'].includes(key)?displayDates(row[key]):row[key]??''))];
  if(['pdf','docx'].includes(format))return downloadReport(format,{title:appraisalState.view==='appraisal-disciplinary'?'Disciplinary Action Report':appraisalState.view==='appraisal-supervisor'?'Supervisor Report':'Appraisal Report',caption:document.getElementById('appraisal-period').textContent+(document.getElementById('appraisal-search').value?' | Employee search: '+document.getElementById('appraisal-search').value:''),columns:rows[0],rows:rows.slice(1),filename:'haaziry-'+appraisalState.view+'-'+appraisalState.year},button);
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(reportCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`haaziry-${appraisalState.view}-${appraisalState.year}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function leaveRecordDate(value){return value.slice(0,10).split('-').reverse().join('/');}
function leaveRecordRange(from,to){return from===to?leaveRecordDate(from):leaveRecordDate(from)+' – '+leaveRecordDate(to);}

function leaveRecordDatesMarkup(leave){
  // The saved end is the exclusive return boundary, not an extra day of leave.
  const last=new Date(leave.end+'T00:00:00Z');last.setUTCDate(last.getUTCDate()-1);
  const lastDay=Number.isFinite(last.getTime())?last.toISOString().slice(0,10):leave.start,through=lastDay<leave.start?leave.start:lastDay;
  const meta=(label,value)=>`<span class="leave-date-meta"><span>${label}</span><time datetime="${esc(value)}">${esc(leaveRecordDate(value))}</time></span>`;
  return `<div class="leave-date-block"><strong class="leave-date-range">${esc(leaveRecordRange(leave.start,through))}</strong>${leave.type==='Duty travel'?'':meta('Expected return',leave.end)}${leave.returnedAt?meta('Returned',leave.returnedAt.slice(0,10)):''}</div>`;
}

function leaveRecordRowMarkup(leave){
  const call=(name,...args)=>esc(name+'('+args.map(value=>JSON.stringify(value)).join(',')+')');
  const button=(label,name,...args)=>`<button type="button" class="text-btn" onclick="${call(name,...args)}">${label}</button>`;
  const reviews=[leave.returnReview,leave.policyReview,leave.medicalReview?.status].filter(Boolean).map(note=>`<span class="leave-review-note">${esc(note)}</span>`).join('');
  const duty=leave.duty;
  const notes=(leave.reason?`<p><strong>Reason:</strong> ${esc(leave.reason)}</p>`:'')+(duty?`<p><strong>Destination:</strong> ${esc(duty.destination)}</p><p><strong>Purpose:</strong> ${esc(duty.purpose)}</p><p><strong>Order:</strong> ${esc(duty.approvalReference)}</p><p><strong>Duty times:</strong> ${esc(leaveRecordDate(leave.start))} ${esc(duty.startTime)} – ${esc(leaveRecordDate(duty.lastDate))} ${esc(duty.endTime)}</p>${duty.reportedAt?`<p><strong>Reported:</strong> ${esc(duty.reportedAt.replace('T',' '))} · ${esc(duty.reportReference)}</p>`:''}`:'');
  const completed=leave.status==='Completed',closed=leave.status==='Declined',amount=closed?leave.days:completed?(leave.usedDays??leave.deductibleDays??leave.days):(leave.deductibleDays??leave.days),dayLabel=completed?'Used':closed?'Planned':'Reserved';
  let actions=button('Edit','editLeaveRecord',leave.id)+`<button type="button" class="text-btn leave-delete-action" data-delete-leave="${esc(leave.id)}">Delete</button>`;
  if(leave.type==='Duty travel'&&leave.status==='Approved')actions+=`<button type="button" class="text-btn" data-duty-report="${esc(leave.id)}">Record return</button>`;
  if(leave.status==='Pending')actions+=button('Approve','decision',leave.id,'Approved')+button('Decline','decision',leave.id,'Declined');
  else if(completed&&leave.type!=='Duty travel')actions+=button('Adjust days','editLeaveDays',leave.id);
  return `<tr><td><div class="leave-employee-block">${personCell(leave.name)}${leave.appliedOn?`<span class="leave-applied">Applied <time datetime="${esc(leave.appliedOn)}">${esc(leaveRecordDate(leave.appliedOn))}</time></span>`:''}</div></td><td><div class="leave-type-block"><strong class="leave-type-name">${esc(leave.type)}</strong>${reviews}${notes?`<details class="leave-record-notes"><summary>Reason & details</summary><div>${notes}</div></details>`:''}</div></td><td>${leaveRecordDatesMarkup(leave)}</td><td><div class="leave-days-block"><strong>${esc(amount)} <span>days</span></strong><span>${dayLabel} · ${esc(leave.days)} planned</span></div></td><td>${statusTag(leave.status)}</td><td><div class="leave-row-actions">${actions}</div></td></tr>`;
}

function render() {
  applyViewer();
  renderAppraisal();
  renderClosedDays();
  if(db.leavePolicy){
    const select=document.getElementById('lp-type'),current=select.value;
    const options=leaveView==='manage'?[...db.leavePolicy.types,...db.leavePolicy.sickTypes]:leaveView==='sick'?[...db.leavePolicy.sickTypes]:[...db.leavePolicy.types];
    if(select.dataset.options!==options.join('|')){select.innerHTML=options.map(type=>`<option value="${esc(type)}">${esc(type.startsWith("Sick")?type.replace("Sick","Sick Leave"):type)}</option>`).join('');select.value=options.includes(current)?current:(leaveView==='sick'?'Sick with MC':'Annual');select.dataset.options=options.join('|');}
  }
  const date=iso(today);
  const activeIds=new Set(db.people.map(p=>p.id));
  const records=db.attendance.filter(a=>a.date===date&&activeIds.has(a.employeeId));
  const leavesToday=db.leaves.filter(l=>l.type!=='Duty travel'&&activeIds.has(l.employeeId)&&!l.medical?.unauthorizedAbsence&&['Approved','Completed'].includes(l.status)&&l.start<=date&&date<(l.returnedAt&&l.returnedAt.slice(0,10)>l.start&&l.returnedAt.slice(0,10)<l.end?l.returnedAt.slice(0,10):l.end));
  const rows=[...records];
  for(const l of leavesToday) if(!rows.some(r=>r.employeeId===l.employeeId)) rows.push({employeeId:l.employeeId,name:l.name,date,checkIn:'—',checkOut:'—',status:'On leave',source:'Leave'});
  const present=rows.filter(a=>['Present','Late','On duty'].includes(a.status)).length, late=rows.filter(a=>a.status==='Late').length, onLeave=rows.filter(a=>a.status==='On leave').length;
  document.getElementById('stat-present').textContent=present;
  document.getElementById('stat-late').textContent=late;
  document.getElementById('stat-leave').textContent=onLeave;
  document.getElementById('stat-total').textContent=db.people.length;
  document.getElementById('attendance-preview').innerHTML=rows.length?rows.slice(0,5).map(a=>`<tr><td>${personCell(a.name)}</td><td>${esc(a.checkIn)}</td><td>${esc(a.checkOut)}</td><td>${hours(a)}</td><td>${statusTag(a.status)}</td></tr>`).join(''):`<tr><td colspan="5" class="empty">No punches received for this date.</td></tr>`;
  const arrivals=records.filter(r=>r.checkIn&&r.checkIn!=='—').slice().sort((a,b)=>a.checkIn.localeCompare(b.checkIn)).slice(0,4);
  document.getElementById('activity').innerHTML=arrivals.length?arrivals.map(a=>`<div class="event"><div class="event-time">${esc(a.checkIn)}</div><div class="event-track"><i class="event-dot ${a.status==='Late'?'amber':''}"></i></div><div class="event-content"><b>${esc(a.name)}</b><p>${a.status==='Late'?'Late check-in':'Check-in'} · ${esc(a.source||'iClock990')}</p></div></div>`).join(''):`<div class="empty">Waiting for staff punches.</div>`;
  renderOverviewLeaveSummary(date);
  const leaveFilter=document.getElementById('leave-filter').value;
  const groupLeaves=db.leaves;
  const typeFilter=document.getElementById('manage-leave-type');
  const types=[...new Set([...(db.leavePolicy?.types||[]),...(db.leavePolicy?.sickTypes||[]),...db.leaves.map(leave=>leave.type)])];
  const typeOptions='<option value="all">All leave types</option>'+types.map(type=>`<option value="${esc(type)}">${esc(type)}</option>`).join('');
  if(typeFilter.innerHTML!==typeOptions){const previous=typeFilter.value;typeFilter.innerHTML=typeOptions;typeFilter.value=types.includes(previous)?previous:'all';}
  const leaves=filteredManagedLeaves(groupLeaves).filter(l=>leaveFilter==='all'||l.status===leaveFilter);
  document.getElementById('leave-table').innerHTML=leaves.length?leaves.map(leaveRecordRowMarkup).join(''):`<tr><td colspan="6" class="empty">${db.leaves.length?'No leave records match your search and filters.':'No leave records yet.'}</td></tr>`;
  document.getElementById('leave-result-count').textContent=leaves.length+' of '+groupLeaves.length+' '+(groupLeaves.length===1?'record':'records');
  document.getElementById('leave-pending').textContent=groupLeaves.filter(l=>l.status==='Pending').length;
  document.getElementById('leave-approved').textContent=groupLeaves.filter(l=>l.status==='Approved').length;
  document.getElementById('leave-used').closest('.card').querySelector('.card-head').textContent='Applied leave records';
  document.getElementById('leave-used').textContent=groupLeaves.length;
  renderLeaveBalances();
  renderAttendance(); renderPeople(); renderDevice(); refreshLeaveStaff(); syncJoiningDateEditor();
}
function usedDaysForType(type){return db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);}
function balanceLeaveTypes(){return [...new Set(leaveView==='manage'?[...(db.leavePolicy?.types||['Annual']),'Sick with MC','Sick without MC']:leaveView==='sick'?['Sick with MC','Sick without MC']:(db.leavePolicy?.types||['Annual']))];}
function balanceValueMarkup(person,type){
  if(type==='No pay')return 'By approval · unpaid';
  if(type==='Duty travel')return 'By duty order · no deduction';
  if(type==='Hajj'||type==='Umra')return 'By approved trip';
  if(type==='Circumcision')return '5 days per occasion';
  if(type==='Maternity'||type==='Paternity')return 'Per birth · managed in leave records';
  const balance=leaveBalance(person,type);if(balance.available===null)return `<small class="staff-role">${esc(displayDates(balance.period?.label||'Set up leave periods'))}</small>`;return `<span class="balance-num">${esc(balance.available)}</span> / ${esc(balance.entitlement)} days${balance.period?`<br><small class="staff-role">${esc(balance.period.basis)} · ${esc(displayDates(balance.period.label))}${balance.period.resetsOn?`<br>Renews ${esc(nice(balance.period.resetsOn))}`:''}</small>`:''}`;
}
function renderLeaveBalances(){
  const types=balanceLeaveTypes(),select=document.getElementById('balance-type');
  if(select.dataset.options!==types.join('|')){const current=select.value;select.innerHTML=types.map(type=>`<option value="${esc(type)}">${esc(type.startsWith('Sick')?type.replace('Sick','Sick Leave'):type)}</option>`).join('');select.value=types.includes(current)?current:types.includes('Annual')?'Annual':types[0]||'';select.dataset.options=types.join('|');}
  const type=select.value,body=document.getElementById('balance-table'),people=db.people.filter(person=>matchesSchoolStaff(person,val('balance-search'))),table=body.closest('table');
  table.classList.add('employee-balance-table');table.querySelector('thead').innerHTML=`<tr><th>Employee</th><th>${esc(type.startsWith('Sick')?type.replace('Sick','Sick Leave'):type)} balance</th><th>Manage</th></tr>`;
  body.innerHTML=people.length?people.map(person=>`<tr><td>${personCell(person.name)}</td><td>${balanceValueMarkup(person,type)}</td><td><div class="balance-row-actions"><button type="button" class="text-btn" data-view-balances="${esc(person.id)}">View all balances</button>${leaveView==='manage'&&viewerIsAdmin()?`<button type="button" class="text-btn" data-edit-balances="${esc(person.id)}">Edit balances</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="3" class="empty">${db.people.length?'No staff match your search.':'Add staff to begin tracking balances.'}</td></tr>`;
}
function viewAllLeaveBalances(id){
  const person=db.people.find(person=>person.id===id);if(!person)return;
  document.getElementById('modal-title').textContent='Leave balances · '+person.name;
  document.getElementById('modal-body').innerHTML='<div class="balance-overview-grid">'+balanceLeaveTypes().map(type=>`<article class="balance-overview-card"><h3>${esc(type.startsWith('Sick')?type.replace('Sick','Sick Leave'):type)}</h3><div>${balanceValueMarkup(person,type)}</div></article>`).join('')+'</div>';
  const save=document.getElementById('modal-save');save.style.display=leaveView==='manage'&&viewerIsAdmin()?'':'none';save.disabled=false;save.textContent='Edit balances';save.onclick=()=>editBalance(person.id);document.getElementById('modal-back').classList.add('open');
}

/* ---------- Attendance page ---------- */
const attState={preset:'month',from:'',to:'',staff:'all',search:'',sort:'date-desc',status:'all'};
let attRows=null;
const isoAdd=(dateStr,days)=>{const d=new Date(`${dateStr}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const weekdayShort=(date)=>new Date(`${date}T12:00:00`).toLocaleDateString('en',{weekday:'short'});
const staffStart=person=>db.attendanceSchedule?.byRole?.[person.role]?.start||(['Teacher','Leading Teacher','Technical Staff','Support Staff','Deputy Principal'].includes(person.role)?'07:00':'08:00');
const minutesBetween=(from,to)=>{const m=s=>{const[h,mi]=s.split(':').map(Number);return h*60+mi;};return m(to)-m(from);};
const fmtMins=(mins)=>`${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
function attPresetRange(preset){
  const todayIso=iso(today);
  if(preset==='today')return[todayIso,todayIso];
  if(preset==='yesterday'){const y=isoAdd(todayIso,-1);return[y,y];}
  if(preset==='7')return[isoAdd(todayIso,-6),todayIso];
  if(preset==='30')return[isoAdd(todayIso,-29),todayIso];
  if(preset==='last-month')return[iso(new Date(today.getFullYear(),today.getMonth()-1,1)),iso(new Date(today.getFullYear(),today.getMonth(),0))];
  return[iso(new Date(today.getFullYear(),today.getMonth(),1)),todayIso];
}
function leavePeriodMarkup(leave){
  // Saved end is exclusive: display the included last day separately from expected return.
  const last=new Date(leave.end+'T00:00:00Z');last.setUTCDate(last.getUTCDate()-1);
  const lastDay=Number.isFinite(last.getTime())?last.toISOString().slice(0,10):leave.start;
  const through=lastDay<leave.start?leave.start:lastDay;
  return `${nice(leave.start)}${through!==leave.start?' – '+nice(through):''}${leave.type==='Duty travel'?'':`<br><small class="staff-role">Expected return ${nice(leave.end)}</small>`}`;
}
function eachDate(from,to){const out=[];for(let d=new Date(`${from}T12:00:00`);iso(d)<=to;d.setDate(d.getDate()+1))out.push(iso(d));return out;}
const attendanceStaffPicker={open:false,active:-1,ids:[]};
function closeAttendanceStaffSuggestions(){
 attendanceStaffPicker.open=false;attendanceStaffPicker.active=-1;
 document.getElementById('att-staff-results').hidden=true;
 const input=document.getElementById('att-search');input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
}

function renderAttendanceStaffSuggestions(){
 const input=document.getElementById('att-search'),list=document.getElementById('att-staff-results');
 list.hidden=!attendanceStaffPicker.open;input.setAttribute('aria-expanded',String(attendanceStaffPicker.open));
 if(!attendanceStaffPicker.open){input.removeAttribute('aria-activedescendant');return;}
 const query=attState.search.trim(),people=db.people.filter(person=>!person.removedAt&&matchesSchoolStaff(person,query)).sort((a,b)=>a.name.localeCompare(b.name));
 attendanceStaffPicker.ids=[null,...people.map(person=>person.id)];
 if(attendanceStaffPicker.active>=attendanceStaffPicker.ids.length)attendanceStaffPicker.active=-1;
 const option=(id,index,name,detail)=>`<button type="button" role="option" tabindex="-1" id="att-staff-option-${index}" data-att-staff-option="${index}" aria-selected="${index===attendanceStaffPicker.active}" class="staff-picker-result"><span><strong>${esc(name)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</span></button>`;
 list.innerHTML=option(null,0,'All staff','Clear search')+people.map((person,index)=>option(person.id,index+1,person.name,[employeeNumber(person),person.role,person.dept].filter(Boolean).join(' · '))).join('')+(people.length?'':'<div class="staff-picker-empty" role="status">No matching staff.</div>');
 if(attendanceStaffPicker.active>=0){const id='att-staff-option-'+attendanceStaffPicker.active;input.setAttribute('aria-activedescendant',id);document.getElementById(id)?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
}

function chooseAttendanceStaff(index){
 const id=attendanceStaffPicker.ids[index],person=db.people.find(person=>person.id===id);
 if(index!==0&&!person)return;
 attState.selectedStaff=person?.id||null;attState.search=person?.name||'';
 document.getElementById('att-search').value=attState.search;
 closeAttendanceStaffSuggestions();renderAttendance();
}

function syncAttendanceStaffSearch(){
 const selected=db.people.find(person=>person.id===attState.selectedStaff);
 if(selected&&attState.search===selected.name){attState.staff=selected.id;return;}
 attState.selectedStaff=null;
 const query=attState.search.trim(),matches=query?db.people.filter(person=>matchesSchoolStaff(person,query)):[];
 attState.staff=matches.length===1?matches[0].id:'all';
}
function buildAttendanceRows(options={}){
  const allPeople=options.people||db.people;
  const staff=options.staff??attState.staff;
  const people=staff==='all'?allPeople:allPeople.filter(p=>p.id===staff);
  const dates=eachDate(options.from||attState.from,options.to||attState.to);
  const todayIso=iso(today);
  const recordMap=new Map(db.attendance.map(a=>[`${a.employeeId}|${a.date}`,a]));
  const rows=[];
  for(const person of people){
    for(const date of dates){
      if(person.attendanceFrom&&date<person.attendanceFrom.slice(0,10))continue;
      const record=recordMap.get(`${person.id}|${date}`);
      if(!record&&date>todayIso)continue;
      const leave=db.leaves.find(l=>l.type!=='Duty travel'&&!l.medical?.unauthorizedAbsence&&l.employeeId===person.id&&['Approved','Completed'].includes(l.status)&&l.start<=date&&date<(l.returnedAt&&l.returnedAt.slice(0,10)>l.start&&l.returnedAt.slice(0,10)<l.end?l.returnedAt.slice(0,10):l.end));
      const weekday=new Date(`${date}T12:00:00`).getDay();
      const holiday=(db.holidays||[]).includes(date);
      const weekend=weekday===5||weekday===6||holiday;
      const row={employeeId:person.id,name:person.name,dept:person.dept||'',date,weekend,checkIn:'—',checkOut:'—',workedMins:0,lateMins:0,source:'',leave:leave?leave.type:''};
      if(record){
        row.correctionId=record.correctionId;row.originalCheckIn=record.originalCheckIn;row.originalCheckOut=record.originalCheckOut;
        row.checkIn=record.checkIn||'—';row.checkOut=record.checkOut||'—';row.source=record.source||'iClock990';
        row.status=record.status||'Incomplete';row.workedMins=record.workedMins||0;row.lateMins=record.lateMins||0;
        row.note=record.note||'';row.punches=record.punches||[];
      }else if(leave&&!holiday&&!(weekend&&db.leavePolicy?.excludeWeekends?.[leave.chargeType==='Annual'?'Annual':leave.type]))row.status='On leave';
      else if(weekend)row.status='Weekend';
      else if(db.punchHistory?.[0]&&date<=db.punchHistory[0].slice(0,10))row.status='No logs';
      else row.status=date===todayIso&&new Date().toTimeString().slice(0,5)<staffStart(person)?'Awaiting punch':'Absent';
      const duty=db.leaves.find(l=>l.type==='Duty travel'&&l.employeeId===person.id&&['Approved','Completed'].includes(l.status)&&l.start<=date&&date<l.end);
      if(duty){if(row.status!=='Incomplete')row.status='Present';row.lateMins=0;row.leave='';row.dutyTravelId=duty.id;row.source=row.source.includes('Duty travel')?row.source:(row.source?row.source+' · ':'')+'Duty travel';}
      rows.push(row);
    }
  }
  return rows;
}
function attStatusTag(row){
  if(row.status==='On duty')return '<span class="status duty">On duty · Duty travel</span>';
  if(row.status==='On leave')return `<span class="status leave">On leave${row.leave?' · '+esc(row.leave):''}</span>`;
  if(row.status==='Weekend')return `<span class="status off">Off day</span>`;
  if(row.status==='Awaiting punch')return `<span class="status off">Awaiting punch</span>`;
  if(row.status==='Incomplete')return '<span class="status late">Punch review needed</span>';
  if(row.status==='No logs')return '<span class="status off">Outside synced history</span>';
  if(row.status==='Absent')return `<span class="status absent">Absent</span>`;
  if(row.status==='Late')return `<span class="status late">Late</span>`;
  return `<span class="status present">Present${row.weekend?' · off day':''}</span>`;
}
function renderAttChart(all){
  const dates=[...new Set(all.map(r=>r.date))].sort();
  const worked=dates.map(d=>all.filter(r=>r.date===d).reduce((sum,r)=>sum+r.workedMins,0));
  const late=dates.map(d=>all.filter(r=>r.date===d).reduce((sum,r)=>sum+r.lateMins,0));
  const max=Math.max(1,...worked,...late),W=360,H=84,pad=6;
  const x=i=>dates.length<2?W/2:pad+i*(W-2*pad)/(dates.length-1);
  const y=v=>H-pad-(v/max)*(H-2*pad);
  const points=vals=>vals.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  document.getElementById('att-chart').innerHTML=`<polyline points="0,${H-pad} ${W},${H-pad}" fill="none" stroke="#e9ece8" stroke-width="1"/><polyline points="${points(late)}" fill="none" stroke="#d87565" stroke-width="2" stroke-linejoin="round"/><polyline points="${points(worked)}" fill="none" stroke="#57a577" stroke-width="2" stroke-linejoin="round"/>`;
  const labels=[...new Set([dates[0],dates[Math.floor((dates.length-1)/2)],dates[dates.length-1]].filter(Boolean))];
  document.getElementById('att-chart-dates').innerHTML=labels.map(d=>`<span>${new Date(`${d}T12:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`).join('');
}
function renderAttendanceSummary(rows){
  const individual=attState.staff!=='all'&&db.people.some(person=>person.id===attState.staff);
  document.getElementById('att-summary').hidden=!individual;
  document.getElementById('att-summary-prompt').hidden=true;
  if(!individual)return;
  const all=rows.filter(row=>row.employeeId===attState.staff);
  const present=all.filter(r=>['Present','Late','On duty'].includes(r.status)).length;
  const leaveDays=all.filter(r=>['On leave','Weekend'].includes(r.status)).length;
  const absent=all.filter(r=>r.status==='Absent').length;
  const lateMins=all.reduce((sum,r)=>sum+r.lateMins,0);
  const lateDays=all.filter(r=>r.status==='Late').length;
  document.getElementById('att-present').textContent=present;
  document.getElementById('att-leave').textContent=leaveDays;
  document.getElementById('att-absent').textContent=absent;
  document.getElementById('att-late-mins').textContent=lateMins;
  document.getElementById('att-late-days').textContent=lateDays;
  const score=Math.round((present/Math.max(1,present+absent))*100);
  document.getElementById('att-score').textContent=`${score}%`;
  document.getElementById('att-score-ring').style.background=`conic-gradient(var(--green) ${score*3.6}deg,#e7eee8 0deg)`;
  renderAttChart(all);
}
function renderAttendance(){
  if(!attState.from||!attState.to){const[f,t]=attPresetRange(attState.preset);attState.from=f;attState.to=t;}
  syncAttendanceStaffSearch();renderAttendanceStaffSuggestions();
  const fromEl=document.getElementById('att-from'),toEl=document.getElementById('att-to');
  fromEl.value=attState.from;toEl.value=attState.to;fromEl.max=iso(today);toEl.max=iso(today);
  document.getElementById('att-period').value=attState.preset;
  document.getElementById('att-custom').classList.toggle('open',attState.preset==='custom');
  const all=buildAttendanceRows();
  renderAttendanceSummary(all);
  const staffLabel=attState.staff==='all'?'All staff':(db.people.find(p=>p.id===attState.staff)?.name||'Staff');
  document.getElementById('att-range-label').textContent=`${nice(attState.from)} – ${nice(attState.to)} · ${staffLabel}`;
  let rows=[...all];
  if(attState.status!=='all')rows=rows.filter(r=>r.status===attState.status);
  const query=attState.search.trim().toLowerCase();
  if(query)rows=rows.filter(r=>query.split(/\s+/).filter(Boolean).every(term=>{const person=db.people.find(p=>p.id===r.employeeId);return [r.name,r.employeeId,r.dept,r.status,r.status==='Incomplete'?'Punch review needed':'',r.leave,person?.devicePin,person?.idCardNumber,person?.role].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);}));
  if(attState.sort==='date-asc')rows.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  else if(attState.sort==='late')rows.sort((a,b)=>b.lateMins-a.lateMins||b.date.localeCompare(a.date));
  else if(attState.sort==='hours')rows.sort((a,b)=>b.workedMins-a.workedMins||b.date.localeCompare(a.date));
  else rows.sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name));
  attRows=rows;
  const pageKey=JSON.stringify([attState.from,attState.to,attState.staff,attState.status,attState.search,attState.sort]);
  if(attState.pageKey!==pageKey){attState.page=0;attState.pageKey=pageKey;}
  const pages=Math.max(1,Math.ceil(rows.length/400));
  attState.page=Math.min(attState.page||0,pages-1);
  let pager=document.getElementById('att-pagination');
  if(!pager){pager=document.createElement('div');pager.id='att-pagination';pager.className='panel-head';document.getElementById('attendance-table').closest('.table-wrap').after(pager);}
  pager.innerHTML=`<button class="btn" onclick="attendancePage(-1)" ${attState.page===0?'disabled':''}>Previous</button><span>Page ${attState.page+1} of ${pages} · ${rows.length} records</span><button class="btn" onclick="attendancePage(1)" ${attState.page===pages-1?'disabled':''}>Next</button>`;
  document.getElementById('att-count').textContent=`${rows.length} record${rows.length===1?'':'s'} / ${all.filter(r=>r.status==='Incomplete').length} need punch review`;
  document.getElementById('attendance-table').innerHTML=rows.length?rows.slice(attState.page*400,(attState.page+1)*400).map(r=>`<tr><td>${personCell(r.name)}</td><td><b>${esc(weekdayShort(r.date))}</b><br><small class="staff-role">${nice(r.date)}</small></td><td>${esc(r.checkIn)}${r.correctionId?'<br><small class="staff-role">Corrected</small>':''}${r.note?'<br><small class="staff-role attendance-punch-note" title="'+esc(r.note)+'">'+esc(r.note)+'</small>':''}</td><td>${esc(r.checkOut)}</td><td>${r.workedMins?fmtMins(r.workedMins):'—'}</td><td>${r.lateMins?`<span class="att-late">${r.lateMins} min</span>`:'—'}</td><td>${attStatusTag(r)}</td><td><button class="text-btn" onclick="viewAttendance('${esc(r.employeeId)}','${r.date}')">View</button></td></tr>`).join(''):`<tr><td colspan="8" class="empty">No attendance rows for this period.</td></tr>`;
}
function attendancePage(direction){attState.page=Math.max(0,(attState.page||0)+direction);renderAttendance();}
function correctionHistory(employeeId,date,allowDeny=false){
  const history=(db.attendanceCorrections||[]).filter(c=>c.employeeId===employeeId&&c.date===date).slice().reverse();
  return `<div class="correction-history"><h3>Correction history</h3>${history.length?history.map(c=>`<article><strong>${esc(c.actor)} · ${esc(new Date(c.createdAt).toLocaleString('en-GB',{hour12:true}))}</strong><p>${esc(c.reason)}</p>${c.noteOnly?'<p class="record-detail">Note only · Attendance status and times unchanged.</p>':`<p>Check-in: ${esc(c.before.checkIn)} → ${esc(c.after.checkIn)} · Checkout: ${esc(c.before.checkOut)} → ${esc(c.after.checkOut)}</p>${['checkIn','checkOut'].filter(field=>c.changes[field]!==undefined).map(field=>`<div><strong>${field==='checkIn'?'In punch':'Out punch'}: ${esc(c.changes[field])}</strong> ${c.denied?.[field]?`<span class="status absent">Denied</span><p>${esc(c.denied[field].reason)}</p><small>${esc(c.denied[field].actor)} · ${esc(new Date(c.denied[field].at).toLocaleString('en-GB',{hour12:true}))}</small>`:allowDeny?`<button type="button" class="btn" data-deny-correction="${esc(c.id)}" data-deny-field="${field}">Deny</button>`:''}</div>`).join('')}`}<details><summary>Original punch evidence (${c.originalPunches.length})</summary>${c.originalPunches.length?c.originalPunches.map(p=>`<p>${esc(displayDates(p.timestamp))} · ${esc(p.serial)} · punch code ${esc(p.state)}</p>`).join(''):'<p>No original punch existed when this correction was saved.</p>'}</details></article>`).join(''):'<p class="record-detail">No administrator corrections recorded.</p>'}</div>`;
}
function openAttendanceCorrection(employeeId,date){
  const save=document.getElementById('modal-save');let expected=null,reviewing=false;
  document.getElementById('modal-title').textContent='Correct attendance';
  document.getElementById('modal-body').innerHTML=`<div class="field"><label for="f-employee">Staff member</label><select id="f-employee">${db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(employeeNumber(p))}</option>`).join('')}</select></div><div class="field"><label for="f-date">Attendance date</label><input id="f-date" type="date" required value="${esc(date||iso(new Date()))}"></div><div class="form-row"><div class="field"><label for="f-in">In punch</label><input id="f-in" type="time" step="60"></div><div class="field"><label for="f-out">Out punch</label><input id="f-out" type="time" step="60"></div></div><div class="field correction-reason"><label for="f-correction-reason">Reason for correction (required)</label><textarea id="f-correction-reason" required aria-required="true" maxlength="1000" rows="3" placeholder="Explain the attendance discrepancy"></textarea></div><div id="correction-logs" class="correction-history"></div><div id="correction-audit"></div>`;
  document.getElementById('f-correction-reason').addEventListener('input',e=>e.target.setCustomValidity(''));
  if(employeeId)document.getElementById('f-employee').value=employeeId;
  const load=()=>{
    const row=db.attendance.find(a=>a.employeeId===val('f-employee')&&a.date===val('f-date'));
    expected={checkIn:row?.checkIn||'—',checkOut:row?.checkOut||'—',correctionId:row?.correctionId||null};
    document.getElementById('f-in').value=expected.checkIn==='—'?'':expected.checkIn;
    document.getElementById('f-out').value=expected.checkOut==='—'?'':expected.checkOut;
    document.getElementById('correction-logs').innerHTML='<h3>Fingerprint logs</h3>'+((row?.punches||[]).length?row.punches.map(p=>`<article><strong>${esc(p.timestamp.slice(11))} · ${esc(p.eventType||({'attendance-in':'IN','attendance-out':'OUT'}[p.kind])||p.kind||'Unlabelled')}</strong><p>${esc(p.serial)}</p>${p.denied?`<span class="status absent">Denied</span><p>${esc(p.denied.reason)}</p><small>${esc(p.denied.actor)} · ${esc(new Date(p.denied.at).toLocaleString('en-GB',{hour12:true}))}</small>`:`<button type="button" class="btn" data-deny-punch="${esc(p.id)}">Deny</button>`}</article>`).join(''):'<p class="record-detail">No fingerprint logs recorded for this day.</p>');
    document.getElementById('correction-audit').innerHTML=correctionHistory(val('f-employee'),val('f-date'),true);
  };
  const denyLog=async event=>{
    const button=event.target.closest('[data-deny-punch],[data-deny-correction]');if(!button||reviewing||save.disabled)return;
    if(!val('f-correction-reason').trim()){const field=document.getElementById('f-correction-reason');field.focus();field.setCustomValidity('Enter a reason for denying this log.');field.reportValidity();return;}
    reviewing=true;save.disabled=true;button.disabled=true;
    try{if(await saveAction('punch.deny',{entry:{employeeId:val('f-employee'),date:val('f-date'),...(button.dataset.denyCorrection?{correctionId:button.dataset.denyCorrection,field:button.dataset.denyField}:{punchId:button.dataset.denyPunch}),reason:val('f-correction-reason'),expected}})){load();toast('Punch denied. Attendance recalculated.');}}finally{reviewing=false;save.disabled=false;button.disabled=false;}
  };
  document.getElementById('correction-logs').addEventListener('click',denyLog);
  document.getElementById('correction-audit').addEventListener('click',denyLog);
  document.getElementById('f-employee').addEventListener('change',load);document.getElementById('f-date').addEventListener('change',load);load();
  save.style.display='';save.textContent='Save correction';save.disabled=!db.people.length;
  save.onclick=async()=>{
    if(save.disabled)return;
    if(!val('f-correction-reason').trim()){const reason=document.getElementById('f-correction-reason');reason.scrollIntoView({block:'center'});reason.focus();reason.setCustomValidity('Enter a reason for this correction.');reason.reportValidity();return;}
    if(['f-date','f-in','f-out'].some(id=>!document.getElementById(id).reportValidity()))return;
    const changes={};
    if(val('f-in')&&val('f-in')!==expected.checkIn)changes.checkIn=val('f-in');
    if(val('f-out')&&val('f-out')!==expected.checkOut)changes.checkOut=val('f-out');
    const entry={employeeId:val('f-employee'),date:val('f-date'),reason:val('f-correction-reason'),expected,...changes};
    if(!Object.keys(changes).length)entry.noteOnly=true;
    save.disabled=true;
    try{if(await saveAction('attendance.manual',{entry})){closeModal();toast(entry.noteOnly?'Attendance note saved.':'Attendance punches updated.');}}finally{save.disabled=false;}
  };
  document.getElementById('modal-back').classList.add('open');
}
function viewAttendance(employeeId,date){
  const person=db.people.find(p=>p.id===employeeId);
  const row=(attRows||[]).find(r=>r.employeeId===employeeId&&r.date===date);
  if(!person||!row)return;
  document.getElementById('modal-title').textContent=`${person.name} · ${nice(date)}`;
  document.getElementById('modal-body').innerHTML=`<dl class="att-detail"><div><dt>Status</dt><dd>${attStatusTag(row)}</dd></div><div><dt>Check in</dt><dd>${esc(row.checkIn)}</dd></div><div><dt>Check out</dt><dd>${esc(row.checkOut)}</dd></div><div><dt>Worked</dt><dd>${row.workedMins?fmtMins(row.workedMins):'—'}</dd></div><div><dt>Late</dt><dd>${row.lateMins?`${row.lateMins} mins`:'—'}</dd></div><div><dt>Expected start</dt><dd>${esc(staffStart(person))}</dd></div><div><dt>Source</dt><dd>${esc(row.source||row.leave||'—')}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'—')}</dd></div></dl>`;
  document.getElementById('modal-body').innerHTML+=`<p class="record-detail">${esc(row.note||'')}</p><h3>Received punch evidence</h3>${(row.punches||[]).length?(row.punches||[]).map(p=>`<p class="record-detail">${esc(displayDates(p.timestamp))} / ${esc(p.eventType||p.kind||'Unlabelled punch')} / raw code ${esc(p.state)}</p>`).join(''):'<p class="record-detail">No machine punches received for this date.</p>'}`;
  const save=document.getElementById('modal-save');
  document.getElementById('modal-body').innerHTML+=correctionHistory(employeeId,date);
  if(save){save.style.display='';save.disabled=false;save.textContent='Correct attendance';save.onclick=()=>openAttendanceCorrection(employeeId,date);}
  document.getElementById('modal-back').classList.add('open');
}
function renderPeople() {
  const query=document.getElementById('people-search').value.trim().toLocaleLowerCase(),terms=query.split(/\s+/).filter(Boolean);
  const people=db.people.filter(person=>terms.every(term=>[person.name,person.dept,person.id,person.idCardNumber,person.devicePin,person.role].filter(Boolean).join(' ').toLocaleLowerCase().includes(term)));
  document.getElementById('people-count').textContent=query?`${people.length} of ${db.people.length} employees match`:`${db.people.length} employee${db.people.length===1?'':'s'}`;
  document.getElementById('people-table').innerHTML=people.length?people.map(person=>`<tr><td>${personCell(person.name)}</td><td>${esc(person.role)}</td><td>${esc(person.dept||'—')}</td><td>${esc(person.devicePin)}</td><td>${esc(person.idCardNumber||'-')}</td><td class="employee-action-cell"><button type="button" class="text-btn employee-edit" data-edit-employee="${esc(person.id)}" aria-label="Edit ${esc(person.name)}">Edit</button><button type="button" class="text-btn employee-remove" data-employee-id="${esc(person.id)}" aria-label="Remove ${esc(person.name)}">Remove</button></td></tr>`).join(''):`<tr><td colspan="6" class="empty">${query?'No staff match your search.':'No employees. Add an employee to get started.'}</td></tr>`;
}
function confirmLeaveDeletion(id) {
  const leave=db.leaves.find(item=>item.id===id);if(!leave)return toast('Leave record not found.');
  document.getElementById('modal-title').textContent='Delete leave permanently?';
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(leave.name)}</strong><br>${esc(leave.type)} · ${leavePeriodMarkup(leave)}<br>Status: ${esc(leave.status)}</p><p class="record-detail">This permanently removes this leave, its edit history and unshared MC attachments. It cannot be undone. Leave balances and attendance will be recalculated. Original machine punches are retained.</p><div class="field"><label for="leave-delete-reason">Reason for deletion (required)</label><textarea id="leave-delete-reason" rows="3" maxlength="1000" placeholder="For example: wrong leave applied, or staff decided to work" required></textarea></div>`;
  const save=document.getElementById('modal-save');save.textContent='Delete permanently';save.disabled=false;save.style.display='';
  const expectedRevision=leave.revision||0;
  save.onclick=async()=>{
    const reason=val('leave-delete-reason').trim();if(!reason)return toast('Enter a reason for deleting this leave.');
    if(save.disabled)return;save.disabled=true;
    const deleted=await saveAction('leave.delete',{id,expectedRevision,reason});
    if(deleted){if(editingLeaveId===id)clearLeavePlan();closeModal();toast('Leave permanently deleted. Balances and attendance updated.');}
    else save.disabled=false;
  };
  document.getElementById('modal-back').classList.add('open');
}
function confirmEmployeeChange(id) {
  const person=db.people.find(employee=>employee.id===id);if(!person)return toast('Employee not found.');
  document.getElementById('modal-title').textContent='Permanently remove employee?';
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(person.name)}</strong> · ${esc(employeeNumber(person))}</p><p class="record-detail">This permanently deletes the employee and their attendance, leave, corrections and uploaded documents from the app. This cannot be undone.</p>`;
  const save=document.getElementById('modal-save');save.textContent='Delete permanently';save.style.display='';save.disabled=false;
  save.onclick=async()=>{save.disabled=true;try{if(await saveAction('employee.remove',{id:person.id})){closeModal();toast(db.deletionFilesPending?'Employee deleted. Attachment cleanup is pending.':'Employee permanently deleted.');}}finally{save.disabled=false;}};
  document.getElementById('modal-back').classList.add('open');
}
function renderDevice() {
  const chip=document.getElementById('device-chip'), state=document.getElementById('device-state'), last=document.getElementById('device-last-seen');
  if(db.sync?.lastSeen&&(!db.device.lastSeen||db.sync.lastSeen>db.device.lastSeen)){
    if(chip){chip.classList.remove('online');chip.textContent='Software sync received';}
    if(state)state.textContent='Attendance software sync';
    if(last)last.textContent=`Last software sync ${new Date(db.sync.lastSeen).toLocaleString('en-GB',{hour12:true})} · ${db.sync.lastInserted} new logs in last batch`;
    return;
  }
  const online=!!db.device.online;
  if(chip){chip.classList.toggle('online',online);chip.innerHTML=`<i class="pulse" style="background:${online?'#57a577':'#adb5ae'}"></i>${online?'iClock990 connected':'Waiting for device'}`;}
  if(state)state.textContent=online?'Connected to office server':'Waiting for iClock990';
  if(last)last.textContent=db.device.lastSeen?`${online?'Last device signal':'Last seen'} ${new Date(db.device.lastSeen).toLocaleString('en-GB',{hour12:true})} · ${db.device.count} punches received`:'Waiting for the first device check-in';
}
function go(page) {
  if(!document.getElementById('page-'+page))return;
  const appraisalPage=Object.hasOwn(appraisalTitles,page);appraisalState.active=appraisalPage;
  document.getElementById('appraisal-toggle').classList.toggle('section-active',appraisalPage);
  if(appraisalPage){closeStaffLeave();document.getElementById('appraisal-toggle').setAttribute('aria-expanded','true');document.getElementById('appraisal-submenu').hidden=false;appraisalState.view=page;document.getElementById(page+'-host').appendChild(document.getElementById('appraisal-shared'));renderAppraisal();}else closeAppraisalMenu();
  const attendancePage=['attendance','closed-days'].includes(page);
  document.getElementById('attendance-toggle').classList.toggle('section-active',attendancePage);
  if(!attendancePage)closeAttendanceMenu();
  if(page==='system-users')loadSystemUsers();
  if(page==='leaves'||page==='sick'||page==='manage'||page==='staff-on-leave'){
    const changed=leaveView!==page;leaveView=page;
    if(page!=='staff-on-leave')document.getElementById(page==='manage'?'manage-host':page==='sick'?'sick-host':'leave-host').appendChild(document.getElementById('leave-shared'));
    document.getElementById('staff-leave-toggle').setAttribute('aria-expanded','true');document.getElementById('staff-leave-submenu').hidden=false;
    render();if(changed)clearLeavePlan();
  }
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));
  document.querySelectorAll('#nav button[data-page]').forEach(x=>{const active=x.dataset.page===page;x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
  document.getElementById('staff-leave-toggle').classList.toggle('section-active',['leaves','sick','manage','staff-on-leave'].includes(page));
  document.getElementById('crumb').textContent=appraisalPage?'Appraisal / '+appraisalTitles[page]:page==='closed-days'?'Attendance / Closed Days':page==='people'?'Employees':page==='system-users'?'System Users':page==='staff-on-leave'?'Staff Leave / Staff on Leave':page==='manage'?'Staff Leave / Manage Leave':page==='leaves'?'Staff Leave / Leave':page==='sick'?'Staff Leave / Sick Leave':page[0].toUpperCase()+page.slice(1);if(window.matchMedia('(max-width:700px)').matches){closeStaffLeave();closeAttendanceMenu();closeAppraisalMenu();}window.scrollTo(0,0);
}
window.addEventListener('click',event=>{if(window.matchMedia('(max-width:700px)').matches&&!event.target.closest?.('.nav-group'))closeStaffLeave();});
window.addEventListener('keydown',event=>{if(event.key==='Escape'){closeStaffLeave();closeAttendanceMenu();closeAppraisalMenu();}});
window.addEventListener('click',e=>{const b=e.target.closest?.('#nav button[data-page]');if(b)go(b.dataset.page);},true);
window.addEventListener('click',event=>{if(!event.target.closest?.('.appraisal-nav-group'))closeAppraisalMenu();});
document.getElementById('appraisal-filters').addEventListener('submit',event=>{event.preventDefault();const year=Number(val('appraisal-year'));if(!Number.isInteger(year)||year<2000||year>Number(appraisalToday().slice(0,4)))return toast('Choose a valid year.');appraisalState.year=year;appraisalState.basis=val('appraisal-basis');renderAppraisal();});
document.getElementById('appraisal-search').addEventListener('input',event=>{appraisalState.search=event.target.value;renderAppraisal();});
document.getElementById('appraisal-basis').addEventListener('change',event=>{appraisalState.basis=event.target.value;renderAppraisal();});
document.getElementById('appraisal-pdf').addEventListener('click',event=>exportAppraisal('pdf',event.currentTarget));document.getElementById('appraisal-docx').addEventListener('click',event=>exportAppraisal('docx',event.currentTarget));
document.getElementById('appraisal-search-button').addEventListener('click',()=>{appraisalState.search=val('appraisal-search');renderAppraisal();});
document.getElementById('appraisal-supervisor-button').addEventListener('click',()=>{const panel=document.getElementById('appraisal-supervisor-panel');panel.hidden=!panel.hidden;document.getElementById('appraisal-supervisor-button').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){renderAppraisalSupervisorOptions();document.getElementById('appraisal-supervisor-search').focus();}});
document.getElementById('appraisal-supervisor-search').addEventListener('input',renderAppraisalSupervisorOptions);
document.getElementById('appraisal-supervisor-options').addEventListener('click',event=>{const button=event.target.closest('[data-appraisal-supervisor]');if(!button)return;appraisalState.supervisor=button.dataset.appraisalSupervisor;document.getElementById('appraisal-supervisor-panel').hidden=true;document.getElementById('appraisal-supervisor-button').setAttribute('aria-expanded','false');renderAppraisal();});
document.getElementById('disciplinary-new').addEventListener('click',()=>openDisciplinaryAction());
document.getElementById('appraisal-table').addEventListener('click',event=>{const discipline=event.target.closest('[data-edit-disciplinary]'),supervisor=event.target.closest('[data-edit-supervisor]'),assign=event.target.closest('[data-assign-staff]'),view=event.target.closest('[data-view-appraisal]');if(discipline)openDisciplinaryAction(discipline.dataset.editDisciplinary);else if(supervisor)editSupervisorRecord(supervisor.dataset.editSupervisor);else if(assign)editSupervisorRecord(null,assign.dataset.assignStaff);else if(view)viewAppraisalEmployee(view.dataset.viewAppraisal);});
document.getElementById('assignment-supervisor-search').addEventListener('input',searchAssignmentSupervisor);
document.getElementById('assignment-supervisor-results').addEventListener('change',event=>{const input=event.target.closest('[data-assignment-supervisor]');if(input?.checked)selectAssignmentSupervisor(input.dataset.assignmentSupervisor);});
document.getElementById('assignment-staff-search').addEventListener('input',renderAssignmentStaff);
document.getElementById('assignment-staff-options').addEventListener('change',event=>{const input=event.target.closest('[data-assignment-staff]');if(!input||supervisorEditor.id)return;input.checked?supervisorEditor.selected.add(input.dataset.assignmentStaff):supervisorEditor.selected.delete(input.dataset.assignmentStaff);document.getElementById('assignment-selected-count').textContent=`${supervisorEditor.selected.size} selected`;});
document.getElementById('assignment-select-all').addEventListener('click',()=>{if(supervisorEditor.id)return;for(const person of assignmentEligibleStaff().filter(person=>matchesSchoolStaff(person,val('assignment-staff-search'))))supervisorEditor.selected.add(person.id);renderAssignmentStaff();});
document.getElementById('assignment-select-none').addEventListener('click',()=>{if(!supervisorEditor.id){supervisorEditor.selected.clear();renderAssignmentStaff();}});
document.getElementById('assignment-reset').addEventListener('click',resetSupervisorEditor);
document.getElementById('supervisor-assignment-form').addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('assignment-save');if(button.disabled)return;const supervisor=supervisorFromKey(val('assignment-supervisor-id'));if(!supervisor||!supervisorEditor.selected.size)return toast('Select a supervisor and at least one staff member.');if(!event.currentTarget.reportValidity())return;button.disabled=true;const assignment={...(supervisorEditor.id?{id:supervisorEditor.id}:{}),supervisor,employeeIds:[...supervisorEditor.selected]};try{if(await saveAction('supervisor.save',{assignment,expectedRevision:supervisorEditor.revision})){resetSupervisorEditor();toast('Supervisor assignments saved.');}}finally{button.disabled=false;}});
window.addEventListener('click',event=>{const discipline=document.getElementById('disciplinary-staff-results');if(discipline&&!event.target.closest?.('#disciplinary-staff-picker'))discipline.hidden=true;if(!event.target.closest?.('#appraisal-supervisor-panel')&&!event.target.closest?.('#appraisal-supervisor-button')){document.getElementById('appraisal-supervisor-panel').hidden=true;document.getElementById('appraisal-supervisor-button').setAttribute('aria-expanded','false');}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'){document.getElementById('appraisal-supervisor-panel').hidden=true;document.getElementById('appraisal-supervisor-button').setAttribute('aria-expanded','false');const discipline=document.getElementById('disciplinary-staff-results');if(discipline)discipline.hidden=true;}});
resetSupervisorEditor();


document.getElementById('att-period').addEventListener('change',e=>{attState.preset=e.target.value;if(attState.preset!=='custom'){const[f,t]=attPresetRange(attState.preset);attState.from=f;attState.to=t;}renderAttendance();});
document.getElementById('att-view').addEventListener('click',()=>{const from=document.getElementById('att-from').value,to=document.getElementById('att-to').value;if(!from||!to||from>to)return toast('Choose a valid attendance period.');attState.preset='custom';attState.from=from;attState.to=to;renderAttendance();});
document.getElementById('att-search').addEventListener('input',event=>{attState.search=event.target.value;attState.selectedStaff=null;attendanceStaffPicker.open=true;attendanceStaffPicker.active=-1;renderAttendance();});
document.getElementById('att-search').addEventListener('focus',()=>{attendanceStaffPicker.open=true;attendanceStaffPicker.active=-1;renderAttendanceStaffSuggestions();});
document.getElementById('att-search').addEventListener('click',()=>{attendanceStaffPicker.open=true;attendanceStaffPicker.active=-1;renderAttendanceStaffSuggestions();});
document.getElementById('att-search').addEventListener('keydown',event=>{
 if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();attendanceStaffPicker.open=true;renderAttendanceStaffSuggestions();const count=attendanceStaffPicker.ids.length;attendanceStaffPicker.active=event.key==='ArrowDown'?(attendanceStaffPicker.active+1)%count:attendanceStaffPicker.active<0?count-1:(attendanceStaffPicker.active-1+count)%count;renderAttendanceStaffSuggestions();}
 else if(event.key==='Enter'&&attendanceStaffPicker.open&&attendanceStaffPicker.active>=0){event.preventDefault();chooseAttendanceStaff(attendanceStaffPicker.active);}
 else if(event.key==='Escape'){event.preventDefault();closeAttendanceStaffSuggestions();}
 else if(event.key==='Tab')closeAttendanceStaffSuggestions();
});
document.getElementById('att-staff-results').addEventListener('pointerdown',event=>{if(event.target.closest('[data-att-staff-option]'))event.preventDefault();});
document.getElementById('att-staff-results').addEventListener('click',event=>{const option=event.target.closest('[data-att-staff-option]');if(option)chooseAttendanceStaff(Number(option.dataset.attStaffOption));});
window.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.att-staff-picker'))closeAttendanceStaffSuggestions();});
document.getElementById('att-sort').addEventListener('change',e=>{attState.sort=e.target.value;renderAttendance();});
document.getElementById('att-chips').addEventListener('click',e=>{const chip=e.target.closest('button.chip');if(!chip)return;attState.status=chip.dataset.status;document.querySelectorAll('#att-chips .chip').forEach(c=>c.classList.toggle('active',c===chip));renderAttendance();});
document.getElementById('att-print').addEventListener('click',()=>window.print());
document.getElementById('att-pdf').addEventListener('click',event=>exportAttendance('pdf',event.currentTarget));document.getElementById('att-docx').addEventListener('click',event=>exportAttendance('docx',event.currentTarget));
document.getElementById('staff-leave-submenu').addEventListener('click',event=>{if(event.target.closest('button[data-page]')&&window.matchMedia('(max-width:700px)').matches){document.getElementById('staff-leave-toggle').setAttribute('aria-expanded','false');document.getElementById('staff-leave-submenu').hidden=true;}});
window.addEventListener('click',event=>{if(!event.target.closest?.('.attendance-nav-group'))closeAttendanceMenu();});
document.getElementById('closed-day-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||closedDaysBusy)return;const entry={date:val('closed-day-date'),category:val('closed-day-category'),reason:val('closed-day-reason').trim()};if(await persistClosedDays([...closedDayEntries().filter(day=>day.date!==entry.date),entry]))form.reset();});
document.getElementById('closed-day-table').addEventListener('click',async event=>{const edit=event.target.closest('button[data-edit-closed]'),remove=event.target.closest('button[data-remove-closed]');if(edit){const day=closedDayEntries().find(day=>day.date===edit.dataset.editClosed);if(!day)return;document.getElementById('closed-day-date').value=day.date;document.getElementById('closed-day-category').value=day.category;document.getElementById('closed-day-reason').value=day.reason;document.getElementById('closed-day-form').scrollIntoView({block:'start'});}else if(remove)await persistClosedDays(closedDayEntries().filter(day=>day.date!==remove.dataset.removeClosed));});
document.getElementById('leave-filter').addEventListener('change',render);
document.getElementById('manage-leave-search').addEventListener('input',render);
document.getElementById('leave-filter-clear').addEventListener('click',()=>{document.getElementById('manage-leave-search').value='';document.getElementById('manage-leave-type').value='all';document.getElementById('leave-filter').value='all';render();});
document.getElementById('balance-type').addEventListener('change',renderLeaveBalances);
document.getElementById('balance-table').addEventListener('click',event=>{const view=event.target.closest('[data-view-balances]'),edit=event.target.closest('[data-edit-balances]');if(view)viewAllLeaveBalances(view.dataset.viewBalances);else if(edit)editBalance(edit.dataset.editBalances);});
document.getElementById('balance-search').addEventListener('input',renderLeaveBalances);
document.getElementById('balance-search-form').addEventListener('submit',event=>{event.preventDefault();renderLeaveBalances();});
document.getElementById('balance-search-clear').addEventListener('click',()=>{document.getElementById('balance-search').value='';renderLeaveBalances();document.getElementById('balance-search').focus();});
document.getElementById('manage-leave-type').addEventListener('change',render);
document.getElementById('leave-table').addEventListener('click',event=>{const remove=event.target.closest('button[data-delete-leave]');if(remove){confirmLeaveDeletion(remove.dataset.deleteLeave);return;}const button=event.target.closest('button[data-duty-report]');if(button)openDutyReport(button.dataset.dutyReport);});
document.getElementById('people-search').addEventListener('input',renderPeople);
document.getElementById('people-table').addEventListener('click',event=>{const edit=event.target.closest('button[data-edit-employee]');if(edit){openModal('employee',edit.dataset.editEmployee);return;}const button=event.target.closest('button[data-employee-id]');if(button)confirmEmployeeChange(button.dataset.employeeId);});
for(const type of ['click','focusin'])document.addEventListener(type,event=>{if(!event.target.closest?.('.staff-picker'))closeStaffSearch();});
document.getElementById('lp-staff-search').addEventListener('input',changeStaffSearch);
document.getElementById('lp-staff-search').addEventListener('focus',searchLeaveStaff);
document.getElementById('lp-staff-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchLeaveStaff();if(staffSearchOpen)document.querySelector('#lp-staff-results button')?.focus();}if(event.key==='Escape')closeStaffSearch();});
document.getElementById('lp-staff-search-button').addEventListener('click',searchLeaveStaff);
document.getElementById('lp-staff-reset').addEventListener('click',()=>{if(editingLeaveId)return;for(const id of ['lp-staff-search','lp-staff-role','lp-staff-department'])document.getElementById(id).value='';changeStaffSearch();document.getElementById('lp-staff-search').focus();});
for(const id of ['lp-staff-role','lp-staff-department'])document.getElementById(id).addEventListener('change',()=>{if(val('lp-employee'))document.getElementById('lp-staff-search').value='';changeStaffSearch();});
document.getElementById('lp-staff-filter-button').addEventListener('click',()=>{const panel=document.getElementById('lp-staff-filters');panel.hidden=!panel.hidden;document.getElementById('lp-staff-filter-button').setAttribute('aria-expanded',String(!panel.hidden));});
document.getElementById('lp-staff-results').addEventListener('click',event=>{const button=event.target.closest('button[data-select-staff]');if(button)selectLeaveStaff(button.dataset.selectStaff);});
document.getElementById('lp-employee').addEventListener('change',renderLeavePlanSummary);
document.getElementById('lp-type').addEventListener('change',()=>{if(document.getElementById('lp-days').readOnly)document.getElementById('lp-days').value=1;document.getElementById('lp-days').readOnly=val('lp-type')==='Maternity';renderLeavePlanSummary();});
const updatePlanReturn=()=>{previewLeavePlan();document.getElementById('lp-end').min=val('lp-start');};
for(const event of ['input','change'])document.getElementById('lp-start').addEventListener(event,updatePlanReturn);
document.getElementById('lp-days').addEventListener('input',updatePlanReturn);
for(const id of ['lp-trip-basis','lp-trip-office','lp-trip-charter','lp-trip-return','lp-trip-before','lp-trip-first','lp-trip-permission','lp-event-ref'])document.getElementById(id).addEventListener('change',updatePlanReturn);
document.getElementById('lp-clear').addEventListener('click',clearLeavePlan);
document.getElementById('leave-plan-form').addEventListener('submit',e=>{e.preventDefault();if(!editingLeaveId)saveLeavePlan(false);});
document.getElementById('lp-update').addEventListener('click',()=>saveLeavePlan(true));
clearLeavePlan();
// Session lifecycle: reloads may resume this tab; fresh openings require a password.
const SESSION_IDLE_MS=30*60*1000;
const SESSION_REFRESH_MS=60*1000;
const SESSION_STORAGE_KEY='haazir-tab-session-v1';
let lastActivityAt=0,lastSessionRefreshAt=0;
let idleTimer=null,sessionRefreshTimer=null,sessionRefreshInFlight=null;
let sessionReset=Promise.resolve(null);
function readClientSession(){
  try{const saved=JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)||'null');return saved?.version===1&&Number.isFinite(saved.lastActivityAt)&&saved.lastActivityAt>0&&saved.lastActivityAt<=Date.now()?saved:null;}
  catch{return null;}
}
function saveClientSession(){try{sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify({version:1,lastActivityAt}));}catch{/* Reloads require sign-in when tab storage is unavailable. */}}
function clearClientSession(){try{sessionStorage.removeItem(SESSION_STORAGE_KEY);}catch{}}
function sessionHasExpired(){return !lastActivityAt||Date.now()-lastActivityAt>=SESSION_IDLE_MS;}
function clearSessionTimers(){clearTimeout(idleTimer);clearTimeout(sessionRefreshTimer);idleTimer=null;sessionRefreshTimer=null;}
function lockSession(message=''){
  setAuthenticated(false);clearClientSession();clearSessionTimers();closeModal();
  document.documentElement?.classList?.remove('theme-user');
  db={people:[],attendance:[],leaves:[],device:{online:false,lastSeen:null,serial:null,count:0}};
  lastActivityAt=0;editingLeaveId=null;editingLeaveRevision=null;pendingMcUpload=null;
  showLoginError(message);
  // Finish pending renewal/logout before another password is accepted.
  const pending=sessionRefreshInFlight,previousReset=sessionReset;
  sessionReset=Promise.allSettled([pending,previousReset]).then(()=>api('/api/auth/logout',{method:'POST'})).then(()=>null,error=>error);
  return sessionReset;
}
function checkSessionTimeout(){
  if(authenticated&&sessionHasExpired()){lockSession('You were inactive for 30 minutes. Please sign in again.');return true;}
  return false;
}
function scheduleIdleCheck(){
  clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>{idleTimer=null;if(authenticated&&!checkSessionTimeout())scheduleIdleCheck();},Math.max(1,SESSION_IDLE_MS-(Date.now()-lastActivityAt)));
}
function startClientSession(){lastActivityAt=Date.now();lastSessionRefreshAt=lastActivityAt;saveClientSession();scheduleIdleCheck();}
function renewSession(){
  if(!authenticated||checkSessionTimeout()||sessionRefreshInFlight)return;
  const generation=authGeneration;
  sessionRefreshInFlight=api('/api/auth/session',{method:'POST'}).then(()=>{if(authenticated&&generation===authGeneration)lastSessionRefreshAt=Date.now();}).catch(error=>{
    if(error.status===401&&authenticated&&generation===authGeneration)lockSession('Your session has expired. Please sign in again.');
  }).finally(()=>{sessionRefreshInFlight=null;});
}
function recordSessionActivity(event){
  if(!event.isTrusted||!authenticated||checkSessionTimeout())return;
  lastActivityAt=Date.now();saveClientSession();scheduleIdleCheck();
  const delay=SESSION_REFRESH_MS-(Date.now()-lastSessionRefreshAt);
  if(delay<=0){clearTimeout(sessionRefreshTimer);sessionRefreshTimer=null;renewSession();}
  else if(sessionRefreshTimer===null)sessionRefreshTimer=setTimeout(()=>{sessionRefreshTimer=null;renewSession();},delay);
}
async function initializeSession(fromHistory=false){
  setAuthenticated(false,true);
  const saved=readClientSession();
  const reloading=performance.getEntriesByType('navigation')[0]?.type==='reload';
  if((!reloading&&!fromHistory)||!saved||Date.now()-saved.lastActivityAt>=SESSION_IDLE_MS){
    await lockSession(saved&&Date.now()-saved.lastActivityAt>=SESSION_IDLE_MS?'You were inactive for 30 minutes. Please sign in again.':'');return;
  }
  const generation=authGeneration;lastActivityAt=saved.lastActivityAt;
  try{
    await api('/api/auth/session',{method:'POST'});
    const state=await api('/api/state',{resume:true});
    if(generation!==authGeneration)return;
    db=state;render();setAuthenticated(true);startClientSession();
  }catch(error){if(generation===authGeneration)await lockSession(error.status===401?'Your session has expired. Please sign in again.':'Could not resume your session. Please sign in again.');}
}
let sessionReady=initializeSession();
for(const type of ['pointerdown','pointermove','keydown','touchstart','scroll'])document.addEventListener(type,recordSessionActivity,{passive:true,capture:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkSessionTimeout();});
window.addEventListener('focus',()=>checkSessionTimeout());
window.addEventListener('pagehide',()=>{setAuthenticated(false,true);clearSessionTimers();closeModal();});
document.getElementById('toggle-password').addEventListener('click',()=>{
  const input=document.getElementById('login-password'),toggle=document.getElementById('toggle-password');
  const visible=input.type==='password';input.type=visible?'text':'password';
  toggle.setAttribute('aria-pressed',String(visible));toggle.setAttribute('aria-label',visible?'Hide password':'Show password');
});
let recoveryBusy=false,recoveryStage='email';
function setRecoveryStep(stage){
  recoveryStage=stage;
  document.getElementById('recovery-email-step').hidden=stage==='password';
  document.getElementById('recovery-email').readOnly=stage!=='email';
  document.getElementById('recovery-code-step').hidden=stage!=='code';
  document.getElementById('recovery-password-step').hidden=stage!=='password';
  document.getElementById('recovery-code').disabled=stage!=='code';
  for(const id of ['recovery-password','recovery-confirm'])document.getElementById(id).disabled=stage!=='password';
  document.getElementById('recovery-resend').hidden=stage!=='code';
  document.getElementById('recovery-restart').hidden=stage==='email';
  document.getElementById('recovery-form').querySelector('button[type="submit"]').textContent=stage==='email'?'Send code':stage==='code'?'Verify code':'Reset password';
}
function showRecovery(show){
  if(loginBusy||recoveryBusy)return;
  document.getElementById('password-recovery').hidden=!show;
  document.getElementById('login-form').hidden=show;
  document.getElementById('forgot-password').setAttribute('aria-expanded',String(show));
  for(const id of ['recovery-email','recovery-code','recovery-password','recovery-confirm'])document.getElementById(id).value='';
  document.getElementById('recovery-message').textContent='';setRecoveryStep('email');
  showLoginError('');document.getElementById(show?'recovery-email':'login-password').focus();
}
document.getElementById('forgot-password').addEventListener('click',()=>showRecovery(true));
document.getElementById('recovery-back').addEventListener('click',()=>showRecovery(false));
document.getElementById('recovery-restart').addEventListener('click',()=>{if(recoveryBusy)return;for(const id of ['recovery-code','recovery-password','recovery-confirm'])document.getElementById(id).value='';setRecoveryStep('email');document.getElementById('recovery-message').textContent='';document.getElementById('recovery-email').focus();});
async function submitRecovery(form,resend=false){
  if(recoveryBusy||loginBusy)return;
  const message=document.getElementById('recovery-message');message.textContent='';message.setAttribute('data-kind','error');
  const stage=resend?'email':recoveryStage;
  const email=document.getElementById('recovery-email').value.trim();
  const password=document.getElementById('recovery-password').value;
  if(stage==='password'&&password!==document.getElementById('recovery-confirm').value){message.textContent='The passwords do not match.';document.getElementById('recovery-confirm').focus();return;}
  recoveryBusy=true;const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent=stage==='email'?'Sending...':stage==='code'?'Verifying...':'Resetting...';
  try{
    await sessionReady;const startupError=await sessionReset;if(startupError)throw startupError;
    if(stage==='email'){
      const result=await api('/api/auth/request-code',{method:'POST',body:JSON.stringify({email})});
      setRecoveryStep('code');document.getElementById('recovery-code').value='';message.textContent=result.message||'If this is your registered recovery email, a code has been sent.';message.setAttribute('data-kind','success');document.getElementById('recovery-code').focus();
    }else if(stage==='code'){
      await api('/api/auth/verify-code',{method:'POST',body:JSON.stringify({email,code:document.getElementById('recovery-code').value})});
      document.getElementById('recovery-code').value='';setRecoveryStep('password');message.textContent='Email verified. Choose your new password.';message.setAttribute('data-kind','success');document.getElementById('recovery-password').focus();
    }else{
      await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({password})});
      await lockSession();recoveryBusy=false;showRecovery(false);showLoginError('Password reset successfully. Sign in with your new password.');document.getElementById('login-error').setAttribute('data-kind','success');
    }
  }catch(error){message.textContent=error.message;}
  finally{recoveryBusy=false;button.disabled=false;setRecoveryStep(recoveryStage);}
}
document.getElementById('recovery-form').addEventListener('submit',async e=>{e.preventDefault();await submitRecovery(e.currentTarget);});
document.getElementById('recovery-resend').addEventListener('click',()=>submitRecovery(document.getElementById('recovery-form'),true));
document.getElementById('login-form').addEventListener('submit',async e=>{
  e.preventDefault();if(loginBusy)return;
  loginBusy=true;const generation=++authGeneration;
  showLoginError('');const button=e.currentTarget.querySelector('button[type="submit"]');
  const password=document.getElementById('login-password').value,username=document.getElementById('login-username').value.trim();
  button.disabled=true;button.textContent='Signing in�';
  try{
    await sessionReady;const startupError=await sessionReset;if(startupError)throw startupError;
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});
    const state=await api('/api/state',{resume:true});
    if(generation!==authGeneration)return;
    db=state;document.getElementById('login-password').value='';render();setAuthenticated(true);startClientSession();
  }catch(error){if(generation===authGeneration){setAuthenticated(false);showLoginError(error.message);document.getElementById('login-password').focus();}}
  finally{loginBusy=false;button.disabled=false;button.textContent='Sign in';}
});
document.getElementById('mobile-signout')?.addEventListener('click',()=>document.getElementById('logout').click());
document.getElementById('logout').addEventListener('click',async()=>{
  const error=await lockSession();if(error)showLoginError('Could not clear the server session. Please try signing out again.');
});
window.addEventListener('pageshow',event=>{if(event.persisted){sessionReady=initializeSession(true);}});
setDate();
setInterval(()=>{if(authenticated&&!checkSessionTimeout()){const generation=authGeneration;refreshState().catch(error=>{if(error.status===401&&generation===authGeneration)lockSession('Your session has expired. Please sign in again.');});}},10000);

async function saveAction(action,payload) { ++stateWriteVersion;try { db=await api('/api/state',{method:'POST',body:JSON.stringify({action,...payload})});++stateWriteVersion;render();return true; } catch(error) { ++stateWriteVersion;toast(error.message);return false; } }
function closeModal(){document.getElementById('balance-reset')?.remove();document.getElementById('modal-back').classList.remove('open');}
function val(id){return document.getElementById(id)?.value||'';}
async function saveLeavePlan(update) {
  if(leavePlanBusy||update!==!!editingLeaveId||update!==(leaveView==='manage'))return;
  const form=document.getElementById('leave-plan-form');if(!form.reportValidity())return;
  const existing=db.leaves.find(l=>l.id===editingLeaveId);
  const leave={employeeId:val('lp-employee'),type:val('lp-type'),days:Number(val('lp-days')),start:val('lp-start'),end:val('lp-end'),reason:val('lp-reason'),status:existing?.status||'Approved',trip:leaveTripInput(),duty:val('lp-type')==='Duty travel'?dutyTravelInput():undefined,eventReference:val('lp-event-ref'),mcDocumentId:val('lp-type')==='Sick with MC'?existing?.mcDocumentId:undefined};
  if(!leave.employeeId||!Number.isFinite(leave.days)||leave.days<=0||!leave.end||leave.end<leave.start)return toast('Check the staff member, dates and leave days.');
  if(update&&!val('lp-edit-reason').trim())return toast('Enter a reason for this leave change.');
  const file=leave.type==='Sick with MC'?document.getElementById('lp-mc-file').files[0]:null;
  if(file&&file.size>5*1024*1024)return toast('Choose an MC file no larger than 5 MB.');
  leavePlanBusy=true;renderLeavePlanSummary();
  try{
    if(file){
      if(!pendingMcUpload||pendingMcUpload.file!==file||pendingMcUpload.employeeId!==leave.employeeId){
        const formData=new FormData();formData.append('employeeId',leave.employeeId);formData.append('file',file);
        const response=await fetch('/api/mc-documents',{method:'POST',credentials:'same-origin',body:formData});
        const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'MC upload failed.');
        pendingMcUpload={file,employeeId:leave.employeeId,id:result.document.id};
      }
      leave.mcDocumentId=pendingMcUpload.id;
    }
    if(await saveAction(update?'leave.update':'leave.create',{id:editingLeaveId,leave,expectedRevision:editingLeaveRevision,editReason:val('lp-edit-reason')})){clearLeavePlan();toast(update?'Leave record updated.':'Leave record saved.');}
  }catch(error){toast(error.message);}finally{leavePlanBusy=false;renderLeavePlanSummary();}
}
function editLeaveRecord(id) {
  if(leavePlanBusy)return;
  const leave=db.leaves.find(l=>l.id===id), person=db.people.find(p=>p.id===leave?.employeeId);
  if(!leave||!person)return toast('Leave record not found.');
  go('manage');
  editingLeaveId=id;
  pendingMcUpload=null;document.getElementById('lp-mc-file').value='';
  editingLeaveRevision=leave.revision||0;
  const typeSelect=document.getElementById('lp-type');
  if(![...typeSelect.options].some(o=>o.value===leave.type)){const option=document.createElement('option');option.value=leave.type;option.textContent=leave.type+' (legacy)';option.dataset.legacy='true';typeSelect.append(option);}
  staffSearchOpen=false;
  document.getElementById('lp-employee').value=person.id;refreshLeaveStaff();
  for(const [field,value] of Object.entries({type:leave.type,days:leave.days,start:leave.start,end:leave.end,reason:leave.reason}))document.getElementById('lp-'+field).value=value;
  const trip=leave.trip||{};
  for(const [id,value] of Object.entries({'lp-trip-basis':trip.basis||'','lp-trip-office':trip.office||'Male','lp-trip-charter':trip.charter?'yes':'no','lp-trip-return':trip.flightReturn||'','lp-trip-before':trip.atollBefore||0,'lp-trip-permission':trip.permissionReference||'','lp-event-ref':leave.eventReference||''}))document.getElementById(id).value=value;
  document.getElementById('lp-trip-first').checked=trip.firstHajjConfirmed===true;
  document.getElementById('lp-end').min=leave.start;
  renderLeaveHistory(id);renderLeavePlanSummary();document.getElementById('leave-workspace').scrollIntoView({block:'start'});
}
function openDutyReport(id){
  const leave=db.leaves.find(l=>l.id===id&&l.type==='Duty travel'&&l.status==='Approved');if(!leave)return toast('Approved duty travel record not found.');
  document.getElementById('modal-title').textContent='Record duty travel return';
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(leave.name)}</strong> · ${esc(leave.duty?.destination)}</p><div class="field"><label for="duty-report-at">Reported to attendance officer (Maldives time)</label><input id="duty-report-at" type="datetime-local" required></div><div class="field"><label for="duty-report-ref">Report / officer acknowledgement reference</label><input id="duty-report-ref" maxlength="300" required></div>`;
  const save=document.getElementById('modal-save');save.textContent='Complete duty record';save.disabled=false;save.style.display='';
  save.onclick=async()=>{if(!val('duty-report-at')||!val('duty-report-ref').trim())return toast('Enter the reporting time and acknowledgement reference.');save.disabled=true;try{if(await saveAction('leave.duty.complete',{id:leave.id,expectedRevision:leave.revision||0,reportedAt:val('duty-report-at'),reportReference:val('duty-report-ref')})){closeModal();toast('Duty return report recorded.');}}finally{save.disabled=false;}};
  document.getElementById('modal-back').classList.add('open');
}
function renderLeaveHistory(id){
  const history=(db.leaveChanges||[]).filter(change=>change.leaveId===id).slice().reverse();
  const summary=leave=>`Applied: ${leave.appliedOn?nice(leave.appliedOn):'Not recorded'} · ${leave.type} · ${nice(leave.start)} · Expected return ${nice(leave.end)} · ${leave.days} planned days · ${leave.deductibleDays??leave.days} deductible days · ${leave.usedDays??'—'} used · ${leave.status} · ${leave.payBasis||'Paid'} · MC file: ${leave.mcDocumentId?'attached':'not attached'}${leave.duty?' · Duty destination: '+leave.duty.destination+' · Purpose: '+leave.duty.purpose+' · Order: '+leave.duty.approvalReference+' · Duty times: '+leave.duty.startTime+' to '+leave.duty.lastDate+' '+leave.duty.endTime+' · Reported: '+(leave.duty.reportedAt||'not recorded')+' · Report ref: '+(leave.duty.reportReference||'not recorded'):''}`;
  document.getElementById('leave-edit-history').innerHTML=`<div class="correction-history"><h3>Leave change history</h3>${history.length?history.map(change=>`<article><strong>${esc(change.actor)} · ${esc(new Date(change.at).toLocaleString('en-GB',{hour12:true}))}</strong><p>${esc(change.reason)}</p><p>Before: ${esc(summary(change.before))}</p><p>After: ${esc(summary(change.after))}</p>${change.before.mcDocumentId?`<a href="/api/mc-documents/${encodeURIComponent(change.before.mcDocumentId)}">Previous MC</a>`:""} ${change.after.mcDocumentId?`<a href="/api/mc-documents/${encodeURIComponent(change.after.mcDocumentId)}">Attached MC</a>`:""}</article>`).join(''):'<p class="record-detail">No edits recorded for this leave.</p>'}</div>`;
}
function openModal(kind,employeeId=null){let title,body,saveFn;
  if(kind==='profile'){
    title='Staff leave profile';
    const person=db.people.find(p=>p.id===val('lp-employee'));if(!person)return;
    body=`<p>${esc(person.name)}</p><div class="field"><label for="f-gender">Gender for circumcision leave allowance</label><select id="f-gender"><option value="">Select</option><option ${person.gender==='Female'?'selected':''}>Female</option><option ${person.gender==='Male'?'selected':''}>Male</option></select></div>`;
    saveFn=async()=>{if(await saveAction('employee.gender',{id:person.id,gender:val('f-gender')})){closeModal();toast('Leave profile saved.');}};
  }
  if(kind==='leave'){if(leavePlanBusy)return;go(leaveView==='sick'?'sick':'leaves');clearLeavePlan();document.getElementById('leave-workspace').scrollIntoView({block:'start'});return;}
  if(kind==='manual'){openAttendanceCorrection();return;
  } else if(kind==='employee'){
    const person=employeeId?db.people.find(employee=>employee.id===employeeId):null;
    if(employeeId&&!person)return toast('Employee not found.');
    const editing=!!person;
    title=editing?'Edit employee':'Add teacher or admin staff';
    body=`<div class="field"><label for="f-name">Full name</label><input id="f-name" placeholder="Staff member name" value="${esc(person?.name||'')}"></div><div class="form-row"><div class="field"><label for="f-role">Staff type</label><select id="f-role"><option ${person?.role==='Teacher'?'selected':''}>Teacher</option><option ${person?.role==='Leading Teacher'?'selected':''}>Leading Teacher</option><option ${person?.role==='Admin Staff'?'selected':''}>Admin Staff</option><option ${person?.role==='Administrator'?'selected':''}>Administrator</option><option ${person?.role==='Technical Staff'?'selected':''}>Technical Staff</option><option ${person?.role==='Support Staff'?'selected':''}>Support Staff</option><option ${person?.role==='Principal'?'selected':''}>Principal</option><option ${person?.role==='Deputy Principal'?'selected':''}>Deputy Principal</option></select></div><div class="field"><label for="f-dept">Department</label><input id="f-dept" placeholder="Department" value="${esc(person?.dept||'')}"></div></div><div class="field"><label for="f-idcard">ID card number</label><input id="f-idcard" placeholder="National ID / identity card number" value="${esc(person?.idCardNumber||'')}"></div><div class="field"><label for="f-pin">Machine PIN / user ID</label><input id="f-pin" placeholder="PIN shown on iClock990" value="${esc(person?.devicePin||'')}"></div>`;
    saveFn=async()=>{const employee={name:val('f-name').trim(),role:val('f-role'),dept:val('f-dept'),idCardNumber:val('f-idcard').trim(),devicePin:val('f-pin').trim()};if(!employee.name||!employee.devicePin)return toast('Name and machine PIN are required.');const action=editing?'employee.update':'employee.create';if(await saveAction(action,{id:person?.id,employee})){closeModal();toast(editing?'Employee details updated.':'Staff member added.');}};
  }
  document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;
  const saveButton=document.getElementById('modal-save');saveButton.textContent='Save';saveButton.disabled=false;saveButton.style.display=saveFn?'':'none';saveButton.onclick=saveFn;
  document.getElementById('modal-back').classList.add('open');
}
async function decision(id,status){if(await saveAction('leave.decision',{id,status}))toast(`Leave ${status.toLowerCase()}.`);}
function syncJoiningDateEditor(lockOverride){
  const field=document.getElementById('balance-joined');if(!field)return;
  const person=db.people.find(person=>person.id===field.dataset.employeeId);if(!person)return;
  const lock=lockOverride||person.joiningDateLock;
  field.disabled=!!lock?.locked;
  if(lock?.locked)field.value=person.joinedOn||'';
  const message=document.getElementById('balance-joining-lock');
  if(message){message.hidden=!lock?.locked;message.textContent=lock?.message||'';}
}
function editBalance(id){
  if(!viewerIsAdmin())return toast('Only the Administrator can edit leave balances.');
  const person=db.people.find(p=>p.id===id);if(!person)return;
  const types=(db.leavePolicy?.openingBalanceTypes||['Family','Annual','Sick with MC','Sick without MC']).filter(type=>!['Medical','Casual'].includes(type)||Number(person.entitlements?.[type])>0),rules={...(db.leavePolicy?.defaultLeavePeriodRules||{}),...person.leavePeriodRules};
  const editorGeneration=++balanceEditorGeneration;
  for(const type of db.leavePolicy?.cscServiceTypes||['Annual','Family','Sick with MC','Sick without MC'])rules[type]='Service year';
  const asOf=appraisalToday();
  const revision=person.leaveBalanceRevision||0;let preview=null,version=0,previewKey='';const drafts=new Map();
  document.getElementById('modal-title').textContent='Edit balances · '+person.name;
  document.getElementById('modal-body').innerHTML=`<div class="field"><label for="balance-joined">Staff joining date</label><input id="balance-joined" data-employee-id="${esc(id)}" aria-describedby="balance-joining-lock" type="date" required value="${esc(person.joinedOn||'')}"></div><p id="balance-joining-lock" role="status" hidden></p><p id="balance-editor-message" role="status"></p><div id="opening-balance-fields"></div>`;
  syncJoiningDateEditor();
  const save=document.getElementById('modal-save');save.style.display='';save.disabled=true;save.textContent='Save balances';
  document.getElementById('balance-reset')?.remove();
  const reset=document.createElement('button');reset.id='balance-reset';reset.type='button';reset.className='btn';reset.textContent='Reset';
  save.parentElement.insertBefore(reset,save.parentElement.firstElementChild);
  reset.onclick=async()=>{
    if(reset.disabled)return;reset.disabled=true;
    try{
      for(const [index,type] of types.entries()){drafts.set(type,'0');const field=document.getElementById('opening-balance-'+index);if(field)field.value='0';}
      await refresh();
      if(save.disabled)return;
      await save.onclick();
      if(!document.getElementById('modal-back').classList.contains('open'))toast('Leave balances reset and saved.');
    }finally{reset.disabled=false;}
  };
  const remember=()=>{for(const row of preview?.rows||[]){const field=document.getElementById('opening-balance-'+types.indexOf(row.type));if(field)drafts.set(row.type,field.value);}};
  const refresh=async()=>{
    const key=JSON.stringify([val('balance-joined'),rules]);if(key===previewKey)return;
    previewKey=key;remember();const generation=++version;save.disabled=true;
    const params=new URLSearchParams({id,asOf,joinedOn:val('balance-joined'),rules:JSON.stringify(rules)});
    document.getElementById('balance-editor-message').textContent='';
    try{
      const next=await api('/api/balance-periods?'+params);if(generation!==version||editorGeneration!==balanceEditorGeneration||!document.getElementById('balance-joined'))return;
      if(next.revision!==revision)throw new Error('These balances changed. Close and reopen the editor.');
      syncJoiningDateEditor(next.joiningDateLock);preview=next;const needsSetup=next.rows.some(row=>!row.period.start);
      document.getElementById('opening-balance-fields').innerHTML=next.rows.map(row=>{
        const index=types.indexOf(row.type),value=drafts.get(row.type)??row.opening;
        return `<div class="field"><label for="opening-rule-${index}">${esc(row.type)} · balance period</label>${['Family','Annual','Sick with MC','Sick without MC'].includes(row.type)?`<small class="record-detail">CSC service year${row.type.startsWith('Sick')?' · Shared sick period':''}</small>`:`<select id="opening-rule-${index}" data-balance-rule="${esc(row.type)}"><option ${row.period.basis==='Service year'?'selected':''}>Service year</option><option ${row.period.basis==='Calendar year'?'selected':''}>Calendar year</option></select>`}<small class="record-detail">${esc(displayDates(row.period.label))}</small><label for="opening-balance-${index}">Previously used days</label><input id="opening-balance-${index}" type="number" min="0" max="366" step="0.5" required value="${esc(value)}"><small class="record-detail">Recorded in this period: ${row.recorded} days · Allowance: ${row.entitlement} days</small></div>`;
      }).join('');
      document.getElementById('balance-editor-message').textContent=needsSetup?'Staff joining date required.':Object.values(next.legacy||{}).some(entry=>Object.values(entry.used||{}).some(value=>value>0))?'Earlier year-only opening balances are retained in history. Check and enter the correct usage for the periods above.':'';
      save.disabled=needsSetup;
    }catch(error){if(generation===version&&editorGeneration===balanceEditorGeneration&&document.getElementById('balance-editor-message')){previewKey='';document.getElementById('balance-editor-message').textContent=error.message;}}
  };
  for(const field of ['balance-joined'])document.getElementById(field).addEventListener('change',refresh);
  document.getElementById('opening-balance-fields').addEventListener('change',event=>{const rule=event.target.closest('[data-balance-rule]');if(!rule)return;rules[rule.dataset.balanceRule]=rule.value;if(rule.dataset.balanceRule==='Sick with MC')rules['Sick without MC']=rule.value;refresh();});
  save.onclick=async()=>{
    if(save.disabled||!preview)return;const fields=[...document.querySelectorAll('#modal-body input,#modal-body textarea')];if(fields.some(field=>!field.disabled&&!field.reportValidity()))return;
    const used=Object.fromEntries(types.map((type,index)=>[type,Number(val('opening-balance-'+index))]));save.disabled=true;reset.disabled=true;
    if(await saveAction('employee.period-balances',{id,asOf,joinedOn:val('balance-joined'),rules,used,expectedRevision:revision})){closeModal();toast('Leave periods and opening balances saved.');}else{save.disabled=false;reset.disabled=false;}
  };
  document.getElementById('modal-back').classList.add('open');refresh();
}
async function editLeaveDays(id){const leave=db.leaves.find(item=>item.id===id);if(!leave)return;const usedDays=prompt(`Actual ${leave.type.toLowerCase()} leave days used by ${leave.name} (maximum ${leave.days}):`,leave.usedDays??leave.days);if(usedDays===null)return;if(usedDays===''||!Number.isFinite(Number(usedDays))||Number(usedDays)<0||Number(usedDays)>leave.days)return toast('Enter a number between zero and the planned days.');if(await saveAction('leave.adjust',{id,usedDays:Number(usedDays)}))toast('Actual leave days updated.');}
function exportAttendance(format='csv',button){
  const source=attRows!==null?attRows:db.attendance;
  const rows=[['Employee','Date','Check-in','Check-out','Worked','Late (mins)','Status','Source','Corrected by','Corrected at','Correction reason','Punch note'],...source.map(r=>{const c=(db.attendanceCorrections||[]).find(c=>c.id===r.correctionId);return [r.name,nice(r.date),r.checkIn,r.checkOut,r.workedMins?fmtMins(r.workedMins):'—',r.lateMins||0,r.status,r.source||r.leave||'',c?.actor||'',c?.createdAt||'',c?.reason||'',r.note||''];})];
  if(['pdf','docx'].includes(format))return downloadReport(format,{title:'Attendance',caption:document.getElementById('att-range-label').textContent+(attState.status==='all'?'':' | '+attState.status)+(attState.search?' | Search: '+attState.search:''),columns:rows[0],rows:rows.slice(1),filename:'haaziry-attendance-'+attState.from+'-to-'+attState.to},button);
  const csv=rows.map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='attendance.csv';link.click();URL.revokeObjectURL(link.href);
}

// Add column labels to real table cells so phone cards keep the same data and actions.
function labelMobileTables(){
  document.querySelectorAll('#app-container .table-wrap table').forEach(table=>{
    const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,index)=>{const label=headers[index]||'Action';if(cell.dataset.label!==label)cell.dataset.label=label;}));
  });
}
let mobileTableFrame=null;
const mobileTableObserver=new MutationObserver(()=>{if(mobileTableFrame!==null)return;mobileTableFrame=requestAnimationFrame(()=>{mobileTableFrame=null;labelMobileTables();});});
mobileTableObserver.observe(document.getElementById('app-container'),{childList:true,subtree:true});
labelMobileTables();

// ---------- System users (Administrator only) ----------
let systemUsers=[];
function viewerIsAdmin(){return (db.viewer?.kind||'admin')==='admin';}
function applyViewer(){
  const viewer=db.viewer||{kind:'admin',name:'Administrator'},admin=viewer.kind==='admin';
  document.documentElement?.classList?.toggle('theme-user',!admin);
  const nav=document.getElementById('system-users-nav');nav.hidden=!admin;nav.style.display=admin?'':'none';
  document.getElementById('viewer-name').textContent=admin?'HR Administrator':viewer.name;
  if(!admin&&document.getElementById('page-system-users').classList.contains('active'))go('overview');
}
async function loadSystemUsers(){
  try{systemUsers=(await api('/api/system-users')).users;renderSystemUsers();}catch(error){toast(error.message);}
}
function renderSystemUsers(){
  const date=value=>value?new Date(value).toLocaleDateString():'—';
  const admin=`<tr><td>${personCell('Administrator')}</td><td>Administrator</td><td><span class="status present">Administrator</span></td><td><span class="status present">Active</span></td><td>—</td><td class="employee-action-cell"><small class="staff-role">Current login · change via Forgot password</small></td></tr>`;
  const rows=systemUsers.map(user=>`<tr><td>${personCell(user.name)}</td><td>${esc(user.username)}</td><td><span class="status leave">User</span></td><td>${user.disabled?'<span class="status absent">Disabled</span>':'<span class="status present">Active</span>'}</td><td>${esc(date(user.createdAt))}</td><td class="employee-action-cell"><button type="button" class="text-btn" data-edit-user="${esc(user.id)}">Edit</button><button type="button" class="text-btn" data-toggle-user="${esc(user.id)}">${user.disabled?'Enable':'Disable'}</button><button type="button" class="text-btn employee-remove" data-delete-user="${esc(user.id)}">Delete</button></td></tr>`).join('');
  document.getElementById('system-users-table').innerHTML=admin+rows;
  document.getElementById('system-users-count').textContent=`${systemUsers.length+1} account${systemUsers.length?'s':''}`;
}
async function saveSystemUser(payload,message){
  const save=document.getElementById('modal-save');if(save.disabled)return;save.disabled=true;
  try{systemUsers=(await api('/api/system-users',{method:'POST',body:JSON.stringify(payload)})).users;renderSystemUsers();closeModal();toast(message);}
  catch(error){toast(error.message);}finally{save.disabled=false;}
}
function openSystemUser(id=null){
  const user=systemUsers.find(item=>item.id===id);
  document.getElementById('modal-title').textContent=user?'Edit user · '+user.name:'Add system user';
  document.getElementById('modal-body').innerHTML=`<div class="field"><label for="su-name">Full name</label><input id="su-name" maxlength="100" value="${esc(user?.name||'')}"></div><div class="field"><label for="su-username">Username</label><input id="su-username" maxlength="32" autocomplete="off" value="${esc(user?.username||'')}" ${user?'disabled':''}></div><div class="field"><label for="su-password">${user?'New password (leave blank to keep current)':'Password'}</label><input id="su-password" type="password" minlength="8" maxlength="128" autocomplete="new-password"></div><div class="field"><label for="su-confirm">Confirm password</label><input id="su-confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password"></div><p class="record-detail">Users can use every page except System Users. Changing the password signs the user out.</p>`;
  const save=document.getElementById('modal-save');save.textContent=user?'Save changes':'Create user';save.style.display='';save.disabled=false;
  save.onclick=()=>{
    const name=val('su-name').trim(),username=val('su-username').trim(),password=val('su-password');
    if(!name)return toast('Enter the user\'s full name.');
    if(!user&&!username)return toast('Enter a username.');
    if((!user||password)&&password.length<8)return toast('Use a password of at least 8 characters.');
    if(password!==val('su-confirm'))return toast('The passwords do not match.');
    if(user)saveSystemUser({action:'update',id:user.id,name,...(password?{password}:{})},'User updated.');
    else saveSystemUser({action:'create',name,username,password},'User created.');
  };
  document.getElementById('modal-back').classList.add('open');
  document.getElementById('su-name').focus();
}
function confirmSystemUserDelete(id){
  const user=systemUsers.find(item=>item.id===id);if(!user)return;
  document.getElementById('modal-title').textContent='Delete user?';
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(user.name)}</strong> · ${esc(user.username)}</p><p class="record-detail">This user will no longer be able to sign in. Staff records they changed are kept.</p>`;
  const save=document.getElementById('modal-save');save.textContent='Delete user';save.style.display='';save.disabled=false;
  save.onclick=()=>saveSystemUser({action:'delete',id},'User deleted.');
  document.getElementById('modal-back').classList.add('open');
}
document.getElementById('system-user-add').addEventListener('click',()=>openSystemUser());
document.getElementById('system-users-table').addEventListener('click',event=>{
  const edit=event.target.closest('[data-edit-user]'),toggle=event.target.closest('[data-toggle-user]'),remove=event.target.closest('[data-delete-user]');
  if(edit)openSystemUser(edit.dataset.editUser);
  else if(remove)confirmSystemUserDelete(remove.dataset.deleteUser);
  else if(toggle){const user=systemUsers.find(item=>item.id===toggle.dataset.toggleUser);if(user)api('/api/system-users',{method:'POST',body:JSON.stringify({action:'update',id:user.id,disabled:!user.disabled})}).then(result=>{systemUsers=result.users;renderSystemUsers();toast(user.disabled?'User enabled.':'User disabled.');}).catch(error=>toast(error.message));}
});

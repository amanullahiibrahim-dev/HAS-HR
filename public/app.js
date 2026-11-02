const today = new Date();
const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const expectedReturnDate = (start, days) => {
  if (!start || !Number.isFinite(Number(days)) || Number(days) <= 0) return start;
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.floor(Number(days)));
  return date.toISOString().slice(0,10);
};
const nice = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'}) : '—';
const initials = (n) => String(n||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const esc = (s) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db = {people:[],attendance:[],leaves:[],device:{online:false,lastSeen:null,serial:null,count:0}};
let authenticated = false;
let authGeneration = 0;
let loginBusy = false;
let editingLeaveId = null;
let editingLeaveRevision = null;
let leavePlanBusy = false;
let pendingMcUpload=null;
let leaveView='leaves';
const isSickLeave=type=>type==='Sick with MC'||type==='Sick without MC';
function closeStaffLeave(){document.getElementById('staff-leave-toggle')?.setAttribute('aria-expanded','false');const menu=document.getElementById('staff-leave-submenu');if(menu)menu.hidden=true;}
function toggleStaffLeave(){closeAppraisalMenu();closeAttendanceMenu();const toggle=document.getElementById('staff-leave-toggle');const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));document.getElementById('staff-leave-submenu').hidden=!expanded;}
let leavePreviewVersion = 0;

function leaveTripInput(){return {basis:val('lp-trip-basis'),office:val('lp-trip-office'),charter:val('lp-trip-charter')==='yes',flightReturn:val('lp-trip-return'),atollBefore:Number(val('lp-trip-before')),firstHajjConfirmed:document.getElementById('lp-trip-first').checked,permissionReference:val('lp-trip-permission')};}

function dutyTravelInput(){return {lastDate:val('lp-duty-last'),destination:val('lp-duty-destination'),purpose:val('lp-duty-purpose'),approvalReference:val('lp-duty-approval'),startTime:val('lp-duty-start-time'),endTime:val('lp-duty-end-time'),fullDayRelease:document.getElementById('lp-duty-full-days').checked};}
function leaveRequirementsUI(){
  const type=val('lp-type'),trip=type==='Hajj'||type==='Umra';
  const duty=type==='Duty travel';
  document.getElementById('duty-travel-fields').hidden=!duty;
  document.querySelectorAll('#duty-travel-fields input,#duty-travel-fields textarea').forEach(input=>{input.required=duty;input.disabled=!duty;});
  document.getElementById('lp-duty-last').min=val('lp-start');
  document.getElementById('lp-days').readOnly=duty||type==='Maternity';
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
  document.getElementById('mc-current-document').innerHTML=mc?`Attached: <a href="/api/mc-documents/${encodeURIComponent(mc.id)}">${esc(mc.name)}</a><br>Uploaded ${esc(new Date(mc.uploadedAt).toLocaleString())}`:'';
}

async function previewLeavePlan(){
  leaveRequirementsUI();
  document.getElementById('leave-policy-note').hidden=true;
  const version=++leavePreviewVersion;
  if(!val('lp-employee')||!val('lp-start'))return;
  const q=new URLSearchParams({employeeId:val('lp-employee'),type:val('lp-type'),start:val('lp-start'),days:val('lp-days'),excludeId:editingLeaveId||''});
  q.set('trip',JSON.stringify(leaveTripInput()));q.set('eventReference',val('lp-event-ref'));if(val('lp-type')==='Duty travel')q.set('duty',JSON.stringify(dutyTravelInput()));
  try{
    const plan=await api('/api/leave-preview?'+q);
    if(version!==leavePreviewVersion)return;
    document.getElementById('lp-end').value=plan.end;
    const days=document.getElementById('lp-days');days.readOnly=plan.readOnlyDays;
    if(days.readOnly)days.value=plan.days;
    const balance=document.querySelector('.leave-balance-strip');
    if(balance)balance.innerHTML=`<strong>${esc(val('lp-type'))} leave</strong><dl><div><dt>Entitlement</dt><dd>${val('lp-type')==='Maternity'?'6 calendar months':plan.entitlement+' days'}</dd></div><div><dt>Used / reserved</dt><dd>${plan.used} days</dd></div><div><dt>Remaining</dt><dd>${plan.available} days</dd></div></dl><button type="button" class="text-btn" onclick="openModal('profile')">Set leave profile</button>`;
    if(plan.isNoPay){if(balance)balance.innerHTML='<strong>No pay leave</strong><p>'+esc(plan.days)+' calendar day(s).</p>';document.getElementById('leave-policy-note').textContent=plan.note;return;}
    if(plan.isDutyTravel){if(balance)balance.innerHTML='<strong>Official duty</strong><p>'+esc(plan.days)+' calendar day(s).</p>';document.getElementById('leave-policy-note').textContent=plan.note;return;}
    document.getElementById('leave-policy-note').textContent=plan.note+(plan.preservedPeriod?` ${plan.deductibleDays} deductible day(s) in the saved approved period. `:'')+(plan.payBasis?' Leave basis: '+plan.payBasis+'. ':'')+(plan.trip?.baseStart?"Departure from Male': "+nice(plan.trip.baseStart)+'. ':'')+` Balances use the leave start year (${plan.year}). `+(plan.holidayCount?'':'No closed dates configured. Add official dates under Attendance / Closed Days.');
  }catch(error){if(version===leavePreviewVersion){document.getElementById('lp-end').value='';document.getElementById('leave-policy-note').hidden=false;document.getElementById('leave-policy-note').textContent=error.message;}}
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
  if(!val('lp-staff-search').trim()&&!editingLeaveId)document.getElementById('lp-staff-hint').textContent='Enter a name, ID or machine PIN to search.';
  if(results.hidden)return;
  const markup=matches.length?matches.slice(0,8).map(person=>`<button type="button" class="staff-picker-result" data-select-staff="${esc(person.id)}"><span class="mini-avatar" aria-hidden="true">${esc(initials(person.name))}</span><span><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${esc(person.dept||'No department')}<br>ID: ${esc(person.id)} · PIN: ${esc(person.devicePin)}</small></span><span aria-hidden="true">→</span></button>`).join(''):'<p class="staff-picker-empty">No staff match. Try another name or change the filters.</p>';
  if(results.innerHTML!==markup)results.innerHTML=markup;
  document.getElementById('lp-staff-hint').textContent=matches.length>8?`${matches.length} matches. Showing the first 8; refine your search to find a staff member.`:`${matches.length} staff ${matches.length===1?'match':'matches'}. Select a result to continue.`;
}
function syncLeaveStaffSelection() {
  const person=db.people.find(p=>p.id===val('lp-employee'));
  const search=document.getElementById('lp-staff-search');
  for(const id of ['lp-staff-search','lp-staff-search-button','lp-staff-filter-button','lp-staff-reset','lp-staff-role','lp-staff-department'])document.getElementById(id).disabled=!!editingLeaveId;
  if(person&&!staffSearchOpen)search.value=person.name;
  if(editingLeaveId){staffSearchOpen=false;document.getElementById('lp-staff-results').hidden=true;}
  document.getElementById('lp-staff-hint').textContent=editingLeaveId?'Staff member is fixed while editing. Clear the form to select another person.':person?'Staff selected. Search again to choose someone else.':'Search all staff, or narrow the results with filters.';
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
  document.getElementById('leave-workspace').hidden=managing&&!editingLeaveId;
  document.getElementById('leave-records').hidden=!managing;
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
    summary.innerHTML=`<div class="leave-staff-identity"><span class="mini-avatar">${esc(initials(person.name))}</span><dl><div><dt>Staff name</dt><dd>${esc(person.name)}</dd></div><div><dt>Role</dt><dd>${esc(person.role)}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'Not set')}</dd></div><div><dt>Employee ID</dt><dd>${esc(person.id)}</dd></div></dl></div><div class="leave-balance-strip"><strong>${esc(val('lp-type'))} leave</strong><dl><div><dt>Entitlement</dt><dd>${balance.entitlement} days</dd></div><div><dt>Used / reserved</dt><dd>${balance.used} days</dd></div><div><dt>Remaining</dt><dd>${balance.available} days</dd></div></dl></div>`;
    if(val('lp-type')==='No pay'){const strip=summary.querySelector('.leave-balance-strip');if(strip)strip.innerHTML='<strong>No pay leave</strong>';}
    if(val('lp-type')==='Duty travel'){const strip=summary.querySelector('.leave-balance-strip');if(strip)strip.innerHTML='<strong>Official duty</strong>';}
  }else summary.textContent='';
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
  document.getElementById('lp-status').innerHTML='<option>Approved</option><option>Pending</option>';
  document.getElementById('lp-status').disabled=false;
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
  document.getElementById('lp-applied').value=iso(new Date());
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
    if (!response.ok) { const error=new Error(result.error || `Request failed (${response.status})`); error.status=response.status;if(response.status===401&&authenticated)lockSession('Your session has expired. Please sign in again.');throw error; }
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
  const generation = authGeneration;
  const state = await api('/api/state');
  if (!authenticated || generation !== authGeneration) return;
  db = state;
  render();
}
function toast(message) { const t=document.getElementById('toast'); t.textContent=message; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
function setDate() {
  document.getElementById('today').textContent=today.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  document.getElementById('greet-date').textContent=today.toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
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
  return db.leaves.filter(l=>!l.medical?.unauthorizedAbsence&&l.employeeId===employeeId&&(l.type===type||(type==='Annual'&&l.chargeType==='Annual'))&&l.payBasis!=='No pay'&&(type==='Annual'||l.chargeType!=='Annual')&&l.start?.slice(0,4)===iso(new Date()).slice(0,4)&&['Pending','Approved','Completed'].includes(l.status)).reduce((sum,l)=>sum+Number(l.status==='Completed'?(l.usedDays??l.deductibleDays??l.days):(l.deductibleDays??l.days)||0),0);
}
function leaveBalance(person,type) {
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
  const markup=entries.length?entries.map(day=>`<tr><td>${esc(nice(day.date))}</td><td>${esc(day.category)}</td><td>${esc(day.reason)}</td><td><button type="button" class="text-btn" data-edit-closed="${esc(day.date)}">Edit</button><button type="button" class="text-btn" data-remove-closed="${esc(day.date)}">Remove</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">No additional closed dates. Add an official closure above.</td></tr>';
  const body=document.getElementById('closed-day-table');if(body.innerHTML!==markup)body.innerHTML=markup;
}
let closedDaysBusy=false;
async function persistClosedDays(days){
  if(closedDaysBusy)return false;closedDaysBusy=true;document.getElementById('closed-day-save').disabled=true;
  try{const saved=await saveAction('closed-days.save',{days});if(saved)document.getElementById('closed-day-message').textContent='Closed dates saved. Applicable leave deductions and balances updated.';return saved;}
  finally{closedDaysBusy=false;document.getElementById('closed-day-save').disabled=false;}
}
function appraisalToday(){return new Date(Date.now()+5*60*60*1000).toISOString().slice(0,10);}
const appraisalState={year:Number(appraisalToday().slice(0,4)),basis:'calendar',search:'',view:'appraisal-required',active:false,rows:[],cache:null};
const appraisalTitles={'appraisal-required':'Days Required','appraisal-attended':'Days Attended','appraisal-on-time':'Days On Time','appraisal-report':'Appraisal Report'};
function closeAppraisalMenu(){document.getElementById('appraisal-toggle')?.setAttribute('aria-expanded','false');const menu=document.getElementById('appraisal-submenu');if(menu)menu.hidden=true;}
function toggleAppraisalMenu(){const button=document.getElementById('appraisal-toggle'),open=button.getAttribute('aria-expanded')!=='true';closeStaffLeave();closeAttendanceMenu();button.setAttribute('aria-expanded',String(open));document.getElementById('appraisal-submenu').hidden=!open;}
function calculateAppraisal(data,year,options={}) {
  const asOf=options.asOf||appraisalToday(),start=`${year}-01-01`,yearEnd=`${year+1}-01-01`,end=asOf<`${year}-12-31`?asOf:`${year}-12-31`;
  if(!Number.isInteger(year)||year<2000||year>Number(asOf.slice(0,4)))return [];
  const add=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const off=date=>[5,6].includes(new Date(date+'T00:00:00Z').getUTCDay())||(data.holidays||[]).includes(date);
  const calendarDays=(Date.parse(yearEnd+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  const sourceRows=options.rows||data.attendance||[],recordMap=new Map(sourceRows.map(row=>[row.employeeId+'|'+row.date,row]));
  const firstLog=data.punchHistory?.[0]?.slice(0,10)||[...(data.attendance||[])].map(row=>row.date).sort()[0];
  return data.people.filter(person=>!person.removedAt).map(person=>{
    const leaveWeights=new Map();let leaveReview=false;
    for(const leave of (data.leaves||[]).filter(leave=>leave.employeeId===person.id&&leave.type!=='Duty travel'&&!leave.medical?.unauthorizedAbsence&&['Approved','Completed'].includes(leave.status))){
      const actual=leave.returnedAt?.slice(0,10),through=actual&&actual>leave.start&&actual<leave.end?actual:leave.end;
      if(!leave.start||!through||through<=start||leave.start>end)continue;
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
    let periodDays=0,leaveTaken=0,absent=0,late=0,unverified=0,offDaysCredited=0;
    for(let day=start;day<=end;day=add(day)){
      if(person.attendanceFrom&&day<person.attendanceFrom.slice(0,10))continue;
      const nonworking=off(day);if(options.basis==='working'&&nonworking)continue;
      periodDays++;const leaveWeight=leaveWeights.get(day)||0;leaveTaken+=leaveWeight;const required=1-leaveWeight;if(required<=0)continue;
      const row=recordMap.get(person.id+'|'+day),status=row?.status;
      if(nonworking){offDaysCredited+=required;continue;}
      if(['Present','On duty'].includes(status))continue;
      if(status==='Late'){late+=required;continue;}
      if(['Incomplete','No logs','Awaiting punch'].includes(status)||((!status||status==='Absent')&&(!firstLog||day<=firstLog))){unverified+=required;continue;}
      if(status==='Absent'||!status)absent+=required;
      else if(status==='On leave'&&leaveWeight<1)unverified+=required;
    }
    const required=periodDays-leaveTaken,complete=unverified===0&&!leaveReview;
    const attended=complete?Math.max(0,required-absent):null,onTime=attended===null?null:Math.max(0,attended-late);
    return {employeeId:person.id,name:person.name,dept:person.dept||'',role:person.role,pin:person.devicePin,idCardNumber:person.idCardNumber||'',basis:options.basis||'calendar',year,calendarDays,periodDays,leaveTaken,required,absent,late,unverified,offDaysCredited,attended,onTime,coverage:leaveReview?'Leave review':unverified?'Incomplete data':'Complete',asOf:end};
  });
}
function appraisalColumns(){
  const base=[['name','Employee'],['dept','Department']];
  const metrics=appraisalState.view==='appraisal-required'?[['calendarDays','Days in year'],['periodDays','Period days'],['leaveTaken','Leave taken'],['required','Days required']]:appraisalState.view==='appraisal-attended'?[['required','Days required'],['absent','Absent days'],['attended','Days attended'],['unverified','Unverified days']]:appraisalState.view==='appraisal-on-time'?[['attended','Days attended'],['late','Late days'],['onTime','Days on time'],['unverified','Unverified days']]:[['required','Days required'],['attended','Days attended'],['onTime','Days on time'],['leaveTaken','Leave taken'],['absent','Absent days'],['late','Late days'],['unverified','Unverified days']];
  return [...base,...metrics,['coverage','Data status']];
}
function renderAppraisal(){
  if(!appraisalState.active)return;
  const state=appraisalState,asOf=appraisalToday(),key=`${state.year}|${state.basis}|${asOf}`;
  if(!state.cache||state.cache.data!==db||state.cache.key!==key){const to=state.year===Number(asOf.slice(0,4))?asOf:`${state.year}-12-31`;state.cache={data:db,key,rows:calculateAppraisal(db,state.year,{basis:state.basis,asOf,rows:buildAttendanceRows({staff:'all',from:`${state.year}-01-01`,to})})};}
  const terms=state.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  state.rows=state.cache.rows.filter(row=>terms.every(term=>[row.name,row.employeeId,row.pin,row.idCardNumber,row.dept,row.role].join(' ').toLocaleLowerCase().includes(term)));
  const columns=appraisalColumns(),number=value=>value===null?'—':Number.isInteger(value)?String(value):Number(value.toFixed(2)).toString();
  document.getElementById('appraisal-head').innerHTML='<tr>'+columns.map(([,label])=>`<th>${label}</th>`).join('')+'</tr>';
  document.getElementById('appraisal-table').innerHTML=state.rows.length?state.rows.map(row=>'<tr>'+columns.map(([key])=>`<td>${key==='name'?`<strong>${esc(row.name)}</strong><small class="staff-role">${esc(row.employeeId)}</small>`:typeof row[key]==='number'||row[key]===null?number(row[key]):esc(row[key])}</td>`).join('')+'</tr>').join(''):`<tr><td class="empty" colspan="${columns.length}">No staff match.</td></tr>`;
  const fields=state.view==='appraisal-required'?[['required','Days required'],['leaveTaken','Leave taken'],['periodDays','Period days']]:state.view==='appraisal-attended'?[['attended','Days attended'],['absent','Absent days'],['unverified','Unverified days']]:state.view==='appraisal-on-time'?[['onTime','Days on time'],['late','Late days'],['unverified','Unverified days']]:[['required','Days required'],['attended','Days attended'],['onTime','Days on time']];
  document.getElementById('appraisal-kpis').innerHTML=fields.map(([key,label])=>`<div class="card"><div class="card-head">${label}</div><div class="metric">${state.rows.some(row=>row[key]===null)?'—':number(state.rows.reduce((sum,row)=>sum+row[key],0))}</div></div>`).join('');
  document.getElementById('appraisal-year').value=state.year;document.getElementById('appraisal-year').max=asOf.slice(0,4);document.getElementById('appraisal-basis').value=state.basis;
  document.getElementById('appraisal-period').textContent=`${state.year} · ${state.basis==='calendar'?'Calendar days':'Working days'} · ${state.year===Number(asOf.slice(0,4))?'Year to date':'Full year'} · Through ${nice(state.cache.rows[0]?.asOf||(state.year+'-12-31'))}`;
  document.getElementById('appraisal-count').textContent=`${state.rows.length} staff · ${state.rows.filter(row=>row.coverage!=='Complete').length} require review`;
  document.getElementById('appraisal-export').disabled=!state.rows.length;
}
function exportAppraisal(){
  const columns=[['employeeId','Employee ID'],['name','Employee'],['year','Year'],['basis','Calculation basis'],['asOf','Through'],['calendarDays','Days in year'],['periodDays','Period days'],['leaveTaken','Leave taken'],['required','Days required'],['absent','Absent days'],['attended','Days attended'],['late','Late days'],['onTime','Days on time'],['unverified','Unverified days'],['coverage','Data status']];
  const rows=[columns.map(([,title])=>title),...appraisalState.rows.map(row=>columns.map(([key])=>row[key]??''))];
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(reportCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`haaziry-appraisal-${appraisalState.year}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function render() {
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
  document.getElementById('stat-pending').textContent=db.leaves.filter(l=>l.status==='Pending').length;
  document.getElementById('attendance-preview').innerHTML=rows.length?rows.slice(0,5).map(a=>`<tr><td>${personCell(a.name)}</td><td>${esc(a.checkIn)}</td><td>${esc(a.checkOut)}</td><td>${hours(a)}</td><td>${statusTag(a.status)}</td></tr>`).join(''):`<tr><td colspan="5" class="empty">No punches received for this date.</td></tr>`;
  const arrivals=records.filter(r=>r.checkIn&&r.checkIn!=='—').slice().sort((a,b)=>a.checkIn.localeCompare(b.checkIn)).slice(0,4);
  document.getElementById('activity').innerHTML=arrivals.length?arrivals.map(a=>`<div class="event"><div class="event-time">${esc(a.checkIn)}</div><div class="event-track"><i class="event-dot ${a.status==='Late'?'amber':''}"></i></div><div class="event-content"><b>${esc(a.name)}</b><p>${a.status==='Late'?'Late check-in':'Check-in'} · ${esc(a.source||'iClock990')}</p></div></div>`).join(''):`<div class="empty">Waiting for staff punches.</div>`;
  renderOverviewLeaveSummary(date);
  const leaveFilter=document.getElementById('leave-filter').value;
  const groupLeaves=db.leaves.filter(l=>leaveView==='manage'||isSickLeave(l.type)===(leaveView==='sick'));
  const typeFilter=document.getElementById('manage-leave-type');
  const types=[...new Set([...(db.leavePolicy?.types||[]),...(db.leavePolicy?.sickTypes||[]),...db.leaves.map(leave=>leave.type)])];
  const typeOptions='<option value="all">All leave types</option>'+types.map(type=>`<option value="${esc(type)}">${esc(type)}</option>`).join('');
  if(typeFilter.innerHTML!==typeOptions){const previous=typeFilter.value;typeFilter.innerHTML=typeOptions;typeFilter.value=types.includes(previous)?previous:'all';}
  const leaves=filteredManagedLeaves(groupLeaves).filter(l=>leaveFilter==='all'||l.status===leaveFilter);
  document.getElementById('leave-table').innerHTML=leaves.length?leaves.map(l=>`<tr><td>${personCell(l.name)}</td><td>${esc(l.type)}${l.returnReview?`<br><small class="staff-role">${esc(l.returnReview)}</small>`:''}${l.policyReview?`<br><small class="staff-role">${esc(l.policyReview)}</small>`:""}${l.payBasis?'<br><small class=\"staff-role\">'+esc(l.payBasis)+'</small>':''}${l.medicalReview?'<br><small class=\"staff-role\">'+esc(l.medicalReview.status)+'</small>':''}</td><td>${l.appliedOn?`<small class="staff-role">Applied ${nice(l.appliedOn)}</small><br>`:""}${nice(l.start)}${l.end!==l.start?' – '+nice(l.end):''}${l.returnedAt?`<small class="staff-role"><br>Returned ${nice(l.returnedAt.slice(0,10))}</small>`:''}</td><td>${l.status==='Completed'?`${esc(l.usedDays??l.deductibleDays??l.days)} / ${esc(l.days)}`:l.deductibleDays!==undefined?`${esc(l.deductibleDays)} / ${esc(l.days)}`:esc(l.days)}</td><td>${esc(l.reason||'—')}${l.duty?`<br><small class="staff-role">${esc(l.duty.destination)} · ${esc(l.duty.purpose)}<br>Order: ${esc(l.duty.approvalReference)}<br>${nice(l.start)} ${esc(l.duty.startTime)} – ${nice(l.duty.lastDate)} ${esc(l.duty.endTime)}${l.duty.reportedAt?`<br>Reported: ${esc(l.duty.reportedAt.replace('T',' '))} · ${esc(l.duty.reportReference)}`:''}</small>`:''}</td><td>${statusTag(l.status)}</td><td>${(leaveView==='manage'||['Approved','Pending'].includes(l.status))?`<button class="text-btn" onclick="editLeaveRecord('${l.id}')">Edit</button>`:''}${leaveView==='manage'?`<button type="button" class="text-btn leave-delete-action" data-delete-leave="${esc(l.id)}">Delete</button>`:''}${l.type==='Duty travel'&&l.status==='Approved'?`<button class="text-btn" data-duty-report="${esc(l.id)}">Record return</button>`:''}${l.status==='Pending'?`<button class="text-btn" onclick="decision('${l.id}','Approved')">Approve</button><button class="text-btn" style="color:#b9665a" onclick="decision('${l.id}','Declined')">Decline</button>`:l.status==='Completed'&&l.type!=='Duty travel'?`<button class="text-btn" onclick="editLeaveDays('${l.id}')">Adjust days</button>`:'—'}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">${db.leaves.length?'No leave records match your search and filters.':'No leave records yet.'}</td></tr>`;
  document.getElementById('leave-pending').textContent=groupLeaves.filter(l=>l.status==='Pending').length;
  document.getElementById('leave-approved').textContent=groupLeaves.filter(l=>l.status==='Approved').length;
  document.getElementById('leave-used').closest('.card').querySelector('.card-head').textContent=leaveView==='manage'?'Applied leave records':leaveView==='sick'?'Sick leave used / reserved':'Annual leave used / reserved';
  document.getElementById('leave-used').innerHTML=(leaveView==='manage'?groupLeaves.length:leaveView==='sick'?usedDaysForType('Sick with MC')+usedDaysForType('Sick without MC'):usedDaysForType('Annual'))+` <span style="font-size:12px;color:#88928a;font-weight:500">${leaveView==='manage'?'records':'days'}</span>`;
  renderLeaveBalances();
  renderAttendance(); renderPeople(); renderDevice(); refreshLeaveStaff(); renderAttendanceReport();
}
function usedDaysForType(type){return db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);}
function renderLeaveBalances(){
  const types=leaveView==='manage'?[...(db.leavePolicy?.types||['Annual']),'Sick with MC','Sick without MC']:leaveView==='sick'?['Sick with MC','Sick without MC']:(db.leavePolicy?.types||['Annual']);
  const body=document.getElementById('balance-table');
  body.closest('table').querySelector('thead').innerHTML=`<tr><th>Employee</th>${types.map(type=>`<th>${esc(type)}</th>`).join('')}</tr>`;
  body.innerHTML=db.people.length?db.people.map(p=>`<tr><td>${personCell(p.name)}</td>${types.map(type=>{if(type==='No pay')return '<td>By approval · unpaid</td>';if(type==='Duty travel')return '<td>By duty order · no deduction</td>';if(type==='Hajj'||type==='Umra')return '<td>By approved trip</td>';if(type==='Circumcision')return '<td>5 days per occasion</td>';const b=leaveBalance(p,type);return `<td><span class="balance-num">${b.available}</span> / ${b.entitlement} days</td>`;}).join('')}</tr>`).join(''):`<tr><td colspan="${types.length+1}" class="empty">Add staff to begin tracking balances.</td></tr>`;
}

/* ---------- Attendance page ---------- */
const attState={preset:'month',from:'',to:'',staff:'all',search:'',sort:'date-desc',status:'all'};
let attRows=null;
const isoAdd=(dateStr,days)=>{const d=new Date(`${dateStr}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const weekdayShort=(date)=>new Date(`${date}T12:00:00`).toLocaleDateString('en',{weekday:'short'});
const staffStart=person=>db.attendanceSchedule?.byRole?.[person.role]?.start||(['Teacher','Technical Staff','Support Staff','Deputy Principal'].includes(person.role)?'07:00':'08:00');
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
function eachDate(from,to){const out=[];for(let d=new Date(`${from}T12:00:00`);iso(d)<=to;d.setDate(d.getDate()+1))out.push(iso(d));return out;}
function fillAttStaff(){
  const select=document.getElementById('att-staff'),current=select.value||attState.staff;
  const people=db.people;
  select.innerHTML=`<option value="all">All staff</option>`+people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  select.value=current==='all'||people.some(p=>p.id===current)?current:'all';
  attState.staff=select.value;
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
      const duty=db.leaves.find(l=>l.type==='Duty travel'&&l.duty?.fullDayRelease&&l.duty.approvalReference&&l.employeeId===person.id&&['Approved','Completed'].includes(l.status)&&l.start<=date&&date<l.end);
      if(duty){row.status='On duty';row.lateMins=0;row.leave='';row.dutyTravelId=duty.id;row.source=row.source.includes('Duty travel')?row.source:(row.source?row.source+' · ':'')+'Duty travel';}
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
  document.getElementById('att-chart-dates').innerHTML=labels.map(d=>`<span>${new Date(`${d}T12:00:00`).toLocaleDateString('en',{day:'2-digit',month:'short'})}</span>`).join('');
}
function renderAttendance(){
  if(!attState.from||!attState.to){const[f,t]=attPresetRange(attState.preset);attState.from=f;attState.to=t;}
  fillAttStaff();
  const fromEl=document.getElementById('att-from'),toEl=document.getElementById('att-to');
  fromEl.value=attState.from;toEl.value=attState.to;fromEl.max=iso(today);toEl.max=iso(today);
  document.getElementById('att-period').value=attState.preset;
  document.getElementById('att-custom').classList.toggle('open',attState.preset==='custom');
  const all=buildAttendanceRows();
  const present=all.filter(r=>['Present','Late','On duty'].includes(r.status)).length;
  const leaveDays=all.filter(r=>r.status==='On leave').length;
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
  document.getElementById('attendance-table').innerHTML=rows.length?rows.slice(attState.page*400,(attState.page+1)*400).map(r=>`<tr><td>${personCell(r.name)}</td><td><b>${esc(weekdayShort(r.date))}</b><br><small class="staff-role">${nice(r.date)}</small></td><td>${esc(r.checkIn)}${r.correctionId?'<br><small class="staff-role">Corrected</small>':''}${r.note?'<br><small class="staff-role">'+esc(r.note)+'</small>':''}</td><td>${esc(r.checkOut)}</td><td>${r.workedMins?fmtMins(r.workedMins):'—'}</td><td>${r.lateMins?`<span class="att-late">${r.lateMins} min</span>`:'—'}</td><td>${attStatusTag(r)}</td><td><button class="text-btn" onclick="viewAttendance('${esc(r.employeeId)}','${r.date}')">View</button></td></tr>`).join(''):`<tr><td colspan="8" class="empty">No attendance rows for this period.</td></tr>`;
}
function attendancePage(direction){attState.page=Math.max(0,(attState.page||0)+direction);renderAttendance();}
function correctionHistory(employeeId,date){
  const history=(db.attendanceCorrections||[]).filter(c=>c.employeeId===employeeId&&c.date===date).slice().reverse();
  return `<div class="correction-history"><h3>Correction history</h3>${history.length?history.map(c=>`<article><strong>${esc(c.actor)} · ${esc(new Date(c.createdAt).toLocaleString())}</strong><p>${esc(c.reason)}</p><p>Evidence: ${esc(c.evidence||"Not recorded on older corrections")}</p><p>Check-in: ${esc(c.before.checkIn)} → ${esc(c.after.checkIn)} · Checkout: ${esc(c.before.checkOut)} → ${esc(c.after.checkOut)}</p><details><summary>Original punch evidence (${c.originalPunches.length})</summary>${c.originalPunches.length?c.originalPunches.map(p=>`<p>${esc(p.timestamp)} · ${esc(p.serial)} · punch code ${esc(p.state)}</p>`).join(''):'<p>No original punch existed when this correction was saved.</p>'}</details></article>`).join(''):'<p class="helper">No administrator corrections recorded.</p>'}</div>`;
}
function openAttendanceCorrection(employeeId,date){
  const save=document.getElementById('modal-save');let expected=null;
  document.getElementById('modal-title').textContent='Correct attendance';
  document.getElementById('modal-body').innerHTML=`<div class="field"><label for="f-employee">Staff member</label><select id="f-employee">${db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.id)}</option>`).join('')}</select></div><div class="field"><label for="f-date">Attendance date</label><input id="f-date" type="date" value="${esc(date||iso(new Date()))}"></div><div class="field correction-reason"><label for="f-correction-reason">Reason for correction (required)</label><textarea id="f-correction-reason" required aria-required="true" maxlength="1000" rows="3" placeholder="For example: arrived on time but forgot to punch in"></textarea></div><div class="field correction-reason"><label for="f-correction-evidence">Evidence / verification reference (required)</label><textarea id="f-correction-evidence" required maxlength="1000" rows="2" placeholder="For example: duty supervisor confirmation or attendance register reference"></textarea></div><div id="correction-original" class="helper"></div><div class="form-row"><div class="field"><label for="f-in">Correct check-in time</label><input id="f-in" type="time"></div><div class="field"><label for="f-out">Correct checkout (optional)</label><input id="f-out" type="time"></div></div><div id="correction-audit"></div>`;
  document.getElementById('f-correction-reason').addEventListener('input',e=>e.target.setCustomValidity(''));
  if(employeeId)document.getElementById('f-employee').value=employeeId;
  const load=()=>{const row=db.attendance.find(a=>a.employeeId===val('f-employee')&&a.date===val('f-date'));expected={checkIn:row?.checkIn||'—',checkOut:row?.checkOut||'—',correctionId:row?.correctionId||null};document.getElementById('f-in').value=row?.checkIn==='—'?'':row?.checkIn||'';document.getElementById('f-out').value='';document.getElementById('correction-original').textContent=`Current check-in: ${expected.checkIn} · Current checkout: ${expected.checkOut}`;document.getElementById('correction-audit').innerHTML=correctionHistory(val('f-employee'),val('f-date'));};
  document.getElementById('f-employee').addEventListener('change',load);document.getElementById('f-date').addEventListener('change',load);load();
  save.style.display='';save.textContent='Save correction';save.disabled=!db.people.length;
  save.onclick=async()=>{if(!val('f-correction-reason').trim()){const reason=document.getElementById('f-correction-reason');reason.scrollIntoView({block:'center'});reason.focus();reason.setCustomValidity('Enter a reason for this correction.');reason.reportValidity();return;}if(!val('f-correction-evidence').trim()){const evidence=document.getElementById('f-correction-evidence');evidence.scrollIntoView({block:'center'});evidence.focus();evidence.reportValidity();return;}save.disabled=true;
    const entry={employeeId:val('f-employee'),date:val('f-date'),checkIn:val('f-in'),...(val('f-out')?{checkOut:val('f-out')} : {}),reason:val('f-correction-reason'),evidence:val('f-correction-evidence'),expected};
    try{if(await saveAction('attendance.manual',{entry})){closeModal();toast('Attendance corrected. Original logs and audit history saved.');}}finally{save.disabled=false;}};
  document.getElementById('modal-back').classList.add('open');
}
function viewAttendance(employeeId,date){
  const person=db.people.find(p=>p.id===employeeId);
  const row=(attRows||[]).find(r=>r.employeeId===employeeId&&r.date===date);
  if(!person||!row)return;
  document.getElementById('modal-title').textContent=`${person.name} · ${nice(date)}`;
  document.getElementById('modal-body').innerHTML=`<dl class="att-detail"><div><dt>Status</dt><dd>${attStatusTag(row)}</dd></div><div><dt>Check in</dt><dd>${esc(row.checkIn)}</dd></div><div><dt>Check out</dt><dd>${esc(row.checkOut)}</dd></div><div><dt>Worked</dt><dd>${row.workedMins?fmtMins(row.workedMins):'—'}</dd></div><div><dt>Late</dt><dd>${row.lateMins?`${row.lateMins} mins`:'—'}</dd></div><div><dt>Expected start</dt><dd>${esc(staffStart(person))}</dd></div><div><dt>Source</dt><dd>${esc(row.source||row.leave||'—')}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'—')}</dd></div></dl>`;
  document.getElementById('modal-body').innerHTML+=`<p class="helper">${esc(row.note||'')}</p><h3>Received punch evidence</h3>${(row.punches||[]).length?(row.punches||[]).map(p=>`<p class="helper">${esc(p.timestamp)} / ${esc(p.eventType||p.kind||'Unlabelled punch')} / raw code ${esc(p.state)}</p>`).join(''):'<p class="helper">No machine punches received for this date.</p>'}`;
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
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(leave.name)}</strong><br>${esc(leave.type)} · ${esc(nice(leave.start))} – ${esc(nice(leave.end))}<br>Status: ${esc(leave.status)}</p><p class="helper">This permanently removes this leave, its edit history and unshared MC attachments. It cannot be undone. Leave balances and attendance will be recalculated. Original machine punches are retained.</p><div class="field"><label for="leave-delete-reason">Reason for deletion (required)</label><textarea id="leave-delete-reason" rows="3" maxlength="1000" placeholder="For example: wrong leave applied, or staff decided to work" required></textarea></div>`;
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
  document.getElementById('modal-body').innerHTML=`<p><strong>${esc(person.name)}</strong> · ${esc(person.id)}</p><p class="helper">This permanently deletes the employee and their attendance, leave, corrections and uploaded documents from the app. This cannot be undone.</p>`;
  const save=document.getElementById('modal-save');save.textContent='Delete permanently';save.style.display='';save.disabled=false;
  save.onclick=async()=>{save.disabled=true;try{if(await saveAction('employee.remove',{id:person.id})){closeModal();toast(db.deletionFilesPending?'Employee deleted. Attachment cleanup is pending.':'Employee permanently deleted.');}}finally{save.disabled=false;}};
  document.getElementById('modal-back').classList.add('open');
}
function renderDevice() {
  const chip=document.getElementById('device-chip'), state=document.getElementById('device-state'), last=document.getElementById('device-last-seen');
  if(db.sync?.lastSeen&&(!db.device.lastSeen||db.sync.lastSeen>db.device.lastSeen)){
    if(chip){chip.classList.remove('online');chip.textContent='Software sync received';}
    if(state)state.textContent='Attendance software sync';
    if(last)last.textContent=`Last software sync ${new Date(db.sync.lastSeen).toLocaleString()} · ${db.sync.lastInserted} new logs in last batch`;
    return;
  }
  const online=!!db.device.online;
  if(chip){chip.classList.toggle('online',online);chip.innerHTML=`<i class="pulse" style="background:${online?'#57a577':'#adb5ae'}"></i>${online?'iClock990 connected':'Waiting for device'}`;}
  if(state)state.textContent=online?'Connected to office server':'Waiting for iClock990';
  if(last)last.textContent=db.device.lastSeen?`${online?'Last device signal':'Last seen'} ${new Date(db.device.lastSeen).toLocaleString()} · ${db.device.count} punches received`:'Waiting for the first device check-in';
}
function go(page) {
  if(page!=='reports')setReportExpanded(false);
  const appraisalPage=Object.hasOwn(appraisalTitles,page);appraisalState.active=appraisalPage;
  document.getElementById('appraisal-toggle').classList.toggle('section-active',appraisalPage);
  if(appraisalPage){closeStaffLeave();document.getElementById('appraisal-toggle').setAttribute('aria-expanded','true');document.getElementById('appraisal-submenu').hidden=false;appraisalState.view=page;document.getElementById(page+'-host').appendChild(document.getElementById('appraisal-shared'));renderAppraisal();}else closeAppraisalMenu();
  const attendancePage=['attendance','reports','closed-days'].includes(page);
  document.getElementById('attendance-toggle').classList.toggle('section-active',attendancePage);
  if(!attendancePage)closeAttendanceMenu();
  if(page==='reports')renderAttendanceReport();
  if(page==='leaves'||page==='sick'||page==='manage'){
    const changed=leaveView!==page;leaveView=page;
    document.getElementById(page==='manage'?'manage-host':page==='sick'?'sick-host':'leave-host').appendChild(document.getElementById('leave-shared'));
    document.getElementById('staff-leave-toggle').setAttribute('aria-expanded','true');document.getElementById('staff-leave-submenu').hidden=false;
    render();if(changed)clearLeavePlan();
  }
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));
  document.querySelectorAll('#nav button[data-page]').forEach(x=>{const active=x.dataset.page===page;x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
  document.getElementById('staff-leave-toggle').classList.toggle('section-active',['leaves','sick','manage'].includes(page));
  document.getElementById('crumb').textContent=appraisalPage?'Appraisal / '+appraisalTitles[page]:page==='closed-days'?'Attendance / Closed Days':page==='people'?'Employees':page==='reports'?'Attendance / Attendance Report':page==='manage'?'Staff Leave / Manage Leave':page==='leaves'?'Staff Leave / Leave':page==='sick'?'Staff Leave / Sick Leave':page[0].toUpperCase()+page.slice(1);if(window.matchMedia('(max-width:700px)').matches){closeStaffLeave();closeAttendanceMenu();closeAppraisalMenu();}window.scrollTo(0,0);
}
window.addEventListener('click',event=>{if(window.matchMedia('(max-width:700px)').matches&&!event.target.closest?.('.nav-group'))closeStaffLeave();});
window.addEventListener('keydown',event=>{if(event.key==='Escape'){closeStaffLeave();closeAttendanceMenu();closeAppraisalMenu();}});
window.addEventListener('click',e=>{const b=e.target.closest?.('#nav button[data-page]');if(b)go(b.dataset.page);},true);
window.addEventListener('click',event=>{if(!event.target.closest?.('.appraisal-nav-group'))closeAppraisalMenu();});
document.getElementById('appraisal-filters').addEventListener('submit',event=>{event.preventDefault();const year=Number(val('appraisal-year'));if(!Number.isInteger(year)||year<2000||year>Number(appraisalToday().slice(0,4)))return toast('Choose a valid year.');appraisalState.year=year;appraisalState.basis=val('appraisal-basis');renderAppraisal();});
document.getElementById('appraisal-search').addEventListener('input',event=>{appraisalState.search=event.target.value;renderAppraisal();});
document.getElementById('appraisal-basis').addEventListener('change',event=>{appraisalState.basis=event.target.value;renderAppraisal();});
document.getElementById('appraisal-export').addEventListener('click',exportAppraisal);
initAttendanceReport();
document.getElementById('att-staff').addEventListener('change',e=>{attState.staff=e.target.value;renderAttendance();});
document.getElementById('att-period').addEventListener('change',e=>{attState.preset=e.target.value;if(attState.preset!=='custom'){const[f,t]=attPresetRange(attState.preset);attState.from=f;attState.to=t;}renderAttendance();});
document.getElementById('att-view').addEventListener('click',()=>{const from=document.getElementById('att-from').value,to=document.getElementById('att-to').value;if(!from||!to||from>to)return toast('Choose a valid attendance period.');attState.preset='custom';attState.from=from;attState.to=to;renderAttendance();});
document.getElementById('att-search').addEventListener('input',e=>{attState.search=e.target.value;renderAttendance();});
document.getElementById('att-sort').addEventListener('change',e=>{attState.sort=e.target.value;renderAttendance();});
document.getElementById('att-chips').addEventListener('click',e=>{const chip=e.target.closest('button.chip');if(!chip)return;attState.status=chip.dataset.status;document.querySelectorAll('#att-chips .chip').forEach(c=>c.classList.toggle('active',c===chip));renderAttendance();});
document.getElementById('att-print').addEventListener('click',()=>window.print());
document.getElementById('att-export').addEventListener('click',()=>exportAttendance());
document.getElementById('staff-leave-submenu').addEventListener('click',event=>{if(event.target.closest('button[data-page]')&&window.matchMedia('(max-width:700px)').matches){document.getElementById('staff-leave-toggle').setAttribute('aria-expanded','false');document.getElementById('staff-leave-submenu').hidden=true;}});
window.addEventListener('click',event=>{if(!event.target.closest?.('.attendance-nav-group'))closeAttendanceMenu();});
document.getElementById('closed-day-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||closedDaysBusy)return;const entry={date:val('closed-day-date'),category:val('closed-day-category'),reason:val('closed-day-reason').trim()};if(await persistClosedDays([...closedDayEntries().filter(day=>day.date!==entry.date),entry]))form.reset();});
document.getElementById('closed-day-table').addEventListener('click',async event=>{const edit=event.target.closest('button[data-edit-closed]'),remove=event.target.closest('button[data-remove-closed]');if(edit){const day=closedDayEntries().find(day=>day.date===edit.dataset.editClosed);if(!day)return;document.getElementById('closed-day-date').value=day.date;document.getElementById('closed-day-category').value=day.category;document.getElementById('closed-day-reason').value=day.reason;document.getElementById('closed-day-form').scrollIntoView({block:'start'});}else if(remove)await persistClosedDays(closedDayEntries().filter(day=>day.date!==remove.dataset.removeClosed));});
document.getElementById('leave-filter').addEventListener('change',render);
document.getElementById('manage-leave-search').addEventListener('input',render);
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
document.getElementById('lp-start').addEventListener('change',updatePlanReturn);
document.getElementById('lp-days').addEventListener('input',updatePlanReturn);
for(const id of ['lp-duty-last','lp-duty-destination','lp-duty-purpose','lp-duty-approval','lp-duty-start-time','lp-duty-end-time','lp-duty-full-days','lp-trip-basis','lp-trip-office','lp-trip-charter','lp-trip-return','lp-trip-before','lp-trip-first','lp-trip-permission','lp-event-ref'])document.getElementById(id).addEventListener('change',updatePlanReturn);
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
  db={people:[],attendance:[],leaves:[],device:{online:false,lastSeen:null,serial:null,count:0}};
  resetAttendanceReport();
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
  const password=document.getElementById('login-password').value;
  button.disabled=true;button.textContent='Signing in�';
  try{
    await sessionReady;const startupError=await sessionReset;if(startupError)throw startupError;
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({password})});
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

async function saveAction(action,payload) { try { db=await api('/api/state',{method:'POST',body:JSON.stringify({action,...payload})});render();return true; } catch(error) { toast(error.message);return false; } }
function closeModal(){document.getElementById('modal-back').classList.remove('open');}
function val(id){return document.getElementById(id)?.value||'';}
async function saveLeavePlan(update) {
  if(leavePlanBusy||update!==!!editingLeaveId||update!==(leaveView==='manage'))return;
  const form=document.getElementById('leave-plan-form');if(!form.reportValidity())return;
  const existing=db.leaves.find(l=>l.id===editingLeaveId);
  const leave={employeeId:val('lp-employee'),type:val('lp-type'),days:Number(val('lp-days')),start:val('lp-start'),end:val('lp-end'),reason:val('lp-reason'),status:val('lp-status'),appliedOn:val('lp-applied'),trip:leaveTripInput(),duty:val('lp-type')==='Duty travel'?dutyTravelInput():undefined,eventReference:val('lp-event-ref'),mcDocumentId:val('lp-type')==='Sick with MC'?existing?.mcDocumentId:undefined};
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
  const statusSelect=document.getElementById('lp-status');
  const closed=['Completed','Declined'].includes(leave.status);
  statusSelect.innerHTML=closed?'<option>'+esc(leave.status)+'</option>':'<option>Approved</option><option>Pending</option>';
  statusSelect.disabled=closed;
  const typeSelect=document.getElementById('lp-type');
  if(![...typeSelect.options].some(o=>o.value===leave.type)){const option=document.createElement('option');option.value=leave.type;option.textContent=leave.type+' (legacy)';option.dataset.legacy='true';typeSelect.append(option);}
  staffSearchOpen=false;
  document.getElementById('lp-employee').value=person.id;refreshLeaveStaff();
  for(const [field,value] of Object.entries({type:leave.type,days:leave.days,start:leave.start,end:leave.end,reason:leave.reason,status:leave.status,applied:leave.appliedOn||''}))document.getElementById('lp-'+field).value=value;
  const duty=leave.duty||{};
  for(const [id,value] of Object.entries({'lp-duty-last':duty.lastDate||'','lp-duty-destination':duty.destination||'','lp-duty-purpose':duty.purpose||'','lp-duty-approval':duty.approvalReference||'','lp-duty-start-time':duty.startTime||'','lp-duty-end-time':duty.endTime||''}))document.getElementById(id).value=value;
  document.getElementById('lp-duty-full-days').checked=duty.fullDayRelease===true;
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
  const summary=leave=>`Applied: ${leave.appliedOn?nice(leave.appliedOn):'Not recorded'} · ${leave.type} · ${nice(leave.start)} to ${nice(leave.end)} · ${leave.days} planned days · ${leave.deductibleDays??leave.days} deductible days · ${leave.usedDays??'—'} used · ${leave.status} · ${leave.payBasis||'Paid'} · MC file: ${leave.mcDocumentId?'attached':'not attached'}${leave.duty?' · Duty destination: '+leave.duty.destination+' · Purpose: '+leave.duty.purpose+' · Order: '+leave.duty.approvalReference+' · Duty times: '+leave.duty.startTime+' to '+leave.duty.lastDate+' '+leave.duty.endTime+' · Reported: '+(leave.duty.reportedAt||'not recorded')+' · Report ref: '+(leave.duty.reportReference||'not recorded'):''}`;
  document.getElementById('leave-edit-history').innerHTML=`<div class="correction-history"><h3>Leave change history</h3>${history.length?history.map(change=>`<article><strong>${esc(change.actor)} · ${esc(new Date(change.at).toLocaleString())}</strong><p>${esc(change.reason)}</p><p>Before: ${esc(summary(change.before))}</p><p>After: ${esc(summary(change.after))}</p>${change.before.mcDocumentId?`<a href="/api/mc-documents/${encodeURIComponent(change.before.mcDocumentId)}">Previous MC</a>`:""} ${change.after.mcDocumentId?`<a href="/api/mc-documents/${encodeURIComponent(change.after.mcDocumentId)}">Attached MC</a>`:""}</article>`).join(''):'<p class="helper">No edits recorded for this leave.</p>'}</div>`;
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
    body=`<div class="field"><label for="f-name">Full name</label><input id="f-name" placeholder="Staff member name" value="${esc(person?.name||'')}"></div><div class="form-row"><div class="field"><label for="f-role">Staff type</label><select id="f-role"><option ${person?.role==='Teacher'?'selected':''}>Teacher</option><option ${person?.role==='Admin Staff'?'selected':''}>Admin Staff</option><option ${person?.role==='Administrator'?'selected':''}>Administrator</option><option ${person?.role==='Technical Staff'?'selected':''}>Technical Staff</option><option ${person?.role==='Support Staff'?'selected':''}>Support Staff</option><option ${person?.role==='Principal'?'selected':''}>Principal</option><option ${person?.role==='Deputy Principal'?'selected':''}>Deputy Principal</option></select></div><div class="field"><label for="f-dept">Department</label><input id="f-dept" placeholder="Department" value="${esc(person?.dept||'')}"></div></div><div class="field"><label for="f-idcard">ID card number</label><input id="f-idcard" placeholder="National ID / identity card number" value="${esc(person?.idCardNumber||'')}"></div><div class="field"><label for="f-pin">Machine PIN / user ID</label><input id="f-pin" placeholder="PIN shown on iClock990" value="${esc(person?.devicePin||'')}"></div>`;
    saveFn=async()=>{const employee={name:val('f-name').trim(),role:val('f-role'),dept:val('f-dept'),idCardNumber:val('f-idcard').trim(),devicePin:val('f-pin').trim()};if(!employee.name||!employee.devicePin)return toast('Name and machine PIN are required.');const action=editing?'employee.update':'employee.create';if(await saveAction(action,{id:person?.id,employee})){closeModal();toast(editing?'Employee details updated.':'Staff member added.');}};
  }
  document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;
  const saveButton=document.getElementById('modal-save');saveButton.textContent='Save';saveButton.disabled=false;saveButton.style.display=saveFn?'':'none';saveButton.onclick=saveFn;
  document.getElementById('modal-back').classList.add('open');
}
async function decision(id,status){if(await saveAction('leave.decision',{id,status}))toast(`Leave ${status.toLowerCase()}.`);}
async function editBalance(id){const p=db.people.find(person=>person.id===id);if(!p)return;const annual=prompt(`Annual leave entitlement for ${p.name}:`,p.annual);if(annual===null)return;const medical=prompt('Medical leave entitlement:',p.medical);if(medical===null)return;const casual=prompt('Casual leave entitlement:',p.casual);if(casual===null)return;if([annual,medical,casual].some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0))return toast('Enter valid non-negative balance numbers.');if(await saveAction('employee.balance',{employee:{id:p.id,annual:Number(annual),medical:Number(medical),casual:Number(casual)}}))toast('Leave entitlements updated.');}
async function editLeaveDays(id){const leave=db.leaves.find(item=>item.id===id);if(!leave)return;const usedDays=prompt(`Actual ${leave.type.toLowerCase()} leave days used by ${leave.name} (maximum ${leave.days}):`,leave.usedDays??leave.days);if(usedDays===null)return;if(usedDays===''||!Number.isFinite(Number(usedDays))||Number(usedDays)<0||Number(usedDays)>leave.days)return toast('Enter a number between zero and the planned days.');if(await saveAction('leave.adjust',{id,usedDays:Number(usedDays)}))toast('Actual leave days updated.');}
function exportAttendance(){
  const source=attRows!==null?attRows:db.attendance;
  const rows=[['Employee','Date','Check-in','Check-out','Worked','Late (mins)','Status','Source','Corrected by','Corrected at','Correction reason','Punch note'],...source.map(r=>{const c=(db.attendanceCorrections||[]).find(c=>c.id===r.correctionId);return [r.name,r.date,r.checkIn,r.checkOut,r.workedMins?fmtMins(r.workedMins):'—',r.lateMins||0,r.status,r.source||r.leave||'',c?.actor||'',c?.createdAt||'',c?.reason||'',r.note||''];})];
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

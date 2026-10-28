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
let editingLeaveId = null;
let leavePlanBusy = false;

function refreshLeaveStaff() {
  const role=document.querySelector('input[name="leave-role"]:checked')?.value;
  const select=document.getElementById('lp-employee'), selected=select.value;
  const people=db.people.filter(p=>p.role===role);
  select.innerHTML=`<option value="">${!role?'Select Admin or Teacher first':people.length?'Select a staff member':'No staff in this group'}</option>`+people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  select.disabled=!people.length;
  select.value=people.some(p=>p.id===selected)?selected:'';
  renderLeavePlanSummary();
}
function renderLeavePlanSummary() {
  const person=db.people.find(p=>p.id===val('lp-employee'));
  const summary=document.getElementById('leave-staff-summary');
  if(person){const balance=leaveBalance(person,val('lp-type'));
    summary.innerHTML=`<div class="leave-staff-identity"><span class="mini-avatar">${esc(initials(person.name))}</span><dl><div><dt>Staff name</dt><dd>${esc(person.name)}</dd></div><div><dt>Role</dt><dd>${esc(person.role)}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'Not set')}</dd></div><div><dt>Employee ID</dt><dd>${esc(person.id)}</dd></div></dl></div><div class="leave-balance-strip"><strong>${esc(val('lp-type'))} leave</strong><dl><div><dt>Entitlement</dt><dd>${balance.entitlement} days</dd></div><div><dt>Used / reserved</dt><dd>${balance.used} days</dd></div><div><dt>Remaining</dt><dd>${balance.available} days</dd></div></dl></div>`;
  }else summary.textContent='Select a staff type and staff member to view their details and leave balance.';
  const active=!editingLeaveId||db.leaves.some(l=>l.id===editingLeaveId&&['Approved','Pending'].includes(l.status));
  document.getElementById('lp-save').disabled=leavePlanBusy||!!editingLeaveId||!person;
  document.getElementById('lp-update').disabled=leavePlanBusy||!editingLeaveId||!person||!active;
  document.getElementById('leave-editor-mode').textContent=editingLeaveId?'Editing record':'New record';
  document.getElementById('leave-plan-message').textContent=!active?'This record is no longer editable. Clear to start a new record.':editingLeaveId?'Update saves changes to the selected record.':person?'Ready to record leave.':'Choose staff to begin.';
}
function clearLeavePlan() {
  editingLeaveId=null;
  document.getElementById('leave-plan-form').reset();
  document.querySelectorAll('input[name="leave-role"]').forEach(r=>r.checked=false);
  document.getElementById('lp-employee').value='';
  document.getElementById('lp-start').value=iso(new Date());
  document.getElementById('lp-end').value=expectedReturnDate(val('lp-start'),1);
  document.getElementById('lp-end').min=val('lp-start');
  refreshLeaveStaff();
}

async function api(path, options={}) {
  const response = await fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function setAuthenticated(value) {
  authenticated = value;
  document.getElementById('login-wall').style.display = value ? 'none' : 'grid';
  document.getElementById('app-container').classList.toggle('authenticated',value);
}
function showLoginError(message) { document.getElementById('login-error').textContent = message || ''; }
async function refreshState() {
  const state = await api('/api/state');
  db = state;
  if (!authenticated) setAuthenticated(true);
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
  const color={Present:'present',Late:'late',Absent:'absent','On leave':'leave',Approved:'present',Completed:'present',Declined:'absent',Pending:'late'}[status]||'late';
  return `<span class="status ${color}">${esc(status)}</span>`;
}
function hours(record) {
  if(!record.checkIn||!record.checkOut||record.checkOut==='—')return '—';
  const mins=s=>{const[h,m]=s.split(':').map(Number);return h*60+m;}; const d=mins(record.checkOut)-mins(record.checkIn);
  return d>=0?`${Math.floor(d/60)}h ${String(d%60).padStart(2,'0')}m`:'—';
}
function usedDays(employeeId,type) {
  return db.leaves.filter(l=>l.employeeId===employeeId&&l.type===type&&['Approved','Completed'].includes(l.status)).reduce((sum,l)=>sum+Number(l.status==='Completed'?(l.usedDays??l.days):l.days||0),0);
}
function leaveBalance(person,type) {
  const key=type.toLowerCase(); const entitlement=Number(person[key]||0); const used=usedDays(person.id,type);
  return {entitlement,used,available:Math.max(0,entitlement-used)};
}
function render() {
  const date=iso(today);
  const records=db.attendance.filter(a=>a.date===date);
  const leavesToday=db.leaves.filter(l=>l.status==='Approved'&&l.start<=date&&l.end>=date);
  const rows=[...records];
  for(const l of leavesToday) if(!rows.some(r=>r.name===l.name)) rows.push({name:l.name,date,checkIn:'—',checkOut:'—',status:'On leave',source:'Leave'});
  const present=rows.filter(a=>a.status==='Present').length, late=rows.filter(a=>a.status==='Late').length, onLeave=rows.filter(a=>a.status==='On leave').length;
  document.getElementById('stat-present').textContent=present;
  document.getElementById('stat-late').textContent=late;
  document.getElementById('stat-leave').textContent=onLeave;
  document.getElementById('stat-total').textContent=db.people.length;
  document.getElementById('stat-pending').textContent=db.leaves.filter(l=>l.status==='Pending').length;
  document.getElementById('attendance-preview').innerHTML=rows.length?rows.slice(0,5).map(a=>`<tr><td>${personCell(a.name)}</td><td>${esc(a.checkIn)}</td><td>${esc(a.checkOut)}</td><td>${hours(a)}</td><td>${statusTag(a.status)}</td></tr>`).join(''):`<tr><td colspan="5" class="empty">No punches received for this date.</td></tr>`;
  const arrivals=records.slice().sort((a,b)=>a.checkIn.localeCompare(b.checkIn)).slice(0,4);
  document.getElementById('activity').innerHTML=arrivals.length?arrivals.map(a=>`<div class="event"><div class="event-time">${esc(a.checkIn)}</div><div class="event-track"><i class="event-dot ${a.status==='Late'?'amber':''}"></i></div><div class="event-content"><b>${esc(a.name)}</b><p>${a.status==='Late'?'Late check-in':'Check-in'} · ${esc(a.source||'iClock990')}</p></div></div>`).join(''):`<div class="empty">Waiting for staff punches.</div>`;
  const types=['Annual','Medical','Casual'];
  document.getElementById('balance-preview').innerHTML=types.map(type=>{const total=db.people.reduce((sum,p)=>sum+Number(p[type.toLowerCase()]||0),0);const used=db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);const available=Math.max(0,total-used);return `<div class="leave-row"><div class="leave-label"><i class="leave-dot"></i>${type} leave</div><div style="text-align:right"><div class="leave-count"><b>${available}</b> available · ${used} used</div><div class="bars">${Array.from({length:8},(_,i)=>`<i class="${i<Math.round(available/Math.max(1,total)*8)?'on':''}"></i>`).join('')}</div></div></div>`;}).join('');
  const leaveFilter=document.getElementById('leave-filter').value;
  const leaves=db.leaves.filter(l=>leaveFilter==='all'||l.status===leaveFilter);
  document.getElementById('leave-table').innerHTML=leaves.length?leaves.map(l=>`<tr><td>${personCell(l.name)}</td><td>${esc(l.type)}</td><td>${nice(l.start)}${l.end!==l.start?' – '+nice(l.end):''}${l.returnedAt?`<small class="staff-role"><br>Returned ${nice(l.returnedAt.slice(0,10))}</small>`:''}</td><td>${l.status==='Completed'?`${esc(l.usedDays??l.days)} / ${esc(l.days)}`:esc(l.days)}</td><td>${esc(l.reason||'—')}</td><td>${statusTag(l.status)}</td><td>${['Approved','Pending'].includes(l.status)?`<button class="text-btn" onclick="editLeaveRecord('${l.id}')">Edit</button>`:''}${l.status==='Pending'?`<button class="text-btn" onclick="decision('${l.id}','Approved')">Approve</button><button class="text-btn" style="color:#b9665a" onclick="decision('${l.id}','Declined')">Decline</button>`:l.status==='Completed'?`<button class="text-btn" onclick="editLeaveDays('${l.id}')">Adjust days</button>`:'—'}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">No leave records yet.</td></tr>`;
  document.getElementById('leave-pending').textContent=db.leaves.filter(l=>l.status==='Pending').length;
  document.getElementById('leave-approved').textContent=db.leaves.filter(l=>l.status==='Approved').length;
  document.getElementById('leave-used').innerHTML=usedDaysForType('Annual')+` <span style="font-size:12px;color:#88928a;font-weight:500">days</span>`;
  document.getElementById('balance-table').innerHTML=db.people.length?db.people.map(p=>`<tr><td>${personCell(p.name)}</td>${types.map(type=>{const b=leaveBalance(p,type);return `<td><span class="balance-num">${b.available}</span> / ${b.entitlement} days</td>`;}).join('')}<td><button class="text-btn" onclick="editBalance('${p.id}')">Edit</button></td></tr>`).join(''):`<tr><td colspan="5" class="empty">Add staff to begin tracking balances.</td></tr>`;
  renderAttendance(); renderPeople(); renderDevice(); refreshLeaveStaff();
}
function usedDaysForType(type){return db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);}

/* ---------- Attendance page ---------- */
const attState={preset:'month',from:'',to:'',staff:'all',search:'',sort:'date-desc',status:'all'};
let attRows=null;
const isoAdd=(dateStr,days)=>{const d=new Date(`${dateStr}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const weekdayShort=(date)=>new Date(`${date}T12:00:00`).toLocaleDateString('en',{weekday:'short'});
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
function eachDate(from,to){const out=[];for(let d=new Date(`${from}T12:00:00`);iso(d)<=to&&out.length<93;d.setDate(d.getDate()+1))out.push(iso(d));return out;}
function fillAttStaff(){
  const select=document.getElementById('att-staff'),current=select.value||attState.staff;
  select.innerHTML=`<option value="all">All staff</option>`+db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  select.value=current==='all'||db.people.some(p=>p.id===current)?current:'all';
  attState.staff=select.value;
}
function buildAttendanceRows(){
  const people=attState.staff==='all'?db.people:db.people.filter(p=>p.id===attState.staff);
  const dates=eachDate(attState.from,attState.to);
  const todayIso=iso(today);
  const recordMap=new Map(db.attendance.map(a=>[`${a.name}|${a.date}`,a]));
  const rows=[];
  for(const person of people){
    for(const date of dates){
      const record=recordMap.get(`${person.name}|${date}`);
      if(!record&&date>todayIso)continue;
      const leave=db.leaves.find(l=>l.employeeId===person.id&&l.status==='Approved'&&l.start<=date&&l.end>=date);
      const weekday=new Date(`${date}T12:00:00`).getDay();
      const weekend=weekday===5||weekday===6;
      const row={employeeId:person.id,name:person.name,dept:person.dept||'',date,weekend,checkIn:'—',checkOut:'—',workedMins:0,lateMins:0,source:'',leave:leave?leave.type:''};
      if(record){
        row.checkIn=record.checkIn||'—';row.checkOut=record.checkOut||'—';row.source=record.source||'iClock990';
        if(row.checkIn!=='—'&&row.checkOut!=='—'&&row.checkOut>row.checkIn)row.workedMins=minutesBetween(row.checkIn,row.checkOut);
        const start=person.workStart||'09:00';
        if(row.checkIn!=='—'&&row.checkIn>start)row.lateMins=minutesBetween(start,row.checkIn);
        row.status=row.lateMins>0?'Late':'Present';
      }else if(leave)row.status='On leave';
      else if(weekend)row.status='Weekend';
      else row.status='Absent';
      rows.push(row);
    }
  }
  return rows;
}
function attStatusTag(row){
  if(row.status==='On leave')return `<span class="status leave">On leave${row.leave?' · '+esc(row.leave):''}</span>`;
  if(row.status==='Weekend')return `<span class="status off">Off day</span>`;
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
  const present=all.filter(r=>r.status==='Present'||r.status==='Late').length;
  const leaveDays=all.filter(r=>r.status==='On leave').length;
  const absent=all.filter(r=>r.status==='Absent').length;
  const lateMins=all.reduce((sum,r)=>sum+r.lateMins,0);
  const lateDays=all.filter(r=>r.lateMins>0).length;
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
  if(query)rows=rows.filter(r=>`${r.name} ${r.employeeId} ${r.dept} ${r.status} ${r.leave}`.toLowerCase().includes(query));
  if(attState.sort==='date-asc')rows.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  else if(attState.sort==='late')rows.sort((a,b)=>b.lateMins-a.lateMins||b.date.localeCompare(a.date));
  else if(attState.sort==='hours')rows.sort((a,b)=>b.workedMins-a.workedMins||b.date.localeCompare(a.date));
  else rows.sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name));
  attRows=rows;
  document.getElementById('att-count').textContent=`${rows.length} record${rows.length===1?'':'s'}`;
  document.getElementById('attendance-table').innerHTML=rows.length?rows.slice(0,400).map(r=>`<tr><td>${personCell(r.name)}</td><td><b>${esc(weekdayShort(r.date))}</b><br><small class="staff-role">${nice(r.date)}</small></td><td>${esc(r.checkIn)}</td><td>${esc(r.checkOut)}</td><td>${r.workedMins?fmtMins(r.workedMins):'—'}</td><td>${r.lateMins?`<span class="att-late">${r.lateMins} min</span>`:'—'}</td><td>${attStatusTag(r)}</td><td><button class="text-btn" onclick="viewAttendance('${esc(r.employeeId)}','${r.date}')">View</button></td></tr>`).join(''):`<tr><td colspan="8" class="empty">No attendance rows for this period.</td></tr>`;
}
function viewAttendance(employeeId,date){
  const person=db.people.find(p=>p.id===employeeId);
  const row=(attRows||[]).find(r=>r.employeeId===employeeId&&r.date===date);
  if(!person||!row)return;
  document.getElementById('modal-title').textContent=`${person.name} · ${nice(date)}`;
  document.getElementById('modal-body').innerHTML=`<dl class="att-detail"><div><dt>Status</dt><dd>${attStatusTag(row)}</dd></div><div><dt>Check in</dt><dd>${esc(row.checkIn)}</dd></div><div><dt>Check out</dt><dd>${esc(row.checkOut)}</dd></div><div><dt>Worked</dt><dd>${row.workedMins?fmtMins(row.workedMins):'—'}</dd></div><div><dt>Late</dt><dd>${row.lateMins?`${row.lateMins} mins`:'—'}</dd></div><div><dt>Expected start</dt><dd>${esc(person.workStart||'09:00')}</dd></div><div><dt>Source</dt><dd>${esc(row.source||row.leave||'—')}</dd></div><div><dt>Department</dt><dd>${esc(person.dept||'—')}</dd></div></dl>`;
  const save=document.getElementById('modal-save');
  if(save){save.style.display='none';save.onclick=null;}
  document.getElementById('modal-back').classList.add('open');
}
function renderPeople() {
  const query=document.getElementById('people-search').value.toLowerCase();
  const people=db.people.filter(p=>(p.name+p.dept+p.id+p.devicePin+p.role).toLowerCase().includes(query));
  document.getElementById('people-count').textContent=`${db.people.length} people`;
  document.getElementById('people-table').innerHTML=people.length?people.map(p=>`<tr><td>${personCell(p.name)}</td><td>${esc(p.role)}</td><td>${esc(p.dept||'—')}</td><td>${esc(p.devicePin)}</td><td>${p.annual} days</td><td>${p.medical} days</td><td>${p.casual} days</td></tr>`).join(''):`<tr><td colspan="7" class="empty">No staff found.</td></tr>`;
}
function renderDevice() {
  const chip=document.getElementById('device-chip'), state=document.getElementById('device-state'), last=document.getElementById('device-last-seen');
  const online=!!db.device.online;
  if(chip){chip.classList.toggle('online',online);chip.innerHTML=`<i class="pulse" style="background:${online?'#57a577':'#adb5ae'}"></i>${online?'iClock990 connected':'Waiting for device'}`;}
  if(state)state.textContent=online?'Connected to office server':'Waiting for iClock990';
  if(last)last.textContent=db.device.lastSeen?`${online?'Last device signal':'Last seen'} ${new Date(db.device.lastSeen).toLocaleString()} · ${db.device.count} punches received`:'Waiting for the first device check-in';
}
function go(page) { document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));document.getElementById('crumb').textContent=page==='people'?'Employees':page==='leaves'?'Staff Leave':page[0].toUpperCase()+page.slice(1);window.scrollTo(0,0); }
window.addEventListener('click',e=>{const b=e.target.closest?.('#nav button[data-page]');if(b)go(b.dataset.page);},true);
document.getElementById('att-staff').addEventListener('change',e=>{attState.staff=e.target.value;renderAttendance();});
document.getElementById('att-period').addEventListener('change',e=>{attState.preset=e.target.value;if(attState.preset!=='custom'){const[f,t]=attPresetRange(attState.preset);attState.from=f;attState.to=t;}renderAttendance();});
document.getElementById('att-view').addEventListener('click',()=>{const from=document.getElementById('att-from').value,to=document.getElementById('att-to').value;if(!from||!to||from>to)return toast('Choose a valid attendance period.');attState.preset='custom';attState.from=from;attState.to=to;renderAttendance();});
document.getElementById('att-search').addEventListener('input',e=>{attState.search=e.target.value;renderAttendance();});
document.getElementById('att-sort').addEventListener('change',e=>{attState.sort=e.target.value;renderAttendance();});
document.getElementById('att-chips').addEventListener('click',e=>{const chip=e.target.closest('button.chip');if(!chip)return;attState.status=chip.dataset.status;document.querySelectorAll('#att-chips .chip').forEach(c=>c.classList.toggle('active',c===chip));renderAttendance();});
document.getElementById('att-print').addEventListener('click',()=>window.print());
document.getElementById('att-export').addEventListener('click',()=>exportAttendance());
document.getElementById('leave-filter').addEventListener('change',render);
document.getElementById('people-search').addEventListener('input',renderPeople);
document.querySelectorAll('input[name="leave-role"]').forEach(r=>r.addEventListener('change',()=>{document.getElementById('lp-employee').value='';refreshLeaveStaff();}));
document.getElementById('lp-employee').addEventListener('change',renderLeavePlanSummary);
document.getElementById('lp-type').addEventListener('change',renderLeavePlanSummary);
const updatePlanReturn=()=>{document.getElementById('lp-end').value=expectedReturnDate(val('lp-start'),val('lp-days'));document.getElementById('lp-end').min=val('lp-start');};
document.getElementById('lp-start').addEventListener('change',updatePlanReturn);
document.getElementById('lp-days').addEventListener('input',updatePlanReturn);
document.getElementById('lp-clear').addEventListener('click',clearLeavePlan);
document.getElementById('leave-plan-form').addEventListener('submit',e=>{e.preventDefault();if(!editingLeaveId)saveLeavePlan(false);});
document.getElementById('lp-update').addEventListener('click',()=>saveLeavePlan(true));
clearLeavePlan();
document.getElementById('login-form').addEventListener('submit',async e=>{e.preventDefault();showLoginError('');const button=e.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:document.getElementById('login-password').value})});document.getElementById('login-password').value='';await refreshState();}catch(error){showLoginError(error.message);}finally{button.disabled=false;}});
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});setAuthenticated(false);});
setDate();
api('/api/state').then(state=>{db=state;setAuthenticated(true);render();}).catch(error=>{if(!String(error.message).includes('Administrator sign-in'))showLoginError(error.message);});
setInterval(()=>{if(authenticated)refreshState().catch(error=>{if(error.message.includes('Administrator sign-in'))setAuthenticated(false);});},10000);

async function saveAction(action,payload) { try { db=await api('/api/state',{method:'POST',body:JSON.stringify({action,...payload})});render();return true; } catch(error) { toast(error.message);return false; } }
function closeModal(){document.getElementById('modal-back').classList.remove('open');}
function val(id){return document.getElementById(id)?.value||'';}
async function saveLeavePlan(update) {
  if(leavePlanBusy||update!==!!editingLeaveId)return;
  const form=document.getElementById('leave-plan-form');
  if(!form.reportValidity())return;
  const leave={employeeId:val('lp-employee'),type:val('lp-type'),days:Number(val('lp-days')),start:val('lp-start'),end:val('lp-end'),reason:val('lp-reason'),status:val('lp-status')};
  if(!leave.employeeId||!Number.isFinite(leave.days)||leave.days<=0||leave.end<leave.start)return toast('Check the staff member, dates and leave days.');
  leavePlanBusy=true;renderLeavePlanSummary();
  try{if(await saveAction(update?'leave.update':'leave.create',{id:editingLeaveId,leave})){clearLeavePlan();toast(update?'Leave record updated.':'Leave record saved.');}}
  finally{leavePlanBusy=false;renderLeavePlanSummary();}
}
function editLeaveRecord(id) {
  if(leavePlanBusy)return;
  const leave=db.leaves.find(l=>l.id===id), person=db.people.find(p=>p.id===leave?.employeeId);
  if(!leave||!person||!['Approved','Pending'].includes(leave.status))return toast('Only approved or pending records can be edited.');
  editingLeaveId=id;
  document.querySelectorAll('input[name="leave-role"]').forEach(r=>r.checked=r.value===person.role);
  refreshLeaveStaff();document.getElementById('lp-employee').value=person.id;
  for(const [field,value] of Object.entries({type:leave.type,days:leave.days,start:leave.start,end:leave.end,reason:leave.reason,status:leave.status}))document.getElementById('lp-'+field).value=value;
  document.getElementById('lp-end').min=leave.start;
  renderLeavePlanSummary();go('leaves');document.getElementById('leave-workspace').scrollIntoView({block:'start'});
}
function openModal(kind){let title,body,saveFn;
  if(kind==='leave'){if(leavePlanBusy)return;clearLeavePlan();go('leaves');document.getElementById('leave-workspace').scrollIntoView({block:'start'});return;}
  if(kind==='manual'){
    title='Correct attendance record';
    body=`<div class="field"><label>Staff member</label><select id="f-employee">${db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label>Date</label><input id="f-date" type="date" value="${iso(today)}"></div><div class="field"><label>Check in</label><input id="f-in" type="time" value="09:00"></div></div><div class="field"><label>Check out (optional)</label><input id="f-out" type="time"></div>`;
    saveFn=async()=>{if(await saveAction('attendance.manual',{entry:{employeeId:val('f-employee'),date:val('f-date'),checkIn:val('f-in'),checkOut:val('f-out')}})){closeModal();toast('Attendance correction saved.');}};
  } else if(kind==='employee'){
    title='Add teacher or admin staff';
    body=`<div class="field"><label>Full name</label><input id="f-name" placeholder="Staff member name"></div><div class="form-row"><div class="field"><label>Staff type</label><select id="f-role"><option>Teacher</option><option>Admin Staff</option></select></div><div class="field"><label>Department</label><input id="f-dept" placeholder="Department"></div></div><div class="form-row"><div class="field"><label>Employee ID</label><input id="f-id" placeholder="e.g. EMP-009"></div><div class="field"><label>Machine PIN / user ID</label><input id="f-pin" placeholder="PIN shown on iClock990"></div></div>`;
    saveFn=async()=>{const employee={name:val('f-name').trim(),role:val('f-role'),dept:val('f-dept'),id:val('f-id').trim(),devicePin:val('f-pin').trim()};if(!employee.name||!employee.id||!employee.devicePin)return toast('Name, employee ID and machine PIN are required.');if(await saveAction('employee.create',{employee})){closeModal();toast('Staff member added.');}};
  }
  document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;
  const saveButton=document.getElementById('modal-save');saveButton.style.display=saveFn?'':'none';saveButton.onclick=saveFn;
  document.getElementById('modal-back').classList.add('open');
}
async function decision(id,status){if(await saveAction('leave.decision',{id,status}))toast(`Leave ${status.toLowerCase()}.`);}
async function editBalance(id){const p=db.people.find(person=>person.id===id);if(!p)return;const annual=prompt(`Annual leave entitlement for ${p.name}:`,p.annual);if(annual===null)return;const medical=prompt('Medical leave entitlement:',p.medical);if(medical===null)return;const casual=prompt('Casual leave entitlement:',p.casual);if(casual===null)return;if([annual,medical,casual].some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0))return toast('Enter valid non-negative balance numbers.');if(await saveAction('employee.balance',{employee:{id:p.id,annual:Number(annual),medical:Number(medical),casual:Number(casual)}}))toast('Leave entitlements updated.');}
async function editLeaveDays(id){const leave=db.leaves.find(item=>item.id===id);if(!leave)return;const usedDays=prompt(`Actual ${leave.type.toLowerCase()} leave days used by ${leave.name} (maximum ${leave.days}):`,leave.usedDays??leave.days);if(usedDays===null)return;if(usedDays===''||!Number.isFinite(Number(usedDays))||Number(usedDays)<0||Number(usedDays)>leave.days)return toast('Enter a number between zero and the planned days.');if(await saveAction('leave.adjust',{id,usedDays:Number(usedDays)}))toast('Actual leave days updated.');}
function exportAttendance(){
  const source=attRows&&attRows.length?attRows:db.attendance.map(a=>({name:a.name,date:a.date,checkIn:a.checkIn,checkOut:a.checkOut,workedMins:0,lateMins:0,status:a.status,source:a.source,leave:''}));
  const rows=[['Employee','Date','Check-in','Check-out','Worked','Late (mins)','Status','Source'],...source.map(r=>[r.name,r.date,r.checkIn,r.checkOut,r.workedMins?fmtMins(r.workedMins):'—',r.lateMins||0,r.status,r.source||r.leave||''])];
  const csv=rows.map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='attendance.csv';link.click();URL.revokeObjectURL(link.href);
}

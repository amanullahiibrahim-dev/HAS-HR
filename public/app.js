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
  document.getElementById('attendance-date').value=iso(today);
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
  const date=document.getElementById('attendance-date').value||iso(today);
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
  document.getElementById('att-present').textContent=present;
  document.getElementById('att-late').textContent=late;
  document.getElementById('att-absent').textContent=Math.max(0,db.people.length-rows.length);
  document.getElementById('att-leave').textContent=onLeave;
  document.getElementById('attendance-day-label').textContent=`Attendance for ${date===iso(today)?'today':nice(date)}`;
  document.getElementById('attendance-preview').innerHTML=rows.length?rows.slice(0,5).map(a=>`<tr><td>${personCell(a.name)}</td><td>${esc(a.checkIn)}</td><td>${esc(a.checkOut)}</td><td>${hours(a)}</td><td>${statusTag(a.status)}</td></tr>`).join(''):`<tr><td colspan="5" class="empty">No punches received for this date.</td></tr>`;
  const statusFilter=document.getElementById('attendance-filter').value;
  const filtered=rows.filter(a=>statusFilter==='all'||a.status===statusFilter);
  document.getElementById('attendance-table').innerHTML=filtered.length?filtered.map(a=>`<tr><td>${personCell(a.name)}</td><td>${nice(a.date)}</td><td>${esc(a.checkIn)}</td><td>${esc(a.checkOut)}</td><td>${hours(a)}</td><td>${esc(a.source||'iClock990')}</td><td>${statusTag(a.status)}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">No matching records.</td></tr>`;
  const arrivals=records.slice().sort((a,b)=>a.checkIn.localeCompare(b.checkIn)).slice(0,4);
  document.getElementById('activity').innerHTML=arrivals.length?arrivals.map(a=>`<div class="event"><div class="event-time">${esc(a.checkIn)}</div><div class="event-track"><i class="event-dot ${a.status==='Late'?'amber':''}"></i></div><div class="event-content"><b>${esc(a.name)}</b><p>${a.status==='Late'?'Late check-in':'Check-in'} · ${esc(a.source||'iClock990')}</p></div></div>`).join(''):`<div class="empty">Waiting for staff punches.</div>`;
  const types=['Annual','Medical','Casual'];
  document.getElementById('balance-preview').innerHTML=types.map(type=>{const total=db.people.reduce((sum,p)=>sum+Number(p[type.toLowerCase()]||0),0);const used=db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);const available=Math.max(0,total-used);return `<div class="leave-row"><div class="leave-label"><i class="leave-dot"></i>${type} leave</div><div style="text-align:right"><div class="leave-count"><b>${available}</b> available · ${used} used</div><div class="bars">${Array.from({length:8},(_,i)=>`<i class="${i<Math.round(available/Math.max(1,total)*8)?'on':''}"></i>`).join('')}</div></div></div>`;}).join('');
  const leaveFilter=document.getElementById('leave-filter').value;
  const leaves=db.leaves.filter(l=>leaveFilter==='all'||l.status===leaveFilter);
  document.getElementById('leave-table').innerHTML=leaves.length?leaves.map(l=>`<tr><td>${personCell(l.name)}</td><td>${esc(l.type)}</td><td>${nice(l.start)}${l.end!==l.start?' – '+nice(l.end):''}${l.returnedAt?`<small class="staff-role"><br>Returned ${nice(l.returnedAt.slice(0,10))}</small>`:''}</td><td>${l.status==='Completed'?`${esc(l.usedDays??l.days)} / ${esc(l.days)}`:esc(l.days)}</td><td>${esc(l.reason||'—')}</td><td>${statusTag(l.status)}</td><td>${l.status==='Pending'?`<button class="text-btn" onclick="decision('${l.id}','Approved')">Approve</button><button class="text-btn" style="color:#b9665a" onclick="decision('${l.id}','Declined')">Decline</button>`:l.status==='Completed'?`<button class="text-btn" onclick="editLeaveDays('${l.id}')">Adjust days</button>`:'—'}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">No leave records yet.</td></tr>`;
  document.getElementById('leave-pending').textContent=db.leaves.filter(l=>l.status==='Pending').length;
  document.getElementById('leave-approved').textContent=db.leaves.filter(l=>l.status==='Approved').length;
  document.getElementById('leave-used').innerHTML=usedDaysForType('Annual')+` <span style="font-size:12px;color:#88928a;font-weight:500">days</span>`;
  document.getElementById('balance-table').innerHTML=db.people.length?db.people.map(p=>`<tr><td>${personCell(p.name)}</td>${types.map(type=>{const b=leaveBalance(p,type);return `<td><span class="balance-num">${b.available}</span> / ${b.entitlement} days</td>`;}).join('')}<td><button class="text-btn" onclick="editBalance('${p.id}')">Edit</button></td></tr>`).join(''):`<tr><td colspan="5" class="empty">Add staff to begin tracking balances.</td></tr>`;
  renderPeople(); renderDevice();
}
function usedDaysForType(type){return db.people.reduce((sum,p)=>sum+usedDays(p.id,type),0);}
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
function go(page) { document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));document.getElementById('crumb').textContent=page==='people'?'Employees':page[0].toUpperCase()+page.slice(1);window.scrollTo(0,0); }
window.addEventListener('click',e=>{const b=e.target.closest?.('#nav button[data-page]');if(b)go(b.dataset.page);},true);
document.getElementById('attendance-date').addEventListener('change',render);
document.getElementById('attendance-filter').addEventListener('change',render);
document.getElementById('leave-filter').addEventListener('change',render);
document.getElementById('people-search').addEventListener('input',renderPeople);
document.getElementById('login-form').addEventListener('submit',async e=>{e.preventDefault();showLoginError('');const button=e.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:document.getElementById('login-password').value})});document.getElementById('login-password').value='';await refreshState();}catch(error){showLoginError(error.message);}finally{button.disabled=false;}});
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});setAuthenticated(false);});
setDate();
api('/api/state').then(state=>{db=state;setAuthenticated(true);render();}).catch(error=>{if(!String(error.message).includes('Administrator sign-in'))showLoginError(error.message);});
setInterval(()=>{if(authenticated)refreshState().catch(error=>{if(error.message.includes('Administrator sign-in'))setAuthenticated(false);});},10000);

async function saveAction(action,payload) { try { db=await api('/api/state',{method:'POST',body:JSON.stringify({action,...payload})});render();return true; } catch(error) { toast(error.message);return false; } }
function closeModal(){document.getElementById('modal-back').classList.remove('open');}
function val(id){return document.getElementById(id)?.value||'';}
function openModal(kind){let title,body,saveFn;
  if(kind==='leave'){
    title='Record staff leave';
    body=`<div class="field"><label>Staff member</label><select id="f-employee">${db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.role)}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label>Leave type</label><select id="f-type"><option>Annual</option><option>Medical</option><option>Casual</option></select></div><div class="field"><label>Days</label><input id="f-days" type="number" min="0.5" step="0.5" value="1"></div></div><div class="form-row"><div class="field"><label>Leave starts</label><input id="f-start" type="date" value="${iso(today)}"></div><div class="field"><label>Expected return</label><input id="f-end" type="date" value="${expectedReturnDate(iso(today),1)}"></div></div><div class="field"><label>Reason / note</label><input id="f-reason" placeholder="Optional"></div><div class="field"><label>Record status</label><select id="f-status"><option value="Approved">Approved / on leave now</option><option value="Pending">Pending approval</option></select></div><p class="helper">An approved leave is marked completed when this staff member’s machine PIN records a check-in during the leave dates.</p>`;
    saveFn=async()=>{const leave={employeeId:val('f-employee'),type:val('f-type'),days:Number(val('f-days')),start:val('f-start'),end:val('f-end'),reason:val('f-reason'),status:val('f-status')};if(!leave.employeeId||!leave.start||!leave.end||leave.end<leave.start||leave.days<=0)return toast('Check the staff member, dates and leave days.');if(await saveAction('leave.create',{leave})){closeModal();toast('Leave record saved.');}};
  } else if(kind==='manual'){
    title='Correct attendance record';
    body=`<div class="field"><label>Staff member</label><select id="f-employee">${db.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label>Date</label><input id="f-date" type="date" value="${iso(today)}"></div><div class="field"><label>Check in</label><input id="f-in" type="time" value="09:00"></div></div><div class="field"><label>Check out (optional)</label><input id="f-out" type="time"></div>`;
    saveFn=async()=>{if(await saveAction('attendance.manual',{entry:{employeeId:val('f-employee'),date:val('f-date'),checkIn:val('f-in'),checkOut:val('f-out')}})){closeModal();toast('Attendance correction saved.');}};
  } else if(kind==='employee'){
    title='Add teacher or admin staff';
    body=`<div class="field"><label>Full name</label><input id="f-name" placeholder="Staff member name"></div><div class="form-row"><div class="field"><label>Staff type</label><select id="f-role"><option>Teacher</option><option>Admin Staff</option></select></div><div class="field"><label>Department</label><input id="f-dept" placeholder="Department"></div></div><div class="form-row"><div class="field"><label>Employee ID</label><input id="f-id" placeholder="e.g. EMP-009"></div><div class="field"><label>Machine PIN / user ID</label><input id="f-pin" placeholder="PIN shown on iClock990"></div></div>`;
    saveFn=async()=>{const employee={name:val('f-name').trim(),role:val('f-role'),dept:val('f-dept'),id:val('f-id').trim(),devicePin:val('f-pin').trim()};if(!employee.name||!employee.id||!employee.devicePin)return toast('Name, employee ID and machine PIN are required.');if(await saveAction('employee.create',{employee})){closeModal();toast('Staff member added.');}};
  }
  document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;document.getElementById('modal-save').onclick=saveFn;
  if(kind==='leave'){
    const updateExpectedReturn=()=>{document.getElementById('f-end').value=expectedReturnDate(val('f-start'),val('f-days'));};
    document.getElementById('f-start').addEventListener('change',updateExpectedReturn);
    document.getElementById('f-days').addEventListener('input',updateExpectedReturn);
  }
  document.getElementById('modal-back').classList.add('open');
}
async function decision(id,status){if(await saveAction('leave.decision',{id,status}))toast(`Leave ${status.toLowerCase()}.`);}
async function editBalance(id){const p=db.people.find(person=>person.id===id);if(!p)return;const annual=prompt(`Annual leave entitlement for ${p.name}:`,p.annual);if(annual===null)return;const medical=prompt('Medical leave entitlement:',p.medical);if(medical===null)return;const casual=prompt('Casual leave entitlement:',p.casual);if(casual===null)return;if([annual,medical,casual].some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0))return toast('Enter valid non-negative balance numbers.');if(await saveAction('employee.balance',{employee:{id:p.id,annual:Number(annual),medical:Number(medical),casual:Number(casual)}}))toast('Leave entitlements updated.');}
async function editLeaveDays(id){const leave=db.leaves.find(item=>item.id===id);if(!leave)return;const usedDays=prompt(`Actual ${leave.type.toLowerCase()} leave days used by ${leave.name} (maximum ${leave.days}):`,leave.usedDays??leave.days);if(usedDays===null)return;if(usedDays===''||!Number.isFinite(Number(usedDays))||Number(usedDays)<0||Number(usedDays)>leave.days)return toast('Enter a number between zero and the planned days.');if(await saveAction('leave.adjust',{id,usedDays:Number(usedDays)}))toast('Actual leave days updated.');}
function exportAttendance(){const rows=[['Employee','Date','Check-in','Check-out','Status','Source'],...db.attendance.map(a=>[a.name,a.date,a.checkIn,a.checkOut,a.status,a.source])];const csv=rows.map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='attendance.csv';link.click();URL.revokeObjectURL(link.href);}

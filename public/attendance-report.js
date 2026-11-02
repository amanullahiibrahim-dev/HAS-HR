/* Attendance Report: filter state is independent of the daily Attendance page. */
function reportISO(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function reportPresetRange(preset,now=new Date()){
  const day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const move=days=>{const date=new Date(day);date.setDate(date.getDate()+days);return reportISO(date);};
  if(preset==='today')return[move(0),move(0)];
  if(preset==='yesterday')return[move(-1),move(-1)];
  if(preset==='7')return[move(-6),move(0)];
  if(preset==='30')return[move(-29),move(0)];
  const month=now.getMonth()-(now.getDate()<16?1:0)-(preset==='last'?1:0);
  return[reportISO(new Date(now.getFullYear(),month,16)),reportISO(new Date(now.getFullYear(),month+1,15))];
}
function newReportDraft(){const[from,to]=reportPresetRange('current');return{staffStatus:'active',employee:'all',preset:'current',from,to,units:[],role:'all',status:'all',search:''};}
const attendanceReportState={draft:newReportDraft(),applied:null,rows:[],page:0,dirty:false,expanded:false};
function reportFilterPeople(data,filters){
  return data.people.filter(person=>
    (['active','all'].includes(filters.staffStatus)&&!person.removedAt)&&
    (filters.employee==='all'||person.id===filters.employee)&&
    (!filters.units.length||filters.units.includes((person.dept||'').trim()))&&
    (filters.role==='all'||person.role===filters.role));
}
function reportValidRange(from,to){
  const valid=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  return valid(from)&&valid(to)&&from<=to&&(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000<366;
}
function getAttendanceReportRows(filters){
  const people=reportFilterPeople(db,filters),through=reportISO(new Date()),to=filters.to<through?filters.to:through;
  if(to<filters.from)return[];
  const personMap=new Map(people.map(person=>[person.id,person]));
  const query=filters.search.trim().toLowerCase();
  return buildAttendanceRows({people,staff:'all',from:filters.from,to}).filter(row=>
    (filters.status==='all'||row.status===filters.status)&&
    query.split(/\s+/).filter(Boolean).every(term=>{const person=personMap.get(row.employeeId);return [row.name,row.employeeId,row.dept,row.status,row.status==='Incomplete'?'Punch review needed':'',row.leave,person?.role,person?.devicePin,person?.idCardNumber].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);}))
    .map(row=>({...row,role:personMap.get(row.employeeId)?.role||'',staffStatus:'Active'}))
    .sort((a,b)=>a.name.localeCompare(b.name)||a.employeeId.localeCompare(b.employeeId)||a.date.localeCompare(b.date));
}
function summarizeAttendanceReport(rows){return{
  employees:new Set(rows.map(row=>row.employeeId)).size,
  present:rows.filter(row=>['Present','Late','On duty'].includes(row.status)).length,
  absent:rows.filter(row=>row.status==='Absent').length,
  leave:rows.filter(row=>row.status==='On leave').length,
  lateMinutes:rows.reduce((sum,row)=>sum+(row.lateMins||0),0),
  workedMinutes:rows.reduce((sum,row)=>sum+(row.workedMins||0),0)
};}
function reportCsvCell(value){let text=String(value??'');if(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
function attendanceReportCsv(rows){
  const header=['Employee ID','Employee','Staff status','Business unit','Staff type','Date','Check-in','Check-out','Worked minutes','Late minutes','Attendance status','Leave type','Source','Correction reference','Duty travel reference','Punch note'];
  return '\ufeff'+[header,...rows.map(row=>[row.employeeId,row.name,row.staffStatus,row.dept||'Unassigned',row.role,row.date,row.checkIn,row.checkOut,row.workedMins||0,row.lateMins||0,row.status,row.leave||'',row.source||'',row.correctionId||'',row.dutyTravelId||'',row.note||''])].map(row=>row.map(reportCsvCell).join(',')).join('\r\n');
}
function reportCaption(filters){
  const people=db.people,person=people.find(p=>p.id===filters.employee);
  return `${nice(filters.from)} – ${nice(filters.to)} · ${filters.staffStatus==='all'?'All staff':'Active staff'} · ${filters.employee==='all'?'All employees':person?.name||filters.employee} · ${filters.units.length?filters.units.map(unit=>unit||'Unassigned').join(', '):'All business units'}${filters.role==='all'?'':' · '+filters.role}${filters.status==='all'?'':' · '+filters.status}${filters.search?' · Search: '+filters.search:''}`;
}
function reportMessage(message,error=false){const target=document.getElementById('ar-message');target.textContent=message;target.classList.toggle('report-error',error);}
function markAttendanceReportDirty(){
  attendanceReportState.dirty=!!attendanceReportState.applied;
  reportMessage(attendanceReportState.dirty?'Filters changed. Select View report to update the results.':'');
  document.getElementById('ar-export').disabled=attendanceReportState.dirty||!attendanceReportState.rows.length;
  document.getElementById('ar-print').disabled=attendanceReportState.dirty||!attendanceReportState.rows.length;
}
function renderAttendanceReportFilters(){
  const draft=attendanceReportState.draft;
  for(const[id,key]of [['ar-staff-status','staffStatus'],['ar-period','preset'],['ar-from','from'],['ar-to','to'],['ar-role','role'],['ar-attendance-status','status'],['ar-search','search']])document.getElementById(id).value=draft[key];
  document.getElementById('ar-custom-dates').hidden=draft.preset!=='custom';
  document.getElementById('ar-date-summary').textContent=`${nice(draft.from)} – ${nice(draft.to)}`;
  const people=reportFilterPeople(db,{...draft,employee:'all'}),select=document.getElementById('ar-employee');
  select.innerHTML='<option value="all">All employees</option>'+people.map(person=>`<option value="${esc(person.id)}">${esc(person.name)} · ${esc(person.id)}</option>`).join('');
  if(draft.employee!=='all'&&!people.some(person=>person.id===draft.employee))select.innerHTML+=`<option value="${esc(draft.employee)}">${esc(draft.employee)} (not in current filters)</option>`;
  select.value=draft.employee;
  const units=[...new Set(db.people.map(person=>(person.dept||'').trim()))].sort((a,b)=>a.localeCompare(b));
  document.getElementById('ar-unit-options').innerHTML=units.length?units.map((unit,index)=>`<label for="ar-unit-${index}"><input id="ar-unit-${index}" type="checkbox" data-report-unit="${esc(unit)}" ${draft.units.includes(unit)?'checked':''}><span>${esc(unit||'Unassigned')}</span></label>`).join(''):'<p>No employee departments yet.</p>';
  document.getElementById('ar-unit-tags').innerHTML=draft.units.length?draft.units.map(unit=>`<button type="button" class="report-unit-tag" data-remove-unit="${esc(unit)}" aria-label="Remove business unit ${esc(unit||'Unassigned')}">${esc(unit||'Unassigned')} <span aria-hidden="true">×</span></button>`).join(''):'<span class="report-unit-placeholder">All business units</span>';
}
function attendanceReportRowMarkup(row){return `<tr><td><strong>${esc(row.name)}</strong><small class="report-employee-id">${esc(row.employeeId)}</small></td><td>${esc(row.dept||'Unassigned')}</td><td>${esc(row.role)}</td><td>${nice(row.date)}</td><td>${esc(row.checkIn)}</td><td>${esc(row.checkOut)}</td><td>${row.workedMins?fmtMins(row.workedMins):'—'}</td><td>${row.lateMins?row.lateMins+' min':'—'}</td><td>${attStatusTag(row)}</td><td>${esc(row.source||row.leave||'—')}${row.note?'<br><small class="staff-role">'+esc(row.note)+'</small>':''}</td></tr>`;}
function renderAttendanceReportResults(){
  const state=attendanceReportState,rows=state.rows;
  document.getElementById('ar-empty').hidden=!!state.applied;
  document.getElementById('ar-results').hidden=!state.applied;
  if(!state.applied)return;
  const summary=summarizeAttendanceReport(rows);
  document.getElementById('ar-kpis').innerHTML=[['Employees',summary.employees],['Present / on duty',summary.present],['Absent',summary.absent],['Late minutes',summary.lateMinutes],['Worked hours',fmtMins(summary.workedMinutes)]].map(([label,value])=>`<div class="card"><div class="card-head">${esc(label)}</div><div class="metric">${esc(value)}</div></div>`).join('');
  document.getElementById('ar-result-caption').textContent=reportCaption(state.applied)+` · ${rows.length} records`;
  const pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.max(0,Math.min(state.page,pages-1));
  document.getElementById('ar-table').innerHTML=rows.length?rows.slice(state.page*50,(state.page+1)*50).map(attendanceReportRowMarkup).join(''):'<tr><td colspan="10" class="empty">No attendance records match these filters.</td></tr>';
  document.getElementById('ar-page-label').textContent=`Page ${state.page+1} of ${pages} · ${rows.length} records`;
  document.getElementById('ar-prev').disabled=state.page===0;document.getElementById('ar-next').disabled=state.page>=pages-1;
  document.getElementById('ar-export').disabled=state.dirty||!rows.length;document.getElementById('ar-print').disabled=state.dirty||!rows.length;
}
function renderAttendanceReport(){
  renderAttendanceReportFilters();
  if(attendanceReportState.applied)attendanceReportState.rows=getAttendanceReportRows(attendanceReportState.applied);
  renderAttendanceReportResults();
}
let attendanceReportSearchTimer=null;
function viewAttendanceReport(){
  clearTimeout(attendanceReportSearchTimer);
  const draft=attendanceReportState.draft;
  if(!reportValidRange(draft.from,draft.to)){reportMessage('Choose valid From and To dates, in order, covering at most 366 days.',true);return;}
  attendanceReportState.applied={...draft,units:[...draft.units]};attendanceReportState.rows=getAttendanceReportRows(attendanceReportState.applied);attendanceReportState.page=0;attendanceReportState.dirty=false;
  document.getElementById('ar-unit-menu').open=false;
  reportMessage(draft.to>reportISO(new Date())?'Future dates are excluded until they occur.':'');renderAttendanceReportResults();
}
function setReportExpanded(expanded){
  attendanceReportState.expanded=expanded;document.getElementById('page-reports').classList.toggle('report-expanded',expanded);document.body.classList.toggle('report-is-expanded',expanded);
  const button=document.getElementById('ar-expand');button.setAttribute('aria-pressed',String(expanded));button.setAttribute('aria-label',expanded?'Exit expanded attendance report':'Expand attendance report');button.textContent=expanded?'⤡':'⤢';
}
function resetAttendanceReport(){
  clearTimeout(attendanceReportSearchTimer);
  attendanceReportState.draft=newReportDraft();attendanceReportState.applied=null;attendanceReportState.rows=[];attendanceReportState.page=0;attendanceReportState.dirty=false;setReportExpanded(false);
  document.getElementById('ar-more-filters').hidden=true;document.getElementById('ar-more').setAttribute('aria-expanded','false');document.getElementById('ar-unit-menu').open=false;reportMessage('');renderAttendanceReport();
}
function exportAttendanceReport(){
  const state=attendanceReportState;if(!authenticated||state.dirty||!state.applied||!state.rows.length)return;
  const url=URL.createObjectURL(new Blob([attendanceReportCsv(state.rows)],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download=`haaziry-attendance-report-${state.applied.from}-to-${state.applied.to}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function printAttendanceReport(){
  const state=attendanceReportState;if(!authenticated||state.dirty||!state.applied||!state.rows.length)return;
  const target=window.open('','_blank');if(!target)return reportMessage('Allow pop-ups to open the printable attendance report.',true);target.opener=null;
  const summary=summarizeAttendanceReport(state.rows),heading=`<h1>Haaziry · Attendance Report</h1><p>${esc(reportCaption(state.applied))}</p><p>${summary.employees} employees · ${summary.present} present / on duty · ${summary.absent} absent · ${summary.lateMinutes} late minutes · ${esc(fmtMins(summary.workedMinutes))} worked · ${state.rows.length} records</p>`;
  target.document.open();target.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Haaziry Attendance Report</title><style>body{font:11px Arial,sans-serif;color:#24382e;padding:20px}h1{font-size:20px}p{line-height:1.5}table{width:100%;border-collapse:collapse;font-size:10px}th,td{text-align:left;padding:6px;border-bottom:1px solid #ddd}th{background:#edf4f0}small{display:block;font-size:9px}.status{white-space:nowrap}@page{size:landscape;margin:12mm}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body>${heading}<table><thead><tr><th>Employee</th><th>Business unit</th><th>Staff type</th><th>Date</th><th>In</th><th>Out</th><th>Worked</th><th>Late</th><th>Status</th><th>Source</th></tr></thead><tbody>${state.rows.map(attendanceReportRowMarkup).join('')}</tbody></table></body></html>`);target.document.close();target.addEventListener('afterprint',()=>target.close());target.focus();target.print();
}
function initAttendanceReport(){
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#ar-unit-menu'))document.getElementById('ar-unit-menu').open=false;});
  document.addEventListener('focusin',event=>{if(!event.target.closest('#ar-unit-menu'))document.getElementById('ar-unit-menu').open=false;});
  for(const[id,key]of [['ar-staff-status','staffStatus'],['ar-employee','employee'],['ar-role','role'],['ar-attendance-status','status']])document.getElementById(id).addEventListener('change',event=>{attendanceReportState.draft[key]=event.target.value;if(['staffStatus','role'].includes(key))attendanceReportState.draft.employee='all';markAttendanceReportDirty();renderAttendanceReportFilters();});
  document.getElementById('ar-search').addEventListener('input',event=>{attendanceReportState.draft.search=event.target.value;markAttendanceReportDirty();clearTimeout(attendanceReportSearchTimer);attendanceReportSearchTimer=setTimeout(viewAttendanceReport,180);});
  document.getElementById('ar-period').addEventListener('change',event=>{const draft=attendanceReportState.draft;draft.preset=event.target.value;if(draft.preset!=='custom')[draft.from,draft.to]=reportPresetRange(draft.preset);markAttendanceReportDirty();renderAttendanceReportFilters();});
  for(const[id,key]of [['ar-from','from'],['ar-to','to']])document.getElementById(id).addEventListener('change',event=>{attendanceReportState.draft[key]=event.target.value;markAttendanceReportDirty();document.getElementById('ar-date-summary').textContent=`${nice(attendanceReportState.draft.from)} – ${nice(attendanceReportState.draft.to)}`;});
  document.getElementById('ar-unit-options').addEventListener('change',event=>{const input=event.target.closest('input[data-report-unit]');if(!input)return;const draft=attendanceReportState.draft,unit=input.dataset.reportUnit;draft.units=input.checked?[...new Set([...draft.units,unit])]:draft.units.filter(value=>value!==unit);draft.employee='all';markAttendanceReportDirty();renderAttendanceReportFilters();});
  document.getElementById('ar-unit-tags').addEventListener('click',event=>{const button=event.target.closest('button[data-remove-unit]');if(!button)return;attendanceReportState.draft.units=attendanceReportState.draft.units.filter(value=>value!==button.dataset.removeUnit);attendanceReportState.draft.employee='all';markAttendanceReportDirty();renderAttendanceReportFilters();});
  document.getElementById('ar-form').addEventListener('submit',event=>{event.preventDefault();viewAttendanceReport();});
  document.getElementById('ar-clear').addEventListener('click',()=>resetAttendanceReport());
  document.getElementById('ar-more').addEventListener('click',()=>{const panel=document.getElementById('ar-more-filters');panel.hidden=!panel.hidden;document.getElementById('ar-more').setAttribute('aria-expanded',String(!panel.hidden));});
  document.getElementById('ar-expand').addEventListener('click',()=>setReportExpanded(!attendanceReportState.expanded));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.getElementById('ar-unit-menu').open=false;if(attendanceReportState.expanded)setReportExpanded(false);}});
  document.getElementById('ar-prev').addEventListener('click',()=>{attendanceReportState.page--;renderAttendanceReportResults();});
  document.getElementById('ar-next').addEventListener('click',()=>{attendanceReportState.page++;renderAttendanceReportResults();});
  document.getElementById('ar-export').addEventListener('click',exportAttendanceReport);document.getElementById('ar-print').addEventListener('click',printAttendanceReport);
}

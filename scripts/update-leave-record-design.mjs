import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
function leaveRecordDate(value){return new Date(value+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}
function leaveRecordRange(from,to){
  if(from===to)return leaveRecordDate(from);
  const a=new Date(from+'T12:00:00'),b=new Date(to+'T12:00:00'),month=d=>d.toLocaleDateString('en-GB',{month:'short'});
  if(a.getFullYear()!==b.getFullYear())return leaveRecordDate(from)+' – '+leaveRecordDate(to);
  return a.getMonth()===b.getMonth()?`${a.getDate()}–${b.getDate()} ${month(b)} ${b.getFullYear()}`:`${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`;
}
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
const recordsMarkup=`<div class="leave-top-cards">
 <div class="card leave-stat-card"><div class="card-head">Applied leave records</div><div class="metric" id="leave-used">0</div></div>
 <div class="card leave-stat-card"><div class="card-head">Requests pending</div><div class="metric" id="leave-pending">0</div></div>
 <div class="card leave-stat-card"><div class="card-head">Approved records</div><div class="metric" id="leave-approved">0</div></div>
</div>
<div class="wide-panel leave-record-panel"><div class="panel-head"><h2>Applied leave records</h2><span id="leave-result-count" class="leave-result-count" role="status" aria-live="polite"></span></div>
 <div class="manage-leave-filters leave-record-filters">
  <div class="field leave-record-search"><label for="manage-leave-search">Search staff or leave</label><input type="search" class="filter" id="manage-leave-search" placeholder="Name, ID, machine PIN or reason"></div>
  <div class="field"><label for="manage-leave-type">Leave type</label><select class="filter" id="manage-leave-type"><option value="all">All leave types</option></select></div>
  <div class="field"><label for="leave-filter">Status</label><select class="filter" id="leave-filter"><option value="all">All statuses</option><option>Pending</option><option>Approved</option><option>Completed</option><option>Declined</option></select></div>
  <button type="button" class="btn" id="leave-filter-clear">Clear filters</button>
 </div>
 <div class="table-wrap"><table class="leave-record-table"><thead><tr><th scope="col">Employee</th><th scope="col">Leave details</th><th scope="col">Leave period</th><th scope="col">Days</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody id="leave-table"></tbody></table></div>
</div>`;
const replaceOnce=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Expected one match: '+from.slice(0,100));return source.replace(from,to);};
export function updateLeaveRecordDesign(dir){
 const pageFile=path.join(dir,'app/page.tsx'),appFile=path.join(dir,'public/app.js'),cssFile=path.join(dir,'app/modern.css');let page=fs.readFileSync(pageFile,'utf8'),app=fs.readFileSync(appFile,'utf8'),css=fs.readFileSync(cssFile,'utf8');
 if(!page.includes('const staffOnLeaveRecordsMarkup =')){
 page=replaceOnce(page,'const leaveWorkspaceMarkup =', 'const staffOnLeaveRecordsMarkup = '+JSON.stringify(recordsMarkup)+';\n\nconst leaveWorkspaceMarkup =');
 page=replaceOnce(page,'const appliedRecords=records.slice(0,balanceStart),balances=records.slice(balanceStart);','const appliedRecords=staffOnLeaveRecordsMarkup,balances=records.slice(balanceStart);');
 page=page.replace(/script\.src = "(\/app\.js\?v=[^"]+)";/,'script.src = "$1-leave-record-design-40";');
 }
 if(!app.includes('function leaveRecordRowMarkup(')){
 const helpers=[leaveRecordDate,leaveRecordRange,leaveRecordDatesMarkup,leaveRecordRowMarkup].map(fn=>fn.toString()).join('\n\n');
 app=replaceOnce(app,'function render() {',helpers+'\n\nfunction render() {');
 const rowLine=app.split('\n').find(line=>line.includes("document.getElementById('leave-table').innerHTML="));if(!rowLine)throw Error('Missing leave table renderer');
 app=replaceOnce(app,rowLine,`  document.getElementById('leave-table').innerHTML=leaves.length?leaves.map(leaveRecordRowMarkup).join(''):\`<tr><td colspan="6" class="empty">\${db.leaves.length?'No leave records match your search and filters.':'No leave records yet.'}</td></tr>\`;
  document.getElementById('leave-result-count').textContent=leaves.length+' of '+groupLeaves.length+' '+(groupLeaves.length===1?'record':'records');`);
 app=app.replace('>records</span>`;','>\${groupLeaves.length===1?\'record\':\'records\'}</span>`;');
 app=replaceOnce(app,"document.getElementById('manage-leave-search').addEventListener('input',render);", "document.getElementById('manage-leave-search').addEventListener('input',render);\ndocument.getElementById('leave-filter-clear').addEventListener('click',()=>{document.getElementById('manage-leave-search').value='';document.getElementById('manage-leave-type').value='all';document.getElementById('leave-filter').value='all';render();});");
 }
 if(!css.includes('/* Staff on Leave: readable records */'))css+='\n'+fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'leave-record-design.css'),'utf8');
 const countLine=app.split('\n').find(line=>line.includes("document.getElementById('leave-used').innerHTML=groupLeaves.length"));if(countLine)app=replaceOnce(app,countLine,"  document.getElementById('leave-used').textContent=groupLeaves.length;");
 fs.writeFileSync(pageFile,page);fs.writeFileSync(appFile,app);fs.writeFileSync(cssFile,css);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))updateLeaveRecordDesign(process.argv[2]||process.cwd());

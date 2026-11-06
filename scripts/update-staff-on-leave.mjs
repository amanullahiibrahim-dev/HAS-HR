import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const replaceOnce=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Expected one match: '+from.slice(0,100));return source.replace(from,to);};
export function updateStaffOnLeave(dir){
 const pageFile=path.join(dir,'app/page.tsx'),appFile=path.join(dir,'public/app.js'),cssFile=path.join(dir,'app/globals.css');
 let page=fs.readFileSync(pageFile,'utf8'),app=fs.readFileSync(appFile,'utf8'),css=fs.readFileSync(cssFile,'utf8');
 if(!page.includes('id="page-staff-on-leave"')){
 page=replaceOnce(page,'data-page="manage">Manage Leave</button>','data-page="manage">Manage Leave</button><button type="button" data-page="staff-on-leave">Staff on Leave</button>');
 page=replaceOnce(page,'      const header=(sick:boolean)=>',`      const balanceStart=records.indexOf('<div class="balance-heading">');
      const appliedRecords=records.slice(0,balanceStart),balances=records.slice(balanceStart);
      const header=(sick:boolean)=>`);
 page=replaceOnce(page,'${leaveWorkspaceMarkup}<div id="leave-records">${records}</div>','${leaveWorkspaceMarkup}');
 page=replaceOnce(page,'Manage already applied leave, including annual and sick leave. Search a record to edit dates, details or attachments and review its change history.','Update applied leave and manage employee balances. Choose Edit on Staff on Leave to change a record.');
 page=replaceOnce(page,'<h1>Manage Leave</h1><p>Update applied leave and manage employee balances. Choose Edit on Staff on Leave to change a record.</p></div></div><div id="manage-host"></div></section>',`<h1>Manage Leave</h1><p>Update applied leave and manage employee balances. Choose Edit on Staff on Leave to change a record.</p></div><button type="button" class="btn" onclick="go('staff-on-leave')">Staff on Leave →</button></div><div id="manage-host"></div>\${balances}</section><section class="page" id="page-staff-on-leave"><div class="section-title"><div><h1>Staff on Leave</h1><p>Applied leave records across all leave types.</p></div></div><div id="leave-records">\${appliedRecords}</div></section>`);
 page=page.replace(/script\.src = "(\/app\.js\?v=[^"]+)";/,'script.src = "$1-staff-on-leave-39";');
 }
 if(!app.includes("page==='staff-on-leave'")){
 app=replaceOnce(app,"document.getElementById('leave-workspace').hidden=managing&&!editingLeaveId;","document.getElementById('leave-workspace').hidden=leaveView==='staff-on-leave'||(managing&&!editingLeaveId);");
 app=replaceOnce(app,"  document.getElementById('leave-records').hidden=!managing;\n",'');
 app=replaceOnce(app,"const groupLeaves=db.leaves.filter(l=>leaveView==='manage'||isSickLeave(l.type)===(leaveView==='sick'));","const groupLeaves=db.leaves;");
 app=replaceOnce(app,"${(leaveView==='manage'||['Approved','Pending'].includes(l.status))?",'${true?');
 app=replaceOnce(app,"${leaveView==='manage'?`<button type=\"button\" class=\"text-btn leave-delete-action\"",'${true?`<button type="button" class="text-btn leave-delete-action"');
 app=replaceOnce(app,"document.getElementById('leave-used').closest('.card').querySelector('.card-head').textContent=leaveView==='manage'?'Applied leave records':leaveView==='sick'?'Sick leave used / reserved':'Annual leave used / reserved';","document.getElementById('leave-used').closest('.card').querySelector('.card-head').textContent='Applied leave records';");
 app=replaceOnce(app,"document.getElementById('leave-used').innerHTML=(leaveView==='manage'?groupLeaves.length:leaveView==='sick'?usedDaysForType('Sick with MC')+usedDaysForType('Sick without MC'):usedDaysForType('Annual'))+` <span style=\"font-size:12px;color:#88928a;font-weight:500\">${leaveView==='manage'?'records':'days'}</span>`;", "document.getElementById('leave-used').innerHTML=groupLeaves.length+` <span style=\"font-size:12px;color:#88928a;font-weight:500\">records</span>`;");
 app=replaceOnce(app,"if(page==='leaves'||page==='sick'||page==='manage'){","if(page==='leaves'||page==='sick'||page==='manage'||page==='staff-on-leave'){");
 app=replaceOnce(app,"    document.getElementById(page==='manage'?'manage-host':page==='sick'?'sick-host':'leave-host').appendChild(document.getElementById('leave-shared'));","    if(page!=='staff-on-leave')document.getElementById(page==='manage'?'manage-host':page==='sick'?'sick-host':'leave-host').appendChild(document.getElementById('leave-shared'));");
 app=replaceOnce(app,"['leaves','sick','manage'].includes(page)","['leaves','sick','manage','staff-on-leave'].includes(page)");
 app=replaceOnce(app,"page==='manage'?'Staff Leave / Manage Leave':","page==='staff-on-leave'?'Staff Leave / Staff on Leave':page==='manage'?'Staff Leave / Manage Leave':");
 }
 if(!css.includes('/* Staff on Leave records page */'))css+='\n/* Staff on Leave records page */\n#page-staff-on-leave .panel-head{flex-wrap:wrap;gap:14px}\n';
 app=app.replace(/\$\{true\?`([^`]+)`:''\}/g,'$1');
 fs.writeFileSync(pageFile,page);fs.writeFileSync(appFile,app);fs.writeFileSync(cssFile,css);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))updateStaffOnLeave(process.argv[2]||process.cwd());

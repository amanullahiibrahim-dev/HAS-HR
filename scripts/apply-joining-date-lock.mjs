import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const replaceOnce=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Expected one match: '+from.slice(0,110));return source.replace(from,to);};
function syncJoiningDateEditor(lockOverride){
  const field=document.getElementById('balance-joined');if(!field)return;
  const person=db.people.find(person=>person.id===field.dataset.employeeId);if(!person)return;
  const lock=lockOverride||person.joiningDateLock;
  field.disabled=!!lock?.locked;
  if(lock?.locked)field.value=person.joinedOn||'';
  const message=document.getElementById('balance-joining-lock');
  if(message){message.hidden=!lock?.locked;message.textContent=lock?.message||'';}
}
export function applyJoiningDateLock(dir){
 const files={period:path.join(dir,'lib/period-balances.ts'),store:path.join(dir,'lib/store.ts'),app:path.join(dir,'public/app.js'),page:path.join(dir,'app/page.tsx'),css:path.join(dir,'app/modern.css')};
 let period=fs.readFileSync(files.period,'utf8'),store=fs.readFileSync(files.store,'utf8'),app=fs.readFileSync(files.app,'utf8'),page=fs.readFileSync(files.page,'utf8'),css=fs.readFileSync(files.css,'utf8');
 if(!period.includes('assertJoiningDateChangeAllowed')){
 period='import { assertJoiningDateChangeAllowed, joiningDateLock, joiningDateBusinessDate } from "./joining-date-lock";\n'+period;
 period=replaceOnce(period,'export function previewPeriodBalances(store:Store,id:unknown,input:Record<string,unknown>){','export function previewPeriodBalances(store:Store,id:unknown,input:Record<string,unknown>,at=new Date().toISOString()){');
 period=replaceOnce(period,'const draft=periodBalanceDraft(existing,input),person=draft.person;','const draft=periodBalanceDraft(existing,input),person=draft.person;\n  assertJoiningDateChangeAllowed(store,existing,person.joinedOn||"",at);');
 period=replaceOnce(period,'return {asOf:draft.asOf,joinedOn:person.joinedOn,','return {joiningDateLock:joiningDateLock(store,existing.id,joiningDateBusinessDate(at)),asOf:draft.asOf,joinedOn:person.joinedOn,');
 period=period.replaceAll('previewPeriodBalances(store,id,input)','previewPeriodBalances(store,id,input,at)');
 }
 if(!store.includes('from "./joining-date-lock"')){
 store='import { joiningDateLock } from "./joining-date-lock";\n'+store;
 store=replaceOnce(store,'({ ...person, workStart: requiredArrival(person.role),','({ ...person, joiningDateLock:joiningDateLock(store,person.id), workStart: requiredArrival(person.role),');
 }
 if(!app.includes('function syncJoiningDateEditor(')){
 app=replaceOnce(app,'function editBalance(id){',syncJoiningDateEditor.toString()+'\nfunction editBalance(id){');
 app=replaceOnce(app,'<input id="balance-joined" type="date" required value="${esc(person.joinedOn||\'\')}">','<input id="balance-joined" data-employee-id="${esc(id)}" aria-describedby="balance-joining-lock" type="date" required value="${esc(person.joinedOn||\'\')}">');
 app=replaceOnce(app,'<p id="balance-editor-message" role="status"></p>','<p id="balance-joining-lock" role="status" hidden></p><p id="balance-editor-message" role="status"></p>');
 const markupLine=app.split('\n').find(line=>line.includes('id="balance-joined"')&&line.includes('innerHTML='));if(!markupLine)throw Error('Missing joining-date editor markup');
 app=replaceOnce(app,markupLine,markupLine+'\n  syncJoiningDateEditor();');
 app=replaceOnce(app,'preview=next;const needsSetup=next.rows.some(row=>!row.period.start);','syncJoiningDateEditor(next.joiningDateLock);preview=next;const needsSetup=next.rows.some(row=>!row.period.start);');
 app=replaceOnce(app,'renderAttendance(); renderPeople(); renderDevice(); refreshLeaveStaff(); renderAttendanceReport();','renderAttendance(); renderPeople(); renderDevice(); refreshLeaveStaff(); renderAttendanceReport(); syncJoiningDateEditor();');
 page=page.replace(/script\.src = "(\/app\.js\?v=[^"]+)";/,'script.src = "$1-joining-date-lock-55";');
 }
 if(!css.includes('/* Joining date leave lock */'))css+='\n/* Joining date leave lock */\n#balance-joining-lock{margin:8px 0 14px;padding:10px 12px;border-radius:8px;background:#fff7e4;color:#785517;font-size:12px;line-height:1.5}\n#balance-joining-lock[hidden]{display:none!important}\n';
 for(const[key,source]of Object.entries({period,store,app,page,css}))fs.writeFileSync(files[key],source);
 const helper=fs.readFileSync(fileURLToPath(new URL('../lib/joining-date-lock.ts',import.meta.url)),'utf8');fs.writeFileSync(path.join(dir,'lib/joining-date-lock.ts'),helper);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))applyJoiningDateLock(process.argv[2]||process.cwd());

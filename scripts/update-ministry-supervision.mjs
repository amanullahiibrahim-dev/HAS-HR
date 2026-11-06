import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const replaceOnce=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Expected one match: '+from.slice(0,110));return source.replace(from,to);};
export function updateMinistrySupervision(dir){
 const pageFile=path.join(dir,'app/page.tsx'),appFile=path.join(dir,'public/app.js'),modelFile=path.join(dir,'lib/supervision.ts');
 let page=fs.readFileSync(pageFile,'utf8'),app=fs.readFileSync(appFile,'utf8'),model=fs.readFileSync(modelFile,'utf8');
 if(page.includes('id="appraisal-export"')){
 page=replaceOnce(page,'<button type="button" id="appraisal-export" class="btn">Export CSV</button>','');
 page=page.replace(/script\.src = "(\/app\.js\?v=[^"]+)";/,'script.src = "$1-ministry-supervision-53";');
 }
 if(app.includes("document.getElementById('appraisal-export')")){
 app=replaceOnce(app,"document.getElementById('appraisal-export').disabled=!state.rows.length;",'');
 app=replaceOnce(app,"document.getElementById('appraisal-export').addEventListener('click',exportAppraisal);",'');
 }
 if(app.includes("person.role==='Principal'?{kind:'minister'}:null")){
 app=replaceOnce(app,"&&(person.role!=='Principal'||record.supervisor.kind==='minister')",'');
 app=replaceOnce(app,"supervisor:person.role==='Principal'?{kind:'minister'}:null,from,to,fixed:person.role==='Principal'","supervisor:null,from,to,fixed:false");
 app=replaceOnce(app,"(supervisor?.kind==='minister'?person.role==='Principal':person.role!=='Principal'&&person.id!==supervisor?.id)","(supervisor?.kind!=='staff'||person.id!==supervisor.id)");
 const guardLine=app.split('\n').find(line=>line.includes('if(supervisorEditor.id){const record=')&&line.includes("person.role==='Principal'"));
 if(!guardLine)throw Error('Missing supervisor edit guard');
 app=replaceOnce(app,guardLine,"  if(supervisorEditor.id){const record=(db.supervisorAssignments||[]).find(item=>item.id===supervisorEditor.id);if(record&&supervisor.kind==='staff'&&supervisor.id===record.employeeId){searchAssignmentSupervisor();return toast('A staff member cannot supervise themselves.');}}");
 app=replaceOnce(app,"else if(employeeId){const person=db.people.find(person=>person.id===employeeId);if(person?.role==='Principal')selectAssignmentSupervisor('minister');supervisorEditor.selected.add(employeeId);}","else if(employeeId)supervisorEditor.selected.add(employeeId);");
 }
 app=app.replaceAll('Minister of Education','Ministry of Education');
 app=app.replace("{key:'minister',name:'Ministry of Education',detail:'Principal'}","{key:'minister',name:'Ministry of Education',detail:''}");
 app=app.replace('<small>${esc(option.detail)}</small>','${option.detail?`<small>${esc(option.detail)}</small>`:\'\'}');
 model=model.replace(/^    if\(person\.role===\"Principal\"&&supervisor\.kind!==\"minister\"\)[^\n]*\r?\n/m,'').replace(/^    if\(person\.role!==\"Principal\"&&supervisor\.kind===\"minister\"\)[^\n]*\r?\n/m,'');
 fs.writeFileSync(pageFile,page);fs.writeFileSync(appFile,app);fs.writeFileSync(modelFile,model);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))updateMinistrySupervision(process.argv[2]||process.cwd());

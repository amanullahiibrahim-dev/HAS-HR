import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const replaceOnce=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Expected one match: '+from.slice(0,120));return source.replace(from,to);};
export function simplifySupervisorForm(dir){
 const pageFile=path.join(dir,'app/page.tsx'),appFile=path.join(dir,'public/app.js'),modelFile=path.join(dir,'lib/supervision.ts');
 let page=fs.readFileSync(pageFile,'utf8'),app=fs.readFileSync(appFile,'utf8'),model=fs.readFileSync(modelFile,'utf8');
 if(page.includes('id="assignment-from"')){
 page=page.replace(/      <div class="supervisor-date-fields">[^\n]*\r?\n/,'');
 page=replaceOnce(page,'<div class="field supervisor-reason-field"><label for="assignment-reason">Assignment / change reason</label><input id="assignment-reason" maxlength="1000" required></div>','');
 page=page.replace(/script\.src = "(\/app\.js\?v=[^"]+)";/,'script.src = "$1-simple-supervision-54";');
 }
 if(app.includes("getElementById('assignment-from')")){
 app=replaceOnce(app,"document.getElementById('assignment-from').value=appraisalToday();document.getElementById('assignment-from').max=appraisalToday();",'');
 app=replaceOnce(app,"document.getElementById('assignment-from').value=record.from;document.getElementById('assignment-to').value=record.to||'';",'');
 const dateListener=app.split('\n').find(line=>line.includes("document.getElementById('assignment-from').addEventListener('change'"));if(!dateListener)throw Error('Missing date listener');app=replaceOnce(app,dateListener+'\n','');
 app=replaceOnce(app,",from:val('assignment-from'),to:val('assignment-to')",'');
 app=replaceOnce(app,",reason:val('assignment-reason')",'');
 }
 if(!model.includes('const from=value.from===undefined?')){
 model=replaceOnce(model,'  if(typeof value.from!=="string"||!validLeaveDate(value.from)||value.from>today)',`  // The simplified form omits dates; edits retain their recorded period.
  const from=value.from===undefined?(existing?.from||today):value.from;
  const to=value.to===undefined?existing?.to:value.to;
  if(typeof from!=="string"||!validLeaveDate(from)||from>today)`);
 model=replaceOnce(model,'if(value.to!==undefined&&value.to!==""&&(typeof value.to!=="string"||!validLeaveDate(value.to)||value.to<value.from))','if(to!==undefined&&to!==""&&(typeof to!=="string"||!validLeaveDate(to)||to<from))');
 model=replaceOnce(model,'const changeReason=typeof reason==="string"?reason.trim():"";','const changeReason=reason===undefined?(existing?"Supervisor assignment updated.":"Supervisor assigned."):typeof reason==="string"?reason.trim():"";');
 model=replaceOnce(model,'from:value.from as string,to:typeof value.to==="string"&&value.to?value.to:undefined','from,to:typeof to==="string"&&to?to:undefined');
 model=replaceOnce(model,'Supervision dates overlap an existing assignment. End or edit that assignment first.','This staff member already has a supervisor for this period. Edit the existing assignment first.');
 }
 fs.writeFileSync(pageFile,page);fs.writeFileSync(appFile,app);fs.writeFileSync(modelFile,model);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))simplifySupervisorForm(process.argv[2]||process.cwd());

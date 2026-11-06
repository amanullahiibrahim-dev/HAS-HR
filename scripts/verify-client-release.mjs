import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export function verifyClientScripts(report,app){
  new vm.Script(report,{filename:'report-downloads.js'});new vm.Script(app,{filename:'app.js'});new vm.Script(report+'\n'+app,{filename:'combined-client.js'});
  const ast=ts.createSourceFile('report-downloads.js',report,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),names=new Set();
  for(const statement of ast.statements)if(ts.isFunctionDeclaration(statement)&&statement.name){const name=statement.name.text;if(names.has(name))throw Error('Duplicate report function: '+name);names.add(name);}
  if((report.match(/let\s+reportDownloadBusy\s*=/g)||[]).length!==1)throw Error('Report download state must be declared exactly once.');
}
export function verifyHtmlIds(html){
  const counts=new Map();for(const match of html.matchAll(/\bid="([^"]+)"/g))counts.set(match[1],(counts.get(match[1])||0)+1);
  const duplicates=[...counts].filter(([,count])=>count>1).map(([id])=>id);
  if(duplicates.length)throw Error('Duplicate page controls: '+duplicates.join(', '));
  for(const id of ['att-pdf','att-docx','appraisal-pdf','appraisal-docx'])if(counts.get(id)!==1)throw Error('Missing download control: '+id);
}
async function main(){
  const dir=process.argv[2]||process.cwd(),base=process.argv[3];
  verifyClientScripts(fs.readFileSync(path.join(dir,'public','report-downloads.js'),'utf8'),fs.readFileSync(path.join(dir,'public','app.js'),'utf8'));
  if(base){const html=await (await fetch(base)).text();verifyHtmlIds(html);const report=await (await fetch(new URL('/report-downloads.js?v=shared-downloads-1',base))).text(),app=await (await fetch(new URL('/app.js?v=startup-fix-35',base))).text();verifyClientScripts(report,app);}
  console.log('Client startup checks passed: scripts parse together, report declarations are unique'+(base?', page controls are unique.':'.'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main().catch(error=>{console.error(error.message);process.exitCode=1;});

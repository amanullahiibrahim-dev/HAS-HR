import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {validateReport,reportColumnGroups,exportReport} from '../lib/report-export.mjs';
const require=createRequire(import.meta.url);
const report={title:'Attendance Report',caption:'1 to 3 November 2026 | One selected employee',columns:['Employee ID','Employee','Date','Status'],rows:[['00042','Aminá & Hassan','2026-11-03','Present']],filename:'attendance-2026-11-03'};

test('report validation preserves IDs and text and rejects malformed or excessive exports',()=>{
  assert.equal(validateReport(report).rows[0][0],'00042');
  for(const change of [{columns:[]},{rows:[['wrong width']]},{rows:[[{html:'bad'},'x','x','x']]},{rows:Array.from({length:20001},()=>report.rows[0])},{title:'x'.repeat(121)}])assert.throws(()=>validateReport({...report,...change}));
  assert.equal(validateReport({...report,filename:'../../unsafe name\r\n'}).filename,'unsafe-name');
});
test('wide reports repeat identity columns while preserving every data column',()=>{
  const columns=Array.from({length:19},(_,i)=>'Column '+i),groups=reportColumnGroups(columns);
  assert.ok(groups.every(g=>g.length<=10));assert.ok(groups.every(g=>g[0]===0&&g[1]===1));
  assert.deepEqual([...new Set(groups.flat())].sort((a,b)=>a-b),columns.map((_,i)=>i));
});
test('PDF and Word are real binary documents with correct extensions and MIME types',async()=>{
  const pdf=await exportReport(report,'pdf'),word=await exportReport(report,'docx');
  assert.equal(Buffer.from(pdf.bytes).subarray(0,4).toString(),'%PDF');assert.equal(pdf.contentType,'application/pdf');assert.equal(pdf.filename,'attendance-2026-11-03.pdf');
  assert.equal(Buffer.from(word.bytes).subarray(0,2).toString(),'PK');assert.equal(word.contentType,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.equal(word.filename,'attendance-2026-11-03.docx');
  await assert.rejects(exportReport(report,'html'));
});
function routeHarness(){
  let admin=true,origin=true;
  const ts=require('typescript'),exports={};
  const source=ts.transpileModule(fs.readFileSync('app/api/reports/export/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const modules={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/auth':{isSignedIn:()=>admin,isSameOrigin:()=>origin},'@/lib/report-export.mjs':{MAX_REPORT_BYTES:100,ReportInputError:Error,exportReport:async()=>({bytes:new Uint8Array([37,80,68,70]),filename:'report.pdf',contentType:'application/pdf'})}};
  vm.runInNewContext(source,{exports,require:name=>modules[name],Buffer,URL,Response,Uint8Array,console});
  return{send:(body,format='pdf')=>exports.POST(new Request('http://127.0.0.1/api/reports/export?format='+format,{method:'POST',body})),deny:()=>admin=false,foreign:()=>origin=false};
}
test('document endpoint requires sign-in and same-origin requests and bounds the body',async()=>{
  let h=routeHarness();h.deny();assert.equal((await h.send('{}')).status,401);
  h=routeHarness();h.foreign();assert.equal((await h.send('{}')).status,403);
  h=routeHarness();assert.equal((await h.send('{bad')).status,400);assert.equal((await h.send('{}','html')).status,400);assert.equal((await h.send('x'.repeat(101))).status,413);
  const response=await h.send('{}');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('cache-control'),'private, no-store');
});

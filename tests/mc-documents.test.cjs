const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const privateDir=fs.mkdtempSync(path.join(os.tmpdir(),'haazir-mc-tests-'));process.env.HAAZIR_MC_DIRECTORY=privateDir;
const created=[];after(()=>{for(const file of created)if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(privateDir);});
function loader(mocks={}){const cache={};return function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>mocks[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL,Uint8Array,Promise});return exports;};}
const lib=loader()('lib/mc-documents');
test('PDF, JPG and PNG signatures are accepted and mismatched extensions or active content are rejected',()=>{
  assert.equal(lib.validateMcFile('MC.pdf','application/pdf',Buffer.from('%PDF-1.7\ncertificate')).mimeType,'application/pdf');
  assert.equal(lib.validateMcFile('MC.JPG','image/jpeg',Buffer.from([255,216,255,224])).mimeType,'image/jpeg');
  assert.equal(lib.validateMcFile('MC.png','image/png',Buffer.from([137,80,78,71,13,10,26,10])).mimeType,'image/png');
  assert.throws(()=>lib.validateMcFile('fake.pdf','application/pdf',Buffer.from('<html>not a PDF</html>')));
  assert.throws(()=>lib.validateMcFile('script.html','application/pdf',Buffer.from('%PDF-1.7')));
  assert.throws(()=>lib.validateMcFile('MC.pdf','application/pdf',Buffer.alloc(0)));
  assert.throws(()=>lib.validateMcFile('MC.pdf','application/pdf',Buffer.alloc(lib.maxMcBytes+1)));
});
test('documents are bound to staff and cannot attach to leave without MC',()=>{
  const store={mcDocuments:[{id:'DOC',employeeId:'A'}]};assert.equal(lib.attachMcDocument(store,'A','Sick with MC','DOC').id,'DOC');
  assert.throws(()=>lib.attachMcDocument(store,'B','Sick with MC','DOC'));
  assert.equal(lib.attachMcDocument(store,'A','Sick without MC','DOC'),undefined);
  assert.equal(lib.attachMcDocument(store,'A','Sick with MC',undefined,'DOC').id,'DOC');
  assert.throws(()=>lib.mcFilePath('../../secrets'));assert.throws(()=>lib.mcFilePath('filename.pdf'));
});
function harness(){let authenticated=true,sameOrigin=true;const store={people:[{id:'A'}],mcDocuments:[]};
  const mock={'next/server':{NextResponse:{json:(v,o)=>new Response(JSON.stringify(v),{status:o?.status||200})}},'@/lib/auth':{isAdmin:()=>authenticated,isSameOrigin:()=>sameOrigin},'@/lib/store':{readStore:()=>store,writeStore:()=>{},makeId:()=>{const id=crypto.randomUUID();created.push(lib.mcFilePath(id));return id;}}};
  const load=loader(mock),upload=load('app/api/mc-documents/route'),download=load('app/api/mc-documents/[id]/route');
  return {store,upload:upload.POST,download:download.GET,deny:()=>{authenticated=false;},crossOrigin:()=>{sameOrigin=false;}};
}
function request(name='MC.pdf',content='%PDF-1.7\ncertificate',type='application/pdf',employeeId='A'){
  const form=new FormData();form.append('employeeId',employeeId);form.append('file',new Blob([content],{type}),name);return new Request('http://127.0.0.1/api/mc-documents',{method:'POST',body:form});
}
test('upload persists a private file and an authenticated download returns it as an attachment',async()=>{
  const h=harness();const response=await h.upload(request());assert.equal(response.status,201);const {document}=await response.json();assert.equal(document.employeeId,'A');assert.equal(document.uploadedBy,'Administrator');assert.equal(h.store.mcDocuments.length,1);assert.ok(fs.existsSync(lib.mcFilePath(document.id)));
  const result=await h.download(new Request('http://127.0.0.1/'),{params:Promise.resolve({id:document.id})});assert.equal(result.status,200);assert.ok(result.headers.get('content-disposition').startsWith('attachment;'));assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(await result.text(),'%PDF-1.7\ncertificate');
  h.deny();assert.equal((await h.download(new Request('http://127.0.0.1/'),{params:Promise.resolve({id:document.id})})).status,401);
});
test('upload rejects unsigned, cross-origin, missing-staff and invalid-file requests',async()=>{
  const a=harness();a.deny();assert.equal((await a.upload(request())).status,401);
  const b=harness();b.crossOrigin();assert.equal((await b.upload(request())).status,403);
  const c=harness();assert.equal((await c.upload(request('MC.pdf','<script>bad</script>'))).status,400);assert.equal(c.store.mcDocuments.length,0);
  const d=harness();assert.equal((await d.upload(request('MC.pdf','%PDF-1.7','application/pdf','missing'))).status,404);
});
test('the multipart body is bounded before parsing',async()=>{
  const h=harness();const result=await h.upload(new Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=abc'},body:Buffer.alloc(lib.maxMcBytes+65537)}));assert.equal(result.status,413);assert.equal(h.store.mcDocuments.length,0);
});
test('replacement uploads keep old files available for the leave audit history',async()=>{
  const h=harness();const first=(await (await h.upload(request('first.pdf'))).json()).document;const next=(await (await h.upload(request('next.pdf'))).json()).document;assert.notEqual(first.id,next.id);assert.equal(h.store.mcDocuments.length,2);assert.ok(fs.existsSync(lib.mcFilePath(first.id)));assert.ok(fs.existsSync(lib.mcFilePath(next.id)));
});
test('medical controls render as exactly one file input and are visible only for Sick with MC',()=>{
  const exports={},jsx=(type,props)=>({type,props});const src=ts.transpileModule(fs.readFileSync('app/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(src,{exports,require:n=>n==='react'?{useEffect(){},useRef:()=>({current:false})}:{jsx,jsxs:jsx,Fragment:'Fragment'}});
  const html=exports.default().props.children.find(c=>c.props.id==='app-container').props.dangerouslySetInnerHTML.__html;
  const mc=html.slice(html.indexOf('id="medical-fields"'),html.indexOf('id="circumcision-fields"'));
  assert.equal((mc.match(/<input/g)||[]).length,1);assert.ok(mc.includes('id="lp-mc-file" type="file"'));assert.ok(!mc.includes('<textarea'));assert.ok(!html.includes('lp-doc-issuer'));assert.ok(!html.includes('lp-doc-verified'));
  const elements={};const el=id=>elements[id]||=(id==='lp-trip-basis'?{options:[{value:'First paid Hajj'}],value:'Annual'}:{hidden:false,innerHTML:''});
  const values={'lp-type':'Sick with MC','lp-trip-basis':'Annual'};const c={document:{getElementById:el,querySelectorAll:()=>[]},db:{leaves:[]},editingLeaveId:null,val:id=>values[id]||'',esc:String};vm.createContext(c);
  const code=fs.readFileSync('public/app.js','utf8');vm.runInContext(code.slice(code.indexOf('function leaveRequirementsUI()'),code.indexOf('async function previewLeavePlan()')),c);
  c.leaveRequirementsUI();assert.equal(el('medical-fields').hidden,false);values['lp-type']='Sick without MC';c.leaveRequirementsUI();assert.equal(el('medical-fields').hidden,true);values['lp-type']='Annual';c.leaveRequirementsUI();assert.equal(el('medical-fields').hidden,true);
});

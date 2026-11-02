const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path'),os=require('node:os');
const temporary=[];after(()=>{for(const dir of temporary){const docs=path.join(dir,'mc-documents');if(fs.existsSync(docs)){for(const name of fs.readdirSync(docs))fs.unlinkSync(path.join(docs,name));fs.rmdirSync(docs);}fs.rmdirSync(dir);}});
function harness(){
 let writes=0,authenticated=true,sameOrigin=true;const directory=fs.mkdtempSync(path.join(os.tmpdir(),'haazir-permanent-removal-'));temporary.push(directory);const docs=path.join(directory,'mc-documents');fs.mkdirSync(docs);
 const cache={},store={people:[{id:'A',name:'Deleted Person',role:'Teacher',devicePin:'01',annual:30,medical:0,casual:0,workStart:'07:00'}],leaves:[{id:'L',employeeId:'A',name:'Deleted Person',type:'Annual',start:'2026-10-20',end:'2026-10-21',days:1,status:'Completed',returnedAt:'2026-10-21 07:00:00',usedDays:1}],punches:[{id:'P',pin:'01',timestamp:'2026-10-29 06:45:00',serial:'TEST',state:0,kind:'attendance-in',verify:'1',workCode:''}],mcDocuments:[],corrections:[],leaveChanges:[],device:{lastSeen:null,serial:null,count:1}};
 const mock={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/auth':{isAdmin:()=>authenticated,isSameOrigin:()=>sameOrigin}};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mock[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process:{env:{...process.env,HAAZIR_DB_PATH:path.join(directory,'db.json'),HAAZIR_MC_DIRECTORY:docs}},Buffer,Response,URL,Intl});return exports;}
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{writes++;},makeId:()=> 'test-id'};const route=load('app/api/state/route');
 return {store,docs,load,writes:()=>writes,deny:()=>{authenticated=false;},crossOrigin:()=>{sameOrigin=false;},send:payload=>route.POST(new Request('http://127.0.0.1/api/state',{method:'POST',body:JSON.stringify(payload)}))};
}
test('permanent removal deletes the profile, attendance, leave and audit history while preserving another employee',async()=>{
 const h=harness(),other={...h.store.people[0],id:'B',name:'Kept Person',devicePin:'02'};h.store.people.push(other);const kept={...h.store.leaves[0],id:'KEEP',employeeId:'B',name:'Kept Person'};h.store.leaves.push(kept);h.store.punches.push({...h.store.punches[0],id:'P2',pin:'02'});
 h.store.corrections=[{employeeId:'A'}];h.store.leaveChanges=[{leaveId:'L',before:{employeeId:'A'},after:{employeeId:'A'}}];const response=await h.send({action:'employee.remove',id:'A'});assert.equal(response.status,200);const state=await response.json();assert.deepEqual(h.store.people,[other]);assert.deepEqual(h.store.leaves,[kept]);assert.equal(h.store.punches.length,1);assert.equal(h.store.punches[0].pin,'02');assert.equal(h.store.corrections.length,0);assert.equal(h.store.leaveChanges.length,0);assert.equal(state.removedPeople,undefined);assert.equal(state.attendance.some(row=>row.employeeId==='A'),false);assert.equal(h.store.device.count,1);assert.equal(JSON.stringify(h.store).includes('Deleted Person'),false);assert.equal(h.writes(),1);
});
test('uploaded employee files are deleted and unrelated files remain untouched',async()=>{
 const h=harness(),owned='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';h.store.mcDocuments=[{id:owned,employeeId:'A',name:'owned.pdf'},{id:other,employeeId:'B',name:'other.pdf'}];fs.writeFileSync(path.join(h.docs,owned+'.bin'),'fixture');fs.writeFileSync(path.join(h.docs,other+'.bin'),'keep');
 const response=await h.send({action:'employee.remove',id:'A'});assert.equal(response.status,200);assert.equal(fs.existsSync(path.join(h.docs,owned+'.bin')),false);assert.equal(fs.readFileSync(path.join(h.docs,other+'.bin'),'utf8'),'keep');assert.equal(h.store.mcDocuments.length,1);assert.equal(h.store.pendingEmployeeFileDeletes.length,0);
});
test('deleted employees cannot be restored, and repeated or invalid deletion requests do not write',async()=>{
 const h=harness();assert.equal((await h.send({action:'employee.remove'})).status,400);assert.equal((await h.send({action:'employee.remove',id:'missing'})).status,404);assert.equal(h.writes(),0);await h.send({action:'employee.remove',id:'A'});const writes=h.writes();assert.equal((await h.send({action:'employee.restore',id:'A'})).status,400);assert.equal((await h.send({action:'employee.remove',id:'A'})).status,404);assert.equal(h.writes(),writes);
});
test('permanent deletion requires administrator sign-in and same-origin requests',async()=>{
 for(const crossOrigin of [false,true]){const h=harness();crossOrigin?h.crossOrigin():h.deny();assert.equal((await h.send({action:'employee.remove',id:'A'})).status,crossOrigin?403:401);assert.equal(h.writes(),0);assert.equal(h.store.people.length,1);}
});
test('deleted employees cannot receive leave, and their ID and PIN can start a fresh profile',async()=>{
 const h=harness();await h.send({action:'employee.remove',id:'A'});assert.equal((await h.send({action:'leave.create',leave:{employeeId:'A',type:'Annual',start:'2026-11-01',end:'2026-11-02',days:1,status:'Approved'}})).status,400);const response=await h.send({action:'employee.create',employee:{id:'A',name:'New Person',devicePin:'01',role:'Teacher'}});assert.equal(response.status,200);const state=await response.json();assert.equal(state.people[0].name,'New Person');assert.equal(state.leaves.length,0);assert.equal(state.attendance.length,0);
});
test('device sync cannot re-import deleted PIN history, and a reused PIN imports only new-assignment events',async()=>{
 const h=harness(),old={...h.store.punches[0]};await h.send({action:'employee.remove',id:'A'});const imports=h.load('lib/punches'),later={...old,id:'LATER',timestamp:h.load('lib/employee-removal').deviceLocalTimestamp(Date.now()+60000)};assert.equal(imports.ingestPunches(h.store,[old,later]).ignored,2);assert.equal(h.store.punches.length,0);
 await h.send({action:'employee.create',employee:{id:'NEW',name:'New Person',devicePin:'01',role:'Teacher'}});const result=imports.ingestPunches(h.store,[old,later]);assert.equal(result.ignored,1);assert.equal(result.inserted,1);assert.equal(result.received,result.inserted+result.duplicates+result.ignored);assert.equal(h.store.punches[0].id,'LATER');
});
test('unconverted legacy removed records are excluded from every client collection',()=>{
 const h=harness();h.store.people[0].removedAt='2026-10-30T12:00:00Z';h.store.leaveChanges=[{before:{employeeId:'A'},after:{employeeId:'A'}}];const state=h.load('lib/store').stateForClient(h.store);assert.equal(state.people.length,0);assert.equal(state.attendance.length,0);assert.equal(state.leaves.length,0);assert.equal(state.leaveChanges.length,0);assert.equal(state.removedPeople,undefined);
});
test('malformed document metadata cannot identify or delete a file outside the MC directory',()=>{
 const h=harness(),file=path.join(h.docs,'keep.bin');fs.writeFileSync(file,'keep');h.store.pendingEmployeeFileDeletes=['../keep','keep'];assert.equal(h.load('lib/employee-removal').flushEmployeeFileDeletes(h.store),0);assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
function directoryHarness(saveResult=true){
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',style:{},classList:{add(){}},textContent:''});return elements.get(id);};const calls=[],source=fs.readFileSync('public/app.js','utf8'),context={db:{people:[{id:'A',name:'Teacher',role:'Teacher',dept:'Science',devicePin:'01',annual:30,medical:0,casual:0}]},document:{getElementById:element},personCell:name=>name,toast(){},closeModal(){},saveAction:async(action,payload)=>{calls.push({action,...payload});return saveResult;}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let db ='))+source.slice(source.indexOf('function renderPeople()'),source.indexOf('function renderDevice()')),context);return{context,element,calls};
}
test('directory has no restore control and warns clearly before irreversible deletion',async()=>{
 const h=directoryHarness();h.context.renderPeople();assert.match(h.element('people-table').innerHTML,/>Remove<\/button>/);assert.doesNotMatch(h.element('people-table').innerHTML,/Restore/);h.context.confirmEmployeeChange('A');assert.equal(h.calls.length,0);assert.match(h.element('modal-body').innerHTML,/cannot be undone/);assert.equal(h.element('modal-save').textContent,'Delete permanently');await h.element('modal-save').onclick();assert.deepEqual(h.calls,[{action:'employee.remove',id:'A'}]);
});
test('failed deletion keeps the confirmation available for retry',async()=>{
 const h=directoryHarness(false);let closed=false;h.context.closeModal=()=>{closed=true;};h.context.confirmEmployeeChange('A');await h.element('modal-save').onclick();assert.equal(closed,false);assert.equal(h.element('modal-save').disabled,false);
});

test('employee creation preserves all staff types and their current arrival schedules', async()=>{
  for(const role of ['Teacher','Admin Staff','Administrator','Technical Staff','Support Staff','Principal','Deputy Principal']){
    const h=harness();
    const response=await h.send({action:'employee.create',employee:{id:'NEW',name:'New staff',devicePin:'99',role}});
    assert.equal(response.status,200,role);
    const state=await response.json();
    const saved=state.people.find(person=>person.id==='NEW');
    assert.equal(saved.role,role);assert.equal(saved.workStart,['Teacher','Technical Staff','Support Staff','Deputy Principal'].includes(role)?'07:00':'08:00');
    assert.equal(h.store.people.find(person=>person.id==='NEW').role,role);
  }
  const h=harness();
  assert.equal((await h.send({action:'employee.create',employee:{id:'NEW',name:'New staff',devicePin:'99',role:'Unknown'}})).status,400);
  assert.equal(h.writes(),0);
  const response=await h.send({action:'employee.create',employee:{id:'NEW',name:'New staff',devicePin:'99'}});
  assert.equal(response.status,200);assert.equal((await response.json()).people.find(person=>person.id==='NEW').role,'Admin Staff');
});

const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 let writes=0;const cache={},store={people:[{id:'A',name:'Test Admin',role:'Admin Staff',devicePin:'01',annual:0,medical:0,casual:0,workStart:'08:00'}],leaves:[],punches:[],holidays:['2026-10-30'],device:{lastSeen:null,serial:null,count:0}};
 const mock={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/auth':{isAdmin:()=>true,isSameOrigin:()=>true}};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mock[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL,Intl});return exports;}
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{writes++;},makeId:()=>String(writes+1)};
 const route=load('app/api/state/route'),preview=load('app/api/leave-preview/route');
 return {store,load,writes:()=>writes,send:body=>route.POST(new Request('http://localhost/api/state',{method:'POST',body:JSON.stringify(body)})),preview:q=>preview.GET(new Request('http://localhost/api/leave-preview?'+new URLSearchParams(q)))};
}
const duty=()=>({lastDate:'2026-10-31',destination:'Male office',purpose:'Official training coordination',approvalReference:'DUTY/2026/1',startTime:'08:00',endTime:'14:00',fullDayRelease:true});
const input=(changes={})=>({employeeId:'A',type:'Duty travel',start:'2026-10-29',end:'2026-10-30',days:1,status:'Approved',duty:duty(),...changes});
test('official duty uses authorized calendar dates, includes weekends and holidays, and has no annual bucket',()=>{
 const h=harness(),p=h.load('lib/leave-policy'),plan=h.load('lib/leave-requirements').resolveLeavePlan(h.store,h.store.people[0],input());
 assert.ok(p.leaveTypes.includes('Duty travel'));assert.equal(p.entitlementFor('Duty travel',{}),0);assert.equal(plan.days,3);assert.equal(plan.end,'2026-11-01');assert.equal(plan.chargeType,'None');assert.equal(plan.payBasis,'Official duty');
});
test('duty preview and save agree and ignore forged duration, pay basis and balance charge',async()=>{
 const h=harness(),payload=input({days:999,chargeType:'Annual',payBasis:'No pay'});
 const preview=await h.preview({employeeId:'A',type:'Duty travel',start:payload.start,days:'999',duty:JSON.stringify(payload.duty)});assert.equal(preview.status,200);const plan=await preview.json();assert.equal(plan.days,3);assert.equal(plan.readOnlyDays,true);assert.equal(plan.entitlement,null);assert.equal(plan.available,null);
 const response=await h.send({action:'leave.create',leave:payload});assert.equal(response.status,200);const state=await response.json();assert.equal(state.leaves[0].end,plan.end);assert.equal(state.leaves[0].days,3);assert.equal(state.leaves[0].chargeType,'None');assert.equal(state.people[0].annual,0);assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Annual'),0);
});
test('missing authorization, purpose, invalid dates or times and unconfirmed full-day release cannot save',async()=>{
 for(const bad of [{approvalReference:''},{purpose:''},{destination:''},{lastDate:'2026-02-30'},{lastDate:'2026-10-28'},{startTime:'25:00'},{endTime:'invalid'},{fullDayRelease:false}]){
  const h=harness();const response=await h.send({action:'leave.create',leave:input({duty:{...duty(),...bad}})});assert.equal(response.status,400,JSON.stringify(bad));assert.equal(h.writes(),0);
 }
 const h=harness();assert.equal((await h.send({action:'leave.create',leave:input({start:'2026-10-31',duty:{...duty(),endTime:'07:00'}})})).status,400);
});
test('pending or declined duty does not excuse late punches; approved duty preserves raw times without late status',async()=>{
 const h=harness();h.store.punches=[{id:'P',pin:'01',serial:'ZK',timestamp:'2026-10-29 08:45:00',state:0,kind:'attendance-in',verify:'1',workCode:''}];const raw=JSON.stringify(h.store.punches, (key,value)=>key==='employeeId'?undefined:value);
 await h.send({action:'leave.create',leave:input({status:'Pending'})});assert.equal(h.load('lib/attendance').attendanceForClient(h.store)[0].status,'Late');
 const response=await h.send({action:'leave.decision',id:h.store.leaves[0].id,status:'Approved'});assert.equal(response.status,200);const state=await response.json(),row=state.attendance.find(r=>r.date==='2026-10-29');assert.equal(row.status,'On duty');assert.equal(row.checkIn,'08:45');assert.equal(row.originalCheckIn,'08:45');assert.equal(JSON.stringify(h.store.punches, (key,value)=>key==='employeeId'?undefined:value),raw);assert.equal(state.attendance.find(r=>r.date==='2026-10-30').status,'On duty');
 h.store.leaves[0].status='Declined';assert.equal(h.load('lib/attendance').attendanceForClient(h.store)[0].status,'Late');
});
test('server and browser agree on duty status, with no invented machine time or late minutes',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:input()});const state=h.load('lib/store').stateForClient(h.store),source=fs.readFileSync('public/app.js','utf8');
 const context={db:state,attState:{staff:'all'},eachDate:()=>['2026-10-29','2026-10-30'],iso:d=>new Date(d).toISOString().slice(0,10),today:new Date('2026-11-03'),staffStart:()=> '08:00',minutesBetween:()=>0,Date,Map};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function buildAttendanceRows('),source.indexOf('function attStatusTag(')),context);
 const rows=context.buildAttendanceRows();assert.equal(rows.length,2);for(const row of rows){assert.equal(row.status,'On duty');assert.equal(row.lateMins,0);assert.equal(row.checkIn,'—');assert.equal(row.checkOut,'—');assert.equal(row.leave,'');}
});
test('duty and personal leave cannot overlap in either direction; distinct assignments have no cumulative 30-day limit',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:input()});
 assert.equal((await h.send({action:'leave.create',leave:{employeeId:'A',type:'Annual',start:'2026-10-29',end:'2026-10-30',days:1,status:'Approved'}})).status,400);
 assert.equal((await h.send({action:'leave.create',leave:input({start:'2026-10-30'})})).status,400);
 h.store.leaves[0].status='Declined';assert.equal((await h.send({action:'leave.create',leave:input({start:'2026-11-01',end:'2026-12-16',duty:{...duty(),lastDate:'2026-12-15'}})})).status,200);
 const reverse=harness();reverse.store.leaves=[{id:'L',employeeId:'A',type:'Annual',start:'2026-10-29',end:'2026-10-30',days:1,status:'Approved'}];assert.equal((await reverse.send({action:'leave.create',leave:input()})).status,400);
});
test('duty completion requires the attendance report, records the officer reference and appends an audit entry',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:input({start:'2026-10-26',duty:{...duty(),lastDate:'2026-10-28'}})});const id=h.store.leaves[0].id;
 assert.equal((await h.send({action:'leave.duty.complete',id,expectedRevision:0,reportedAt:'2026-10-29T08:00',reportReference:''})).status,400);
 assert.equal((await h.send({action:'leave.duty.complete',id,expectedRevision:0,reportedAt:'2026-10-27T08:00',reportReference:'Officer log 1'})).status,400);
 assert.equal((await h.send({action:'leave.duty.complete',id,expectedRevision:1,reportedAt:'2026-10-29T08:00',reportReference:'Officer log 1'})).status,400);
 const response=await h.send({action:'leave.duty.complete',id,expectedRevision:0,reportedAt:'2026-10-29T08:00',reportReference:'Officer log 1'});assert.equal(response.status,200);assert.equal(h.store.leaves[0].status,'Completed');assert.equal(h.store.leaves[0].usedDays,3);assert.equal(h.store.leaves[0].duty.reportReference,'Officer log 1');assert.equal(h.store.leaveChanges[0].before.status,'Approved');assert.equal(h.store.leaveChanges[0].after.status,'Completed');assert.equal(h.store.leaveChanges[0].actor,'Administrator');
});
test('incidental and post-travel office punches do not silently replace the required attendance-officer report',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:input({start:'2026-10-26',duty:{...duty(),lastDate:'2026-10-28'}})});
 h.load('lib/punches').ingestPunches(h.store,[{id:'P',pin:'01',serial:'ZK',timestamp:'2026-10-29 08:00:00',state:0,kind:'attendance-in',verify:'1',workCode:''}]);assert.equal(h.store.leaves[0].status,'Approved');assert.equal(h.store.leaves[0].returnedAt,undefined);
});
test('completed duty edits cannot extend beyond the recorded completion report',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:input({start:'2026-10-26',duty:{...duty(),lastDate:'2026-10-28'}})});const id=h.store.leaves[0].id;await h.send({action:'leave.duty.complete',id,expectedRevision:0,reportedAt:'2026-10-29T08:00',reportReference:'Officer log 1'});
 const before=JSON.stringify(h.store.leaves[0]);const response=await h.send({action:'leave.update',id,expectedRevision:1,editReason:'Extending assignment',leave:input({start:'2026-10-26',status:'Completed',duty:{...duty(),lastDate:'2026-10-30'}})});assert.equal(response.status,400);assert.equal(JSON.stringify(h.store.leaves[0]),before);
});

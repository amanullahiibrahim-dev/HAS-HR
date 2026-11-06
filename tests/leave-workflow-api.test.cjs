const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
  let writes=0,authenticated=true,sameOrigin=true;const cache={},store={people:[{joinedOn:'2010-01-01',id:'A',name:'Teacher',role:'Teacher',devicePin:'01',annual:30,medical:0,casual:0,workStart:'07:00'}],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
  const mock={"next/server":{NextResponse:{json:(data,options)=>new Response(JSON.stringify(data),{status:options?.status||200,headers:{'content-type':'application/json'}})}},"@/lib/auth":{isAdmin:()=>authenticated,isSignedIn:()=>authenticated,currentSession:()=>authenticated?{kind:'admin'}:null,isSameOrigin:()=>sameOrigin}};
  function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mock[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL,Error});return exports;}
  const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{writes++},makeId:()=>String(store.leaves.length+1)};
  const route=load('app/api/state/route'),preview=load('app/api/leave-preview/route');
  return {store,load,send:payload=>route.POST(new Request('http://127.0.0.1/api/state',{method:'POST',body:JSON.stringify(payload)})),preview:q=>preview.GET(new Request('http://127.0.0.1/api/leave-preview?'+new URLSearchParams(q))),writes:()=>writes,deny:()=>{authenticated=false;},crossOrigin:()=>{sameOrigin=false;}};
}
const base={employeeId:'A',start:'2026-10-26',end:'2026-11-01',days:2,status:'Approved'};
test('state endpoint saves MC pending receipt, and rejects invalid verified coverage without writing',async()=>{
  const h=harness();let response=await h.send({action:'leave.create',leave:{...base,type:'Sick with MC',medical:{}}});assert.equal(response.status,200);const result=await response.json();assert.match(result.leaves[0].medicalReview.status,/pending/);
  const bad=harness();response=await bad.send({action:'leave.create',leave:{...base,type:'Sick with MC',medical:{verified:true,reference:'MC/1',issuer:'Doctor',receivedOn:'2026-10-29',coversFrom:'2026-10-26',coversTo:'2026-10-26'}}});assert.equal(response.status,400);assert.equal(bad.writes(),0);
});
test('circumcision endpoint saves five days for a male employee and requires occasion reference',async()=>{
  const h=harness();h.store.people[0].gender='Male';const payload={action:'leave.create',leave:{...base,type:'Circumcision',days:5,eventReference:'EVENT/1'}};let response=await h.send(payload);assert.equal(response.status,200);assert.equal(h.store.leaves[0].days,5);
  const missing=harness();response=await missing.send({...payload,leave:{...payload.leave,eventReference:''}});assert.equal(response.status,400);assert.equal(missing.writes(),0);
});
test('Umra charges annual balance and rejects an independent first-paid option',async()=>{
  const h=harness();const response=await h.send({action:'leave.create',leave:{...base,type:'Umra',trip:{basis:'Annual'},days:5}});assert.equal(response.status,200);assert.equal(h.store.leaves[0].chargeType,'Annual');
  const bad=harness();const rejected=await bad.send({action:'leave.create',leave:{...base,type:'Umra',trip:{basis:'First paid Hajj',office:'Male',charter:false,firstHajjConfirmed:true,permissionReference:'HR/1'}}});assert.equal(rejected.status,400);assert.equal(bad.writes(),0);
});
test('pilgrimage preview and saved return use the same atoll-charter calculation',async()=>{
  const h=harness(),trip={basis:'First paid Hajj',office:'Atoll',charter:true,flightReturn:'2026-11-15',atollBefore:3,firstHajjConfirmed:true,permissionReference:'HR/TRAVEL/1'};
  const pre=await h.preview({employeeId:'A',type:'Hajj',start:'2026-11-01',days:'1',trip:JSON.stringify(trip)});assert.equal(pre.status,200);const plan=await pre.json();
  const saved=await h.send({action:'leave.create',leave:{...base,type:'Hajj',start:'2026-11-01',end:plan.end,days:plan.days,trip}});assert.equal(saved.status,200);assert.equal(h.store.leaves[0].end,plan.end);assert.equal(h.store.leaves[0].days,plan.days);
});
test('unauthenticated rule changes remain blocked',async()=>{const h=harness();h.deny();assert.equal((await h.send({action:'leave.create',leave:{...base,type:'Circumcision'}})).status,401);assert.equal(h.writes(),0);});

test('leave save links an uploaded MC, rejects another staff file and keeps replacement audit history',async()=>{
  const h=harness();h.store.mcDocuments=[{id:'doc1',employeeId:'A',name:'first.pdf',uploadedAt:'2026-10-29T09:00:00Z'},{id:'doc2',employeeId:'A',name:'replacement.pdf',uploadedAt:'2026-10-29T10:00:00Z'},{id:'other',employeeId:'B',name:'other.pdf',uploadedAt:'2026-10-29T10:00:00Z'}];
  let response=await h.send({action:'leave.create',leave:{...base,type:'Sick with MC',mcDocumentId:'other'}});assert.equal(response.status,400);assert.equal(h.writes(),0);
  response=await h.send({action:'leave.create',leave:{...base,type:'Sick with MC',mcDocumentId:'doc1'}});assert.equal(response.status,200);let state=await response.json();assert.equal(state.leaves[0].mcDocument.id,'doc1');assert.equal(h.store.leaves[0].medical.verified,false);
  response=await h.send({action:'leave.update',id:h.store.leaves[0].id,expectedRevision:0,editReason:'Updated certificate supplied.',leave:{...base,type:'Sick with MC',mcDocumentId:'doc2'}});assert.equal(response.status,200);state=await response.json();assert.equal(state.leaves[0].mcDocument.id,'doc2');assert.equal(h.store.leaveChanges[0].before.mcDocumentId,'doc1');assert.equal(h.store.leaveChanges[0].after.mcDocumentId,'doc2');assert.equal(h.store.mcDocuments.length,3);
});


test('standalone no-pay preview and saved period include weekends and holidays without a paid allowance cap',async()=>{
 const h=harness();h.store.holidays=['2026-11-07'];
 const response=await h.preview({employeeId:'A',type:'No pay',start:'2026-11-06',days:'3'});assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.end,'2026-11-09');assert.equal(plan.isNoPay,true);assert.equal(plan.entitlement,null);assert.equal(plan.available,null);assert.equal(plan.payBasis,'No pay');assert.equal(plan.chargeType,'None');
 const saved=await h.send({action:'leave.create',leave:{employeeId:'A',type:'No pay',start:'2026-11-06',end:plan.end,days:3,status:'Approved',reason:'Approved unpaid absence'}});assert.equal(saved.status,200);const state=await saved.json();assert.ok(state.leavePolicy.types.includes('No pay'));assert.equal(h.store.leaves[0].end,plan.end);assert.equal(h.store.leaves[0].payBasis,'No pay');
 for(const type of ['Annual','Sick with MC','Sick without MC','Family'])assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A',type),0);
 const longer=harness();assert.equal((await longer.send({action:'leave.create',leave:{employeeId:'A',type:'No pay',start:'2026-11-01',end:'2026-12-16',days:45,status:'Approved'}})).status,200);
});
test('no-pay editing is audited, pending requests can be approved, and invalid durations are rejected',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:{employeeId:'A',type:'No pay',start:'2026-11-06',end:'2026-11-09',days:3,status:'Pending'}});const id=h.store.leaves[0].id;
 assert.equal((await h.send({action:'leave.decision',id,status:'Approved'})).status,200);
 const response=await h.send({action:'leave.update',id,expectedRevision:h.store.leaves[0].revision,editReason:'Unpaid extension authorized',leave:{employeeId:'A',type:'No pay',start:'2026-11-06',end:'2026-11-11',days:5,status:'Approved'}});assert.equal(response.status,200);assert.equal(h.store.leaves[0].end,'2026-11-11');assert.equal(h.store.leaveChanges[0].reason,'Unpaid extension authorized');assert.equal(h.store.leaves[0].chargeType,'None');
 assert.equal((await h.preview({employeeId:'A',type:'No pay',start:'2026-11-06',days:'-1'})).status,400);
});
test('confirmed early return completes no-pay leave using actual calendar days and retains paid balances',async()=>{
 const h=harness();h.store.holidays=['2026-11-07'];await h.send({action:'leave.create',leave:{employeeId:'A',type:'No pay',start:'2026-11-06',end:'2026-11-11',days:5,status:'Approved'}});
 h.load('lib/punches').ingestPunches(h.store,[h.load('lib/punches').normalizePunch({pin:'01',serial:'TEST',timestamp:'2026-11-08 06:50:00',state:0,eventType:'ATT IN'})]);const l=h.store.leaves[0];assert.equal(l.status,'Completed');assert.equal(l.returnedAt,'2026-11-08 06:50:00');assert.equal(l.usedDays,2);assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Annual'),0);assert.equal(h.load('lib/attendance').attendanceForClient(h.store)[0].status,'Present');
});


test('adding a holiday extends family leave without reducing the three approved days; retry is idempotent',async()=>{
 const h=harness();const input={employeeId:'A',type:'Family',start:'2026-11-01',end:'2026-11-04',days:3,status:'Approved'};
 assert.equal((await h.send({action:'leave.create',leave:input})).status,200);
 const leave=h.store.leaves[0],days=[{date:'2026-11-03',category:'Public holiday',reason:'Victory Day'}];
 assert.equal((await h.send({action:'closed-days.save',days})).status,200);
 assert.equal(leave.end,'2026-11-05');assert.equal(leave.days,3);assert.equal(leave.deductibleDays,3);
 assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Family'),3);
 assert.equal(h.store.leaveChanges[0].before.end,'2026-11-04');assert.equal(h.store.leaveChanges[0].after.end,'2026-11-05');
 const revision=leave.revision;await h.send({action:'closed-days.save',days});assert.equal(leave.revision,revision);assert.equal(h.store.closedDayChanges.length,1);
 const preview=await h.preview({employeeId:'A',type:'Family',start:leave.start,days:'3',excludeId:leave.id});assert.equal((await preview.json()).end,leave.end);
 const updated=await h.send({action:'leave.update',id:leave.id,expectedRevision:revision,editReason:'Corrected note',leave:{...input,reason:'Family responsibility'}});assert.equal(updated.status,200);assert.equal(leave.end,'2026-11-05');assert.equal(leave.days,3);
 await h.send({action:'closed-days.save',days:[]});assert.equal(leave.end,'2026-11-04');assert.equal(leave.deductibleDays,3);
});

test('all applicable categories extend their requested allowance and keep preview consistent',async()=>{
 for(const type of ['Family','Annual','Sick with MC','Sick without MC','Paternity','Circumcision','Maternity','Medical','Casual']){
  const h=harness(),policy=h.load('lib/leave-policy'),start='2026-11-01',plan=policy.planLeave(type,start,2);
  h.store.leaves=[{id:'L',employeeId:'A',name:'Staff',type,start,end:plan.end,days:plan.days,status:'Pending'}];
  const response=await h.send({action:'closed-days.save',days:[{date:'2026-11-02',category:'Public holiday',reason:'Official announcement'}]});assert.equal(response.status,200,type);
  const leave=h.store.leaves[0],expected=policy.planLeave(type,start,2,['2026-11-02']);assert.equal(leave.end,expected.end,type);assert.equal(leave.days,plan.days,type);assert.equal(leave.deductibleDays,plan.days,type);
 }
});

test('weekend holidays are not counted twice, and additional holidays in the extension are also excluded',async()=>{
 const h=harness();h.store.leaves=[{id:'L',employeeId:'A',type:'Family',start:'2026-11-05',end:'2026-11-09',days:2,status:'Approved'}];
 const days=['2026-11-05','2026-11-06','2026-11-08','2026-11-09'].map(date=>({date,category:'Presidential closure',reason:'Official closure'}));
 assert.equal((await h.send({action:'closed-days.save',days})).status,200);assert.equal(h.store.leaves[0].end,'2026-11-12');assert.equal(h.store.leaves[0].deductibleDays,2);
});

test('holiday before creation and holiday after creation produce the same leave dates and deductions',async()=>{
 const days=[{date:'2026-11-03',category:'Public holiday',reason:'Victory Day'}],input={employeeId:'A',type:'Annual',start:'2026-11-01',end:'2026-11-05',days:4,status:'Approved'};
 const before=harness();await before.send({action:'closed-days.save',days});await before.send({action:'leave.create',leave:input});
 const after=harness();await after.send({action:'leave.create',leave:input});await after.send({action:'closed-days.save',days});
 assert.equal(after.store.leaves[0].end,before.store.leaves[0].end);assert.equal(after.store.leaves[0].deductibleDays,4);assert.equal(after.store.leaves[0].days,before.store.leaves[0].days);
});

test('an unchanged calendar repairs the old deduction-only records once',async()=>{
 const h=harness();h.store.holidays=['2026-11-03'];h.store.closedDays=[{date:'2026-11-03',category:'Public holiday',reason:'Victory Day'}];
 h.store.leaves=[{id:'OLD',employeeId:'A',type:'Family',start:'2026-11-01',end:'2026-11-04',days:3,deductibleDays:2,status:'Approved'}];
 await h.send({action:'closed-days.save',days:h.store.closedDays});assert.equal(h.store.leaves[0].end,'2026-11-05');assert.equal(h.store.leaves[0].deductibleDays,3);assert.equal(h.store.leaveChanges.length,1);assert.equal(h.store.closedDayChanges,undefined);
 await h.send({action:'closed-days.save',days:h.store.closedDays});assert.equal(h.store.leaveChanges.length,1);
});

test('completed records preserve actual return and manual adjustments while declined/no-pay/duty stay unchanged',async()=>{
 const h=harness(),base={employeeId:'A',type:'Annual',start:'2026-10-04',end:'2026-10-09',days:5};
 h.store.leaves=[{...base,id:'EARLY',status:'Completed',returnedAt:'2026-10-06 07:00:00',usedDays:2},{...base,id:'ADJUST',status:'Completed',returnedAt:'2026-10-08 07:00:00',usedDays:3},{...base,id:'DECLINED',status:'Declined'},{...base,id:'NO',type:'No pay',status:'Approved'},{...base,id:'DUTY',type:'Duty travel',status:'Approved'}];
 const unchanged=JSON.stringify(h.store.leaves.slice(2));await h.send({action:'closed-days.save',days:[{date:'2026-10-05',category:'Public holiday',reason:'Official closure'}]});
 assert.equal(h.store.leaves[0].end,'2026-10-12');assert.equal(h.store.leaves[0].usedDays,1);assert.equal(h.store.leaves[0].returnedAt,'2026-10-06 07:00:00');assert.equal(h.store.leaves[0].status,'Completed');assert.equal(h.store.leaves[1].usedDays,2);assert.equal(JSON.stringify(h.store.leaves.slice(2)),unchanged);
 await h.send({action:'closed-days.save',days:[]});assert.equal(h.store.leaves[0].usedDays,2);assert.equal(h.store.leaves[0].end,'2026-10-09');assert.equal(h.store.leaves[1].usedDays,3);
});

test('half days retain their allowance even when the whole original period becomes closed',async()=>{
 const h=harness();h.store.leaves=[{id:'ONE',employeeId:'A',type:'Sick without MC',start:'2026-10-04',end:'2026-10-05',days:1,status:'Approved'},{id:'HALF',employeeId:'A',type:'Annual',start:'2026-10-04',end:'2026-10-06',days:1.5,status:'Approved'}];
 const days=['2026-10-04','2026-10-05'].map(date=>({date,category:'Other official closure',reason:'Official closure'}));await h.send({action:'closed-days.save',days});assert.equal(h.store.leaves[0].end,'2026-10-07');assert.equal(h.store.leaves[0].deductibleDays,1);assert.equal(h.store.leaves[1].end,'2026-10-08');assert.equal(h.store.leaves[1].deductibleDays,1.5);
});

test('pilgrimage honors annual basis, non-charter base extension, fixed charter and atoll calendar-day exceptions',async()=>{
 for(const basis of ['First paid Hajj','No pay','Annual'])for(const charter of [false,true]){
  const h=harness(),type=basis==='First paid Hajj'?'Hajj':'Umra',trip={basis,office:'Atoll',charter,flightReturn:'2026-11-10',atollBefore:3,firstHajjConfirmed:true,permissionReference:'HR/1'},input={employeeId:'A',type,start:'2026-11-01',days:3,status:'Approved',trip};
  const original=h.load('lib/leave-requirements').resolveLeavePlan(h.store,h.store.people[0],input);h.store.leaves=[{...input,...original,id:'L'}];
  const date=basis==='Annual'?'2026-11-02':'2026-11-05';await h.send({action:'closed-days.save',days:[{date,category:'Public holiday',reason:'Official holiday'}]});
  const expected=h.load('lib/leave-requirements').resolveLeavePlan(h.store,h.store.people[0],input,'L'),leave=h.store.leaves[0];assert.equal(leave.end,expected.end,basis+' '+charter);assert.equal(leave.days,original.days);
  if(basis!=='Annual'){assert.equal(leave.trip.baseEnd,expected.trip.baseEnd);if(charter)assert.equal(leave.end,original.end);else assert.notEqual(leave.end,original.end);}
 }
});

test('cross-year extensions preserve the original requested allowance and a holiday after leave has no effect',async()=>{
 const h=harness();h.store.leaves=[{id:'L',employeeId:'A',type:'Annual',start:'2026-12-31',end:'2027-01-05',days:3,status:'Approved'}];
 await h.send({action:'closed-days.save',days:[{date:'2027-01-04',category:'Public holiday',reason:'Official holiday'}]});assert.equal(h.store.leaves[0].end,'2027-01-06');assert.equal(h.store.leaves[0].days,3);
 const revision=h.store.leaves[0].revision;await h.send({action:'closed-days.save',days:[{date:'2027-01-04',category:'Public holiday',reason:'Official holiday'},{date:'2027-02-01',category:'Public holiday',reason:'Later holiday'}]});assert.equal(h.store.leaves[0].revision,revision);
});

test('closed-day validation rejects bad dates, duplicates and missing reasons without saving',async()=>{
 for(const days of [[{date:'2026-02-30',category:'Public holiday',reason:'Invalid'}],[{date:'2026-11-01',category:'Public holiday',reason:''}],[{date:'2026-11-01',category:'Unknown',reason:'Invalid'}],Array(2).fill({date:'2026-11-01',category:'Public holiday',reason:'Duplicate'})]){const h=harness();assert.equal((await h.send({action:'closed-days.save',days})).status,400);assert.equal(h.writes(),0);assert.equal(h.store.holidays.length,0);}
});

test('permanent leave deletion removes only the selected record and restores its paid balance',async()=>{
 for(const [type,status] of [['Annual','Pending'],['Annual','Approved'],['Sick with MC','Completed'],['No pay','Declined'],['Duty travel','Approved']]){
  const h=harness(),record={id:'DELETE',employeeId:'A',name:'Teacher',type,start:'2026-10-26',end:'2026-10-28',days:2,usedDays:2,status,revision:3};h.store.leaves=[record,{...record,id:'KEEP',type:'Annual',status:'Approved'}];h.store.punches=[{id:'RAW',pin:'01',serial:'TEST',timestamp:'2026-10-26 06:45:00',state:0,kind:'attendance-in'}];h.store.corrections=[{id:'CORRECTION',employeeId:'A',date:'2026-10-26',changes:{checkIn:'06:40'},originalPunches:[]}];
  const response=await h.send({action:'leave.delete',id:'DELETE',expectedRevision:3,reason:'Staff decided to work'});assert.equal(response.status,200);const state=await response.json();assert.equal(state.leaves.length,1);assert.equal(state.leaves[0].id,'KEEP');assert.equal(h.store.punches.length,1);assert.equal(h.store.punches[0].id,'RAW');assert.equal(h.store.corrections[0].id,'CORRECTION');assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Annual'),2);assert.equal(h.store.leaveDeletions.length,1);assert.equal(h.store.leaveDeletions[0].reason,'Staff decided to work');assert.equal(h.store.leaveDeletions[0].before,undefined);
 }
});
test('deletion purges leave edit history and unshared MC metadata but preserves documents referenced by another leave',async()=>{
 const h=harness(),base={id:'DELETE',employeeId:'A',name:'Teacher',type:'Sick with MC',start:'2026-10-26',end:'2026-10-28',days:2,status:'Approved',mcDocumentId:'MC-SHARED'};h.store.leaves=[base,{...base,id:'KEEP'}];h.store.leaveChanges=[{id:'CHANGE',leaveId:'DELETE',before:{...base,mcDocumentId:'MC-OLD'},after:{...base}},{id:'KEEP-CHANGE',leaveId:'KEEP',before:{...base,id:'KEEP'},after:{...base,id:'KEEP'}}];h.store.mcDocuments=[{id:'MC-OLD',employeeId:'A'},{id:'MC-SHARED',employeeId:'A'},{id:'OTHER',employeeId:'A'}];
 const response=await h.send({action:'leave.delete',id:'DELETE',expectedRevision:0,reason:'Wrong sick leave entered'});assert.equal(response.status,200);assert.equal(h.store.leaveChanges.length,1);assert.equal(h.store.leaveChanges[0].leaveId,'KEEP');assert.equal(h.store.mcDocuments.some(d=>d.id==='MC-OLD'),false);assert.equal(h.store.mcDocuments.some(d=>d.id==='MC-SHARED'),true);assert.equal(h.store.mcDocuments.some(d=>d.id==='OTHER'),true);
});
test('deletion rejects stale revisions, missing reasons, unknown records and unauthorized requests',async()=>{
 const h=harness();h.store.leaves=[{id:'L',employeeId:'A',type:'Annual',start:'2026-10-26',end:'2026-10-28',days:2,status:'Approved',revision:2}];
 for(const payload of [{id:'L',expectedRevision:1,reason:'Stale'},{id:'L',expectedRevision:2,reason:''},{id:'missing',expectedRevision:0,reason:'Not found'}]){const response=await h.send({action:'leave.delete',...payload});assert.equal(response.status,payload.id==='missing'?404:payload.expectedRevision===1?409:400);assert.equal(h.writes(),0);assert.equal(h.store.leaves.length,1);}
 const denied=harness();denied.deny();assert.equal((await denied.send({action:'leave.delete',id:'L',expectedRevision:0,reason:'test'})).status,401);assert.equal(denied.writes(),0);const cross=harness();cross.crossOrigin();assert.equal((await cross.send({action:'leave.delete',id:'L',expectedRevision:0,reason:'test'})).status,403);assert.equal(cross.writes(),0);
 const success=await h.send({action:'leave.delete',id:'L',expectedRevision:2,reason:'Wrong dates'});assert.equal(success.status,200);assert.equal((await h.send({action:'leave.delete',id:'L',expectedRevision:2,reason:'Retry'})).status,404);
});

test('administrator API persists disciplinary actions and supervisor assignments in the returned state',async()=>{const h=harness();h.store.people.push({id:'P',name:'Principal Example',role:'Principal',devicePin:'P'});let response=await h.send({action:'disciplinary.save',record:{employeeId:'A',date:'2025-01-01',action:'Written warning',reference:'TEST/1'}});assert.equal(response.status,200);assert.equal((await response.json()).disciplinaryActions[0].action,'Written warning');response=await h.send({action:'supervisor.save',assignment:{supervisor:{kind:'staff',id:'P'},employeeIds:['A'],from:'2025-01-01'},reason:'Annual assignment'});assert.equal(response.status,200);assert.equal((await response.json()).supervisorAssignments[0].supervisor.id,'P');});
test('discipline/supervisor writes require administrator authentication and same origin',async()=>{for(const action of ['disciplinary.save','supervisor.save']){const h=harness();h.deny();assert.equal((await h.send({action})).status,401);assert.equal(h.writes(),0);const c=harness();c.crossOrigin();assert.equal((await c.send({action})).status,403);assert.equal(c.writes(),0);}});


test('legacy year-only opening values require review before showing new period availability',async()=>{
 const h=harness();let response=await h.send({action:'employee.opening-balance',id:'A',year:2026,used:{Family:7,Annual:20,'Sick with MC':10,'Sick without MC':5},expectedRevision:0,reason:'Old opening register'});assert.equal(response.status,200);
 response=await h.preview({employeeId:'A',type:'Family',start:'2026-11-01',days:'3'});assert.equal(response.status,400);assert.match((await response.json()).error,/Review earlier/);
 response=await h.send({action:'employee.period-balances',id:'A',asOf:'2026-11-01',joinedOn:'2010-01-01',used:{Family:7,Annual:20,'Sick with MC':10,'Sick without MC':5},expectedRevision:0,reason:'Checked opening usage for service period'});assert.equal(response.status,200);
 response=await h.preview({employeeId:'A',type:'Family',start:'2026-11-01',days:'3'});assert.equal((await response.json()).available,3);
 response=await h.send({action:'leave.create',leave:{...base,type:'Family',days:4}});assert.equal(response.status,400);
 response=await h.send({action:'leave.create',leave:{...base,type:'Family',days:3}});assert.equal(response.status,200);
 assert.equal(h.store.people[0].leaveOpeningBalances['2026'].used.Family,7);assert.equal(h.store.people[0].leavePeriodChanges.length,1);assert.equal(h.store.punches.length,0);
});

test('invalid opening balances, shared sick overuse and unauthorized changes are rejected atomically',async()=>{
 const payload={action:'employee.opening-balance',id:'A',year:2026,used:{Family:1},expectedRevision:0,reason:'Register'};
 for(const changes of [{id:'missing'},{year:2026.5},{year:1999},{used:{Family:-1}},{used:{Family:0.25}},{used:{Family:'2'}},{used:{Family:11}},{used:{'Sick with MC':20,'Sick without MC':11}},{used:{'Sick without MC':16}},{used:{Circumcision:1}},{reason:''}]){const h=harness();assert.equal((await h.send({...payload,...changes})).status,400);assert.equal(h.writes(),0);assert.equal(h.store.people[0].leaveOpeningBalances,undefined);}
 const h=harness();h.deny();assert.equal((await h.send(payload)).status,401);assert.equal(h.writes(),0);const cross=harness();cross.crossOrigin();assert.equal((await cross.send(payload)).status,403);assert.equal(cross.writes(),0);
});


test('sick return date still calculates without joining date, and responds to days, start and holidays',async()=>{
 const h=harness();delete h.store.people[0].joinedOn;
 for(const [start,days,holidays] of [['2026-11-04',10,[]],['2026-11-04',5,[]],['2026-11-05',5,['2026-11-08']]]){
  h.store.holidays=holidays;
  const response=await h.preview({employeeId:'A',type:'Sick with MC',start,days:String(days)}),result=await response.json();
  assert.equal(response.status,400);assert.match(result.error,/Joining date/);
  assert.equal(result.preview.end,h.load('lib/leave-policy').planLeave('Sick with MC',start,days,holidays).end);assert.equal(result.preview.days,days);assert.equal(result.preview.readOnlyDays,false);
 }
 const invalid=await h.preview({employeeId:'A',type:'Sick with MC',start:'2026-02-30',days:'10'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).preview,undefined);
 const denied=harness();denied.deny();assert.equal((await denied.preview({employeeId:'A',type:'Sick with MC',start:'2026-11-04',days:'10'})).status,401);
 assert.equal(h.writes(),0);
});

test('sick leave saves and edits with no MC upload and retains a later attachment',async()=>{
 const h=harness(),input={...base,type:'Sick with MC',start:'2026-11-04',days:10,end:'2026-11-18'};
 let response=await h.send({action:'leave.create',leave:input});assert.equal(response.status,200,await response.clone().text());
 const leave=h.store.leaves[0];assert.equal(leave.mcDocumentId,undefined);assert.equal(leave.medical.verified,false);
 response=await h.send({action:'leave.update',id:leave.id,expectedRevision:0,editReason:'Updated note',leave:{...input,reason:'Changed'}});assert.equal(response.status,200);assert.equal(leave.mcDocumentId,undefined);
 h.store.mcDocuments=[{id:'MC-LATER',employeeId:'A',name:'later.pdf',uploadedAt:'2026-11-03T10:00:00Z'}];
 response=await h.send({action:'leave.update',id:leave.id,expectedRevision:leave.revision,editReason:'Certificate added later',leave:{...input,mcDocumentId:'MC-LATER'}});assert.equal(response.status,200);assert.equal(leave.mcDocumentId,'MC-LATER');
 response=await h.send({action:'leave.update',id:leave.id,expectedRevision:leave.revision,editReason:'Updated note only',leave:{...input,reason:'Note only'}});assert.equal(response.status,200);assert.equal(leave.mcDocumentId,'MC-LATER');
});

test('supervisor endpoint accepts the simplified form and audits generated dates and reasons',async()=>{
 const h=harness();
 const response=await h.send({action:'supervisor.save',assignment:{supervisor:{kind:'minister'},employeeIds:['A']}});assert.equal(response.status,200,await response.clone().text());
 const record=h.store.supervisorAssignments[0],expectedDate=new Date(Date.parse(record.updatedAt)+5*3600000).toISOString().slice(0,10);assert.equal(record.from,expectedDate);assert.equal(record.to,undefined);assert.equal(h.writes(),1);assert.ok(h.store.supervisorChanges[0].reason.trim());
 const before=JSON.stringify(h.store),writes=h.writes();assert.equal((await h.send({action:'supervisor.save',assignment:{supervisor:{kind:'minister'},employeeIds:['A']}})).status,400);assert.equal(h.writes(),writes);assert.equal(JSON.stringify(h.store),before);
});

test('simplified supervisor endpoint edits preserve historical boundaries and reject stale revisions',async()=>{
 const h=harness();h.store.people.push({joinedOn:'2010-01-01',id:'B',name:'Supervisor',role:'Admin Staff',devicePin:'02',workStart:'08:00'});
 h.store.supervisorAssignments=[{id:'S1',employeeId:'A',supervisor:{kind:'staff',id:'B'},from:'2026-01-01',to:'2026-06-30',revision:0,updatedAt:'2026-06-30T10:00:00.000Z',actor:'Administrator'}];
 const payload={action:'supervisor.save',assignment:{id:'S1',supervisor:{kind:'minister'},employeeIds:['A']},expectedRevision:0};
 const response=await h.send(payload);assert.equal(response.status,200,await response.clone().text());const record=h.store.supervisorAssignments[0];assert.equal(record.from,'2026-01-01');assert.equal(record.to,'2026-06-30');assert.equal(record.revision,1);assert.equal(record.supervisor.kind,'minister');assert.equal(h.store.supervisorChanges[0].before.supervisor.id,'B');assert.ok(h.store.supervisorChanges[0].reason.trim());
 const before=JSON.stringify(h.store),writes=h.writes();assert.equal((await h.send(payload)).status,400);assert.equal(h.writes(),writes);assert.equal(JSON.stringify(h.store),before);
});

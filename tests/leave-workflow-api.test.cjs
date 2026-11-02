const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
  let writes=0,authenticated=true,sameOrigin=true;const cache={},store={people:[{id:'A',name:'Teacher',role:'Teacher',devicePin:'01',annual:30,medical:0,casual:0,workStart:'07:00'}],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
  const mock={"next/server":{NextResponse:{json:(data,options)=>new Response(JSON.stringify(data),{status:options?.status||200,headers:{'content-type':'application/json'}})}},"@/lib/auth":{isAdmin:()=>authenticated,isSameOrigin:()=>sameOrigin}};
  function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mock[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL});return exports;}
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


test('closed days automatically reduce approved/pending and completed early-return deductions without moving dates',async()=>{
 const h=harness();h.store.leaves=[
 {id:'A',employeeId:'A',name:'Teacher',type:'Annual',start:'2026-10-04',end:'2026-10-11',days:5,status:'Approved'},
 {id:'S',employeeId:'A',name:'Teacher',type:'Sick with MC',start:'2026-10-04',end:'2026-10-11',days:5,status:'Pending'},
 {id:'E',employeeId:'A',name:'Teacher',type:'Annual',start:'2026-10-04',end:'2026-10-11',days:5,status:'Completed',returnedAt:'2026-10-06 07:00:00',usedDays:2},
 {id:'D',employeeId:'A',name:'Teacher',type:'Annual',start:'2026-10-04',end:'2026-10-11',days:5,status:'Declined'}];
 const days=[{date:'2026-10-05',category:'Presidential closure',reason:'Official announcement'},{date:'2026-10-09',category:'Public holiday',reason:'Already a Friday'}];
 let response=await h.send({action:'closed-days.save',days});assert.equal(response.status,200);let state=await response.json();assert.equal(h.store.leaves[0].deductibleDays,4);assert.equal(h.store.leaves[1].deductibleDays,4);assert.equal(h.store.leaves[2].usedDays,1);assert.equal(h.store.leaves[3].deductibleDays,undefined);assert.equal(h.store.leaves[0].end,'2026-10-11');assert.equal(h.store.leaves[0].days,5);assert.equal(h.store.leaveChanges.length,3);assert.equal(h.store.closedDayChanges.length,1);assert.equal(state.closedDays.length,2);assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Annual'),5);
 const revisions=h.store.leaves.map(l=>l.revision);await h.send({action:'closed-days.save',days});assert.equal(h.store.leaveChanges.length,3);assert.equal(h.store.closedDayChanges.length,1);assert.deepEqual(h.store.leaves.map(l=>l.revision),revisions);
 response=await h.send({action:'closed-days.save',days:[]});assert.equal(response.status,200);assert.equal(h.store.leaves[0].deductibleDays,5);assert.equal(h.store.leaves[2].usedDays,2);assert.equal(h.store.leaves[2].returnedAt,'2026-10-06 07:00:00');assert.equal(h.store.leaves[0].end,'2026-10-11');
});
test('closed dates follow each paid leave policy, preserve no-pay/duty, and exclude no extra Hajj travel days',async()=>{
 const h=harness();h.store.leaves=['Family','Paternity','Circumcision','No pay','Duty travel'].map((type,i)=>({id:String(i),employeeId:'A',name:'Teacher',type,start:'2026-10-04',end:'2026-10-11',days:type==='Family'?5:7,status:'Approved'}));
 h.store.leaves.push({id:'H',employeeId:'A',name:'Teacher',type:'Hajj',start:'2026-10-01',end:'2026-10-12',days:11,status:'Approved',trip:{basis:'First paid Hajj',baseStart:'2026-10-04',baseEnd:'2026-10-09'}});
 const days=['2026-10-02','2026-10-05','2026-10-09'].map(date=>({date,category:'Presidential closure',reason:'Official closure'}));assert.equal((await h.send({action:'closed-days.save',days})).status,200);
 assert.equal(h.store.leaves[0].deductibleDays,4);assert.equal(h.store.leaves[1].deductibleDays,5);assert.equal(h.store.leaves[2].deductibleDays,5);assert.equal(h.store.leaves[3].deductibleDays,undefined);assert.equal(h.store.leaves[4].deductibleDays,undefined);assert.equal(h.store.leaves[5].deductibleDays,10);
});
test('fully closed and half-day applied periods never produce negative or double-counted deductions',async()=>{
 const h=harness();h.store.leaves=[{id:'ONE',employeeId:'A',type:'Sick without MC',start:'2026-10-04',end:'2026-10-05',days:1,status:'Approved'},{id:'HALF',employeeId:'A',type:'Annual',start:'2026-10-04',end:'2026-10-06',days:1.5,status:'Approved'}];
 const days=['2026-10-04','2026-10-05'].map(date=>({date,category:'Other official closure',reason:'Special official closure'}));await h.send({action:'closed-days.save',days});assert.equal(h.store.leaves[0].deductibleDays,0);assert.equal(h.store.leaves[1].deductibleDays,0);assert.equal(h.load('lib/leave-policy').usedDaysForType(h.store.leaves,'A','Sick without MC'),0);
 await h.send({action:'closed-days.save',days:[days[1]]});assert.equal(h.store.leaves[1].deductibleDays,1);
});
test('closed-day validation rejects bad dates, duplicate days and missing reasons without saving',async()=>{
 for(const days of [[{date:'2026-02-30',category:'Public holiday',reason:'Invalid'}],[{date:'2026-11-01',category:'Public holiday',reason:''}],[{date:'2026-11-01',category:'Unknown',reason:'Invalid'}],Array(2).fill({date:'2026-11-01',category:'Public holiday',reason:'Duplicate'})]){const h=harness();assert.equal((await h.send({action:'closed-days.save',days})).status,400);assert.equal(h.writes(),0);assert.equal(h.store.holidays.length,0);}
});
test('maternity closure reconciliation keeps its approved period and updates only the chargeable deduction',async()=>{
 const h=harness(),plan=h.load('lib/leave-policy').planLeave('Maternity','2026-01-01',1,[]);h.store.leaves=[{id:'MAT',employeeId:'A',type:'Maternity',start:'2026-01-01',end:plan.end,days:plan.days,status:'Approved'}];
 await h.send({action:'closed-days.save',days:[{date:'2026-01-05',category:'Presidential closure',reason:'Official closure'}]});assert.equal(h.store.leaves[0].deductibleDays,plan.days-1);assert.equal(h.store.leaves[0].end,plan.end);
});

test('editing notes on a closure-adjusted leave preserves its approved dates and adjusted charge',async()=>{
 const h=harness();await h.send({action:'leave.create',leave:{employeeId:'A',type:'Annual',start:'2026-10-04',end:'2026-10-08',days:4,status:'Approved'}});const leave=h.store.leaves[0];
 await h.send({action:'closed-days.save',days:[{date:'2026-10-05',category:'Presidential closure',reason:'Official closure'}]});assert.equal(leave.deductibleDays,3);
 const preview=await h.preview({employeeId:'A',type:'Annual',start:leave.start,days:String(leave.days),excludeId:leave.id});const plan=await preview.json();assert.equal(plan.end,'2026-10-08');assert.equal(plan.deductibleDays,3);assert.equal(plan.preservedPeriod,true);
 const response=await h.send({action:'leave.update',id:leave.id,expectedRevision:leave.revision,editReason:'Corrected note only',leave:{employeeId:'A',type:'Annual',start:leave.start,end:leave.end,days:leave.days,status:'Approved',reason:'Updated note'}});assert.equal(response.status,200);assert.equal(leave.end,'2026-10-08');assert.equal(leave.deductibleDays,3);assert.equal(leave.reason,'Updated note');
});

test('unrelated closures do not overwrite administrator-adjusted usage and relevant changes apply only their date difference',async()=>{
 const h=harness();h.store.leaves=[{id:'MANUAL',employeeId:'A',type:'Annual',start:'2026-10-04',end:'2026-10-08',days:4,status:'Completed',returnedAt:'2026-10-08 07:00:00',usedDays:3}];
 await h.send({action:'closed-days.save',days:[{date:'2026-11-01',category:'Public holiday',reason:'Outside leave'}]});assert.equal(h.store.leaves[0].usedDays,3);assert.equal(h.store.leaves[0].revision,undefined);
 await h.send({action:'closed-days.save',days:[{date:'2026-10-05',category:'Presidential closure',reason:'Within leave'}]});assert.equal(h.store.leaves[0].usedDays,2);assert.equal(h.store.leaves[0].deductibleDays,3);
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

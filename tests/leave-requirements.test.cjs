const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const cache={};function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n.startsWith('./')?load(n.slice(2)):require(n),Date,Map,Set,process,Buffer});return exports;}
const req=load('leave-requirements'),p=load('leave-policy');
const person={joinedOn:'2010-01-01',id:'A',name:'Staff',role:'Teacher',devicePin:'01'};
const fixture=()=>({people:[person],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}});
const trip=(changes={})=>({type:'Hajj',start:'2026-11-01',days:1,trip:{basis:'First paid Hajj',office:'Male',charter:false,firstHajjConfirmed:true,permissionReference:'HR/1',...changes}});
const record=(plan,input)=>({id:'new',employeeId:'A',name:'Staff',reason:'',status:'Approved',...input,...plan});
test('circumcision is five days for either parent and counted per occasion',()=>{
  const s=fixture();s.holidays=['2026-11-02'];assert.equal(p.entitlementFor('Circumcision',{gender:'Male'}),5);assert.equal(p.entitlementFor('Circumcision',{gender:'Female'}),5);
  const plan=req.resolveLeavePlan(s,person,{type:'Circumcision',start:'2026-11-01',days:5});assert.equal(plan.end,'2026-11-07');
  s.leaves.push({id:'old',employeeId:'A',type:'Circumcision',eventReference:'EVENT1',days:3,status:'Completed',usedDays:3});
  assert.throws(()=>req.checkLeaveAllowance(s,person,{id:'new',employeeId:'A',type:'Circumcision',eventReference:'event1',days:3,start:'2026-11-01',status:'Approved'}),/5 days/);
  assert.doesNotThrow(()=>req.checkLeaveAllowance(s,person,{id:'new',employeeId:'A',type:'Circumcision',eventReference:'EVENT2',days:5,start:'2026-11-01',status:'Approved'}));
});
test('first Hajj standard base excludes holidays and needs eligibility plus permission',()=>{
  const s=fixture();s.holidays=['2026-11-06'];const plan=req.resolveLeavePlan(s,person,trip());assert.equal(plan.days,30);assert.equal(plan.end,'2026-12-02');
  assert.throws(()=>req.resolveLeavePlan(s,person,trip({firstHajjConfirmed:false})),/first Hajj/);
  assert.throws(()=>req.resolveLeavePlan(s,person,trip({permissionReference:''})),/permission/);
});
test('atoll allowance has fifteen calendar days allocated before and after the base',()=>{
  const s=fixture();s.holidays=['2026-11-02'];const plan=req.resolveLeavePlan(s,person,trip({office:'Atoll',atollBefore:5}));assert.equal(plan.days,45);assert.equal(plan.trip.baseStart,'2026-11-06');assert.equal(plan.end,req.addDate(plan.trip.baseEnd,10));
  const leave=record(plan,trip({office:'Atoll',atollBefore:5}));assert.equal(req.actualUsedDays(leave,'2026-11-06',s.holidays),5);
});
test('charter uses actual travel through return date rather than a fixed allowance',()=>{
  const s=fixture();s.holidays=['2026-11-04'];const plan=req.resolveLeavePlan(s,person,trip({charter:true,flightReturn:'2026-11-10'}));assert.equal(plan.end,'2026-11-11');assert.equal(plan.days,9);
  assert.throws(()=>req.resolveLeavePlan(s,person,trip({charter:true,flightReturn:'2026-10-01'})),/return date/);
});
test('repeat paid Hajj and a paid Umra request are rejected; editing own Hajj is allowed',()=>{
  const s=fixture();s.leaves.push({id:'old',employeeId:'A',type:'Hajj',status:'Completed'});
  assert.throws(()=>req.resolveLeavePlan(s,person,trip()),/already exists/);assert.doesNotThrow(()=>req.resolveLeavePlan(s,person,trip(),'old'));
  assert.throws(()=>req.resolveLeavePlan(fixture(),person,{...trip(),type:'Umra'}),/first Hajj/);
});
test('Hajj or Umra on annual leave reserves the annual balance',()=>{
  const s=fixture();const input={...trip({basis:'Annual'}),type:'Umra',days:5};const plan=req.resolveLeavePlan(s,person,input);assert.equal(plan.chargeType,'Annual');assert.equal(plan.end,'2026-11-06');
  s.leaves.push(record(plan,input));assert.equal(p.usedDaysForType(s.leaves,'A','Annual',undefined,2026),5);
  assert.equal(p.usedDaysForType(s.leaves,'A','Umra',undefined,2026),0);
  assert.throws(()=>req.checkLeaveAllowance(s,person,{id:'next',employeeId:'A',type:'Annual',start:'2026-12-01',days:26,status:'Approved'}),/25 day/);
});
test('authorized no-pay pilgrimage does not consume paid annual leave',()=>{
  const s=fixture();const input={...trip({basis:'No pay'}),type:'Umra'};const plan=req.resolveLeavePlan(s,person,input);assert.equal(plan.payBasis,'No pay');s.leaves.push(record(plan,input));assert.equal(p.usedDaysForType(s.leaves,'A','Annual'),0);
  assert.throws(()=>req.resolveLeavePlan(s,person,{...input,trip:{...input.trip,permissionReference:''}}),/permission/);
});
test('MC verification validates reference, receipt, practitioner and inclusive coverage',()=>{
  assert.throws(()=>req.normalizeMedical({verified:true},'Sick with MC','2026-10-26','2026-10-28'),/reference/);
  const m={reference:'MC/1',issuer:'Licensed practitioner checked',receivedOn:'2026-10-29',coversFrom:'2026-10-26',coversTo:'2026-10-27',verified:true};
  const valid=req.normalizeMedical(m,'Sick with MC','2026-10-26','2026-10-28');assert.equal(valid.verifiedBy,'Administrator');assert.ok(valid.verifiedAt);
  assert.throws(()=>req.normalizeMedical({...m,coversTo:'2026-10-26'},'Sick with MC','2026-10-26','2026-10-28'),/coverage/);
});
test('pending documents can be recorded, and return deadlines flag review without changing leave status',()=>{
  const leave={employeeId:'A',type:'Sick with MC',start:'2026-10-26',end:'2026-10-28',days:2,status:'Completed',returnedAt:'2026-10-28 06:50:00'};
  assert.equal(req.normalizeMedical({},'Sick with MC',leave.start,leave.end).verified,false);
  assert.match(req.medicalReview(leave,person,'2026-10-29').status,/overdue/);
  assert.doesNotMatch(req.medicalReview(leave,person,'2026-10-28').status,/overdue/);assert.equal(leave.status,'Completed');
  assert.equal(req.medicalReview({...leave,status:'Declined'},person),null);
});
test('without-MC reason form can be verified without a doctor and late receipts remain flagged',()=>{
  const medical=req.normalizeMedical({reference:'FORM/1',receivedOn:'2026-10-29',verified:true},'Sick without MC','2026-10-26','2026-10-28');
  assert.equal(medical.verified,true);const review=req.medicalReview({type:'Sick without MC',start:'2026-10-26',end:'2026-10-28',returnedAt:'2026-10-28 06:50:00',medical},person,'2026-10-29');assert.match(review.status,/late submission/);
});
test('first and second working-day notice timestamps use the staff schedule and skip days off',()=>{
  const leave={type:'Sick with MC',start:'2026-10-29',end:'2026-11-03',medical:{notifiedAt:'2026-10-29T07:45',notifiedAgainAt:'2026-11-02T08:10'}};
  const review=req.medicalReview(leave,person,'2026-11-03',['2026-11-01']);assert.match(review.notification,/Day 1: notification recorded/);assert.match(review.notification,/Day 2: late notification/);
});

test('the browser annual balance also includes pilgrimage charged to annual and ignores no-pay',()=>{
  const code=fs.readFileSync('public/app.js','utf8');const snippet=code.slice(code.indexOf('function usedDays('),code.indexOf('function leaveBalance('));
  const year=new Date().getFullYear();const c={db:{leaves:[{employeeId:'A',type:'Umra',chargeType:'Annual',payBasis:'Annual',days:5,start:`${year}-01-01`,status:'Approved'},{employeeId:'A',type:'Umra',chargeType:'None',payBasis:'No pay',days:30,start:`${year}-02-01`,status:'Approved'}]},iso:d=>new Date(d).toISOString().slice(0,10),Date};vm.createContext(c);vm.runInContext(snippet,c);assert.equal(c.usedDays('A','Annual'),5);assert.equal(c.usedDays('A','Umra'),0);
});

test('overdue-document absence requires an explicit HR reason and cannot be combined with verification',()=>{
  const input={unauthorizedAbsence:true,reviewReason:'MC not submitted after return; reviewed with staff.'};
  assert.throws(()=>req.normalizeMedical(input,'Sick with MC','2026-10-20','2026-10-22'),/recorded return/);
  assert.throws(()=>req.normalizeMedical({...input,reviewReason:''},'Sick with MC','2026-10-20','2026-10-22','2026-10-22 06:50:00'),/HR reason/);
  const m=req.normalizeMedical(input,'Sick with MC','2026-10-20','2026-10-22','2026-10-22 06:50:00');assert.equal(m.reviewedBy,'Administrator');assert.equal(m.unauthorizedAbsence,true);assert.ok(m.reviewedAt);
});
test('HR-reviewed unauthorized days stop consuming paid sick allowance',()=>{
  const leaves=[{employeeId:'A',type:'Sick with MC',days:5,usedDays:5,status:'Completed',start:'2026-01-01',medical:{unauthorizedAbsence:true}}];assert.equal(p.sickUsage(leaves,'A',undefined,2026).total,0);assert.equal(p.usedDaysForType(leaves,'A','Sick with MC',undefined,2026),0);
});
test('attendance reflects an HR absence decision and preserves the actual return punch',()=>{
  const s=fixture();s.leaves=[{id:'L',employeeId:'A',type:'Sick with MC',start:'2026-10-26',end:'2026-10-28',days:2,status:'Completed',returnedAt:'2026-10-28 06:50:00',medical:{unauthorizedAbsence:true}}];
  const code=fs.readFileSync('public/app.js','utf8');const c={db:s,attState:{staff:'all'},today:new Date('2026-11-01'),iso:d=>new Date(d).toISOString().slice(0,10),eachDate:()=>['2026-10-26','2026-10-27'],Date,Map};c.db.attendance=[];
  vm.createContext(c);vm.runInContext(code.slice(code.indexOf('function buildAttendanceRows('),code.indexOf('function attStatusTag(')),c);assert.equal(c.buildAttendanceRows()[0].status,'Absent');assert.equal(c.buildAttendanceRows()[1].status,'Absent');
});

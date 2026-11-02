const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/leave-policy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject});
const p=exportsObject;
test('allowances match the supplied leave guide',()=>{
  for(const [type,days] of Object.entries({Family:10,Annual:30,Hajj:0,Umra:0,Paternity:30,'Sick with MC':30,'Sick without MC':15}))assert.equal(p.entitlementFor(type,{}),days);
  assert.equal(p.entitlementFor('Circumcision',{gender:'Female'}),5);
  assert.equal(p.entitlementFor('Circumcision',{gender:'Male'}),5);
  assert.equal(p.entitlementFor('Circumcision',{}),5);
});
test('Family and Annual skip Friday/Saturday and configured closures without double counting',()=>{
  for(const type of ['Family','Annual','Sick with MC','Sick without MC'])assert.equal(p.planLeave(type,'2026-10-29',2,['2026-10-30','2026-11-01']).end,'2026-11-03');
});
test('Hajj, Umra and Paternity count weekends but skip holidays',()=>{
  for(const type of ['Hajj','Umra','Paternity'])assert.equal(p.planLeave(type,'2026-10-29',3,['2026-10-30']).end,'2026-11-02');
});
test('Circumcision includes weekends and excludes holidays',()=>{
  assert.equal(p.planLeave('Circumcision','2026-10-29',3,['2026-10-30']).end,'2026-11-02');
});
test('Maternity uses six calendar months, clamps month end, and extends for holidays',()=>{
  assert.equal(p.planLeave('Maternity','2026-01-31',1,[]).end,'2026-07-31');
  assert.equal(p.planLeave('Maternity','2026-08-31',1,[]).end,'2027-02-28');
  assert.equal(p.planLeave('Maternity','2026-01-31',1,['2026-02-01']).end,'2026-08-01');
  assert.notEqual(p.planLeave('Maternity','2026-01-31',1,[]).days,180);
});
test('sick usage combines MC and non-MC, reserves pending leave and scopes to start year',()=>{
  const leaves=[{id:'1',employeeId:'A',type:'Sick without MC',days:15,status:'Approved',start:'2026-02-01'},{id:'2',employeeId:'A',type:'Sick with MC',days:15,status:'Pending',start:'2026-03-01'},{id:'3',employeeId:'A',type:'Sick with MC',days:20,status:'Completed',start:'2025-02-01'}];
  const usage=p.sickUsage(leaves,'A',undefined,2026);
  assert.equal(usage.withoutMc,15);assert.equal(usage.total,30);
  assert.equal(p.sickUsage(leaves,'A','2',2026).total,15);
  assert.equal(p.sickUsage(leaves,'B',undefined,2026).total,0);
});
test('invalid dates and invalid day quantities are rejected',()=>{
  for(const start of ['2026-02-30','invalid'])assert.throws(()=>p.planLeave('Annual',start,1));
  for(const days of [0,-1,Infinity,367,0.25])assert.throws(()=>p.planLeave('Annual','2026-01-01',days));
});

test('without-MC leave allows two days but rejects three in one request',()=>{
  assert.equal(p.planLeave('Sick without MC','2026-11-01',2).end,'2026-11-03');
  assert.throws(()=>p.planLeave('Sick without MC','2026-11-01',3),/2 consecutive/);
});
test('adjacent without-MC requests cannot evade the consecutive-day limit',()=>{
  const previous={id:'a',employeeId:'A',type:'Sick without MC',start:'2026-11-01',end:'2026-11-03',days:2,status:'Approved'};
  const next={employeeId:'A',type:'Sick without MC',start:'2026-11-03',end:'2026-11-04',days:1,status:'Pending'};
  assert.throws(()=>p.validateSickWithoutMcRun([previous],next),/2 consecutive/);
  assert.doesNotThrow(()=>p.validateSickWithoutMcRun([{...previous,status:'Declined'}],next));
  assert.doesNotThrow(()=>p.validateSickWithoutMcRun([{...previous,employeeId:'B'}],next));
});
test('weekends and holidays join adjacent leave days but real working gaps break the run',()=>{
  const previous={id:'a',employeeId:'A',type:'Sick without MC',start:'2026-10-28',end:'2026-10-30',days:2,status:'Completed',returnedAt:'2026-10-30 07:00:00'};
  const next={employeeId:'A',type:'Sick without MC',start:'2026-11-02',end:'2026-11-03',days:1,status:'Approved'};
  assert.throws(()=>p.validateSickWithoutMcRun([previous],next,['2026-11-01']),/2 consecutive/);
  assert.doesNotThrow(()=>p.validateSickWithoutMcRun([previous],next,[]));
});
test('editing a request excludes its previous dates from consecutive checks',()=>{
  const previous={id:'a',employeeId:'A',type:'Sick without MC',start:'2026-11-01',end:'2026-11-03',days:2,status:'Approved'};
  const changed={...previous,start:'2026-11-03',end:'2026-11-05'};
  assert.doesNotThrow(()=>p.validateSickWithoutMcRun([previous],changed,[],'a'));
});

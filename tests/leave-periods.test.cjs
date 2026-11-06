const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/leave-periods.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject});
const {leavePeriod,inLeavePeriod,defaultLeavePeriodRules}=exportsObject;
const person={joinedOn:'2020-07-15'};

test('joining cycles renew after the anniversary ends, with stable opening-balance keys',()=>{
 const previous=leavePeriod(person,'Annual','2026-07-15'),current=leavePeriod(person,'Annual','2026-07-16');
 assert.equal(previous.start,'2025-07-16');assert.equal(previous.end,'2026-07-16');assert.equal(current.start,'2026-07-16');assert.equal(current.end,'2027-07-16');assert.equal(current.key,'Service year:2026-07-15');assert.equal(current.label,'2026-07-16 – 2027-07-15');assert.equal(current.resetsOn,'2027-07-16');
 assert.equal(leavePeriod(person,'Family','2026-12-31').key,leavePeriod(person,'Family','2027-01-01').key);
 assert.equal(inLeavePeriod('2027-07-15',current),true);assert.equal(inLeavePeriod('2027-07-16',current),false);assert.equal(inLeavePeriod('2026-07-15',current),false);
});

test('legacy calendar buckets have January boundaries while CSC types ignore stale calendar overrides',()=>{
 const p={...person,leavePeriodRules:{Medical:'Calendar year',Annual:'Calendar year',Family:'Calendar year','Sick with MC':'Calendar year','Sick without MC':'Calendar year'}};
 const medical=leavePeriod(p,'Medical','2026-12-31');assert.equal(medical.start,'2026-01-01');assert.equal(medical.end,'2027-01-01');assert.equal(medical.key,'Calendar year:2026-01-01');assert.equal(leavePeriod(p,'Medical','2027-01-01').start,'2027-01-01');
 for(const type of ['Annual','Family','Sick with MC','Sick without MC']){const result=leavePeriod(p,type,'2026-12-31');assert.equal(result.basis,'Service year',type);assert.equal(result.start,'2026-07-16',type);assert.equal(result.end,'2027-07-16',type);}
});

test('both sick types always share the CSC service period even when saved old configurations disagree',()=>{
 for(const basis of ['Service year','Calendar year']){
  const p={...person,leavePeriodRules:{'Sick with MC':basis,'Sick without MC':basis==='Service year'?'Calendar year':'Service year'}};
  const withMC=leavePeriod(p,'Sick with MC','2026-11-03'),withoutMC=leavePeriod(p,'Sick without MC','2026-11-03');assert.equal(withMC.key,withoutMC.key);assert.equal(withMC.basis,'Service year');assert.equal(withMC.start,'2026-07-16');
 }
});

test('leap-day joining anniversaries renew on March 1 without drifting in later leap years',()=>{
 const p={joinedOn:'2020-02-29'};
 assert.equal(leavePeriod(p,'Annual','2023-02-28').start,'2022-03-01');assert.equal(leavePeriod(p,'Annual','2023-03-01').start,'2023-03-01');assert.equal(leavePeriod(p,'Annual','2024-02-29').end,'2024-03-01');assert.equal(leavePeriod(p,'Annual','2024-03-01').start,'2024-03-01');assert.equal(leavePeriod(p,'Annual','2024-03-01').key,'Service year:2024-02-29');assert.equal(leavePeriod(p,'Annual','2024-03-01').end,'2025-03-01');
});

test('missing or invalid service date requires setup while calendar buckets need no joining date',()=>{
 for(const p of [{},{joinedOn:'2026-02-30'},{joinedOn:'invalid'}]){const result=leavePeriod(p,'Annual','2026-11-03');assert.equal(result.needsJoiningDate,true);assert.equal(result.start,'');assert.equal(result.key,'');assert.equal(inLeavePeriod('2026-11-03',result),false);}
 assert.equal(leavePeriod({leavePeriodRules:{Annual:'Calendar year'}},'Annual','2026-11-03').needsJoiningDate,true);assert.equal(leavePeriod({leavePeriodRules:{Medical:'Calendar year'}},'Medical','2026-11-03').start,'2026-01-01');
 for(const invalid of ['2026-02-30','invalid','2026-1-01'])assert.throws(()=>leavePeriod(person,'Annual',invalid));assert.equal(inLeavePeriod('2026-02-30',leavePeriod(person,'Annual','2026-11-03')),false);
});

test('approved service anchor overrides joining date and dates before the anchor are unavailable',()=>{
 const p={joinedOn:'2020-07-15',leaveYearAnchor:'2021-09-10'};
 const current=leavePeriod(p,'Family','2026-11-03');assert.equal(current.start,'2026-09-10');assert.equal(current.end,'2027-09-10');const before=leavePeriod(p,'Annual','2021-09-09');assert.equal(before.unavailable,true);assert.equal(before.start,'');assert.equal(before.end,'');assert.equal(leavePeriod(p,'Annual','2021-09-10').start,'2021-09-10');
});

test('CSC pre-May-1984 service follows May-April unless an approved cycle anchor overrides it',()=>{
 for(const type of ['Annual','Family','Sick with MC','Sick without MC']){
  const result=leavePeriod({joinedOn:'1979-09-10'},type,'2026-11-03');assert.equal(result.start,'2026-05-01',type);assert.equal(result.end,'2027-05-01',type);assert.equal(result.label,'2026-05-01 – 2027-04-30',type);
 }
 const approved=leavePeriod({joinedOn:'1979-09-10',leaveYearAnchor:'1982-06-20'},'Annual','2026-11-03');assert.equal(approved.start,'2026-06-20');assert.equal(approved.end,'2027-06-20');
 assert.equal(leavePeriod({joinedOn:'1979-09-10'},'Annual','1979-09-09').unavailable,true);
});

test('ambiguous historical joining cohort requires an approved anchor rather than inventing a cycle',()=>{
 for(const joinedOn of ['1984-05-01','1984-11-03','1985-05-01']){
  const result=leavePeriod({joinedOn},'Annual','2026-11-03');assert.equal(result.needsJoiningDate,true);assert.equal(result.key,'');assert.match(result.label,/Approved leave-cycle date required/);
  const approved=leavePeriod({joinedOn,leaveYearAnchor:'1985-07-15'},'Annual','2026-11-03');assert.equal(approved.start,'2026-07-15');assert.equal(approved.end,'2027-07-15');
 }
 assert.equal(leavePeriod({joinedOn:'1985-05-02'},'Annual','2026-11-03').start,'2026-05-03');
});

test('event categories have no yearly default and CSC annual categories remain service-year based',()=>{
 for(const type of ['Maternity','Paternity','Circumcision','Hajj','Umra','Duty travel','No pay'])assert.equal(defaultLeavePeriodRules[type],undefined);
 for(const type of ['Annual','Family','Sick with MC','Sick without MC'])assert.equal(defaultLeavePeriodRules[type],'Service year');
});

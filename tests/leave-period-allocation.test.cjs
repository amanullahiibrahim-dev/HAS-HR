const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/leave-period-allocation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject});
const allocate=exportsObject.allocatedLeaveDays;
const annual=(start,end,days,extra={})=>({type:'Annual',status:'Approved',start,end,days,...extra});
const period=(start,end)=>({start,end});

test('calendar boundary allocates each eligible day to exactly one year',()=>{
 const leave=annual('2026-12-29','2027-01-04',4),previous=period('2026-01-01','2027-01-01'),next=period('2027-01-01','2028-01-01');
 assert.equal(allocate(leave,previous,[],true),3);assert.equal(allocate(leave,next,[],true),1);assert.equal(allocate(leave,previous,[],true)+allocate(leave,next,[],true),4);
});
test('service anniversary divides one leave record across adjacent entitlement periods',()=>{
 const leave=annual('2026-07-13','2026-07-18',5),old=period('2025-07-15','2026-07-15'),current=period('2026-07-15','2027-07-15');
 assert.equal(allocate(leave,old),2);assert.equal(allocate(leave,current),3);assert.equal(allocate(leave,period('2026-01-01','2027-01-01')),5);
});
test('Friday/Saturday and holidays consume no budget and are not counted twice',()=>{
 const leave=annual('2026-10-29','2026-11-04',3),holidays=['2026-10-30','2026-11-01'];
 assert.equal(allocate(leave,period('2026-10-01','2026-11-01'),holidays,true),1);assert.equal(allocate(leave,period('2026-11-01','2026-12-01'),holidays,true),2);
});
test('half-day remainder is allocated only on the final charged date',()=>{
 const leave=annual('2026-07-14','2026-07-16',1.5);
 assert.equal(allocate(leave,period('2025-07-15','2026-07-15')),1);assert.equal(allocate(leave,period('2026-07-15','2027-07-15')),0.5);
});
test('completed early return and saved actual usage cap the allocation',()=>{
 const leave=annual('2026-07-13','2026-07-20',7,{status:'Completed',returnedAt:'2026-07-16 07:00:00',usedDays:3});
 assert.equal(allocate(leave,period('2025-07-15','2026-07-15')),2);assert.equal(allocate(leave,period('2026-07-15','2027-07-15')),1);
 assert.equal(allocate({...leave,usedDays:2},period('2026-07-15','2027-07-15')),0);
});
test('completed same-day return retains at most the first covered day',()=>{
 const leave=annual('2026-07-14','2026-07-20',6,{status:'Completed',returnedAt:'2026-07-14 08:00:00',usedDays:1});
 assert.equal(allocate(leave,period('2026-07-01','2026-08-01')),1);
 assert.equal(allocate({...leave,usedDays:0},period('2026-07-01','2026-08-01')),0);
});
test('deductible budget and manual adjustment are never charged beyond their saved total',()=>{
 const leave=annual('2026-07-13','2026-07-20',7,{deductibleDays:2.5});
 assert.equal(allocate(leave,period('2026-07-01','2026-08-01')),2.5);assert.equal(allocate({...leave,status:'Completed',usedDays:1.5,returnedAt:'2026-07-20 07:00:00'},period('2026-07-01','2026-08-01')),1.5);
});
test('legacy missing end is charged to start period while invalid start or period contributes zero',()=>{
 assert.equal(allocate(annual('2026-07-14',undefined,3),period('2026-01-01','2027-01-01')),3);
 assert.equal(allocate(annual('2026-07-14','bad',3),period('2027-01-01','2028-01-01')),0);
 assert.equal(allocate(annual('2026-02-30',undefined,3),period('2026-01-01','2027-01-01')),0);
 assert.equal(allocate(annual('2026-07-14','2026-07-16',2),period('bad','2027-01-01')),0);
});
test('dates outside the requested period and unallocated days past actual return do not fabricate charges',()=>{
 assert.equal(allocate(annual('2026-07-14','2026-07-16',2),period('2026-08-01','2026-09-01')),0);
 assert.equal(allocate(annual('2026-07-14','2026-07-16',5),period('2026-01-01','2027-01-01')),2);
});
test('scan bound rejects malformed multi-year records rather than silently allocating a partial total',()=>{
 assert.throws(()=>allocate(annual('2000-01-01','2010-01-01',3000),period('2000-01-01','2010-01-01')),/too long/);
});

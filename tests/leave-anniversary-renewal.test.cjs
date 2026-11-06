const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');

// Synthetic in-memory state only. No personnel files, environment or live data are read.
function harness(){
 let now=Date.parse('2027-11-03T18:59:59.999Z'),writes=0;
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const cache={},store={people:[{id:'A',name:'Synthetic employee',joinedOn:'2026-11-03',role:'Admin Staff',devicePin:'01',annual:30,medical:0,casual:0}],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
 const mocks={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/auth':{isAdmin:()=>true,isSignedIn:()=>true,currentSession:()=>true?{kind:'admin'}:null,isSameOrigin:()=>true}};
 function load(name){
  if(cache[name])return cache[name];
  const exports={};cache[name]=exports;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mocks[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date:Clock,Map,Set,process,Buffer,Response,URL,Error,Intl});
  return exports;
 }
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{writes++;},makeId:()=>String(store.leaves.length+1)};
 const route=load('app/api/state/route');
 return {store,load,setTime:value=>{now=Date.parse(value);},writes:()=>writes,get:()=>route.GET(new Request('http://127.0.0.1/api/state'))};
}
const yearly=['Annual','Family','Sick with MC','Sick without MC'];
const opening=(type,days)=>({used:{[type]:days},revision:2,updatedAt:'2026-11-03T00:00:00Z',reason:'Synthetic historical opening'});
const leave=(id,type,start,end,days,status='Approved')=>({id,employeeId:'A',name:'Synthetic employee',type,start,end,days,status,reason:'Synthetic booking'});

test('joining day is valid, the whole anniversary remains in the first allowance, and renewal starts on November 4',()=>{
 const h=harness(),{leavePeriod,inLeavePeriod}=h.load('lib/leave-periods'),person=h.store.people[0];
 for(const type of yearly){
  const first=leavePeriod(person,type,'2026-11-03'),anniversary=leavePeriod(person,type,'2027-11-03'),renewed=leavePeriod(person,type,'2027-11-04');
  assert.equal(first.start,'2026-11-03',type);assert.equal(first.end,'2027-11-04',type);assert.equal(first.resetsOn,'2027-11-04',type);
  assert.equal(first.key,'Service year:2026-11-03',type);assert.equal(anniversary.key,first.key,type);assert.equal(inLeavePeriod('2027-11-03',first),true,type);
  assert.equal(renewed.start,'2027-11-04',type);assert.equal(renewed.end,'2028-11-04',type);assert.equal(renewed.key,'Service year:2027-11-03',type);
  assert.equal(inLeavePeriod('2027-11-04',first),false,type);assert.equal(inLeavePeriod('2027-11-04',renewed),true,type);
  assert.equal(leavePeriod(person,type,'2028-11-03').key,renewed.key,type);assert.equal(leavePeriod(person,type,'2028-11-04').start,'2028-11-04',type);
 }
});

test('the API renews at exactly Maldives midnight after November 3 without erasing opening balances or history',async()=>{
 const h=harness(),person=h.store.people[0],oldKey='Service year:2026-11-03';
 const days={Annual:9,Family:4,'Sick with MC':7,'Sick without MC':5};
 person.leavePeriodBalances=Object.fromEntries(yearly.map(type=>[type,{[oldKey]:opening(type,days[type])}]));
 person.leavePeriodChanges=[{at:'2026-11-03T00:00:00Z',actor:'Administrator',reason:'Synthetic historical entry',before:null,after:{joinedOn:person.joinedOn}}];
 h.store.leaves=[{...leave('H','Annual','2027-10-25','2027-10-27',2,'Completed'),usedDays:2}];
 h.store.leaveChanges=[{id:'audit',at:'2027-10-26T12:00:00Z',actor:'Administrator',reason:'Synthetic history',before:h.store.leaves[0],after:h.store.leaves[0]}];
 const snapshot=JSON.stringify({balances:person.leavePeriodBalances,periodChanges:person.leavePeriodChanges,leaves:h.store.leaves,leaveChanges:h.store.leaveChanges});
 let response=await h.get();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
 let state=await response.json(),balance=state.people[0].balancePeriods;
 assert.equal(balance.Annual.available,19);assert.equal(balance.Family.available,6);assert.equal(balance['Sick with MC'].available,18);assert.equal(balance['Sick without MC'].available,10);
 h.setTime('2027-11-03T19:00:00.000Z');response=await h.get();state=await response.json();balance=state.people[0].balancePeriods;
 for(const [type,max] of [['Annual',30],['Family',10],['Sick with MC',30],['Sick without MC',15]]){assert.equal(balance[type].available,max,type);assert.equal(balance[type].period.start,'2027-11-04',type);assert.equal(balance[type].period.end,'2028-11-04',type);}
 assert.equal(JSON.stringify({balances:person.leavePeriodBalances,periodChanges:person.leavePeriodChanges,leaves:h.store.leaves,leaveChanges:h.store.leaveChanges}),snapshot);
 assert.equal(h.writes(),0,'reading renewed allowances requires no destructive reset write');
});

test('future and cross-renewal bookings reserve only dates in their own allowance period',()=>{
 const h=harness(),person=h.store.people[0],policy=h.load('lib/leave-policy'),requirements=h.load('lib/leave-requirements');
 h.store.leaves=[leave('CROSS','Family','2027-11-02','2027-11-05',3),leave('FUTURE','Family','2027-11-07','2027-11-09',2,'Pending')];
 assert.equal(policy.periodBalance(person,h.store.leaves,'Family','2027-11-03').available,8);
 assert.equal(policy.periodBalance(person,h.store.leaves,'Family','2027-11-04').available,7);
 assert.doesNotThrow(()=>requirements.checkLeaveAllowance(h.store,person,leave('NEW','Family','2027-11-14','2027-11-24',7)));
 assert.throws(()=>requirements.checkLeaveAllowance(h.store,person,leave('EXCESS','Family','2027-11-14','2027-11-25',8)),/available/);
 const before=JSON.stringify(h.store.leaves);
 assert.equal(policy.periodBalance(person,h.store.leaves,'Family','2028-11-04').available,10);
 assert.equal(JSON.stringify(h.store.leaves),before);
});

test('a December 31 joining date renews on January 1 after the full following anniversary',()=>{
 const {leavePeriod}=harness().load('lib/leave-periods'),person={joinedOn:'2026-12-31'};
 const first=leavePeriod(person,'Annual','2026-12-31');assert.equal(first.start,'2026-12-31');assert.equal(first.end,'2028-01-01');assert.equal(first.key,'Service year:2026-12-31');
 assert.equal(leavePeriod(person,'Annual','2027-12-31').key,first.key);
 const next=leavePeriod(person,'Annual','2028-01-01');assert.equal(next.start,'2028-01-01');assert.equal(next.end,'2029-01-01');assert.equal(next.key,'Service year:2027-12-31');
});

test('February 29 uses the day after its clamped anniversary and recovers the leap-day bucket key',()=>{
 const {leavePeriod}=harness().load('lib/leave-periods'),person={joinedOn:'2024-02-29'};
 assert.equal(leavePeriod(person,'Family','2024-02-29').start,'2024-02-29');assert.equal(leavePeriod(person,'Family','2025-02-28').end,'2025-03-01');
 assert.equal(leavePeriod(person,'Family','2025-03-01').start,'2025-03-01');assert.equal(leavePeriod(person,'Family','2025-03-01').key,'Service year:2025-02-28');
 assert.equal(leavePeriod(person,'Family','2028-02-29').end,'2028-03-01');
 assert.equal(leavePeriod(person,'Family','2028-03-01').start,'2028-03-01');assert.equal(leavePeriod(person,'Family','2028-03-01').key,'Service year:2028-02-29');
});

test('approved anchors and historical May cycles keep their explicit renewal boundaries',()=>{
 const {leavePeriod}=harness().load('lib/leave-periods');
 const approved=leavePeriod({joinedOn:'2026-11-03',leaveYearAnchor:'2026-11-03'},'Annual','2027-11-03');assert.equal(approved.start,'2027-11-03');assert.equal(approved.end,'2028-11-03');
 const historic=leavePeriod({joinedOn:'1980-11-03'},'Family','2027-05-01');assert.equal(historic.start,'2027-05-01');assert.equal(historic.end,'2028-05-01');
});

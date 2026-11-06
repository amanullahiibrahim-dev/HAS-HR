const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 let writes=0,authenticated=true,sameOrigin=true,sequence=0;
 const store={people:[{id:'A',name:'Period Test Staff',role:'Teacher',dept:'School',devicePin:'001',annual:30,medical:15,casual:0,joinedOn:'2019-08-15',workStart:'07:00'}],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}},cache={};
 const mocks={'next/server':{NextResponse:{json:(data,options)=>new Response(JSON.stringify(data),{status:options?.status||200,headers:{'content-type':'application/json',...options?.headers}})}},'@/lib/auth':{isAdmin:()=>authenticated,isSignedIn:()=>authenticated,currentSession:()=>authenticated?{kind:'admin'}:null,isSameOrigin:()=>sameOrigin}};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mocks[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL,globalThis,Error});return exports;}
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{writes++},stateForClient:(value=store)=>actual.stateForClient(value),makeId:()=>String(++sequence)};
 const route=load('app/api/state/route'),preview=load('app/api/leave-preview/route'),periods=load('app/api/balance-periods/route');
 const send=payload=>route.POST(new Request('http://127.0.0.1/api/state',{method:'POST',body:JSON.stringify(payload)}));
 return {store,load,send,state:()=>route.GET(new Request('http://127.0.0.1/api/state')),preview:q=>preview.GET(new Request('http://127.0.0.1/api/leave-preview?'+new URLSearchParams(q))),periods:q=>periods.GET(new Request('http://127.0.0.1/api/balance-periods?'+new URLSearchParams(q))),save:(extra={})=>send({action:'employee.period-balances',id:'A',asOf:'2026-11-03',joinedOn:'2019-08-15',rules:{Annual:'Service year',Family:'Service year','Sick with MC':'Service year','Sick without MC':'Service year',Medical:'Calendar year'},used:{},expectedRevision:0,reason:'Approved opening register',...extra}),writes:()=>writes,deny:()=>{authenticated=false},crossOrigin:()=>{sameOrigin=false}};
}
const request=(type,start,days)=>({employeeId:'A',type,start,end:'2099-01-01',days,status:'Approved'});
async function saved(h,extra){const r=await h.save(extra);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function preview(h,type,start,days=1){const r=await h.preview({employeeId:'A',type,start,days:String(days)});assert.equal(r.status,200,await r.clone().text());return r.json();}

test('period balance save and GET use different calendar/service periods, save half days, audit and preserve raw records',async()=>{
 const h=harness(),originalLeaves=JSON.stringify(h.store.leaves),originalPunches=JSON.stringify(h.store.punches);
 const state=await saved(h,{used:{Family:2.5,Annual:20,'Sick with MC':8,'Sick without MC':4,Medical:3}}),person=state.people[0];
 assert.equal(person.leavePeriodBalances.Annual['Service year:2026-08-15'].used.Annual,20);assert.equal(person.leavePeriodBalances.Family['Service year:2026-08-15'].used.Family,2.5);assert.equal(person.leaveBalanceRevision,1);assert.equal(person.leavePeriodChanges.length,1);assert.equal(person.leavePeriodChanges[0].actor,'Administrator');assert.equal(person.leavePeriodChanges[0].reason,'Approved opening register');assert.equal(person.leavePeriodChanges[0].after.balances.Annual['Service year:2026-08-15'].used.Annual,20);
 const response=await h.periods({id:'A',asOf:'2026-11-03'});assert.equal(response.status,200);const result=await response.json(),annual=result.rows.find(row=>row.type==='Annual'),family=result.rows.find(row=>row.type==='Family'),medical=result.rows.find(row=>row.type==='Medical');assert.equal(annual.period.start,'2026-08-16');assert.equal(annual.period.end,'2027-08-16');assert.equal(annual.opening,20);assert.equal(family.period.start,'2026-08-16');assert.equal(family.period.end,'2027-08-16');assert.equal(family.opening,2.5);assert.equal(medical.period.start,'2026-01-01');assert.equal(medical.period.end,'2027-01-01');assert.equal(medical.opening,3);assert.equal(result.revision,1);
 assert.equal(JSON.stringify(h.store.leaves),originalLeaves);assert.equal(JSON.stringify(h.store.punches),originalPunches);assert.equal(h.writes(),1);
});

test('CSC Annual, Family and sick retain their service cycle across January while legacy Medical resets at January',async()=>{
 const h=harness();await saved(h,{used:{Annual:12.5,Family:6,'Sick with MC':8,'Sick without MC':4,Medical:5}});
 assert.equal((await preview(h,'Annual','2026-12-31')).available,17.5);assert.equal((await preview(h,'Annual','2027-01-04')).available,17.5);assert.equal((await preview(h,'Annual','2027-08-16')).available,30);
 assert.equal((await preview(h,'Family','2026-12-31')).available,4);assert.equal((await preview(h,'Family','2027-01-04')).available,4);assert.equal((await preview(h,'Family','2027-08-16')).available,10);assert.equal((await preview(h,'Medical','2026-12-31')).available,10);assert.equal((await preview(h,'Medical','2027-01-04')).available,15);
 assert.equal((await preview(h,'Sick with MC','2027-01-04')).available,18);assert.equal((await preview(h,'Sick without MC','2027-01-04')).available,11);assert.equal((await preview(h,'Sick with MC','2027-08-16')).available,30);
});

test('recorded leave is allocated across the service anniversary without charging all days to its start year',async()=>{
 const h=harness();await saved(h);
 const response=await h.send({action:'leave.create',leave:request('Annual','2027-08-12',3)});assert.equal(response.status,200,await response.clone().text());assert.equal(h.store.leaves[0].end,'2027-08-17');
 const old=await preview(h,'Annual','2027-08-11'),next=await preview(h,'Annual','2027-08-18');assert.equal(old.used,2);assert.equal(old.available,28);assert.equal(next.used,1);assert.equal(next.available,29);
});

test('preview and save both reject leave spanning a future exhausted balance period',async()=>{
 const h=harness();await saved(h,{asOf:'2027-08-16',used:{Annual:30}});
 const p=await h.preview({employeeId:'A',type:'Annual',start:'2027-08-12',days:'3'});assert.equal(p.status,400);assert.match((await p.json()).error,/2027-08-16/);
 const writes=h.writes(),response=await h.send({action:'leave.create',leave:request('Annual','2027-08-12',3)});assert.equal(response.status,400);assert.match((await response.json()).error,/2027-08-16/);assert.equal(h.store.leaves.length,0);assert.equal(h.writes(),writes);
});

test('both sick types share the period and total cap, and without-MC retains its own sublimit',async()=>{
 const h=harness();await saved(h,{used:{'Sick with MC':20,'Sick without MC':10}});
 for(const type of ['Sick with MC','Sick without MC']){assert.equal((await h.preview({employeeId:'A',type,start:'2026-11-04',days:'1'})).status,400);assert.equal((await h.send({action:'leave.create',leave:request(type,'2026-11-04',1)})).status,400);}
 const bad=harness();assert.equal((await bad.save({used:{'Sick with MC':20,'Sick without MC':11}})).status,400);assert.equal(bad.writes(),0);assert.equal(bad.store.people[0].leavePeriodBalances,undefined);
 const sublimit=harness();assert.equal((await sublimit.save({used:{'Sick without MC':15.5}})).status,400);assert.equal(sublimit.writes(),0);
 const mismatch=harness();assert.equal((await mismatch.save({rules:{'Sick with MC':'Service year','Sick without MC':'Calendar year'}})).status,400);assert.equal(mismatch.writes(),0);
});

test('missing joining date retains the return-date preview while blocking an unvalidated save',async()=>{
 const h=harness();delete h.store.people[0].joinedOn;
 const stateResponse=await h.state();assert.equal(stateResponse.status,200);const state=await stateResponse.json();assert.equal(state.people[0].balancePeriods.Annual.available,null);assert.equal(state.people[0].balancePeriods.Annual.period.needsJoiningDate,true);
 const p=await h.preview({employeeId:'A',type:'Annual',start:'2026-11-03',days:'1'});assert.equal(p.status,400);const result=await p.json();assert.match(result.error,/Joining date/);assert.equal(result.preview.end,'2026-11-04');assert.equal(result.preview.days,1);
 assert.equal((await h.send({action:'leave.create',leave:request('Annual','2026-11-03',1)})).status,400);assert.equal((await h.save({joinedOn:''})).status,400);assert.equal(h.writes(),0);
});

test('joining and approved anchor validation and stale period changes fail atomically',async()=>{
 for(const extra of [{joinedOn:'2026-02-30'},{leaveYearAnchor:'2026-02-30'},{joinedOn:'2026-11-04',leaveYearAnchor:''},{leaveYearAnchor:'2027-01-01'},{asOf:'2026-02-30'},{used:{Family:-1}},{used:{Family:0.25}},{used:{Family:'2'}},{used:{Circumcision:1}}]){const h=harness(),response=await h.save(extra);assert.equal(response.status,400,JSON.stringify(extra));assert.equal(h.writes(),0);assert.equal(h.store.people[0].leavePeriodBalances,undefined);}
 const h=harness();await saved(h,{leaveYearAnchor:'2020-09-10',used:{Annual:1.5}});assert.equal(h.store.people[0].leavePeriodBalances.Annual['Service year:2026-09-10'].used.Annual,1.5);
 const stale=await h.save({used:{Annual:3},expectedRevision:0});assert.equal(stale.status,400);assert.equal(h.writes(),1);assert.equal(h.store.people[0].leaveBalanceRevision,1);
 await saved(h,{leaveYearAnchor:'2020-09-10',used:{Annual:2.5},expectedRevision:1,reason:'Corrected register'});assert.equal(h.store.people[0].leavePeriodChanges.length,2);assert.equal(h.store.people[0].leavePeriodChanges[1].before.balances.Annual['Service year:2026-09-10'].used.Annual,1.5);assert.equal(h.store.people[0].leavePeriodBalances.Annual['Service year:2026-09-10'].used.Annual,2.5);
});

test('zero old year-only entries do not transfer; nonzero legacy usage requires explicit review before preview',async()=>{
 const zero=harness();zero.store.people[0].leaveOpeningBalances={'2026':{used:{Annual:0},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Old zero entry'}};const clean=await preview(zero,'Annual','2026-11-03');assert.equal(clean.available,30);assert.equal(zero.store.people[0].leavePeriodBalances,undefined);
 const h=harness();h.store.people[0].leaveOpeningBalances={'2026':{used:{Annual:8},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Old calendar balance'}};
 const state=await (await h.state()).json();assert.equal(state.people[0].balancePeriods.Annual.available,null);const rejected=await h.preview({employeeId:'A',type:'Annual',start:'2026-11-03',days:'1'});assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/Review earlier year-only/);assert.equal(h.store.people[0].leavePeriodBalances,undefined);
 const review=await h.periods({id:'A',asOf:'2026-11-03'});assert.equal(review.status,200);assert.equal((await review.json()).legacy['2026'].used.Annual,8);
 await saved(h,{used:{Annual:0},reason:'Reviewed old record: belongs outside current service period'});assert.equal((await preview(h,'Annual','2026-11-03')).available,30);assert.equal(h.store.people[0].leaveOpeningBalances['2026'].used.Annual,8);
 const correct=harness();correct.store.people[0].leaveOpeningBalances={'2026':{used:{Annual:8},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Old calendar balance'}};await saved(correct,{used:{Annual:6.5},reason:'Reviewed service-period opening amount'});assert.equal((await preview(correct,'Annual','2026-11-03')).available,23.5);
});

test('period balance writes require administrator and same origin; drafts require administrator and reject bad input',async()=>{
 const denied=harness();denied.deny();assert.equal((await denied.save()).status,401);assert.equal((await denied.periods({id:'A',asOf:'2026-11-03'})).status,401);assert.equal(denied.writes(),0);
 const cross=harness();cross.crossOrigin();assert.equal((await cross.save()).status,403);assert.equal(cross.writes(),0);
 for(const q of [{id:'missing',asOf:'2026-11-03'},{id:'A',asOf:'invalid'},{id:'A',asOf:'2026-11-03',rules:'not-json'},{id:'A',asOf:'2026-11-03',rules:JSON.stringify({Annual:'Other'})}]){const h=harness();assert.equal((await h.periods(q)).status,400);assert.equal(h.writes(),0);}
});


test('unreviewed without-MC legacy opening makes both shared sick balances require review without breaking state',async()=>{
 const h=harness();h.store.people[0].leaveOpeningBalances={'2026':{used:{'Sick without MC':4},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Old sick register'}};
 const response=await h.state();assert.equal(response.status,200);const state=await response.json();assert.equal(state.people[0].balancePeriods['Sick with MC'].available,null);assert.equal(state.people[0].balancePeriods['Sick without MC'].available,null);
 assert.equal((await h.preview({employeeId:'A',type:'Sick with MC',start:'2026-11-03',days:'1'})).status,400);
 await saved(h,{used:{'Sick without MC':3.5},reason:'Sick register reviewed for service period'});assert.equal((await preview(h,'Sick with MC','2026-11-03')).available,26.5);
});


test('legacy review uses real calendar-period overlap and does not spill next-year usage into the prior calendar period',async()=>{
 const h=harness();h.store.people[0].leavePeriodRules={Medical:'Calendar year'};h.store.people[0].leaveOpeningBalances={'2027':{used:{Medical:3},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Future calendar opening'}};
 const prior=await preview(h,'Medical','2026-12-31');assert.equal(prior.available,15);assert.equal(prior.balancePeriod.start,'2026-01-01');assert.equal(prior.balancePeriod.end,'2027-01-01');
 const overlapping=await h.preview({employeeId:'A',type:'Medical',start:'2027-01-04',days:'1'});assert.equal(overlapping.status,400);assert.match((await overlapping.json()).error,/Review earlier year-only/);
 assert.equal(h.writes(),0);assert.equal(h.store.people[0].leavePeriodBalances,undefined);
});


test('CSC calendar overrides are rejected by the write and draft APIs without mutating balances',async()=>{
 for(const type of ['Annual','Family','Sick with MC','Sick without MC']){
  const h=harness();let response=await h.save({rules:{[type]:'Calendar year'}});assert.equal(response.status,400,type);assert.match((await response.json()).error,/CSC|Service year|service year/i);assert.equal(h.writes(),0);assert.equal(h.store.people[0].leavePeriodBalances,undefined);
  response=await h.periods({id:'A',asOf:'2026-11-03',rules:JSON.stringify({[type]:'Calendar year'})});assert.equal(response.status,400,type);
 }
});

test('stale saved CSC calendar configuration cannot change computed state or preview service periods',async()=>{
 const h=harness(),person=h.store.people[0];person.leavePeriodRules={Annual:'Calendar year',Family:'Calendar year','Sick with MC':'Calendar year','Sick without MC':'Calendar year'};
 person.leavePeriodBalances={Annual:{'Service year:2026-08-15':{used:{Annual:8},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Reviewed CSC service opening'},'Calendar year:2026-01-01':{used:{Annual:25},revision:1,updatedAt:'2026-11-01T00:00:00Z',reason:'Obsolete calendar opening'}}};
 const response=await h.state();assert.equal(response.status,200);const state=await response.json();for(const type of ['Annual','Family','Sick with MC','Sick without MC']){assert.equal(state.people[0].balancePeriods[type].period.basis,'Service year',type);assert.equal(state.people[0].balancePeriods[type].period.start,'2026-08-16',type);}
 const annual=await preview(h,'Annual','2027-01-04');assert.equal(annual.available,22);assert.equal(annual.balancePeriod.start,'2026-08-16');assert.equal(h.writes(),0);
});


test('period balances save without a reason field and keep an automatic audit description',async()=>{
 for(const reason of [undefined,'','   ']){
  const h=harness();const state=await saved(h,{used:{Annual:2.5},reason});const person=state.people[0],entry=person.leavePeriodBalances.Annual['Service year:2026-08-15'];
  assert.equal(entry.used.Annual,2.5);assert.equal(entry.reason,'Opening balances updated');assert.equal(person.leavePeriodChanges.length,1);assert.equal(person.leavePeriodChanges[0].reason,'Opening balances updated');assert.equal(person.leavePeriodChanges[0].actor,'Administrator');assert.equal(person.leavePeriodChanges[0].after.balances.Annual['Service year:2026-08-15'].reason,'Opening balances updated');assert.equal(h.writes(),1);
 }
});

test('optional supplied balance reasons are preserved while oversized reasons are rejected atomically',async()=>{
 const h=harness(),state=await saved(h,{used:{Family:1},reason:'  Opening register confirmed  '});assert.equal(state.people[0].leavePeriodChanges[0].reason,'Opening register confirmed');assert.equal(state.people[0].leavePeriodBalances.Family['Service year:2026-08-15'].reason,'Opening register confirmed');
 const bad=harness(),before=JSON.stringify(bad.store.people[0]);const response=await bad.save({reason:'x'.repeat(1001)});assert.equal(response.status,400);assert.equal(bad.writes(),0);assert.equal(JSON.stringify(bad.store.people[0]),before);
});

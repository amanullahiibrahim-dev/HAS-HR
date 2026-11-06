const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 const store={people:[{id:'A',name:'Staff',devicePin:'01',role:'Teacher',joinedOn:'2019-01-01'}],punches:[],leaves:[],device:{lastSeen:null,serial:null,count:0}},cache={};let writes=0,admin=true,origin=true;
 const mocks={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/auth':{isAdmin:()=>admin,isSignedIn:()=>admin,currentSession:()=>admin?{kind:'admin'}:null,isSameOrigin:()=>origin}};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mocks[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,Buffer,process,Response,URL,Error,globalThis});return exports;}
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>writes++,makeId:()=> 'REVIEW'};
 const route=load('app/api/state/route'),punches=load('lib/punches');
 const punch=(time,type='ATT IN',date='2026-11-02')=>punches.normalizePunch({pin:'01',serial:'TEST',timestamp:date+' '+time,state:type==='ATT IN'?0:1,eventType:type});
 store.punches=[punch('06:55:00'),punch('08:15:00'),punch('14:00:00','ATT OUT')];store.device.count=3;
 const row=()=>actual.stateForClient(store).attendance[0];
 const entry=index=>{const current=row();return {employeeId:'A',date:'2026-11-02',punchId:store.punches[index].id,reason:'Duplicate fingerprint log',expected:{checkIn:current.checkIn,checkOut:current.checkOut,correctionId:current.correctionId}};};
 const send=entry=>route.POST(new Request('http://127.0.0.1/api/state',{method:'POST',body:JSON.stringify({action:'punch.deny',entry})}));
 return {store,load,punch,row,entry,send,writes:()=>writes,denyAuth:()=>admin=false,crossOrigin:()=>origin=false};
}
test('deny an extra IN retains one IN/OUT, original data, audit and denial through retry and reload',async()=>{
 const h=harness(),raw=h.store.punches.map(p=>({...p}));let response=await h.send(h.entry(1));assert.equal(response.status,200);const state=await response.json();
 assert.equal(state.attendance[0].checkIn,'06:55');assert.equal(state.attendance[0].checkOut,'14:00');assert.equal(h.store.punches.filter(p=>!p.denied).length,2);assert.equal(h.store.punches[1].denied.actor,'Administrator');assert.equal(h.store.punches[1].denied.reason,'Duplicate fingerprint log');
 for(let i=0;i<3;i++)for(const key of ['id','timestamp','kind','pin','state','serial'])assert.equal(h.store.punches[i][key],raw[i][key]);
 h.load('lib/punches').ingestPunches(h.store,[h.punch('08:15:00')]);assert.ok(h.store.punches[1].denied);assert.equal(h.store.punches.length,3);
 const restored=JSON.parse(JSON.stringify(h.store));assert.equal(h.load('lib/attendance').attendanceForClient(restored)[0].punches[1].denied.reason,'Duplicate fingerprint log');
 response=await h.send(h.entry(1));assert.equal(response.status,400);assert.equal(h.writes(),1);
});
test('denying the first IN recalculates arrival, late minutes and hours; denying all IN never invents presence',async()=>{
 const h=harness();assert.equal((await h.send(h.entry(0))).status,200);assert.equal(h.row().checkIn,'08:15');assert.equal(h.row().status,'Late');assert.equal(h.row().workedMins,345);
 assert.equal((await h.send(h.entry(1))).status,200);assert.equal(h.row().checkIn,'—');assert.equal(h.row().checkOut,'14:00');assert.equal(h.row().status,'Incomplete');assert.equal(h.row().workedMins,0);
 assert.equal((await h.send(h.entry(2))).status,200);assert.match(h.row().note,/denied/);assert.equal(h.row().status,'Incomplete');
});
test('denials require authentication, same origin, correct ownership/date, reason and current attendance',async()=>{
 const a=harness();a.denyAuth();assert.equal((await a.send(a.entry(1))).status,401);assert.equal(a.writes(),0);
 const b=harness();b.crossOrigin();assert.equal((await b.send(b.entry(1))).status,403);assert.equal(b.writes(),0);
 for(const changes of [{employeeId:'B'},{date:'2026-11-01'},{punchId:'missing'},{reason:''},{reason:'x'.repeat(1001)},{expected:{checkIn:'09:00',checkOut:'14:00',correctionId:null}}]){const h=harness();assert.equal((await h.send({...h.entry(1),...changes})).status,400);assert.equal(h.writes(),0);assert.ok(h.store.punches.every(p=>!p.denied));}
});
test('denied events no longer establish automatic leave return and a changed derived return is audited',async()=>{
 const h=harness();h.store.leaves=[{id:'L',employeeId:'A',name:'Staff',type:'Annual',start:'2026-11-01',end:'2026-11-05',days:3,status:'Completed',returnedAt:'2026-11-02 06:55:00',usedDays:1}];
 assert.equal((await h.send(h.entry(0))).status,200);assert.equal(h.store.leaves[0].returnedAt,'2026-11-02 08:15:00');assert.equal(h.store.leaveChanges.length,1);
 assert.equal((await h.send(h.entry(1))).status,200);assert.equal(h.store.leaves[0].status,'Approved');assert.equal(h.store.leaves[0].returnedAt,undefined);
 h.load('lib/punches').ingestPunches(h.store,[h.punch('06:55:00'),h.punch('08:15:00')]);assert.equal(h.store.leaves[0].status,'Approved');
});


test('manual IN and OUT can be denied independently and evidence remains auditable',async()=>{
 const h=harness();h.store.punches=[];
 h.store.corrections=[{id:'MANUAL',employeeId:'A',date:'2026-11-03',actor:'Administrator',createdAt:'2026-11-03T10:00:00Z',reason:'Forgot punches',changes:{checkIn:'06:55',checkOut:'14:00'},before:{checkIn:'—',checkOut:'—'},after:{checkIn:'06:55',checkOut:'14:00'},originalPunches:[]}];
 const input=field=>{const row=h.row();return {employeeId:'A',date:'2026-11-03',correctionId:'MANUAL',field,reason:'Wrong manual punch',expected:{checkIn:row?.checkIn||'—',checkOut:row?.checkOut||'—',correctionId:row?.correctionId||null}};};
 assert.equal((await h.send(input('checkIn'))).status,200);assert.equal(h.row().checkIn,'—');assert.equal(h.row().checkOut,'14:00');assert.equal(h.row().status,'Incomplete');
 assert.equal(h.store.corrections[0].changes.checkIn,'06:55');assert.equal(h.store.corrections[0].denied.checkIn.reason,'Wrong manual punch');assert.equal(h.store.corrections[0].denied.checkOut,undefined);
 assert.equal((await h.send(input('checkOut'))).status,200);assert.equal(h.row(),undefined);assert.equal(h.store.corrections[0].denied.checkOut.actor,'Administrator');
 const restored=JSON.parse(JSON.stringify(h.store));assert.equal(h.load('lib/attendance').attendanceForClient(restored).length,0);
 assert.equal((await h.send(input('checkIn'))).status,400);assert.equal(h.writes(),2);
});
test('denying a manual override falls back to the original machine punch and rejects cross-staff or stale decisions',async()=>{
 const h=harness();h.store.corrections=[{id:'M',employeeId:'A',date:'2026-11-02',actor:'Administrator',createdAt:'now',reason:'Correction',changes:{checkIn:'06:50'},before:{checkIn:'06:55',checkOut:'14:00'},after:{checkIn:'06:50',checkOut:'14:00'},originalPunches:[]}];
 const row=h.row(),entry={employeeId:'A',date:'2026-11-02',correctionId:'M',field:'checkIn',reason:'Incorrect correction',expected:{checkIn:row.checkIn,checkOut:row.checkOut,correctionId:row.correctionId}};
 for(const extra of [{field:'checkOut'},{field:'garbage'},{employeeId:'B'},{date:'2026-11-01'},{reason:''},{expected:{checkIn:'06:55',checkOut:'14:00',correctionId:null}}]){assert.equal((await h.send({...entry,...extra})).status,400);assert.equal(h.writes(),0);}
 assert.equal((await h.send(entry)).status,200);assert.equal(h.row().checkIn,'06:55');assert.equal(h.store.punches.length,3);
});

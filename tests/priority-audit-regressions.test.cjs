const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 const cache={},store={people:[{id:'A',name:'Staff A',role:'Admin Staff',devicePin:'01',annual:30,medical:0,casual:0}],punches:[],leaves:[],holidays:[],device:{lastSeen:null,serial:'TEST',count:0}};
 const mocks={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/auth':{isAdmin:()=>true,isSignedIn:()=>true,currentSession:()=>true?{kind:'admin'}:null,isSameOrigin:()=>true}};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>mocks[n]||(n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n)),Date,Map,Set,process,Buffer,Response,URL});return exports;}
 const actual=load('lib/store');cache['lib/store']={...actual,readStore:()=>store,writeStore:()=>{},makeId:()=> 'FIXTURE-ID'};
 const route=load('app/api/state/route');
 return {store,load,send:payload=>route.POST(new Request('http://127.0.0.1/api/state',{method:'POST',body:JSON.stringify(payload)}))};
}
function log(h,date,time,eventType,pin='01'){return h.load('lib/punches').normalizePunch({serial:'TEST',pin,timestamp:date+' '+time,state:0,...(eventType?{eventType}:{})});}
function leave(h,days=2){h.store.leaves=[{id:'L',employeeId:'A',name:'Staff A',type:'Annual',start:'2026-10-04',end:days===1?'2026-10-05':'2026-10-06',days,status:'Approved'}];return h.store.leaves[0];}
function browser(h,dates){const source=fs.readFileSync('public/app.js','utf8'),context={db:h.load('lib/store').stateForClient(h.store),attState:{staff:'all'},eachDate:()=>dates,today:new Date('2026-11-01'),iso:d=>new Date(d).toISOString().slice(0,10),staffStart:()=> '08:00',Date,Map};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function buildAttendanceRows('),source.indexOf('function attStatusTag(')),context);return context.buildAttendanceRows();}
test('unlabelled overnight punches never hide lateness, create hours, or finish leave',()=>{
 const h=harness(),l=leave(h);const incoming=['02:01:52','08:20:00','23:56:22'].map(t=>log(h,'2026-10-05',t));h.load('lib/punches').ingestPunches(h.store,incoming);
 const row=h.load('lib/attendance').attendanceForClient(h.store)[0];assert.equal(row.status,'Incomplete');assert.equal(row.lateMins,0);assert.equal(row.workedMins,0);assert.equal(l.status,'Approved');assert.equal(l.returnedAt,undefined);
 h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-05','08:20:00','ATT IN'),log(h,'2026-10-05','23:56:22','ATT OUT')]);const labelled=h.load('lib/attendance').attendanceForClient(h.store)[0];assert.equal(labelled.status,'Late');assert.equal(labelled.checkIn,'08:20');assert.equal(labelled.lateMins,20);assert.equal(l.usedDays,1);
});
test('start-day IN cannot erase a one-day leave and review is visible to the administrator',()=>{
 const h=harness(),l=leave(h,1);h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-04','07:20:00','ATT IN')]);assert.equal(l.status,'Approved');assert.equal(l.usedDays,undefined);assert.match(h.load('lib/store').stateForClient(h.store).leaves[0].returnReview,/start date/);
 h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-05','07:20:00','ATT IN')]);assert.equal(l.status,'Completed');assert.equal(l.usedDays,1);assert.equal(l.returnedAt,'2026-10-05 07:20:00');
});
test('late return charges only authorized days and excess days show absence in daily and period reports',()=>{
 const h=harness(),l=leave(h);h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-04','09:00:00','OT IN'),log(h,'2026-10-12','07:20:00','ATT IN'),log(h,'2026-10-12','16:00:00','ATT OUT')]);assert.equal(l.usedDays,2);assert.equal(l.returnedAt,'2026-10-12 07:20:00');assert.match(h.load('lib/store').stateForClient(h.store).leaves[0].returnReview,/after approved/);
 const rows=browser(h,['2026-10-05','2026-10-06','2026-10-07','2026-10-09','2026-10-12']);assert.equal(rows[0].status,'On leave');assert.equal(rows[1].status,'Absent');assert.equal(rows[2].status,'Absent');assert.equal(rows[3].status,'Weekend');assert.equal(rows[4].status,'Present');
});
test('same-day completed leave recalculation does not remove a full working-day charge',()=>{
 const h=harness(),l=leave(h,1);assert.equal(h.load('lib/leave-requirements').actualUsedDays(l,l.start,[]),1);assert.equal(h.load('lib/leave-requirements').actualUsedDays(l,'2026-10-12',[]),1);
});
test('employee update retains attendance, correction evidence and leave return under the old PIN',async()=>{
 const h=harness();h.store.punches.push(log(h,'2026-10-04','07:20:00','ATT IN'));
 const response=await h.send({action:'employee.update',id:'A',employee:{name:'Staff A',role:'Admin Staff',devicePin:'02'}});assert.equal(response.status,200);assert.equal((await response.json()).attendance[0].employeeId,'A');assert.equal(h.store.punches[0].employeeId,'A');
 const b=await h.send({action:'employee.create',employee:{id:'B',name:'Staff B',role:'Admin Staff',devicePin:'01'}});assert.equal(b.status,200);assert.equal((await b.json()).attendance.some(r=>r.employeeId==='B'),false);
 const old=log(h,'2026-10-05','07:20:00','ATT IN');h.load('lib/punches').ingestPunches(h.store,[old]);assert.equal(h.store.punches.at(-1).employeeId,'A');
 const assignment=h.store.pinAssignments.find(a=>a.employeeId==='B'&&a.pin==='01');const recent=log(h,assignment.from.slice(0,10),assignment.from.slice(11),'ATT IN');h.load('lib/punches').ingestPunches(h.store,[recent]);assert.equal(h.store.punches.at(-1).employeeId,'B');
 const result=h.load('lib/attendance').attendanceForClient(h.store);assert.equal(result.find(r=>r.date==='2026-10-04').employeeId,'A');assert.equal(result.find(r=>r.date==='2026-10-05').employeeId,'A');
 const corrections=h.load('lib/attendance');corrections.addAttendanceCorrection(h.store,{employeeId:'A',date:'2026-10-04',checkIn:'07:15',reason:'Verified register',evidence:'Register 1',expected:{checkIn:'07:20',checkOut:'—',correctionId:null}},'C','2026-10-31T00:00:00Z');assert.equal(h.store.corrections[0].originalPunches.length,1);assert.equal(h.store.corrections[0].originalPunches[0].pin,'01');
});
test('assignment boundaries and retry enrichment cannot transfer historical events',()=>{
 const h=harness(),ownership=h.load('lib/punch-ownership'),imports=h.load('lib/punches');h.store.punches.push(log(h,'2026-10-04','07:20:00'));ownership.assignDevicePin(h.store,'A','02','2026-10-10 12:00:00');h.store.people[0].devicePin='02';ownership.assignDevicePin(h.store,'B','01','2026-10-11 12:00:00');h.store.people.push({id:'B',name:'Staff B',role:'Admin Staff',devicePin:'01'});
 imports.ingestPunches(h.store,[log(h,'2026-10-04','07:20:00','ATT IN'),log(h,'2026-10-10','12:00:00','ATT IN'),log(h,'2026-10-11','12:00:00','ATT IN')]);assert.equal(h.store.punches[0].employeeId,'A');assert.equal(h.store.punches[0].kind,'attendance-in');assert.equal(h.store.punches[1].employeeId,null);assert.equal(h.store.punches[2].employeeId,'B');
 // A persisted reload is idempotent and keeps deliberately unassigned events unassigned.
 const restored=JSON.parse(JSON.stringify(h.store));ownership.initializePunchOwnership(restored);assert.equal(JSON.stringify(restored),JSON.stringify(h.store));
});
test('deleting a reused-PIN employee does not remove a previous owner’s history',()=>{
 const h=harness(),ownership=h.load('lib/punch-ownership');h.store.punches.push(log(h,'2026-10-04','07:20:00','ATT IN'));ownership.assignDevicePin(h.store,'A','02','2026-10-10 12:00:00');h.store.people[0].devicePin='02';ownership.assignDevicePin(h.store,'B','01','2026-10-11 12:00:00');h.store.people.push({id:'B',name:'Staff B',role:'Admin Staff',devicePin:'01'});
 h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-12','07:20:00','ATT IN')]);h.load('lib/employee-removal').permanentlyRemoveEmployee(h.store,'B');assert.equal(h.store.punches.length,1);assert.equal(h.store.punches[0].employeeId,'A');assert.equal(h.load('lib/attendance').attendanceForClient(h.store)[0].employeeId,'A');
});

test('a first-time staff PIN links previously unmapped machine history without affecting established owners',async()=>{
 const h=harness();h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-04','07:20:00','ATT IN','99')]);assert.equal(h.store.punches[0].employeeId,null);
 const response=await h.send({action:'employee.create',employee:{id:'NEW',name:'First registration',role:'Admin Staff',devicePin:'99'}});assert.equal(response.status,200);assert.equal(h.store.punches[0].employeeId,'NEW');assert.equal((await response.json()).attendance[0].employeeId,'NEW');
});

test('changing to a previously unknown PIN starts its history at the change rather than backdating it',()=>{
 const h=harness(),ownership=h.load('lib/punch-ownership');h.load('lib/punches').ingestPunches(h.store,[log(h,'2026-10-04','07:20:00','ATT IN','02')]);assert.equal(h.store.punches[0].employeeId,null);
 ownership.assignDevicePin(h.store,'A','02','2026-10-10 12:00:00');h.store.people[0].devicePin='02';assert.equal(h.store.punches[0].employeeId,null);assert.equal(ownership.ownerAt(h.store,log(h,'2026-10-05','07:20:00','ATT IN','02')),null);assert.equal(ownership.ownerAt(h.store,log(h,'2026-10-11','07:20:00','ATT IN','02')),'A');
});

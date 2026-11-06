const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const cache={};function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n.startsWith('./')?load(n.slice(2)):require(n),Date,Map,Set,process,Buffer});return exports;}
const {attendanceForClient,addAttendanceCorrection}=load('attendance'),{normalizePunch,ingestPunches}=load('punches');
const person={id:'EMP-EXAMPLE',name:'Staff',role:'Admin Staff',devicePin:'1242'};
const punch=(time,eventType)=>normalizePunch({serial:'TEST',pin:'1242',timestamp:'2026-10-04 '+time,state:0,...(eventType?{eventType}:{})});
const store=logs=>{const s={people:[{...person}],punches:logs,leaves:[],holidays:[],device:{count:logs.length,lastSeen:null,serial:'TEST'}};load('punch-ownership').initializePunchOwnership(s);return s;};
const source=fs.readFileSync('public/app.js','utf8');
function browser(s,dates=['2026-10-04'],now){const context={db:{...s,attendance:attendanceForClient(s,now)},attState:{staff:'all'},eachDate:()=>dates,today:new Date('2026-11-01'),iso:d=>new Date(d).toISOString().slice(0,10),staffStart:()=> '08:00',Date,Map};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function buildAttendanceRows('),source.indexOf('function attStatusTag(')),context);return context.buildAttendanceRows();}
test('the October 4 ATT IN/OUT example is Present across server and report; OT events do not replace ATT IN',()=>{
 const s=store([punch('01:59:03','OT OUT'),punch('02:01:52','OT IN'),punch('06:42:00','OT OUT'),punch('07:33:40','ATT IN'),punch('16:00:00','OT IN'),punch('23:56:22','ATT & OT OUT')]);const original=JSON.stringify(s.punches),row=attendanceForClient(s)[0],report=browser(s)[0];assert.equal(row.status,'Present');assert.equal(row.checkIn,'07:33');assert.equal(row.checkOut,'23:56');assert.equal(row.lateMins,0);assert.equal(row.punches.length,6);assert.equal(report.status,row.status);assert.equal(report.workedMins,row.workedMins);assert.equal(report.checkOut,row.checkOut);assert.equal(JSON.stringify(s.punches),original);
});
test('a checkout-only record or ambiguous lone punch cannot become absent, a late arrival or worked hours',()=>{
 for(const log of [punch('23:56:22','ATT & OT OUT'),punch('23:56:22')]){const s=store([log]);const row=attendanceForClient(s)[0],report=browser(s)[0];assert.equal(row.status,'Incomplete');assert.equal(report.status,'Incomplete');assert.equal(row.checkIn,'\u2014');assert.equal(row.lateMins,0);assert.equal(row.workedMins,0);assert.match(row.note,/missing|unlabelled/i);assert.equal(row.punches[0].timestamp,'2026-10-04 23:56:22');}
});
test('a confirmed check-in counts as attended without waiting for checkout; late boundary is unchanged',()=>{
 for(const [time,status,minutes] of [['07:33:40','Present',0],['08:00:59','Present',0],['08:01:00','Late',1]]){const s=store([punch(time,'ATT IN')]);const now=Date.parse('2026-10-04T10:00:00Z'),row=attendanceForClient(s,now)[0];assert.equal(row.status,status);assert.equal(row.lateMins,minutes);assert.equal(row.workedMins,0);assert.equal(browser(s,undefined,now)[0].status,status);}
});
test('overtime alone does not establish regular attendance and a late regular arrival is not hidden by early OT',()=>{
 assert.equal(attendanceForClient(store([punch('02:00:00','OT IN'),punch('06:42:00','OT OUT')]))[0].status,'Incomplete');const row=attendanceForClient(store([punch('02:00:00','OT IN'),punch('08:20:00','ATT IN'),punch('16:00:00','ATT OUT')]))[0];assert.equal(row.status,'Late');assert.equal(row.checkIn,'08:20');assert.equal(row.lateMins,20);
});
test('paired unlabelled punches require review and do not invent arrival or departure',()=>{
 const row=attendanceForClient(store([punch('23:56:22'),punch('07:33:40')]))[0];assert.equal(row.status,'Incomplete');assert.equal(row.checkIn,'\u2014');assert.equal(row.checkOut,'\u2014');assert.equal(row.workedMins,0);assert.match(row.note,/unlabelled/i);
});
test('a later classified replay enriches an existing raw event without duplicating or altering its code/time',()=>{
 const s=store([punch('07:33:40')]);assert.equal(attendanceForClient(s)[0].status,'Incomplete');const result=ingestPunches(s,[punch('07:33:40','ATT IN')]);assert.equal(result.inserted,0);assert.equal(result.duplicates,1);assert.equal(s.punches.length,1);assert.equal(s.punches[0].state,0);assert.equal(s.punches[0].timestamp,'2026-10-04 07:33:40');assert.equal(attendanceForClient(s,Date.parse('2026-10-04T10:00:00Z'))[0].status,'Present');
});
test('leave return uses confirmed ATT IN, never OT, checkout-only, or ambiguous lone raw punches',()=>{
 const s=store([]);s.leaves=[{id:'L',employeeId:person.id,type:'Annual',start:'2026-10-01',end:'2026-10-06',days:3,status:'Approved'}];
 for(const p of [punch('02:01:52','OT IN'),punch('23:56:22','ATT OUT')]){ingestPunches(s,[p]);assert.equal(s.leaves[0].status,'Approved');}
 ingestPunches(s,[punch('07:33:40','ATT IN')]);assert.equal(s.leaves[0].status,'Completed');assert.equal(s.leaves[0].returnedAt,'2026-10-04 07:33:40');
 const raw=store([]);raw.leaves=[{...s.leaves[0],status:'Approved',returnedAt:undefined}];ingestPunches(raw,[punch('23:56:22')]);assert.equal(raw.leaves[0].status,'Approved');
});
test('audited correction fixes the incomplete imported example throughout reports without inventing machine events',()=>{
 const s=store([punch('23:56:22')]),original=JSON.stringify(s.punches),before=attendanceForClient(s)[0];addAttendanceCorrection(s,{employeeId:person.id,date:'2026-10-04',checkIn:'07:33',checkOut:'23:56',reason:'Reconcile missing imported ATT IN from source attendance evidence.',evidence:'Source screenshot shows ATT IN 07:33:40 and ATT & OT OUT 23:56:22.',expected:{checkIn:before.checkIn,checkOut:before.checkOut,correctionId:null}},'C','2026-10-31T00:00:00Z');assert.equal(attendanceForClient(s)[0].status,'Present');assert.equal(browser(s)[0].status,'Present');assert.equal(browser(s)[0].lateMins,0);assert.equal(JSON.stringify(s.punches),original);assert.equal(s.corrections[0].originalPunches.length,1);
});
test('off days, approved leave and missing-history dates remain distinct from absence',()=>{
 const s=store([]);s.punchHistory=['2026-10-04 12:00:04'];assert.equal(browser(s,['2026-10-01'])[0].status,'No logs');assert.equal(browser(s,['2026-10-02'])[0].status,'Weekend');s.leaves=[{employeeId:person.id,type:'Annual',start:'2026-10-05',end:'2026-10-06',status:'Approved'}];assert.equal(browser(s,['2026-10-05'])[0].status,'On leave');assert.equal(browser(s,['2026-10-06'])[0].status,'Absent');
});
test('invalid and conflicting source types are rejected instead of silently being misinterpreted',()=>{
 for(const extra of [{kind:'anything'},{eventType:'anything'},{kind:'attendance-in',eventType:'ATT OUT'}])assert.throws(()=>normalizePunch({serial:'TEST',pin:'1242',timestamp:'2026-10-04 07:33:40',state:0,...extra}));assert.equal(load('attendance-schedule').isLateArrival('Admin Staff','\u2014','2026-10-04'),false);
});

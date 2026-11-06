const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const cache={};
function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>load(n.slice(2))});return exports;}
const {attendanceForClient,addAttendanceCorrection}=load('attendance');
const person={id:'T1',name:'Teacher',role:'Teacher',devicePin:'01'};
const punch=(id,time,kind)=>({id,employeeId:person.id,pin:'01',serial:'ZK1',timestamp:'2026-10-29 '+time+':00',state:kind==='attendance-in'?0:1,kind,verify:'1',workCode:''});
const fixture=(punches=[punch('IN','08:15','attendance-in')])=>({people:[{...person}],leaves:[],punches,device:{lastSeen:null,serial:null,count:punches.length}});
function entry(store,changes={}){const row=attendanceForClient(store)[0];return {employeeId:person.id,date:'2026-10-29',reason:'Verified missing attendance punch.',expected:{checkIn:row?.checkIn||'—',checkOut:row?.checkOut||'—',correctionId:row?.correctionId||null},...changes};}
const plain=value=>JSON.parse(JSON.stringify(value));

test('out-only correction preserves the current in-punch and stores only its explicit override',()=>{
 const s=fixture(),input=entry(s,{checkOut:'14:00'}),raw=JSON.stringify(s.punches);
 const correction=addAttendanceCorrection(s,input,'OUT','2026-10-29T10:00:00Z'),row=attendanceForClient(s)[0];
 assert.deepEqual(plain(correction.changes),{checkOut:'14:00'});assert.deepEqual(plain(correction.before),{checkIn:'08:15',checkOut:'—'});assert.deepEqual(plain(correction.after),{checkIn:'08:15',checkOut:'14:00'});
 assert.equal(row.checkIn,'08:15');assert.equal(row.checkOut,'14:00');assert.equal(row.workedMins,345);assert.equal(row.status,'Late');assert.equal(row.correctionId,'OUT');assert.equal(row.source,'Administrator correction');assert.equal(JSON.stringify(s.punches),raw);assert.equal(correction.originalPunches[0].id,'IN');
});

test('out-only on a missing day remains incomplete and a later machine in-punch fills the other time',()=>{
 const s=fixture([]),correction=addAttendanceCorrection(s,entry(s,{checkOut:'14:00'}),'OUT','now');
 let row=attendanceForClient(s)[0];assert.equal(s.punches.length,0);assert.equal(row.checkIn,'—');assert.equal(row.checkOut,'14:00');assert.equal(row.status,'Incomplete');assert.equal(row.workedMins,0);assert.equal(correction.originalPunches.length,0);
 s.punches.push(punch('LATER-IN','06:50','attendance-in'),punch('LATER-OUT','14:30','attendance-out'));
 row=attendanceForClient(s)[0];assert.equal(row.checkIn,'06:50');assert.equal(row.checkOut,'14:00');assert.equal(row.originalCheckOut,'14:30');assert.equal(row.status,'Present');assert.equal(row.workedMins,430);assert.equal(correction.originalPunches.length,0);
});

test('in-only correction preserves an existing checkout and lets a later machine checkout update it',()=>{
 const s=fixture([punch('OUT','14:00','attendance-out')]),input=entry(s,{checkIn:'06:55'}),raw=JSON.stringify(s.punches);
 const correction=addAttendanceCorrection(s,input,'IN','now');let row=attendanceForClient(s)[0];
 assert.deepEqual(plain(correction.changes),{checkIn:'06:55'});assert.equal(row.checkOut,'14:00');assert.equal(row.workedMins,425);assert.equal(JSON.stringify(s.punches),raw);
 s.punches.push(punch('LATER-OUT','15:00','attendance-out'));row=attendanceForClient(s)[0];assert.equal(row.checkIn,'06:55');assert.equal(row.checkOut,'15:00');assert.equal(row.originalCheckOut,'15:00');
});

test('successive partial corrections preserve earlier explicit times and their immutable snapshots',()=>{
 const s=fixture();addAttendanceCorrection(s,entry(s,{checkIn:'06:55'}),'IN','first');
 const second=addAttendanceCorrection(s,entry(s,{checkOut:'14:00'}),'OUT','second');addAttendanceCorrection(s,entry(s,{checkIn:'06:50'}),'IN2','third');
 const row=attendanceForClient(s)[0];assert.equal(row.checkIn,'06:50');assert.equal(row.checkOut,'14:00');assert.equal(row.correctionId,'IN2');assert.deepEqual(plain(second.before),{checkIn:'06:55',checkOut:'—'});assert.deepEqual(plain(second.after),{checkIn:'06:55',checkOut:'14:00'});assert.equal(s.corrections[0].after.checkIn,'06:55');assert.equal(s.corrections.length,3);
});

test('invalid partial values, impossible effective chronology and unchanged times do not append history or alter punches',()=>{
 for(const change of [{checkIn:''},{checkIn:null},{checkIn:'24:00'},{checkOut:''},{checkOut:null},{checkOut:'14:61'},{checkOut:'07:00'},{checkOut:'08:15'},{checkIn:'08:15'},{noteOnly:true,checkOut:'14:00'}]){
  const s=fixture(),input=entry(s,change),before=JSON.stringify(s);assert.throws(()=>addAttendanceCorrection(s,input,'BAD','now'),JSON.stringify(change));assert.equal(JSON.stringify(s),before);
 }
 for(const change of [{checkIn:'14:00'},{checkIn:'15:00'},{checkOut:'14:00'}]){
  const s=fixture([punch('IN','08:15','attendance-in'),punch('OUT','14:00','attendance-out')]),input=entry(s,change),before=JSON.stringify(s);assert.throws(()=>addAttendanceCorrection(s,input,'BAD','now'));assert.equal(JSON.stringify(s),before);
 }
});

test('out-only stale snapshots fail after a competing correction or a newly synced punch',()=>{
 for(const mode of ['correction','machine-in','machine-out']){
  const s=fixture(),stale=entry(s,{checkOut:'14:00'});
  if(mode==='correction')addAttendanceCorrection(s,entry(s,{checkIn:'06:55'}),'OTHER','first');
  else s.punches.push(punch(mode,mode==='machine-in'?'06:50':'15:00',mode==='machine-in'?'attendance-in':'attendance-out'));
  attendanceForClient(s);const before=JSON.stringify(s);assert.throws(()=>addAttendanceCorrection(s,stale,'STALE','now'),/Attendance changed/);assert.equal(JSON.stringify(s),before);
 }
});

test('partial corrections survive serialization with administrator attribution and note-only history remains inert',()=>{
 const s=fixture([]),out=addAttendanceCorrection(s,{...entry(s,{checkOut:'14:00'}),actor:'Spoofed'},'OUT','first');
 const before=JSON.stringify(attendanceForClient(s));addAttendanceCorrection(s,entry(s),'NOTE','second');assert.equal(JSON.stringify(attendanceForClient(s)),before);
 const restored=JSON.parse(JSON.stringify(s)),row=attendanceForClient(restored)[0];assert.equal(row.checkIn,'—');assert.equal(row.checkOut,'14:00');assert.equal(row.status,'Incomplete');assert.equal(out.actor,'Administrator');assert.equal(restored.corrections[1].noteOnly,true);assert.deepEqual(restored.corrections[1].changes,{});
});

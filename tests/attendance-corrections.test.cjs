const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const cache={};
function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>load(n.slice(2))});return exports;}
const {attendanceForClient,addAttendanceCorrection}=load('attendance');
const fixture=()=>({people:[{id:'T1',name:'Teacher',role:'Teacher',devicePin:'01'}],leaves:[],punches:[{id:'raw1',pin:'01',serial:'ZK1',timestamp:'2026-10-29 08:15:00',state:0,kind:'attendance-in',verify:'1',workCode:''}],device:{lastSeen:null,serial:null,count:1}});
function entry(store,changes={}){const row=attendanceForClient(store)[0];return {employeeId:'T1',date:'2026-10-29',checkIn:'06:55',reason:'Arrived on time; forgot to punch.',evidence:'Duty supervisor verified arrival.',expected:{checkIn:row?.checkIn||'—',checkOut:row?.checkOut||'—',correctionId:row?.correctionId||null},...changes};}
test('late punch correction recalculates presence while preserving machine data and evidence',()=>{
  const store=fixture();store.punches.push({...store.punches[0],id:'raw-out',timestamp:'2026-10-29 14:00:00',kind:'attendance-out',state:1});const original=JSON.stringify(store.punches, (key,value)=>key==='employeeId'?undefined:value);assert.equal(attendanceForClient(store)[0].status,'Late');
  const c=addAttendanceCorrection(store,entry(store),'c1','2026-10-29T09:00:00Z');
  assert.equal(attendanceForClient(store)[0].status,'Present');assert.equal(JSON.stringify(store.punches, (key,value)=>key==='employeeId'?undefined:value),original);
  assert.equal(c.actor,'Administrator');assert.equal(c.before.checkIn,'08:15');assert.equal(c.after.checkIn,'06:55');assert.equal(c.originalPunches[0].id,'raw1');assert.equal(c.createdAt,'2026-10-29T09:00:00Z');
});
test('forgotten punch can be added without inventing a machine event',()=>{
  const store=fixture();store.punches=[];addAttendanceCorrection(store,entry(store),'c1','2026-10-29T09:00:00Z');
  assert.equal(store.punches.length,0);assert.equal(attendanceForClient(store)[0].checkIn,'06:55');assert.equal(store.corrections[0].before.checkIn,'—');
});
test('later device checkout updates attendance without undoing the corrected arrival',()=>{
  const store=fixture();addAttendanceCorrection(store,entry(store),'c1','now');store.punches.push({...store.punches[0],id:'out',kind:'attendance-out',timestamp:'2026-10-29 14:00:00',state:1});
  const row=attendanceForClient(store)[0];assert.equal(row.checkIn,'06:55');assert.equal(row.checkOut,'14:00');assert.equal(row.originalCheckIn,'08:15');
});
test('repeated corrections append history with the previous effective times',()=>{
  const store=fixture();addAttendanceCorrection(store,entry(store),'c1','first');addAttendanceCorrection(store,entry(store,{checkIn:'06:50',reason:'Verified arrival with duty supervisor.'}),'c2','second');
  assert.equal(store.corrections.length,2);assert.equal(store.corrections[1].before.checkIn,'06:55');assert.equal(store.corrections[0].after.checkIn,'06:55');assert.equal(attendanceForClient(store)[0].correctionId,'c2');
});
test('stale corrections are rejected after a competing correction or new checkout',()=>{
  const store=fixture(),stale=entry(store);addAttendanceCorrection(store,entry(store),'c1','now');
  assert.throws(()=>addAttendanceCorrection(store,stale,'c2','now'),/Attendance changed/);
  const earlier=entry(store,{checkIn:'06:50'});store.punches.push({...store.punches[0],id:'out',kind:'attendance-out',timestamp:'2026-10-29 14:00:00'});
  assert.throws(()=>addAttendanceCorrection(store,earlier,'c3','now'),/Attendance changed/);
});
test('reason, calendar dates, time values and chronological order are validated',()=>{
  for(const changes of [{reason:''},{date:'2026-02-30'},{checkIn:'25:00'},{checkOut:'06:00'},{checkOut:'garbage'}])assert.throws(()=>addAttendanceCorrection(fixture(),entry(fixture(),changes),'c','now'));
});
test('correction history survives serialization and cannot spoof the actor',()=>{
  const store=fixture();addAttendanceCorrection(store,entry(store,{actor:'Someone else'}),'c1','now');
  const restored=JSON.parse(JSON.stringify(store));assert.equal(restored.corrections[0].actor,'Administrator');assert.equal(attendanceForClient(restored)[0].checkIn,'06:55');
});
test('correction form shows in and out punches and focuses an empty required reason',async()=>{
  const source=fs.readFileSync('public/app.js','utf8');
  const form=source.slice(source.indexOf('function openAttendanceCorrection('),source.indexOf('function viewAttendance('));
  const elements={};
  const element=id=>elements[id] ||= {value:'',innerHTML:'',style:{},classList:{add(){}},addEventListener(){},scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;},setCustomValidity(v){this.validation=v;},reportValidity(){this.reported=true;}};
  const context={document:{getElementById:element},db:{people:[{id:'A',name:'Staff'}],attendance:[]},esc:s=>String(s),iso:()=> '2026-10-29',val:id=>element(id).value,correctionHistory:()=>'',saveAction:()=>{throw Error('Empty reason must not submit');},toast(){},closeModal(){}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function employeeNumber('),source.indexOf('let db ='))+form,context);context.openAttendanceCorrection('A','2026-10-29');
  const html=element('modal-body').innerHTML;
  assert.ok(html.includes('textarea id="f-correction-reason" required'));
  assert.ok(html.includes('id="f-in" type="time"'));assert.ok(html.includes('id="f-out" type="time"'));
  for(const removed of ['f-correction-evidence','correction-original'])assert.equal(html.includes('id="'+removed+'"'),false,removed);
  await element('modal-save').onclick();
  assert.equal(element('f-correction-reason').focused,true);assert.equal(element('f-correction-reason').reported,true);
});

test('evidence is optional and existing supplied references can still be preserved',()=>{
  const without=fixture();assert.doesNotThrow(()=>addAttendanceCorrection(without,entry(without,{evidence:''}),'c1','now'));const s=fixture();
  const c=addAttendanceCorrection(s,entry(s,{evidence:'Duty supervisor confirmed arrival at 06:55.'}),'c2','now');
  assert.equal(c.evidence,'Duty supervisor confirmed arrival at 06:55.');
});

test('reason-only notes preserve attendance status, times, hours and raw logs, including missing punches',()=>{
  for(const shape of ['late','missing','checkout-only']){
    const s=fixture();
    if(shape==='missing')s.punches=[];
    if(shape==='checkout-only')s.punches[0].kind='attendance-out';
    const before=JSON.stringify(attendanceForClient(s)),raw=JSON.stringify(s.punches);
    const values=entry(s);
    const note=addAttendanceCorrection(s,{employeeId:values.employeeId,date:values.date,reason:'Attendance discrepancy noted for review.',noteOnly:true,expected:values.expected},'NOTE','now');
    assert.equal(JSON.stringify(attendanceForClient(s)),before,shape);
    assert.equal(JSON.stringify(s.punches),raw,shape);
    assert.equal(note.noteOnly,true);assert.deepEqual(JSON.parse(JSON.stringify(note.changes)),{});
    assert.deepEqual(note.before,note.after);assert.equal(note.evidence,undefined);
  }
});

test('notes preserve legacy time corrections, append history, and validate reason, date and stale forms',()=>{
  const s=fixture();addAttendanceCorrection(s,entry(s),'OLD','first');
  const before=JSON.stringify(attendanceForClient(s)),values=entry(s);
  const note={employeeId:values.employeeId,date:values.date,reason:'Additional explanation.',expected:values.expected};
  addAttendanceCorrection(s,note,'NOTE1','second');addAttendanceCorrection(s,note,'NOTE2','third');
  assert.equal(JSON.stringify(attendanceForClient(s)),before);assert.equal(s.corrections.length,3);
  for(const bad of [{...note,reason:''},{...note,date:'2026-02-30'},{...note,noteOnly:true,checkIn:'06:00'},{...note,expected:{...note.expected,correctionId:null}}])assert.throws(()=>addAttendanceCorrection(s,bad,'BAD','now'));
  assert.equal(s.corrections.length,3);
});

test('unchanged punch fields still allow a reason-only note',async()=>{
  const source=fs.readFileSync('public/app.js','utf8'),form=source.slice(source.indexOf('function openAttendanceCorrection('),source.indexOf('function viewAttendance('));
  const elements={},calls=[];
  const element=id=>{if(['f-correction-evidence','correction-original'].includes(id))throw Error('Removed control accessed: '+id);return elements[id] ||= {value:'',innerHTML:'',style:{},classList:{add(){}},addEventListener(){},setCustomValidity(){},reportValidity(){return true;}};};
  const context={document:{getElementById:element},db:{people:[{id:'A',name:'Staff'}],attendance:[{employeeId:'A',date:'2026-10-29',checkIn:'08:15',checkOut:'16:00',status:'Late'}]},esc:s=>String(s),iso:()=> '2026-10-29',val:id=>element(id).value,correctionHistory:()=>'',saveAction:async(action,payload)=>{calls.push({action,entry:payload.entry});return true;},toast(){},closeModal(){}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function employeeNumber('),source.indexOf('let db ='))+form,context);context.openAttendanceCorrection('A','2026-10-29');
  element('f-date').value='2026-10-29';element('f-correction-reason').value='Reason only.';
  await element('modal-save').onclick();
  const saved=JSON.parse(JSON.stringify(calls[0]));assert.equal(saved.action,'attendance.manual');
  assert.equal(saved.entry.reason,'Reason only.');assert.equal(saved.entry.noteOnly,true);
  assert.equal('checkIn' in saved.entry,false);assert.equal('checkOut' in saved.entry,false);assert.equal('evidence' in saved.entry,false);
});

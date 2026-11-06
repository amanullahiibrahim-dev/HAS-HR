const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const cache={};function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n.startsWith('./')?load(n.slice(2)):require(n),Date,Map,Set,process,Buffer});return exports;}
const schedule=load('attendance-schedule'),attendance=load('attendance');
test('admin is on time at 08:00 and late at 08:01 every Sunday through Thursday',()=>{
  for(const date of ['2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29']){
    assert.equal(schedule.isLateArrival('Admin Staff','08:00',date),false);assert.equal(schedule.isLateArrival('Admin Staff','08:00:59',date),false);assert.equal(schedule.isLateArrival('Admin Staff','08:01',date),true);assert.equal(schedule.isLateArrival('Admin Staff','08:02',date),true);
  }
  assert.equal(schedule.requiredArrival('Admin Staff'),'08:00');
});
test('Friday, Saturday and configured holidays do not count as late duty days',()=>{
  for(const date of ['2026-10-30','2026-10-31'])assert.equal(schedule.isLateArrival('Admin Staff','08:30',date),false);
  assert.equal(schedule.isLateArrival('Admin Staff','08:30','2026-10-29',['2026-10-29']),false);
});
test('teacher is on time through 07:00:59 and late exactly from 07:01',()=>{assert.equal(schedule.isLateArrival('Teacher','07:00','2026-10-29'),false);assert.equal(schedule.isLateArrival('Teacher','07:00:59','2026-10-29'),false);assert.equal(schedule.isLateArrival('Teacher','07:01','2026-10-29'),true);});
test('server attendance and browser late minutes agree on the admin boundary',()=>{
  const person={id:'A',name:'Admin',role:'Admin Staff',devicePin:'01'};
  const store={people:[person],punches:[{id:'one',pin:'01',serial:'ZK',timestamp:'2026-10-28 08:00:00',state:0,kind:'attendance-in'},{id:'two',pin:'01',serial:'ZK',timestamp:'2026-10-29 08:01:00',state:0,kind:'attendance-in'}],leaves:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
  for(const log of store.punches.slice())store.punches.push({...log,id:log.id+'-out',timestamp:log.timestamp.slice(0,10)+' 14:00:00',kind:'attendance-out',state:1});
  const records=attendance.attendanceForClient(store,Date.parse('2026-10-29T10:00:00Z'));assert.equal(records.find(r=>r.date==='2026-10-28').status,'Present');assert.equal(records.find(r=>r.date==='2026-10-29').status,'Late');
  const code=fs.readFileSync('public/app.js','utf8');const c={db:{...store,attendance:records},attState:{staff:'all'},eachDate:()=>['2026-10-28','2026-10-29'],today:new Date('2026-11-01'),iso:d=>new Date(d).toISOString().slice(0,10),staffStart:()=> '08:00',minutesBetween:(a,b)=>{const f=s=>+s.slice(0,2)*60 + +s.slice(3,5);return f(b)-f(a);},Date,Map};vm.createContext(c);vm.runInContext(code.slice(code.indexOf('function buildAttendanceRows('),code.indexOf('function attStatusTag(')),c);const rows=c.buildAttendanceRows();assert.equal(rows[0].status,'Present');assert.equal(rows[0].lateMins,0);assert.equal(rows[1].status,'Late');assert.equal(rows[1].lateMins,1);
});

test('all staff types use the supplied arrival times with matching lateness and minutes',()=>{
  const expected={'Teacher':'07:00','Leading Teacher':'07:00','Technical Staff':'07:00','Support Staff':'07:00','Principal':'08:00','Deputy Principal':'07:00','Admin Staff':'08:00','Administrator':'08:00'};
  for(const [role,start] of Object.entries(expected)){
    assert.equal(schedule.requiredArrival(role),start,role);
    const atSeven=start==='07:00',date='2026-10-29';
    assert.equal(schedule.isLateArrival(role,atSeven?'07:00:59':'08:00:59',date),false,role);
    assert.equal(schedule.isLateArrival(role,atSeven?'07:01':'08:01',date),true,role);
    const person={id:'A',name:'Staff',role,devicePin:'01'};
    const store={people:[person],punches:[{id:'one',pin:'01',serial:'ZK',timestamp:`${date} ${atSeven?'07:15':'08:15'}:00`,state:0,kind:'attendance-in'}],leaves:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
    const records=attendance.attendanceForClient(store,Date.parse('2026-10-29T10:00:00Z'));
    assert.equal(records[0].status,'Late',role);assert.equal(records[0].lateMins,15,role);
    const state=load('store').stateForClient(store);
    assert.equal(state.people[0].workStart,start,role);
    assert.equal(state.attendanceSchedule.byRole[role].start,start,role);
    assert.equal(state.attendanceSchedule.byRole[role].lateFrom,atSeven?'07:01':'08:01',role);
    const code=fs.readFileSync('public/app.js','utf8');
    const context={db:state,Date,Map,Set};vm.createContext(context);
    vm.runInContext(code.slice(code.indexOf('const staffStart='),code.indexOf('const minutesBetween='))+';globalThis.start=staffStart(db.people[0]);',context);
    assert.equal(context.start,start,role);
    assert.equal(schedule.isLateArrival(role,'10:00','2026-10-30'),false,role);
  }
});

test('all 07:00 staff show Present at 07:00 and Late with one late minute at 07:01',()=>{
  for(const role of ['Teacher','Leading Teacher','Technical Staff','Support Staff','Deputy Principal']){
    for(const [time,status,lateMins] of [['07:00:00','Present',0],['07:00:59','Present',0],['07:01:00','Late',1]]){
      const store={people:[{id:'A',name:'Staff',role,devicePin:'01'}],punches:[{id:'one',pin:'01',serial:'ZK',timestamp:`2026-10-29 ${time}`,state:0,kind:'attendance-in'}],leaves:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
      const original=JSON.stringify(store.punches, (key,value)=>key==='employeeId'?undefined:value),record=attendance.attendanceForClient(store,Date.parse('2026-10-29T10:00:00Z'))[0];
      assert.equal(record.status,status,`${role} ${time}`);assert.equal(record.lateMins,lateMins,`${role} ${time}`);
      assert.equal(JSON.stringify(store.punches, (key,value)=>key==='employeeId'?undefined:value),original);
    }
  }
});

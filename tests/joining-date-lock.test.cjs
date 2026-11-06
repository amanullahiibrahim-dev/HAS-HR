const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const fixedAt='2026-11-05T19:30:00.000Z',today='2026-11-06';
function harness(){
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[fixedAt]));}static now(){return Date.parse(fixedAt);}}
 const cache={};
 function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;const file=name+'.ts';vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n.startsWith('./')?load(path.posix.normalize(path.posix.join(path.posix.dirname(name),n))):require(n),Date:ClockDate,Map,Set,process,Buffer});return exports;}
 const store={people:[{id:'A',name:'Sample employee',role:'Teacher',devicePin:'01',joinedOn:'2020-01-01',annual:30,medical:15,casual:0}],leaves:[],punches:[],holidays:[],device:{lastSeen:null,serial:null,count:0}};
 const locks=load('lib/joining-date-lock'),balances=load('lib/period-balances');
 const input=extra=>({asOf:today,joinedOn:store.people[0].joinedOn,used:{},expectedRevision:store.people[0].leaveBalanceRevision||0,...extra});
 return {store,locks,balances,input,person:store.people[0],save:extra=>balances.savePeriodBalances(store,'A',input(extra),fixedAt),preview:extra=>balances.previewPeriodBalances(store,'A',input(extra),fixedAt)};
}
const leave=extra=>({id:'LEAVE-A',employeeId:'A',name:'Sample employee',type:'Family',start:'2026-11-05',end:'2026-11-10',days:3,status:'Approved',reason:'Sample leave',...extra});
const snapshot=value=>JSON.stringify(value);

test('joining-date lock uses Maldives business day across UTC midnight boundaries',()=>{
 const {locks}=harness();
 assert.equal(locks.joiningDateBusinessDate('2026-11-05T18:59:59Z'),'2026-11-05');
 assert.equal(locks.joiningDateBusinessDate('2026-11-05T19:00:00Z'),'2026-11-06');
 assert.equal(locks.joiningDateBusinessDate(Date.parse('2026-12-31T20:00:00Z')),'2027-01-01');
 assert.equal(locks.joiningDateBusinessDate(),today);
});

test('all current or future leave records lock joining date until deleted or passed; unrelated records do not',()=>{
 for(const status of ['Pending','Approved','Completed','Declined'])for(const period of [{start:'2026-11-05',end:'2026-11-10'},{start:'2026-12-01',end:'2026-12-03'}]){
  const {store,locks}=harness();store.leaves=[leave({status,...period})];
  const result=locks.joiningDateLock(store,'A',today);assert.equal(result.locked,true,status+' '+period.start);assert.equal(result.until,period.end);assert.ok(result.message);
 }
 const {store,locks}=harness();store.leaves=[leave({id:'OTHER',employeeId:'B'})];assert.equal(locks.joiningDateLock(store,'A',today).locked,false);
});

test('exclusive end boundary unlocks on the expected return date without waiting for a status change',()=>{
 const {store,locks}=harness();store.leaves=[leave({end:today,status:'Pending'})];
 assert.equal(locks.joiningDateLock(store,'A','2026-11-05').locked,true);
 assert.equal(locks.joiningDateLock(store,'A',today).locked,false);
 store.leaves[0].start='2026-11-01';store.leaves[0].end='2026-11-04';assert.equal(locks.joiningDateLock(store,'A',today).locked,false);
});

test('only a valid completed early return shortens the lock, and a future return does not unlock early',()=>{
 const {store,locks}=harness();store.leaves=[leave({start:'2026-11-01',status:'Completed',returnedAt:'2026-11-04 07:00:00'})];
 assert.equal(locks.joiningDateLock(store,'A',today).locked,false);
 store.leaves[0].status='Approved';assert.equal(locks.joiningDateLock(store,'A',today).locked,true);
 store.leaves[0].status='Completed';store.leaves[0].returnedAt='2026-11-01 07:00:00';assert.equal(locks.joiningDateLock(store,'A',today).locked,true);
 store.leaves[0].returnedAt='invalid';assert.equal(locks.joiningDateLock(store,'A',today).locked,true);
 store.leaves[0].returnedAt='2026-11-07 07:00:00';const result=locks.joiningDateLock(store,'A',today);assert.equal(result.locked,true);assert.equal(result.until,'2026-11-07');assert.equal(locks.joiningDateLock(store,'A','2026-11-07').locked,false);
});

test('invalid or missing saved leave dates fail closed rather than silently unlocking joining date',()=>{
 for(const changes of [{start:undefined},{end:undefined},{start:'2026-02-30'},{end:'not-a-date'},{start:'2026-12-01',end:'2026-11-01'}]){
  const {store,locks}=harness();store.leaves=[leave(changes)];const result=locks.joiningDateLock(store,'A',today);assert.equal(result.locked,true,JSON.stringify(changes));assert.ok(result.message);
 }
});

test('multiple leaves retain the lock until the last active period ends or all blocking records are deleted',()=>{
 const {store,locks}=harness();store.leaves=[leave({id:'FIRST',end:'2026-11-08'}),leave({id:'LAST',start:'2026-12-01',end:'2026-12-04'}),leave({id:'PASSED',start:'2026-10-01',end:'2026-10-03'})];
 assert.equal(locks.joiningDateLock(store,'A',today).until,'2026-12-04');
 store.leaves=store.leaves.filter(l=>l.id!=='LAST');assert.equal(locks.joiningDateLock(store,'A',today).until,'2026-11-08');
 store.leaves=store.leaves.filter(l=>l.id!=='FIRST');store.leaveDeletions=[{leaveId:'FIRST',employeeId:'A'}];assert.equal(locks.joiningDateLock(store,'A',today).locked,false);
});

test('joining-date assertion allows unchanged values but rejects changes or clearing while leave blocks',()=>{
 const {store,locks,person}=harness();store.leaves=[leave()];const original=snapshot(store);
 assert.doesNotThrow(()=>locks.assertJoiningDateChangeAllowed(store,person,person.joinedOn,fixedAt));
 for(const joinedOn of ['2020-02-01',''])assert.throws(()=>locks.assertJoiningDateChangeAllowed(store,person,joinedOn,fixedAt),/joining date|locked/i);
 assert.equal(snapshot(store),original);
});

test('balance preview exposes lock metadata and cannot bypass it through a future as-of date',()=>{
 const {store,preview}=harness();store.leaves=[leave()];const result=preview({asOf:'2030-01-01'});
 assert.equal(result.joiningDateLock.locked,true);assert.equal(result.joiningDateLock.until,'2026-11-10');assert.ok(result.joiningDateLock.message);
 assert.throws(()=>preview({asOf:'2030-01-01',joinedOn:'2020-02-01'}),/joining date|locked/i);
});

test('a rejected joining-date save is atomic even when the supplied balance date says the leave has passed',()=>{
 const {store,save}=harness();store.leaves=[leave()];const original=snapshot(store);
 assert.throws(()=>save({asOf:'2030-01-01',joinedOn:'2020-02-01',used:{Family:1}}),/joining date|locked/i);
 assert.equal(snapshot(store),original);
});

test('unchanged joining date still allows balance updates while current leave exists',()=>{
 const {store,save,person}=harness();store.leaves=[leave()];const originalLeaves=snapshot(store.leaves),result=save({used:{Family:1}});
 assert.equal(person.joinedOn,'2020-01-01');assert.equal(person.leaveBalanceRevision,1);assert.equal(person.leavePeriodChanges.length,1);assert.equal(result.joiningDateLock.locked,true);assert.equal(snapshot(store.leaves),originalLeaves);
});

test('passed or deleted leave permits a joining-date change without rewriting remaining leave records',()=>{
 for(const deleted of [false,true]){
  const {store,save,person}=harness();store.leaves=[leave({end:deleted?'2026-11-10':today})];
  if(deleted){store.leaves=[];store.leaveDeletions=[{leaveId:'LEAVE-A',employeeId:'A'}];}
  const originalLeaves=snapshot(store.leaves);save({joinedOn:'2020-02-01'});assert.equal(person.joinedOn,'2020-02-01');assert.equal(person.leaveBalanceRevision,1);assert.equal(snapshot(store.leaves),originalLeaves);
 }
});

test('saving rechecks newly entered leave after an unlocked preview without relying on balance revision changes',()=>{
 const {store,preview,save}=harness();assert.equal(preview().joiningDateLock.locked,false);
 store.leaves.push(leave({start:'2026-12-01',end:'2026-12-03'}));const original=snapshot(store);
 assert.throws(()=>save({joinedOn:'2020-02-01'}),/joining date|locked/i);assert.equal(snapshot(store),original);
});

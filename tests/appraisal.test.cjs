const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/app.js','utf8');const context={Date,Map,Set};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function calculateAppraisal('),source.indexOf('function appraisalColumns(')),context);
const next=day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const working=day=>![5,6].includes(new Date(day+'T00:00:00Z').getUTCDay());
function fixture(year=2025){const dates=[];for(let day=year+'-01-01';day<`${year+1}-01-01`;day=next(day))dates.push(day);return {people:[{id:'A',name:'Teacher',role:'Teacher',dept:'Teaching',devicePin:'001'}],leaves:[],holidays:[],punchHistory:[`${year-1}-12-31 00:00:00`],leavePolicy:{excludeWeekends:{Annual:true,Family:true,'Sick with MC':true,'Sick without MC':true}},attendance:dates.map(date=>({employeeId:'A',date,status:'Present'}))};}
const calc=(data,year=2025,extra={})=>context.calculateAppraisal(data,year,{asOf:'2026-11-02',...extra})[0];
const leave=(id,type,start,end,days,status='Approved',extra={})=>({id,employeeId:'A',type,start,end,days,status,...extra});
function workingLeave(id,type,start,days){let end=start,remaining=days;while(remaining){if(working(end))remaining--;end=next(end);}return leave(id,type,start,end,days);}

test('required days use scheduled workdays, attended includes late days, and source records stay unchanged',()=>{
 const d=fixture();d.leaves=[leave('L','Annual','2025-01-05','2025-01-10',5,'Completed',{usedDays:5,returnedAt:'2025-01-10 07:00:00'})];
 for(const day of ['2025-01-12','2025-01-13'])d.attendance.find(row=>row.date===day).status='Absent';
 for(const day of ['2025-01-14','2025-01-15','2025-01-16'])d.attendance.find(row=>row.date===day).status='Late';
 const original=JSON.stringify(d),r=calc(d);assert.equal(r.calendarDays,365);assert.equal(r.periodDays,261);assert.equal(r.leaveTaken,5);assert.equal(r.required,256);assert.equal(r.absent,2);assert.equal(r.attended,254);assert.equal(r.late,3);assert.equal(r.onTime,251);assert.deepEqual(Array.from(r.absentDates),['2025-01-12','2025-01-13']);assert.deepEqual(Array.from(r.lateDates),['2025-01-14','2025-01-15','2025-01-16']);assert.equal(r.coverage,'Complete');assert.equal(r.basis,'working');assert.equal(JSON.stringify(d),original);
});

test('calendar input cannot credit weekends as required or attended, and current-year results exclude future dates',()=>{
 assert.equal(calc(fixture(2024),2024).calendarDays,366);assert.equal(calc(fixture(2024),2024).required,262);
 const d=fixture(),normal=calc(d),legacy=calc(d,2025,{basis:'calendar'});assert.equal(normal.required,261);assert.equal(legacy.required,normal.required);assert.equal(legacy.attended,normal.attended);assert.equal(legacy.basis,'working');
 const r=calc(fixture(2026),2026,{asOf:'2026-01-05'});assert.equal(r.calendarDays,365);assert.equal(r.periodDays,3);assert.equal(r.required,3);assert.equal(r.attended,3);assert.equal(r.asOf,'2026-01-05');
});

test('work calendar excludes Friday/Saturday and official closures exactly once, while supporting configured off days',()=>{
 const d=fixture();d.holidays=['2025-01-05','2025-01-10','2025-01-10'];assert.equal(calc(d).required,260);
 const custom=fixture();custom.attendanceSchedule={offDays:[0,6]};assert.equal(calc(custom,2025,{asOf:'2025-01-03'}).required,3);assert.equal(calc(fixture(),2025,{asOf:'2025-01-03'}).required,2);
});

test('early returns restore unused leave, and overlapping approvals never deduct a workday twice',()=>{
 const d=fixture(),l=leave('L','Annual','2025-01-05','2025-01-10',5,'Completed',{usedDays:2,returnedAt:'2025-01-07 07:00:00'});d.leaves=[l,{...l,id:'DUPLICATE'}];
 const r=calc(d);assert.equal(r.leaveTaken,2);assert.equal(r.required,259);assert.equal(r.attended,259);
});

test('pending, declined and future applications do not reduce required days, and official duty counts as attendance',()=>{
 const d=fixture(),l=leave('L','Annual','2025-01-05','2025-01-10',5);d.leaves=[{...l,status:'Pending'},{...l,id:'DECLINED',status:'Declined'},leave('FUTURE','Annual','2026-01-05','2026-01-10',5),{...l,id:'DUTY',type:'Duty travel',status:'Approved'}];d.attendance.find(r=>r.date==='2025-01-05').status='On duty';assert.equal(calc(d).leaveTaken,0);assert.equal(calc(d).attended,261);
});

test('missing and unclassified punch evidence keeps attended and punctual totals unknown instead of fabricating attendance',()=>{
 for(const status of ['No logs','Incomplete','Awaiting punch','Unexpected status','Weekend']){
  const d=fixture();d.attendance.find(r=>r.date==='2025-01-05').status=status;const r=calc(d);assert.equal(r.unverified,1,status);assert.equal(r.attended,null,status);assert.equal(r.onTime,null,status);assert.equal(r.onTimePercent,null,status);assert.equal(r.coverage,'Incomplete data',status);
 }
});

test('leave on holidays and weekly off days does not reduce required workdays a second time',()=>{
 const d=fixture();d.holidays=['2025-01-10'];d.leaves=[leave('L','No pay','2025-01-10','2025-01-13',3)];assert.equal(calc(d).leaveTaken,1);assert.equal(calc(d).required,260);
});

test('cross-year and half-day leave deduct only applicable working dates in the selected appraisal period',()=>{
 const d=fixture();d.leaves=[leave('CROSS','No pay','2024-12-30','2025-01-03',4,'Completed',{returnedAt:'2025-01-03 07:00:00',usedDays:4}),leave('HALF','Annual','2025-01-05','2025-01-06',.5,'Completed',{usedDays:.5,returnedAt:'2025-01-06 07:00:00'})];assert.equal(calc(d).leaveTaken,2.5);assert.equal(calc(d).required,258.5);
});

test('joining date bounds employment obligations and future appraisal years remain unavailable',()=>{
 const d=fixture();d.people[0].joinedOn='2025-12-30';assert.equal(calc(d).periodDays,2);assert.equal(calc(d).required,2);assert.equal(calc(d).attended,2);
 d.leaves=[leave('BEFORE-EMPLOYMENT','Annual','2025-01-05','2025-01-10',5,'Completed',{usedDays:3})];assert.equal(calc(d).attended,2);assert.equal(calc(d).coverage,'Complete');
 d.people[0].joinedOn='2026-01-01';assert.equal(calc(d).required,0);
 assert.equal(context.calculateAppraisal(d,2027,{asOf:'2026-11-02'}).length,0);
});

test('a PIN-reuse history cutoff does not shorten employment or falsely prove attendance before that cutoff',()=>{
 const d=fixture();d.people[0].joinedOn='2025-12-29';d.people[0].attendanceFrom='2025-12-31 00:00:00';d.attendance=d.attendance.filter(row=>row.date>='2025-12-31');
 const r=calc(d);assert.equal(r.periodDays,3);assert.equal(r.required,3);assert.equal(r.unverified,2);assert.equal(r.attended,null);
 d.leaves=[leave('COVERED','Annual','2025-12-29','2025-12-31',2)];const covered=calc(d);assert.equal(covered.required,1);assert.equal(covered.attended,1);assert.equal(covered.unverified,0);
});

test('explicit approved official duty covers missing evidence without deducting leave or inventing late days',()=>{
 const d=fixture();d.people[0].joinedOn='2025-12-29';d.people[0].attendanceFrom='2025-12-31 00:00:00';d.attendance=d.attendance.filter(row=>row.date>='2025-12-31');d.leaves=[leave('DUTY','Duty travel','2025-12-29','2025-12-31',2)];
 const r=calc(d);assert.equal(r.required,3);assert.equal(r.leaveTaken,0);assert.equal(r.attended,3);assert.equal(r.onTime,3);assert.equal(r.absent,0);
 d.leaves[0].status='Pending';assert.equal(calc(d).attended,null);
});

test('unresolved manual leave allocations remain flagged for review',()=>{
 const d=fixture();d.leaves=[leave('L','Annual','2025-01-05','2025-01-10',5,'Completed',{usedDays:3,returnedAt:'2025-01-10 07:00:00'})];assert.equal(calc(d).coverage,'Leave review');assert.equal(calc(d).attended,null);
});

test('dates before imported history remain unverified despite inferred Absent rows, and no-history totals are not all-zero proof',()=>{
 const d=fixture(),supplied=d.attendance.map(row=>({...row,status:'Absent'}));d.attendance=[{employeeId:'A',date:'2025-12-31',status:'Present'}];delete d.punchHistory;const r=calc(d,2025,{rows:supplied});assert.ok(r.unverified>200);assert.equal(r.absent,0);assert.equal(r.attended,null);
 const empty=fixture();empty.attendance=[];delete empty.punchHistory;assert.equal(calc(empty,2025,{rows:supplied}).attended,null);
});

test('the 216-required example has 216 attended, 214 punctual, two late and zero absent, with independent discipline',()=>{
 const d=fixture();const annual=workingLeave('ANNUAL','Annual','2025-01-01',30),family=workingLeave('FAMILY','Family','2025-03-02',10),sick=workingLeave('SICK','Sick with MC','2025-04-01',5);d.leaves=[annual,family,sick];
 for(const day of ['2025-06-01','2025-06-02'])d.attendance.find(row=>row.date===day).status='Late';
 d.disciplinaryActions=[{id:'D1',employeeId:'A',date:'2025-05-01',action:'Written warning'},{id:'D2',employeeId:'A',date:'2026-01-03',action:'Other year'},{id:'D3',employeeId:'OTHER',date:'2025-01-03',action:'Other staff'}];
 const before=JSON.stringify(d),r=calc(d);assert.equal(r.periodDays,261);assert.equal(r.leaveTaken,45);assert.equal(r.required,216);assert.equal(r.attended,216);assert.equal(r.onTime,214);assert.equal(r.late,2);assert.equal(r.absent,0);assert.equal(r.onTimePercent,99.07);assert.deepEqual(Array.from(r.lateDates),['2025-06-01','2025-06-02']);assert.deepEqual(Array.from(r.absentDates),[]);assert.equal(r.disciplinaryCount,1);assert.equal(r.disciplinaryActions[0].id,'D1');assert.equal(JSON.stringify(d),before);
 const unchanged={...d,disciplinaryActions:[]},without=calc(unchanged);for(const key of ['required','attended','onTime','leaveTaken','absent','late'])assert.equal(r[key],without[key]);
});

test('administrator-adjusted Present and Late statuses determine punctuality rather than recomparing raw punch evidence',()=>{
 const d=fixture();d.people[0].joinedOn='2025-12-30';d.attendance.find(row=>row.date==='2025-12-30').checkIn='09:30';d.attendance.find(row=>row.date==='2025-12-30').originalCheckIn='09:30';d.attendance.find(row=>row.date==='2025-12-30').status='Present';d.attendance.find(row=>row.date==='2025-12-31').status='Late';const r=calc(d);assert.equal(r.required,2);assert.equal(r.attended,2);assert.equal(r.onTime,1);assert.equal(r.late,1);assert.equal(r.absent,0);
});

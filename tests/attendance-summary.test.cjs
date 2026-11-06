const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
  const source=fs.readFileSync('public/app.js','utf8');
  const code=source.slice(source.indexOf('function renderAttendanceSummary('),source.indexOf('function renderAttendance(){'));
  const elements={},charts=[];
  const element=id=>elements[id] ||= {hidden:false,textContent:'',style:{}};
  const context={db:{people:[{id:'A',name:'Employee A'},{id:'B',name:'Employee B'}]},attState:{staff:'all'},document:{getElementById:element},renderAttChart:rows=>charts.push(Array.from(rows))};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,element,charts,render:rows=>context.renderAttendanceSummary(rows)};
}
const row=(employeeId,status,lateMins=0)=>({employeeId,status,lateMins,workedMins:0});
test('All staff never displays aggregated employee-day KPIs, chart or score',()=>{
  const h=harness();h.render(Array.from({length:181},()=>row('A','Absent')).concat([row('B','On leave'),row('B','On leave')]));
  assert.equal(h.element('att-summary').hidden,true);assert.equal(h.element('att-summary-prompt').hidden,true);assert.equal(h.charts.length,0);
});
test('an individual summary counts only that employee and includes off days under Leave / Off',()=>{
  const h=harness();h.context.attState.staff='A';
  const personal=[row('A','Present'),row('A','Late',5),row('A','On leave'),row('A','Weekend'),row('A','Absent')];
  h.render(personal.concat(Array.from({length:181},()=>row('B','Absent'))));
  assert.equal(h.element('att-summary').hidden,false);assert.equal(h.element('att-summary-prompt').hidden,true);
  for(const[id,expected]of [['att-present',2],['att-leave',2],['att-absent',1],['att-late-mins',5],['att-late-days',1],['att-score','67%']])assert.equal(h.element(id).textContent,expected,id);
  assert.equal(h.charts[0].length,5);assert.ok(h.charts[0].every(r=>r.employeeId==='A'));
});
test('switching employees replaces the summary and switching to All staff hides it again',()=>{
  const h=harness(),rows=[row('A','Late',10),row('B','Present')];
  h.context.attState.staff='A';h.render(rows);assert.equal(h.element('att-late-mins').textContent,10);
  h.context.attState.staff='B';h.render(rows);assert.equal(h.element('att-late-mins').textContent,0);assert.equal(h.element('att-absent').textContent,0);assert.equal(h.element('att-score').textContent,'100%');
  h.context.attState.staff='all';h.render(rows);assert.equal(h.element('att-summary').hidden,true);
  h.context.attState.staff='missing';h.render(rows);assert.equal(h.element('att-summary').hidden,true);
});

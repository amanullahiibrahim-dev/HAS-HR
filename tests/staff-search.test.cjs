const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false});return elements.get(id);};
 const db={people:[{id:'A-1',name:'Alex Example',role:'Admin Staff',dept:'Office',devicePin:'001',idCardNumber:'ID111'},{id:'B-2',name:'Amina Sample',role:'Teacher',dept:'Science',devicePin:'002',idCardNumber:'ID222'},{id:'C-3',name:'Alex Sample',role:'Teacher',dept:'Science',devicePin:'003'}]};
 const context={db,editingLeaveId:null,document:{getElementById:element},val:id=>element(id).value,initials:name=>name.split(' ').map(s=>s[0]).join(''),Date,Set};vm.createContext(context);const source=fs.readFileSync('public/app.js','utf8');vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let db ='))+source.slice(source.indexOf('let staffSearchOpen='),source.indexOf('function renderLeavePlanSummary()')),context);context.renderLeavePlanSummary=()=>context.syncLeaveStaffSelection();return{context,element,db};
}
test('staff search combines name tokens and role/department filters and finds identifiers without losing leading PIN zeros',()=>{
 const {context:c,element:e}=harness();e('lp-staff-search').value='alex';assert.equal(c.matchingLeaveStaff().length,2);e('lp-staff-role').value='Teacher';assert.equal(c.matchingLeaveStaff()[0].id,'C-3');e('lp-staff-department').value='Office';assert.equal(c.matchingLeaveStaff().length,0);e('lp-staff-role').value='';e('lp-staff-department').value='';
 for(const query of ['A-1','001','ID111','Example ALEX']){e('lp-staff-search').value=query;assert.equal(c.matchingLeaveStaff()[0].id,'A-1');}
});
test('results stay bounded, escape staff data and retain empty-result feedback without helper copy',()=>{
 const {context:c,element:e,db}=harness();db.people=Array.from({length:20},(_,i)=>({id:String(i),name:'<Staff> '+i,role:'Teacher',dept:'Science',devicePin:String(i)}));e('lp-staff-search').value='staff';c.searchLeaveStaff();assert.equal((e('lp-staff-results').innerHTML.match(/data-select-staff=/g)||[]).length,8);assert.match(e('lp-staff-results').innerHTML,/&lt;Staff&gt;/);assert.equal(e('lp-staff-hint').textContent,'');e('lp-staff-search').value='no such staff';c.changeStaffSearch();assert.match(e('lp-staff-results').innerHTML,/No staff match/);
});
test('selecting a result binds its ID, closes results, and new search clears the previous selection',()=>{
 const {context:c,element:e}=harness();c.searchLeaveStaff();c.selectLeaveStaff('B-2');assert.equal(e('lp-employee').value,'B-2');assert.equal(e('lp-staff-search').value,'Amina Sample');assert.equal(e('lp-staff-results').hidden,true);e('lp-staff-search').value='Alex';c.changeStaffSearch();assert.equal(e('lp-employee').value,'');assert.equal(e('lp-staff-results').hidden,false);
});
test('editing a leave cannot change its staff through search or a stale result click',()=>{
 const {context:c,element:e}=harness();e('lp-employee').value='A-1';c.editingLeaveId='LEAVE-1';c.syncLeaveStaffSelection();for(const id of ['lp-staff-search','lp-staff-search-button','lp-staff-filter-button','lp-staff-role','lp-staff-department'])assert.equal(e(id).disabled,true);c.selectLeaveStaff('B-2');c.changeStaffSearch();assert.equal(e('lp-employee').value,'A-1');assert.equal(e('lp-staff-hint').textContent,'');
});
test('background refresh retains a live query and filters, and invalidates a removed selection',()=>{
 const {context:c,element:e,db}=harness();e('lp-staff-search').value='Alex';e('lp-staff-department').value='Science';c.searchLeaveStaff();c.refreshLeaveStaff();assert.equal(e('lp-staff-search').value,'Alex');assert.equal(e('lp-staff-department').value,'Science');assert.match(e('lp-staff-results').innerHTML,/C-3/);assert.equal(e('lp-staff-filter-button').textContent,'Filters (1)');c.selectLeaveStaff('A-1');db.people=db.people.filter(p=>p.id!=='A-1');c.refreshLeaveStaff();assert.equal(e('lp-employee').value,'');
});

test('empty or whitespace queries hide staff results even on focus, reset or background refresh',()=>{
 const {context:c,element:e}=harness();for(const query of ['', '   ']){e('lp-staff-search').value=query;c.searchLeaveStaff();assert.equal(e('lp-staff-results').hidden,true);}e('lp-staff-search').value='Alex';c.changeStaffSearch();assert.equal(e('lp-staff-results').hidden,false);e('lp-staff-search').value='';c.changeStaffSearch();assert.equal(e('lp-staff-results').hidden,true);c.refreshLeaveStaff();assert.equal(e('lp-staff-results').hidden,true);
});
test('dismissed staff results stay dismissed during refresh until a new search',()=>{
 const {context:c,element:e}=harness();e('lp-staff-search').value='Alex';c.searchLeaveStaff();c.closeStaffSearch();assert.equal(e('lp-staff-results').hidden,true);c.refreshLeaveStaff();assert.equal(e('lp-staff-results').hidden,true);assert.equal(e('lp-staff-search').value,'Alex');c.searchLeaveStaff();assert.equal(e('lp-staff-results').hidden,false);
});


test('staff results show the ID card number while selection remains linked to the stored staff record',()=>{
 const {context:c,element:e,db}=harness();db.people[0].id='0699a7ff-851f-4f0f-a13d-8af45beabb4a';db.people[0].idCardNumber='  A123456  ';
 e('lp-staff-search').value='A123456';c.changeStaffSearch();const markup=e('lp-staff-results').innerHTML;
 assert.match(markup,/ID: A123456/);assert.doesNotMatch(markup,/ID: 0699a7ff/);assert.match(markup,/data-select-staff="0699a7ff-851f-4f0f-a13d-8af45beabb4a"/);
 c.selectLeaveStaff(db.people[0].id);assert.equal(e('lp-employee').value,db.people[0].id);assert.equal(db.people[0].idCardNumber,'  A123456  ');
 assert.equal(c.employeeNumber({id:'internal-uuid'}),'Not entered');
});

const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function presentation(){
 const source=fs.readFileSync('public/app.js','utf8'),ast=ts.createSourceFile('app.js',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)).map(node=>node.getText(ast)).join('\n');
 const context={Date,Map,Set,Intl,db:{people:[{id:'STAFF-A',name:'Sample Staff',devicePin:'001'}]},esc:escapeHtml,nice:date=>date?new Date(date+'T12:00:00').toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'}):'—'};
 vm.createContext(context);vm.runInContext(declarations,context);
 context.personCell=name=>'<div class="person"><strong>'+escapeHtml(name)+'</strong></div>';
 context.statusTag=status=>'<span class="status">'+escapeHtml(status)+'</span>';
 assert.equal(typeof context.leaveRecordRowMarkup,'function','The application exposes the actual record row renderer');
 assert.equal(typeof context.leaveRecordDatesMarkup,'function','The application exposes the actual date renderer');
 return context;
}
const fixture=changes=>({id:'LEAVE-A',employeeId:'STAFF-A',name:'Sample Staff',type:'Family',payBasis:'Paid',start:'2026-11-01',end:'2026-11-06',days:3,deductibleDays:3,status:'Approved',appliedOn:'2026-10-28',...changes});
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const cells=html=>[...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);

test('leave type omits pay information; applied date sits with employee in a six-column record',()=>{
 const view=presentation(),row=view.leaveRecordRowMarkup(fixture()),columns=cells(row);
 assert.equal(columns.length,6);
 assert.match(text(columns[0]),/Sample Staff/);assert.match(text(columns[0]),/Applied/);
 assert.match(columns[1],/<strong\b[^>]*>Family<\/strong>/);assert.doesNotMatch(text(columns[1]),/Pay:|Paid/);
 assert.doesNotMatch(text(columns[2]),/Applied/);
 const noPay=view.leaveRecordRowMarkup(fixture({payBasis:undefined}));assert.doesNotMatch(text(cells(noPay)[1]),/Pay:/);
});

test('leave period ends one day before expected return and returned date has its own label',()=>{
 const view=presentation(),dates=view.leaveRecordDatesMarkup(fixture({returnedAt:'2026-11-04 06:55:00'})),plain=text(dates);
 assert.match(plain,/Expected return/);assert.match(plain,/Returned/);
 assert.match(dates,/<strong[^>]*>01\/11\/2026 – 05\/11\/2026<\/strong>/);
 assert.match(dates,/2026-11-06|Nov\s+6/);assert.match(dates,/2026-11-04|Nov\s+4/);
});

test('single-day, month-boundary and year-boundary periods retain inclusive calendar dates',()=>{
 const view=presentation();
 for(const [start,end,expected] of [['2026-11-01','2026-11-02','01/11/2026'],['2026-10-29','2026-11-03','29/10/2026 – 02/11/2026'],['2026-12-30','2027-01-03','30/12/2026 – 02/01/2027']]){
  const dates=view.leaveRecordDatesMarkup(fixture({start,end})),range=dates.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1];assert.equal(text(range||''),expected,start+' through the day before '+end);
 }
 const duty=view.leaveRecordDatesMarkup(fixture({type:'Duty travel'}));assert.doesNotMatch(text(duty),/Expected return/);
});

test('completed records distinguish actual used days from planned days and retain all review notes',()=>{
 const view=presentation(),row=view.leaveRecordRowMarkup(fixture({status:'Completed',usedDays:1.5,returnReview:'Return review note',policyReview:'Policy review note',medicalReview:{status:'Medical review note'}})),columns=cells(row);
 assert.match(text(columns[3]),/1\.5/);assert.match(text(columns[3]),/3/);
 for(const note of ['Return review note','Policy review note','Medical review note'])assert.ok(text(row).includes(note),note+' remains visible');
 assert.match(text(columns[5]),/Adjust days/);
 const zeroUsed=cells(view.leaveRecordRowMarkup(fixture({status:'Completed',usedDays:0})))[3];assert.match(text(zeroUsed),/^0 days Used/,'recorded zero used days must not fall back to planned days');
});

test('record actions retain Edit then Delete, expose conditional actions and omit the stray dash',()=>{
 const view=presentation(),approved=cells(view.leaveRecordRowMarkup(fixture()))[5],pending=cells(view.leaveRecordRowMarkup(fixture({status:'Pending'})))[5],duty=cells(view.leaveRecordRowMarkup(fixture({type:'Duty travel'})))[5];
 assert.match(approved,/>Edit<\/button>\s*<button[^>]*data-delete-leave=/);assert.equal(text(approved),'Edit Delete');
 assert.match(text(pending),/Approve/);assert.match(text(pending),/Decline/);assert.match(text(duty),/Record return/);
});

test('record metadata is escaped and reasons or duty details are available without crowding the row',()=>{
 const view=presentation(),row=view.leaveRecordRowMarkup(fixture({name:'<img src=x onerror=alert(1)>',type:'<b>Family</b>',payBasis:'<svg onload=x>',reason:'<script>private</script>',duty:{destination:'<i>Island</i>',purpose:'<b>Meeting</b>',approvalReference:'<order>',lastDate:'2026-11-05',startTime:'07:00',endTime:'16:00',reportedAt:'2026-11-06T07:00',reportReference:'<report>'}}));
 assert.doesNotMatch(row,/<img\b|<script\b|<svg\b|<order>|<report>/);
 for(const value of ['&lt;img','&lt;b&gt;Family&lt;/b&gt;','&lt;script&gt;private&lt;/script&gt;','&lt;i&gt;Island&lt;/i&gt;','&lt;order&gt;','&lt;report&gt;'])assert.ok(row.includes(value),value+' is retained as text');
 assert.match(row,/<details\b/);
});

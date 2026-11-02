const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/app.js','utf8'),KEY='haazir-tab-session-v1',IDLE=30*60*1000;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(api,options={}){
  let now=Date.UTC(2026,9,31,9);const elements=new Map(),storage=new Map(options.saved?[[KEY,JSON.stringify(options.saved)]]:[]),events={},timers=new Map();let nextTimer=0;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  function element(id){if(!elements.has(id))elements.set(id,{value:'',type:'password',style:{},attrs:{},handlers:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},focus(){},querySelector(){return element('submit');}});return elements.get(id);}
  const context={api,Date:Clock,Promise,JSON,Number,sessionStorage:{getItem:k=>{if(options.blockStorage)throw new Error('disabled');return storage.get(k)||null;},setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},performance:{getEntriesByType:()=>[{type:options.navigation||'navigate'}]},document:{getElementById:element,visibilityState:'visible',addEventListener:(k,v)=>{events[k]=v;}},window:{addEventListener:(k,v)=>{events[k]=v;}},render(){context.renders++;},closeModal(){},resetAttendanceReport(){},setDate(){},setTimeout:(cb,delay)=>{const id=++nextTimer;timers.set(id,{cb,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:cb=>{context.poll=cb;},renders:0};vm.createContext(context);
  vm.runInContext('let authenticated=false,authGeneration=0,loginBusy=false,db={},editingLeaveId=null,editingLeaveRevision=null,pendingMcUpload=null;'+source.slice(source.indexOf('function setAuthenticated('),source.indexOf('function toast('))+source.slice(source.indexOf('// Session lifecycle:'),source.indexOf('async function saveAction')),context);
  return {context,element,storage,events,run:code=>vm.runInContext(code,context),ready:()=>vm.runInContext('sessionReady',context),advance:ms=>{now+=ms;},now:()=>now,fireDueTimers:()=>{for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.cb();}},submit:async password=>{element('login-password').value=password;await element('login-form').handlers.submit({preventDefault(){},currentTarget:element('login-form')});}};
}
const saved=age=>({version:1,lastActivityAt:Date.UTC(2026,9,31,9)-age});
test('fresh openings require sign-in even if a browser restores a previous tab marker',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {};},{saved:saved(1000)});await h.ready();assert.deepEqual(calls,['/api/auth/logout']);assert.equal(h.run('authenticated'),false);assert.equal(h.context.renders,0);assert.equal(h.storage.has(KEY),false);
});
test('normal reload resumes a valid recent session without entering a password',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {people:[]};},{navigation:'reload',saved:saved(29*60*1000)});await h.ready();assert.deepEqual(calls,['/api/auth/session','/api/state']);assert.equal(h.run('authenticated'),true);assert.equal(h.context.renders,1);assert.equal(JSON.parse(h.storage.get(KEY)).lastActivityAt,h.now());
});
test('reload at the 30-minute boundary signs out without reading private data',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {};},{navigation:'reload',saved:saved(IDLE)});await h.ready();assert.deepEqual(calls,['/api/auth/logout']);assert.equal(h.run('authenticated'),false);assert.match(h.element('login-error').textContent,/inactive for 30 minutes/);
});
test('reload cannot restore an expired server cookie or a missing/unavailable tab marker',async()=>{
  for(const options of [{navigation:'reload',saved:saved(1000)},{navigation:'reload'},{navigation:'reload',saved:saved(1000),blockStorage:true}]){
    const calls=[],h=harness(async path=>{calls.push(path);if(path.endsWith('/session'))throw Object.assign(new Error('expired'),{status:401});return {};},options);await h.ready();assert.equal(h.run('authenticated'),false);assert.equal(calls.includes('/api/state'),false);assert.equal(h.storage.has(KEY),false);
  }
});
test('login waits for startup logout, and partial passwords cannot load private data',async()=>{
  const ready=deferred(),calls=[],h=harness(async path=>{calls.push(path);if(path.endsWith('logout'))return ready.promise;if(path.endsWith('login'))throw new Error('Incorrect administrator password.');throw new Error('Unexpected state request');});
  const submit=h.submit('half');await tick();assert.deepEqual(calls,['/api/auth/logout']);ready.resolve({});await submit;assert.deepEqual(calls,['/api/auth/logout','/api/auth/login']);assert.equal(h.run('authenticated'),false);assert.equal(h.storage.has(KEY),false);assert.match(h.element('login-error').textContent,/Incorrect/);
});
test('successful login stores only the activity timestamp and polling does not extend inactivity',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {people:[]};});await h.submit('full-password');assert.equal(h.run('authenticated'),true);assert.equal(h.context.renders,1);assert.equal(h.storage.get(KEY).includes('full-password'),false);const activity=JSON.parse(h.storage.get(KEY)).lastActivityAt;
  h.advance(29*60*1000);h.context.poll();await tick();assert.equal(h.run('authenticated'),true);assert.equal(JSON.parse(h.storage.get(KEY)).lastActivityAt,activity);assert.equal(calls.includes('/api/auth/session'),false);
  h.advance(60*1000);h.context.poll();await tick();assert.equal(h.run('authenticated'),false);assert.equal(h.storage.has(KEY),false);assert.match(h.element('login-error').textContent,/inactive/);
});
test('real activity renews the session and resets the idle boundary; synthetic events do not',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {people:[]};});await h.submit('full-password');const before=JSON.parse(h.storage.get(KEY)).lastActivityAt;h.advance(20*60*1000);h.events.pointerdown({isTrusted:false});assert.equal(JSON.parse(h.storage.get(KEY)).lastActivityAt,before);
  h.events.keydown({isTrusted:true});await tick();assert.equal(calls.filter(p=>p==='/api/auth/session').length,1);assert.equal(JSON.parse(h.storage.get(KEY)).lastActivityAt,h.now());h.advance(20*60*1000);assert.equal(h.run('checkSessionTimeout()'),false);assert.equal(h.run('authenticated'),true);h.advance(10*60*1000);assert.equal(h.run('checkSessionTimeout()'),true);
});
test('activity after a suspended 30-minute gap locks instead of renewing an expired session',async()=>{
  const calls=[],h=harness(async path=>{calls.push(path);return {people:[]};});await h.submit('full-password');h.advance(IDLE);h.events.pointerdown({isTrusted:true});await tick();assert.equal(h.run('authenticated'),false);assert.equal(calls.includes('/api/auth/session'),false);assert.equal(h.storage.has(KEY),false);
});
test('idle timer locks the visible app, and visibility/focus recheck sleeping phones',async()=>{
  for(const trigger of ['timer','visibilitychange','focus']){
    const h=harness(async()=>({people:[]}));await h.submit('full-password');h.advance(IDLE);if(trigger==='timer')h.fireDueTimers();else h.events[trigger]();await tick();assert.equal(h.run('authenticated'),false);assert.equal(h.storage.has(KEY),false);
  }
});
test('pagehide hides private data but preserves the reload marker; new openings still require sign-in',async()=>{
  const h=harness(async()=>({people:[]}));await h.submit('full-password');h.events.pagehide();assert.equal(h.run('authenticated'),false);assert.equal(h.storage.has(KEY),true);
  const reopened=harness(async()=>({}),{saved:JSON.parse(h.storage.get(KEY)),navigation:'navigate'});await reopened.ready();assert.equal(reopened.run('authenticated'),false);assert.equal(reopened.storage.has(KEY),false);
});
test('explicit sign-out clears the marker and blocks in-flight refresh from reopening the dashboard',async()=>{
  const state=deferred();let pending=false;const h=harness(async path=>path==='/api/state'&&pending?state.promise:{people:[]});await h.submit('full-password');pending=true;const renders=h.context.renders,refresh=h.run('refreshState()');await h.element('logout').handlers.click();state.resolve({people:[]});await refresh;assert.equal(h.run('authenticated'),false);assert.equal(h.context.renders,renders);assert.equal(h.storage.has(KEY),false);
});
test('back-forward cached page resumes only while its session is still active',async()=>{
  const h=harness(async()=>({people:[]}));await h.submit('full-password');h.events.pagehide();h.events.pageshow({persisted:true});await h.ready();assert.equal(h.run('authenticated'),true);h.advance(IDLE);h.events.pagehide();h.events.pageshow({persisted:true});await h.ready();assert.equal(h.run('authenticated'),false);
});
test('a late session restoration cannot reopen the app after explicit sign-out',async()=>{
  const response=deferred();const h=harness(async path=>path==='/api/state'?response.promise:{},{navigation:'reload',saved:saved(1000)});await tick();await h.element('logout').handlers.click();response.resolve({people:[]});await h.ready();assert.equal(h.run('authenticated'),false);assert.equal(h.context.renders,0);
});
test('password toggle changes visibility without submitting the form',async()=>{
  const h=harness(async()=>({}));await h.ready();h.element('toggle-password').handlers.click();assert.equal(h.element('login-password').type,'text');h.element('toggle-password').handlers.click();assert.equal(h.element('login-password').type,'password');
});
test('email recovery verifies a code before showing password fields and changing the password',async()=>{
  const calls=[],h=harness(async(path,options)=>{calls.push(path);const body=options?.body?JSON.parse(options.body):{};if(path.endsWith('request-code'))assert.deepEqual(body,{email:'admin@gmail.com'});if(path.endsWith('verify-code'))assert.deepEqual(body,{email:'admin@gmail.com',code:'123456'});if(path.endsWith('reset-password'))assert.deepEqual(body,{password:'new-password'});return {};});await h.ready();
  h.element('forgot-password').handlers.click();assert.equal(h.element('login-form').hidden,true);assert.equal(h.element('recovery-password-step').hidden,true);h.element('recovery-email').value='admin@gmail.com';
  const submit=()=>h.element('recovery-form').handlers.submit({preventDefault(){},currentTarget:h.element('recovery-form')});
  await submit();assert.equal(h.element('recovery-code-step').hidden,false);assert.equal(h.element('recovery-password-step').hidden,true);
  h.element('recovery-code').value='123456';await submit();assert.equal(h.element('recovery-password-step').hidden,false);assert.equal(h.element('recovery-code').value,'');
  h.element('recovery-password').value='new-password';h.element('recovery-confirm').value='different';await submit();assert.match(h.element('recovery-message').textContent,/do not match/);assert.equal(calls.includes('/api/auth/reset-password'),false);
  h.element('recovery-confirm').value='new-password';await submit();assert.equal(h.element('login-form').hidden,false);for(const id of ['recovery-email','recovery-code','recovery-password','recovery-confirm'])assert.equal(h.element(id).value,'');assert.equal(h.run('authenticated'),false);assert.equal(h.context.renders,0);assert.equal(h.storage.has(KEY),false);assert.match(h.element('login-error').textContent,/reset successfully/);assert.equal(calls.includes('/api/state'),false);
});
test('failed verification never reveals new password fields; failed mail does not advance the screen',async()=>{
  for(const failing of ['request-code','verify-code']){
    const h=harness(async path=>{if(path.endsWith(failing))throw new Error('Recovery failed');return {};});await h.ready();h.element('forgot-password').handlers.click();h.element('recovery-email').value='admin@gmail.com';const submit=()=>h.element('recovery-form').handlers.submit({preventDefault(){},currentTarget:h.element('recovery-form')});await submit();if(failing==='verify-code'){h.element('recovery-code').value='wrong';await submit();}assert.equal(h.element('recovery-password-step').hidden,true);assert.match(h.element('recovery-message').textContent,/Recovery failed/);
  }
});

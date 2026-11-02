const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path'),os=require('node:os');
const directories=[];after(()=>{for(const directory of directories){for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}});
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'haazir-email-tests-'));directories.push(directory);
 const env={HAAZIR_DB_PATH:path.join(directory,'db.json'),HAAZIR_ADMIN_PASSWORD:'old-test-password',HAAZIR_SESSION_SECRET:'test-session-secret',HAAZIR_RECOVERY_EMAIL:'admin@gmail.com',HAAZIR_GMAIL_USER:'sender@gmail.com',HAAZIR_GMAIL_APP_PASSWORD:'abcdefghijklmnop',NODE_ENV:'test'};
 let now=Date.now(),fail=false,sendHook=null;class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const sent=[],options=[],cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='next/server'?{NextResponse:{json:(body,opts)=>new Response(JSON.stringify(body),opts)}}:n==='nodemailer'?{createTransport:config=>{options.push(config);return {sendMail:async mail=>{sent.push(mail);if(sendHook)await sendHook();if(fail)throw new Error('SMTP failure with secret '+env.HAAZIR_GMAIL_APP_PASSWORD);return {accepted:[mail.to]};},close(){}};}}:n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n),Date:Clock,Buffer,URL,Uint8Array,process:{env,cwd:()=>process.cwd()}});return exports;
 }
 return {env,directory,sent,options,load,credentials:load('lib/admin-credentials'),auth:load('lib/auth'),email:load('lib/email-recovery'),request:load('app/api/auth/request-code/route').POST,verify:load('app/api/auth/verify-code/route').POST,reset:load('app/api/auth/reset-password/route').POST,advance:ms=>{now+=ms;},fail:()=>{fail=true;},hook:fn=>{sendHook=fn;},code:()=>sent.at(-1).text.match(/code is: (\d{6})/)[1]};
}
const request=(body,cookie,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/auth/reset-password',{method:'POST',headers:{host:'localhost:3000',origin,...(cookie?{cookie}:{})},body:JSON.stringify(body)});
async function verified(f){assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,200);const response=await f.verify(request({email:'admin@gmail.com',code:f.code()}));assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
test('mail uses Gmail TLS and the fixed registered address; responses and disk never contain the code',async()=>{
 const f=fixture();const response=await f.request(request({email:'ADMIN@gmail.com'}));assert.equal(response.status,200);assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'admin@gmail.com');assert.equal(f.sent[0].from.address,'sender@gmail.com');assert.equal(f.options[0].host,'smtp.gmail.com');assert.equal(f.options[0].secure,true);assert.equal(f.options[0].port,465);assert.equal(f.options[0].logger,false);assert.equal(f.options[0].disableUrlAccess,true);
 const body=await response.text(),raw=fs.readFileSync(f.credentials.credentialsPath(),'utf8');assert.equal(body.includes(f.code()),false);assert.equal(raw.includes(f.code()),false);assert.equal(raw.includes(f.env.HAAZIR_GMAIL_APP_PASSWORD),false);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('unregistered addresses receive a generic response and cannot redirect mail or get a grant',async()=>{
 const f=fixture();const response=await f.request(request({email:'attacker@gmail.com'}));assert.equal(response.status,200);assert.equal(f.sent.length,0);assert.equal((await f.verify(request({email:'attacker@gmail.com',code:'123456'}))).status,400);
});
test('successful verification issues only a reset grant; reset invalidates old credentials and consumes it',async()=>{
 const f=fixture(),oldCookie=f.auth.sessionCookie().split(';')[0],cookie=await verified(f);assert.match(cookie,/haazir_reset=/);assert.equal(f.auth.isAdmin(new Request('http://localhost',{headers:{cookie}})),false);assert.equal(f.auth.verifyAdminPassword('old-test-password'),true);
 const response=await f.reset(request({password:'new-test-password'},cookie));assert.equal(response.status,200);assert.equal(f.auth.verifyAdminPassword('new-test-password'),true);assert.equal(f.auth.verifyAdminPassword('old-test-password'),false);assert.equal(f.auth.isAdmin(new Request('http://localhost',{headers:{cookie:oldCookie}})),false);assert.equal((await f.reset(request({password:'another-password'},cookie))).status,400);assert.equal((await f.verify(request({email:'admin@gmail.com',code:f.code()}))).status,400);
});
test('reset cannot bypass email verification by sending an email code directly or forging a cookie',async()=>{
 const f=fixture();await f.request(request({email:'admin@gmail.com'}));assert.equal((await f.reset(request({code:f.code(),password:'new-password'}))).status,400);assert.equal((await f.reset(request({password:'new-password'}))).status,400);assert.equal((await f.reset(request({password:'new-password'},'haazir_reset='+'a'.repeat(64)))).status,400);assert.equal(f.auth.verifyAdminPassword('old-test-password'),true);
});
test('wrong-code attempts persist and lock out after five; expired codes fail',async()=>{
 const f=fixture();await f.request(request({email:'admin@gmail.com'}));for(let i=0;i<5;i++)assert.equal((await f.verify(request({email:'admin@gmail.com',code:'not-the-code'}))).status,400);assert.equal(f.credentials.readCredentials().emailRecovery.attempts,5);assert.equal((await f.verify(request({email:'admin@gmail.com',code:f.code()}))).status,400);f.advance(61000);await f.request(request({email:'admin@gmail.com'}));f.advance(10*60*1000);assert.equal((await f.verify(request({email:'admin@gmail.com',code:f.code()}))).status,400);
});
test('resends enforce persisted minute/hour limits, replace old codes and invalidate verified grants',async()=>{
 const f=fixture(),grant=await verified(f);assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,429);f.advance(61000);await f.request(request({email:'admin@gmail.com'}));assert.equal((await f.reset(request({password:'new-password'},grant))).status,400);for(let i=0;i<3;i++){f.advance(61000);assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,200);}f.advance(61000);assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,429);assert.equal(f.sent.length,5);assert.equal(f.credentials.readCredentials().emailRecoveryRequests.length,5);
});
test('verification cookies are HttpOnly, restricted and expire; failed password validation preserves the grant',async()=>{
 const f=fixture();await f.request(request({email:'admin@gmail.com'}));f.env.NODE_ENV='production';const response=await f.verify(request({email:'admin@gmail.com',code:f.code()}));const header=response.headers.get('set-cookie');assert.match(header,/Path=\/api\/auth\/reset-password; HttpOnly; SameSite=Strict; Max-Age=600; Secure/);const cookie=header.split(';')[0];assert.equal((await f.reset(request({password:'123'},cookie))).status,400);f.advance(10*60*1000);assert.equal((await f.reset(request({password:'new-password'},cookie))).status,400);
});
test('failed delivery invalidates the pending code and never exposes SMTP secrets',async()=>{
 const f=fixture();f.fail();const response=await f.request(request({email:'admin@gmail.com'}));assert.equal(response.status,503);assert.equal((await response.text()).includes(f.env.HAAZIR_GMAIL_APP_PASSWORD),false);assert.equal(f.credentials.readCredentials().emailRecovery,undefined);assert.equal((await f.verify(request({email:'admin@gmail.com',code:f.code()}))).status,400);
});
test('codes cannot be used while mail is pending, and concurrent requests cannot bypass the cooldown',async()=>{
 const f=fixture();let release;f.hook(()=>new Promise(resolve=>{release=resolve;}));const pending=f.request(request({email:'admin@gmail.com'}));while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.verify(request({email:'admin@gmail.com',code:f.code()}))).status,400);assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,429);release();assert.equal((await pending).status,200);
});
test('missing Gmail settings, foreign origins and oversized bodies fail without sending',async()=>{
 const f=fixture();for(const handler of [f.request,f.verify]){assert.equal((await handler(request({},undefined,'https://attacker.test'))).status,403);assert.equal((await handler(request({email:'x'.repeat(5000)}))).status,413);}delete f.env.HAAZIR_GMAIL_APP_PASSWORD;assert.equal((await f.request(request({email:'admin@gmail.com'}))).status,503);assert.equal(f.sent.length,0);
});
test('changing the registered recovery address invalidates previously verified grants',async()=>{
 const f=fixture(),grant=await verified(f);f.env.HAAZIR_RECOVERY_EMAIL='replacement@gmail.com';assert.equal((await f.reset(request({password:'new-password'},grant))).status,400);
});

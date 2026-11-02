const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path'),os=require('node:os');
const directories=[];
after(()=>{for(const directory of directories){for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}});
function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'haazir-recovery-'));directories.push(directory);
  const env={NODE_ENV:'test',HAAZIR_DB_PATH:path.join(directory,'db.json'),HAAZIR_ADMIN_PASSWORD:'existing-test-password',HAAZIR_SESSION_SECRET:'synthetic-secret-only-for-tests'};
  function loader(){const cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='next/server'?{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}}:n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n),process:{env,cwd:()=>process.cwd()},Date,Buffer,URL,Uint8Array});return exports;}return load;}
  const load=loader();return {directory,env,loader,credentials:load('lib/admin-credentials'),auth:load('lib/auth'),reset:load('app/api/auth/reset-password/route').POST,login:load('app/api/auth/login/route').POST};
}
async function issue(f,now){return (await import('../scripts/password-recovery.mjs')).issueRecoveryCode(f.env,now);}
const request=body=>new Request('http://localhost:3000/api/auth/reset-password',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:JSON.stringify(body)});
test('recovery issues a random hashed, expiring code without changing the current password',async()=>{
  const f=fixture(),now=Date.now(),token=await issue(f,now);assert.match(token.code,/^[a-f0-9]{64}$/);assert.equal(token.expiresAt,now+30*60*1000);const raw=fs.readFileSync(f.credentials.credentialsPath(),'utf8');assert.equal(raw.includes(token.code),false);assert.equal(raw.includes(f.env.HAAZIR_ADMIN_PASSWORD),false);assert.equal(f.auth.verifyAdminPassword(f.env.HAAZIR_ADMIN_PASSWORD),true);
});
test('successful reset persists a salted hash, invalidates old passwords/sessions and consumes the code',async()=>{
  const f=fixture(),token=await issue(f),oldCookie=f.auth.sessionCookie().split(';')[0];const response=await f.reset(request({code:token.code,password:'new-test-password'}));assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal(response.headers.get('cache-control'),'no-store');
  const raw=fs.readFileSync(f.credentials.credentialsPath(),'utf8');assert.equal(raw.includes('new-test-password'),false);assert.equal(raw.includes(token.code),false);assert.equal(f.auth.verifyAdminPassword(f.env.HAAZIR_ADMIN_PASSWORD),false);assert.equal(f.auth.verifyAdminPassword('new-test-passwor'),false);assert.equal(f.auth.verifyAdminPassword('new-test-password'),true);assert.equal(f.auth.isAdmin(new Request('http://localhost',{headers:{cookie:oldCookie}})),false);
  const restarted=f.loader()('lib/auth');assert.equal(restarted.verifyAdminPassword('new-test-password'),true);
  assert.equal((await f.reset(request({code:token.code,password:'another-password'}))).status,400);
  const login=await f.login(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:JSON.stringify({password:'new-test-password'})}));assert.equal(login.status,200);assert.equal(f.auth.isAdmin(new Request('http://localhost',{headers:{cookie:login.headers.get('set-cookie').split(';')[0]}})),true);
});
test('expired and replaced codes cannot reset the password',async()=>{
  const f=fixture(),expired=await issue(f,Date.now()-31*60*1000);assert.equal((await f.reset(request({code:expired.code,password:'new-password'}))).status,400);const first=await issue(f),second=await issue(f);assert.notEqual(first.code,second.code);assert.equal((await f.reset(request({code:first.code,password:'new-password'}))).status,400);assert.equal((await f.reset(request({code:second.code,password:'new-password'}))).status,200);
});
test('five wrong guesses lock the recovery code; generating a new code restores recovery',async()=>{
  const f=fixture(),token=await issue(f);for(let i=0;i<5;i++)assert.equal((await f.reset(request({code:'wrong-code',password:'new-password'}))).status,400);assert.equal((await f.reset(request({code:token.code,password:'new-password'}))).status,400);assert.equal(f.auth.verifyAdminPassword(f.env.HAAZIR_ADMIN_PASSWORD),true);const next=await issue(f);assert.equal((await f.reset(request({code:next.code,password:'new-password'}))).status,200);
});
test('reissuing recovery preserves a saved password and invalidates the previous code',async()=>{
  const f=fixture(),first=await issue(f);assert.equal((await f.reset(request({code:first.code,password:'saved-password'}))).status,200);await issue(f);assert.equal(f.auth.verifyAdminPassword('saved-password'),true);
});
test('invalid new passwords and missing codes cannot reset or consume a valid code',async()=>{
  const f=fixture(),token=await issue(f);for(const password of ['123','        ',null,{},'x'.repeat(129)])assert.equal((await f.reset(request({code:token.code,password}))).status,400);assert.equal((await f.reset(request({password:'new-password'}))).status,400);assert.equal((await f.reset(request({code:token.code,password:'new-password'}))).status,200);
});
test('cross-origin, oversized and malformed requests are rejected without consuming a code',async()=>{
  const f=fixture(),token=await issue(f);assert.equal((await f.reset(new Request('http://localhost:3000',{method:'POST',headers:{host:'localhost:3000',origin:'https://attacker.test'},body:JSON.stringify({code:token.code,password:'new-password'})}))).status,403);assert.equal((await f.reset(request({code:'x'.repeat(5000),password:'new-password'}))).status,413);assert.equal((await f.reset(new Request('http://localhost:3000',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:'{'}))).status,400);assert.equal((await f.reset(request({code:token.code,password:'new-password'}))).status,200);
});
test('a locked credential file rejects concurrent resets and code issuance',async()=>{
  const f=fixture(),token=await issue(f),lock=f.credentials.credentialsPath()+'.lock';fs.writeFileSync(lock,'');assert.equal((await f.reset(request({code:token.code,password:'new-password'}))).status,400);await assert.rejects(issue(f));fs.unlinkSync(lock);assert.equal((await f.reset(request({code:token.code,password:'new-password'}))).status,200);
});
test('damaged credential storage fails closed without leaking its content',async()=>{
  const f=fixture();fs.writeFileSync(f.credentials.credentialsPath(),'private-broken-value');const response=await f.reset(request({code:'code',password:'new-password'}));assert.equal(response.status,500);assert.equal((await response.text()).includes('private-broken-value'),false);assert.throws(()=>f.auth.verifyAdminPassword(f.env.HAAZIR_ADMIN_PASSWORD));
});

const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
function harness(){
  const env={HAAZIR_ADMIN_PASSWORD:'test-full-password',HAAZIR_SESSION_SECRET:'test-session-secret',NODE_ENV:'test',HAAZIR_DB_PATH:require('node:path').join(require('node:os').tmpdir(),'haazir-auth-'+crypto.randomUUID(),'db.json')};
  const cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='next/server'?{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}}:n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n),process:{env},Buffer,Date,URL});return exports;
  }
  return {env,auth:load('lib/auth'),login:load('app/api/auth/login/route').POST,logout:load('app/api/auth/logout/route').POST};
}
const request=(password,cookie)=>new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json',...(cookie?{cookie}: {})},body:JSON.stringify({password})});
test('password requires an exact, complete string; prefixes, suffixes and non-string inputs fail',()=>{
  const {auth}=harness();for(const input of ['','test','test-full-passwor','test-full-password ',' test-full-password','TEST-full-password',123,{},[],null,undefined])assert.equal(auth.verifyAdminPassword(input),false);
  assert.equal(auth.verifyAdminPassword('test-full-password'),true);
});
test('only a complete password creates a valid server session',async()=>{
  const {auth,login}=harness();for(const input of ['test','test-full-passwor',123,{},null]){const response=await login(request(input));assert.equal(response.status,401);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);}
  const response=await login(request('test-full-password'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(auth.isAdmin(new Request('http://localhost:3000',{headers:{cookie}})),true);
});
test('incorrect password clears an existing session instead of leaving its cookie active',async()=>{
  const {auth,login}=harness();const oldCookie=auth.sessionCookie().split(';')[0];const response=await login(request('test',oldCookie));assert.equal(response.status,401);assert.match(response.headers.get('set-cookie'),/haazir_admin=;.*HttpOnly.*Max-Age=0/);
});
test('malformed JSON is rejected and expires the session',async()=>{
  const {login}=harness();const response=await login(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:'{broken'}));assert.equal(response.status,401);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});
test('sessions reject tampering, invalid expiration, extra parts, expiry and password changes',()=>{
  const {auth,env}=harness();const signed=value=>value+'.'+crypto.createHmac('sha256',env.HAAZIR_SESSION_SECRET).update('haazir-session-v3\0').update(env.HAAZIR_ADMIN_PASSWORD).update('\0').update(value).digest('base64url');
  const valid=auth.sessionCookie().split(';')[0].split('=')[1];
  for(const token of [valid+'.',valid+'.extra',valid+'x',signed('admin.NaN'),signed('admin.Infinity'),signed('admin.'+Date.now()),signed('admin.1')])assert.equal(auth.isAdmin(new Request('http://localhost',{headers:{cookie:'haazir_admin='+token}})),false);
  env.HAAZIR_ADMIN_PASSWORD='changed-password';assert.equal(auth.isAdmin(new Request('http://localhost',{headers:{cookie:'haazir_admin='+valid}})),false);
});
test('logout always expires cookies but cross-origin requests cannot modify sessions',async()=>{
  const {logout,login}=harness();const response=await logout(request(undefined));assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  for(const handler of [login,logout]){const response=await handler(new Request('http://localhost:3000',{method:'POST',headers:{host:'localhost:3000',origin:'http://elsewhere.test'},body:'{}'}));assert.equal(response.status,403);assert.equal(response.headers.get('set-cookie'),null);}
});

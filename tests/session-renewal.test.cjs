const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
const IDLE=30*60*1000;
function harness(){
  let now=Date.UTC(2026,9,31,9);class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const env={HAAZIR_ADMIN_PASSWORD:'fixture-password',HAAZIR_SESSION_SECRET:'fixture-session-secret',NODE_ENV:'test',HAAZIR_DB_PATH:path.join(os.tmpdir(),'haazir-session-'+crypto.randomUUID(),'db.json')},cache={};
  function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='next/server'?{NextResponse:{json:(body,options)=>Response.json(body,options)}}:n.startsWith('@/')?load(n.slice(2)):n.startsWith('./')?load('lib/'+n.slice(2)):require(n),process:{env},Buffer,Date:Clock,URL});return exports;}
  return {auth:load('lib/auth'),renew:load('app/api/auth/session/route').POST,advance:ms=>{now+=ms;},now:()=>now};
}
const cookiePair=response=>response.headers.get('set-cookie').split(';')[0];
const request=(cookie,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/auth/session',{method:'POST',headers:{host:'localhost:3000',origin,...(cookie?{cookie}:{})}});
test('session cookies are HttpOnly browser-session cookies with an exact signed 30-minute expiry',()=>{
  const h=harness(),cookie=h.auth.sessionCookie();assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.doesNotMatch(cookie,/Max-Age=|Expires=/);assert.equal(Number(cookie.split(';')[0].split('.')[1]),h.now()+IDLE);h.advance(IDLE-1);assert.equal(h.auth.isAdmin(request(cookie)),true);h.advance(1);assert.equal(h.auth.isAdmin(request(cookie)),false);
});
test('authenticated activity renews expiry while validation alone cannot extend it',async()=>{
  const h=harness(),old=h.auth.sessionCookie().split(';')[0];h.advance(20*60*1000);const response=await h.renew(request(old));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const updated=cookiePair(response);h.advance(10*60*1000);assert.equal(h.auth.isAdmin(request(old)),false);assert.equal(h.auth.isAdmin(request(updated)),true);h.advance(20*60*1000);assert.equal(h.auth.isAdmin(request(updated)),false);
});
test('expired or missing cookies cannot renew a session',async()=>{
  const h=harness(),cookie=h.auth.sessionCookie().split(';')[0];h.advance(IDLE);for(const value of [cookie,undefined]){const response=await h.renew(request(value));assert.equal(response.status,401);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal(response.headers.get('cache-control'),'no-store');}
});
test('cross-origin renewal cannot extend or change the session cookie',async()=>{
  const h=harness(),cookie=h.auth.sessionCookie().split(';')[0],response=await h.renew(request(cookie,'http://elsewhere.test'));assert.equal(response.status,403);assert.equal(response.headers.get('set-cookie'),null);
});

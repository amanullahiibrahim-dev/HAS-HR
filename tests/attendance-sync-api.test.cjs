const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function harness() {
  let writes = 0;
  const cache = {}, store = { people: [], leaves: [], punches: [], device: { lastSeen: null, serial: null, count: 0 } };
  const env = { HAAZIR_SYNC_TOKEN: 'test-token-'.repeat(8), ZKTECO_DEVICE_SN: 'TEST-SERIAL' };
  const mock = { 'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } }, '@/lib/store': { readStore: () => store, writeStore: () => { writes++; } } };
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(name+'.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, require: n => mock[n] || (n.startsWith('@/') ? load(n.slice(2)) : n.startsWith('./') ? load('lib/'+n.slice(2)) : require(n)), Date, Map, Set, process: { env }, Buffer, Response, URL });
    return exports;
  }
  const route = load('app/api/integrations/attendance/route');
  return { store, env, writes: () => writes, send: (body, token = env.HAAZIR_SYNC_TOKEN) => route.POST(new Request('http://127.0.0.1/api/integrations/attendance', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })) };
}
const log = { serial: 'TEST-SERIAL', pin: '00042', timestamp: '2026-10-30 07:08:09', state: 1, verify: '1' };
test('direct import preserves codes/PIN, deduplicates retries and updates device contact', async () => {
  const h = harness(), payload = { logs: [log], deviceSerial: log.serial };
  const first = await h.send(payload); assert.equal(first.status, 200); assert.equal((await first.json()).inserted, 1);
  assert.equal(h.store.punches[0].pin, '00042'); assert.equal(h.store.punches[0].state, 1); assert.equal(h.store.punches[0].verify, '1');
  assert.equal(h.store.device.serial, log.serial); assert.ok(h.store.device.lastSeen);
  const second = await h.send(payload); assert.equal((await second.json()).duplicates, 1); assert.equal(h.store.device.count, 1); assert.equal(h.store.punches.length, 1);
});
test('empty direct download updates contact without inventing punches', async () => {
  const h = harness(); assert.equal((await h.send({ logs: [], deviceSerial: log.serial })).status, 200);
  assert.ok(h.store.device.lastSeen); assert.equal(h.store.device.count, 0);
});
test('wrong credentials and mismatched terminal serials cannot write', async () => {
  for (const payload of [{ logs: [log], deviceSerial: 'OTHER' }, { logs: [{ ...log, serial: 'OTHER' }], deviceSerial: 'OTHER' }, { logs: [{ ...log, timestamp: 'bad' }], deviceSerial: log.serial }]) {
    const h = harness(); assert.equal((await h.send(payload)).status, 400); assert.equal(h.writes(), 0);
  }
  const h = harness(); assert.equal((await h.send({ logs: [log] }, 'wrong')).status, 401); assert.equal(h.writes(), 0);
  delete h.env.HAAZIR_SYNC_TOKEN; assert.equal((await h.send({ logs: [log] })).status, 503);
});

test('software event labels survive import and enrich a matching raw event without duplication',async()=>{
 const h=harness();await h.send({logs:[log],deviceSerial:log.serial});const response=await h.send({logs:[{...log,eventType:'ATT IN'}],deviceSerial:log.serial});assert.equal(response.status,200);assert.equal((await response.json()).inserted,0);assert.equal(h.store.punches.length,1);assert.equal(h.store.punches[0].kind,'attendance-in');assert.equal(h.store.punches[0].eventType,'ATT IN');assert.equal(h.store.punches[0].state,log.state);
});

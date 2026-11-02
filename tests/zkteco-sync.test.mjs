import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration, normalizeRecord, runOnce } from '../scripts/zkteco-sync.mjs';

const env = { ZKTECO_DEVICE_IP: '192.168.1.201', ZKTECO_DEVICE_SN: 'TEST-SERIAL', HAAZIR_SYNC_TOKEN: 'x'.repeat(64) };
const record = () => ({ deviceUserId: '00042', recordTime: new Date(2026, 9, 30, 7, 8, 9), punch: 1, status: 1 });
function fake(records, failure) {
  const state = { connected: false, disconnected: false, reads: 0 };
  class Client {
    get isConnected() { return state.connected; }
    async connect() { state.connected = true; }
    async getInfo() { return { logCounts: records.length }; }
    async getAttendances() { state.reads++; if (failure) throw failure; return records; }
    async disconnect() { state.disconnected = true; state.connected = false; }
  }
  return { Client, state };
}
const acknowledge = body => ({ ok: true, async json() { return { received: body.logs.length, inserted: body.logs.length, duplicates: 0, unmapped: 0 }; } });

test('configuration rejects missing/public IP, bad ports and non-loopback cleartext destination', () => {
  for (const change of [{ ZKTECO_DEVICE_IP: '' }, { ZKTECO_DEVICE_IP: '8.8.8.8' }, { ZKTECO_DEVICE_PORT: '0' }, { ZKTECO_COMM_KEY: '-1' }, { HAAZIR_SYNC_URL: 'http://192.168.1.2/api/integrations/attendance' }]) {
    assert.throws(() => configuration({ ...env, ...change }));
  }
  assert.equal(configuration(env).port, 4370);
  assert.equal(configuration({ ...env, ZKTECO_COMM_KEY: '12345' }).commKey, 12345);
  assert.doesNotThrow(() => configuration({ ZKTECO_DEVICE_IP: env.ZKTECO_DEVICE_IP }, true));
  assert.throws(() => configuration({ ...env, ZKTECO_DEVICE_SN: '' }));
});

test('preserves terminal wall time, leading-zero PIN and original IN/OUT code', () => {
  assert.deepEqual(normalizeRecord(record(), 'TEST-SERIAL'), { serial: 'TEST-SERIAL', pin: '00042', timestamp: '2026-10-30 07:08:09', state: 1, verify: '1', workCode: '' });
  assert.throws(() => normalizeRecord({ ...record(), punch: undefined }, 'TEST-SERIAL'), /punch status/);
  assert.throws(() => normalizeRecord({ ...record(), recordTime: new Date(NaN) }, 'TEST-SERIAL'), /timestamp/);
});

test('connection check reads only device info, never downloads or uploads punches', async () => {
  const f = fake([record()]);
  const result = await runOnce(configuration(env, true), { Client: f.Client, send() { throw Error('Must not upload'); } });
  assert.equal(result.connected, true); assert.equal(f.state.reads, 0); assert.equal(f.state.disconnected, true);
});

test('historical download sends bounded batches after disconnecting, preserving every record', async () => {
  const f = fake(Array.from({ length: 1001 }, record)), bodies = [];
  const result = await runOnce(configuration(env), { Client: f.Client, async send(url, options) {
    assert.equal(f.state.disconnected, true);
    assert.equal(url, 'http://127.0.0.1:3000/api/integrations/attendance');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); bodies.push(body); return acknowledge(body);
  } });
  assert.deepEqual(bodies.map(b => b.logs.length), [1000, 1]);
  assert.equal(result.received, 1001); assert.equal(bodies[0].deviceSerial, 'TEST-SERIAL');
});

test('failed device reads disconnect and never import partial results', async () => {
  const f = fake([record()], Error('Download interrupted'));
  await assert.rejects(runOnce(configuration(env), { Client: f.Client, send() { throw Error('Must not upload'); } }), /interrupted/);
  assert.equal(f.state.disconnected, true);
});

test('empty machines send a heartbeat and failed or partial acknowledgments reject for retry', async () => {
  const f = fake([]);
  await runOnce(configuration(env), { Client: f.Client, async send(url, options) { const body = JSON.parse(options.body); assert.equal(body.logs.length, 0); return acknowledge(body); } });
  await assert.rejects(runOnce(configuration(env), { Client: fake([record()]).Client, async send() { return { ok: false, status: 401 }; } }), /HTTP 401/);
  await assert.rejects(runOnce(configuration(env), { Client: fake([record()]).Client, async send() { return acknowledge({ logs: [] }); } }), /acknowledge/);
});

test('suppressed logs for permanently deleted employees are acknowledged without retrying',async()=>{const result=await runOnce(configuration(env),{Client:fake([record()]).Client,async send(){return {ok:true,async json(){return {received:1,inserted:0,duplicates:0,ignored:1,unmapped:0};}};}});assert.equal(result.received,1);assert.equal(result.ignored,1);assert.equal(result.inserted,0);});

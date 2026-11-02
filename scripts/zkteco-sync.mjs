import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import nextEnv from '@next/env';
import { ZKTecoClient } from '@graphland/zkteco';

function integer(env, name, fallback, min, max) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(raw);
}

export function configuration(env, check = false) {
  const ip = env.ZKTECO_DEVICE_IP || '';
  const parts = ip.split('.').map(Number);
  if (isIP(ip) !== 4 || !(parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)) {
    throw new Error('Set ZKTECO_DEVICE_IP in .env.local to the iClock990 private IPv4 address.');
  }
  const serial = (env.ZKTECO_DEVICE_SN || '').trim();
  const token = env.HAAZIR_SYNC_TOKEN || '';
  if (!check && (!serial || serial.length > 128 || serial.startsWith('replace-'))) throw new Error('Set ZKTECO_DEVICE_SN to the actual terminal serial number.');
  if (!check && token.length < 32) throw new Error('Set HAAZIR_SYNC_TOKEN to at least 32 random characters.');
  const url = new URL(env.HAAZIR_SYNC_URL || `http://${env.HAAZIR_BIND_HOST || '127.0.0.1'}:${env.PORT || 3000}/api/integrations/attendance`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HAAZIR_SYNC_URL must be an HTTP(S) URL without embedded credentials.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for HAAZIR_SYNC_URL, or loopback HTTP on the same computer.');
  return { ip, serial, token, url: url.toString(), check,
    port: integer(env, 'ZKTECO_DEVICE_PORT', 4370, 1, 65535),
    commKey: integer(env, 'ZKTECO_COMM_KEY', 0, 0, 2147483647),
    timeout: integer(env, 'ZKTECO_TIMEOUT_MS', 10000, 1000, 60000),
    udpPort: integer(env, 'ZKTECO_UDP_PORT', 4000, 1, 65535),
    interval: integer(env, 'ZKTECO_POLL_SECONDS', 60, 10, 86400) * 1000 };
}

// The SDK constructs Dates from the terminal wall clock using host-local fields.
// Do not convert through UTC: that would shift attendance times.
export function normalizeRecord(record, serial) {
  const date = record.recordTime;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Device returned an invalid timestamp.');
  const pin = String(record.deviceUserId ?? '').trim();
  if (!pin || pin.length > 64) throw new Error('Device returned an invalid employee PIN.');
  if (!Number.isInteger(record.punch) || record.punch < 0 || record.punch > 255) throw new Error('Device returned an unsupported punch status; no records imported.');
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { serial, pin, timestamp, state: record.punch,
    verify: record.status == null ? '' : String(record.status), workCode: '' };
}

export async function runOnce(config, { Client = ZKTecoClient, send = fetch, signal } = {}) {
  const device = new Client({ ip: config.ip, port: config.port, timeout: config.timeout, udpPort: config.udpPort, commKey: config.commKey });
  let info, logs;
  try {
    await device.connect();
    info = await device.getInfo();
    if (!config.check) {
      // Validate the entire download before importing any batch. Replays deduplicate
      // at the receiving endpoint, including after a partially successful run.
      logs = (await device.getAttendances()).map(record => normalizeRecord(record, config.serial));
    }
  } finally {
    if (device.isConnected) await device.disconnect();
  }
  if (config.check) return { connected: true, info };
  const totals = { received: 0, inserted: 0, duplicates: 0, ignored: 0, unmapped: 0 };
  // Send an empty batch too, so an empty machine still updates its connection status.
  for (let start = 0; start < Math.max(logs.length, 1); start += 1000) {
    const batch = logs.slice(start, start + 1000);
    const response = await send(config.url, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ logs: batch, deviceSerial: config.serial }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Attendance import returned HTTP ${response.status}. Ensure Haaziry is running and its sync token matches.`);
    const result = await response.json();
    result.ignored ??= 0;
    if (result.received !== batch.length || Object.keys(totals).some(key => !Number.isInteger(result[key]) || result[key] < 0) || result.inserted + result.duplicates + (result.ignored || 0) !== result.received) {
      throw new Error('Attendance import did not acknowledge the complete batch; rerun to retry safely.');
    }
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }
  return { connected: true, info, ...totals };
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--watch'].includes(arg)) || args.includes('--check') && args.includes('--watch')) throw new Error('Use --check, --watch, or no option for one sync.');
  const config = configuration(process.env, args.includes('--check'));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    do {
      try {
        const result = await runOnce(config, { signal: controller.signal });
        console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      } catch (error) {
        if (controller.signal.aborted) break;
        if (!args.includes('--watch')) throw error;
        console.error(`Device sync failed; retrying after ${config.interval / 1000}s: ${error.message}`);
      }
      if (!args.includes('--watch')) break;
      await delay(config.interval, undefined, { signal: controller.signal }).catch(error => { if (!controller.signal.aborted) throw error; });
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

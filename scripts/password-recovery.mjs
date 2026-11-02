import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';

export function issueRecoveryCode(env = process.env, now = Date.now()) {
  const file = path.join(path.dirname(env.HAAZIR_DB_PATH || path.join(process.cwd(), 'data', 'haazir-data.json')), 'admin-auth.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = fs.openSync(file + '.lock', 'wx', 0o600);
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; data = { version: 1 }; }
    if (data.version !== 1) throw new Error('Invalid administrator credential storage.');
    const code = randomBytes(32).toString('hex'), expiresAt = now + 30 * 60 * 1000;
    data.recovery = { digest: createHash('sha256').update(code).digest('hex'), expiresAt, attempts: 0 };
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file);
    return { code, expiresAt };
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); fs.closeSync(lock); fs.unlinkSync(file + '.lock'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    nextEnv.loadEnvConfig(process.cwd());
    const { code, expiresAt } = issueRecoveryCode();
    console.log('One-time Haaziry administrator recovery code (keep private):\n' + code);
    console.log('Expires: ' + new Date(expiresAt).toLocaleString());
    console.log('Open Forgot password? on the sign-in page. Issuing another code invalidates this one.');
  } catch (error) { console.error('Could not create recovery code: ' + error.message); process.exitCode = 1; }
}

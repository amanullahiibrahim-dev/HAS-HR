import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';

const arrivesAtSeven = ['Teacher', 'Technical Staff', 'Support Staff', 'Deputy Principal'];

function deviceLocalTimestamp(now = Date.now()) {
  return new Date(now + 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

// Adds seed staff that are not already in the store. Existing records are never changed.
export function seedStaff(store, staff, now = Date.now()) {
  store.people ||= [];
  store.pinAssignments ||= [];
  for(const person of store.people) if(!store.pinAssignments.some(a=>a.employeeId===person.id&&a.pin===person.devicePin&&!a.to)) store.pinAssignments.push({employeeId:person.id,pin:person.devicePin,from:person.attendanceFrom || ''});
  for(const punch of store.punches || []) if(punch.employeeId===undefined){const matches=store.pinAssignments.filter(a=>a.pin===punch.pin&&a.from<=punch.timestamp&&(!a.to||punch.timestamp<a.to));punch.employeeId=matches.length===1?matches[0].employeeId:null;}
  const added = [], skipped = [];
  for (const entry of staff) {
    const clash = store.people.find(p => p.id.toLowerCase() === entry.id.toLowerCase() || p.devicePin === entry.devicePin || (entry.idCardNumber && p.idCardNumber === entry.idCardNumber));
    if (clash) { skipped.push(`${entry.name} (PIN ${entry.devicePin}): already matches ${clash.name}`); continue; }
    const person = { id: entry.id, name: entry.name, dept: entry.dept || '', role: entry.role, gender: entry.gender || '', devicePin: entry.devicePin, annual: 0, medical: 0, casual: 0, workStart: arrivesAtSeven.includes(entry.role) ? '07:00' : '08:00', idCardNumber: entry.idCardNumber || '' };
    // Same rule as the app: a PIN left by a removed employee only counts punches from now on.
    if (Object.hasOwn(store.punchImportCutoffs || {}, entry.devicePin)) {
      person.attendanceFrom = store.punchImportCutoffs[entry.devicePin] = deviceLocalTimestamp(now);
      store.punches = (store.punches || []).filter(punch => punch.pin !== entry.devicePin || !!punch.employeeId);
      if (store.device) store.device.count = store.punches.length;
    }
    const firstRegistration=!store.pinAssignments.some(a=>a.pin===person.devicePin)&&!Object.hasOwn(store.punchImportCutoffs || {},person.devicePin);
    store.pinAssignments.push({employeeId:person.id,pin:person.devicePin,from:firstRegistration?'':deviceLocalTimestamp(now)});
    if(firstRegistration) for(const punch of store.punches || []) if(punch.pin===person.devicePin&&punch.employeeId===null) punch.employeeId=person.id;
    store.people.push(person);
    added.push(person.name);
  }
  return { added, skipped };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    nextEnv.loadEnvConfig(process.cwd());
    const dbPath = process.env.HAAZIR_DB_PATH || path.join(process.cwd(), 'data', 'haazir-data.json');
    const staff = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'seed', 'staff.json'), 'utf8'));
    let store;
    try { store = JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; store = { people: [], leaves: [], punches: [], device: { lastSeen: null, serial: null, count: 0 } }; }
    const { added, skipped } = seedStaff(store, staff);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath + '.tmp', JSON.stringify(store, null, 2), 'utf8'); fs.renameSync(dbPath + '.tmp', dbPath);
    console.log(`Added ${added.length} staff, skipped ${skipped.length} already present.`);
    for (const line of skipped) console.log('  skipped: ' + line);
  } catch (error) { console.error('Could not seed staff: ' + error.message); process.exitCode = 1; }
}

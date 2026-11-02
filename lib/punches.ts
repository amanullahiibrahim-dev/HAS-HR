import { initializePunchOwnership, ownerAt } from "./punch-ownership";
import { dayPunches, normalizedPunchKind } from "./punch-classification";
import { actualUsedDays } from "./leave-requirements";
import type { Punch, Store } from "./store";
import { countLeaveDays, excludeWeekends } from "./leave-policy";

export function normalizePunch(value: unknown): Punch {
  if (!value || typeof value !== "object") throw new Error("Each log must be an object.");
  const input = value as Record<string, unknown>;
  const pin = typeof input.pin === "string" ? input.pin.trim() : "";
  const serial = typeof input.serial === "string" ? input.serial.trim() : "";
  const timestamp = typeof input.timestamp === "string" ? input.timestamp.replace("T", " ") : "";
  const state = input.state;
  const parsed = new Date(`${timestamp.replace(" ", "T")}Z`);
  if (!pin || pin.length > 64 || !serial || serial.length > 128 ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp) ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,19).replace("T"," ") !== timestamp ||
      typeof state !== "number" || !Number.isInteger(state) || state < 0 || state > 255) {
    throw new Error("Logs require pin, serial, a valid local timestamp (YYYY-MM-DD HH:mm:ss), and a numeric state from 0 to 255.");
  }
  const kind = normalizedPunchKind(input.kind, input.eventType);
  return { id: JSON.stringify([serial,pin,timestamp,state]), pin, serial, timestamp, state, verify: "", workCode: "", ...(kind ? {kind} : {}), ...(typeof input.eventType === "string" ? {eventType:input.eventType.trim()} : {}) };
}

// Compare event fields so retries also match logs saved by the older ADMS receiver.
export function ingestPunches(store: Store, incoming: Punch[]) {
  initializePunchOwnership(store);
  const key = (p: Punch) => JSON.stringify([p.serial,p.pin,p.timestamp,p.state]);
  const existing = new Set(store.punches.map(key));
  let inserted = 0, ignored = 0;
  for (const punch of incoming) {
    const cutoff=Object.hasOwn(store.punchImportCutoffs||{},punch.pin)?store.punchImportCutoffs![punch.pin]:undefined;
    if(cutoff&&(!store.people.some(person=>person.devicePin===punch.pin&&!person.removedAt)||punch.timestamp<=cutoff)){ignored++;continue;}
    if (existing.has(key(punch))) {
      const saved=store.punches.find(p=>key(p)===key(punch));
      if(saved && !saved.kind && punch.kind){saved.kind=punch.kind;saved.eventType=punch.eventType;}
      continue;
    }
    existing.add(key(punch));
    store.punches.push({...punch,employeeId:ownerAt(store,punch)});
    inserted++;
  }
  // Reconcile from sorted stored events so an out-of-order batch finds the first return.
  for (const leave of store.leaves) {
    if (leave.type === "Duty travel") continue; // An office punch does not replace the required duty-completion report.
    if (leave.status !== "Approved" && leave.status !== "Completed") continue;
    const person = store.people.find(p => p.id === leave.employeeId);
    if (!person) continue;
    const days = new Map<string,Punch[]>();
    for(const p of store.punches.filter(p=>p.employeeId===person.id && p.timestamp.slice(0,10)>leave.start)){
      const date=p.timestamp.slice(0,10);days.set(date,[...(days.get(date)||[]),p]);
    }
    const returnedAt=[...days.values()].map(day=>dayPunches(day).checkIn).filter((time):time is string=>!!time).sort()[0];
    if (!returnedAt || (leave.status === "Completed" && leave.returnedAt && leave.returnedAt <= returnedAt)) continue;
    leave.status = "Completed";
    leave.revision=(leave.revision || 0)+1;
    leave.returnedAt = returnedAt;
    leave.usedDays = actualUsedDays(leave,returnedAt.slice(0,10),store.holidays || []);
  }
  return { received: incoming.length, inserted, duplicates: incoming.length - inserted - ignored, ignored,
    unmapped: incoming.filter(p => !store.people.some(person => person.devicePin === p.pin)).length };
}

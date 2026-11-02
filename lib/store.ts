import fs from "node:fs";
import { initializePunchOwnership } from "./punch-ownership";
import path from "node:path";
import { policyForClient, resolvedEntitlements } from "./leave-policy";
import type { LeaveType } from "./leave-policy";
import { requiredArrival, offDays, lateCutoff } from "./attendance-schedule";
import { attendanceForClient } from "./attendance";
import { medicalReview } from "./leave-requirements";
import type { MedicalDetails, PilgrimageDetails } from "./leave-requirements";
import type { McDocument } from "./mc-documents";
import type { AttendanceCorrection } from "./attendance";
import type { DutyTravelDetails } from "./duty-travel";

export const staffTypes = ["Teacher", "Admin Staff", "Administrator", "Technical Staff", "Support Staff", "Principal", "Deputy Principal"] as const;

export type Staff = {
  id: string;
  name: string;
  dept: string;
  role: (typeof staffTypes)[number];
  idCardNumber?: string;
  gender?: "Male" | "Female" | "";
  devicePin: string;
  annual: number;
  medical: number;
  casual: number;
  workStart: string;
  removedAt?: string;
  attendanceFrom?: string;
};

export type Leave = {
  duty?: DutyTravelDetails;
  mcDocumentId?: string;
  eventReference?: string;
  medical?: MedicalDetails;
  trip?: PilgrimageDetails;
  chargeType?: string;
  payBasis?: string;
  appliedOn?: string;
  revision?: number;
  id: string;
  employeeId: string;
  name: string;
  type: LeaveType;
  start: string;
  end: string;
  days: number;
  usedDays?: number;
  deductibleDays?: number;
  reason: string;
  clinic?: string;
  mcNumber?: string;
  status: "Approved" | "Pending" | "Completed" | "Declined";
  returnedAt?: string;
};

export type Punch = {
  employeeId?: string | null;
  kind?: import("./punch-classification").PunchKind;
  eventType?: string;
  id: string;
  serial: string;
  pin: string;
  timestamp: string;
  state: number;
  verify: string;
  workCode: string;
};

export type Store = {
  leaveDeletions?: {id:string;leaveId:string;employeeId:string;at:string;actor:"Administrator";reason:string}[];
  pinAssignments?: {employeeId:string;pin:string;from:string;to?:string}[];
  punchImportCutoffs?: Record<string, string>;
  pendingEmployeeFileDeletes?: string[];
  mcDocuments?: McDocument[];
  leaveChanges?: { id: string; leaveId: string; actor: "Administrator"; at: string; reason: string; before: Leave; after: Leave }[];
  corrections?: AttendanceCorrection[];
  holidays?: string[];
  closedDays?: {date:string;reason:string;category:string}[];
  closedDayChanges?: {id:string;at:string;actor:"Administrator";before:{date:string;reason:string;category:string}[];after:{date:string;reason:string;category:string}[]}[];
  sync?: { lastSeen: string; lastInserted: number };
  people: Staff[];
  leaves: Leave[];
  punches: Punch[];
  device: { lastSeen: string | null; serial: string | null; count: number };
};

const dbPath = process.env.HAAZIR_DB_PATH || path.join(process.cwd(), "data", "haazir-data.json");

function freshStore(): Store {
  return { people: [], leaves: [], punches: [], device: { lastSeen: null, serial: null, count: 0 } };
}

export function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8")) as Partial<Store>;
    const store: Store = { leaveDeletions:parsed.leaveDeletions || [], closedDays: parsed.closedDays || [], closedDayChanges: parsed.closedDayChanges || [], pinAssignments: parsed.pinAssignments || [], punchImportCutoffs: parsed.punchImportCutoffs || {}, pendingEmployeeFileDeletes: parsed.pendingEmployeeFileDeletes || [], people: parsed.people || [], leaves: parsed.leaves || [], punches: parsed.punches || [], holidays: parsed.holidays || [], mcDocuments: parsed.mcDocuments || [], sync: parsed.sync, leaveChanges: parsed.leaveChanges || [], corrections: parsed.corrections || [], device: { ...freshStore().device, ...parsed.device } };
    initializePunchOwnership(store);
    return store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return freshStore();
  }
}

export function writeStore(store: Store): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const temporaryPath = `${dbPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(temporaryPath, dbPath);
}

export function makeId(): string {
  return globalThis.crypto.randomUUID();
}

export function weekdaysBeforeReturn(start: string, returnDate: string) {
  let days = 0;
  for (const date = new Date(`${start}T00:00:00Z`); date < new Date(`${returnDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const weekday = date.getUTCDay();
    if (!offDays.includes(weekday)) days += 1;
  }
  return days;
}

export function stateForClient(store = readStore()) {
  const visibleIds=new Set(store.people.filter(person=>!person.removedAt).map(person=>person.id));
  store={...store,people:store.people.filter(person=>visibleIds.has(person.id)),leaves:store.leaves.filter(leave=>visibleIds.has(leave.employeeId)),corrections:(store.corrections||[]).filter(correction=>visibleIds.has(correction.employeeId)),leaveChanges:(store.leaveChanges||[]).filter(change=>visibleIds.has(change.before.employeeId)&&visibleIds.has(change.after.employeeId))};
  const attendance = attendanceForClient(store);
  const lastSeen = store.device.lastSeen;
  const online = !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
  return {
    people: store.people.filter(person => !person.removedAt).map((person) => ({ ...person, workStart: requiredArrival(person.role), entitlements: resolvedEntitlements(person) })),
    staffTypes,
    attendanceSchedule: { byRole: Object.fromEntries(staffTypes.map(role => [role, {start:requiredArrival(role), lateFrom:lateCutoff(role)}])), teacher: requiredArrival("Teacher"), admin: requiredArrival("Admin Staff"), offDays, lateCutoffs:{teacher:lateCutoff("Teacher"),admin:lateCutoff("Admin Staff")}, arrivalRule: "late at or after cutoff" },
    leaves: store.leaves.map(leave=>({...leave,returnReview:leave.type!=="Duty travel"&&leave.returnedAt?(leave.returnedAt.slice(0,10)<=leave.start?"Same-day return: administrator review required":leave.returnedAt.slice(0,10)>leave.end?"Returned after approved leave ended: review excess absence":undefined):(leave.type!=="Duty travel"&&leave.status==="Approved"&&store.punches.some(p=>p.employeeId===leave.employeeId&&p.kind==="attendance-in"&&p.timestamp.slice(0,10)===leave.start)?"Punch on leave start date: review leave dates; not automatically cancelled":undefined),mcDocument:leave.mcDocumentId?store.mcDocuments?.find(d=>d.id===leave.mcDocumentId):undefined,medicalReview:medicalReview(leave,store.people.find(p=>p.id===leave.employeeId)||{role:"Admin Staff"} as Staff,undefined,store.holidays || []),policyReview:(leave.type==="Hajj"||leave.type==="Umra")&&!leave.trip?"Legacy pilgrimage: confirm annual / first paid Hajj / no-pay basis":leave.type==="Circumcision"&&!leave.eventReference?"Confirm circumcision occasion reference":undefined})),
    leaveChanges: store.leaveChanges || [],
    attendance,
    attendanceCorrections: store.corrections || [],
    punchHistory: store.punches.map(p=>p.timestamp).sort().filter((_,i,a)=>i===0||i===a.length-1),
    sync: store.sync || null,
    device: { ...store.device, online },
    leavePolicy: policyForClient,
    closedDays: (store.holidays || []).map(date=>store.closedDays?.find(day=>day.date===date)||{date,reason:"Previously configured closed date",category:"Other official closure"}),
    closedDayChanges: store.closedDayChanges || [],
    holidays: store.holidays || []
  };
}

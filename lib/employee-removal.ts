import fs from "node:fs";
import { initializePunchOwnership } from "./punch-ownership";
import path from "node:path";
import { mcFilePath } from "./mc-documents";
import type { Store } from "./store";

export function deviceLocalTimestamp(now = Date.now()) {
  return new Date(now + 5 * 60 * 60 * 1000).toISOString().slice(0,19).replace("T", " ");
}
export function permanentlyRemoveEmployee(store: Store, id: string, now = Date.now()) {
  const person = store.people.find(employee => employee.id === id);
  if (!person) throw new Error("Employee not found.");
  initializePunchOwnership(store);
  const leaveIds = new Set(store.leaves.filter(leave => leave.employeeId === id).map(leave => leave.id));
  const documents = (store.mcDocuments || []).filter(document => document.employeeId === id);
  store.punches = store.punches.filter(punch => punch.employeeId !== id);
  for(const assignment of store.pinAssignments || []) if(assignment.employeeId===id) store.punchImportCutoffs={...(store.punchImportCutoffs || {}),[assignment.pin]:deviceLocalTimestamp(now)};
  store.pinAssignments=(store.pinAssignments || []).filter(assignment=>assignment.employeeId!==id);
  store.people = store.people.filter(employee => employee.id !== id);
  store.leaves = store.leaves.filter(leave => leave.employeeId !== id);
  store.disciplinaryActions=(store.disciplinaryActions||[]).filter(record=>record.employeeId!==id);
  store.disciplinaryChanges=(store.disciplinaryChanges||[]).filter(change=>change.after.employeeId!==id);
  store.supervisorAssignments=(store.supervisorAssignments||[]).filter(record=>record.employeeId!==id&&!(record.supervisor.kind==="staff"&&record.supervisor.id===id));
  store.supervisorChanges=(store.supervisorChanges||[]).filter(change=>change.after.employeeId!==id&&!(change.after.supervisor.kind==="staff"&&change.after.supervisor.id===id)&&!(change.before?.supervisor.kind==="staff"&&change.before.supervisor.id===id));
  store.leaveDeletions=(store.leaveDeletions || []).filter(receipt=>receipt.employeeId!==id);
  store.corrections = (store.corrections || []).filter(correction => correction.employeeId !== id);
  store.leaveChanges = (store.leaveChanges || []).filter(change => !leaveIds.has(change.leaveId) && change.before.employeeId !== id && change.after.employeeId !== id);
  store.mcDocuments = (store.mcDocuments || []).filter(document => document.employeeId !== id);
  // Preserve another employee's logs only if legacy data incorrectly shares the same PIN.
  if (!store.people.some(employee => employee.devicePin === person.devicePin)) {
    store.punches = store.punches.filter(punch => punch.pin !== person.devicePin || !!punch.employeeId);
    store.punchImportCutoffs = { ...(store.punchImportCutoffs || {}), [person.devicePin]: deviceLocalTimestamp(now) };
  }
  store.device.count = store.punches.length;
  store.pendingEmployeeFileDeletes = [...new Set([...(store.pendingEmployeeFileDeletes || []), ...documents.map(document => document.id)])];
  return { documents: documents.length };
}
export function flushEmployeeFileDeletes(store: Store) {
  const pending: string[] = [];
  for (const id of store.pendingEmployeeFileDeletes || []) {
    // Uploaded files always use UUIDs; malformed metadata can never identify a filesystem target.
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) continue;
    const file = path.resolve(mcFilePath(id));
    const directory = path.resolve(path.dirname(mcFilePath(id)));
    if (path.dirname(file) !== directory) throw new Error("Invalid employee document path.");
    try { fs.unlinkSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") pending.push(id); }
  }
  store.pendingEmployeeFileDeletes = pending;
  return pending.length;
}
export function prepareReusedDevicePin(store: Store, pin: string, now = Date.now()) {
  if (Object.hasOwn(store.punchImportCutoffs || {}, pin)) {
    store.punchImportCutoffs = { ...store.punchImportCutoffs, [pin]: deviceLocalTimestamp(now) };
    store.punches = store.punches.filter(punch => punch.pin !== pin || !!punch.employeeId);
    store.device.count = store.punches.length;
    return store.punchImportCutoffs[pin];
  }
  return undefined;
}

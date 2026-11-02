import type { Store, Punch } from "./store";

// Device PINs are mutable. Retain assignment periods and bind every stored event once.
export function initializePunchOwnership(store: Store) {
  store.pinAssignments ||= [];
  for (const person of store.people) {
    if (!store.pinAssignments.some(a => a.employeeId === person.id && a.pin === person.devicePin && !a.to))
      store.pinAssignments.push({employeeId:person.id,pin:person.devicePin,from:person.attendanceFrom || ""});
  }
  for (const punch of store.punches) if (punch.employeeId === undefined) punch.employeeId = ownerAt(store,punch);
}
export function ownerAt(store: Store, punch: Punch): string | null {
  const matches=(store.pinAssignments || []).filter(a=>a.pin===punch.pin && a.from<=punch.timestamp && (!a.to || punch.timestamp<a.to));
  return matches.length===1 ? matches[0].employeeId : null;
}
export function assignDevicePin(store: Store, employeeId: string, pin: string, at: string, linkInitialHistory = false) {
  initializePunchOwnership(store);
  const firstRegistration=linkInitialHistory && !store.pinAssignments!.some(a=>a.pin===pin) && !Object.hasOwn(store.punchImportCutoffs || {},pin);
  for(const assignment of store.pinAssignments!) if(assignment.employeeId===employeeId && !assignment.to) assignment.to=at;
  store.pinAssignments!.push({employeeId,pin,from:firstRegistration ? "" : at});
  // Linking a previously unknown PIN for the first time may claim its unassigned import history.
  // A reused PIN can never claim a former owner's events or unassigned events from an assignment gap.
  if(firstRegistration) for(const punch of store.punches) if(punch.pin===pin && punch.employeeId===null) punch.employeeId=employeeId;
}

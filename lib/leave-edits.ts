import { dutyReport } from "./duty-travel";
import { actualUsedDays } from "./leave-requirements";
import type { Leave, Store } from "./store";
import { countLeaveDays, excludeWeekends, validLeaveDate } from "./leave-policy";

export function applyLeaveEdit(store: Store, existing: Leave, changes: Partial<Leave>, expectedRevision: unknown, reason: unknown, id: string, at: string) {
  if(expectedRevision !== (existing.revision || 0))throw new Error('This leave changed while you were editing. Reopen the record before updating.');
  if(typeof reason!=='string'||!reason.trim()||reason.trim().length>1000)throw new Error('Enter a reason for this leave change (maximum 1,000 characters).');
  if(changes.employeeId && changes.employeeId!==existing.employeeId)throw new Error('The staff member on an existing leave record cannot be changed.');
  if(changes.appliedOn && !validLeaveDate(changes.appliedOn))throw new Error('Enter a valid application date.');
  if(['Completed','Declined'].includes(existing.status)&&changes.status!==existing.status)throw new Error('Completed and declined records retain their status when edited.');
  const before={...existing};
  const after:Leave={...existing,...changes,revision:(existing.revision || 0)+1};
  if(after.status==='Completed'){
    if(!after.returnedAt || after.start>after.returnedAt.slice(0,10))throw new Error('Leave cannot start after its recorded actual return.');
    if(after.type==="Duty travel")dutyReport({...after,status:"Approved"},after.duty?.reportedAt,after.duty?.reportReference);
    after.usedDays=actualUsedDays(after,after.returnedAt.slice(0,10),store.holidays || []);
  }
  Object.assign(existing,after);
  (store.leaveChanges ||= []).push({id,leaveId:existing.id,actor:'Administrator',at,reason:reason.trim(),before,after:{...after}});
}

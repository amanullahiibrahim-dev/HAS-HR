import type { Store } from "./store";
import { attendanceForClient } from "./attendance";
import { dayPunches } from "./punch-classification";
import { actualUsedDays } from "./leave-requirements";
export function denyPunch(store:Store,input:unknown,at:string,id:string){
  const value=input as Record<string,unknown>;
  if(!value||typeof value!=="object")throw new Error("Choose a fingerprint log.");
  if(value.correctionId!==undefined){
    const correction=(store.corrections||[]).find(c=>c.id===value.correctionId&&c.employeeId===value.employeeId&&c.date===value.date);
    const field=value.field;
    if(!correction||correction.noteOnly||(field!=="checkIn"&&field!=="checkOut")||correction.changes[field]===undefined)throw new Error("Manual punch not found for this employee and date.");
    if(correction.denied?.[field])throw new Error("This manual punch has already been denied. Reopen the form.");
    const reason=typeof value.reason==="string"?value.reason.trim():"";
    if(!reason||reason.length>1000)throw new Error("Enter a reason for denying this punch (maximum 1,000 characters).");
    const current=attendanceForClient(store).find(r=>r.employeeId===value.employeeId&&r.date===value.date);
    const expected=value.expected as Record<string,unknown>|undefined;
    if(!expected||expected.checkIn!==(current?.checkIn||"—")||expected.checkOut!==(current?.checkOut||"—")||expected.correctionId!==(current?.correctionId||null))throw new Error("Attendance changed. Reopen the form and review the latest punches.");
    correction.denied={...correction.denied,[field]:{at,actor:"Administrator",reason}};
    return;
  }
  const row=attendanceForClient(store).find(row=>row.employeeId===value.employeeId&&row.date===value.date);
  const punch=store.punches.find(p=>p.id===value.punchId&&p.employeeId===value.employeeId&&p.timestamp.slice(0,10)===value.date);
  if(!punch||!row)throw new Error("Fingerprint log not found for this employee and date.");
  if(punch.denied)throw new Error("This fingerprint log has already been denied. Reopen the form.");
  const reason=typeof value.reason==="string"?value.reason.trim():"";
  if(!reason||reason.length>1000)throw new Error("Enter a reason for denying this fingerprint log (maximum 1,000 characters).");
  const expected=value.expected as Record<string,unknown>|undefined;
  if(!expected||expected.checkIn!==row.checkIn||expected.checkOut!==row.checkOut||expected.correctionId!==row.correctionId)throw new Error("Attendance changed. Reopen the form and review the latest logs.");
  punch.denied={at,actor:"Administrator",reason};
  // If this exact machine event established a leave return, recalculate that derived return.
  for(const leave of store.leaves.filter(l=>l.type!=="Duty travel"&&l.status==="Completed"&&l.employeeId===punch.employeeId&&l.returnedAt===punch.timestamp)){
    const before={...leave},days=new Map<string,typeof store.punches>();
    for(const log of store.punches.filter(p=>p.employeeId===leave.employeeId&&p.timestamp.slice(0,10)>leave.start)){
      const date=log.timestamp.slice(0,10);days.set(date,[...(days.get(date)||[]),log]);
    }
    const returned=[...days.values()].map(logs=>dayPunches(logs).checkIn).filter((time):time is string=>!!time).sort()[0];
    leave.revision=(leave.revision||0)+1;
    if(returned){leave.returnedAt=returned;leave.usedDays=actualUsedDays(leave,returned.slice(0,10),store.holidays||[]);}
    else{leave.status="Approved";delete leave.returnedAt;delete leave.usedDays;}
    (store.leaveChanges||=[]).push({id:id+"-"+leave.id,leaveId:leave.id,actor:"Administrator",at,reason:"Fingerprint log denied: "+reason,before,after:{...leave}});
  }
}

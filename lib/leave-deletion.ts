import type { Store } from "./store";
export function deleteLeavePermanently(store:Store,id:unknown,revision:unknown,reason:unknown,receiptId:string,at:string){
  if(typeof id!=="string"||!id.trim())throw new Error("Choose a leave record.");
  const leave=store.leaves.find(item=>item.id===id);
  if(!leave)throw new Error("Leave record not found. It may already have been deleted.");
  if(revision!==(leave.revision||0))throw new Error("This leave changed. Reopen the record before deleting it.");
  if(typeof reason!=="string"||!reason.trim()||reason.trim().length>1000)throw new Error("Enter a deletion reason (up to 1,000 characters).");
  const history=(store.leaveChanges||[]).filter(change=>change.leaveId===id);
  const candidates=new Set([leave.mcDocumentId,...history.flatMap(change=>[change.before.mcDocumentId,change.after.mcDocumentId])].filter((value):value is string=>!!value));
  store.leaves=store.leaves.filter(item=>item.id!==id);
  store.leaveChanges=(store.leaveChanges||[]).filter(change=>change.leaveId!==id);
  const referenced=new Set([...store.leaves.map(item=>item.mcDocumentId),...(store.leaveChanges||[]).flatMap(change=>[change.before.mcDocumentId,change.after.mcDocumentId])]);
  const orphaned=[...candidates].filter(documentId=>!referenced.has(documentId));
  store.mcDocuments=(store.mcDocuments||[]).filter(document=>!orphaned.includes(document.id));
  store.pendingEmployeeFileDeletes=[...new Set([...(store.pendingEmployeeFileDeletes||[]),...orphaned])];
  // Keep a minimal deletion receipt, not a recoverable copy of the leave or its attachments.
  (store.leaveDeletions||=[]).push({id:receiptId,leaveId:leave.id,employeeId:leave.employeeId,at,actor:"Administrator",reason:reason.trim()});
}

import type { Store } from "./store";
import { validLeaveDate } from "./leave-policy";
export type DisciplinaryAction={id:string;employeeId:string;date:string;action:string;reference:string;details:string;revision:number;createdAt:string;updatedAt:string;actor:"Administrator"};
export function saveDisciplinaryAction(store:Store,input:unknown,expectedRevision:unknown,reason:unknown,id:string,at:string){
  if(!input||typeof input!=="object")throw new Error("Enter staff, action date and disciplinary action.");
  const value=input as Record<string,unknown>,existing=typeof value.id==="string"?(store.disciplinaryActions||[]).find(record=>record.id===value.id):undefined;
  if(value.id&&!existing)throw new Error("Disciplinary record not found.");
  if(existing&&expectedRevision!==existing.revision)throw new Error("This action changed. Reopen it before editing.");
  if(typeof value.employeeId!=="string"||!store.people.some(person=>person.id===value.employeeId&&!person.removedAt))throw new Error("Select an existing staff member.");
  if(existing&&existing.employeeId!==value.employeeId)throw new Error("The staff member on a disciplinary record cannot be changed.");
  const today=new Date(Date.parse(at)+5*3600000).toISOString().slice(0,10);
  if(typeof value.date!=="string"||!validLeaveDate(value.date)||value.date>today)throw new Error("Enter a valid action date, not in the future.");
  const text=(key:string,max:number)=>{const result=typeof value[key]==="string"?(value[key] as string).trim():"";if(result.length>max)throw new Error(key+" is too long.");return result;};
  const action=text("action",200);if(!action)throw new Error("Enter the disciplinary action taken.");
  const editReason=typeof reason==="string"?reason.trim():"";
  if(existing&&(!editReason||editReason.length>1000))throw new Error("Enter a reason for changing this action (up to 1,000 characters).");
  const record:DisciplinaryAction={id:existing?.id||id,employeeId:value.employeeId,date:value.date,action,reference:text("reference",300),details:text("details",3000),revision:existing?existing.revision+1:0,createdAt:existing?.createdAt||at,updatedAt:at,actor:"Administrator"};
  (store.disciplinaryChanges||=[]).push({id,at,actor:"Administrator",reason:existing?editReason:"Recorded disciplinary action",before:existing?{...existing}:null,after:{...record}});
  if(existing)Object.assign(existing,record);else(store.disciplinaryActions||=[]).push(record);
  return record;
}

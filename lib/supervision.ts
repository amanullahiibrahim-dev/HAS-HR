import type { Store } from "./store";
import { validLeaveDate } from "./leave-policy";
export type Supervisor={kind:"minister"}|{kind:"staff";id:string};
export type SupervisorAssignment={id:string;employeeId:string;supervisor:Supervisor;from:string;to?:string;revision:number;updatedAt:string;actor:"Administrator"};
const overlaps=(a:SupervisorAssignment,b:SupervisorAssignment)=>a.from<=(b.to||"9999-12-31")&&b.from<=(a.to||"9999-12-31");
export function saveSupervisorAssignments(store:Store,input:unknown,expectedRevision:unknown,reason:unknown,makeId:()=>string,at:string){
  if(!input||typeof input!=="object")throw new Error("Select a supervisor and staff.");
  const value=input as Record<string,unknown>,existing=typeof value.id==="string"?(store.supervisorAssignments||[]).find(record=>record.id===value.id):undefined;
  if(value.id&&!existing)throw new Error("Supervisor assignment not found.");
  if(existing&&expectedRevision!==existing.revision)throw new Error("This assignment changed. Reopen it before editing.");
  if(!Array.isArray(value.employeeIds)||!value.employeeIds.length||value.employeeIds.length>1000||value.employeeIds.some(id=>typeof id!=="string"))throw new Error("Select at least one staff member.");
  const ids=[...new Set(value.employeeIds as string[])];
  if(existing&&(ids.length!==1||ids[0]!==existing.employeeId))throw new Error("The staff member on an existing assignment cannot be changed.");
  const supervisor=value.supervisor as Supervisor|undefined;
  if(!supervisor||!["minister","staff"].includes(supervisor.kind))throw new Error("Select the supervisor.");
  if(supervisor.kind==="staff"&&!store.people.some(person=>person.id===supervisor.id&&!person.removedAt))throw new Error("Choose a supervisor within the school.");
  const today=new Date(Date.parse(at)+5*3600000).toISOString().slice(0,10);
  // The simplified form omits dates; edits retain their recorded period.
  const from=value.from===undefined?(existing?.from||today):value.from;
  const to=value.to===undefined?existing?.to:value.to;
  if(typeof from!=="string"||!validLeaveDate(from)||from>today)throw new Error("Enter a valid effective date, not in the future.");
  if(to!==undefined&&to!==""&&(typeof to!=="string"||!validLeaveDate(to)||to<from))throw new Error("The last supervised date must be on or after the effective date.");
  const changeReason=reason===undefined?(existing?"Supervisor assignment updated.":"Supervisor assigned."):typeof reason==="string"?reason.trim():"";if(!changeReason||changeReason.length>1000)throw new Error("Enter the assignment/change reason (up to 1,000 characters).");
  const cleanSupervisor:Supervisor=supervisor.kind==="minister"?{kind:"minister"}:{kind:"staff",id:supervisor.id};
  const candidates=ids.map(employeeId=>{
    const person=store.people.find(person=>person.id===employeeId&&!person.removedAt);if(!person)throw new Error("Choose existing school staff.");
    if(supervisor.kind==="staff"&&supervisor.id===employeeId)throw new Error("A staff member cannot supervise themselves.");
    return {id:existing?.id||makeId(),employeeId,supervisor:{...cleanSupervisor},from,to:typeof to==="string"&&to?to:undefined,revision:existing?existing.revision+1:0,updatedAt:at,actor:"Administrator" as const};
  });
  const retained=(store.supervisorAssignments||[]).filter(record=>record.id!==existing?.id);
  const all=[...retained,...candidates];
  for(const candidate of candidates){
    if(all.some(other=>other!==candidate&&other.employeeId===candidate.employeeId&&overlaps(candidate,other)))throw new Error("This staff member already has a supervisor for this period. Edit the existing assignment first.");
    const visit=(id:string,from:string,to:string,seen:Set<string>)=>{
      if(id===candidate.employeeId)throw new Error("This assignment would create a supervision cycle.");
      if(seen.has(id))return;const nextSeen=new Set(seen).add(id);
      for(const edge of all.filter(edge=>edge.employeeId===id&&edge.supervisor.kind==="staff"&&edge.from<=to&&(edge.to||"9999-12-31")>=from))if(edge.supervisor.kind==="staff")visit(edge.supervisor.id,edge.from>from?edge.from:from,(edge.to||"9999-12-31")<to?(edge.to||"9999-12-31"):to,nextSeen);
    };
    if(candidate.supervisor.kind==="staff")visit(candidate.supervisor.id,candidate.from,candidate.to||"9999-12-31",new Set());
  }
  store.supervisorAssignments=all;
  for(const record of candidates)(store.supervisorChanges||=[]).push({id:makeId(),at,actor:"Administrator",reason:changeReason,before:existing?{...existing}:null,after:{...record}});
  return candidates;
}

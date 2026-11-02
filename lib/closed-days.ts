import type { Store } from "./store";
import { validLeaveDate } from "./leave-policy";
import { actualUsedDays, chargeablePeriodDays } from "./leave-requirements";
export const closureCategories=["Public holiday","Presidential closure","Other official closure"];
export function saveClosedDays(store:Store,input:unknown,makeId:()=>string,at:string) {
  if(!Array.isArray(input)||input.length>1000)throw new Error("Select up to 1,000 closed dates.");
  const entries=input.map(value=>{
    if(!value||typeof value!=="object")throw new Error("Enter a closed date, category and reason.");
    const {date,reason,category}=value;
    if(typeof date!=="string"||!validLeaveDate(date)||typeof reason!=="string"||!reason.trim()||reason.trim().length>300||!closureCategories.includes(category))throw new Error("Enter a valid date, official closure category and reason (up to 300 characters).");
    return {date,reason:reason.trim(),category:String(category)};
  });
  if(new Set(entries.map(day=>day.date)).size!==entries.length)throw new Error("A date can be recorded only once.");
  entries.sort((a,b)=>a.date.localeCompare(b.date));
  const before=(store.holidays||[]).map(date=>store.closedDays?.find(day=>day.date===date)||{date,reason:"Previously configured closed date",category:"Other official closure"});
  const dates=entries.map(day=>day.date), dateChanged=JSON.stringify([...(store.holidays||[])].sort())!==JSON.stringify(dates);
  const oldDates=store.holidays||[];
  const changedDates=new Set([...oldDates.filter(date=>!dates.includes(date)),...dates.filter(date=>!oldDates.includes(date))]);
  let recalculated=0;
  if(dateChanged)for(const leave of store.leaves){
    if(!["Pending","Approved","Completed"].includes(leave.status)||["Duty travel","No pay"].includes(leave.type)||!validLeaveDate(leave.start)||!validLeaveDate(leave.end))continue;
    if(![...changedDates].some(date=>date>=leave.start&&date<leave.end))continue;
    const previous=JSON.parse(JSON.stringify(leave));
    const deduction=chargeablePeriodDays(leave,leave.end,dates);
    const priorDeduction=leave.deductibleDays??leave.days;
    // Recalculate completed actual usage, including early returns, without moving authorized dates.
    const candidate={...leave,deductibleDays:deduction};
    let used=leave.usedDays;
    if(leave.status==="Completed"&&leave.returnedAt){
      const oldUsage=actualUsedDays(leave,leave.returnedAt.slice(0,10),oldDates);
      const newUsage=actualUsedDays(candidate,leave.returnedAt.slice(0,10),dates);
      // Apply only the calendar difference, preserving prior administrator adjustments.
      used=Math.max(0,Math.min(deduction,(leave.usedDays??oldUsage)+newUsage-oldUsage));
    }
    if(deduction===priorDeduction&&used===leave.usedDays)continue;
    leave.deductibleDays=deduction;if(used!==undefined)leave.usedDays=used;
    leave.revision=(leave.revision||0)+1;
    (store.leaveChanges||=[]).push({id:makeId(),leaveId:leave.id,actor:"Administrator",at,reason:"Closed dates changed: automatically recalculated eligible deductions; approved dates retained.",before:previous,after:{...leave}});
    recalculated++;
  }
  store.holidays=dates;store.closedDays=entries;
  if(JSON.stringify(before)!==JSON.stringify(entries))(store.closedDayChanges||=[]).push({id:makeId(),at,actor:"Administrator",before,after:entries.map(day=>({...day}))});
  return recalculated;
}

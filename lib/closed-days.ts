import type { Leave, Store } from "./store";
import { planLeave, validLeaveDate } from "./leave-policy";
import { actualUsedDays, chargeablePeriodDays, addDate } from "./leave-requirements";
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
  const before=(store.holidays||[]).map(date=>{const day=store.closedDays?.find(day=>day.date===date);return {date,reason:day?.reason||"Previously configured closed date",category:day?.category||"Other official closure"};}).sort((a,b)=>a.date.localeCompare(b.date));
  const dates=entries.map(day=>day.date);
  const recalculated=recalculateLeaveCalendar(store,dates,makeId,at);
  store.holidays=dates;store.closedDays=entries;
  if(JSON.stringify(before)!==JSON.stringify(entries))(store.closedDayChanges||=[]).push({id:makeId(),at,actor:"Administrator",before,after:entries.map(day=>({...day}))});
  return recalculated;
}

/** Retain the requested leave allowance; excluded dates extend its planned period. */
export function recalculateLeaveCalendar(store:Store,dates:string[],makeId:()=>string,at:string) {
  const oldDates=store.holidays||[];
  const updates:{leave:Leave;before:Leave;after:Leave}[]=[];
  for(const leave of store.leaves){
    if(!["Pending","Approved","Completed"].includes(leave.status)||["Duty travel","No pay"].includes(leave.type)||!validLeaveDate(leave.start)||!validLeaveDate(leave.end))continue;
    const before=JSON.parse(JSON.stringify(leave)) as Leave;
    const after={...leave,trip:leave.trip?{...leave.trip}:undefined};
    if(leave.type==="Hajj"||leave.type==="Umra"){
      if(leave.trip?.basis==="Annual")after.end=planLeave("Annual",leave.start,leave.days,dates).end;
      else if(leave.trip?.charter===false&&leave.trip.baseStart&&leave.trip.baseEnd){
        // Article 186(b,c,f): only the 30-day base extends. Atoll travel remains calendar days.
        const trailing=Math.round((Date.parse(leave.end)-Date.parse(leave.trip.baseEnd))/86400000);
        const base=planLeave("Hajj",leave.trip.baseStart,30,dates);
        after.trip!.baseEnd=base.end;
        after.end=addDate(base.end,trailing);
      }
      // Chartered flight dates and unconfirmed legacy travel periods stay fixed.
    }else after.end=planLeave(leave.type,leave.start,leave.days,dates).end;
    const deduction=chargeablePeriodDays(after,after.end,dates);
    if(leave.deductibleDays!==undefined||after.end!==leave.end||deduction!==leave.days)after.deductibleDays=deduction;
    if(leave.status==="Completed"&&leave.returnedAt){
      const oldUsage=actualUsedDays(leave,leave.returnedAt.slice(0,10),oldDates);
      const newUsage=actualUsedDays(after,leave.returnedAt.slice(0,10),dates);
      // Preserve actual return and any manual adjustment; apply only the calendar difference.
      after.usedDays=Math.max(0,Math.min(deduction,(leave.usedDays??oldUsage)+newUsage-oldUsage));
    }
    if(after.end===leave.end&&after.deductibleDays===leave.deductibleDays&&after.usedDays===leave.usedDays&&JSON.stringify(after.trip)===JSON.stringify(leave.trip))continue;
    after.revision=(leave.revision||0)+1;
    updates.push({leave,before,after});
  }
  // Stage all calculations before mutating the store, so an invalid plan cannot partly save.
  for(const {leave,before,after} of updates){
    Object.assign(leave,after);
    (store.leaveChanges||=[]).push({id:makeId(),leaveId:leave.id,actor:"Administrator",at,reason:"Holiday calendar recalculated under CSC Articles 175(b), 178(c), 181(d), 184-188 and 190(f): excluded dates extend applicable planned leave; actual return retained.",before,after:JSON.parse(JSON.stringify(after))});
  }
  return updates.length;
}

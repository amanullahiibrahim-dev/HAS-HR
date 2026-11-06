import type { Staff, Store } from "./store";
import { entitlementFor, openingBalanceTypes, sickUsage, usedDaysForType } from "./leave-policy";
export function saveOpeningBalance(store:Store,employeeId:unknown,year:unknown,input:unknown,expectedRevision:unknown,reason:unknown,at:string){
  const person=store.people.find(p=>p.id===employeeId&&!p.removedAt);
  if(!person)throw new Error("Select an existing employee.");
  if(typeof year!=="number"||!Number.isInteger(year)||year<2000||year>2100)throw new Error("Choose a balance year from 2000 to 2100.");
  const existing=person.leaveOpeningBalances?.[year];
  if(expectedRevision!==(existing?.revision||0))throw new Error("These balances changed. Reopen the editor before saving.");
  if(typeof reason!=="string"||!reason.trim()||reason.trim().length>1000)throw new Error("Enter a reason or opening-record reference (up to 1,000 characters).");
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Enter leave already used before this app.");
  const values=input as Record<string,unknown>;
  if(Object.keys(values).some(key=>!(openingBalanceTypes as readonly string[]).includes(key)))throw new Error("This leave type has no editable yearly balance.");
  const used:Record<string,number>={};
  for(const type of openingBalanceTypes){
    const days=values[type]??0;
    if(typeof days!=="number"||!Number.isFinite(days)||days<0||days*2!==Math.round(days*2))throw new Error("Previously used days must be zero or a positive half-day amount.");
    const recorded=usedDaysForType(store.leaves,person.id,type,undefined,year);
    const limit=entitlementFor(type,person,`${year}-01-01`);
    if(recorded+days>limit)throw new Error(`${type}: previously used plus recorded leave cannot exceed ${limit} days.`);
    used[type]=days;
  }
  const sick=sickUsage(store.leaves,person.id,undefined,year);
  if(sick.total+used["Sick with MC"]+used["Sick without MC"]>30)throw new Error("Previously used and recorded sick leave share a total allowance of 30 days.");
  const after={used,revision:(existing?.revision||0)+1,updatedAt:at,reason:reason.trim()};
  (person.leaveBalanceChanges||=[]).push({year,at,actor:"Administrator",reason:reason.trim(),before:existing?JSON.parse(JSON.stringify(existing)):null,after:JSON.parse(JSON.stringify(after))});
  (person.leaveOpeningBalances||={})[year]=after;
  return after;
}

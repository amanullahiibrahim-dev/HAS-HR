import { assertJoiningDateChangeAllowed, joiningDateLock, joiningDateBusinessDate } from "./joining-date-lock";
import type { Staff, Store } from "./store";
import { openingBalanceTypes, entitlementFor, usedDaysForType, validLeaveDate, type OpeningBalance } from "./leave-policy";
import { defaultLeavePeriodRules, cscServiceTypes, leavePeriod, type LeavePeriodBasis } from "./leave-periods";
export function periodBalanceDraft(person:Staff,input:Record<string,unknown>){
  const asOf=typeof input.asOf==="string"?input.asOf:"";
  if(!validLeaveDate(asOf))throw new Error("Select a valid balance as-of date.");
  const joinedOn=typeof input.joinedOn==="string"?input.joinedOn:person.joinedOn||"";
  const leaveYearAnchor=typeof input.leaveYearAnchor==="string"?input.leaveYearAnchor:person.leaveYearAnchor||"";
  for(const date of [joinedOn,leaveYearAnchor])if(date&&!validLeaveDate(date))throw new Error("Enter a valid joining / leave-cycle date.");
  const supplied=input.rules;
  if(supplied!==undefined&&(!supplied||typeof supplied!=="object"||Array.isArray(supplied)))throw new Error("Choose the leave-period rules.");
  const rules={...defaultLeavePeriodRules,...person.leavePeriodRules,...supplied as Record<string,LeavePeriodBasis>};
  for(const [type,basis] of Object.entries(rules))if(!(openingBalanceTypes as readonly string[]).includes(type)||!["Calendar year","Service year"].includes(basis))throw new Error("Choose Calendar year or Service year for each yearly leave type.");
  for(const type of cscServiceTypes){
    if((supplied as Record<string,unknown>|undefined)?.[type]==="Calendar year")throw new Error(`${type} follows the CSC service year and cannot reset on 1 January.`);
    rules[type]="Service year";
  }
  if(rules["Sick without MC"]!==rules["Sick with MC"])throw new Error("Both sick categories must share the same balance period.");
  return {asOf,person:{...person,joinedOn,leaveYearAnchor,leavePeriodRules:rules}};
}
export function previewPeriodBalances(store:Store,id:unknown,input:Record<string,unknown>,at=new Date().toISOString()){
  const existing=store.people.find(p=>p.id===id&&!p.removedAt);if(!existing)throw new Error("Employee not found.");
  const draft=periodBalanceDraft(existing,input),person=draft.person;
  assertJoiningDateChangeAllowed(store,existing,person.joinedOn||"",at);
  const rows=openingBalanceTypes.filter(type=>!["Medical","Casual"].includes(type)||entitlementFor(type,person)>0).map(type=>{
    const period=leavePeriod(person,type,draft.asOf),entry=period.start?person.leavePeriodBalances?.[type]?.[period.key]:undefined;
    const recorded=period.start?usedDaysForType(store.leaves,person.id,type,undefined,draft.asOf,{...person,leavePeriodBalances:undefined,leaveOpeningBalances:undefined},store.holidays||[]):0;
    return {type,period,recorded,opening:Number(entry?.used[type])||0,entitlement:entitlementFor(type,person,draft.asOf)};
  });
  return {joiningDateLock:joiningDateLock(store,existing.id,joiningDateBusinessDate(at)),asOf:draft.asOf,joinedOn:person.joinedOn,leaveYearAnchor:person.leaveYearAnchor,rules:person.leavePeriodRules,revision:existing.leaveBalanceRevision||0,rows,legacy:existing.leaveOpeningBalances||{}};
}
export function savePeriodBalances(store:Store,id:unknown,input:Record<string,unknown>,at:string){
  const person=store.people.find(p=>p.id===id&&!p.removedAt);if(!person)throw new Error("Employee not found.");
  if(input.expectedRevision!==(person.leaveBalanceRevision||0))throw new Error("Leave periods or balances changed. Reopen the editor before saving.");
  if(input.reason!==undefined&&(typeof input.reason!=="string"||input.reason.trim().length>1000))throw new Error("A supplied balance note must be at most 1,000 characters.");
  const reason=typeof input.reason==="string"&&input.reason.trim()?input.reason.trim():"Opening balances updated";
  if(!input.used||typeof input.used!=="object"||Array.isArray(input.used))throw new Error("Enter previously used leave for each displayed period.");
  const values=input.used as Record<string,unknown>;
  if(Object.keys(values).some(type=>!(openingBalanceTypes as readonly string[]).includes(type)))throw new Error("This leave is managed per occasion or trip, rather than by a yearly balance.");
  const preview=previewPeriodBalances(store,id,input,at),draft=periodBalanceDraft(person,input).person;
  const entries:Record<string,OpeningBalance>={};
  for(const row of preview.rows){
    if(!row.period.start)throw new Error(row.period.label+". Enter the joining date or approved leave-cycle anchor.");
    const used=values[row.type]??0;
    if(typeof used!=="number"||!Number.isFinite(used)||used<0||used*2!==Math.round(used*2))throw new Error("Previously used leave must be a nonnegative number in half-day steps.");
    if(row.recorded+used>row.entitlement)throw new Error(`${row.type}: opening and recorded usage exceed ${row.entitlement} days for ${row.period.label}.`);
    entries[row.type]={used:{[row.type]:used},revision:(person.leaveBalanceRevision||0)+1,updatedAt:at,reason};
  }
  const sick=preview.rows.filter(row=>row.type.startsWith("Sick"));
  if(sick.reduce((total,row)=>total+row.recorded+Number(entries[row.type].used[row.type]),0)>30)throw new Error("Both sick categories share 30 days in the same balance period.");
  const before=JSON.parse(JSON.stringify({joinedOn:person.joinedOn,leaveYearAnchor:person.leaveYearAnchor,rules:person.leavePeriodRules,balances:person.leavePeriodBalances}));
  const balances=JSON.parse(JSON.stringify(person.leavePeriodBalances||{})) as NonNullable<Staff["leavePeriodBalances"]>;
  for(const row of preview.rows)(balances[row.type]||={})[row.period.key]=entries[row.type];
  Object.assign(person,{joinedOn:draft.joinedOn,leaveYearAnchor:draft.leaveYearAnchor,leavePeriodRules:draft.leavePeriodRules,leavePeriodBalances:balances,leaveBalanceRevision:(person.leaveBalanceRevision||0)+1});
  (person.leavePeriodChanges||=[]).push({at,actor:"Administrator",reason,before,after:JSON.parse(JSON.stringify({joinedOn:person.joinedOn,leaveYearAnchor:person.leaveYearAnchor,rules:person.leavePeriodRules,balances}))});
  return previewPeriodBalances(store,id,input,at);
}

import { leavePeriod, defaultLeavePeriodRules, cscServiceTypes } from "./leave-periods";
import type { PeriodPerson } from "./leave-periods";
import { allocatedLeaveDays } from "./leave-period-allocation";
export const leaveTypes = ["Family", "Annual", "Hajj", "Umra", "Paternity", "Maternity", "Circumcision", "No pay", "Duty travel"] as const;
export const sickLeaveTypes = ["Sick with MC", "Sick without MC"] as const;
export const legacyLeaveTypes = ["Medical", "Casual"] as const;

export type StaffLeaveType = (typeof leaveTypes)[number];
export type SickLeaveType = (typeof sickLeaveTypes)[number];
export type LeaveType = StaffLeaveType | SickLeaveType | (typeof legacyLeaveTypes)[number];

export const allLeaveTypes: LeaveType[] = [...leaveTypes, ...sickLeaveTypes, ...legacyLeaveTypes];

export const sickCombinedLimit = 30;
export const sickWithoutMcLimit = 15;
export const sickWithoutMcConsecutiveLimit = 2;

export const leaveNotes: Record<StaffLeaveType | SickLeaveType, string> = {
  "Duty travel": "Office-authorized official duty under CSC Article 172(c). Record the start date and duration. Approved duty dates count as present. No annual or sick leave is deducted; calendar days describe the assignment, including weekends and holidays.",
  "No pay": "Administrator-authorized unpaid leave. Enter the approved number of calendar days, including weekends and holidays. No annual, sick or other paid leave balance is deducted.",
  Family: "10 days. Excludes weekends, Dhivehi-calendar holidays and presidentially declared holidays.",
  Annual: "30 days. Excludes weekends, Dhivehi-calendar holidays and presidentially declared holidays.",
  Hajj: "First Hajj paid leave only, based on charter travel dates or 30 days excluding public holidays, with 15 additional calendar days for atoll offices. Later Hajj: annual leave or authorized no-pay leave.",
  Umra: "Use annual leave or authorized no-pay leave; no separate annual paid Umra allowance is established by the supplied Article 186.",
  Paternity: "30 days. Includes weekends; excludes holidays.",
  Maternity: "6 calendar months. Includes weekends; excludes configured holidays and official closure dates.",
  Circumcision: "Up to 5 paid days per occasion for either parent. Includes weekends; excludes configured public holidays.",
  "Sick with MC": "30 days a year, including sick days taken without MC. Excludes weekends and holidays.",
  "Sick without MC": "Maximum 15 days from the shared 30-day sick allowance, and at most 2 consecutive working days without MC (including adjacent requests). Excludes weekends and configured holidays."
};

/** Weekends excluded when counting days for this leave type. */
export const excludeWeekends: Record<LeaveType, boolean> = {
  "Duty travel": false,
  "No pay": false,
  Family: true,
  Annual: true,
  Hajj: false,
  Umra: false,
  Paternity: false,
  Maternity: false,
  Circumcision: false,
  "Sick with MC": true,
  "Sick without MC": true,
  Medical: true,
  Casual: true
};

export type OpeningBalance = { used: Record<string, number>; revision: number; updatedAt: string; reason: string };
export const openingBalanceTypes = ["Family", "Annual", "Sick with MC", "Sick without MC", "Medical", "Casual"] as const;
export type BalancePerson = PeriodPerson & { leavePeriodBalances?: Record<string, Record<string, OpeningBalance>>; leaveOpeningBalances?: Record<string, OpeningBalance>; annual?: number; medical?: number; casual?: number; gender?: string };
type PersonLike = BalancePerson;
export function openingUsed(person:BalancePerson|undefined,type:string,scope?:number|string){
  if(typeof scope==="string"){
    const period=leavePeriod(person||{},type,scope);if(!period.start)throw new Error(period.label+". Set up the employee's leave periods in Manage Leave.");
    const entry=person?.leavePeriodBalances?.[type]?.[period.key];
    if(!entry&&Object.entries(person?.leaveOpeningBalances||{}).some(([year,entry])=>`${year}-01-01`<period.end&&`${Number(year)+1}-01-01`>period.start&&(Number(entry.used[type])||0)>0))throw new Error("Review earlier year-only opening usage for this leave period in Manage Leave.");
    return Number(entry?.used[type])||0;
  }
  return Object.entries(person?.leaveOpeningBalances||{}).filter(([key])=>scope===undefined||key===String(scope)).reduce((sum,[,entry])=>sum+(Number(entry.used[type])||0),0);
}

type LeaveLike = { id?: string; employeeId: string; type: string; days: number; usedDays?: number; deductibleDays?: number; status: string; start?: string; end?: string; returnedAt?: string; chargeType?: string; payBasis?: string; medical?: {unauthorizedAbsence?: boolean} };

export function entitlementFor(type: LeaveType, person: PersonLike, start = new Date().toISOString().slice(0,10)): number {
  if (type === "Duty travel" || type === "No pay") return 0; // No annual entitlement bucket: duration is authorized per assignment.
  if (type === "Annual") return 30;
  if (type === "Medical") return Number(person.medical) || 0;
  if (type === "Casual") return Number(person.casual) || 0;
  if (type === "Circumcision") return 5;
  if (type === "Hajj" || type === "Umra") return 0;
  if (type === "Family") return 10;
  if (type === "Maternity") return maternityDays(start);
  if (type === "Sick without MC") return sickWithoutMcLimit;
  return 30;
}

export function resolvedEntitlements(person: PersonLike): Record<string, number> {
  return Object.fromEntries(allLeaveTypes.map((type) => [type, entitlementFor(type, person)]));
}

export function countedDays(leave: LeaveLike): number {
  const planned = Number(leave.deductibleDays ?? leave.days) || 0;
  if (leave.status !== "Completed") return planned;
  return Number(leave.usedDays ?? planned);
}

export function usedDaysForType(leaves: LeaveLike[], employeeId: string, type: LeaveType, excludeId?: string, scope?: number|string, person?: PersonLike, holidays:string[]=[]): number {
  const period=typeof scope==="string"?leavePeriod(person||{},type,scope):undefined;
  return openingUsed(person,type,scope) + leaves
    .filter(leave=>!leave.medical?.unauthorizedAbsence&&leave.id!==excludeId&&leave.employeeId===employeeId&&(leave.type===type||(type==="Annual"&&leave.chargeType==="Annual"))&&leave.payBasis!=="No pay"&&(type==="Annual"||leave.chargeType!=="Annual")&&(typeof scope!=="number"||Number(leave.start?.slice(0,4))===scope)&&["Pending","Approved","Completed"].includes(leave.status))
    .reduce((sum,leave)=>sum+(period?allocatedLeaveDays(leave,period,holidays,excludeWeekends[type]):countedDays(leave)),0);
}
export function sickUsage(leaves:LeaveLike[],employeeId:string,excludeId?:string,scope?:number|string,person?:PersonLike,holidays:string[]=[]){
  const withMc=usedDaysForType(leaves,employeeId,"Sick with MC",excludeId,scope,person,holidays),withoutMc=usedDaysForType(leaves,employeeId,"Sick without MC",excludeId,scope,person,holidays);
  return {withMc,withoutMc,total:withMc+withoutMc};
}
export function periodBalance(person:BalancePerson&{id:string},leaves:LeaveLike[],type:LeaveType,asOf:string,holidays:string[]=[]){
  const period=leavePeriod(person,type,asOf),entitlement=entitlementFor(type,person,asOf);
  if(!period.start)return {period,entitlement,used:0,available:null};
  let used:number;
  try{used=usedDaysForType(leaves,person.id,type,undefined,asOf,person,holidays);}
  catch(error){return {period:{...period,label:error instanceof Error?error.message:"Review opening usage"},entitlement,used:0,available:null};}
  const rawUsed=used;
  if(type.startsWith("Sick")){
    let sick;try{sick=sickUsage(leaves,person.id,undefined,asOf,person,holidays);}catch(error){return {period:{...period,label:error instanceof Error?error.message:"Review opening usage"},entitlement,used:0,available:null};}
    used=entitlement-Math.max(0,Math.min(30-sick.total,type==="Sick without MC"?15-sick.withoutMc:30));
  }
  return {period,entitlement,used,rawUsed,available:Math.max(0,entitlement-used)};
}

export function countLeaveDays(start: string, end: string, weekendsExcluded: boolean, holidays: string[] = []): number {
  if (!start || !end || end <= start) return 0;
  let days = 0;
  for (const date = new Date(`${start}T00:00:00Z`); date < new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const weekday = date.getUTCDay();
    if ((!weekendsExcluded || (weekday !== 5 && weekday !== 6)) && !holidays.includes(date.toISOString().slice(0,10))) days += 1;
  }
  return days;
}

export function validLeaveDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}

export function maternityDays(start: string) {
  const date = new Date(`${start}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()+6);
  const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return Math.round((date.getTime()-Date.parse(`${start}T00:00:00Z`))/86400000);
}

export function planLeave(type: LeaveType, start: string, requestedDays: number, holidays: string[] = []) {
  if (type === "Duty travel") throw new Error("Duty travel uses the approved assignment dates, not a personal leave allowance.");
  if (!validLeaveDate(start)) throw new Error("Enter a valid leave start date.");
  const days = type === "Maternity" ? maternityDays(start) : requestedDays;
  if (!Number.isFinite(days) || days <= 0 || days > 366 || days*2 !== Math.round(days*2)) throw new Error("Days must be in half-day increments, up to 366.");
  if(type === "Sick without MC" && days > sickWithoutMcConsecutiveLimit) throw new Error("Sick leave beyond 2 consecutive working days requires MC. The 15-day limit is the annual allowance, not a continuous leave limit.");
  const excluded = type === "No pay" ? [] : holidays;
  const date = new Date(`${start}T00:00:00Z`);
  let remaining = days;
  for(let scanned=0;remaining>0;scanned++) {
    if(scanned>2000) throw new Error("The holiday calendar leaves too few available days.");
    if((!excludeWeekends[type] || ![5,6].includes(date.getUTCDay())) && !excluded.includes(date.toISOString().slice(0,10))) remaining-=1;
    date.setUTCDate(date.getUTCDate()+1);
  }
  return {days,end:date.toISOString().slice(0,10)};
}


export function validateSickWithoutMcRun(leaves: LeaveLike[], candidate: LeaveLike, holidays: string[] = [], excludeId?: string) {
  if(candidate.type!=="Sick without MC" || candidate.status==="Declined" || candidate.medical?.unauthorizedAbsence) return;
  const off=(day:string)=>[5,6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())||holidays.includes(day);
  const next=(day:string)=>{const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
  const enumerate=(leave:LeaveLike)=>{
    const out:string[]=[];if(!leave.start||!leave.end)return out;
    const end=leave.status==="Completed"&&leave.returnedAt&&leave.returnedAt.slice(0,10)>leave.start&&leave.returnedAt.slice(0,10)<leave.end?leave.returnedAt.slice(0,10):leave.end;
    for(let day=leave.start,steps=0;day<end&&steps<2000;day=next(day),steps++)if(!off(day))out.push(day);
    return out;
  };
  const requested=new Set(enumerate(candidate));
  const all=new Set<string>(requested);
  for(const leave of leaves.filter(l=>!l.medical?.unauthorizedAbsence&&l.id!==excludeId&&l.employeeId===candidate.employeeId&&l.type==="Sick without MC"&&["Pending","Approved","Completed"].includes(l.status)))for(const day of enumerate(leave))all.add(day);
  const sorted=[...all].sort();let run:string[]=[];
  for(const day of sorted){
    if(run.length){let expected=next(run[run.length-1]);for(let i=0;off(expected)&&i<2000;i++)expected=next(expected);if(expected!==day)run=[];}
    run.push(day);
    if(run.length>2 && run.some(d=>requested.has(d)))throw new Error("These adjacent sick-leave requests exceed 2 consecutive working days without MC. Record the appropriate leave with MC.");
  }
}

export const policyForClient = {
  openingBalanceTypes,
  defaultLeavePeriodRules,
  cscServiceTypes,
  types: leaveTypes,
  sickTypes: sickLeaveTypes,
  legacyTypes: legacyLeaveTypes,
  excludeWeekends,
  notes: leaveNotes,
  sick: { combined: sickCombinedLimit, withoutMc: sickWithoutMcLimit, consecutiveWithoutMc: sickWithoutMcConsecutiveLimit }
};

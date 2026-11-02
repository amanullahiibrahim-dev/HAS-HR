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
  "Duty travel": "Office-authorized official duty under CSC Article 172(c). Record the approved period, times, purpose and duty order. No annual or sick leave is deducted; calendar days describe the assignment, including weekends and holidays.",
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

type PersonLike = { annual?: number; medical?: number; casual?: number; gender?: string };
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

export function usedDaysForType(leaves: LeaveLike[], employeeId: string, type: LeaveType, excludeId?: string, year?: number): number {
  return leaves
    .filter((leave) => !leave.medical?.unauthorizedAbsence && leave.id !== excludeId && leave.employeeId === employeeId && (leave.type === type || (type === "Annual" && leave.chargeType === "Annual")) && leave.payBasis !== "No pay" && (type === "Annual" || leave.chargeType !== "Annual") && (year === undefined || Number(leave.start?.slice(0,4)) === year) && ["Pending", "Approved", "Completed"].includes(leave.status))
    .reduce((sum, leave) => sum + countedDays(leave), 0);
}

export function sickUsage(leaves: LeaveLike[], employeeId: string, excludeId?: string, year?: number) {
  const considered = leaves.filter(
    (leave) =>
      !leave.medical?.unauthorizedAbsence && leave.id !== excludeId &&
      leave.employeeId === employeeId &&
      (year === undefined || Number(leave.start?.slice(0,4)) === year) &&
      (leave.type === "Sick with MC" || leave.type === "Sick without MC") &&
      ["Pending", "Approved", "Completed"].includes(leave.status)
  );
  const withoutMc = considered.filter((leave) => leave.type === "Sick without MC").reduce((sum, leave) => sum + countedDays(leave), 0);
  const withMc = considered.filter((leave) => leave.type === "Sick with MC").reduce((sum, leave) => sum + countedDays(leave), 0);
  return { withMc, withoutMc, total: withMc + withoutMc };
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
  types: leaveTypes,
  sickTypes: sickLeaveTypes,
  legacyTypes: legacyLeaveTypes,
  excludeWeekends,
  notes: leaveNotes,
  sick: { combined: sickCombinedLimit, withoutMc: sickWithoutMcLimit, consecutiveWithoutMc: sickWithoutMcConsecutiveLimit }
};

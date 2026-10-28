export const leaveTypes = ["Family", "Annual", "Hajj", "Umra", "Paternity", "Maternity", "Circumcision"] as const;
export const sickLeaveTypes = ["Sick with MC", "Sick without MC"] as const;
export const legacyLeaveTypes = ["Medical", "Casual"] as const;

export type StaffLeaveType = (typeof leaveTypes)[number];
export type SickLeaveType = (typeof sickLeaveTypes)[number];
export type LeaveType = StaffLeaveType | SickLeaveType | (typeof legacyLeaveTypes)[number];

export const allLeaveTypes: LeaveType[] = [...leaveTypes, ...sickLeaveTypes, ...legacyLeaveTypes];

export const sickCombinedLimit = 30;
export const sickWithoutMcLimit = 15;

export const leaveNotes: Record<StaffLeaveType | SickLeaveType, string> = {
  Family: "10 days. Excludes weekends, Dhivehi-calendar holidays and presidentially declared holidays.",
  Annual: "30 days. Excludes weekends, Dhivehi-calendar holidays and presidentially declared holidays.",
  Hajj: "30 days. Includes weekends; excludes holidays.",
  Umra: "30 days. Includes weekends; excludes holidays.",
  Paternity: "30 days. Includes weekends; excludes holidays.",
  Maternity: "6 months (180 days). Includes weekends; excludes holidays.",
  Circumcision: "5 days for female staff, 3 days for male staff. Includes weekends.",
  "Sick with MC": "30 days a year, including sick days taken without MC. Excludes weekends and holidays.",
  "Sick without MC": "Maximum 15 days a year, taken from the 30-day sick allowance. Excludes weekends and holidays."
};

/** Weekends excluded when counting days for this leave type. */
export const excludeWeekends: Record<LeaveType, boolean> = {
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
type LeaveLike = { id?: string; employeeId: string; type: string; days: number; usedDays?: number; status: string };

export function entitlementFor(type: LeaveType, person: PersonLike): number {
  if (type === "Annual") return Number(person.annual) > 0 ? Number(person.annual) : 30;
  if (type === "Medical") return Number(person.medical) || 0;
  if (type === "Casual") return Number(person.casual) || 0;
  if (type === "Circumcision") return person.gender === "Male" ? 3 : 5;
  if (type === "Family") return 10;
  if (type === "Maternity") return 180;
  if (type === "Sick without MC") return sickWithoutMcLimit;
  return 30;
}

export function resolvedEntitlements(person: PersonLike): Record<string, number> {
  return Object.fromEntries(allLeaveTypes.map((type) => [type, entitlementFor(type, person)]));
}

export function countedDays(leave: LeaveLike): number {
  const planned = Number(leave.days) || 0;
  if (leave.status !== "Completed") return planned;
  return Number(leave.usedDays ?? planned);
}

export function usedDaysForType(leaves: LeaveLike[], employeeId: string, type: LeaveType, excludeId?: string): number {
  return leaves
    .filter((leave) => leave.id !== excludeId && leave.employeeId === employeeId && leave.type === type && ["Approved", "Completed"].includes(leave.status))
    .reduce((sum, leave) => sum + countedDays(leave), 0);
}

export function sickUsage(leaves: LeaveLike[], employeeId: string, excludeId?: string) {
  const considered = leaves.filter(
    (leave) =>
      leave.id !== excludeId &&
      leave.employeeId === employeeId &&
      (leave.type === "Sick with MC" || leave.type === "Sick without MC") &&
      ["Approved", "Completed"].includes(leave.status)
  );
  const withoutMc = considered.filter((leave) => leave.type === "Sick without MC").reduce((sum, leave) => sum + countedDays(leave), 0);
  const withMc = considered.filter((leave) => leave.type === "Sick with MC").reduce((sum, leave) => sum + countedDays(leave), 0);
  return { withMc, withoutMc, total: withMc + withoutMc };
}

export function countLeaveDays(start: string, end: string, weekendsExcluded: boolean): number {
  if (!start || !end || end <= start) return 0;
  let days = 0;
  for (const date = new Date(`${start}T00:00:00Z`); date < new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const weekday = date.getUTCDay();
    if (!weekendsExcluded || (weekday !== 0 && weekday !== 6)) days += 1;
  }
  return days;
}

export const policyForClient = {
  types: leaveTypes,
  sickTypes: sickLeaveTypes,
  legacyTypes: legacyLeaveTypes,
  excludeWeekends,
  notes: leaveNotes,
  sick: { combined: sickCombinedLimit, withoutMc: sickWithoutMcLimit }
};

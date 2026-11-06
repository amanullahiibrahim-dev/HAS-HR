type AllocatedLeave = {
  start?: string;
  end?: string;
  days: number;
  deductibleDays?: number;
  usedDays?: number;
  status: string;
  returnedAt?: string;
  type: string;
  chargeType?: string;
};
type AllocationPeriod = { start: string; end: string };
const dayMs = 86400000;
function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
/** Allocate the saved charged usage once, to the eligible dates actually covered by leave. */
export function allocatedLeaveDays(leave: AllocatedLeave, period: AllocationPeriod, holidays: string[] = [], weekendsExcluded = false): number {
  if (!validDate(leave.start) || !validDate(period.start) || !validDate(period.end) || period.end <= period.start) return 0;
  const rawBudget = Number(leave.status === "Completed" ? (leave.usedDays ?? leave.deductibleDays ?? leave.days) : (leave.deductibleDays ?? leave.days));
  if (!Number.isFinite(rawBudget) || rawBudget <= 0) return 0;
  const start = leave.start;
  // Old records without a usable end date retain their whole saved charge in their start period.
  if (!validDate(leave.end) || leave.end <= start) return start >= period.start && start < period.end ? rawBudget : 0;
  let end = leave.end;
  const returned = leave.returnedAt?.slice(0, 10);
  if (leave.status === "Completed" && validDate(returned)) {
    const effectiveReturn = returned <= start ? new Date(Date.parse(start + "T00:00:00Z") + dayMs).toISOString().slice(0, 10) : returned;
    if (effectiveReturn < end) end = effectiveReturn;
  }
  if (end <= period.start || start >= period.end) return 0;
  const excluded = new Set(holidays);
  let remaining = rawBudget, allocated = 0, scanned = 0;
  for (const date = new Date(start + "T00:00:00Z"); date.toISOString().slice(0, 10) < end && remaining > 0; date.setUTCDate(date.getUTCDate() + 1)) {
    if (scanned++ >= 2000) throw new Error("Leave period is too long to allocate safely.");
    const day = date.toISOString().slice(0, 10);
    if (excluded.has(day) || (weekendsExcluded && [5, 6].includes(date.getUTCDay()))) continue;
    const charged = Math.min(1, remaining);
    if (day >= period.start && day < period.end) allocated += charged;
    remaining -= charged;
  }
  return allocated;
}

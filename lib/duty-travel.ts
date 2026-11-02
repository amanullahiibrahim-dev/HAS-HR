import { validLeaveDate } from "./leave-policy";
import type { Leave, Store } from "./store";

export type DutyTravelDetails = {
  destination: string; purpose: string; approvalReference: string; lastDate: string;
  startTime: string; endTime: string; fullDayRelease: true;
  reportedAt?: string; reportReference?: string;
};
const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const nextDate = (date: string) => new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0,10);
export function planDutyTravel(start: string, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Enter the official duty travel details.");
  const value = input as Record<string, unknown>;
  const text = (key: string, label: string, max: number) => {
    const result = typeof value[key] === "string" ? (value[key] as string).trim() : "";
    if (!result || result.length > max) throw new Error("Enter " + label + " (maximum " + max + " characters).");
    return result;
  };
  if (!validLeaveDate(start) || typeof value.lastDate !== "string" || !validLeaveDate(value.lastDate) || value.lastDate < start) throw new Error("Choose valid first and last official duty dates.");
  if (!validTime(value.startTime) || !validTime(value.endTime) || (start === value.lastDate && value.endTime <= value.startTime)) throw new Error("Enter the official duty start and end times in chronological order.");
  if (value.fullDayRelease !== true) throw new Error("Confirm that the office authorized release for the full duty days. Partial-day work needs a separate attendance review.");
  const end = nextDate(value.lastDate), days = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000;
  if (days > 366) throw new Error("Split duty records longer than 366 calendar days. This is a record-size limit, not a CSC leave allowance.");
  const duty: DutyTravelDetails = { destination: text("destination", "the duty destination", 300), purpose: text("purpose", "the official work purpose", 1000), approvalReference: text("approvalReference", "the duty order / office authorization reference", 300), lastDate: value.lastDate, startTime: value.startTime, endTime: value.endTime, fullDayRelease: true };
  return { days, end, duty, chargeType: "None", payBasis: "Official duty", trip: undefined };
}
export function dutyForDate(store: Store, employeeId: string, date: string) {
  return store.leaves.find(leave => leave.employeeId === employeeId && leave.type === "Duty travel" && ["Approved", "Completed"].includes(leave.status) && leave.duty?.fullDayRelease && !!leave.duty.approvalReference && leave.start <= date && date < leave.end);
}
export function checkDutyOverlap(store: Store, employeeId: string, type: string, start: string, end: string, status: string, excludeId?: string) {
  if (status === "Declined") return;
  if (store.leaves.some(leave => leave.id !== excludeId && leave.employeeId === employeeId && ["Pending", "Approved", "Completed"].includes(leave.status) && (type === "Duty travel" || leave.type === "Duty travel") && start < (leave.type === "Duty travel" ? leave.end : (leave.returnedAt && leave.returnedAt.slice(0,10)>leave.start && leave.returnedAt.slice(0,10)<leave.end ? leave.returnedAt.slice(0,10) : leave.end)) && end > leave.start)) throw new Error("Duty travel overlaps another duty or leave record. Review the existing dates first.");
}
export function dutyReport(leave: Leave, reportedAt: unknown, reportReference: unknown, now = Date.now()) {
  if (leave.type !== "Duty travel" || leave.status !== "Approved" || !leave.duty) throw new Error("Choose an approved duty travel record.");
  const reference = typeof reportReference === "string" ? reportReference.trim() : "";
  if (!reference || reference.length > 300) throw new Error("Enter the attendance officer's report / acknowledgement reference (maximum 300 characters).");
  if (typeof reportedAt !== "string" || !/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(reportedAt) || !validLeaveDate(reportedAt.slice(0,10)) || reportedAt < leave.duty.lastDate + "T" + leave.duty.endTime || Date.parse(reportedAt + "+05:00") > now) throw new Error("Enter the actual reporting time after completion of the approved duty, in Maldives time. For an early return, update the approved duty period first.");
  return { ...leave.duty, reportedAt, reportReference: reference };
}

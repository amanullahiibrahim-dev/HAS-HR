export type LeavePeriodBasis = "Calendar year" | "Service year";
export type PeriodPerson = {
  joinedOn?: string;
  /** An approved entitlement/cycle date may differ from the latest joining date after credited service. */
  leaveYearAnchor?: string;
  leavePeriodRules?: Record<string, LeavePeriodBasis>;
};
export type LeavePeriod = {
  basis: LeavePeriodBasis;
  start: string;
  /** Exclusive end: the next period starts on this date. */
  end: string;
  key: string;
  label: string;
  /** First local date of the renewed allowance (Maldives midnight). */
  resetsOn?: string;
  needsJoiningDate?: boolean;
  unavailable?: boolean;
};

export const cscServiceTypes = ["Annual", "Family", "Sick with MC", "Sick without MC"];
export const defaultLeavePeriodRules: Record<string, LeavePeriodBasis> = {
  Annual: "Service year",
  Family: "Service year",
  "Sick with MC": "Service year",
  "Sick without MC": "Service year",
  // Existing Medical/Casual allowances are legacy school buckets, not named CSC allowances.
  Medical: "Calendar year",
  Casual: "Calendar year"
};
// Maternity, paternity, circumcision and pilgrimage are occasion/trip entitlements.
// They intentionally have no yearly default here; callers must use their separate event rules.

function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z"))
    && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
}
function anniversary(anchor: string, year: number): string {
  const month = Number(anchor.slice(5, 7)), day = Number(anchor.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, days)).padStart(2, "0")}`;
}

export function leavePeriod(person: PeriodPerson, type: string, asOf: string): LeavePeriod {
  if (!validDate(asOf)) throw new Error("Choose a valid date for the leave period.");
  // Both sick categories always share the with-MC basis and reset boundary.
  const ruleType = type === "Sick without MC" ? "Sick with MC" : type;
  const configured = person.leavePeriodRules?.[ruleType];
  const basis: LeavePeriodBasis = cscServiceTypes.includes(ruleType)?"Service year":configured === "Calendar year" || configured === "Service year"
    ? configured : defaultLeavePeriodRules[ruleType] || "Calendar year";
  const year = Number(asOf.slice(0, 4));
  let start: string, end: string, bucketStart: string;
  if (basis === "Calendar year") {
    start = `${String(year).padStart(4, "0")}-01-01`;
    end = `${String(year + 1).padStart(4, "0")}-01-01`;
    bucketStart = start;
  } else {
    const joined=person.joinedOn||"";
    if(validDate(joined)&&asOf<joined)return {basis,start:"",end:"",key:"",label:"Before service period starts",unavailable:true};
    // Article 178(a): pre-May-1984 government service uses May-April. The English
    // source leaves the intervening cohort unclear; require its approved cycle date.
    if(cscServiceTypes.includes(ruleType)&&!person.leaveYearAnchor&&joined>="1984-05-01"&&joined<="1985-05-01")return {basis,start:"",end:"",key:"",label:"Approved leave-cycle date required for this historical joining date",needsJoiningDate:true};
    const legacyMay=cscServiceTypes.includes(ruleType)&&validDate(joined)&&joined<"1984-05-01";
    const anchor = person.leaveYearAnchor || (legacyMay?"1900-05-01":joined);
    if (!validDate(anchor)) return {basis, start: "", end: "", key: "", label: "Joining date required", needsJoiningDate: true};
    if (asOf < anchor) return {basis, start: "", end: "", key: "", label: "Before service period starts", unavailable: true};
    // Joining-date balances include the whole anniversary date. They renew at
    // Maldives midnight on the following day; approved/historical cycles stay explicit.
    const joiningCycle = !person.leaveYearAnchor && !legacyMay;
    const boundary = (cycleYear: number) => {
      const date = anniversary(anchor, cycleYear);
      return joiningCycle ? new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0,10) : date;
    };
    let startYear = asOf < boundary(year) ? year - 1 : year;
    const joinedYear = Number(joined.slice(0,4));
    if (joiningCycle && startYear < joinedYear) startYear = joinedYear;
    start = joiningCycle && startYear === joinedYear ? joined : boundary(startYear);
    end = boundary(startYear + 1);
    // Keep existing opening balances under their original anniversary key. Only
    // the date coverage changes; renewal must never erase or copy earlier usage.
    bucketStart = anniversary(anchor, startYear);
  }
  const last = new Date(end + "T00:00:00Z");
  last.setUTCDate(last.getUTCDate() - 1);
  return {basis, start, end, key: `${basis}:${bucketStart}`, resetsOn:end, label: `${start} – ${last.toISOString().slice(0, 10)}`};
}

export function inLeavePeriod(date: string, period: Pick<LeavePeriod, "start" | "end">): boolean {
  return validDate(date) && !!period.start && !!period.end && date >= period.start && date < period.end;
}

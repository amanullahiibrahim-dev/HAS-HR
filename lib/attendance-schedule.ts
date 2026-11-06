export function requiredArrival(role: string): string {
  return ["Teacher", "Leading Teacher", "Technical Staff", "Support Staff", "Deputy Principal"].includes(role) ? "07:00" : "08:00";
}

export const offDays = [5, 6]; // Friday and Saturday (JavaScript weekday numbers).

export function lateCutoff(role:string):string {
  return requiredArrival(role) === "07:00" ? "07:01" : "08:01";
}
export function isLateArrival(role:string,checkIn:string,date:string,holidays:string[]=[]):boolean {
  if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(checkIn))return false;
  const day=new Date(`${date}T00:00:00Z`).getUTCDay();
  if(offDays.includes(day)||holidays.includes(date))return false;
  return checkIn >= lateCutoff(role);
}

import type { Staff, Store } from "./store";
import { validLeaveDate } from "./leave-policy";

export const joiningDateLockMessage="Joining date is locked while this employee has current or upcoming leave. Delete the leave or wait until it has ended to change the date.";
export function joiningDateBusinessDate(at:string|number=Date.now()):string {
  return new Date(new Date(at).getTime()+5*3600000).toISOString().slice(0,10);
}
export function joiningDateLock(store:Pick<Store,"leaves">,employeeId:string,today=joiningDateBusinessDate()){
  const ends:Array<string|null>=[];
  for(const leave of store.leaves.filter(leave=>leave.employeeId===employeeId)){
    if(!validLeaveDate(leave.start)||!validLeaveDate(leave.end)||leave.end<=leave.start){ends.push(null);continue;}
    let end=leave.end;
    const returned=leave.returnedAt?.slice(0,10);
    if(leave.status==="Completed"&&returned&&validLeaveDate(returned)&&returned>leave.start&&returned<end)end=returned;
    // The saved end (or valid early return) is exclusive: leave has passed on that date.
    if(end>today)ends.push(end);
  }
  const locked=ends.length>0,dates=ends.filter((date):date is string=>date!==null);
  return {locked,until:locked&&dates.length===ends.length?dates.sort().at(-1)||null:null,message:locked?joiningDateLockMessage:""};
}
export function assertJoiningDateChangeAllowed(store:Pick<Store,"leaves">,person:Pick<Staff,"id"|"joinedOn">,joinedOn:string,at?:string){
  if(joinedOn===(person.joinedOn||""))return;
  if(joiningDateLock(store,person.id,joiningDateBusinessDate(at)).locked)throw new Error(joiningDateLockMessage);
}

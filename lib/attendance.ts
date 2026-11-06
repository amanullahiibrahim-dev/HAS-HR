import { initializePunchOwnership } from "./punch-ownership";
import { dayPunches } from "./punch-classification";

import { dutyForDate } from "./duty-travel";

import type { Punch, Store } from "./store";

import { isLateArrival, requiredArrival } from "./attendance-schedule";

import { validLeaveDate } from "./leave-policy";



export type AttendanceCorrection = {

  id: string; employeeId: string; date: string; createdAt: string;

  actor: "Administrator"; reason: string; evidence?: string;

  noteOnly?: boolean;
  denied?: {checkIn?: {at:string;actor:"Administrator";reason:string};checkOut?: {at:string;actor:"Administrator";reason:string}};

  changes: { checkIn?: string; checkOut?: string };

  before: { checkIn: string; checkOut: string };

  after: { checkIn: string; checkOut: string };

  originalPunches: Punch[];

};



export function attendanceForClient(store: Store, now = Date.now()) {
  initializePunchOwnership(store);

  const days = new Map<string,{employeeId:string;name:string;date:string;checkIn:string;checkOut:string;source:string;correctionId:string|null;originalCheckIn:string;originalCheckOut:string;note:string;punches:Punch[]}>();

  for(const person of store.people){

    const grouped = new Map<string,Punch[]>();

    for(const punch of store.punches.filter(p=>p.employeeId===person.id)){

      const date=punch.timestamp.slice(0,10);grouped.set(date,[...(grouped.get(date)||[]),punch]);

    }

    for(const [date,items] of grouped){

      const sorted=items.slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp));

      const selected=dayPunches(sorted);

      const checkIn=selected.checkIn?.slice(11,16)||"—",checkOut=selected.checkOut?.slice(11,16)||"—";

      days.set(`${person.id}|${date}`,{employeeId:person.id,name:person.name,date,checkIn,checkOut,source:sorted[0].serial==='Manual'?'Legacy manual':'iClock990',correctionId:null,originalCheckIn:checkIn,originalCheckOut:checkOut,note:selected.note,punches:sorted.map(p=>({...p}))});

    }

  }

  // Append order is the correction revision order, independent of clock differences.

  for(const correction of store.corrections || []){

    const person=store.people.find(p=>p.id===correction.employeeId);if(!person)continue;

    const applyIn=correction.changes.checkIn!==undefined&&!correction.denied?.checkIn;
    const applyOut=correction.changes.checkOut!==undefined&&!correction.denied?.checkOut;
    if(correction.noteOnly || (!applyIn&&!applyOut))continue;

    const key=`${person.id}|${correction.date}`;

    const row=days.get(key)||{employeeId:person.id,name:person.name,date:correction.date,checkIn:'—',checkOut:'—',source:'Administrator correction',correctionId:null,originalCheckIn:'—',originalCheckOut:'—',note:'',punches:[]};

    if(applyIn)row.checkIn=correction.changes.checkIn!;

    if(applyOut)row.checkOut=correction.changes.checkOut!;

    row.source='Administrator correction';row.note='';row.correctionId=correction.id;days.set(key,row);

  }

  const today=new Date(now+5*60*60*1000).toISOString().slice(0,10);

  for(const leave of store.leaves.filter(l=>l.type==="Duty travel"&&["Approved","Completed"].includes(l.status))){

    const person=store.people.find(p=>p.id===leave.employeeId);if(!person)continue;

    for(let date=leave.start,scanned=0;date<leave.end&&date<=today&&scanned<366;date=new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10),scanned++){

      const key=person.id+"|"+date;

      if(!days.has(key))days.set(key,{employeeId:person.id,name:person.name,date,checkIn:"—",checkOut:"—",source:"Duty travel",correctionId:null,originalCheckIn:"—",originalCheckOut:"—",note:"",punches:[]});

    }

  }

  return [...days.values()].map(row=>{

    const duty=dutyForDate(store,row.employeeId,row.date);

    const hasIn=row.checkIn!=="—";

    const hasOut=row.checkOut!=="—";
    const active=row.punches.filter(p=>!p.denied);
    const inCount=active.filter(p=>p.kind==="attendance-in").length;
    const outCount=active.filter(p=>p.kind==="attendance-out").length;
    const reasons:string[]=[];
    if(inCount>1)reasons.push(`${inCount} IN punches received; deny the extra log(s).`);
    if(outCount>1)reasons.push(`${outCount} OUT punches received; deny the extra log(s).`);
    if(!duty&&row.date<today){
      if(!hasIn)reasons.push("IN punch is missing after the end of the day.");
      if(!hasOut)reasons.push("OUT punch is missing after the end of the day.");
    }
    const needsReview=reasons.length>0||(!duty&&!hasIn);
    const status=needsReview?"Incomplete":duty?"Present":isLateArrival(store.people.find(p=>p.id===row.employeeId)!.role,row.checkIn,row.date,store.holidays || [])?"Late":"Present";
    if(reasons.length)row.note=[...reasons,row.note].filter(Boolean).join(" ");

    const minute=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));

    const start=requiredArrival(store.people.find(p=>p.id===row.employeeId)!.role);

    const workedMins=hasIn&&row.checkOut!=="—"&&row.checkOut>row.checkIn?minute(row.checkOut)-minute(row.checkIn):0;

    const lateMins=status==='Late'?Math.max(0,minute(row.checkIn)-minute(start)):0;

    return {...row,workedMins,lateMins,dutyTravelId:duty?.id,source:duty?(row.source==="Duty travel"?row.source:row.source+" · Duty travel"):row.source,status};

  })

    .sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name));

}



export function addAttendanceCorrection(store: Store, input: unknown, id: string, createdAt: string) {

  if(!input || typeof input!=='object')throw new Error('Enter staff, date and reason.');

  const entry=input as Record<string,unknown>;

  const person=store.people.find(p=>p.id===entry.employeeId);

  const time=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  const noteOnly=entry.noteOnly===true || (entry.checkIn===undefined && entry.checkOut===undefined);
  if(!person || typeof entry.date!=='string'||!validLeaveDate(entry.date))throw new Error('Choose staff and enter a valid attendance date.');
  if(noteOnly && (entry.checkIn!==undefined || entry.checkOut!==undefined))throw new Error('A correction note cannot change punch times.');
  if(entry.checkIn!==undefined && !time(entry.checkIn))throw new Error('Enter a valid check-in time, or leave it blank to keep the existing check-in.');

  const reason=typeof entry.reason==='string'?entry.reason.trim():'';

  if(!reason||reason.length>1000)throw new Error('A correction reason is required (maximum 1,000 characters).');

  const evidence=typeof entry.evidence==='string'?entry.evidence.trim():'';

  if(evidence.length>1000)throw new Error('Verification reference must be at most 1,000 characters.');

  if(entry.checkOut!==undefined&&!time(entry.checkOut))throw new Error('Enter a valid checkout time, or leave it blank to keep the existing checkout.');

  const current=attendanceForClient(store).find(r=>r.employeeId===person.id&&r.date===entry.date);

  const before={checkIn:current?.checkIn||'—',checkOut:current?.checkOut||'—'};

  const expected=entry.expected as Record<string,unknown>|undefined;

  if(!expected||expected.checkIn!==before.checkIn||expected.checkOut!==before.checkOut||expected.correctionId!==(current?.correctionId||null))throw new Error('Attendance changed since this form was opened. Reopen it and review the latest times.');

  const after=noteOnly?{...before}:{checkIn:typeof entry.checkIn==='string'?entry.checkIn:before.checkIn,checkOut:typeof entry.checkOut==='string'?entry.checkOut:before.checkOut};

  if(!noteOnly&&after.checkIn!=='—'&&after.checkOut!=='—'&&after.checkOut<=after.checkIn)throw new Error('Checkout must be after check-in for a same-day correction.');

  if(!noteOnly&&before.checkIn===after.checkIn&&before.checkOut===after.checkOut)throw new Error('Enter a changed attendance time before saving.');

  const correction:AttendanceCorrection={id,employeeId:person.id,date:entry.date,actor:'Administrator',createdAt,reason,...(evidence?{evidence}:{}),...(noteOnly?{noteOnly:true}:{}),changes:noteOnly?{}:{...(typeof entry.checkIn==='string'?{checkIn:entry.checkIn}:{}),...(typeof entry.checkOut==='string'?{checkOut:entry.checkOut}:{})},before,after,

    originalPunches:store.punches.filter(p=>p.employeeId===person.id&&p.timestamp.slice(0,10)===entry.date).map(p=>({...p}))};

  (store.corrections ||= []).push(correction);

  return correction;

}

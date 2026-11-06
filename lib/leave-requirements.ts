import { leavePeriod } from "./leave-periods";
import { allocatedLeaveDays } from "./leave-period-allocation";
import type { Leave, Store, Staff } from "./store";
import { planDutyTravel, checkDutyOverlap } from "./duty-travel";
import { countLeaveDays, excludeWeekends, planLeave, validLeaveDate, entitlementFor, sickUsage, usedDaysForType } from "./leave-policy";
import { requiredArrival } from "./attendance-schedule";

export type PilgrimageDetails={basis:"First paid Hajj"|"Annual"|"No pay";office?:"Male"|"Atoll";charter?:boolean;flightReturn?:string;atollBefore?:number;firstHajjConfirmed?:boolean;permissionReference?:string;baseStart?:string;baseEnd?:string};
export type MedicalDetails={reference:string;issuer:string;receivedOn:string;coversFrom:string;coversTo:string;notifiedAt:string;notifiedAgainAt:string;verified:boolean;verifiedBy?:"Administrator";verifiedAt?:string;unauthorizedAbsence?:boolean;reviewReason?:string;reviewedBy?:"Administrator";reviewedAt?:string};
export const addDate=(value:string,days:number)=>{const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export function resolveLeavePlan(store:Store,person:Staff,input:Partial<Leave>,excludeId?:string){
  const plan=resolveNewLeavePlan(store,person,input,excludeId);
  return {...plan,deductibleDays:undefined,preservedPeriod:false};
}
function resolveNewLeavePlan(store:Store,person:Staff,input:Partial<Leave>,excludeId?:string){
  const type=input.type!,start=input.start!,days=Number(input.days),holidays=store.holidays||[];
  if(type==="Duty travel")return planDutyTravel(start,input.duty,days);
  if(type==="No pay")return {...planLeave(type,start,days,[]),chargeType:"None",payBasis:"No pay",trip:undefined as PilgrimageDetails|undefined};
  if(type!=="Hajj"&&type!=="Umra")return {...planLeave(type,start,days,holidays),chargeType:type as string,payBasis:"Paid",trip:undefined as PilgrimageDetails|undefined};
  const trip=input.trip;
  if(!trip||!["First paid Hajj","Annual","No pay"].includes(trip.basis))throw new Error("Choose first paid Hajj, annual leave, or authorized no-pay leave.");
  if(trip.basis==="Annual")return {...planLeave("Annual",start,days,holidays),chargeType:"Annual",payBasis:"Annual",trip:{basis:"Annual"} as PilgrimageDetails};
  if(trip.basis==="First paid Hajj"){
    if(type!=="Hajj"||trip.firstHajjConfirmed!==true)throw new Error("Paid pilgrimage leave requires confirmation of the employee's first Hajj, including prior service.");
    if(store.leaves.some(l=>l.id!==excludeId&&l.employeeId===person.id&&l.type==="Hajj"&&["Pending","Approved","Completed"].includes(l.status)&&(!l.trip||l.trip.basis==="First paid Hajj")))throw new Error("A paid Hajj record already exists. Use annual leave or authorized no-pay leave for a later pilgrimage.");
  }
  const permissionReference=typeof trip.permissionReference==="string"?trip.permissionReference.trim():"";
  if(!permissionReference||permissionReference.length>300)throw new Error("Enter the office permission / approval reference for this pilgrimage.");
  if(!["Male","Atoll"].includes(trip.office||"")||typeof trip.charter!=="boolean")throw new Error("Choose the office location and chartered-flight arrangement.");
  if(!validLeaveDate(start))throw new Error("Choose a valid leave start date.");
  const before=trip.office==="Atoll"?Number(trip.atollBefore||0):0;
  if(!Number.isInteger(before)||before<0||before>15)throw new Error("Allocate between 0 and 15 atoll travel days before departure from Male'.");
  const baseStart=addDate(start,before);
  let baseEnd:string,baseDays:number;
  if(trip.charter){
    if(!trip.flightReturn||!validLeaveDate(trip.flightReturn)||trip.flightReturn<baseStart)throw new Error("Enter the actual charter return date, on or after departure from Male'.");
    baseEnd=addDate(trip.flightReturn,1);baseDays=countLeaveDays(baseStart,baseEnd,false,holidays);
  }else {const base=planLeave("Hajj",baseStart,30,holidays);baseEnd=base.end;baseDays=base.days;}
  const extra=trip.office==="Atoll"?15:0;
  const end=addDate(baseEnd,extra-before);
  if(Date.parse(end)-Date.parse(start)>731*86400000)throw new Error("Check the pilgrimage travel dates; this period is too long.");
  return {days:baseDays+extra,end,chargeType:trip.basis==="No pay"?"None":"Hajj",payBasis:trip.basis,
    trip:{basis:trip.basis,office:trip.office,charter:trip.charter,flightReturn:trip.charter?trip.flightReturn:undefined,atollBefore:before,firstHajjConfirmed:trip.basis==="First paid Hajj",permissionReference,baseStart,baseEnd} as PilgrimageDetails};
}
export function chargeablePeriodDays(leave:Leave,through:string,holidays:string[]) {
  const end=through<leave.end?through:leave.end;
  if(end<=leave.start)return 0;
  if(leave.type==="No pay"||leave.type==="Duty travel")return Math.max(0,(Date.parse(end+"T00:00:00Z")-Date.parse(leave.start+"T00:00:00Z"))/86400000);
  if(leave.trip&&leave.trip.basis!=="Annual"&&leave.trip.baseStart&&leave.trip.baseEnd){
    let count=0;for(let day=leave.start;day<end;day=addDate(day,1))if(day<leave.trip.baseStart||day>=leave.trip.baseEnd||!holidays.includes(day))count++;
    return count;
  }
  const type=leave.chargeType==="Annual"?"Annual":leave.type;
  let count=countLeaveDays(leave.start,end,excludeWeekends[type],holidays);
  const half=leave.days%1, last=addDate(leave.end,-1);
  if(half&&end===leave.end&&countLeaveDays(last,leave.end,excludeWeekends[type],holidays)>0)count-=1-half;
  return Math.max(0,count);
}
export function actualUsedDays(leave:Leave,returned:string,holidays:string[]){
  if(leave.type!=="Duty travel" && returned<=leave.start) returned=addDate(leave.start,1);
  if(leave.type==="No pay")return Math.max(0,Math.min(leave.days,(Date.parse(returned+"T00:00:00Z")-Date.parse(leave.start+"T00:00:00Z"))/86400000));
  if(leave.type==="Duty travel"){if(leave.duty?.reportedAt)return leave.days;const end=returned<leave.end?returned:leave.end;return Math.max(0,Math.min(leave.days,(Date.parse(end+"T00:00:00Z")-Date.parse(leave.start+"T00:00:00Z"))/86400000));}
  if(leave.trip&&leave.trip.basis!=="Annual"&&leave.trip.baseStart&&leave.trip.baseEnd){
    let count=0;const end=returned<leave.end?returned:leave.end;
    for(let day=leave.start;day<end;day=addDate(day,1))if(day<leave.trip.baseStart||day>=leave.trip.baseEnd||!holidays.includes(day))count++;
    return Math.min(leave.deductibleDays??leave.days,count);
  }
  const type=leave.chargeType==="Annual"?"Annual":leave.type;
  return Math.min(leave.deductibleDays??leave.days,chargeablePeriodDays(leave,returned,holidays));
}
export function normalizeMedical(value:unknown,type:string,start:string,end:string,returnedAt?:string):MedicalDetails|undefined{
  if(!type.startsWith("Sick"))return undefined;
  const v=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  const text=(key:string)=>{const s=typeof v[key]==="string"?(v[key] as string).trim():"";if(s.length>500)throw new Error("Medical reference fields must be at most 500 characters.");return s;};
  const m:MedicalDetails={reference:text("reference"),issuer:text("issuer"),receivedOn:text("receivedOn"),coversFrom:text("coversFrom"),coversTo:text("coversTo"),notifiedAt:text("notifiedAt"),notifiedAgainAt:text("notifiedAgainAt"),verified:v.verified===true};
  for(const d of [m.receivedOn,m.coversFrom,m.coversTo])if(d&&!validLeaveDate(d))throw new Error("Enter valid medical receipt and coverage dates.");
  for(const notice of [m.notifiedAt,m.notifiedAgainAt])if(notice&&(!/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(notice)||!validLeaveDate(notice.slice(0,10))))throw new Error("Enter valid supervisor notification dates and times.");
  if(m.verified){
    if(!m.reference||!m.receivedOn)throw new Error("Verification requires a certificate/form reference and receipt date.");
    if(m.receivedOn>new Date().toISOString().slice(0,10))throw new Error("The document receipt date cannot be in the future.");
    const requiredEnd=returnedAt&&returnedAt.slice(0,10)<end?returnedAt.slice(0,10):end;
    if(type==="Sick with MC"&&(!m.issuer||!m.coversFrom||!m.coversTo||m.coversFrom>start||m.coversTo<addDate(requiredEnd,-1)))throw new Error("Verify the licensed practitioner and MC coverage for the leave dates before marking it verified.");
    m.verifiedBy="Administrator";m.verifiedAt=new Date().toISOString();
  }
  m.unauthorizedAbsence=v.unauthorizedAbsence===true;
  m.reviewReason=text("reviewReason");
  if(m.unauthorizedAbsence){
    if(!returnedAt||new Date().toISOString().slice(0,10)<=returnedAt.slice(0,10))throw new Error("An unauthorized-absence review requires a recorded return and an expired document-submission day.");
    if(m.verified)throw new Error("A verified document cannot also be marked missing/invalid. Review the verification first.");
    if(!m.reviewReason)throw new Error("Record the HR reason before treating missing-document leave as unauthorized absence.");
    m.reviewedBy="Administrator";m.reviewedAt=new Date().toISOString();
  }
  return m;
}
export function medicalReview(leave:Leave,person:Staff,today=new Date().toISOString().slice(0,10),holidays:string[]=[]){
  if(!leave.type.startsWith("Sick")||leave.status==="Declined")return null;
  const m=leave.medical,due=leave.returnedAt?.slice(0,10)||null;
  if(m?.unauthorizedAbsence)return {status:"HR decision: unauthorized absence",due,notification:"",notificationDeadline:null};
  if(leave.type==="Sick with MC"&&leave.mcDocumentId)return {status:"MC uploaded (not automatically verified)",due,notification:"",notificationDeadline:null};
  if(leave.type==="Sick without MC"&&!m?.reference)return null;
  const late=!!(due&&m?.receivedOn&&m.receivedOn>due);
  const status=m?.verified?(late?"Verified; late submission - HR review":"Verified"):m?.reference&&m.receivedOn?(due&&today>due?"Verification overdue - HR review":"Received; awaiting verification"):due&&today>due?"Documents overdue - HR review":due?"Documents due on return":"Documents pending; due on return";
  const workDates:string[]=[];
  for(let day=leave.start,scanned=0;day<leave.end&&workDates.length<2&&scanned<2000;day=addDate(day,1),scanned++)if(![5,6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())&&!holidays.includes(day))workDates.push(day);
  const deadline=(day:string)=>`${day}T${String(Number(requiredArrival(person.role).slice(0,2))+1).padStart(2,'0')}:00`;
  const notices=[m?.notifiedAt,m?.notifiedAgainAt];
  const notification=workDates.map((day,index)=>`Day ${index+1}: ${notices[index]?(notices[index]!<=deadline(day)?"notification recorded within normal-duty deadline":"late notification - HR review"):"supervisor notification not recorded"}`).join('; ');
  return {status,due,notification,notificationDeadline:workDates[0]?deadline(workDates[0]):null};
}

export function checkLeaveAllowance(store:Store,person:Staff,leave:Leave,excludeId?:string){
  if(leave.status==="Declined"||leave.medical?.unauthorizedAbsence)return;
  checkDutyOverlap(store,person.id,leave.type,leave.start,leave.end,leave.status,excludeId);
  if(leave.type==="Duty travel"||leave.type==="No pay")return;
  const days=leave.status==="Completed"?(leave.usedDays??(leave.returnedAt?actualUsedDays(leave,leave.returnedAt.slice(0,10),store.holidays||[]):leave.days)):(leave.deductibleDays??leave.days);
  const year=Number(leave.start.slice(0,4));
  if(leave.type==="Circumcision"){
    const ref=leave.eventReference?.trim().toLowerCase();
    if(!ref||ref.length>200)throw new Error("Enter the child's circumcision event / approval reference (up to 200 characters).");
    const used=store.leaves.filter(l=>l.id!==excludeId&&l.employeeId===person.id&&l.type==="Circumcision"&&l.eventReference?.trim().toLowerCase()===ref&&["Pending","Approved","Completed"].includes(l.status)).reduce((sum,l)=>sum+(l.status==="Completed"?(l.usedDays??l.days):(l.deductibleDays??l.days)),0);
    if(days+used>5)throw new Error("Circumcision leave is limited to 5 days per parent for the same occasion, excluding public holidays.");
    return;
  }
  if(leave.type==="Hajj"||leave.type==="Umra"){
    if(leave.trip?.basis!=="Annual")return;
  }
  if(leave.type==="Paternity"||leave.type==="Maternity"){
    const limit=entitlementFor(leave.type,person,leave.start);
    const used=leave.eventReference?store.leaves.filter(l=>l.id!==excludeId&&l.employeeId===person.id&&l.type===leave.type&&l.eventReference===leave.eventReference&&["Pending","Approved","Completed"].includes(l.status)).reduce((sum,l)=>sum+(l.status==="Completed"?(l.usedDays??l.days):(l.deductibleDays??l.days)),0):0;
    if(days+used>limit)throw new Error(`${leave.type} leave exceeds the allowance for this occasion.`);
    return;
  }
  const type=leave.chargeType==="Annual"?"Annual":leave.type;
  const periods=new Map<string,ReturnType<typeof leavePeriod>>();
  const end=leave.end&&leave.end>leave.start?leave.end:addDate(leave.start,1);
  for(let day=leave.start,steps=0;day<end&&steps<2000;day=addDate(day,1),steps++){
    const period=leavePeriod(person,type,day);
    if(!period.start)throw new Error(period.label+". Set up the employee's leave periods in Manage Leave.");
    periods.set(period.key,period);
  }
  for(const period of periods.values()){
    const portion=allocatedLeaveDays(leave,period,store.holidays||[],excludeWeekends[type]);if(!portion)continue;
    if(type.startsWith("Sick")){
      const used=sickUsage(store.leaves,person.id,excludeId,period.start,person,store.holidays||[]);
      if(used.total+portion>30)throw new Error(`The combined sick-leave allowance is 30 days for ${period.label}.`);
      if(type==="Sick without MC"&&used.withoutMc+portion>15)throw new Error(`Sick leave without MC is limited to 15 days for ${period.label}.`);
    }else{
      const limit=entitlementFor(type,person,leave.start),used=usedDaysForType(store.leaves,person.id,type,excludeId,period.start,person,store.holidays||[]);
      if(portion+used>limit)throw new Error(`${type} leave has ${Math.max(0,limit-used)} day(s) available for ${period.label}.`);
    }
  }
}

import { denyPunch } from "@/lib/punch-denial";
import { savePeriodBalances } from "@/lib/period-balances";
import { saveOpeningBalance } from "@/lib/opening-balances";
import { saveDisciplinaryAction } from "@/lib/disciplinary";
import { saveSupervisorAssignments } from "@/lib/supervision";
import { deleteLeavePermanently } from "@/lib/leave-deletion";
import { saveClosedDays } from "@/lib/closed-days";
import { initializePunchOwnership, assignDevicePin } from "@/lib/punch-ownership";
import { deviceLocalTimestamp } from "@/lib/employee-removal";
import { permanentlyRemoveEmployee, flushEmployeeFileDeletes, prepareReusedDevicePin } from "@/lib/employee-removal";
import { dutyReport } from "@/lib/duty-travel";
import { attachMcDocument } from "@/lib/mc-documents";
import { resolveLeavePlan, normalizeMedical, checkLeaveAllowance, actualUsedDays } from "@/lib/leave-requirements";
import { addAttendanceCorrection } from "@/lib/attendance";
import { applyLeaveEdit } from "@/lib/leave-edits";
import { NextResponse } from "next/server";
import { requiredArrival } from "@/lib/attendance-schedule";
import { currentSession, isAdmin, isSignedIn, isSameOrigin } from "@/lib/auth";
import { allLeaveTypes } from "@/lib/leave-policy";
import type { LeaveType } from "@/lib/leave-policy";
import { validateSickWithoutMcRun, validLeaveDate } from "@/lib/leave-policy";
import { staffTypes, makeId, readStore, stateForClient, writeStore } from "@/lib/store";
import type { Leave, Staff } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = currentSession(request);
  if (!session) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const store=readStore();
  if(store.pendingEmployeeFileDeletes?.length){flushEmployeeFileDeletes(store);writeStore(store);}
  return NextResponse.json({ ...stateForClient(store), viewer: { name: session.name, kind: session.kind } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSignedIn(request)) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string") return NextResponse.json({ error: "A valid action is required." }, { status: 400 });
  if (["employee.period-balances", "employee.opening-balance", "employee.balance"].includes(payload.action) && !isAdmin(request)) return NextResponse.json({ error: "Only the Administrator can edit leave balances." }, { status: 403 });
  const store = readStore();
  initializePunchOwnership(store);

  if(payload.action==="disciplinary.save"){
    try{saveDisciplinaryAction(store,payload.record,payload.expectedRevision,payload.reason,makeId(),new Date().toISOString());}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid disciplinary action."},{status:400});}
  }else if(payload.action==="supervisor.save"){
    try{saveSupervisorAssignments(store,payload.assignment,payload.expectedRevision,payload.reason,makeId,new Date().toISOString());}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid supervisor assignment."},{status:400});}
  }else if (payload.action === "closed-days.save" || payload.action === "holidays.save") {
    try {
      const entries=payload.action==="closed-days.save"?payload.days:Array.isArray(payload.dates)?payload.dates.map(date=>({date,reason:"Official closed date",category:"Other official closure"})):null;
      saveClosedDays(store,entries,makeId,new Date().toISOString());
    } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid closed dates."},{status:400});}
  } else if (payload.action === "employee.gender") {
    const person=store.people.find(p=>p.id===payload.id);
    if(!person || !["Male","Female"].includes(String(payload.gender))) return NextResponse.json({error:"Choose staff and Male or Female."},{status:400});
    person.gender=payload.gender as "Male" | "Female";
  } else if (payload.action === "employee.create") {
    const input = payload.employee as Partial<Staff> | undefined;
    if (!input?.name?.trim() || !input.devicePin?.trim()) return NextResponse.json({ error: "Employee name and machine PIN are required." }, { status: 400 });
    const employeeId = input.id?.trim() || makeId();
    if (store.people.some((p) => p.id.toLowerCase() === employeeId.toLowerCase() || p.devicePin === input.devicePin!.trim())) return NextResponse.json({ error: "That employee ID or machine PIN is already assigned." }, { status: 409 });
    const role = input.role ?? "Admin Staff";
    if (!staffTypes.includes(role)) return NextResponse.json({ error: "Choose a valid staff type." }, { status: 400 });
    const attendanceFrom=prepareReusedDevicePin(store,input.devicePin.trim());
    assignDevicePin(store,employeeId,input.devicePin.trim(),deviceLocalTimestamp(),true);
    store.people.push({ attendanceFrom, id: employeeId, name: input.name.trim(), dept: input.dept?.trim() || "", role, gender: input.gender === "Male" || input.gender === "Female" ? input.gender : "", devicePin: input.devicePin.trim(), annual: Math.max(0, Number(input.annual) || 0), medical: Math.max(0, Number(input.medical) || 0), casual: Math.max(0, Number(input.casual) || 0), workStart: requiredArrival(role) });
    store.people[store.people.length - 1].idCardNumber = typeof input.idCardNumber === "string" ? input.idCardNumber.trim() : "";
  } else if (payload.action === "employee.update") {
    const input = payload.employee as Partial<Staff> | undefined;
    const person = store.people.find((employee) => employee.id === payload.id);
    if (!person) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    if (!input?.name?.trim() || !input.devicePin?.trim()) return NextResponse.json({ error: "Employee name and machine PIN are required." }, { status: 400 });
    if (input.id && input.id !== person.id) return NextResponse.json({ error: "Employee ID cannot be changed because it is linked to attendance and leave history." }, { status: 400 });
    if (!staffTypes.includes(input.role ?? "" as Staff["role"])) return NextResponse.json({ error: "Choose a valid staff type." }, { status: 400 });
    const devicePin = input.devicePin.trim();
    if (store.people.some((employee) => employee.id !== person.id && employee.devicePin === devicePin)) return NextResponse.json({ error: "That machine PIN is already assigned." }, { status: 409 });
    if (devicePin !== person.devicePin) {
      prepareReusedDevicePin(store, devicePin);
      assignDevicePin(store,person.id,devicePin,deviceLocalTimestamp());
    }
    person.name = input.name.trim();
    person.role = input.role!;
    person.dept = input.dept?.trim() || "";
    person.idCardNumber = typeof input.idCardNumber === "string" ? input.idCardNumber.trim() : person.idCardNumber || "";
    person.devicePin = devicePin;
    person.workStart = requiredArrival(person.role);
    for (const leave of store.leaves) if (leave.employeeId === person.id) leave.name = person.name;
  } else if (payload.action === "employee.remove") {
    if(typeof payload.id!=="string"||!payload.id.trim())return NextResponse.json({error:"Choose an employee."},{status:400});
    if(!store.people.some(person=>person.id===payload.id))return NextResponse.json({error:"Employee not found."},{status:404});
    permanentlyRemoveEmployee(store,payload.id);
  } else if (payload.action === "employee.period-balances") {
    try{savePeriodBalances(store,payload.id,payload,new Date().toISOString());}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid leave periods."},{status:400});}
  } else if (payload.action === "employee.opening-balance") {
    try{saveOpeningBalance(store,payload.id,payload.year,payload.used,payload.expectedRevision,payload.reason,new Date().toISOString());}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid opening balances."},{status:400});}
  } else if (payload.action === "employee.balance") {
    const input = payload.employee as Partial<Staff> | undefined;
    const person = store.people.find((p) => p.id === input?.id);
    if (!person) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    for (const key of ["annual", "medical", "casual"] as const) {
      const value = Number(input?.[key]);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Leave balances must be non-negative numbers." }, { status: 400 });
      person[key] = value;
    }
  } else if (payload.action === "leave.create" || payload.action === "leave.update") {
    const input = payload.leave as Partial<Leave> | undefined;
    const existing = payload.action === "leave.update" ? store.leaves.find((item) => item.id === payload.id) : undefined;
    if (payload.action === "leave.update" && !existing) return NextResponse.json({ error: "Leave record not found." }, { status: 404 });
    if(existing && input?.employeeId !== existing.employeeId) return NextResponse.json({error:"The staff member on an existing leave cannot be changed."},{status:400});
    const person = store.people.find((p) => p.id === input?.employeeId);
    if (!person || !input?.start || !input.end || input.end < input.start || !Number.isFinite(Number(input.days)) || Number(input.days) <= 0) return NextResponse.json({ error: "Choose an employee and valid leave dates and days." }, { status: 400 });
    if (!input.type || !allLeaveTypes.includes(input.type)) return NextResponse.json({ error: "Choose a valid leave type." }, { status: 400 });
    if(!existing && ["Medical","Casual"].includes(input.type)) return NextResponse.json({error:"Use the leave types in the current guide; Medical and Casual are retained only for existing records."},{status:400});
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    const allowedStatuses=existing&&['Completed','Declined'].includes(existing.status)?[existing.status]:['Approved','Pending'];
    if (!validDate(input.start) || !validDate(input.end) || !allowedStatuses.includes(String(input.status))) return NextResponse.json({ error: "Choose valid dates and a valid status for this record." }, { status: 400 });
    if(input.appliedOn && !validDate(input.appliedOn)) return NextResponse.json({error:"Enter a valid application date."},{status:400});
    const type = input.type as LeaveType;
    let plan;
    try { plan=resolveLeavePlan(store,person,input,existing?.id); }
    catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Invalid leave plan."},{status:400}); }
    const days = plan.days;
    let medical,mcDocument;
    try {
      mcDocument=attachMcDocument(store,person.id,type,input.mcDocumentId,existing?.mcDocumentId);
      const changedFile=!!mcDocument&&mcDocument.id!==existing?.mcDocumentId;
      if(input.medical!==undefined)medical=normalizeMedical(input.medical,type,input.start,plan.end,existing?.returnedAt);
      else if(type.startsWith("Sick")){
        medical=existing?.medical?{...existing.medical}:normalizeMedical({},type,input.start,plan.end,existing?.returnedAt);
        if(medical&&(changedFile||existing?.start!==input.start||existing?.end!==plan.end||existing?.type!==type)){medical.verified=false;delete medical.verifiedBy;delete medical.verifiedAt;}
      }
      if(changedFile&&medical){medical.reference=mcDocument!.name;medical.receivedOn=mcDocument!.uploadedAt.slice(0,10);medical.verified=false;delete medical.verifiedBy;delete medical.verifiedAt;}
    }
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid MC attachment."},{status:400});}
    try {validateSickWithoutMcRun(store.leaves,{employeeId:person.id,type,start:input.start,end:plan.end,days,medical,status:String(input.status),returnedAt:existing?.returnedAt},store.holidays || [],existing?.id);}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"MC required."},{status:400});}
    if(existing?.medical?.unauthorizedAbsence&&!medical?.unauthorizedAbsence&&!medical?.verified)return NextResponse.json({error:"Verify the supporting document before reversing the previous unauthorized-absence decision."},{status:400});
    const record = {
      deductibleDays:plan.deductibleDays,mcDocumentId:mcDocument?.id,medical,trip:plan.trip,duty:"duty" in plan?{...plan.duty,reportedAt:existing?.duty?.reportedAt,reportReference:existing?.duty?.reportReference}:undefined,chargeType:plan.chargeType,payBasis:plan.payBasis,
      eventReference:typeof input.eventReference === "string"?input.eventReference.trim():undefined,
      appliedOn: input.appliedOn || existing?.appliedOn || (existing ? undefined : new Date().toISOString().slice(0,10)),
      employeeId: person.id,
      name: person.name,
      type,
      start: input.start,
      end: plan.end,
      days,
      reason: typeof input.reason === "string" ? input.reason.trim() : "",
      clinic: typeof input.clinic === "string" ? input.clinic.trim() : existing?.clinic || "",
      mcNumber: typeof input.mcNumber === "string" ? input.mcNumber.trim() : existing?.mcNumber || "",
      status: input.status as Leave["status"]
    };
    try {const candidate={...existing,...record,id:existing?.id||"new"};if(candidate.status==="Completed"&&candidate.returnedAt)candidate.usedDays=actualUsedDays(candidate,candidate.returnedAt.slice(0,10),store.holidays||[]);checkLeaveAllowance(store,person,candidate,existing?.id);}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Leave allowance exceeded."},{status:400});}
    if (existing) {
      try {applyLeaveEdit(store,existing,record,payload.expectedRevision,payload.editReason,makeId(),new Date().toISOString());}
      catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid leave change."},{status:400});}
    }
    else store.leaves.unshift({ id: makeId(), ...record });
  } else if (payload.action === "leave.delete") {
    if(typeof payload.id!=="string"||!store.leaves.some(leave=>leave.id===payload.id))return NextResponse.json({error:"Leave record not found."},{status:404});
    const leave=store.leaves.find(leave=>leave.id===payload.id)!;
    if(payload.expectedRevision!==(leave.revision||0))return NextResponse.json({error:"This leave changed. Reopen the record before deleting it."},{status:409});
    try{deleteLeavePermanently(store,payload.id,payload.expectedRevision,payload.reason,makeId(),new Date().toISOString());}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to delete leave."},{status:400});}
  } else if (payload.action === "leave.duty.complete") {
    const leave=store.leaves.find(item=>item.id===payload.id);
    if(!leave)return NextResponse.json({error:"Duty travel record not found."},{status:404});
    try {
      const duty=dutyReport(leave,payload.reportedAt,payload.reportReference);
      applyLeaveEdit(store,leave,{duty,status:"Completed",returnedAt:duty.reportedAt!.replace("T"," ")+":00"},payload.expectedRevision,"Recorded official-duty report to the attendance officer.",makeId(),new Date().toISOString());
    } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid duty report."},{status:400});}
  } else if (payload.action === "leave.decision") {
    const leave = store.leaves.find((item) => item.id === payload.id);
    if (!leave || !["Approved", "Declined"].includes(String(payload.status))) return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
    if (leave.status !== "Pending") return NextResponse.json({ error: "Only pending requests can be reviewed." }, { status: 409 });
    if(payload.status==="Approved"){
      const person=store.people.find(p=>p.id===leave.employeeId);
      if(!person)return NextResponse.json({error:"Staff member not found."},{status:400});
      try{resolveLeavePlan(store,person,leave,leave.id);checkLeaveAllowance(store,person,{...leave,status:"Approved"},leave.id);}
      catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Review leave details before approval."},{status:400});}
      try{validateSickWithoutMcRun(store.leaves,{...leave,status:"Approved"},store.holidays || [],leave.id);}
      catch(error){return NextResponse.json({error:error instanceof Error?error.message:"MC required."},{status:400});}
    }
    leave.status = payload.status as Leave["status"];
    leave.revision=(leave.revision || 0)+1;
  } else if (payload.action === "leave.adjust") {
    const leave = store.leaves.find((item) => item.id === payload.id);
    const usedDays = Number(payload.usedDays);
    if(leave?.type==="Duty travel")return NextResponse.json({error:"Duty duration follows the authorized assignment. Edit the duty dates with a reason instead."},{status:400});
    if (!leave || leave.status !== "Completed") return NextResponse.json({ error: "Completed leave record not found." }, { status: 404 });
    if (!Number.isFinite(usedDays) || usedDays < 0 || usedDays > leave.days) return NextResponse.json({ error: "Used leave days must be between zero and the recorded leave days." }, { status: 400 });
    const person=store.people.find(p=>p.id===leave.employeeId);
    if(!person)return NextResponse.json({error:"Staff member not found."},{status:400});
    try{checkLeaveAllowance(store,person,{...leave,usedDays},leave.id);}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Leave allowance exceeded."},{status:400});}
    leave.usedDays = usedDays;
    leave.revision=(leave.revision || 0)+1;
  } else if (payload.action === "punch.deny") {
    try { denyPunch(store,payload.entry,new Date().toISOString(),makeId()); }
    catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Unable to deny fingerprint log."},{status:400}); }
  } else if (payload.action === "attendance.manual") {
    try { addAttendanceCorrection(store,payload.entry,makeId(),new Date().toISOString()); }
    catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Invalid attendance correction."},{status:400}); }
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  writeStore(store);
  if(store.pendingEmployeeFileDeletes?.length){flushEmployeeFileDeletes(store);writeStore(store);}
  return NextResponse.json({...stateForClient(store),deletionFilesPending:store.pendingEmployeeFileDeletes?.length||0});
}

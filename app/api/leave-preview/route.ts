import { leavePeriod } from "@/lib/leave-periods";
import { checkDutyOverlap } from "@/lib/duty-travel";
import { resolveLeavePlan, checkLeaveAllowance } from "@/lib/leave-requirements";
import { NextResponse } from "next/server";
import { isSignedIn } from "@/lib/auth";
import { readStore } from "@/lib/store";
import { validateSickWithoutMcRun, allLeaveTypes, entitlementFor, leaveNotes, planLeave, sickUsage, usedDaysForType } from "@/lib/leave-policy";
import type { LeaveType } from "@/lib/leave-policy";
export const runtime="nodejs";
export async function GET(request: Request) {
  if(!isSignedIn(request)) return NextResponse.json({error:"Sign-in required."},{status:401});
  const q=new URL(request.url).searchParams, store=readStore();
  const person=store.people.find(p=>p.id===q.get("employeeId")), type=q.get("type") as LeaveType;
  if(!person || !allLeaveTypes.includes(type)) return NextResponse.json({error:"Choose staff and a leave type."},{status:400});
  let preview: { end: string; days: number; readOnlyDays: boolean } | undefined;
  try {
    const start=q.get("start") || "", year=Number(start.slice(0,4)), excludeId=q.get("excludeId") || undefined;
    const trip=q.get("trip")?JSON.parse(q.get("trip")!):undefined;
    const plan=resolveLeavePlan(store,person,{type,start,days:Number(q.get("days")),trip,duty:q.get("duty")?JSON.parse(q.get("duty")!):undefined},excludeId);
    // Return the calculated dates even if balance setup or eligibility still needs attention.
    preview={end:plan.end,days:plan.days,readOnlyDays:type==="Maternity"||((type==="Hajj"||type==="Umra")&&plan.trip?.basis!=="Annual")};
    checkDutyOverlap(store,person.id,type,start,plan.end,"Pending",excludeId);
    validateSickWithoutMcRun(store.leaves,{employeeId:person.id,type,start,end:plan.end,days:plan.days,status:"Pending"},store.holidays || [],excludeId);
    const yearly=["Annual","Family","Sick with MC","Sick without MC","Medical","Casual"].includes(type);
    if(yearly||plan.chargeType==="Annual")checkLeaveAllowance(store,person,{id:excludeId||"preview",employeeId:person.id,name:person.name,type,start,end:plan.end,days:plan.days,chargeType:plan.chargeType,payBasis:plan.payBasis,status:"Pending",reason:""},excludeId);
    let entitlement=entitlementFor(type,person,start), used=yearly?usedDaysForType(store.leaves,person.id,type,excludeId,start,person,store.holidays||[]):0;
    if(type==="No pay")return NextResponse.json({...plan,readOnlyDays:false,entitlement:null,used:0,available:null,note:leaveNotes[type],year,holidayCount:(store.holidays||[]).length,isNoPay:true});
    if(type==="Duty travel")return NextResponse.json({...plan,readOnlyDays:false,entitlement:null,used:0,available:null,note:leaveNotes[type],year,holidayCount:(store.holidays||[]).length,isDutyTravel:true});
    if(type==="Hajj"||type==="Umra"){
      if(plan.chargeType==="Annual"){entitlement=30;used=usedDaysForType(store.leaves,person.id,"Annual",excludeId,start,person,store.holidays||[]);}
      else {entitlement=plan.days;used=0;}
    }
    if(type==="Circumcision"){entitlement=5;const ref=q.get("eventReference")?.trim().toLowerCase();used=store.leaves.filter(l=>l.id!==excludeId&&l.employeeId===person.id&&l.type==="Circumcision"&&ref&&l.eventReference?.trim().toLowerCase()===ref&&["Pending","Approved","Completed"].includes(l.status)).reduce((sum,l)=>sum+(l.status==="Completed"?(l.usedDays??l.days):l.days),0);}
    if(type.startsWith("Sick")) {
      const sick=sickUsage(store.leaves,person.id,excludeId,start,person,store.holidays||[]);
      const remaining=Math.max(0,Math.min(30-sick.total,type === "Sick without MC"?15-sick.withoutMc:30));
      used=entitlement-remaining;
    }
    return NextResponse.json({...plan,balancePeriod:yearly||plan.chargeType==="Annual"?leavePeriod(person,plan.chargeType==="Annual"?"Annual":type,start):null,readOnlyDays:type==="Maternity"||((type==="Hajj"||type==="Umra")&&plan.trip?.basis!=="Annual"),entitlement,used,available:Math.max(0,entitlement-used),note:leaveNotes[type as keyof typeof leaveNotes] || "Legacy leave",year,holidayCount:(store.holidays || []).length});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Invalid plan.",preview},{status:400});}
}

import { NextResponse } from "next/server";
import { isSignedIn } from "@/lib/auth";
import { readStore } from "@/lib/store";
import { previewPeriodBalances } from "@/lib/period-balances";
export const runtime="nodejs";
export async function GET(request:Request){
  if(!isSignedIn(request))return NextResponse.json({error:"Sign-in required."},{status:401});
  const q=new URL(request.url).searchParams;
  try{return NextResponse.json(previewPeriodBalances(readStore(),q.get("id"),{asOf:q.get("asOf"),joinedOn:q.get("joinedOn")??undefined,leaveYearAnchor:q.get("leaveYearAnchor")??undefined,rules:q.get("rules")?JSON.parse(q.get("rules")!):undefined}),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid balance period."},{status:400});}
}

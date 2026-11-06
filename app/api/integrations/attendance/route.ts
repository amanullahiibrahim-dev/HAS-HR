import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizePunch, ingestPunches } from "@/lib/punches";
import { readStore, writeStore } from "@/lib/store";

export const runtime = "nodejs";

// Machine-to-machine bridge endpoint; it cannot change staff or leave entitlements.
export async function POST(request: Request) {
  const expected = process.env.HAAZIR_SYNC_TOKEN;
  if (!expected || expected.length < 32) return NextResponse.json({error:"Attendance sync is not configured."},{status:503});
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /,"") || "";
  const a=Buffer.from(supplied), b=Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a,b)) return NextResponse.json({error:"Unauthorized sync request."},{status:401});
  const expectedSerial=process.env.ZKTECO_DEVICE_SN?.trim();
  if (!expectedSerial) return NextResponse.json({error:"Configure the attendance terminal serial before importing logs."},{status:503});
  const chunks: Uint8Array[]=[];
  let size=0;
  if (!request.body) return NextResponse.json({error:"A logs payload is required."},{status:400});
  const reader=request.body.getReader();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>2_000_000){await reader.cancel();return NextResponse.json({error:"Split logs into batches below 2 MB."},{status:413});}chunks.push(part.value);}
  let logs; let deviceSerial: string | undefined;
  try {
    const payload=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!Array.isArray(payload.logs)||payload.logs.length>5000)throw new Error("Send at most 5,000 logs per batch.");
    logs=payload.logs.map((value: unknown) => {
      const punch=normalizePunch(value);
      const fields=value as Record<string, unknown>;
      return {...punch, verify: typeof fields.verify === "string" ? fields.verify.slice(0,64) : ""};
    });
    if (logs.some((p: {serial:string})=>p.serial!==expectedSerial)) throw new Error("Log serial does not match the configured terminal.");
    if (payload.deviceSerial !== undefined) {
      deviceSerial=payload.deviceSerial;
      if (typeof deviceSerial !== "string" || !deviceSerial.trim() || deviceSerial.length>128 || logs.some((p: {serial:string})=>p.serial!==deviceSerial)) throw new Error("Device serial must match every log.");
      if (expectedSerial!==deviceSerial) throw new Error("Device serial does not match the configured terminal.");
    }
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Invalid logs payload."},{status:400});}
  const store=readStore();
  const result=ingestPunches(store,logs);
  store.sync={lastSeen:new Date().toISOString(),lastInserted:result.inserted};
  if(deviceSerial){store.device.lastSeen=store.sync.lastSeen;store.device.serial=deviceSerial;store.device.count+=result.inserted;}
  writeStore(store);
  return NextResponse.json(result);
}

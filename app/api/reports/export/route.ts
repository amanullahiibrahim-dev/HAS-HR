import { NextResponse } from "next/server";
import { isSignedIn, isSameOrigin } from "@/lib/auth";
import { exportReport, MAX_REPORT_BYTES, ReportInputError } from "@/lib/report-export.mjs";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isSignedIn(request)) return NextResponse.json({error:"Sign-in required."},{status:401});
  if (!isSameOrigin(request)) return NextResponse.json({error:"Invalid request origin."},{status:403});
  const format=new URL(request.url).searchParams.get("format");
  if(format!=="pdf"&&format!=="docx")return NextResponse.json({error:"Choose PDF or Word (.docx)."},{status:400});
  if(!request.body)return NextResponse.json({error:"Choose a report to export."},{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  const reader=request.body.getReader();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_REPORT_BYTES){await reader.cancel();return NextResponse.json({error:"Report is too large. Choose a shorter period or fewer employees."},{status:413});}chunks.push(part.value);}
  let input;
  try{input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return NextResponse.json({error:"Invalid report data."},{status:400});}
  try{
    const file=await exportReport(input,format);
    return new Response(new Uint8Array(file.bytes),{headers:{"Content-Type":file.contentType,"Content-Disposition":`attachment; filename="${file.filename}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(error){
    if(error instanceof ReportInputError)return NextResponse.json({error:error.message},{status:400});
    console.error("Report export failed",error instanceof Error?error.name:"Unknown error");
    return NextResponse.json({error:"The report could not be created. Try again or narrow the selected period."},{status:500});
  }
}

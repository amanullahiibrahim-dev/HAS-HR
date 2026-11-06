import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isSignedIn, isSameOrigin } from "@/lib/auth";
import { makeId, readStore, writeStore } from "@/lib/store";
import { maxMcBytes, mcFilePath, validateMcFile } from "@/lib/mc-documents";
export const runtime="nodejs";
export async function POST(request:Request){
  if(!isSignedIn(request))return NextResponse.json({error:"Sign-in required."},{status:401});
  if(!isSameOrigin(request))return NextResponse.json({error:"Invalid request origin."},{status:403});
  if(!request.headers.get("content-type")?.startsWith("multipart/form-data"))return NextResponse.json({error:"Choose an MC file to upload."},{status:400});
  const reader=request.body?.getReader();if(!reader)return NextResponse.json({error:"Choose an MC file."},{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxMcBytes+65536){await reader.cancel();return NextResponse.json({error:"MC files must be no larger than 5 MB."},{status:413});}chunks.push(part.value);}
    const data=await new Response(Buffer.concat(chunks),{headers:{"content-type":request.headers.get("content-type")!}}).formData();
    const file=data.get("file"),employeeId=data.get("employeeId");
    if(!file||typeof file==="string"||typeof employeeId!=="string")return NextResponse.json({error:"Choose staff and one MC file."},{status:400});
    const bytes=new Uint8Array(await file.arrayBuffer());
    const details=validateMcFile(file.name,file.type,bytes);
    const store=readStore();if(!store.people.some(p=>p.id===employeeId))return NextResponse.json({error:"Staff member not found."},{status:404});
    const document={...details,id:makeId(),employeeId,uploadedAt:new Date().toISOString(),uploadedBy:"Administrator" as const};
    const target=mcFilePath(document.id);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:"wx",mode:0o600});
    try{(store.mcDocuments ||= []).push(document);writeStore(store);}catch(error){fs.unlinkSync(target);throw error;}
    return NextResponse.json({document},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error&&/file|PDF|JPG|PNG|extension|contents/.test(error.message)?error.message:"Unable to upload the MC. Please try again."},{status:400});}
}

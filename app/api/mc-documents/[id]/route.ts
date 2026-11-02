import fs from "node:fs";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";
import { mcFilePath } from "@/lib/mc-documents";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  if(!isAdmin(request))return NextResponse.json({error:"Administrator sign-in required."},{status:401});
  const {id}=await context.params;
  const document=readStore().mcDocuments?.find(d=>d.id===id);
  if(!document)return NextResponse.json({error:"MC file not found."},{status:404});
  try{
    const bytes=fs.readFileSync(mcFilePath(id));
    return new Response(new Uint8Array(bytes),{headers:{"content-type":document.mimeType,"content-disposition":`attachment; filename="MC${document.mimeType==='application/pdf'?'.pdf':document.mimeType==='image/png'?'.png':'.jpg'}"; filename*=UTF-8''${encodeURIComponent(document.name)}`,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-length":String(bytes.length)}});
  }catch{return NextResponse.json({error:"MC file is unavailable. Restore it from the server backup or upload a replacement."},{status:404});}
}

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "./store";
export type McDocument={id:string;employeeId:string;name:string;mimeType:string;size:number;sha256:string;uploadedAt:string;uploadedBy:"Administrator"};
export const maxMcBytes=5*1024*1024;
export function validateMcFile(name:string,declaredType:string,bytes:Uint8Array){
  if(!bytes.length||bytes.length>maxMcBytes)throw new Error("Choose a PDF, JPG or PNG file up to 5 MB.");
  const data=Buffer.from(bytes);
  const mimeType=data.subarray(0,5).toString()==="%PDF-"?"application/pdf":data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":data[0]===255&&data[1]===216&&data[2]===255?"image/jpeg":null;
  if(!mimeType)throw new Error("Only PDF, JPG and PNG files are supported.");
  const cleanName=name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g,"").slice(-160);
  const ext=path.extname(cleanName).toLowerCase();
  if(!({"application/pdf":[".pdf"],"image/png":[".png"],"image/jpeg":[".jpg",".jpeg"]}[mimeType]).includes(ext))throw new Error("The file extension does not match its contents.");
  if(declaredType&&declaredType!=="application/octet-stream"&&declaredType!==mimeType)throw new Error("The uploaded file type does not match its contents.");
  return {name:cleanName,mimeType,size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
}
export function mcFilePath(id:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new Error("Invalid document ID.");
  const directory=process.env.HAAZIR_MC_DIRECTORY||path.join(path.dirname(process.env.HAAZIR_DB_PATH||path.join(process.cwd(),"data","haazir-data.json")),"mc-documents");
  return path.join(directory,`${id}.bin`);
}
export function attachMcDocument(store:Store,employeeId:string,type:string,requested:unknown,previousId?:string){
  if(type!=="Sick with MC")return undefined;
  if(requested!==undefined&&typeof requested!=="string")throw new Error("Invalid MC document selection.");
  const id=(requested as string|undefined)||previousId;
  if(!id)return undefined;
  const document=store.mcDocuments?.find(d=>d.id===id&&d.employeeId===employeeId);
  if(!document)throw new Error("This MC file is not assigned to the selected staff member. Upload it again for this staff member.");
  return document;
}

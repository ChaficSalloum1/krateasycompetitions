import { inflateSync } from "fflate";
import { Buffer } from "buffer";
export function inflateRawSync(data:Uint8Array,options:{maxOutputLength:number}){
  // Fixed output capacity enforces the existing ingestion expansion limit before allocation.
  const result=inflateSync(data,{out:new Uint8Array(options.maxOutputLength+1)});
  if(result.length>options.maxOutputLength)throw new Error("Expanded workbook exceeds limit");
  return Buffer.from(result);
}

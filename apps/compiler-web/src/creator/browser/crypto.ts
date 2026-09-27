import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
/** Browser implementation of the exact synchronous SHA-256 subset used by core canonical hashing. */
export function createHash(algorithm:string){
  if(algorithm!=="sha256")throw new Error("Unsupported hash algorithm");
  const hash=sha256.create();
  return {update(value:string|Uint8Array,_encoding?:string){hash.update(typeof value==="string"?new TextEncoder().encode(value):value);return this;},digest(encoding:string){if(encoding!=="hex")throw new Error("Only hex digests supported");return bytesToHex(hash.digest());}};
}

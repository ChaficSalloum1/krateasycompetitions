import { build } from "esbuild";
import { mkdir,cp } from "node:fs/promises";
import { resolve } from "node:path";
const out=resolve(process.argv[2]??"output/creator");
await mkdir(out,{recursive:true});
await build({entryPoints:["apps/compiler-web/src/creator/ui.ts"],outfile:resolve(out,"creator.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",sourcemap:true,
  alias:{"node:crypto":resolve("apps/compiler-web/src/creator/browser/crypto.ts"),"node:zlib":resolve("apps/compiler-web/src/creator/browser/zlib.ts"),"@tournament-os/tournament-schema":resolve("packages/tournament-schema/src/index.ts")},
  inject:["apps/compiler-web/src/creator/browser/globals.ts"]});
for(const file of ["index.html","creator.css"])await cp(`apps/compiler-web/src/creator/${file}`,resolve(out,file));
console.log(`Creator built at ${out}`);

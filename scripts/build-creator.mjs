import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir,cp,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const out=resolve(process.argv[2]??"output/creator");
await mkdir(out,{recursive:true});
await build({entryPoints:["apps/compiler-web/src/creator/ui.ts"],outfile:resolve(out,"creator.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",sourcemap:true,
  alias:{"node:crypto":resolve("apps/compiler-web/src/creator/browser/crypto.ts"),"node:zlib":resolve("apps/compiler-web/src/creator/browser/zlib.ts"),"@tournament-os/tournament-schema":resolve("packages/tournament-schema/src/index.ts")},
  inject:["apps/compiler-web/src/creator/browser/globals.ts"]});
for(const file of ["index.html","creator.css"])await cp(`apps/compiler-web/src/creator/${file}`,resolve(out,file));
await cp("scenario/play-konnect-reference/studio-review-roster.csv",resolve(out,"studio-review-roster.csv"));
// HTML pins both assets to their contents so a previous cached bundle cannot mix with new markup.
let html=await readFile(resolve(out,"index.html"),"utf8");
for(const file of ["creator.js","creator.css"]){
  const contents=await readFile(resolve(out,file));
  const hash=createHash("sha256").update(contents).digest("hex").slice(0,16);
  const name=file.replace(/\.(js|css)$/,(extension)=>`.${hash}${extension}`);
  await writeFile(resolve(out,name),contents);
  html=html.replaceAll(`"${file}"`,`"${name}"`);
}
await writeFile(resolve(out,"index.html"),html);
console.log(`Creator built at ${out}`);

import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {createAuditFixtures,runAuditScenario,type AuditMutation} from '../apps/compiler-web/src/scenario-audit.js';
const root=resolve(import.meta.dirname,'..');
const fixtures=createAuditFixtures(readFileSync(join(root,'apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json'),'utf8').trimEnd());
const port=Number(process.env.AUDIT_PORT??4317);
const files:Record<string,[string,string]>={'/':['apps/compiler-web/audit-ui/index.html','text/html; charset=utf-8'],'/app.js':['apps/compiler-web/audit-ui/app.js','text/javascript; charset=utf-8'],'/style.css':['apps/compiler-web/audit-ui/style.css','text/css; charset=utf-8'],'/reports/acceptance.md':['docs/A3_EXIT_GATE.md','text/plain; charset=utf-8'],'/reports/core-regression.txt':['scenario/verification/core-regression.txt','text/plain; charset=utf-8']};
const server=createServer(async(req,res)=>{
 const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
 const path=new URL(req.url??'/',`http://127.0.0.1:${port}`).pathname;
 if(req.method==='GET'&&path==='/catalog.json')return send(200,{mode:'live',scenarios:fixtures.map(({id,title})=>({id,title}))});
 if(req.method==='GET'&&files[path]){const [file,type]=files[path]!;res.writeHead(200,{'content-type':type,'x-content-type-options':'nosniff'});res.end(readFileSync(join(root,file)));return;}
 if(req.method!=='POST'||path!=='/api/run')return send(404,{code:'NOT_FOUND'});
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){send(413,{code:'INPUT_TOO_LARGE'});return;}}
  const input=JSON.parse(body) as Record<string,unknown>;
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['scenario','mutation','expectedRevision'].includes(k)))return send(400,{code:'FORGED_INPUT'});
  if(input.expectedRevision!==1)return send(409,{code:'STALE'});
  const fixture=fixtures.find(f=>f.id===input.scenario);
  if(!fixture||!['none','qualification','draw','schedule'].includes(String(input.mutation)))return send(400,{code:'UNSUPPORTED'});
  return send(200,runAuditScenario(fixture,input.mutation as AuditMutation));
 }catch{send(400,{code:'INVALID_INPUT'});}
});
server.listen(port,'127.0.0.1',()=>{const address=server.address();console.log(`Core audit prototype: http://127.0.0.1:${typeof address==='object'&&address?address.port:port}`);});

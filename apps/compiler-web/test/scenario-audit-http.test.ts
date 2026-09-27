import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('live audit HTTP boundary runs the core and rejects forged, stale and malformed requests', {timeout:30000},async()=>{
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../../../scripts/serve-scenario-audit.ts',import.meta.url))],{env:{...process.env,AUDIT_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const origin=await new Promise<string>((resolve,reject)=>{let stdout='',stderr='';const timer=setTimeout(()=>reject(new Error('audit_startup_timeout '+stderr)),15000);child.stderr.on('data',d=>stderr+=d);child.stdout.on('data',d=>{stdout+=d;const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`audit_startup_exit:${code}:${stderr}`));});});
  const catalogue=await (await fetch(origin+'/catalog.json')).json();assert.equal(catalogue.mode,'live');assert.equal(catalogue.scenarios.length,3);
  for(const scenario of catalogue.scenarios){const res=await fetch(origin+'/api/run',{method:'POST',body:JSON.stringify({scenario:scenario.id,mutation:'draw',expectedRevision:1})});assert.equal(res.status,200);assert.equal((await res.json()).firstFailure,'DRAW');}
  for(const [body,status] of [['{',400],[JSON.stringify({scenario:'simple-knockout',mutation:'none',expectedRevision:0}),409],[JSON.stringify({scenario:'simple-knockout',mutation:'none',expectedRevision:1,guard:{status:'PASSED'}}),400]] as const){assert.equal((await fetch(origin+'/api/run',{method:'POST',body})).status,status);}
  assert.equal((await fetch(origin+'/package.json')).status,404);
 }finally{child.kill();}
});

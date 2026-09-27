import {mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {canonicalHash} from '@tournament-os/tournament-schema';
import {createAuditFixtures,runAuditScenario,verifyAuditRun,type AuditMutation} from '../apps/compiler-web/src/scenario-audit.js';
const root=resolve(import.meta.dirname,'..');
const fixtures=createAuditFixtures(readFileSync(join(root,'apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json'),'utf8').trimEnd());
const output=resolve(process.argv[2]??join(root,'output/scenario-audit'));
mkdirSync(join(output,'runs'),{recursive:true});
cpSync(join(root,'apps/compiler-web/audit-ui'),output,{recursive:true});
const summary=[];
for(const fixture of fixtures){
 for(const mutation of ['none','qualification','draw','schedule'] as AuditMutation[]){
  const run=runAuditScenario(fixture,mutation);const integrity=verifyAuditRun(run);
  if(integrity.length||run.firstFailure!==(mutation==='none'?null:mutation.toUpperCase()))throw new Error(`audit_acceptance_failed:${fixture.id}:${mutation}`);
  writeFileSync(join(output,'runs',`${fixture.id}-${mutation}.json`),JSON.stringify(run,null,2)+'\n');
  summary.push({scenario:fixture.id,mutation,status:run.status,firstFailure:run.firstFailure,proofHash:run.proofHash});
 }
 const directory=join(root,'scenario',fixture.id);mkdirSync(directory,{recursive:true});
 writeFileSync(join(directory,'source.json'),fixture.source.original+'\n');
 writeFileSync(join(directory,'manifest.json'),JSON.stringify({id:fixture.id,title:fixture.title,source:fixture.source.origin,basis:fixture.source.basis,sourceHash:canonicalHash(fixture.source),definitionHash:canonicalHash(fixture.definition),results:'SYNTHETIC_AUDIT_RESULTS',reproduce:'npm run audit:scenarios',gate:'A3 observability only; not Phase B or production certification'},null,2)+'\n');
}
writeFileSync(join(output,'catalog.json'),JSON.stringify({mode:'recorded',scenarios:fixtures.map(({id,title})=>({id,title})),summary},null,2)+'\n');
mkdirSync(join(output,'reports'),{recursive:true});
cpSync(join(root,'docs/A3_EXIT_GATE.md'),join(output,'reports/acceptance.md'));
cpSync(join(root,'scenario/verification/core-regression.txt'),join(output,'reports/core-regression.txt'));
console.log(JSON.stringify({output,executions:summary.length,summary},null,2));

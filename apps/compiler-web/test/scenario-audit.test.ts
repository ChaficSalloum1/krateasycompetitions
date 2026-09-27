import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {canonicalHash} from "@tournament-os/tournament-schema";
import {AUDIT_STAGES,createAuditFixtures,runAuditScenario,verifyAuditRun,auditProofHash,type AuditMutation} from "../src/scenario-audit.js";
import {assureQualification} from "../../../packages/competition-engine/src/pipeline-assurance.js";
import type {TournamentSpec} from "@tournament-os/tournament-schema";
import type {Entrant,QualificationResult,Standing} from "../../../packages/competition-engine/src/types.js";
const fixtures=createAuditFixtures(readFileSync(new URL('./fixtures/pk-st-albans-production-lock-candidate-2.json',import.meta.url),'utf8').trimEnd());
for(const fixture of fixtures){
 test(`${fixture.id}: real pipeline records all boundaries and independently passes`,()=>{
  const run=runAuditScenario(fixture);assert.equal(run.status,"READY");assert.equal(run.firstFailure,null);assert.deepEqual(run.boundaries.map(b=>b.stage),AUDIT_STAGES);assert.deepEqual(verifyAuditRun(run),[]);
  assert.equal(run.boundaries.find(b=>b.stage==='SCHEDULE')!.output instanceof Object,true);
  assert.equal(run.proofHash,runAuditScenario(fixture).proofHash,'telemetry must not change artefact identity');
  for(const b of run.boundaries){assert.equal(b.outputHash,canonicalHash(b.output));assert.equal(b.revision,1);assert.ok(b.telemetry.elapsedMs>=0);}
 });
 for(const mutation of ['qualification','draw','schedule'] as AuditMutation[]){
 test(`${fixture.id}: corrupt ${mutation} is independently localised and stops downstream`,()=>{
  const before=canonicalHash(fixture);const run=runAuditScenario(fixture,mutation);
  assert.equal(run.status,'BLOCKED');assert.equal(run.firstFailure,mutation.toUpperCase());assert.deepEqual(verifyAuditRun(run),[]);
  const index=run.boundaries.findIndex(b=>b.stage===run.firstFailure);
  assert.ok(run.boundaries[index]!.findings.some(f=>f.severity==='ERROR'));
  assert.ok(run.boundaries.slice(index+1,-1).every(b=>b.status==='SKIPPED'&&b.output===null));
  assert.equal(run.boundaries.at(-1)!.stage,'GUARD');assert.equal(run.boundaries.at(-1)!.status,'BLOCKED');assert.equal(canonicalHash(fixture),before,'audit fault injection cannot alter source fixture');
 });}
}
test('historical source and test decisions are disclosed, not passed off as played outcomes',()=>{
 const fixture=fixtures[2]!;const run=runAuditScenario(fixture);
 const facts=fixture.facts as {originalMissingDecisions:unknown[];fixtureDecisions:unknown[];untrustedClaims:unknown[]};
 assert.equal(facts.originalMissingDecisions.length,8);assert.equal(facts.fixtureDecisions.length,8);assert.ok(facts.untrustedClaims.length>0);
 assert.match(JSON.stringify(run.boundaries.find(b=>b.stage==='CLASSIFICATION')!.output),/SYNTHETIC_TRANSITIVE_RESULTS_FOR_AUDIT_ONLY/);
 assert.equal((run.boundaries.find(b=>b.stage==='SCHEDULE')!.output as {contests:unknown[]}).contests.length,108);
});
test('missing required source field stops at Definition rather than fabricating a graph',()=>{
 const fixture=structuredClone(fixtures[0]!);fixture.definition.participants.count=-1;const run=runAuditScenario(fixture);
 assert.equal(run.firstFailure,'DEFINITION');assert.equal(run.boundaries.find(b=>b.stage==='GRAPH')!.status,'SKIPPED');
});
test('altered output, stale boundary revision and reordered evidence fail integrity checks',()=>{
 const run=runAuditScenario(fixtures[0]!);const altered=structuredClone(run);altered.boundaries[0]!.output={forged:true};assert.ok(verifyAuditRun(altered).length);
 const stale=structuredClone(run);stale.revision=2;stale.proofHash=auditProofHash(stale);assert.ok(verifyAuditRun(stale).some(f=>f.code==='AUDIT.BOUNDARY_MISMATCH'));
 const reordered=structuredClone(run);reordered.boundaries.reverse();reordered.proofHash=auditProofHash(reordered);assert.ok(verifyAuditRun(reordered).some(f=>f.code==='AUDIT.PIPELINE_SHAPE'));
 const scope=structuredClone(run);scope.scope=[];assert.ok(verifyAuditRun(scope).length);
});
test('independent qualifier verifier rejects coherent forged selection and unsupported semantics',()=>{
 const fixture=fixtures[2]!;const run=runAuditScenario(fixture);
 const spec=structuredClone(run.boundaries.find(b=>b.stage==='DEFINITION')!.output) as TournamentSpec;
 const standings=(run.boundaries.find(b=>b.stage==='CLASSIFICATION')!.output as {standings:Record<string,Standing[]>}).standings;
 const q=structuredClone(run.boundaries.find(b=>b.stage==='QUALIFICATION')!.output) as QualificationResult;
 const dest=Object.keys(q.byStructure)[0]!;const first=q.byStructure[dest]![0]!.id;
 const replacement=fixture.entrants![spec.stages.find(s=>s.id===spec.qualificationPolicies[0]!.sourceStageId)!.divisionId]!.find(e=>!q.byStructure[dest]!.some(x=>x.id===e.id))!;
 q.byStructure[dest]![0]=replacement;q.evidence=q.evidence.map(e=>e.entrantId===first?{...e,entrantId:replacement.id,sourceStanding:standings[spec.qualificationPolicies[0]!.sourceStageId]!.find(r=>r.entrantId===replacement.id)!}:e);
 assert.ok(assureQualification(spec,standings,fixture.entrants as Record<string,Entrant[]>,q).some(f=>f.code==='AUDIT.QUALIFICATION_SELECTION'));
 spec.qualificationPolicies[0]!.selectors=[{type:'manual_decision'}];
 assert.ok(assureQualification(spec,standings,fixture.entrants!,q).some(f=>f.code==='AUDIT.QUALIFICATION_UNSUPPORTED'));
});

test('a rejected imported schedule is UNKNOWN, never a proof of global infeasibility',()=>{
 const input=JSON.parse(fixtures[2]!.source.original);input.schedule[0].start='01:00';
 const changed=createAuditFixtures(JSON.stringify(input))[2]!;const run=runAuditScenario(changed);
 assert.equal(run.firstFailure,'SCHEDULE');
 assert.equal((run.boundaries.find(b=>b.stage==='SCHEDULE')!.output as {audit:{status:string}}).audit.status,'UNKNOWN');
});

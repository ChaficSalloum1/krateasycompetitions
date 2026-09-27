import { canonicalHash, compileDefinition, validateTournamentSpec, type TournamentDefinition, type TournamentSpec, type ValidationFinding } from "@tournament-os/tournament-schema";
import { buildCompetitionGraph, createEntrants } from "../../../packages/competition-engine/src/graph.js";
import { calculateStandings } from "../../../packages/competition-engine/src/standings.js";
import { qualify } from "../../../packages/competition-engine/src/qualification.js";
import { solveSchedule, validateSchedule } from "../../../packages/competition-engine/src/scheduler.js";
import { evaluateCompetitionGuard } from "../../../packages/competition-engine/src/competition-guard.js";
import { assureDraw, assureQualification } from "../../../packages/competition-engine/src/pipeline-assurance.js";
import type { CompetitionGraph, ContestResult, Entrant, QualificationResult, ScheduleSolution, Standing } from "../../../packages/competition-engine/src/types.js";
import { analyseCompetitionSources, applyWorkbenchEdit, planWorkbenchEdit, workbenchSourceDocument, type CompetitionWorkbenchProjection } from "./competition-workbench.js";
import { definitionFromProductionLock, entrantsFromProductionLock, verifiedScheduleFromProductionLock } from "./production-lock-definition.js";
import { definitionFromConnectedBlueprint } from "./generic-blueprint-definition.js";
import type { CompetitionBlueprint } from "./creation-proposal.js";

export const AUDIT_VERSION="pipeline-audit/1.0.0";
export const AUDIT_STAGES=["SOURCE","FACTS","DEFINITION","GRAPH","CLASSIFICATION","QUALIFICATION","SEED","TOPOLOGY","DRAW","SCHEDULE","GUARD"] as const;
export type AuditStage=typeof AUDIT_STAGES[number];
export type AuditMutation="none"|"qualification"|"draw"|"schedule";
export interface AuditFixture { id:string; title:string; source:{original:string;origin:string;basis:string}; definition:TournamentDefinition; entrants?:Record<string,Entrant[]>; facts:unknown; workbench?:CompetitionWorkbenchProjection; }
export interface AuditBoundary { stage:AuditStage; revision:number; input:Array<{stage:AuditStage;hash:string}>; output:unknown; outputHash:string; status:"PASS"|"BLOCKED"|"SKIPPED"; findings:ValidationFinding[]; failure:string|null; telemetry:{elapsedMs:number; event:string}; }
export interface AuditRun { version:string; scenario:string; title:string; mutation:AuditMutation; revision:number; sourceHash:string; status:"READY"|"BLOCKED"; firstFailure:AuditStage|null; proofHash:string; boundaries:AuditBoundary[]; scope:string[]; }
const clock="2026-09-27T12:00:00.000Z";
const auditProblem=(code:string,message:string,evidence:Record<string,unknown>={}):ValidationFinding=>({code,message,path:"/audit",severity:"ERROR",evidence});

export function createAuditFixtures(historicalText:string):AuditFixture[]{
  const basic=(id:string,count:number,format:CompetitionBlueprint["format"]):AuditFixture=>{
    const blueprint:CompetitionBlueprint={name:id,sport:"padel",participantUnit:"pairs",participantCount:count,resourceCount:2,resourceLabel:"courts",format,poolSize:null,qualifiersPerPool:null,minimumMatches:1,minimumRestMinutes:10,matchDurationMinutes:30,startsAt:"2026-09-27T09:00:00.000Z",endsAt:"2026-09-27T19:00:00.000Z",timezone:"Europe/London",priority:"finish_on_time",scoringPolicy:"head_to_head_total_score_no_draw",tiebreakPolicy:"wins_score_difference_score_for_manual",withdrawalPolicy:"preserve_played_walkover_future",drawPolicy:"seeded_input_order"};
    const original=JSON.stringify(blueprint,null,2);
    const definition=definitionFromConnectedBlueprint(blueprint,[{mode:"json",text:original}]);
    if(!definition)throw new Error("audit_fixture_definition_failed");
    return {id,title:format==="single_elimination"?"Simple knockout":"Six-pair round robin",source:{original,origin:`scenario/${id}/source.json`,basis:"Explicit synthetic acceptance fixture; all policies stated in source."},definition,facts:Object.entries(blueprint).map(([key,value])=>({path:`/${key}`,value,sourcePath:`/${key}`,sourceHash:canonicalHash(original)}))};
  };
  const source={mode:"json" as const,text:historicalText};
  const initial=analyseCompetitionSources([source],clock);
  const edits=[{id:"qualification",value:"top_four_konnect_remainder_tower"},{id:"scoring",value:"padel.timed.standard@1.0.0"},{id:"tiebreak",value:"wins_game_difference_games_won_head_to_head_manual"},{id:"normalisation",value:"percentage"},{id:"withdrawal",value:"preserve_played_walkover_future"},{id:"approval-authority",value:"separate_compiler_approver_publisher"},{id:"event-date",value:"2026-09-20"},{id:"timezone",value:"Europe/London"}];
  const preview=planWorkbenchEdit(initial,1,edits,"audit-fixture-author");
  const workbench=applyWorkbenchEdit(initial,preview,workbenchSourceDocument({mode:"json",text:JSON.stringify({edits,authority:"AUDIT_FIXTURE_DECISIONS_NOT_LIVE_APPROVAL"})},clock));
  const definition=definitionFromProductionLock(workbench),entrants=entrantsFromProductionLock(workbench);
  if(!definition||!entrants)throw new Error("historical_fixture_decisions_unresolved");
  return [basic("simple-knockout",8,"single_elimination"),basic("six-pair-round-robin",6,"round_robin"),{id:"play-konnect-reference",title:"St Albans historical planning candidate",source:{original:historicalText,origin:"apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json@71b7160b60295d8f43aba9ba51cd221dc8a4b146",basis:"Existing historical planning source. Date and policy decisions are explicit test-fixture assumptions; source audit claims are untrusted; results below are synthetic, not historical outcomes."},definition,entrants,workbench,facts:{facts:initial.understoodFacts,rules:initial.rules,untrustedClaims:initial.untrustedClaims,originalMissingDecisions:initial.missingDecisions,fixtureDecisions:edits}}];
}

/** Uses real core producers. No command in this observer approves or publishes a competition. */
export function runAuditScenario(fixture:AuditFixture,mutation:AuditMutation="none"):AuditRun{
  const boundaries:AuditBoundary[]=[];
  let firstFailure:AuditStage|null=null;
  const mark=<T>(stage:AuditStage,inputs:AuditStage[],produce:()=>T,check:(value:T)=>ValidationFinding[]=()=>[]):T|undefined=>{
    const input=inputs.map(name=>{const parent=boundaries.find(b=>b.stage===name);return {stage:name,hash:parent?.outputHash??canonicalHash(null)};});
    const start=performance.now();let output:unknown=null;let findings:ValidationFinding[]=[];
    let status:AuditBoundary["status"]="PASS";
    if(firstFailure)status="SKIPPED";
    else try{output=produce();findings=check(output as T);if(findings.some(f=>f.severity==="ERROR")){status="BLOCKED";firstFailure=stage;}}
    catch(error){status="BLOCKED";firstFailure=stage;findings=[auditProblem("AUDIT.STAGE_FAILED",error instanceof Error?error.message:"Unknown stage failure")];}
    boundaries.push({stage,revision:1,input,output:structuredClone(output),outputHash:canonicalHash(output),status,findings,failure:status==="PASS"?null:status==="SKIPPED"?`Blocked by ${firstFailure}`:findings.find(f=>f.severity==="ERROR")?.code??"AUDIT.STAGE_FAILED",telemetry:{elapsedMs:Math.round((performance.now()-start)*1000)/1000,event:`boundary_${status.toLowerCase()}`}});
    return status==="PASS"?output as T:undefined;
  };
  mark("SOURCE",[],()=>fixture.source);
  mark("FACTS",["SOURCE"],()=>fixture.facts);
  const spec=mark("DEFINITION",["FACTS"],()=>compileDefinition(structuredClone(fixture.definition),{specId:fixture.id,revision:1,schemaVersion:"1.0.0",compilerVersion:"1.0.0-audit",rulesetVersions:{competition:"1.0.0",padel:"1.0.0"},sourcePrompt:fixture.source.original,createdAt:clock}) as TournamentSpec,value=>[...validateTournamentSpec(value).findings]);
  const entrants=spec?(fixture.entrants??createEntrants(spec)):{};
  const graph=mark("GRAPH",["DEFINITION"],()=>buildCompetitionGraph(spec!,entrants),value=>value.findings);
  const classification=mark("CLASSIFICATION",["GRAPH","DEFINITION"],()=>{
    const results:ContestResult[]=(graph?.nodes??[]).filter(n=>n.kind==="contest"&&n.slots.every(s=>s.type==="entrant")).map(node=>{
      const ids=node.slots.map(s=>s.type==="entrant"?s.entrantId:"") as [string,string];const sorted=[...ids].sort();
      return {contestId:node.id,entrants:ids,winnerId:sorted[0]!,loserId:sorted[1]!,scoreFor:ids[0]===sorted[0]?[12,5]:[5,12],status:"completed"};
    });
    const standings:Record<string,Standing[]>={};const findings:ValidationFinding[]=[];
    for(const policy of spec!.standingsPolicies){const result=calculateStandings(graph!.nodes,results,policy);findings.push(...result.findings);for(const stage of policy.stageIds)standings[stage]=result.standings.filter(r=>graph!.nodes.some(n=>n.stageId===stage&&n.poolId===r.poolId));}
    return {resultsOrigin:"SYNTHETIC_TRANSITIVE_RESULTS_FOR_AUDIT_ONLY",results,standings,findings};
  },value=>value.findings);
  const qualification=mark("QUALIFICATION",["CLASSIFICATION","DEFINITION"],()=>{
    const q=qualify(spec!,classification!.standings,entrants);
    if(mutation==="qualification"){
      const destination=Object.keys(q.byStructure)[0]??"forged.destination";
      if(q.byStructure[destination]?.length)q.byStructure[destination]![0]={...q.byStructure[destination]![0]!,id:"forged.non-qualifier"};
      else q.byStructure[destination]=[{id:"forged.non-qualifier",divisionId:"open",memberIds:[]}];
    }
    return q;
  },value=>[...value.findings,...assureQualification(spec!,classification!.standings,entrants,value)]);
  mark("SEED",["QUALIFICATION"],()=>({implementationNote:"Observable projection of current core assignment. Qualification and seeding production are still coupled; Phase B must reconcile this.",assignments:Object.fromEntries(Object.entries(qualification!.byStructure).map(([id,entries])=>[id,entries.map(e=>({entrantId:e.id,seed:e.seed??null}))]))}));
  mark("TOPOLOGY",["DEFINITION","GRAPH"],()=>({implementationNote:"Structural projection, before occupant placement; Phase B establishes full topology properties.",stages:spec!.stages.filter(s=>s.bracket).map(s=>({stageId:s.id,bracket:s.bracket,slots:2**Math.ceil(Math.log2(s.bracket!.entrantCount)),byes:2**Math.ceil(Math.log2(s.bracket!.entrantCount))-s.bracket!.entrantCount}))}));
  const draw=mark("DRAW",["GRAPH","QUALIFICATION","SEED","TOPOLOGY"],()=>{
    const result=buildCompetitionGraph(spec!,entrants,qualification!.byStructure);
    if(mutation==="draw"){
      const node=result.nodes.find(n=>spec!.stages.some(s=>s.id===n.stageId&&s.bracket)&&n.slots.every(s=>s.type==="entrant"))??result.nodes.find(n=>n.slots.every(s=>s.type==="entrant"));
      if(node)node.slots[1]=structuredClone(node.slots[0]);
    }
    return result;
  },value=>[...value.findings,...assureDraw(spec!,value,entrants,qualification!)]);
  const schedule=mark("SCHEDULE",["DRAW","DEFINITION"],()=>{
    const result=fixture.workbench?verifiedScheduleFromProductionLock(fixture.workbench,spec!,draw!):solveSchedule(spec!,draw!);
    if(!result)throw new Error("SOURCE_SCHEDULE_MAPPING_FAILED");
    if(mutation==="schedule"&&result.contests.length>1){const one=result.contests[0]!,two=result.contests[1]!;two.resourceId=one.resourceId;two.start=one.start;two.end=one.end;}
    return result;
  },value=>[...value.findings,...validateSchedule(spec!,draw!,value),...(["FEASIBLE","OPTIMAL"].includes(value.audit.status)?[]:[auditProblem("AUDIT.SOLVER_NOT_FEASIBLE",`Solver returned ${value.audit.status}; no publication readiness inferred.`)])]);
  if(firstFailure){
    const findings=boundaries.flatMap(b=>b.findings.filter(f=>f.severity==="ERROR"));
    const output={status:"BLOCKED",blockedBy:firstFailure,findings,committed:false};
    boundaries.push({stage:"GUARD",revision:1,input:boundaries.map(b=>({stage:b.stage,hash:b.outputHash})),output,outputHash:canonicalHash(output),status:"BLOCKED",findings,failure:`Blocked by ${firstFailure}`,telemetry:{elapsedMs:0,event:"guard_blocked"}});
  }else mark("GUARD",["DEFINITION","DRAW","SCHEDULE","QUALIFICATION"],()=>evaluateCompetitionGuard({sourceDefinitionHash:canonicalHash(spec!),spec:spec!,graph:draw!,schedule:schedule!}),value=>value.status==="PASSED"?[]:value.findings.filter(f=>f.publicationDisposition==="BLOCK").map(f=>auditProblem(f.sourceCode,f.message,{path:f.path,...f.evidence})));
  const scope=["Observer only: no publication or authoritative mutation.","Seed/topology projections expose current boundaries; Phase B fairness gate is not claimed.","Historical source is a planning candidate; fixture decisions and synthetic results are disclosed.","Qualification verifier supports the declared audit selectors only; unsupported semantics block."];
  const identity={version:AUDIT_VERSION,scenario:fixture.id,title:fixture.title,mutation,revision:1,sourceHash:canonicalHash(fixture.source),status:firstFailure?"BLOCKED" as const:"READY" as const,firstFailure,scope};
  return {...identity,boundaries,proofHash:auditProofHash({...identity,boundaries})};
}
export function auditProofHash(run:Omit<AuditRun,"proofHash">|AuditRun):string{
  return canonicalHash({version:run.version,scenario:run.scenario,title:run.title,scope:run.scope,revision:run.revision,sourceHash:run.sourceHash,mutation:run.mutation,status:run.status,firstFailure:run.firstFailure,boundaries:run.boundaries.map(({telemetry,...boundary})=>boundary)});
}
export function verifyAuditRun(run:AuditRun):ValidationFinding[]{
  const findings:ValidationFinding[]=[];
  if(run.proofHash!==auditProofHash(run))findings.push(auditProblem("AUDIT.EVIDENCE_MISMATCH","Audit envelope no longer matches its proof hash."));
  const seen=new Map<AuditStage,string>();
  if(run.sourceHash!==run.boundaries.find(b=>b.stage==="SOURCE")?.outputHash)findings.push(auditProblem("AUDIT.SOURCE_BINDING","Source identity does not match the recorded source artefact."));
  const failed=run.boundaries.find(b=>b.status==="BLOCKED");
  if((failed?.stage??null)!==run.firstFailure||(failed?"BLOCKED":"READY")!==run.status)findings.push(auditProblem("AUDIT.STATUS_MISMATCH","Reported readiness does not match boundary outcomes."));
  if(run.boundaries.map(b=>b.stage).join("|")!==AUDIT_STAGES.join("|"))findings.push(auditProblem("AUDIT.PIPELINE_SHAPE","Pipeline boundaries are missing, duplicated or out of order."));
  for(const boundary of run.boundaries){
    if(boundary.revision!==run.revision||boundary.outputHash!==canonicalHash(boundary.output)||boundary.input.some(i=>seen.get(i.stage)!==i.hash))findings.push(auditProblem("AUDIT.BOUNDARY_MISMATCH",`Boundary ${boundary.stage} has stale or altered artefacts.`));
    seen.set(boundary.stage,boundary.outputHash);
  }
  return findings;
}

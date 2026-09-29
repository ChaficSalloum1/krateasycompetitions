import {canonicalHash} from "@tournament-os/tournament-schema";
import {dependencyPaths} from "./rule-catalog.js";
import type {Interpretation} from "./interpretation.js";
import type {compileInterpretation} from "./definition.js";

export const REQUIREMENT_MODEL_VERSION="competition-requirements/1.0.0";
export type RequirementState="KNOWN"|"PROPOSED"|"MISSING"|"CONFLICT"|"UNSUPPORTED"|"INVALID"|"WAITING"|"NOT_APPLICABLE"|"UNRESOLVED"|"NOT_EVALUATED";
export type RequirementBoundary="DRAFT_REVIEW"|"DEFINITION_LOCK"|"PLAN_PUBLICATION"|"RUNTIME";
export const REQUIREMENT_GROUPS=[
  {id:"identity",label:"Competition & divisions",owner:"CompetitionDefinition",fields:["title","sport","label","format"]},
  {id:"entries",label:"Participants, pairs & pools",owner:"CompetitionDefinition",fields:["entrants","poolSizes"]},
  {id:"results",label:"Scoring & tied results",owner:"StandingPolicy / MatchFormat",fields:["scoring","tiebreak"]},
  {id:"progression",label:"Who advances & where",owner:"QualificationPolicy",fields:["qualification","places","runnersUp","comparison","remainder","cup","secondaryCup"]},
  {id:"draw",label:"Brackets, seeds & byes",owner:"PlacementPolicy",fields:["protectedSeeds","bracketSlots","byePolicy","rematches","secondaryBracketSlots","secondaryProtectedSeeds","secondaryByePolicy","secondaryRematches"]},
  {id:"resources",label:"Courts, time & breaks",owner:"ResourceCommitment / SchedulingPolicy",fields:["duration","rest","courts","start","end","timezone"]},
  {id:"source",label:"Statements to clarify",owner:"Interpretation",fields:[]},
  {id:"assurance",label:"Approval & independent checks",owner:"RunAssurance / TournamentGuard",fields:[]},
  {id:"reality",label:"Results, incidents & recovery",owner:"CompetitionRuntime",fields:[]}
] as const;
export type RequirementGroup=typeof REQUIREMENT_GROUPS[number]["id"];
export interface RequirementItem {
  id:string;group:RequirementGroup;label:string;path:string|null;
  pack:"common/1"|"format/1"|"padel-pairs/1";owner:string;boundary:RequirementBoundary;
  state:RequirementState;reason:string;dependsOn:string[];factIds:string[];findingCodes:string[];
}
// This is a lifecycle coverage inventory. These obligations are NEVER treated as passed
// merely because draft fields are present, the compiler returns, or review is clicked.
const later:ReadonlyArray<Omit<RequirementItem,"state"|"factIds"|"findingCodes"|"dependsOn"|"path">>=[
  {id:"roster-identity",group:"entries",label:"Accepted entries, person identities and eligibility",pack:"common/1",owner:"EntryDecision",boundary:"DEFINITION_LOCK",reason:"Counts and illustrative pairs do not establish an approved roster, eligibility or shared-person collision coverage."},
  {id:"sport-semantics",group:"results",label:"Complete sport and exceptional-result rules",pack:"padel-pairs/1",owner:"MatchFormat",boundary:"DEFINITION_LOCK",reason:"The current adapter supports total games with no draw. Serving rules, end-of-time ties, walkovers, retirements and no-shows are not fully specified by that choice."},
  {id:"standing-seeding",group:"draw",label:"Qualification, seed assignment and draw proof",pack:"format/1",owner:"Qualification / SeedAssignment / RunAssurance",boundary:"PLAN_PUBLICATION",reason:"A bracket picture is empty topology. Selected entries, cross-pool ties, seed order, byes and avoidable rematches require independent evidence."},
  {id:"definition-assurance",group:"assurance",label:"Independent definition assurance and approval",pack:"common/1",owner:"RunAssurance / TournamentGuard",boundary:"DEFINITION_LOCK",reason:"Requires independent entrant accounting, destination capacity, stage completeness, unsupported-semantics and cycle checks on the exact approved revision."},
  {id:"schedule-assurance",group:"resources",label:"Schedule feasibility and resource permission",pack:"common/1",owner:"Scheduler / RunAssurance",boundary:"PLAN_PUBLICATION",reason:"Requires authorised court windows, all contests exactly once, possible-player collisions, rest, dependencies and protected locks. Solver timeout is not proof of impossibility."},
  {id:"schedule-editing",group:"resources",label:"Move matches and set division-wide breaks",pack:"common/1",owner:"CompetitionPlan",boundary:"PLAN_PUBLICATION",reason:"Not available in this creator. A move or division break must produce a candidate revision, show affected matches, pass independent checks and receive approval before replacing the plan."},
  {id:"revision-guard",group:"assurance",label:"Fresh Guard evidence for publication or changes",pack:"common/1",owner:"TournamentGuard",boundary:"PLAN_PUBLICATION",reason:"Server-owned exact artefacts, authorised actor and current revision are required. Blocked commands commit nothing; local draft review is not publication."},
  {id:"runtime-truth",group:"reality",label:"Result transitions, corrections and replay",pack:"common/1",owner:"CompetitionRuntime",boundary:"RUNTIME",reason:"Results and corrections require append-only lineage, legal transitions, idempotency, rule-version binding and replay evidence."},
  {id:"repair-truth",group:"reality",label:"Disruption repair and protected played history",pack:"common/1",owner:"Recovery / TournamentGuard",boundary:"RUNTIME",reason:"Court closures, withdrawals, overruns and corrections must preserve played truth and protect in-progress contests while repairing only justified future scope."}
];

export function buildRequirementReport(p:Interpretation,c:ReturnType<typeof compileInterpretation>){
  const findings=[...c.findings,...c.validation.filter(f=>f.severity==="ERROR"&&f.code!=="TSC602")];
  const items:RequirementItem[]=p.coverage.map(row=>{
    const group=REQUIREMENT_GROUPS.find(g=>(g.fields as readonly string[]).includes(row.ruleId));
    if(!group)throw new Error(`Unregistered requirement concept: ${row.ruleId}`);
    const dependsOn=dependencyPaths(row.ruleId,row.path,p.draft);
    const waiting=dependsOn.filter(path=>p.coverage.some(r=>r.path===path&&(r.status==="MISSING"||r.status==="CONFLICT"))||findings.some(f=>f.path===path));
    const errors=findings.filter(f=>f.path===row.path);
    let state:RequirementState=row.status==="SOURCE"||row.status==="ANSWER"?"KNOWN":row.status==="DEFAULT"||row.status==="UNSET_OPTIONAL"?"PROPOSED":row.status;
    if((state==="NOT_APPLICABLE"||state==="MISSING")&&waiting.length)state="WAITING";
    if(errors.length)state=errors.some(f=>f.code==="UNSUPPORTED")?"UNSUPPORTED":"INVALID";
    return {id:row.path,group:group.id,label:row.noun,path:row.path,pack:row.ruleId==="sport"||row.ruleId==="scoring"?"padel-pairs/1":group.id==="draw"||group.id==="progression"?"format/1":"common/1",owner:group.owner,boundary:"DRAFT_REVIEW",state,
      reason:errors.length?errors.map(f=>f.message).join(" "):state==="CONFLICT"?p.conflicts.find(conflict=>conflict.path===row.path)?.quotes.join(" / ")??row.reason:state==="WAITING"?`First resolve: ${waiting.map(path=>p.coverage.find(item=>item.path===path)?.noun??path).join(", ")}.`:row.reason,dependsOn,factIds:[...row.factIds],findingCodes:errors.map(f=>f.code)};
  });
  for(const decision of p.decisions.filter(d=>d.id.startsWith("unparsed-")))items.push({id:decision.id,group:"source",label:"Unrecognised statement",path:decision.path,pack:"common/1",owner:"Interpretation",boundary:"DRAFT_REVIEW",state:"UNRESOLVED",reason:decision.why,dependsOn:[],factIds:[],findingCodes:[]});
  for(const [index,failure] of p.failures.entries())items.push({id:`source-failure-${index}`,group:"source",label:"Source cannot be used",path:"source",pack:"common/1",owner:"SourceIntake",boundary:"DRAFT_REVIEW",state:"INVALID",reason:failure,dependsOn:[],factIds:[],findingCodes:["SOURCE_UNREADABLE"]});
  // Resource/membership/graph findings do not always belong to a scalar draft field.
  for(const [index,f] of findings.entries())if(!items.some(item=>item.path===f.path&&item.findingCodes.includes(f.code)))items.push({id:`finding-${index}`,group:"assurance",label:"Draft finding",path:f.path,pack:"common/1",owner:"DefinitionCompiler",boundary:"DRAFT_REVIEW",state:f.code==="UNSUPPORTED"?"UNSUPPORTED":"INVALID",reason:f.message,dependsOn:[],factIds:[],findingCodes:[f.code]});
  const spec=c.spec;
  const profile=spec?[
    `Entry unit: ${spec.sport.participantUnit}; team size: ${spec.sport.teamSize}`,
    ...spec.stages.flatMap(stage=>[
      ...(stage.pool?[`${stage.label}: ${stage.pool.rounds} round-robin cycle(s), ${stage.pool.allocation} pool allocation`]:[]),
      ...(stage.bracket?[`${stage.label}: third-place match ${stage.bracket.thirdPlaceMatch?"included":"not included"}`]:[])
    ]),
    ...spec.scheduling.durations.map(duration=>`${duration.stageId}: ${duration.contestMinutes} minutes play, ${duration.turnaroundMinutes} minutes turnaround`),
    `Scheduling preference: ${spec.scheduling.objective}; randomisation: ${spec.randomisation.mode}`
  ].join(". "):"Complete the required draft rules to inspect the compiled profile.";
  items.push({id:"compiler-profile",group:"identity",label:"Built-in compiler profile",path:null,pack:"common/1",owner:"DefinitionCompiler",boundary:"DRAFT_REVIEW",state:spec?"PROPOSED":"NOT_EVALUATED",reason:profile+". These are current compiled settings, not independently assured results. Settings without an editor are not customisable here.",dependsOn:[],factIds:[],findingCodes:[]});
  items.push(...later.map(item=>({...item,path:null,state:"NOT_EVALUATED" as const,dependsOn:[],factIds:[],findingCodes:[]})));
  const report={version:REQUIREMENT_MODEL_VERSION,catalogVersion:p.ruleCatalogVersion,revision:p.revision,sourceHash:p.sourceHash,interpretationHash:p.hash,
    authority:"NON_AUTHORITATIVE_COVERAGE" as const,canPublish:false as const,items};
  return {...report,hash:canonicalHash(report)};
}

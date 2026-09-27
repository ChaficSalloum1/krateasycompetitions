import {applyOperations,type OperationsEdit} from "./operations.js";
import {applyMembership,membershipViews,type MembershipEdit} from "./membership.js";
import { canonicalHash, compileDefinition, validateTournamentSpec, type TournamentDefinition, type TournamentSpec, type QualificationSelector, type ValidationFinding } from "@tournament-os/tournament-schema";
import { buildCompetitionGraph, createEntrants } from "../../../../packages/competition-engine/src/graph.js";
import type { Draft, DivisionDraft, Interpretation } from "./interpretation.js";

export function qualifierCount(d:DivisionDraft):number {
  if(d.format!=="pools_knockout")return Number(d.entrants??0);
  if(d.qualification==="top_per_pool")return (Array.isArray(d.poolSizes)?d.poolSizes.length:0)*Number(d.places??0)+Number(d.runnersUp??0);
  return Number(d.places??0);
}
export interface DraftFinding {code:string;path:string;message:string;}
export function inspectDraft(draft:Draft):DraftFinding[]{
  const findings:DraftFinding[]=[];
  const add=(code:string,path:string,message:string)=>findings.push({code,path,message});
  const integer=(path:string,value:unknown,min:number,max:number)=>{if(value!==null&&(!Number.isInteger(value)||Number(value)<min||Number(value)>max))add("INVALID_VALUE",path,`Must be a whole number from ${min} to ${max}.`);};
  if(draft.sport!==null&&draft.sport!=="padel")add("UNSUPPORTED","sport","This review envelope supports padel pair entries only.");
  integer("duration",draft.duration,1,240);integer("rest",draft.rest,0,240);integer("courts",draft.courts,1,64);
  for(const field of ["start","end"] as const)if(draft[field]!==null&&(typeof draft[field]!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(draft[field]!)||!Number.isFinite(Date.parse(draft[field]!))))add("INVALID_TIME",field,"Use a complete ISO date/time with an explicit UTC offset.");
  if(draft.start&&draft.end&&Date.parse(draft.end)<=Date.parse(draft.start))add("RESOURCE_WINDOW","end","Court availability must end after it starts.");
  if(draft.timezone!==null)try{new Intl.DateTimeFormat("en",{timeZone:draft.timezone});}catch{add("INVALID_TIMEZONE","timezone","Use a valid IANA timezone, for example Europe/London.");}
  if(draft.scoring!==null&&draft.scoring!=="total_games_no_draw")add("UNSUPPORTED","scoring","The supplied scoring semantics have no registered preview adapter.");
  if(draft.tiebreak!==null&&draft.tiebreak!=="wins_difference_for_manual")add("UNSUPPORTED","tiebreak","The supplied tiebreak semantics have no registered preview adapter.");
  draft.divisions.forEach((d,i)=>{
    const p=`divisions.${i}.`;integer(p+"entrants",d.entrants,2,64);
    if(d.format!==null&&!["pools_knockout","knockout","round_robin"].includes(d.format))add("UNSUPPORTED",p+"format","This format remains explicit unsupported semantics.");
    if(d.format==="pools_knockout"){
      if(d.poolSizes!==null){
        if(!Array.isArray(d.poolSizes)||d.poolSizes.length<1||d.poolSizes.length>16||d.poolSizes.some(n=>!Number.isInteger(n)||n<2||n>16))add("INVALID_POOLS",p+"poolSizes","Use 1–16 pools with 2–16 entries each.");
        else if(d.entrants!==null&&d.poolSizes.reduce((a,b)=>a+b,0)!==d.entrants)add("ENTRANT_ACCOUNTING",p+"poolSizes",`${d.poolSizes.reduce((a,b)=>a+b,0)} pool places for ${d.entrants} entries.`);
      }
      integer(p+"places",d.places,1,64);integer(p+"runnersUp",d.runnersUp,0,16);
      if(d.qualification!==null&&!["top_per_pool","best_overall","winner_priority"].includes(d.qualification))add("UNSUPPORTED",p+"qualification","Unknown qualification policy.");
      if(d.comparison!==null&&!["percentage","raw"].includes(d.comparison))add("UNSUPPORTED",p+"comparison","Unknown cross-pool comparison policy.");
      if(d.remainder!==null&&!["secondary","eliminated"].includes(d.remainder))add("INVALID_DESTINATION",p+"remainder","Choose a second cup or explicit elimination.");
      if(Array.isArray(d.poolSizes)&&d.qualification==="top_per_pool"&&d.places!==null){
        if(d.poolSizes.some(n=>n<d.places!))add("QUALIFICATION_CARDINALITY",p+"places","At least one pool has fewer entries than the requested qualifying places.");
        if(d.runnersUp!==null&&d.runnersUp>d.poolSizes.filter(n=>n>d.places!).length)add("QUALIFICATION_CARDINALITY",p+"runnersUp","There are not enough eligible next-placed entries for those wildcard places.");
      }
      if(d.qualification==="winner_priority"&&Array.isArray(d.poolSizes)&&d.places!==null&&d.places>d.poolSizes.length*2)add("QUALIFICATION_CARDINALITY",p+"places","Winners plus runners-up cannot fill this many places.");
      const count=qualifierCount(d);
      if(d.places!==null&&d.entrants!==null&&(count<2||count>d.entrants))add("QUALIFICATION_CARDINALITY",p+"places",`${count} qualifiers from ${d.entrants} entries is not a valid knockout field.`);
      if(d.remainder==="secondary"&&d.entrants!==null&&d.places!==null&&d.entrants-count<2)add("DESTINATION_CARDINALITY",p+"remainder",`The second cup would receive ${d.entrants-count} entries; it needs at least two.`);
    }
    const count=qualifierCount(d);
    if(d.bracketSlots!==null){integer(p+"bracketSlots",d.bracketSlots,2,64);if(count>d.bracketSlots)add("CARDINALITY_MISMATCH",p+"bracketSlots",`${count} qualifiers, ${d.bracketSlots} destination slots: ${count-d.bracketSlots} entries have no valid destination.`);else if((d.bracketSlots&(d.bracketSlots-1))!==0)add("INVALID_BRACKET",p+"bracketSlots","Bracket slot capacity must be a power of two.");else if(count>=2&&d.bracketSlots!==2**Math.ceil(Math.log2(count)))add("UNSUPPORTED",p+"bracketSlots","Extra empty opening contests are not supported; choose the smallest fitting bracket.");}
    if(d.protectedSeeds!==null&&![2,4].includes(d.protectedSeeds))add("UNSUPPORTED",p+"protectedSeeds","Choose top 2 or top 4 protected seeds.");
    if(d.byePolicy!==null&&d.byePolicy!=="highest_seeds")add("UNSUPPORTED",p+"byePolicy","This envelope supports highest-seed byes.");
    if(d.rematches!==null&&!["avoid","allow"].includes(d.rematches))add("UNSUPPORTED",p+"rematches","Choose an explicit rematch policy.");
    for(const field of ["label","cup","secondaryCup"] as const)if(d[field]!==null&&(typeof d[field]!=="string"||!d[field]!.trim()||d[field]!.length>120))add("INVALID_LABEL",p+field,"Use a nonempty name up to 120 characters.");
  });
  return findings;
}
export function definitionFromDraft(draft:Draft,sourceHash:string):TournamentDefinition{
  const definition:TournamentDefinition={sport:{id:"padel",adapterVersion:"1.0.0",participantUnit:"pair",teamSize:2,contest:{kind:"head_to_head",sides:2},scoringCapabilities:["games"],defaultResourceType:"court"},
    participants:{count:draft.divisions.reduce((n,d)=>n+d.entrants!,0),shape:"pair",rosterSize:2},divisions:[],stages:[],scoringSystems:[],standingsPolicies:[],qualificationPolicies:[],competitionStructures:[],drawPolicies:[],progressionPolicies:[],
    scheduling:{timezone:draft.timezone!,start:draft.start!,finishBy:draft.end!,constraints:[{id:"rest",rule:"minimum_rest",strength:"HARD",value:draft.rest!,unit:"minutes"},{id:"overlap",rule:"participant_cannot_play_two_contests_simultaneously",strength:"HARD",value:true,unit:"boolean"}],durations:[],objective:"balanced_quality"},
    resources:[{id:"committed.courts",type:"court",quantity:draft.courts!,availability:[{start:draft.start!,end:draft.end!}]}],operationalPolicies:[],randomisation:{mode:"none"},assumptions:[],requirements:[]};
  for(const d of draft.divisions){
    const stageIds:string[]=[];
    const addKnockout=(suffix:string,count:number,label:string,secondary=false)=>{
      const id=`${d.id}.${suffix}`,structure=`${id}.structure`;stageIds.push(id);
      definition.stages.push({id,label,divisionId:d.id,primitive:secondary?"consolation":"single_elimination",inputShape:"pair",outputShape:"pair",expectedEntrants:count,bracket:{entrantCount:count,topology:(count&(count-1))===0?"power_of_two":"byes",thirdPlaceMatch:false}});
      if(d.format==="pools_knockout")definition.competitionStructures.push({id:structure,label,divisionId:d.id,targetEntrants:count,stageIds:[id]});
      if(d.format==="pools_knockout")definition.drawPolicies.push({id:`${id}.draw`,structureId:structure,placement:"optimised",protectedSeedCount:d.protectedSeeds as 2|4,priorities:[{rule:"protected_byes",strength:"HARD",priority:1},{rule:"protected_seed_separation",strength:"HARD",priority:2},...(d.rematches==="avoid"?[{rule:"avoid_opening_round_pool_rematch",strength:"SOFT" as const,priority:3},{rule:"avoid_opening_round_rematch",strength:"SOFT" as const,priority:4}]:[])]});
      return structure;
    };
    if(d.format==="knockout")addKnockout("main",d.entrants!,d.cup??"Main bracket");
    else {
      const id=`${d.id}.pools`;stageIds.push(id);
      definition.stages.push({id,label:`${d.label} pools`,divisionId:d.id,primitive:d.format==="round_robin"?"single_round_robin":"groups",inputShape:"pair",outputShape:"pair",expectedEntrants:d.entrants!,pool:{poolCount:d.format==="round_robin"?1:d.poolSizes!.length,sizes:d.format==="round_robin"?[d.entrants!]:d.poolSizes!,rounds:1,allocation:"snake"}});
      definition.standingsPolicies.push({id:`${d.id}.standings`,stageIds:[id],metricOrder:[{metric:"wins",direction:"DESC"},{metric:"score_difference",direction:"DESC"},{metric:"score_for",direction:"DESC"}],tieFallback:"manual_decision"});
      if(d.format==="pools_knockout"){
        const count=qualifierCount(d),destination=addKnockout("main",count,d.cup!);
        let selectors:QualificationSelector[];
        if(d.qualification==="top_per_pool")selectors=[...Array.from({length:d.places!},(_,index)=>({type:"pool_position" as const,position:index+1})),...(d.runnersUp!>0?[{type:"best_n_across_pools" as const,count:d.runnersUp!,poolPosition:d.places!+1}]:[])];
        else if(d.qualification==="winner_priority")selectors=[{type:"best_n_across_pools",count:Math.min(count,d.poolSizes!.length),poolPosition:1},...(count>d.poolSizes!.length?[{type:"best_n_across_pools" as const,count:count-d.poolSizes!.length,poolPosition:2}]:[])];
        else selectors=[{type:"best_n_across_pools",count}];
        definition.qualificationPolicies.push({id:`${d.id}.qual.main`,sourceStageId:id,destinationStructureId:destination,outputCount:count,selectors,...(d.comparison==="percentage"?{normalization:"percentage" as const}:{})});
        if(d.remainder==="secondary"){
          const remaining=d.entrants!-count,target=addKnockout("secondary",remaining,d.secondaryCup!,true);
          definition.qualificationPolicies.push({id:`${d.id}.qual.secondary`,sourceStageId:id,destinationStructureId:target,outputCount:remaining,selectors:[{type:"remainder"}],...(d.comparison==="percentage"?{normalization:"percentage" as const}:{})});
        }
      }
    }
    definition.divisions.push({id:d.id,label:d.label,participantCount:d.entrants!,participantShape:"pair",stageIds});
  }
  definition.scoringSystems=[{id:"scoring",adapterRule:"generic.head-to-head.total-score-no-draw",version:"1.0.0",stageIds:definition.stages.map(s=>s.id)}];
  definition.scheduling.durations=definition.stages.map(s=>({stageId:s.id,contestMinutes:draft.duration!,turnaroundMinutes:0}));
  definition.assumptions=[...definition.qualificationPolicies.map(p=>`/qualificationPolicies/${p.id}`),...definition.standingsPolicies.map(p=>`/standingsPolicies/${p.id}`),...definition.drawPolicies.map(p=>`/drawPolicies/${p.id}`)].map((rulePath,i)=>({id:`source.${i}`,rulePath,origin:"conversation_clarification",knowledge:"KNOWN",sourceReference:sourceHash,approved:false,critical:true}));
  return definition;
}
export function compileInterpretation(proposal:Interpretation,membership:MembershipEdit[] = [],operations:OperationsEdit|null = null){
  const findings=inspectDraft(proposal.draft);
  for(const entry of proposal.roster)if(entry.memberIds.length!==2)findings.push({code:"ROSTER_SHAPE",path:`roster.${entry.id}`,message:`${entry.displayName} must contain exactly two member identities for a padel pair.`});
  for(const division of proposal.draft.divisions)if(proposal.roster.length&&proposal.roster.filter(e=>e.divisionId===division.id).length!==division.entrants)findings.push({code:"ROSTER_ACCOUNTING",path:`divisions.${proposal.draft.divisions.indexOf(division)}.entrants`,message:"Entry count differs from the imported roster; revise the source roster rather than silently adding or dropping identities."});
  if(proposal.failures.length||findings.length||proposal.decisions.length)return {status:proposal.failures.length||findings.length?"BLOCKED" as const:"NEEDS_DECISION" as const,findings,spec:null,graph:null,validation:[] as ValidationFinding[]};
  const definition=definitionFromDraft(proposal.draft,proposal.sourceHash);
  // Proposal compilation is not LOCK_DEFINITION; the source assumption deliberately remains unapproved.
  let spec=compileDefinition(definition,{specId:"creator.draft",revision:proposal.revision,schemaVersion:"1.0.0",compilerVersion:"1.0.0-creator",rulesetVersions:{padel:"1.0.0",competition:"1.0.0"},sourcePrompt:proposal.sourceHash,createdAt:"2026-09-27T00:00:00Z"}) as TournamentSpec;
  const entries=proposal.roster.length?Object.fromEntries(spec.divisions.map(d=>[d.id,proposal.roster.filter(e=>e.divisionId===d.id).map(e=>({...e,memberIds:[...e.memberIds]}))])):createEntrants(spec);
  try { applyMembership(definition,entries,membership); }
  catch(error){return {status:"BLOCKED" as const,findings:[...findings,{code:"MEMBERSHIP_INVALID",path:"membership",message:String(error instanceof Error?error.message:error)}],spec:null,graph:null,validation:[] as ValidationFinding[]};}
  try {if(operations)applyOperations(definition,operations,buildCompetitionGraph(spec,entries));}
  catch(error){return {status:"BLOCKED" as const,findings:[...findings,{code:"OPERATIONS_INVALID",path:"operations",message:String(error instanceof Error?error.message:error)}],spec:null,graph:null,validation:[] as ValidationFinding[]};}
  if(membership.length||operations)spec=compileDefinition(definition,{...spec.metadata, specId:"creator.draft",revision:proposal.revision,schemaVersion:"1.0.0",compilerVersion:"1.0.0-creator",rulesetVersions:{padel:"1.0.0",competition:"1.0.0"},sourcePrompt:proposal.sourceHash,createdAt:"2026-09-27T00:00:00Z"}) as TournamentSpec;
  const validation=validateTournamentSpec(spec);
  const blocking=validation.findings.filter(f=>f.severity==="ERROR" && f.code!=="TSC602");
  const graph=blocking.length?null:buildCompetitionGraph(spec,entries);
  const allValidation=[...validation.findings,...(graph?.findings??[])];
  return {status:blocking.length||graph?.findings.some(f=>f.severity==="ERROR")?"BLOCKED" as const:"PROPOSED" as const,findings,spec,graph,validation:allValidation,hash:canonicalHash({spec,graph}),memberships:membershipViews(spec,entries)};
}

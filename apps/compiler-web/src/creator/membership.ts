import { canonicalHash, type TournamentDefinition, type TournamentSpec, type PoolConfiguration } from "@tournament-os/tournament-schema";
import { allocateStagePools } from "../../../../packages/competition-engine/src/pool-allocation.js";
import type { Entrant } from "../../../../packages/competition-engine/src/types.js";
export interface MembershipEdit {
  stageId:string; basisHash:string;
  definitionRules:NonNullable<PoolConfiguration["membershipConstraints"]>;
  planAssignments:{entrantId:string;poolId:string}[];
}
export function membershipBasis(stage: TournamentDefinition["stages"][number],entries:readonly Entrant[]) {
  return canonicalHash({stageId:stage.id,divisionId:stage.divisionId,poolSizes:stage.pool?.sizes,entries:entries.map(e=>({id:e.id,divisionId:e.divisionId,memberIds:[...e.memberIds].sort()})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function applyMembership(definition:TournamentDefinition,entries:Record<string,Entrant[]>,edits:MembershipEdit[]) {
  for(const edit of edits){
    if(!Array.isArray(edit.definitionRules)||!Array.isArray(edit.planAssignments))throw new Error("Membership rules and assignments must be explicit arrays.");
    const stage=definition.stages.find(s=>s.id===edit.stageId);
    if(!stage?.pool || edit.basisHash!==membershipBasis(stage,entries[stage.divisionId]??[]))throw new Error("Saved pool membership is stale. Clear it explicitly or restore its roster and pool sizes.");
    const roster=entries[stage.divisionId]!;
    if(edit.planAssignments.length!==roster.length || new Set(edit.planAssignments.map(a=>a.entrantId)).size!==roster.length || edit.planAssignments.some(a=>!roster.some(e=>e.id===a.entrantId)))throw new Error("Pool assignments must cover the exact roster once.");
    const mapped=roster.map(entry=>({...entry,poolId:edit.planAssignments.find(a=>a.entrantId===entry.id)!.poolId}));
    const result=allocateStagePools({stageId:stage.id,allocation:"manual",sizes:stage.pool.sizes,entrants:mapped,randomisation:{mode:"deterministic",seed:"creator-membership",algorithm:"pcg32"},membershipConstraints:edit.definitionRules});
    if(result.status!=="ALLOCATED")throw new Error(result.findings.map(f=>f.message).join(" "));
    stage.pool={...stage.pool,allocation:"manual",membershipConstraints:structuredClone(edit.definitionRules)};
    entries[stage.divisionId]=mapped;
  }
}
export function membershipViews(spec:TournamentSpec,entries:Record<string,Entrant[]>) {
  return spec.stages.filter(s=>s.pool).map(stage=>{
    const roster=entries[stage.divisionId]??[];
    const result=allocateStagePools({stageId:stage.id,allocation:stage.pool!.allocation,sizes:stage.pool!.sizes,entrants:roster,randomisation:spec.randomisation,...(stage.pool!.membershipConstraints?{membershipConstraints:stage.pool!.membershipConstraints}:{})});
    return {stageId:stage.id,label:stage.label,basisHash:membershipBasis(stage,roster),definitionRules:stage.pool!.membershipConstraints??[],planAssignments:result.pools.flatMap((pool,i)=>pool.map(e=>({entrantId:e.id,poolId:`${stage.id}.P${i+1}`}))),pools:result.pools.map((pool,i)=>({id:`${stage.id}.P${i+1}`,entries:pool}))};
  });
}

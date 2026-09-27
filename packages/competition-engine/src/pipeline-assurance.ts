import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, Entrant, QualificationResult, Standing } from "./types.js";
import { independentlyValidateAdvancementPaths } from "./guard-path-reconstruction.js";

const problem = (code: string, path: string, message: string, evidence: Record<string, unknown>): ValidationFinding =>
  ({ code, path, message, evidence, severity: "ERROR" });
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** Independent bounded verifier: no imports from qualification, standings or draw producers.
 * Unsupported selector semantics fail closed. This is A3 pipeline assurance, not a Phase B fairness certificate.
 */
export function assureQualification(spec: TournamentSpec, standings: Record<string, Standing[]>,
  entrants: Record<string, Entrant[]>, candidate: QualificationResult): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const expected: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const policy of spec.qualificationPolicies) {
    const division = spec.stages.find(s => s.id === policy.sourceStageId)?.divisionId;
    const allowed = new Set((entrants[division ?? ""] ?? []).map(e => e.id));
    const population = standings[policy.sourceStageId] ?? [];
    const selected: Standing[] = [];
    if (!population.length || population.some(row => !allowed.has(row.entrantId)) || new Set(population.map(r => r.entrantId)).size !== population.length) {
      findings.push(problem("AUDIT.QUALIFICATION_POPULATION", `/qualificationPolicies/${policy.id}`, "Source classification is missing, duplicated or outside the division.", { division }));
      continue;
    }
    if (policy.normalization && !["percentage", "per_match"].includes(policy.normalization)) {
      findings.push(problem("AUDIT.QUALIFICATION_UNSUPPORTED", `/qualificationPolicies/${policy.id}`, "Audit verifier has no registered normalisation for this policy.", { normalization: policy.normalization }));
      continue;
    }
    for (const selector of policy.selectors) {
      const eligible = population.filter(row => !used.has(row.entrantId) && !selected.some(s => s.entrantId === row.entrantId));
      let chosen: Standing[];
      switch (selector.type) {
        case "pool_winners": chosen = eligible.filter(r => r.rank === 1); break;
        case "pool_position": chosen = eligible.filter(r => r.rank === selector.position); break;
        case "top_n": chosen = [...eligible].sort((a,b) => a.rank-b.rank || a.entrantId.localeCompare(b.entrantId)).slice(0,selector.count); break;
        case "bottom_n": chosen = [...eligible].sort((a,b) => b.rank-a.rank || a.entrantId.localeCompare(b.entrantId)).slice(0,selector.count); break;
        case "remainder": chosen = eligible; break;
        case "best_n_across_pools": {
          // Re-derive ratios from raw counts; do not trust producer winningPercentage or ranking scores.
          const metrics = (r: Standing) => policy.normalization
            ? [r.played ? r.wins/r.played : 0, r.played ? (r.scoreFor-r.scoreAgainst)/r.played : 0, r.played ? r.scoreFor/r.played : 0]
            : [r.wins, r.scoreFor-r.scoreAgainst, r.scoreFor];
          chosen = eligible.filter(r => selector.poolPosition === undefined || r.rank === selector.poolPosition).sort((a,b) => {
            const aa=metrics(a), bb=metrics(b);
            for(let i=0;i<aa.length;i++){ const delta=bb[i]!-aa[i]!; if(delta) return delta; }
            return a.entrantId.localeCompare(b.entrantId);
          }).slice(0,selector.count); break;
        }
        default:
          findings.push(problem("AUDIT.QUALIFICATION_UNSUPPORTED", `/qualificationPolicies/${policy.id}`, "This audit slice does not independently support the selector.", { selector: selector.type }));
          chosen=[];
      }
      selected.push(...chosen);
    }
    const actualEvidence = candidate.evidence.filter(e => e.policyId === policy.id);
    if (selected.length !== policy.outputCount || !same(actualEvidence.map(e=>e.entrantId),selected.map(r=>r.entrantId)))
      findings.push(problem("AUDIT.QUALIFICATION_SELECTION", `/qualificationPolicies/${policy.id}`, "Qualification differs from the independently derived selected population.", { expected:selected.map(r=>r.entrantId), actual:actualEvidence.map(e=>e.entrantId), required:policy.outputCount }));
    for(const evidence of actualEvidence){
      const row=population.find(r=>r.entrantId===evidence.entrantId);
      if(!row || evidence.destinationStructureId!==policy.destinationStructureId || evidence.sourceStanding.entrantId!==evidence.entrantId ||
        Object.keys(row).some(key=>JSON.stringify(row[key as keyof Standing])!==JSON.stringify(evidence.sourceStanding[key as keyof Standing])))
        findings.push(problem("AUDIT.QUALIFICATION_LINEAGE", `/qualification/evidence/${evidence.entrantId}`, "Qualification evidence does not bind the source classification and destination.", {policy:policy.id}));
    }
    expected[policy.destinationStructureId]=[...(expected[policy.destinationStructureId]??[]),...selected.map(r=>r.entrantId)];
    selected.forEach(r=>used.add(r.entrantId));
  }
  for(const id of new Set([...Object.keys(expected),...Object.keys(candidate.byStructure)])){
    const actual=(candidate.byStructure[id]??[]).map(e=>e.id);
    if(!same(expected[id]??[],actual) || !(id in expected)) findings.push(problem("AUDIT.QUALIFICATION_MEMBERSHIP", `/qualification/byStructure/${id}`, "Destination contains missing, duplicate or non-qualified entries.", {expected:expected[id]??[],actual}));
  }
  const knownPolicies=new Set(spec.qualificationPolicies.map(p=>p.id));
  if(candidate.evidence.some(e=>!knownPolicies.has(e.policyId))) findings.push(problem("AUDIT.QUALIFICATION_POLICY", "/qualification/evidence", "Evidence names an unknown qualification policy.", {}));
  return findings;
}

export function assureDraw(spec: TournamentSpec, graph: CompetitionGraph, entrants: Record<string,Entrant[]>,
  qualification: QualificationResult): ValidationFinding[] {
  const findings=independentlyValidateAdvancementPaths(spec,graph);
  for(const stage of spec.stages.filter(s=>s.pool)) {
    const actual=[...new Set(graph.nodes.filter(n=>n.stageId===stage.id).flatMap(n=>n.slots.flatMap(s=>s.type==="entrant"?[s.entrantId]:[])))];
    const expected=(entrants[stage.divisionId]??[]).map(e=>e.id);
    if(!same(expected,actual))findings.push(problem("AUDIT.DRAW_POPULATION", `/stages/${stage.id}`, "Pool fixtures do not use exactly the admitted division population.", {expected,actual}));
  }
  for(const stage of spec.stages.filter(s=>s.bracket)){
    const structure=spec.competitionStructures.find(s=>s.stageIds.includes(stage.id));
    const expected=(structure?qualification.byStructure[structure.id]:entrants[stage.divisionId])??[];
    const actual=graph.nodes.filter(n=>n.stageId===stage.id&&n.roundIndex===1).flatMap(n=>n.slots.flatMap(s=>s.type==="entrant"?[s.entrantId]:[]));
    if(!same(expected.map(e=>e.id),actual)) findings.push(problem("AUDIT.DRAW_MEMBERSHIP", `/stages/${stage.id}`, "Opening draw does not contain each authorised entry exactly once.", {expected:expected.map(e=>e.id),actual}));
  }
  return findings;
}

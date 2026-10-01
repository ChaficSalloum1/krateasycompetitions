import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import { certify } from "./certification.js";
import { analyzeParticipantPaths, verifyParticipantPathRequirements } from "./analytics.js";
import { buildCompetitionGraph } from "./graph.js";
import { qualify } from "./qualification.js";
import { attachValidationAudit, solveSchedule, validateSchedule } from "./scheduler.js";
import { simulateGraph } from "./simulation.js";
import { calculateStandings } from "./standings.js";
import { validateEligibility } from "./eligibility.js";
import type { Entrant, ScenarioResult, Standing } from "./types.js";

/**
 * Whether a manual-decision tie can arise is a property of the standings policy, not of one simulated
 * result set, so a sampled tie never decides publication. A policy that leaves ties to the organiser is
 * raised once, deterministically, for acknowledgement at approval. When the ranking decides who
 * progresses, the organiser records the order in Run Control during the event and the next stage waits
 * for it; in final standings they decide it at close.
 */
export function standingsFindingsForPublication(
  spec: Pick<TournamentSpec, "qualificationPolicies" | "progressionPolicies">,
  policy: Pick<TournamentSpec["standingsPolicies"][number], "id" | "stageIds" | "tieFallback">,
  findings: readonly ValidationFinding[],
): ValidationFinding[] {
  const kept = findings.filter(({ code }) => code !== "TSC712");
  if (policy.tieFallback !== "manual_decision") return kept;
  const decidesProgression = policy.stageIds.some((stageId) => spec.qualificationPolicies.some(({ sourceStageId }) => sourceStageId === stageId)
    || spec.progressionPolicies.some(({ fromStageId, outcome }) => fromStageId === stageId && (outcome === "rank" || outcome === "pool_position")));
  return [...kept, { code: "TSC712", severity: "WARNING", path: `/standingsPolicies/${policy.id}`,
    message: decidesProgression
      ? "Entrants may finish level after every registered tiebreak where the ranking decides who progresses. You record their order in Run Control during the event before the next stage can be filled."
      : "Final standings may finish level after every registered tiebreak; you decide the order at close.",
    evidence: { standingsPolicyId: policy.id, decidesProgression } }];
}

export function runScenario(spec: TournamentSpec, entrantsByDivision: Record<string, Entrant[]>, seed: string): ScenarioResult {
  const eligibility = validateEligibility(spec, entrantsByDivision);
  const structural = buildCompetitionGraph(spec, entrantsByDivision);
  structural.findings.push(...eligibility.findings);
  const structuralSimulation = simulateGraph(structural, `${seed}:qualification`);
  const standingsByStage: Record<string, Standing[]> = {};
  const standingsFindings: ValidationFinding[] = [];
  for (const policy of spec.standingsPolicies) {
    const calculated = calculateStandings(structural.nodes, structuralSimulation.results, policy, { ...(spec.randomisation.seed ? { randomSeed: spec.randomisation.seed } : {}) });
    standingsFindings.push(...standingsFindingsForPublication(spec, policy, calculated.findings));
    for (const stageId of policy.stageIds) standingsByStage[stageId] = calculated.standings.filter((standing) => structural.nodes.some((node) => node.stageId === stageId && node.poolId === standing.poolId));
  }
  const qualification = qualify(spec, standingsByStage, entrantsByDivision);
  const graph = buildCompetitionGraph(spec, entrantsByDivision, qualification.byStructure);
  graph.findings.push(...standingsFindings, ...qualification.findings);
  graph.findings.push(...verifyParticipantPathRequirements(spec, analyzeParticipantPaths(graph)));
  let schedule = solveSchedule(spec, graph);
  schedule = attachValidationAudit(schedule, validateSchedule(spec, graph, schedule));
  const simulation = simulateGraph(graph, seed);
  const certification = certify(spec, graph, schedule, simulation);
  return { spec, graph, schedule, simulation, certification };
}

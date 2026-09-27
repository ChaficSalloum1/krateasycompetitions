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
 * A tie the registered policy leaves to a manual decision blocks publication only when that ranking
 * decides who qualifies or progresses. In final standings it is the organiser's decision at close, so it
 * is raised for acknowledgement at approval instead of blocking a legal plan.
 */
export function standingsFindingsForPublication(
  spec: Pick<TournamentSpec, "qualificationPolicies" | "progressionPolicies">,
  policy: Pick<TournamentSpec["standingsPolicies"][number], "stageIds">,
  findings: readonly ValidationFinding[],
): ValidationFinding[] {
  const decidesProgression = policy.stageIds.some((stageId) => spec.qualificationPolicies.some(({ sourceStageId }) => sourceStageId === stageId)
    || spec.progressionPolicies.some(({ fromStageId, outcome }) => fromStageId === stageId && (outcome === "rank" || outcome === "pool_position")));
  return findings.map((finding) => finding.code === "TSC712" && !decidesProgression
    ? { ...finding, severity: "WARNING" as const, message: "Final standings may remain tied after every registered tiebreak; the organiser decides the order manually at close." }
    : finding);
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

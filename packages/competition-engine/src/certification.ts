import { canonicalHash, validateTournamentSpec, type TournamentSpec, type ValidationFinding } from "@tournament-os/tournament-schema";
import { validateSchedule } from "./scheduler.js";
import type { Certification, CompetitionGraph, ScheduleSolution, SimulationRun } from "./types.js";

export function certify(
  spec: TournamentSpec,
  graph: CompetitionGraph,
  schedule: ScheduleSolution,
  simulation?: SimulationRun,
): Certification {
  const rawFindings: ValidationFinding[] = [
    ...validateTournamentSpec(spec).findings,
    ...graph.findings,
    ...schedule.findings,
    ...validateSchedule(spec, graph, schedule),
  ];
  if (schedule.audit.status !== "OPTIMAL" && schedule.audit.status !== "FEASIBLE") {
    rawFindings.push({
      code: "TSC903", severity: "ERROR", path: "/schedule/audit/status",
      message: "Certification requires a solver-backed feasible schedule; infeasible or unknown solver states are not certifiable.",
      evidence: { solver: schedule.audit.solver, solverVersion: schedule.audit.version, status: schedule.audit.status },
    });
  }
  if (simulation) {
    if (simulation.unresolvedDependencies.length) rawFindings.push({ code: "TSC901", severity: "ERROR", path: "/simulation", message: "Simulation left unresolved contest dependencies.", evidence: { contestIds: simulation.unresolvedDependencies } });
    const skipped = simulation.skippedConditionalContestIds ?? [];
    const invalidSkippedContestIds = skipped.filter((id, index) => skipped.indexOf(id) !== index
      || !graph.nodes.some((node) => node.id === id && node.kind === "contest" && node.condition !== undefined));
    if (invalidSkippedContestIds.length) rawFindings.push({
      code: "TSC904", severity: "ERROR", path: "/simulation/skippedConditionalContestIds",
      message: "Simulation reported an invalid conditional-contest skip.", evidence: { invalidSkippedContestIds },
    });
    const invalidConditionalOutcomes = graph.nodes.filter(({ condition }) => condition !== undefined).flatMap((node) => {
      const condition = node.condition!;
      const sourceResult = simulation.results.find(({ contestId }) => contestId === condition.sourceContestId);
      const conditionalResultExists = simulation.results.some(({ contestId }) => contestId === node.id);
      const reportedSkipped = skipped.includes(node.id);
      if (!sourceResult) return [{ contestId: node.id, reason: "condition source has no result" }];
      const active = sourceResult.winnerId === sourceResult.entrants[condition.sourceSlot];
      return active === conditionalResultExists && reportedSkipped === !active
        ? [] : [{ contestId: node.id, reason: "result/skip state contradicts the source-slot outcome" }];
    });
    if (invalidConditionalOutcomes.length) rawFindings.push({
      code: "TSC905", severity: "ERROR", path: "/simulation",
      message: "Conditional contest execution contradicts its recorded source outcome.", evidence: { invalidConditionalOutcomes },
    });
    const expectedCompleted = graph.generatedActualContestCount - new Set(skipped).size;
    if (simulation.completedContestCount !== expectedCompleted) rawFindings.push({ code: "TSC902", severity: "ERROR", path: "/simulation", message: "Simulation did not complete every active contest.", evidence: { completed: simulation.completedContestCount, expected: expectedCompleted, skippedConditionalContestIds: skipped } });
  }
  const findings = [...new Map(rawFindings.map((finding) => [`${finding.code}:${finding.path}:${finding.message}`, finding])).values()];
  const status = findings.some(({ severity }) => severity === "ERROR") ? "REJECTED" as const : "CERTIFIED" as const;
  const requirementCoverage = spec.requirements.map(({ id, status }) => ({ id, status }));
  const statement = status === "CERTIFIED"
    ? "All currently registered invariants passed; all supported structural paths were validated; no hard-constraint violation was detected. Solver status is reported separately."
    : "Certification rejected because one or more registered invariants or hard constraints failed.";
  const partial = {
    status, specHash: spec.metadata.compiledSpecHash, graphHash: canonicalHash(graph),
    ...(schedule.audit.scheduleHash ? { scheduleHash: schedule.audit.scheduleHash } : {}),
    ...(simulation ? { simulationHash: simulation.hash } : {}), findings, requirementCoverage, statement,
  };
  return { ...partial, certificationHash: canonicalHash(partial) };
}

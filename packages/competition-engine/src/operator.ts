import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, ContestNode, ContestResult, ScheduleSolution } from "./types.js";

export interface WhyNotAnswer { legal: boolean; reasons: string[]; earliestLegalStart?: string; }

export function explainWhyNot(
  graph: CompetitionGraph,
  schedule: ScheduleSolution,
  contestId: string,
  proposedStart: string,
): WhyNotAnswer {
  const target = schedule.contests.find((entry) => entry.contestId === contestId);
  if (!target) return { legal: false, reasons: ["Contest is not present in the solved schedule."] };
  const start = Date.parse(proposedStart); const duration = Date.parse(target.end) - Date.parse(target.start); const end = start + duration;
  const reasons: string[] = [];
  const predecessors = graph.edges.filter(({ toContestId }) => toContestId === contestId).map(({ fromContestId }) => fromContestId);
  const dependencyEnd = Math.max(0, ...predecessors.map((id) => schedule.contests.find(({ contestId: scheduledId }) => scheduledId === id)).filter(Boolean).map((entry) => Date.parse(entry!.end)));
  if (start < dependencyEnd) reasons.push(`A dependency cannot complete before ${new Date(dependencyEnd).toISOString()}.`);
  for (const other of schedule.contests) {
    if (other.contestId === contestId) continue;
    const overlaps = start < Date.parse(other.end) && end > Date.parse(other.start);
    if (overlaps && other.resourceId === target.resourceId) reasons.push(`${target.resourceId} is occupied by ${other.contestId}.`);
    if (overlaps && other.possibleEntrantIds.some((id) => target.possibleEntrantIds.includes(id))) reasons.push(`A possible entrant is committed to ${other.contestId}.`);
  }
  return { legal: reasons.length === 0, reasons: [...new Set(reasons)], ...(reasons.length ? { earliestLegalStart: target.start } : {}) };
}

export interface RepairProposal { id: string; description: string; formalChange: string; requiresApproval: true; }
export function proposeFeasibilityRepairs(spec: TournamentSpec, schedule: ScheduleSolution): RepairProposal[] {
  if (schedule.audit.status !== "INFEASIBLE") return [];
  const resource = spec.resources.find(({ type }) => type === spec.sport.defaultResourceType);
  return [
    { id: "add-resource", description: `Add one ${spec.sport.defaultResourceType}.`, formalChange: `/resources/${resource?.id ?? "primary"}/quantity + 1`, requiresApproval: true },
    { id: "extend-availability", description: "Extend venue availability by 60 minutes.", formalChange: "/resources/*/availability/*/end + 60m", requiresApproval: true },
    { id: "shorten-standard", description: "Shorten standard contests by five minutes.", formalChange: "/scheduling/durations/*/contestMinutes - 5", requiresApproval: true },
  ];
}

export function tournamentCritic(spec: TournamentSpec, graph: CompetitionGraph): ValidationFinding[] {
  const concerns: ValidationFinding[] = [];
  if (spec.requirements.length === 0) concerns.push({ code: "TCC001", severity: "WARNING", path: "/requirements", message: "No source requirements are available for coverage review." });
  for (const stage of spec.stages.filter(({ pool }) => pool && new Set(pool.sizes).size > 1)) {
    const policies = spec.qualificationPolicies.filter(({ sourceStageId }) => sourceStageId === stage.id);
    if (policies.some((policy) => policy.selectors.some(({ type }) => type === "best_n_across_pools") && !policy.normalization)) concerns.push({ code: "TCC002", severity: "ERROR", path: `/stages/${stage.id}`, message: "Unequal-pool comparison may be using raw opportunity totals." });
  }
  if (graph.generatedActualContestCount !== graph.expectedActualContestCount) concerns.push({ code: "TCC003", severity: "ERROR", path: "/competitionGraph", message: "Independent contest counts disagree." });
  return concerns;
}

export interface RuntimeState { results: Readonly<Record<string, ContestResult>>; }
export function applyResultThroughInvariantFirewall(state: RuntimeState, graph: CompetitionGraph, result: ContestResult): RuntimeState {
  const node = graph.nodes.find(({ id, kind }) => id === result.contestId && kind === "contest");
  if (!node) throw new Error("Invariant firewall: result targets an unknown or non-contest node");
  if (state.results[result.contestId]) throw new Error("Invariant firewall: completed competition truth is immutable; create an audited correction revision");
  const resolveSlot = (slot: ContestNode["slots"][number]): string | undefined => {
    if (slot.type === "entrant") return slot.entrantId;
    if (slot.type === "bye") return undefined;
    const source = state.results[slot.contestId];
    return slot.type === "winner" ? source?.winnerId : source?.loserId;
  };
  if (node.condition) {
    const sourceNode = graph.nodes.find(({ id, kind }) => id === node.condition!.sourceContestId && kind === "contest");
    const sourceResult = state.results[node.condition.sourceContestId];
    const requiredWinner = sourceNode ? resolveSlot(sourceNode.slots[node.condition.sourceSlot]) : undefined;
    if (!sourceNode || !sourceResult || !requiredWinner || sourceResult.winnerId !== requiredWinner) {
      throw new Error("Invariant firewall: conditional contest is not active for the recorded source outcome");
    }
  }
  const expectedEntrants = node.slots.map(resolveSlot) as [string | undefined, string | undefined];
  if (expectedEntrants[0] && expectedEntrants[1]
    && (result.entrants[0] !== expectedEntrants[0] || result.entrants[1] !== expectedEntrants[1])) {
    throw new Error("Invariant firewall: result entrants do not match the resolved contest slots");
  }
  if (!result.entrants.includes(result.winnerId) || !result.entrants.includes(result.loserId) || result.winnerId === result.loserId) throw new Error("Invariant firewall: winner/loser must be distinct contest entrants");
  return Object.freeze({ results: Object.freeze({ ...state.results, [result.contestId]: Object.freeze(structuredClone(result)) }) });
}

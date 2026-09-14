import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import { possibleEntrants, topologicalNodes } from "./scheduler.js";
import type { CompetitionGraph, ScheduleSolution } from "./types.js";

export interface ParticipantPathProof {
  entrantId: string;
  guaranteedContestIds: string[];
  possibleContestIds: string[];
  minimumContestCount: number;
  maximumContestCount: number;
  minimumGroupContestCount: number;
  maximumGroupContestCount: number;
  counterexample: string[];
}

export function analyzeParticipantPaths(graph: CompetitionGraph): ParticipantPathProof[] {
  const potentials = possibleEntrants(graph);
  const entrantIds = new Set(graph.nodes.flatMap(({ slots }) => slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : [])));
  return [...entrantIds].sort().map((entrantId) => {
    const directActual = graph.nodes.filter(({ kind, slots }) => kind === "contest" && slots.some((slot) => slot.type === "entrant" && slot.entrantId === entrantId));
    const possible = graph.nodes.filter(({ kind, id }) => kind === "contest" && potentials.get(id)?.has(entrantId));
    const possibleByStage = new Map<string, typeof possible>();
    for (const node of possible) possibleByStage.set(node.stageId, [...(possibleByStage.get(node.stageId) ?? []), node]);
    const guaranteed = [...possibleByStage.values()].flatMap((nodes) => {
      if (nodes[0]?.poolId) return directActual.filter(({ stageId }) => stageId === nodes[0]!.stageId);
      return [...nodes].sort((a, b) => a.roundIndex - b.roundIndex || a.index - b.index).slice(0, 1);
    });
    const minimumContestCount = guaranteed.length;
    const groupContests = possible.filter(({ poolId }) => Boolean(poolId));
    return {
      entrantId,
      guaranteedContestIds: guaranteed.map(({ id }) => id).sort(),
      possibleContestIds: possible.map(({ id }) => id).sort(),
      minimumContestCount,
      maximumContestCount: possible.length,
      minimumGroupContestCount: groupContests.length,
      maximumGroupContestCount: groupContests.length,
      counterexample: [...guaranteed.map(({ id }) => `plays ${id}`), "loses first reachable elimination contest"],
    };
  });
}

export function verifyParticipantPathRequirements(spec: TournamentSpec, paths: readonly ParticipantPathProof[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const policy of spec.operationalPolicies.filter(({ rule }) => rule === "minimum_group_matches" || rule === "minimum_total_matches")) {
    if (typeof policy.value !== "number") continue;
    const requiredMinimum = policy.value;
    const groupOnly = policy.rule === "minimum_group_matches";
    const affected = paths.filter((path) => (groupOnly ? path.minimumGroupContestCount : path.minimumContestCount) < requiredMinimum);
    if (!affected.length) continue;
    const example = affected[0]!;
    findings.push({
      code: policy.strength === "HARD" ? "TSC104" : "TSW104",
      severity: policy.strength === "HARD" ? "ERROR" : "WARNING",
      path: `/operationalPolicies/${policy.id}`,
      message: `${policy.strength === "HARD" ? "Required" : "Preferred"} minimum participation is not satisfied on every reachable path.`,
      evidence: {
        requiredMinimum,
        observedMinimum: Math.min(...affected.map((path) => groupOnly ? path.minimumGroupContestCount : path.minimumContestCount)),
        affectedEntrants: affected.map(({ entrantId }) => entrantId),
        counterexample: example.counterexample,
      },
    });
  }
  return findings;
}

export interface ScheduleAnalytics {
  scheduledContestCount: number;
  finish: string;
  makespanMinutes: number;
  lowerBoundMinutes: number;
  criticalPathContestIds: string[];
  resourceUtilisation: Array<{ resourceId: string; busyMinutes: number; windowMinutes: number; utilisation: number }>;
}

export function analyzeSchedule(spec: TournamentSpec, graph: CompetitionGraph, schedule: ScheduleSolution): ScheduleAnalytics {
  const starts = schedule.contests.map(({ start }) => Date.parse(start)); const ends = schedule.contests.map(({ end }) => Date.parse(end));
  const start = Math.min(...starts); const finish = Math.max(...ends);
  const predecessors = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) predecessors.get(edge.toContestId)?.push(edge.fromContestId);
  const score = new Map<string, { minutes: number; path: string[] }>();
  const scheduledIds = new Set(schedule.contests.map(({ contestId }) => contestId));
  for (const node of topologicalNodes(graph)) {
    const duration = node.kind === "contest" ? (Date.parse(schedule.contests.find(({ contestId }) => contestId === node.id)!.end) - Date.parse(schedule.contests.find(({ contestId }) => contestId === node.id)!.start)) / 60_000 : 0;
    const prior = (predecessors.get(node.id) ?? []).map((id) => score.get(id)).filter((value): value is { minutes: number; path: string[] } => Boolean(value)).sort((a, b) => b.minutes - a.minutes)[0] ?? { minutes: 0, path: [] };
    score.set(node.id, { minutes: prior.minutes + duration, path: node.kind === "contest" ? [...prior.path, node.id] : prior.path });
  }
  const critical = [...score.values()].sort((a, b) => b.minutes - a.minutes)[0]?.path ?? [];
  const resourceUtilisation = [...new Set(schedule.contests.map(({ resourceId }) => resourceId))].sort().map((resourceId) => {
    const busyMinutes = schedule.contests.filter((entry) => entry.resourceId === resourceId).reduce((sum, entry) => sum + (Date.parse(entry.end) - Date.parse(entry.start)) / 60_000, 0);
    const baseId = resourceId.replace(/\.\d+$/, ""); const resource = spec.resources.find(({ id }) => id === baseId);
    const windowMinutes = resource?.availability.reduce((sum, window) => sum + (Date.parse(window.end) - Date.parse(window.start)) / 60_000, 0) ?? 0;
    return { resourceId, busyMinutes, windowMinutes, utilisation: windowMinutes ? busyMinutes / windowMinutes : 0 };
  });
  if (scheduledIds.size !== graph.generatedActualContestCount) throw new Error("Analytics require a complete schedule");
  return { scheduledContestCount: schedule.contests.length, finish: new Date(finish).toISOString(), makespanMinutes: (finish - start) / 60_000, lowerBoundMinutes: schedule.audit.lowerBoundMinutes, criticalPathContestIds: critical, resourceUtilisation };
}

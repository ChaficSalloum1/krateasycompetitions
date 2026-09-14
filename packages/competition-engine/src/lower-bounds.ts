import type { TournamentSpec } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, ContestNode } from "./types.js";

function topologicalNodes(graph: CompetitionGraph): ContestNode[] {
  const dependencies = new Map(graph.nodes.map(({ id }) => [id, new Set<string>()]));
  for (const edge of graph.edges) dependencies.get(edge.toContestId)?.add(edge.fromContestId);
  const remaining = new Map(dependencies);
  const result: ContestNode[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, values]) => values.size === 0)
      .map(([id]) => graph.nodes.find((node) => node.id === id)!)
      .sort((left, right) => left.roundIndex - right.roundIndex || left.index - right.index || left.id.localeCompare(right.id));
    if (!ready.length) throw new Error("Competition graph is cyclic");
    for (const node of ready) {
      result.push(node);
      remaining.delete(node.id);
      for (const values of remaining.values()) values.delete(node.id);
    }
  }
  return result;
}

function duration(node: ContestNode, spec: TournamentSpec): number {
  const rules = [...spec.scheduling.durations].reverse();
  const selected = rules.find(({ stageId, round }) => stageId === node.stageId && round === node.round)
    ?? rules.find(({ stageId, round }) => stageId === node.stageId && round === undefined);
  if (!selected) throw new Error(`Missing duration for ${node.id}`);
  return selected.contestMinutes + selected.turnaroundMinutes;
}

export interface SchedulingLowerBounds {
  resourceCapacityMinutes: number;
  resourceSpecificMinutes: Record<string, number>;
  dependencyCriticalPathMinutes: number;
  participantWorkloadMinutes: number;
  verifiedLowerBoundMinutes: number;
  criticalPathContestIds: string[];
}

export function calculateSchedulingLowerBounds(spec: TournamentSpec, graph: CompetitionGraph): SchedulingLowerBounds {
  const actual = graph.nodes.filter(({ kind }) => kind === "contest");
  const units = spec.resources.filter(({ type }) => type === spec.sport.defaultResourceType).reduce((sum, resource) => sum + resource.quantity, 0);
  const resourceCapacityMinutes = Math.ceil(actual.reduce((sum, node) => sum + duration(node, spec), 0) / Math.max(1, units));
  const resourceTypes = [...new Set(actual.map(({ requiredResourceType }) => requiredResourceType))].sort();
  const resourceSpecificMinutes = Object.fromEntries(resourceTypes.map((type) => {
    const compatibleUnits = spec.resources.filter((resource) => resource.type === type).reduce((sum, resource) => sum + resource.quantity, 0);
    const requiredMinutes = actual.filter(({ requiredResourceType }) => requiredResourceType === type)
      .reduce((sum, node) => sum + duration(node, spec), 0);
    return [type, compatibleUnits > 0 ? Math.ceil(requiredMinutes / compatibleUnits) : Number.POSITIVE_INFINITY];
  }));
  const predecessors = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) predecessors.get(edge.toContestId)?.push(edge.fromContestId);
  const longest = new Map<string, { value: number; path: string[] }>();
  for (const node of topologicalNodes(graph)) {
    const prior = (predecessors.get(node.id) ?? []).map((id) => longest.get(id)).filter((item): item is { value: number; path: string[] } => Boolean(item)).sort((a, b) => b.value - a.value)[0] ?? { value: 0, path: [] };
    longest.set(node.id, { value: prior.value + (node.kind === "contest" ? duration(node, spec) : 0), path: node.kind === "contest" ? [...prior.path, node.id] : prior.path });
  }
  const critical = [...longest.values()].sort((a, b) => b.value - a.value)[0] ?? { value: 0, path: [] };
  const rest = Number(spec.scheduling.constraints.find(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD")?.value ?? 0);
  const direct = new Map<string, ContestNode[]>();
  for (const node of actual.filter(({ poolId }) => Boolean(poolId))) for (const slot of node.slots) if (slot.type === "entrant") direct.set(slot.entrantId, [...(direct.get(slot.entrantId) ?? []), node]);
  const participantWorkloadMinutes = Math.max(0, ...[...direct.values()].map((nodes) => nodes.reduce((sum, node) => sum + duration(node, spec), 0) + Math.max(0, nodes.length - 1) * rest));
  return {
    resourceCapacityMinutes,
    resourceSpecificMinutes,
    dependencyCriticalPathMinutes: critical.value,
    participantWorkloadMinutes,
    verifiedLowerBoundMinutes: Math.max(resourceCapacityMinutes, ...Object.values(resourceSpecificMinutes), critical.value, participantWorkloadMinutes),
    criticalPathContestIds: critical.path,
  };
}

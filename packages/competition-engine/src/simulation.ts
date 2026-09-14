import { canonicalHash } from "@tournament-os/tournament-schema";
import { deterministicRandom } from "./random.js";
import { topologicalNodes } from "./scheduler.js";
import type { CompetitionGraph, ContestResult, SimulationRun, SlotSource } from "./types.js";

export function simulateGraph(graph: CompetitionGraph, seed: string): SimulationRun {
  const random = deterministicRandom(seed);
  const results: ContestResult[] = [];
  const resolved = new Map<string, { winner?: string; loser?: string }>();
  const unresolvedDependencies: string[] = [];
  const skippedConditionalContestIds: string[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    if (!node.condition) continue;
    const source = nodeById.get(node.condition.sourceContestId);
    const linked = graph.edges.some(({ fromContestId, toContestId }) =>
      fromContestId === node.condition!.sourceContestId && toContestId === node.id);
    if (node.kind !== "contest" || !source || source.kind !== "contest" || source.condition
      || source.id === node.id || !linked || (node.condition.sourceSlot !== 0 && node.condition.sourceSlot !== 1)) {
      throw new Error(`Conditional contest ${node.id} has invalid or unsupported condition semantics`);
    }
  }
  const resolveSlot = (slot: SlotSource): string | undefined => {
    if (slot.type === "entrant") return slot.entrantId;
    if (slot.type === "bye") return undefined;
    return resolved.get(slot.contestId)?.[slot.type];
  };
  for (const node of topologicalNodes(graph)) {
    if (node.condition) {
      const source = nodeById.get(node.condition.sourceContestId)!;
      const sourceWinner = resolved.get(source.id)?.winner;
      const requiredWinner = resolveSlot(source.slots[node.condition.sourceSlot]);
      if (!sourceWinner || !requiredWinner) { unresolvedDependencies.push(node.id); continue; }
      if (sourceWinner !== requiredWinner) { skippedConditionalContestIds.push(node.id); continue; }
    }
    const left = resolveSlot(node.slots[0]); const right = resolveSlot(node.slots[1]);
    if (node.kind === "bye") {
      const winner = left ?? right;
      if (winner) resolved.set(node.id, { winner }); else unresolvedDependencies.push(node.id);
      continue;
    }
    if (!left || !right) { unresolvedDependencies.push(node.id); continue; }
    const leftScore = 1 + random.int(10); let rightScore = 1 + random.int(10);
    if (leftScore === rightScore) rightScore += 1;
    const winnerId = leftScore > rightScore ? left : right;
    const loserId = winnerId === left ? right : left;
    const result: ContestResult = { contestId: node.id, entrants: [left, right], winnerId, loserId, scoreFor: [leftScore, rightScore], status: "completed" };
    results.push(result); resolved.set(node.id, { winner: winnerId, loser: loserId });
  }
  const partial = { seed, results, completedContestCount: results.length, unresolvedDependencies, skippedConditionalContestIds };
  return { ...partial, hash: canonicalHash(partial) };
}

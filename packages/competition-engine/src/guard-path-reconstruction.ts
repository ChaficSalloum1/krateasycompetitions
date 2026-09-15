import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, ProgressionEdge } from "./types.js";

const edgeKey = (edge: ProgressionEdge): string =>
  `${edge.fromContestId}|${edge.outcome}|${edge.toContestId}|${edge.toSlot}`;

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

/**
 * Reconstructs the closed advancement envelope without calling the graph compiler,
 * topology compiler, scheduler, simulation or their proofs.
 */
export function independentlyValidateAdvancementPaths(
  spec: TournamentSpec,
  graph: CompetitionGraph,
): ValidationFinding[] {
  const failures: Array<{ rule: string; contestIds: string[] }> = [];
  const fail = (rule: string, contestIds: readonly string[] = []) => {
    failures.push({ rule, contestIds: [...new Set(contestIds)].sort() });
  };
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const stageById = new Map(spec.stages.map((stage) => [stage.id, stage]));

  if (nodesById.size !== graph.nodes.length) fail("DUPLICATE_NODE_ID", graph.nodes.map(({ id }) => id));
  for (const node of graph.nodes) {
    const stage = stageById.get(node.stageId);
    if (!stage || node.divisionId !== stage.divisionId || node.requiredResourceType !== spec.sport.defaultResourceType)
      fail("NODE_STAGE_IDENTITY_MISMATCH", [node.id]);
    for (const [toSlot, slot] of node.slots.entries()) {
      if (slot.type !== "winner" && slot.type !== "loser") continue;
      const matching = graph.edges.filter((edge) => edge.fromContestId === slot.contestId
        && edge.outcome === slot.type && edge.toContestId === node.id && edge.toSlot === toSlot);
      if (matching.length !== 1 || !nodesById.has(slot.contestId)) fail("DYNAMIC_SLOT_EDGE_MISMATCH", [node.id, slot.contestId]);
    }
  }
  for (const edge of graph.edges.filter(({ outcome }) => outcome !== "complete")) {
    const target = nodesById.get(edge.toContestId);
    const slot = target?.slots[edge.toSlot];
    if (!nodesById.has(edge.fromContestId) || !target || !slot
      || slot.type !== edge.outcome || slot.contestId !== edge.fromContestId)
      fail("EDGE_SLOT_MISMATCH", [edge.fromContestId, edge.toContestId]);
  }
  const edgeKeys = graph.edges.map(edgeKey);
  if (new Set(edgeKeys).size !== edgeKeys.length) fail("DUPLICATE_PROGRESSION_EDGE");

  const expectedCompleteEdges: ProgressionEdge[] = [];
  for (const policy of spec.qualificationPolicies) {
    const structure = spec.competitionStructures.find(({ id }) => id === policy.destinationStructureId);
    const destinationStageId = structure?.stageIds[0];
    if (!destinationStageId) continue;
    const sources = graph.nodes.filter(({ kind, stageId }) => kind === "contest" && stageId === policy.sourceStageId);
    const destinations = graph.nodes.filter(({ stageId, roundIndex }) =>
      stageId === destinationStageId && roundIndex === 1);
    for (const source of sources) for (const destination of destinations) expectedCompleteEdges.push({
      fromContestId: source.id, outcome: "complete", toContestId: destination.id, toSlot: 0,
    });
  }
  const actualCompleteEdges = graph.edges.filter(({ outcome }) => outcome === "complete");
  if (!sameMultiset(actualCompleteEdges.map(edgeKey), expectedCompleteEdges.map(edgeKey)))
    fail("QUALIFICATION_DEPENDENCY_MISMATCH", actualCompleteEdges.flatMap(({ fromContestId, toContestId }) =>
      [fromContestId, toContestId]));

  for (const stage of spec.stages) {
    const nodes = graph.nodes.filter((node) => node.stageId === stage.id);
    if (stage.pool && ["groups", "single_round_robin", "double_round_robin", "league_table"].includes(stage.primitive)) {
      const pools = new Map<string, typeof nodes>();
      for (const node of nodes) {
        if (!node.poolId || node.kind !== "contest" || node.roundIndex < 1
          || node.slots.some(({ type }) => type !== "entrant")) {
          fail("POOL_NODE_SHAPE_MISMATCH", [node.id]);
          continue;
        }
        pools.set(node.poolId, [...(pools.get(node.poolId) ?? []), node]);
      }
      const poolSizes: number[] = [];
      for (const poolNodes of pools.values()) {
        const entrantIds = [...new Set(poolNodes.flatMap(({ slots }) => slots.flatMap((slot) =>
          slot.type === "entrant" ? [slot.entrantId] : [])))];
        poolSizes.push(entrantIds.length);
        const pairCounts = new Map<string, number>();
        for (const node of poolNodes) {
          const ids = node.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []).sort();
          const key = ids.join("|");
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
        const expectedPairs = entrantIds.length * (entrantIds.length - 1) / 2;
        if (pairCounts.size !== expectedPairs || [...pairCounts.values()].some((count) => count !== stage.pool!.rounds))
          fail("POOL_PAIR_COVERAGE_MISMATCH", poolNodes.map(({ id }) => id));
      }
      if (pools.size !== stage.pool.poolCount || !sameMultiset(poolSizes.map(String), stage.pool.sizes.map(String)))
        fail("POOL_ALLOCATION_SHAPE_MISMATCH", nodes.map(({ id }) => id));
      continue;
    }

    if (stage.bracket && !stage.bracket.thirdPlaceMatch
      && ["single_elimination", "consolation"].includes(stage.primitive)) {
      const entrantCount = stage.bracket.entrantCount;
      const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, entrantCount)));
      const rounds = Math.log2(bracketSize);
      if (nodes.length !== bracketSize - 1) fail("ELIMINATION_NODE_COUNT_MISMATCH", nodes.map(({ id }) => id));
      const opening = nodes.filter(({ roundIndex }) => roundIndex === 1);
      const openingEntrants = opening.flatMap(({ slots }) => slots.flatMap((slot) =>
        slot.type === "entrant" ? [slot.entrantId] : []));
      const openingByes = opening.flatMap(({ slots }) => slots.filter(({ type }) => type === "bye")).length;
      if (opening.length !== bracketSize / 2 || openingEntrants.length !== entrantCount
        || new Set(openingEntrants).size !== entrantCount || openingByes !== bracketSize - entrantCount
        || opening.some((node) => node.condition !== undefined
          || node.slots.some(({ type }) => type !== "entrant" && type !== "bye")
          || node.kind !== (node.slots.some(({ type }) => type === "bye") ? "bye" : "contest")))
        fail("ELIMINATION_OPENING_DRAW_MISMATCH", opening.map(({ id }) => id));
      for (let round = 2; round <= rounds; round += 1) {
        const previous = nodes.filter(({ roundIndex }) => roundIndex === round - 1);
        const current = nodes.filter(({ roundIndex }) => roundIndex === round);
        const sources = current.flatMap(({ slots }) => slots.flatMap((slot) =>
          slot.type === "winner" ? [slot.contestId] : []));
        if (current.length !== bracketSize / 2 ** round || current.some((node) => node.kind !== "contest"
          || node.condition !== undefined || node.slots.some(({ type }) => type !== "winner"))
          || !sameMultiset(sources, previous.map(({ id }) => id)))
          fail("ELIMINATION_ADVANCEMENT_MISMATCH", [...previous, ...current].map(({ id }) => id));
      }
      if (nodes.filter(({ kind }) => kind === "contest").length !== entrantCount - 1)
        fail("ELIMINATION_CONTEST_COUNT_MISMATCH", nodes.map(({ id }) => id));
    }
  }

  if (!failures.length) return [];
  return [{
    code: "KCG005", severity: "ERROR", path: "/graph/advancementPaths",
    message: "The competition graph's draw, qualification or advancement paths disagree with the Guard's independent reconstruction.",
    evidence: { rules: [...new Set(failures.map(({ rule }) => rule))].sort(),
      contestIds: [...new Set(failures.flatMap(({ contestIds }) => contestIds))].sort() },
  }];
}

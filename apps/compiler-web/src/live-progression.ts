import { canonicalHash, type TournamentSpec } from "@tournament-os/tournament-schema";
import {
  buildCompetitionGraph,
  calculateStandings,
  qualify,
  submitLiveOperationsCommand,
  type CompetitionGraph,
  type ContestNode,
  type ContestResult,
  type Entrant,
  type LiveOperationsEvent,
  type LiveOperationsState,
  type Standing,
} from "@tournament-os/competition-engine";

export interface LiveProgressionResult {
  readonly state: LiveOperationsState;
  readonly events: readonly LiveOperationsEvent[];
}

function actualEntrants(state: LiveOperationsState, contestId: string): readonly string[] {
  const definition = state.definition.contests.find((contest) => contest.contestId === contestId);
  return state.resolvedEntrants[contestId] ?? definition?.entrantIds ?? [];
}

function resultFor(state: LiveOperationsState, contestId: string): ContestResult | null {
  const contest = state.contests[contestId];
  const entrants = actualEntrants(state, contestId);
  if (!contest || entrants.length !== 2 || !new Set(["COMPLETED", "WALKOVER", "RETIRED"]).has(contest.status)) return null;
  let winnerId = contest.winnerEntrantId;
  if (contest.status === "COMPLETED") {
    if (!contest.scores || contest.scores.length !== 2 || contest.scores[0]!.value === contest.scores[1]!.value) return null;
    winnerId = [...contest.scores].sort((left, right) => right.value - left.value)[0]!.entrantId;
  }
  if (!winnerId || !entrants.includes(winnerId)) return null;
  const loserId = entrants.find((entrantId) => entrantId !== winnerId)!;
  const score = (entrantId: string) => contest.scores?.find((item) => item.entrantId === entrantId)?.value ?? 0;
  return { contestId, entrants: [entrants[0]!, entrants[1]!], winnerId, loserId,
    scoreFor: [score(entrants[0]!), score(entrants[1]!)],
    status: contest.status === "WALKOVER" ? "walkover" : "completed" };
}

function actualGraph(spec: TournamentSpec, planningGraph: CompetitionGraph,
  entrantsByDivision: Record<string, Entrant[]>, state: LiveOperationsState): CompetitionGraph | null {
  const groupNodes = planningGraph.nodes.filter((node) => node.kind === "contest"
    && spec.stages.find((stage) => stage.id === node.stageId)?.pool);
  const results = groupNodes.map(({ id }) => resultFor(state, id));
  if (results.some((result) => result === null)) return null;
  const standingsByStage: Record<string, Standing[]> = {};
  const findings = [];
  for (const policy of spec.standingsPolicies) {
    const calculated = calculateStandings(planningGraph.nodes, results as ContestResult[], policy,
      { ...(spec.randomisation.seed ? { randomSeed: spec.randomisation.seed } : {}) });
    findings.push(...calculated.findings);
    for (const stageId of policy.stageIds) standingsByStage[stageId] = calculated.standings
      .filter((standing) => planningGraph.nodes.some((node) => node.stageId === stageId && node.poolId === standing.poolId));
  }
  if (findings.some(({ severity }) => severity === "ERROR")) return null;
  const qualification = qualify(spec, standingsByStage, entrantsByDivision);
  if (qualification.findings.some(({ severity }) => severity === "ERROR")) return null;
  const graph = buildCompetitionGraph(spec, entrantsByDivision, qualification.byStructure);
  const plannedIds = planningGraph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id).sort();
  const actualIds = graph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id).sort();
  if (canonicalHash(plannedIds) !== canonicalHash(actualIds)) throw new Error("live_progression_topology_changed");
  return graph;
}

function outcome(state: LiveOperationsState, contestId: string, kind: "winner" | "loser"): string | null {
  const result = resultFor(state, contestId);
  return result ? (kind === "winner" ? result.winnerId : result.loserId) : null;
}

function resolveSlot(state: LiveOperationsState, nodes: ReadonlyMap<string, ContestNode>,
  slot: ContestNode["slots"][number], visited: ReadonlySet<string>): string | null {
  if (slot.type === "entrant") return slot.entrantId;
  if (slot.type === "bye") return null;
  const source = nodes.get(slot.contestId);
  if (!source || source.kind === "contest") return outcome(state, slot.contestId, slot.type);
  if (slot.type === "loser" || visited.has(source.id)) return null;
  const candidates = source.slots.filter((candidate) => candidate.type !== "bye");
  if (candidates.length !== 1) return null;
  return resolveSlot(state, nodes, candidates[0]!, new Set([...visited, source.id]));
}

function resolvedForNode(state: LiveOperationsState, node: ContestNode,
  nodes: ReadonlyMap<string, ContestNode>): readonly [string, string] | null {
  const resolved = node.slots.map((slot) => resolveSlot(state, nodes, slot, new Set([node.id])));
  if (resolved.some((entrantId) => entrantId === null) || resolved[0] === resolved[1]) return null;
  return [...resolved].sort() as [string, string];
}

function expectedResolutions(spec: TournamentSpec, planningGraph: CompetitionGraph,
  entrantsByDivision: Record<string, Entrant[]>, state: LiveOperationsState): Readonly<Record<string, readonly [string, string]>> {
  const fixed = Object.fromEntries(state.definition.contests.flatMap(({ contestId, fixedEntrantIds }) =>
    fixedEntrantIds ? [[contestId, fixedEntrantIds]] : []));
  const graph = actualGraph(spec, planningGraph, entrantsByDivision, state);
  if (!graph) return fixed;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const expected: Record<string, readonly [string, string]> = { ...fixed };
  for (const node of graph.nodes.filter(({ kind }) => kind === "contest")
    .sort((left, right) => left.roundIndex - right.roundIndex || left.id.localeCompare(right.id))) {
    if (spec.stages.find((stage) => stage.id === node.stageId)?.pool) continue;
    const resolved = resolvedForNode({ ...state, resolvedEntrants: { ...state.resolvedEntrants, ...expected } }, node, nodes);
    if (resolved) expected[node.id] = resolved;
  }
  return expected;
}

export function advanceLiveProgression(spec: TournamentSpec, planningGraph: CompetitionGraph,
  entrantsByDivision: Record<string, Entrant[]>, initial: LiveOperationsState, occurredAt: string): LiveProgressionResult {
  const expected = expectedResolutions(spec, planningGraph, entrantsByDivision, initial);
  const invalidated = Object.keys(initial.resolvedEntrants).filter((contestId) =>
    initial.definition.contests.find((contest) => contest.contestId === contestId)?.requiresEntrantResolution
      && expected[contestId] === undefined);
  if (invalidated.length) throw new Error(`live_progression_invalidation_requires_repair:${invalidated.sort().join(",")}`);
  let state = initial;
  const events: LiveOperationsEvent[] = [];
  for (const [contestId, entrantIds] of Object.entries(expected).sort(([left], [right]) => left.localeCompare(right))) {
    if (canonicalHash(state.resolvedEntrants[contestId] ?? null) === canonicalHash(entrantIds)) continue;
    const contest = state.contests[contestId];
    if (contest?.status !== "SCHEDULED" || contest.calledAt) throw new Error("live_progression_invalidation_requires_repair");
    const sourceProofHash = canonicalHash({ specHash: canonicalHash(spec), graphHash: canonicalHash(planningGraph),
      liveProofHash: state.proofHash, contestId, entrantIds });
    const result = submitLiveOperationsCommand(state, { kind: "RESOLVE_CONTEST_ENTRANTS", contestId,
      entrantIds, sourceProofHash, commandId: `progression.${contestId}.${sourceProofHash.slice(0, 16)}`,
      expectedVersion: state.version, actorId: "competition-journey.progression", occurredAt });
    if (!result.accepted) throw new Error(`live_progression_rejected:${result.findings
      .map(({ code, path, message }) => `${code}:${path}:${message}`).join("|")}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

export function verifyLiveProgression(spec: TournamentSpec, planningGraph: CompetitionGraph,
  entrantsByDivision: Record<string, Entrant[]>, state: LiveOperationsState): boolean {
  const expected = expectedResolutions(spec, planningGraph, entrantsByDivision, state);
  return canonicalHash(expected) === canonicalHash(state.resolvedEntrants);
}

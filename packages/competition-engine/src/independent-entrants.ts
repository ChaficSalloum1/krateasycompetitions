import type { CompetitionGraph } from "./types.js";

/**
 * Verifier-side derivation of who can occupy each contest, written independently of the scheduler's
 * `possibleEntrants` so that a shared bug cannot make the producer and its checker agree on a wrong
 * answer. It deliberately imports nothing from scheduler.ts or graph.ts: a slot names an entrant
 * directly, or inherits every entrant that can occupy the contest it refers to; a bye contributes no one.
 *
 * Contests on a reference cycle contribute what was reachable before the cycle closed; cyclic graphs are
 * rejected elsewhere, so this only has to terminate, not interpret them.
 */
export function deriveContestEntrantsIndependently(graph: CompetitionGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const derived = new Map<string, Set<string>>();
  const inProgress = new Set<string>();
  const visit = (contestId: string): ReadonlySet<string> => {
    const known = derived.get(contestId);
    if (known) return known;
    const node = nodes.get(contestId);
    if (!node || inProgress.has(contestId)) return new Set();
    inProgress.add(contestId);
    const entrants = new Set<string>();
    for (const slot of node.slots) {
      if (slot.type === "entrant") entrants.add(slot.entrantId);
      else if (slot.type === "winner" || slot.type === "loser") for (const id of visit(slot.contestId)) entrants.add(id);
    }
    inProgress.delete(contestId);
    derived.set(contestId, entrants);
    return entrants;
  };
  for (const node of graph.nodes) visit(node.id);
  return derived;
}

/** How an entrant can reach a contest: `FIXED` membership, or through one qualification slot. */
export type OccupancyOrigin = "FIXED" | `QUALIFIED:${string}`;

export interface QualificationOccupancy {
  /** For each contest, every entrant who can occupy it in some outcome, with the ways they can get there. */
  readonly byContest: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<OccupancyOrigin>>>;
  /** Whether one entrant could appear in both contests in the same outcome, given their origins there. */
  canMeet(left: ReadonlySet<OccupancyOrigin>, right: ReadonlySet<OccupancyOrigin>): boolean;
}

/**
 * Verifier-side occupancy across every qualification outcome, not only the one simulated when the
 * graph was built. `complete` progression edges mark a contest that waits for its source stage to
 * finish (they are contest-level: every one targets slot 0). Each named-entrant slot of such a contest
 * is filled by qualification when the named entrant is itself one of the feeders' entrants, so anyone
 * who can play in those feeders can occupy it. A named entrant who is not among them is a direct entry
 * and stays fixed, so no real entrant is ever dropped.
 *
 * Qualification places each entrant of a source stage in at most one destination slot, so two slots
 * fed from the same source stage(s) are mutually exclusive: the same entrant cannot occupy both.
 * Slots fed from different stages are not (an entrant can qualify through one stage into the next),
 * and fixed membership meets everything. Written independently of the scheduler, like the entrant
 * derivation above.
 */
export function deriveQualificationOccupancy(graph: CompetitionGraph): QualificationOccupancy {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const feedersByContest = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.outcome === "complete") {
    feedersByContest.set(edge.toContestId, [...(feedersByContest.get(edge.toContestId) ?? []), edge.fromContestId]);
  }
  const groupOfContest = new Map<string, string>();
  for (const [contestId, feeders] of feedersByContest) groupOfContest.set(contestId,
    [...new Set(feeders.map((id) => nodes.get(id)?.stageId ?? id))].sort().join("+"));
  const groupOfSlot = (slotKey: string) => groupOfContest.get(slotKey.slice(0, slotKey.lastIndexOf("#")));

  const occupancy = new Map<string, Map<string, Set<OccupancyOrigin>>>();
  const inProgress = new Set<string>();
  const add = (target: Map<string, Set<OccupancyOrigin>>, entrantId: string, origins: Iterable<OccupancyOrigin>) => {
    const existing = target.get(entrantId) ?? new Set<OccupancyOrigin>();
    for (const origin of origins) existing.add(origin);
    target.set(entrantId, existing);
  };
  const visit = (contestId: string): ReadonlyMap<string, ReadonlySet<OccupancyOrigin>> => {
    const known = occupancy.get(contestId);
    if (known) return known;
    const node = nodes.get(contestId);
    if (!node || inProgress.has(contestId)) return new Map();
    inProgress.add(contestId);
    const entrants = new Map<string, Set<OccupancyOrigin>>();
    const feeders = feedersByContest.get(contestId);
    const qualifiers = new Set(feeders?.flatMap((feeder) => [...visit(feeder).keys()]) ?? []);
    node.slots.forEach((slot, index) => {
      if (slot.type === "entrant" && qualifiers.has(slot.entrantId)) {
        const origin: OccupancyOrigin = `QUALIFIED:${contestId}#${index}`;
        for (const entrantId of qualifiers) add(entrants, entrantId, [origin]);
      } else if (slot.type === "entrant") add(entrants, slot.entrantId, ["FIXED"]);
      else if (slot.type === "winner" || slot.type === "loser") {
        for (const [entrantId, origins] of visit(slot.contestId)) add(entrants, entrantId, origins);
      }
    });
    inProgress.delete(contestId);
    occupancy.set(contestId, entrants);
    return entrants;
  };
  for (const node of graph.nodes) visit(node.id);

  const slotOf = (origin: OccupancyOrigin) => origin.slice("QUALIFIED:".length);
  const canMeet = (left: ReadonlySet<OccupancyOrigin>, right: ReadonlySet<OccupancyOrigin>): boolean => {
    for (const a of left) for (const b of right) {
      if (a === "FIXED" || b === "FIXED" || a === b) return true;
      if (groupOfSlot(slotOf(a)) !== groupOfSlot(slotOf(b))) return true;
    }
    return false;
  };
  return { byContest: occupancy, canMeet };
}

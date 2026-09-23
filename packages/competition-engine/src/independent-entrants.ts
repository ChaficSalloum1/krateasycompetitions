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

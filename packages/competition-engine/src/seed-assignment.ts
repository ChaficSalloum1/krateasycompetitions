import { canonicalHash } from "@tournament-os/tournament-schema";
import type { Entrant } from "./types.js";

/** Seeding never selects entrants. A complete, approved order is an explicit input. */
export function assignSeeds(qualifiers: readonly Entrant[], orderedIds: readonly string[], policyVersion: string) {
  const ids = qualifiers.map(({ id }) => id);
  if (!policyVersion.trim() || new Set(ids).size !== ids.length || new Set(orderedIds).size !== ids.length
    || orderedIds.length !== ids.length || orderedIds.some((id) => !ids.includes(id))) {
    return { status: "BLOCKED" as const, entries: [] as Entrant[], findings: ["INVALID_SEED_INPUT"], proofHash: canonicalHash({ ids, orderedIds, policyVersion }) };
  }
  const entries = orderedIds.map((id, index) => ({ ...qualifiers.find((entry) => entry.id === id)!, seed: index + 1 }));
  return { status: "READY" as const, entries, findings: [] as string[], proofHash: canonicalHash({ ids, orderedIds, policyVersion, entries }) };
}

import { canonicalHash, deepFreeze } from "./canonical.js";
import { compileDefinition } from "./compile.js";
import { semanticDiff } from "./semantic-diff.js";
import { validateTournamentSpec } from "./validate.js";
import type { CompilationContext, RevisionPlan, TournamentDefinition, TournamentSpec } from "./types.js";

export function planRevision(
  current: TournamentSpec,
  proposedDefinition: TournamentDefinition,
  context: CompilationContext,
): Readonly<RevisionPlan> {
  if (context.revision !== current.metadata.revision + 1) throw new Error("Revision must increment exactly once");
  if (context.previousSpecHash !== current.metadata.compiledSpecHash) throw new Error("Revision must reference the active compiled hash");
  const candidate = compileDefinition(proposedDefinition, context) as TournamentSpec;
  const { metadata: _oldMetadata, ...oldDefinition } = current;
  const validation = validateTournamentSpec(candidate);
  const changes = semanticDiff(oldDefinition, proposedDefinition);
  return deepFreeze({
    id: canonicalHash({ fromHash: current.metadata.compiledSpecHash, candidateHash: candidate.metadata.compiledSpecHash, changes }),
    fromHash: current.metadata.compiledSpecHash,
    candidate,
    changes,
    validation,
    status: validation.valid ? "VALID" : "INVALID",
  });
}

export function applyRevision(plan: RevisionPlan): Readonly<TournamentSpec> {
  if (plan.status !== "VALID" || !plan.validation.valid) throw new Error("Cannot apply an invalid revision plan");
  return deepFreeze(structuredClone(plan.candidate));
}

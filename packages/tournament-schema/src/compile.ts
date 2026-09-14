import { canonicalHash, deepFreeze, sha256 } from "./canonical.js";
import type { CompilationContext, TournamentDefinition, TournamentSpec } from "./types.js";

export function compileDefinition(
  definition: TournamentDefinition,
  context: CompilationContext,
): Readonly<TournamentSpec> {
  const fingerprint = {
    definition,
    schemaVersion: context.schemaVersion,
    compilerVersion: context.compilerVersion,
    rulesetVersions: context.rulesetVersions,
  };
  const spec: TournamentSpec = {
    ...structuredClone(definition),
    metadata: {
      specId: context.specId,
      revision: context.revision,
      schemaVersion: context.schemaVersion,
      compilerVersion: context.compilerVersion,
      rulesetVersions: structuredClone(context.rulesetVersions),
      sourcePromptHash: sha256(context.sourcePrompt),
      compiledSpecHash: canonicalHash(fingerprint),
      createdAt: context.createdAt,
      ...(context.previousSpecHash ? { previousSpecHash: context.previousSpecHash } : {}),
    },
  };
  return deepFreeze(spec);
}

export function verifyCompiledHash(spec: TournamentSpec): boolean {
  const { metadata, ...definition } = spec;
  return metadata.compiledSpecHash === canonicalHash({
    definition,
    schemaVersion: metadata.schemaVersion,
    compilerVersion: metadata.compilerVersion,
    rulesetVersions: metadata.rulesetVersions,
  });
}

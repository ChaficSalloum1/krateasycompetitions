import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export type CapabilityLevel = "NATIVE" | "COMPOSABLE" | "EXTENSION_REQUIRED" | "UNSUPPORTED";

export interface CapabilityModuleEvidence {
  readonly capabilityId: string;
  readonly moduleId: string;
  readonly version: string;
  readonly executable: boolean;
  readonly deterministic: boolean;
  readonly independentlyVerified: boolean;
  readonly endToEnd: boolean;
  readonly evidence: readonly string[];
  readonly scaleEnvelope: string;
}

export interface CapabilityLedgerRequest {
  readonly declaredCapabilities: readonly string[];
  readonly requestedCapabilities?: readonly string[];
  readonly modules: readonly CapabilityModuleEvidence[];
}

export interface CapabilityRecord {
  readonly id: string;
  readonly level: CapabilityLevel;
  readonly reason: string;
  readonly module?: Readonly<CapabilityModuleEvidence>;
}

export interface CapabilityLedger {
  readonly capabilities: readonly CapabilityRecord[];
  readonly summary: Readonly<Record<CapabilityLevel, number>>;
  readonly proofHash: string;
}

function validateModule(module: CapabilityModuleEvidence): void {
  if (![module.capabilityId, module.moduleId, module.version, module.scaleEnvelope].every((value) => value.trim())) {
    throw new Error("Capability module evidence requires capability, module, version, and scale envelope");
  }
  if (module.evidence.length === 0 || module.evidence.some((entry) => !entry.trim())) {
    throw new Error(`Capability module ${module.moduleId} requires concrete verification evidence`);
  }
}

function deriveRecord(id: string, declared: ReadonlySet<string>, module: CapabilityModuleEvidence | undefined): CapabilityRecord {
  if (!declared.has(id)) return { id, level: "UNSUPPORTED", reason: "Capability is not declared by the current TournamentSpec schema." };
  if (!module) return { id, level: "EXTENSION_REQUIRED", reason: "Capability is declared but has no executable registered module." };
  if (!module.executable || !module.deterministic || !module.independentlyVerified) {
    return { id, level: "EXTENSION_REQUIRED", reason: "Module lacks executable deterministic independent verification evidence.", module };
  }
  if (!module.endToEnd) {
    return { id, level: "COMPOSABLE", reason: "Module is executable and verified but is not integrated through certification and operations.", module };
  }
  return { id, level: "NATIVE", reason: "Capability is executable, deterministic, independently verified, and integrated end to end.", module };
}

export function createCapabilityLedger(request: CapabilityLedgerRequest): Readonly<CapabilityLedger> {
  const declared = new Set(request.declaredCapabilities);
  if (declared.size !== request.declaredCapabilities.length || [...declared].some((id) => !id.trim())) {
    throw new Error("Declared capabilities must be non-empty and unique");
  }
  const modules = new Map<string, CapabilityModuleEvidence>();
  for (const module of request.modules) {
    validateModule(module);
    if (modules.has(module.capabilityId)) throw new Error(`Capability ${module.capabilityId} has ambiguous module evidence`);
    modules.set(module.capabilityId, structuredClone(module));
  }
  const requested = new Set(request.requestedCapabilities ?? request.declaredCapabilities);
  if ([...requested].some((id) => !id.trim())) throw new Error("Requested capabilities must be non-empty");
  const capabilities = [...requested].sort().map((id) => deriveRecord(id, declared, modules.get(id)));
  const summary: Record<CapabilityLevel, number> = { NATIVE: 0, COMPOSABLE: 0, EXTENSION_REQUIRED: 0, UNSUPPORTED: 0 };
  for (const capability of capabilities) summary[capability.level] += 1;
  const base = { capabilities, summary };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

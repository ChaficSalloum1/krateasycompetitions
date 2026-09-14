import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export const STRESS_LANES = [
  "COMPOSITION_FUZZING",
  "SOLVER_DIFFERENTIAL",
  "DYNAMIC_LIFECYCLE_FUZZING",
  "SCALE_ENVELOPES",
  "INFRASTRUCTURE_CHAOS",
  "SECURITY_TENANT_RED_TEAM",
  "HISTORICAL_LIVE_VALIDATION",
] as const;

export type StressLane = typeof STRESS_LANES[number];
export type EvidenceStatus = "CERTIFIED" | "REJECTED" | "UNKNOWN";

export const NON_NEGOTIABLE_GATES = [
  "ZERO_HARD_CONSTRAINT_VIOLATIONS",
  "ZERO_SILENT_POLICY_INVENTION",
  "ZERO_LOST_REQUIREMENTS",
  "ZERO_CROSS_TENANT_DATA_PATHS",
  "DETERMINISTIC_REPLAY",
  "EXACTLY_ONCE_ACKNOWLEDGED_COMMAND_EFFECT",
  "REPAIRS_INDEPENDENTLY_VALIDATED",
  "RESTORE_REPRODUCES_STATE_AND_PROOF_HASHES",
  "EVERY_FORMAT_HAS_NAMED_TESTED_ENVELOPE",
] as const;

export type NonNegotiableGate = typeof NON_NEGOTIABLE_GATES[number];

export interface StressLaneEvidence {
  readonly lane: StressLane;
  readonly status: EvidenceStatus;
  readonly evidenceId: string;
  readonly executedAt: string;
  readonly seed?: string;
  readonly cases: number;
  readonly checks: number;
  readonly envelope: string;
  readonly gateResults: Readonly<Partial<Record<NonNegotiableGate, boolean>>>;
  readonly findings: readonly string[];
  readonly artifactHash: string;
}

export interface HistoricalValidationRun {
  readonly eventId: string;
  readonly kind: "HISTORICAL_RECONSTRUCTION" | "LIVE_SHADOW" | "CONTROLLED_PILOT";
  readonly sourceKind: "REAL_EVENT" | "SYNTHETIC_FIXTURE";
  readonly sourceReference: string;
  readonly sport: string;
  readonly formatFamily: string;
  readonly status: EvidenceStatus;
  readonly proofHash: string;
  readonly manualFallbackReady?: boolean;
}

export interface HistoricalValidationReport {
  readonly status: EvidenceStatus;
  readonly historicalReconstructions: number;
  readonly liveShadows: number;
  readonly controlledPilots: number;
  readonly sports: readonly string[];
  readonly formatFamilies: readonly string[];
  readonly findings: readonly string[];
  readonly proofHash: string;
}

export interface StressCertificationReport {
  readonly status: EvidenceStatus;
  readonly lanes: readonly StressLaneEvidence[];
  readonly gateResults: Readonly<Record<NonNegotiableGate, boolean>>;
  readonly missingLanes: readonly StressLane[];
  readonly findings: readonly string[];
  readonly proofHash: string;
}

const canonicalTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

/**
 * Real-world validation is deliberately impossible to satisfy with generated
 * fixtures. That prevents a synthetic corpus from being marketed as field proof.
 */
export function evaluateHistoricalValidation(
  runs: readonly HistoricalValidationRun[],
  thresholds = { historicalReconstructions: 50, liveShadows: 10, controlledPilots: 1 },
): Readonly<HistoricalValidationReport> {
  if (!Number.isSafeInteger(thresholds.historicalReconstructions) || thresholds.historicalReconstructions < 1
    || !Number.isSafeInteger(thresholds.liveShadows) || thresholds.liveShadows < 1
    || !Number.isSafeInteger(thresholds.controlledPilots) || thresholds.controlledPilots < 1) {
    throw new Error("Historical validation thresholds must be positive safe integers.");
  }
  const findings: string[] = [];
  const identities = new Set<string>();
  for (const run of runs) {
    if (!run.eventId.trim() || identities.has(run.eventId)) findings.push(`Duplicate or missing event identity: ${run.eventId || "<missing>"}.`);
    identities.add(run.eventId);
    if (!run.sourceReference.trim()) findings.push(`${run.eventId}: a traceable source reference is required.`);
    if (!run.sport.trim() || !run.formatFamily.trim()) findings.push(`${run.eventId}: sport and format family are required.`);
    if (!validHash(run.proofHash)) findings.push(`${run.eventId}: proof hash is malformed.`);
    if (run.sourceKind === "REAL_EVENT" && run.kind === "CONTROLLED_PILOT" && run.manualFallbackReady !== true) {
      findings.push(`${run.eventId}: a controlled pilot requires a rehearsed manual fallback.`);
    }
  }
  const qualifying = runs.filter(({ sourceKind, status }) => sourceKind === "REAL_EVENT" && status === "CERTIFIED");
  const count = (kind: HistoricalValidationRun["kind"]) => qualifying.filter((run) => run.kind === kind).length;
  const historicalReconstructions = count("HISTORICAL_RECONSTRUCTION");
  const liveShadows = count("LIVE_SHADOW");
  const controlledPilots = qualifying.filter((run) => run.kind === "CONTROLLED_PILOT" && run.manualFallbackReady === true).length;
  if (historicalReconstructions < thresholds.historicalReconstructions) findings.push(`Need ${thresholds.historicalReconstructions - historicalReconstructions} more certified real historical reconstructions.`);
  if (liveShadows < thresholds.liveShadows) findings.push(`Need ${thresholds.liveShadows - liveShadows} more certified real live shadows.`);
  if (controlledPilots < thresholds.controlledPilots) findings.push(`Need ${thresholds.controlledPilots - controlledPilots} more certified controlled pilots with manual fallback.`);
  const malformed = findings.some((finding) => !finding.startsWith("Need "));
  const status: EvidenceStatus = malformed ? "REJECTED" : findings.length ? "UNKNOWN" : "CERTIFIED";
  const base = {
    status,
    historicalReconstructions,
    liveShadows,
    controlledPilots,
    sports: [...new Set(qualifying.map(({ sport }) => sport))].sort(),
    formatFamilies: [...new Set(qualifying.map(({ formatFamily }) => formatFamily))].sort(),
    findings: [...findings].sort(),
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

/** Delta-debug a failing ordered history without assuming command semantics. */
export function shrinkFailingSequence<T>(
  failing: readonly T[],
  stillFails: (candidate: readonly T[]) => boolean,
): readonly T[] {
  if (!stillFails(failing)) throw new Error("The supplied sequence does not reproduce the failure.");
  let result = [...failing];
  let chunkSize = Math.max(1, Math.ceil(result.length / 2));
  while (result.length > 1) {
    let reduced = false;
    for (let start = 0; start < result.length; start += chunkSize) {
      const candidate = result.slice(0, start).concat(result.slice(start + chunkSize));
      if (candidate.length && stillFails(candidate)) {
        result = candidate;
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (chunkSize === 1) break;
      chunkSize = Math.max(1, Math.floor(chunkSize / 2));
    } else {
      chunkSize = Math.min(chunkSize, Math.max(1, Math.ceil(result.length / 2)));
    }
  }
  return deepFreeze(result);
}

export function certifyStressProgram(evidence: readonly StressLaneEvidence[]): Readonly<StressCertificationReport> {
  const findings: string[] = [];
  const byLane = new Map<StressLane, StressLaneEvidence>();
  for (const item of evidence) {
    if (byLane.has(item.lane)) findings.push(`Duplicate evidence lane: ${item.lane}.`);
    byLane.set(item.lane, item);
    if (!item.evidenceId.trim() || !canonicalTimestamp(item.executedAt) || item.cases < 0 || item.checks < 0
      || !Number.isSafeInteger(item.cases) || !Number.isSafeInteger(item.checks) || !item.envelope.trim()
      || !validHash(item.artifactHash)) findings.push(`${item.lane}: malformed evidence envelope.`);
    if (item.status === "CERTIFIED" && item.findings.length) findings.push(`${item.lane}: certified evidence contains unresolved findings.`);
  }
  const missingLanes = STRESS_LANES.filter((lane) => !byLane.has(lane));
  for (const lane of missingLanes) findings.push(`Missing required evidence lane: ${lane}.`);
  const gateResults = Object.fromEntries(NON_NEGOTIABLE_GATES.map((gate) => [gate,
    STRESS_LANES.every((lane) => byLane.get(lane)?.status === "CERTIFIED" && byLane.get(lane)?.gateResults[gate] === true),
  ])) as Record<NonNegotiableGate, boolean>;
  for (const gate of NON_NEGOTIABLE_GATES) if (!gateResults[gate]) findings.push(`Unclosed non-negotiable gate: ${gate}.`);
  const rejected = evidence.some(({ status }) => status === "REJECTED")
    || findings.some((finding) => finding.includes("malformed") || finding.startsWith("Duplicate"));
  const status: EvidenceStatus = rejected ? "REJECTED"
    : missingLanes.length || evidence.some(({ status }) => status !== "CERTIFIED") || Object.values(gateResults).some((value) => !value)
      ? "UNKNOWN" : "CERTIFIED";
  const lanes = [...evidence].sort((left, right) => left.lane.localeCompare(right.lane));
  const base = { status, lanes, gateResults, missingLanes, findings: [...new Set(findings)].sort() };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

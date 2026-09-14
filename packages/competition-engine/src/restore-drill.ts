import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { verifyRestore, type BackupArtifact, type BackupManifest } from "./operations.js";

export interface AuthoritativeTruthProof {
  readonly organizationId: string;
  readonly streamId: string;
  readonly streamVersion: number;
  readonly eventHeadHash: string;
  readonly stateHash: string;
  readonly proofHashes: Readonly<Record<string, string>>;
}

export interface AuthoritativeRestoreDrillInput {
  readonly drillId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly recoveryPointAt: string;
  readonly sourceLatestCommittedAt: string;
  readonly maximumRecoveryTimeSeconds: number;
  readonly maximumDataLossSeconds: number;
  readonly expectedSchemaVersion: string;
  readonly manifest: BackupManifest;
  readonly restoredArtifacts: readonly BackupArtifact[];
  readonly sourceTruth: readonly AuthoritativeTruthProof[];
  readonly restoredTruth: readonly AuthoritativeTruthProof[];
}

export interface AuthoritativeRestoreDrillReport {
  readonly status: "VERIFIED" | "FAILED" | "UNKNOWN";
  readonly drillId: string;
  readonly manifestHash: string;
  readonly artifactStatus: "VERIFIED" | "FAILED" | "UNKNOWN";
  readonly recoveryTimeSeconds: number;
  readonly dataLossWindowSeconds: number;
  readonly sourceTruthHash: string | null;
  readonly restoredTruthHash: string | null;
  readonly verifiedTruthStreams: number;
  readonly issues: readonly string[];
  readonly qualification: "ISOLATED_RESTORE_EVIDENCE_NOT_CONTINUOUS_RECOVERY_GUARANTEE";
  readonly drillProofHash: string;
}

const digestPattern = /^[a-f0-9]{64}$/i;

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} must be a canonical ISO-8601 timestamp`);
  return parsed;
}

function normalizeTruth(input: readonly AuthoritativeTruthProof[], label: string): AuthoritativeTruthProof[] {
  const seen = new Set<string>();
  return input.map((truth) => {
    const identity = `${truth.organizationId}\u0000${truth.streamId}`;
    if (!truth.organizationId.trim() || !truth.streamId.trim() || seen.has(identity)) {
      throw new Error(`${label} requires unique organization and stream identities`);
    }
    seen.add(identity);
    if (!Number.isSafeInteger(truth.streamVersion) || truth.streamVersion < 1) throw new Error(`${label} stream versions must be positive safe integers`);
    if (!digestPattern.test(truth.eventHeadHash) || !digestPattern.test(truth.stateHash)) throw new Error(`${label} requires SHA-256 head and state hashes`);
    const proofHashes: Record<string, string> = {};
    for (const key of Object.keys(truth.proofHashes).sort()) {
      const value = truth.proofHashes[key]!;
      if (!key.trim() || !digestPattern.test(value)) throw new Error(`${label} named proof hashes must be SHA-256 values`);
      proofHashes[key] = value.toLowerCase();
    }
    return { ...truth, eventHeadHash: truth.eventHeadHash.toLowerCase(), stateHash: truth.stateHash.toLowerCase(), proofHashes };
  }).sort((left, right) => left.organizationId.localeCompare(right.organizationId) || left.streamId.localeCompare(right.streamId));
}

/**
 * Evaluates evidence produced by an isolated restore. It does not perform storage I/O;
 * deployment tooling must supply checksums and independently replayed truth proofs.
 */
export function runAuthoritativeRestoreDrill(input: AuthoritativeRestoreDrillInput): Readonly<AuthoritativeRestoreDrillReport> {
  if (!input.drillId.trim()) throw new Error("Restore drills require an id");
  const started = timestamp(input.startedAt, "startedAt");
  const completed = timestamp(input.completedAt, "completedAt");
  const recoveryPoint = timestamp(input.recoveryPointAt, "recoveryPointAt");
  const sourceLatest = timestamp(input.sourceLatestCommittedAt, "sourceLatestCommittedAt");
  if (completed < started) throw new Error("completedAt must not precede startedAt");
  if (recoveryPoint > sourceLatest) throw new Error("recoveryPointAt must not follow sourceLatestCommittedAt");
  for (const [label, value] of [["maximumRecoveryTimeSeconds", input.maximumRecoveryTimeSeconds], ["maximumDataLossSeconds", input.maximumDataLossSeconds]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  }

  const artifactVerification = verifyRestore(input.manifest, input.restoredArtifacts, { expectedSchemaVersion: input.expectedSchemaVersion });
  const sourceTruth = normalizeTruth(input.sourceTruth, "sourceTruth");
  const restoredTruth = normalizeTruth(input.restoredTruth, "restoredTruth");
  const recoveryTimeSeconds = (completed - started) / 1_000;
  const dataLossWindowSeconds = (sourceLatest - recoveryPoint) / 1_000;
  const sourceTruthHash = sourceTruth.length ? canonicalHash(sourceTruth) : null;
  const restoredTruthHash = restoredTruth.length ? canonicalHash(restoredTruth) : null;
  const issues = [...artifactVerification.issues];
  let evidenceMissing = artifactVerification.status === "UNKNOWN";

  if (sourceTruth.length === 0 || restoredTruth.length === 0) {
    issues.push("No authoritative truth proofs were supplied for both source and restored state");
    evidenceMissing = true;
  } else if (sourceTruthHash !== restoredTruthHash) {
    issues.push("Restored authoritative truth does not match the source truth");
  }
  if (recoveryTimeSeconds > input.maximumRecoveryTimeSeconds) {
    issues.push(`RTO target exceeded: ${recoveryTimeSeconds}s > ${input.maximumRecoveryTimeSeconds}s`);
  }
  if (dataLossWindowSeconds > input.maximumDataLossSeconds) {
    issues.push(`RPO target exceeded: ${dataLossWindowSeconds}s > ${input.maximumDataLossSeconds}s`);
  }

  const hardFailure = artifactVerification.status === "FAILED"
    || (sourceTruth.length > 0 && restoredTruth.length > 0 && sourceTruthHash !== restoredTruthHash)
    || recoveryTimeSeconds > input.maximumRecoveryTimeSeconds
    || dataLossWindowSeconds > input.maximumDataLossSeconds;
  const status: AuthoritativeRestoreDrillReport["status"] = hardFailure ? "FAILED" : evidenceMissing ? "UNKNOWN" : "VERIFIED";
  const base = {
    status,
    drillId: input.drillId,
    manifestHash: input.manifest.manifestHash,
    artifactStatus: artifactVerification.status,
    recoveryTimeSeconds,
    dataLossWindowSeconds,
    sourceTruthHash,
    restoredTruthHash,
    verifiedTruthStreams: status === "VERIFIED" ? sourceTruth.length : 0,
    issues: [...issues].sort(),
    qualification: "ISOLATED_RESTORE_EVIDENCE_NOT_CONTINUOUS_RECOVERY_GUARANTEE" as const,
  };
  return deepFreeze({ ...base, drillProofHash: canonicalHash(base) });
}

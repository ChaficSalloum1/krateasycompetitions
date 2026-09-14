import assert from "node:assert/strict";
import test from "node:test";
import { createBackupManifest } from "../src/operations.js";
import { runAuthoritativeRestoreDrill, type AuthoritativeTruthProof } from "../src/restore-drill.js";

const truth: AuthoritativeTruthProof = {
  organizationId: "org.1",
  streamId: "organization:org.1",
  streamVersion: 42,
  eventHeadHash: "a".repeat(64),
  stateHash: "b".repeat(64),
  proofHashes: {
    publicationCertificate: "c".repeat(64),
    schedule: "d".repeat(64),
  },
};
const manifest = createBackupManifest({
  backupId: "backup.2026-09-12",
  createdAt: "2026-09-12T11:55:00.000Z",
  schemaVersion: "1.1.0",
  artifacts: [
    { path: "event-ledger.jsonl", bytes: 100, sha256: "e".repeat(64) },
    { path: "outbox.jsonl", bytes: 50, sha256: "f".repeat(64) },
  ],
});

test("restore drill verifies artifacts, recovery objectives, and identical authoritative proof hashes", () => {
  const report = runAuthoritativeRestoreDrill({
    drillId: "restore-drill.1",
    startedAt: "2026-09-12T12:00:00.000Z",
    completedAt: "2026-09-12T12:20:00.000Z",
    recoveryPointAt: "2026-09-12T11:55:00.000Z",
    sourceLatestCommittedAt: "2026-09-12T12:00:00.000Z",
    maximumRecoveryTimeSeconds: 3_600,
    maximumDataLossSeconds: 900,
    expectedSchemaVersion: "1.1.0",
    manifest,
    restoredArtifacts: [...manifest.artifacts].reverse(),
    sourceTruth: [truth],
    restoredTruth: [{ ...truth, proofHashes: { schedule: "d".repeat(64), publicationCertificate: "c".repeat(64) } }],
  });

  assert.equal(report.status, "VERIFIED");
  assert.equal(report.recoveryTimeSeconds, 1_200);
  assert.equal(report.dataLossWindowSeconds, 300);
  assert.equal(report.sourceTruthHash, report.restoredTruthHash);
  assert.deepEqual(report.issues, []);
  assert.match(report.drillProofHash, /^[a-f0-9]{64}$/);
});

test("restore drill fails when replayed truth differs even if every artifact checksum matches", () => {
  const report = runAuthoritativeRestoreDrill({
    drillId: "restore-drill.2",
    startedAt: "2026-09-12T12:00:00.000Z",
    completedAt: "2026-09-12T13:30:00.000Z",
    recoveryPointAt: "2026-09-12T11:30:00.000Z",
    sourceLatestCommittedAt: "2026-09-12T12:00:00.000Z",
    maximumRecoveryTimeSeconds: 3_600,
    maximumDataLossSeconds: 900,
    expectedSchemaVersion: "1.1.0",
    manifest,
    restoredArtifacts: manifest.artifacts,
    sourceTruth: [truth],
    restoredTruth: [{ ...truth, stateHash: "0".repeat(64) }],
  });

  assert.equal(report.status, "FAILED");
  assert.match(report.issues.join("\n"), /authoritative truth does not match/);
  assert.match(report.issues.join("\n"), /RPO target exceeded/);
  assert.match(report.issues.join("\n"), /RTO target exceeded/);
});

test("restore drill stays unknown when no replayed truth was supplied", () => {
  const report = runAuthoritativeRestoreDrill({
    drillId: "restore-drill.3",
    startedAt: "2026-09-12T12:00:00.000Z",
    completedAt: "2026-09-12T12:01:00.000Z",
    recoveryPointAt: "2026-09-12T12:00:00.000Z",
    sourceLatestCommittedAt: "2026-09-12T12:00:00.000Z",
    maximumRecoveryTimeSeconds: 3_600,
    maximumDataLossSeconds: 900,
    expectedSchemaVersion: "1.1.0",
    manifest,
    restoredArtifacts: manifest.artifacts,
    sourceTruth: [],
    restoredTruth: [],
  });

  assert.equal(report.status, "UNKNOWN");
  assert.match(report.issues.join("\n"), /No authoritative truth proofs/);
});

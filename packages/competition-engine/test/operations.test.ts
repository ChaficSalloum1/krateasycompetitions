import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateReadiness,
  createBackupManifest,
  evaluateSlo,
  validateTelemetryEvent,
  verifyRestore,
} from "../src/operations.js";

test("readiness is deterministic and healthy only when every declared dependency is known", () => {
  const result = aggregateReadiness([
    { name: "worker", critical: false, status: "HEALTHY" },
    { name: "database", critical: true, status: "HEALTHY" },
  ]);

  assert.equal(result.status, "READY");
  assert.deepEqual(result.checks.map(({ name }) => name), ["database", "worker"]);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.summary, "2/2 checks healthy");
});

test("readiness fails closed for absent, duplicate, and unknown evidence", () => {
  assert.equal(aggregateReadiness([]).status, "UNKNOWN");
  assert.deepEqual(aggregateReadiness([]).reasons, ["No readiness checks were supplied"]);

  const unknown = aggregateReadiness([
    { name: "database", critical: true, status: "UNKNOWN", detail: "probe timed out" },
  ]);
  assert.equal(unknown.status, "UNKNOWN");
  assert.deepEqual(unknown.reasons, ["database: probe timed out"]);

  assert.throws(() => aggregateReadiness([
    { name: "database", critical: true, status: "HEALTHY" },
    { name: " database ", critical: false, status: "HEALTHY" },
  ]), /unique names/);
});

test("critical failures are unready while non-critical damage is degraded", () => {
  const unready = aggregateReadiness([
    { name: "cache", critical: false, status: "UNHEALTHY", detail: "evicted" },
    { name: "database", critical: true, status: "UNHEALTHY", detail: "unreachable" },
  ]);
  assert.equal(unready.status, "UNREADY");
  assert.deepEqual(unready.reasons, ["cache: evicted", "database: unreachable"]);

  const degraded = aggregateReadiness([
    { name: "database", critical: true, status: "HEALTHY" },
    { name: "publication-worker", critical: false, status: "DEGRADED", detail: "backlog above target" },
  ]);
  assert.equal(degraded.status, "DEGRADED");
});

test("telemetry validation preserves safe structure and redacts secret and personal fields recursively", () => {
  const result = validateTelemetryEvent({
    name: "publication.failed",
    service: "compiler-api",
    severity: "ERROR",
    occurredAt: "2026-09-05T12:00:00.000Z",
    traceId: "abcdef0123456789",
    attributes: {
      attempt: 2,
      nested: { apiKey: "secret", region: "eu-west-1" },
      userEmail: "director@example.test",
      authorization: "Bearer secret",
    },
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.event?.attributes, {
    attempt: 2,
    authorization: "[REDACTED]",
    nested: { apiKey: "[REDACTED]", region: "eu-west-1" },
    userEmail: "[REDACTED]",
  });
  assert.equal(Object.isFrozen(result.event), true);
});

test("telemetry rejects malformed, oversized, and structurally unsafe events", () => {
  const invalid = validateTelemetryEvent({
    name: "Not a metric!",
    service: "",
    severity: "LOUD",
    occurredAt: "sometime",
    attributes: { huge: "x".repeat(5_000), bad: Number.NaN },
  });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.event, undefined);
  assert.match(invalid.issues.join("\n"), /name/);
  assert.match(invalid.issues.join("\n"), /service/);
  assert.match(invalid.issues.join("\n"), /severity/);
  assert.match(invalid.issues.join("\n"), /occurredAt/);
  assert.match(invalid.issues.join("\n"), /finite/);
  assert.match(invalid.issues.join("\n"), /4096/);
});

test("backup manifests are canonical, sorted, immutable, and content-addressed", () => {
  const manifest = createBackupManifest({
    backupId: "backup-2026-09-05",
    createdAt: "2026-09-05T12:00:00.000Z",
    schemaVersion: "3",
    artifacts: [
      { path: "events/02.jsonl", bytes: 20, sha256: "b".repeat(64) },
      { path: "events/01.jsonl", bytes: 10, sha256: "a".repeat(64) },
    ],
  });

  assert.deepEqual(manifest.artifacts.map(({ path }) => path), ["events/01.jsonl", "events/02.jsonl"]);
  assert.equal(manifest.totalBytes, 30);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(manifest), true);
  assert.throws(() => createBackupManifest({
    backupId: "duplicate",
    createdAt: "2026-09-05T12:00:00.000Z",
    schemaVersion: "3",
    artifacts: [
      { path: "same", bytes: 1, sha256: "a".repeat(64) },
      { path: "same", bytes: 1, sha256: "a".repeat(64) },
    ],
  }), /unique paths/);
});

test("restore verification proves completeness, size, checksum, and expected schema", () => {
  const manifest = createBackupManifest({
    backupId: "backup-1",
    createdAt: "2026-09-05T12:00:00.000Z",
    schemaVersion: "3",
    artifacts: [
      { path: "events.jsonl", bytes: 10, sha256: "a".repeat(64) },
      { path: "snapshots.json", bytes: 20, sha256: "b".repeat(64) },
    ],
  });

  const verified = verifyRestore(manifest, [
    { path: "snapshots.json", bytes: 20, sha256: "b".repeat(64) },
    { path: "events.jsonl", bytes: 10, sha256: "a".repeat(64) },
  ], { expectedSchemaVersion: "3" });
  assert.equal(verified.status, "VERIFIED");
  assert.deepEqual(verified.issues, []);
  assert.equal(verified.verifiedArtifacts, 2);

  const failed = verifyRestore(manifest, [
    { path: "events.jsonl", bytes: 9, sha256: "c".repeat(64) },
    { path: "unexpected", bytes: 1, sha256: "d".repeat(64) },
  ], { expectedSchemaVersion: "4" });
  assert.equal(failed.status, "FAILED");
  assert.deepEqual(failed.issues, [
    "Artifact events.jsonl has 9 bytes; expected 10",
    "Artifact events.jsonl checksum does not match",
    "Artifact snapshots.json is missing",
    "Artifact unexpected is not present in the manifest",
    "Schema version 3 does not match expected version 4",
  ]);
  assert.equal(failed.verifiedArtifacts, 0);

  assert.equal(verifyRestore(manifest, [], { expectedSchemaVersion: "3" }).status, "UNKNOWN");

  const tamperedManifest = {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact, index) => index === 0 ? { ...artifact, bytes: 11 } : { ...artifact }),
  };
  const tampered = verifyRestore(tamperedManifest, [
    { path: "events.jsonl", bytes: 11, sha256: "a".repeat(64) },
    { path: "snapshots.json", bytes: 20, sha256: "b".repeat(64) },
  ], { expectedSchemaVersion: "3" });
  assert.equal(tampered.status, "FAILED");
  assert.match(tampered.issues.join("\n"), /Manifest hash does not match/);
});

test("SLO evaluation exposes a deterministic error budget and fails closed without observations", () => {
  const healthy = evaluateSlo({ objective: 0.99, totalEvents: 1_000, badEvents: 2, warningBudgetFraction: 0.5 });
  assert.equal(healthy.status, "READY");
  assert.equal(healthy.allowedBadEvents, 10);
  assert.equal(healthy.remainingBadEvents, 8);
  assert.equal(healthy.achieved, 0.998);
  assert.equal(healthy.budgetConsumedFraction, 0.2);

  const degraded = evaluateSlo({ objective: 0.99, totalEvents: 1_000, badEvents: 6, warningBudgetFraction: 0.5 });
  assert.equal(degraded.status, "DEGRADED");
  assert.equal(degraded.remainingBadEvents, 4);

  const exhausted = evaluateSlo({ objective: 0.99, totalEvents: 1_000, badEvents: 10, warningBudgetFraction: 0.5 });
  assert.equal(exhausted.status, "UNREADY");
  assert.equal(exhausted.remainingBadEvents, 0);

  const unknown = evaluateSlo({ objective: 0.999, totalEvents: 0, badEvents: 0 });
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(unknown.achieved, undefined);
  assert.equal(unknown.budgetConsumedFraction, undefined);
});

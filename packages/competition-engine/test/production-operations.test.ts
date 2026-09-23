import assert from "node:assert/strict";
import test from "node:test";
import {
  assessProductionReadiness,
  createLivenessReport,
  createStructuredTelemetryEmitter,
  type ProductionProbe,
} from "../src/production-operations.js";

const checkedAt = "2026-09-12T12:00:00.000Z";
const healthyRequiredProbes: ProductionProbe[] = [
  "cp-sat-solver",
  "database",
  "event-ledger",
  "identity-provider",
  "kms-provider",
  "outbox-worker",
  "secret-provider",
].map((name) => ({ name, required: true, status: "HEALTHY", observedAt: "2026-09-12T11:59:59.000Z" }));

test("production readiness routes traffic only with fresh evidence for every required dependency", () => {
  const ready = assessProductionReadiness(healthyRequiredProbes, { checkedAt, maximumEvidenceAgeMs: 5_000 });
  assert.equal(ready.status, "READY");
  assert.equal(ready.routeTraffic, true);
  assert.equal(ready.httpStatus, 200);
  assert.match(ready.proofHash, /^[a-f0-9]{64}$/);

  const missing = assessProductionReadiness(healthyRequiredProbes.filter(({ name }) => name !== "kms-provider"), {
    checkedAt,
    maximumEvidenceAgeMs: 5_000,
  });
  assert.equal(missing.status, "UNKNOWN");
  assert.equal(missing.routeTraffic, false);
  assert.equal(missing.httpStatus, 503);
  assert.match(missing.reasons.join("\n"), /kms-provider: required probe is missing/);
});

test("stale evidence is unknown and explicit unhealthy evidence is unready", () => {
  const stale = assessProductionReadiness(healthyRequiredProbes.map((probe) => probe.name === "database"
    ? { ...probe, observedAt: "2026-09-12T11:00:00.000Z" } : probe), { checkedAt, maximumEvidenceAgeMs: 5_000 });
  assert.equal(stale.status, "UNKNOWN");
  assert.match(stale.reasons.join("\n"), /database: evidence is stale/);

  const failed = assessProductionReadiness(healthyRequiredProbes.map((probe) => probe.name === "event-ledger"
    ? { ...probe, status: "UNHEALTHY" as const, detail: "hash chain mismatch" } : probe), { checkedAt, maximumEvidenceAgeMs: 5_000 });
  assert.equal(failed.status, "UNREADY");
  assert.match(failed.reasons.join("\n"), /hash chain mismatch/);
});

test("liveness proves only that the process is responding", () => {
  const report = createLivenessReport("2026-09-12T11:58:00.000Z", checkedAt);
  assert.equal(report.status, "LIVE");
  assert.equal(report.uptimeSeconds, 120);
  assert.equal("routeTraffic" in report, false);
});

test("structured telemetry emitter redacts sensitive attributes and rejects unsafe events", () => {
  const emitted: unknown[] = [];
  const emit = createStructuredTelemetryEmitter((event) => emitted.push(event));
  const accepted = emit({
    name: "restore.verified",
    service: "competition-operations",
    severity: "INFO",
    occurredAt: checkedAt,
    attributes: { organizationId: "org.1", accessToken: "should-not-leak", artifactCount: 8 },
  });
  assert.equal(accepted.attributes.accessToken, "[REDACTED]");
  assert.deepEqual(emitted, [accepted]);
  assert.throws(() => emit({ name: "Bad Event", service: "competition-operations" }), /Unsafe telemetry event/);
});

test("a deployment that omits the CP-SAT solver probe does not route traffic", () => {
  const missing = assessProductionReadiness(healthyRequiredProbes.filter(({ name }) => name !== "cp-sat-solver"),
    { checkedAt, maximumEvidenceAgeMs: 5_000 });
  assert.equal(missing.routeTraffic, false);
  assert.match(missing.reasons.join("\n"), /cp-sat-solver: required probe is missing/);
});

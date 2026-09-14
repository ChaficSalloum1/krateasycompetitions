import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { StagePrimitive } from "@tournament-os/tournament-schema";
import { auditCapabilityConformance, canonicalCapabilityFixtures } from "../src/capability-conformance.js";
import { tournamentFormatCapabilities } from "../src/format-capabilities.js";

test("canonical conformance fixtures close every declared ledger primitive exactly once", () => {
  const fixtures = canonicalCapabilityFixtures();
  const ledgerIds = tournamentFormatCapabilities().capabilities.map(({ id }) => id).sort();
  assert.equal(fixtures.length, 16);
  assert.equal(new Set(fixtures.map(({ primitive }) => primitive)).size, fixtures.length);
  assert.deepEqual(fixtures.map(({ primitive }) => primitive).sort(), ledgerIds);
  assert.ok(fixtures.every(({ scaleEnvelope }) => scaleEnvelope.length > 30));
  assert.throws(() => Reflect.apply(Array.prototype.push, fixtures, [{ primitive: "fake" }]));
});

test("all 16 canonical fixtures execute through their real primary path with deterministic replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tos-conformance-"));
  const audit = await auditCapabilityConformance({ dynamicDatabaseDirectory: directory });
  assert.equal(audit.status, "CERTIFIED", JSON.stringify(audit.findings));
  assert.equal(audit.fixtureCount, 16);
  assert.equal(audit.ledgerCount, 16);
  assert.deepEqual(Object.fromEntries(audit.records.map(({ primaryPath }) => [primaryPath,
    audit.records.filter((record) => record.primaryPath === primaryPath).length])), { STATIC_SCENARIO: 11, DYNAMIC_ORCHESTRATOR: 5 });
  assert.ok(audit.records.every(({ status, ledgerLevel, executionHash, replayHash }) =>
    status === "CERTIFIED" && ledgerLevel === "NATIVE" && executionHash === replayHash));
  assert.ok(audit.records.filter(({ metamorphicCheck }) => metamorphicCheck === "ENTRANT_DECLARATION_ORDER")
    .every(({ executionHash, metamorphicHash }) => executionHash === metamorphicHash));
  assert.ok(audit.records.filter(({ metamorphicCheck }) => metamorphicCheck === "SEEDED_POOL_ORDER_SIGNIFICANT")
    .every(({ metamorphicHash }) => metamorphicHash === null));
  assert.ok(audit.records.filter(({ primaryPath }) => primaryPath === "DYNAMIC_ORCHESTRATOR")
    .every(({ metamorphicCheck, metamorphicHash }) => metamorphicCheck === "AUDIT_ORDER_SIGNIFICANT" && metamorphicHash === null));
  assert.match(audit.auditHash, /^[a-f0-9]{64}$/);
  assert.match(audit.scaleStatement, /not evidence for arbitrary sport/);
});

test("the entire audit is byte-deterministic across fresh transactional stores", async () => {
  const firstDirectory = await mkdtemp(join(tmpdir(), "tos-conformance-a-"));
  const secondDirectory = await mkdtemp(join(tmpdir(), "tos-conformance-b-"));
  const first = await auditCapabilityConformance({ dynamicDatabaseDirectory: firstDirectory });
  const second = await auditCapabilityConformance({ dynamicDatabaseDirectory: secondDirectory });
  assert.equal(first.auditHash, second.auditHash);
  assert.deepEqual(first, second);
});

test("missing primary evidence rejects ledger closure instead of silently shrinking the audit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tos-conformance-missing-"));
  const included = canonicalCapabilityFixtures().map(({ primitive }) => primitive).filter((primitive) => primitive !== "swiss") as StagePrimitive[];
  const audit = await auditCapabilityConformance({ dynamicDatabaseDirectory: directory, includedFixtures: included });
  assert.equal(audit.status, "REJECTED");
  assert.equal(audit.fixtureCount, 15);
  assert.ok(audit.findings.some(({ code, message }) => code === "MISSING_PRIMARY_FIXTURE" && message.includes("swiss")));
  assert.ok(!audit.records.some(({ primitive }) => primitive === "swiss"));
});

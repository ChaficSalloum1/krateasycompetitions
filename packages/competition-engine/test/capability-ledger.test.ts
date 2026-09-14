import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityLedger } from "../src/capability-ledger.js";

test("capability levels are derived from executable evidence rather than schema declarations", () => {
  const ledger = createCapabilityLedger({
    declaredCapabilities: ["single_elimination", "swiss", "time_trial"],
    requestedCapabilities: ["single_elimination", "swiss", "time_trial", "battle_royale"],
    modules: [
      {
        capabilityId: "single_elimination", moduleId: "static-dag", version: "1.0.0",
        executable: true, deterministic: true, independentlyVerified: true, endToEnd: true,
        evidence: ["topology-2-64", "scenario-certification"], scaleEnvelope: "2-64 entrants",
      },
      {
        capabilityId: "swiss", moduleId: "swiss-round", version: "1.0.0",
        executable: true, deterministic: true, independentlyVerified: true, endToEnd: false,
        evidence: ["swiss-round-tests"], scaleEnvelope: "2-32 entrants per round",
      },
    ],
  });

  assert.deepEqual(Object.fromEntries(ledger.capabilities.map(({ id, level }) => [id, level])), {
    battle_royale: "UNSUPPORTED",
    single_elimination: "NATIVE",
    swiss: "COMPOSABLE",
    time_trial: "EXTENSION_REQUIRED",
  });
  assert.equal(ledger.summary.NATIVE, 1);
  assert.equal(ledger.summary.COMPOSABLE, 1);
  assert.equal(ledger.summary.EXTENSION_REQUIRED, 1);
  assert.equal(ledger.summary.UNSUPPORTED, 1);
  assert.match(ledger.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(ledger));
});

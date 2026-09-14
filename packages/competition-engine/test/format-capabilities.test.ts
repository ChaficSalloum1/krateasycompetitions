import assert from "node:assert/strict";
import test from "node:test";
import { tournamentFormatCapabilities } from "../src/format-capabilities.js";

test("the format truth ledger promotes only primary end-to-end certified schema primitives", () => {
  const ledger = tournamentFormatCapabilities();
  const levels = Object.fromEntries(ledger.capabilities.map(({ id, level }) => [id, level]));

  assert.equal(levels.groups, "NATIVE");
  assert.equal(levels.single_elimination, "NATIVE");
  assert.equal(levels.double_elimination, "NATIVE");
  assert.equal(levels.repechage, "NATIVE");
  assert.equal(levels.swiss, "NATIVE");
  assert.equal(levels.ladder, "NATIVE");
  assert.equal(levels.qualifying_heat, "NATIVE");
  assert.equal(levels.time_trial, "NATIVE");
  assert.equal(levels.ranking_stage, "NATIVE");
  assert.equal(levels.custom_graph, "NATIVE");
  assert.equal(levels.play_in, "NATIVE");
  assert.equal(levels.placement, "NATIVE");
  assert.equal(ledger.capabilities.length, 16);
  assert.ok(ledger.capabilities.every(({ module, level }) =>
    level === "EXTENSION_REQUIRED" || Boolean(module?.evidence.length && module.scaleEnvelope)));
  assert.match(ledger.proofHash, /^[a-f0-9]{64}$/);
});

test("the truth ledger can include out-of-schema requests as unsupported", () => {
  const ledger = tournamentFormatCapabilities(["groups", "quidditch_multiball"]);
  assert.deepEqual(ledger.capabilities.map(({ id, level }) => [id, level]), [
    ["groups", "NATIVE"],
    ["quidditch_multiball", "UNSUPPORTED"],
  ]);
});

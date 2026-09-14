import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import {
  NON_NEGOTIABLE_GATES,
  STRESS_LANES,
  certifyStressProgram,
  evaluateHistoricalValidation,
  shrinkFailingSequence,
  type HistoricalValidationRun,
  type StressLaneEvidence,
} from "../src/stress-certification.js";

const evidenceFor = (lane: StressLaneEvidence["lane"]): StressLaneEvidence => ({
  lane,
  status: "CERTIFIED",
  evidenceId: `evidence.${lane.toLowerCase()}`,
  executedAt: "2026-09-07T12:00:00.000Z",
  seed: "stress-v1",
  cases: 100,
  checks: 1_000,
  envelope: "Finite executable test envelope; not an unbounded-capacity claim.",
  gateResults: Object.fromEntries(NON_NEGOTIABLE_GATES.map((gate) => [gate, true])),
  findings: [],
  artifactHash: canonicalHash({ lane }),
});

test("stress certification fails open to UNKNOWN until every lane and every gate has evidence", () => {
  const partial = certifyStressProgram([evidenceFor("COMPOSITION_FUZZING")]);
  assert.equal(partial.status, "UNKNOWN");
  assert.equal(partial.missingLanes.length, STRESS_LANES.length - 1);
  assert.ok(Object.values(partial.gateResults).every((value) => value === false));

  const complete = certifyStressProgram(STRESS_LANES.map(evidenceFor));
  assert.equal(complete.status, "CERTIFIED");
  assert.deepEqual(complete.missingLanes, []);
  assert.ok(Object.values(complete.gateResults).every(Boolean));
  assert.equal(certifyStressProgram([...STRESS_LANES].reverse().map(evidenceFor)).proofHash, complete.proofHash);
});

test("a single rejected lane blocks certification even if every claimed gate is green", () => {
  const evidence = STRESS_LANES.map(evidenceFor);
  evidence[2] = { ...evidence[2]!, status: "REJECTED", findings: ["lost acknowledged command"] };
  const report = certifyStressProgram(evidence);
  assert.equal(report.status, "REJECTED");
});

test("historical validation cannot be counterfeited with generated fixtures", () => {
  const synthetic: HistoricalValidationRun[] = Array.from({ length: 70 }, (_, index) => ({
    eventId: `synthetic.${index}`,
    kind: index < 55 ? "HISTORICAL_RECONSTRUCTION" : index < 67 ? "LIVE_SHADOW" : "CONTROLLED_PILOT",
    sourceKind: "SYNTHETIC_FIXTURE",
    sourceReference: `fixture:${index}`,
    sport: "pickleball",
    formatFamily: "groups_to_knockout",
    status: "CERTIFIED",
    proofHash: canonicalHash({ index }),
    manualFallbackReady: true,
  }));
  const report = evaluateHistoricalValidation(synthetic);
  assert.equal(report.status, "UNKNOWN");
  assert.equal(report.historicalReconstructions, 0);
  assert.equal(report.liveShadows, 0);
  assert.equal(report.controlledPilots, 0);
});

test("real historical, shadow, and manually recoverable pilot evidence closes only the declared threshold", () => {
  const real = (kind: HistoricalValidationRun["kind"], count: number): HistoricalValidationRun[] =>
    Array.from({ length: count }, (_, index) => ({
      eventId: `${kind}.${index}`,
      kind,
      sourceKind: "REAL_EVENT",
      sourceReference: `archive-or-observer:${kind}:${index}`,
      sport: index % 2 ? "badminton" : "golf",
      formatFamily: index % 2 ? "round_robin_to_knockout" : "stroke_play",
      status: "CERTIFIED",
      proofHash: canonicalHash({ kind, index }),
      ...(kind === "CONTROLLED_PILOT" ? { manualFallbackReady: true } : {}),
    }));
  const report = evaluateHistoricalValidation([
    ...real("HISTORICAL_RECONSTRUCTION", 50),
    ...real("LIVE_SHADOW", 10),
    ...real("CONTROLLED_PILOT", 1),
  ]);
  assert.equal(report.status, "CERTIFIED");
  assert.deepEqual(report.sports, ["badminton", "golf"]);
});

test("failure shrinking returns a one-command reproducer when one command is sufficient", () => {
  const sequence = ["check-in", "score", "duplicate-webhook", "appeal", "restore"];
  const minimal = shrinkFailingSequence(sequence, (candidate) => candidate.includes("duplicate-webhook"));
  assert.deepEqual(minimal, ["duplicate-webhook"]);
  assert.throws(() => shrinkFailingSequence(sequence, () => false), /does not reproduce/);
});

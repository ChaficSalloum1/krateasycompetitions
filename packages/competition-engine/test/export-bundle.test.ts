import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, sha256, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createEntrants } from "../src/graph.js";
import { runScenario } from "../src/scenario.js";
import { exportCertificationBundle } from "../src/export-bundle.js";

const spec = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), {
  specId: "export.reference",
  revision: 4,
  schemaVersion: "1.0.0",
  compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" },
  sourcePrompt: "certified export fixture",
  createdAt: "2026-09-05T09:00:00.000Z",
}) as TournamentSpec;

const certifiedScenario = () => {
  const definition = spec();
  return runScenario(definition, createEntrants(definition), "export-replay-seed");
};

test("a certified scenario exports immutable human-readable Markdown and machine-readable JSON", () => {
  const scenario = certifiedScenario();
  const bundle = exportCertificationBundle(scenario, {
    baseName: "play-and-konnect-r4",
    generatedAt: "2026-09-05T10:00:00.000Z",
  });

  assert.equal(bundle.markdown.fileName, "play-and-konnect-r4.certification.md");
  assert.equal(bundle.json.fileName, "play-and-konnect-r4.certification.json");
  assert.equal(bundle.markdown.mediaType, "text/markdown; charset=utf-8");
  assert.equal(bundle.json.mediaType, "application/json");
  assert.match(bundle.markdown.content, /^# TournamentOS Certification Audit Bundle/m);
  assert.match(bundle.markdown.content, /## Requirements/);
  assert.match(bundle.markdown.content, /## Participant paths/);
  assert.match(bundle.markdown.content, new RegExp(scenario.certification.certificationHash));
  assert.match(bundle.markdown.content, /\| R1 \| HARD \| SATISFIED \|/);

  const machine = JSON.parse(bundle.json.content) as Record<string, any>;
  assert.equal(machine.identity.certificationHash, scenario.certification.certificationHash);
  assert.equal(machine.identity.specHash, scenario.spec.metadata.compiledSpecHash);
  assert.equal(machine.versions.compiler, "0.1.0");
  assert.equal(machine.requirements.length, scenario.spec.requirements.length);
  assert.equal(machine.participantPaths.length, 47);
  assert.equal(machine.replay.simulationSeed, "export-replay-seed");
  assert.deepEqual(machine.scheduleAudit, scenario.schedule.audit);

  assert.match(bundle.markdown.sha256, /^[a-f0-9]{64}$/);
  assert.match(bundle.json.sha256, /^[a-f0-9]{64}$/);
  assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.markdown.sha256, sha256(bundle.markdown.content));
  assert.equal(bundle.json.sha256, sha256(bundle.json.content));
  const { bundleHash, ...bundleProof } = bundle;
  assert.equal(bundleHash, canonicalHash(bundleProof));
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.json), true);
});

test("an uncertified scenario cannot cross the export boundary", () => {
  const rejected = structuredClone(certifiedScenario());
  rejected.certification.status = "REJECTED";
  rejected.certification.statement = "Rejected fixture";

  assert.throws(() => exportCertificationBundle(rejected, {
    baseName: "must-not-export",
  }), /certified scenarios/);
});

test("tampered specification, graph, schedule, simulation, or certification hashes reject export", () => {
  const options = { baseName: "tampered" };

  const badSpec = structuredClone(certifiedScenario());
  badSpec.spec.sport.id = "tampered-sport";
  assert.throws(() => exportCertificationBundle(badSpec, options), /specification hash/);

  const badGraph = structuredClone(certifiedScenario());
  badGraph.graph.nodes[0]!.round = "tampered-round";
  assert.throws(() => exportCertificationBundle(badGraph, options), /graph hash/);

  const badSchedule = structuredClone(certifiedScenario());
  badSchedule.schedule.contests[0]!.start = "2026-09-05T00:00:00.000Z";
  assert.throws(() => exportCertificationBundle(badSchedule, options), /schedule hash/);

  const badValidation = structuredClone(certifiedScenario());
  badValidation.schedule.audit.validationHash = "invalid-shadow-validation-hash";
  assert.throws(() => exportCertificationBundle(badValidation, options), /validation hash/);

  const badSimulation = structuredClone(certifiedScenario());
  badSimulation.simulation!.results[0]!.scoreFor[0] += 1;
  assert.throws(() => exportCertificationBundle(badSimulation, options), /simulation hash/);

  const badCertification = structuredClone(certifiedScenario());
  badCertification.certification.statement = "tampered certification";
  assert.throws(() => exportCertificationBundle(badCertification, options), /certification hash/);
});

test("unsafe artifact names and invalid deterministic timestamps are rejected without filesystem access", () => {
  const scenario = certifiedScenario();
  for (const baseName of ["", "../secret", "folder/name", "folder\\name", ".hidden", "name with spaces", "two..dots", "x".repeat(81)]) {
    assert.throws(() => exportCertificationBundle(scenario, { baseName }), /safe base name/, baseName);
  }
  assert.throws(() => exportCertificationBundle(scenario, {
    baseName: "safe-name",
    generatedAt: "not-a-timestamp",
  }), /generatedAt/);
});

test("self-consistent forged hashes cannot bypass independent certification", () => {
  const forged = structuredClone(certifiedScenario());
  const injectedFinding = {
    code: "TSC-FORGED",
    severity: "ERROR" as const,
    path: "/graph",
    message: "A hard graph invariant failed.",
  };
  forged.graph.findings.push(injectedFinding);
  forged.certification.graphHash = canonicalHash(forged.graph);
  forged.certification.findings.push(injectedFinding);
  forged.certification.status = "CERTIFIED";
  const { certificationHash: _oldHash, ...certificationProof } = forged.certification;
  void _oldHash;
  forged.certification.certificationHash = canonicalHash(certificationProof);

  assert.throws(() => exportCertificationBundle(forged, {
    baseName: "forged-but-self-consistent",
  }), /independent certification/);
});

test("identical replay inputs produce an identical bundle and changing replay time changes its hash", () => {
  const scenario = certifiedScenario();
  const options = { baseName: "deterministic", generatedAt: "2026-09-05T10:00:00.000Z" };
  const first = exportCertificationBundle(scenario, options);
  const replay = exportCertificationBundle(structuredClone(scenario), options);
  assert.deepEqual(replay, first);
  assert.equal(replay.bundleHash, first.bundleHash);

  const later = exportCertificationBundle(scenario, {
    ...options,
    generatedAt: "2026-09-05T10:00:01.000Z",
  });
  assert.notEqual(later.bundleHash, first.bundleHash);
});

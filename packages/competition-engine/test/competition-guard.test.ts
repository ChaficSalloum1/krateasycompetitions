import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  createPublicationCertificate,
  evaluateCompetitionGuard,
  verifyPublicationCertificate,
} from "../src/competition-guard.js";
import { createEntrants } from "../src/graph.js";
import { runScenario } from "../src/scenario.js";

const reference = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), {
  specId: "guard.reference", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "guard reference",
  createdAt: "2026-09-12T09:00:00.000Z",
}) as TournamentSpec;

test("the Competition Guard binds a passing report to the exact proposed definition and artefacts", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-reference");
  const report = evaluateCompetitionGuard({
    sourceDefinitionHash: canonicalHash(spec),
    spec,
    graph: scenario.graph,
    schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
  });

  assert.equal(report.status, "PASSED");
  assert.equal(report.binding.sourceDefinitionHash, canonicalHash(spec));
  assert.equal(report.binding.specHash, spec.metadata.compiledSpecHash);
  assert.equal(report.binding.scheduleHash, canonicalHash(scenario.schedule));
  assert.equal(report.accounting.requiredContestCount, scenario.graph.generatedActualContestCount);
  assert.equal(report.accounting.scheduledContestCount, scenario.schedule.contests.length);
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test("a publication certificate binds the passing Guard report and explicit operational acknowledgements", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-certificate");
  const report = evaluateCompetitionGuard({
    sourceDefinitionHash: canonicalHash(spec), spec, graph: scenario.graph,
    schedule: scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
  });
  const certificate = createPublicationCertificate({
    tournamentId: "tournament.guard",
    tournamentRevision: 3,
    report,
    acknowledgedFindingCodes: report.requiredAcknowledgementCodes,
    issuedBy: "user.certifier",
    issuedAt: "2026-09-12T10:00:00.000Z",
  });

  assert.equal(certificate.guardReportHash, report.reportHash);
  assert.equal(certificate.sourceDefinitionHash, canonicalHash(spec));
  assert.equal(certificate.tournamentRevision, 3);
  assert.equal(verifyPublicationCertificate(certificate, report), true);
});

test("the Guard independently binds the complete schedule artefact instead of trusting a stored solver hash", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-schedule-binding");
  const baseline = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: scenario.graph, schedule: scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });
  const changed = structuredClone(scenario.schedule);
  changed.audit.objectiveValueMinutes = (changed.audit.objectiveValueMinutes ?? 0) + 1;
  const changedReport = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: scenario.graph, schedule: changed, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.notEqual(changedReport.binding.scheduleHash, baseline.binding.scheduleHash);
  assert.notEqual(changedReport.reportHash, baseline.reportHash);
});

test("the Guard blocks a graph that is not derived from the supplied compiled specification", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-graph-binding");
  const foreignGraph = structuredClone(scenario.graph);
  foreignGraph.specHash = "0".repeat(64);
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: foreignGraph, schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG002"));
});

test("the Guard blocks a source definition mismatch and will not issue a certificate", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-definition-binding");
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: "f".repeat(64), spec,
    graph: scenario.graph, schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG001"));
  assert.throws(() => createPublicationCertificate({ tournamentId: "tournament.guard", tournamentRevision: 1, report,
    acknowledgedFindingCodes: [], issuedBy: "user.certifier", issuedAt: "2026-09-12T10:00:00.000Z" }),
  /intact, passing Competition Guard report/);
});

test("a schedule with a missing required contest is blocked before publication", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-missing-contest");
  const schedule = structuredClone(scenario.schedule);
  schedule.contests.splice(0, 1);
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: scenario.graph, schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.equal(report.status, "BLOCKED");
  assert.equal(report.accounting.unscheduledContestIds.length, 1);
  assert.ok(report.findings.some(({ severity }) => severity === "CRITICAL" || severity === "INTEGRITY"));
});

test("the Guard blocks a coordinated graph and schedule omission even when proposer counts agree", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-coordinated-omission");
  const graph = structuredClone(scenario.graph);
  const omitted = graph.nodes.find(({ kind }) => kind === "contest");
  assert.ok(omitted);
  graph.nodes = graph.nodes.filter(({ id }) => id !== omitted.id);
  graph.edges = graph.edges.filter(({ fromContestId, toContestId }) => fromContestId !== omitted.id && toContestId !== omitted.id);
  graph.expectedActualContestCount -= 1;
  graph.generatedActualContestCount -= 1;
  graph.findings = [];
  const schedule = structuredClone(scenario.schedule);
  schedule.contests = schedule.contests.filter(({ contestId }) => contestId !== omitted.id);

  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec, graph, schedule });

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG003"));
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG004"));
  assert.equal(report.accounting.unscheduledContestIds.length, 0);
});

test("the Guard independently rejects a count-preserving advancement-path mutation", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-path-mutation");
  const graph = structuredClone(scenario.graph);
  const target = graph.nodes.find(({ kind, roundIndex, slots }) => kind === "contest" && roundIndex >= 3
    && slots[0].type === "winner");
  assert.ok(target);
  const original = target.slots[0];
  assert.equal(original.type, "winner");
  const earlier = graph.nodes.find(({ kind, stageId, roundIndex }) => kind === "contest"
    && stageId === target.stageId && roundIndex < target.roundIndex - 1);
  assert.ok(earlier);
  target.slots[0] = { type: "winner", contestId: earlier.id };
  graph.edges = graph.edges.filter(({ fromContestId, toContestId, toSlot }) =>
    !(fromContestId === original.contestId && toContestId === target.id && toSlot === 0));
  graph.edges.push({ fromContestId: earlier.id, outcome: "winner", toContestId: target.id, toSlot: 0 });

  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec, graph,
    schedule: scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.equal(report.accounting.requiredContestCount, scenario.graph.generatedActualContestCount);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG005"));
});

test("the Guard independently rejects forged opening draws and qualification dependencies", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-draw-mutations");
  const duplicateDraw = structuredClone(scenario.graph);
  const bracketStage = spec.stages.find(({ bracket, primitive }) => bracket
    && ["single_elimination", "consolation"].includes(primitive));
  assert.ok(bracketStage);
  const openingSlots = duplicateDraw.nodes.filter(({ stageId, roundIndex }) =>
    stageId === bracketStage.id && roundIndex === 1).flatMap(({ slots }) => slots)
    .filter((slot): slot is Extract<typeof slot, { type: "entrant" }> => slot.type === "entrant");
  assert.ok(openingSlots.length >= 2);
  openingSlots[1]!.entrantId = openingSlots[0]!.entrantId;
  const drawReport = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: duplicateDraw, schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });
  assert.equal(drawReport.status, "BLOCKED");
  assert.ok(drawReport.findings.some(({ sourceCode }) => sourceCode === "KCG005"));

  const qualificationGraph = structuredClone(scenario.graph);
  const completeEdges = qualificationGraph.edges.filter(({ outcome }) => outcome === "complete");
  assert.ok(completeEdges.length >= 2);
  completeEdges[0]!.toContestId = completeEdges[1]!.toContestId;
  const qualificationReport = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: qualificationGraph, schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });
  assert.equal(qualificationReport.status, "BLOCKED");
  assert.ok(qualificationReport.findings.some(({ sourceCode }) => sourceCode === "KCG005"));
});

test("certificate acknowledgements are exact and tampering is detectable", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-tampering");
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec,
    graph: scenario.graph, schedule: scenario.schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });

  assert.throws(() => createPublicationCertificate({ tournamentId: "tournament.guard", tournamentRevision: 1, report,
    acknowledgedFindingCodes: [...report.requiredAcknowledgementCodes, "UNREQUIRED"], issuedBy: "user.certifier",
    issuedAt: "2026-09-12T10:00:00.000Z" }), /Every and only required operational Guard finding/);
  const certificate = createPublicationCertificate({ tournamentId: "tournament.guard", tournamentRevision: 1, report,
    acknowledgedFindingCodes: report.requiredAcknowledgementCodes, issuedBy: "user.certifier",
    issuedAt: "2026-09-12T10:00:00.000Z" });
  const tampered = { ...certificate, tournamentRevision: certificate.tournamentRevision + 1 };
  assert.equal(verifyPublicationCertificate(tampered, report), false);
  const tamperedReport = { ...report, accounting: { ...report.accounting,
    requiredContestCount: report.accounting.requiredContestCount + 1 } };
  assert.equal(verifyPublicationCertificate(certificate, tamperedReport), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDefinition,
  type ResourceDefinition,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  calculateSchedulingLowerBounds,
  solveSchedule,
  validateSchedule,
  type CompetitionGraph,
  type ContestNode,
  type ProgressionEdge,
  type ScheduleSolution,
} from "../src/index.js";

interface SpecOptions {
  durationMinutes?: number;
  resourceQuantity?: number;
  resources?: ResourceDefinition[];
  minimumRestMinutes?: number;
  finishBy?: string;
  constraints?: TournamentDefinition["scheduling"]["constraints"];
}

function schedulerSpec(id: string, options: SpecOptions = {}): TournamentSpec {
  const definition = structuredClone(playAndKonnectDefinition);
  definition.scheduling.start = "2026-09-05T09:00:00Z";
  definition.scheduling.finishBy = options.finishBy ?? "2026-09-05T18:00:00Z";
  definition.scheduling.durations = [{ stageId: "stage", contestMinutes: options.durationMinutes ?? 30, turnaroundMinutes: 0 }];
  definition.scheduling.constraints = [
    ...(options.minimumRestMinutes === undefined ? [] : [{
      id: "minimum.rest", rule: "minimum_rest", strength: "HARD" as const,
      value: options.minimumRestMinutes, unit: "minutes" as const,
    }]),
    ...(options.constraints ?? []),
  ];
  definition.resources = options.resources ?? [{
    id: "court", type: "court", quantity: options.resourceQuantity ?? 1,
    availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T18:00:00Z" }],
  }];
  return compileDefinition(definition, {
    specId: `scheduler.${id}`,
    revision: 1,
    schemaVersion: "1.0.0",
    compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" },
    sourcePrompt: `adversarial scheduler fixture: ${id}`,
    createdAt: "2026-09-05T09:00:00Z",
  }) as TournamentSpec;
}

function contest(id: string, index: number, left: string, right: string, overrides: Partial<ContestNode> = {}): ContestNode {
  return {
    id,
    stageId: "stage",
    divisionId: "open",
    round: "round-1",
    roundIndex: 1,
    index,
    kind: "contest",
    slots: [{ type: "entrant", entrantId: left }, { type: "entrant", entrantId: right }],
    requiredResourceType: "court",
    ...overrides,
  };
}

function graphOf(nodes: ContestNode[], edges: ProgressionEdge[] = []): CompetitionGraph {
  const actual = nodes.filter(({ kind }) => kind === "contest").length;
  return {
    specHash: "scheduler-adversarial",
    nodes,
    edges,
    expectedActualContestCount: actual,
    generatedActualContestCount: actual,
    findings: [],
  };
}

function assertValid(spec: TournamentSpec, graph: CompetitionGraph, solution: ScheduleSolution): void {
  assert.deepEqual(solution.findings, []);
  assert.deepEqual(validateSchedule(spec, graph, solution), []);
}

test("lower-bound proof separates resource, dependency, and participant-workload bounds", () => {
  const independent = graphOf([
    contest("M1", 1, "A", "B"),
    contest("M2", 2, "C", "D"),
    contest("M3", 3, "E", "F"),
  ]);
  const resourceBound = calculateSchedulingLowerBounds(schedulerSpec("resource-bound"), independent);
  assert.equal(resourceBound.resourceCapacityMinutes, 90);
  assert.equal(resourceBound.dependencyCriticalPathMinutes, 30);
  assert.equal(resourceBound.verifiedLowerBoundMinutes, 90);

  const dependencyNodes = [
    contest("QF", 1, "A", "B"),
    contest("SF", 1, "unused-1", "unused-2", {
      round: "semifinal", roundIndex: 2,
      slots: [{ type: "winner", contestId: "QF" }, { type: "entrant", entrantId: "C" }],
    }),
    contest("F", 1, "unused-3", "unused-4", {
      round: "final", roundIndex: 3,
      slots: [{ type: "winner", contestId: "SF" }, { type: "entrant", entrantId: "D" }],
    }),
  ];
  const dependencyGraph = graphOf(dependencyNodes, [
    { fromContestId: "QF", outcome: "winner", toContestId: "SF", toSlot: 0 },
    { fromContestId: "SF", outcome: "winner", toContestId: "F", toSlot: 0 },
  ]);
  const dependencyBound = calculateSchedulingLowerBounds(schedulerSpec("dependency-bound", { resourceQuantity: 4 }), dependencyGraph);
  assert.equal(dependencyBound.dependencyCriticalPathMinutes, 90);
  assert.deepEqual(dependencyBound.criticalPathContestIds, ["QF", "SF", "F"]);
  assert.equal(dependencyBound.verifiedLowerBoundMinutes, 90);

  const workloadGraph = graphOf([
    contest("P1", 1, "A", "B", { poolId: "pool" }),
    contest("P2", 2, "A", "C", { poolId: "pool" }),
    contest("P3", 3, "A", "D", { poolId: "pool" }),
  ]);
  const workloadBound = calculateSchedulingLowerBounds(schedulerSpec("workload-bound", {
    durationMinutes: 10, resourceQuantity: 4, minimumRestMinutes: 20,
  }), workloadGraph);
  assert.equal(workloadBound.participantWorkloadMinutes, 70);
  assert.equal(workloadBound.verifiedLowerBoundMinutes, 70);
});

test("resource calendar closures are respected without allowing a contest to straddle the gap", () => {
  const spec = schedulerSpec("closure", {
    resources: [{
      id: "court", type: "court", quantity: 1,
      availability: [
        { start: "2026-09-05T09:00:00Z", end: "2026-09-05T09:30:00Z" },
        { start: "2026-09-05T10:00:00Z", end: "2026-09-05T11:00:00Z" },
      ],
    }],
  });
  const graph = graphOf([contest("M1", 1, "A", "B"), contest("M2", 2, "C", "D")]);
  const solution = solveSchedule(spec, graph);
  assertValid(spec, graph, solution);
  assert.deepEqual(solution.contests.map(({ start, end }) => [start, end]), [
    ["2026-09-05T09:00:00.000Z", "2026-09-05T09:30:00.000Z"],
    ["2026-09-05T10:00:00.000Z", "2026-09-05T10:30:00.000Z"],
  ]);
});

test("shared resources across divisions are globally exclusive", () => {
  const spec = schedulerSpec("shared-resource");
  const graph = graphOf([
    contest("women.final", 1, "W1", "W2", { divisionId: "women", round: "final" }),
    contest("men.final", 1, "M1", "M2", { divisionId: "men", round: "final" }),
  ]);
  const solution = solveSchedule(spec, graph);
  assertValid(spec, graph, solution);
  assert.equal(solution.contests[0]!.resourceId, solution.contests[1]!.resourceId);
  const ordered = [...solution.contests].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  assert.ok(Date.parse(ordered[0]!.end) <= Date.parse(ordered[1]!.start));
});

test("hard match-start locks are honored and independently revalidated", () => {
  const lockedStart = "2026-09-05T11:00:00Z";
  const spec = schedulerSpec("hard-lock", {
    constraints: [{ id: "lock.M1", rule: "locked_match_start", strength: "HARD", value: lockedStart }],
  });
  const graph = graphOf([contest("M1", 1, "A", "B")]);
  const solution = solveSchedule(spec, graph);
  assert.equal(solution.contests[0]?.start, "2026-09-05T11:00:00.000Z");
  assertValid(spec, graph, solution);

  const moved = structuredClone(solution);
  moved.contests[0]!.start = "2026-09-05T10:30:00.000Z";
  moved.contests[0]!.end = "2026-09-05T11:00:00.000Z";
  assert.ok(validateSchedule(spec, graph, moved).some(({ code }) => code === "TSV407"));
});

test("dependencies and hard rest both delay the final beyond feeder completion", () => {
  const spec = schedulerSpec("dependency-rest", { resourceQuantity: 2, minimumRestMinutes: 20 });
  const nodes = [
    contest("SF1", 1, "A", "B", { round: "semifinal" }),
    contest("SF2", 2, "C", "D", { round: "semifinal" }),
    contest("F", 1, "unused-1", "unused-2", {
      round: "final", roundIndex: 2,
      slots: [{ type: "winner", contestId: "SF1" }, { type: "winner", contestId: "SF2" }],
    }),
  ];
  const graph = graphOf(nodes, [
    { fromContestId: "SF1", outcome: "winner", toContestId: "F", toSlot: 0 },
    { fromContestId: "SF2", outcome: "winner", toContestId: "F", toSlot: 1 },
  ]);
  const solution = solveSchedule(spec, graph);
  assertValid(spec, graph, solution);
  const final = solution.contests.find(({ contestId }) => contestId === "F")!;
  assert.equal(final.start, "2026-09-05T09:50:00.000Z");
});

test("insufficient availability and an impossible finish deadline are reported as infeasible", () => {
  const noWindow = schedulerSpec("no-window", {
    resources: [{
      id: "court", type: "court", quantity: 1,
      availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T09:20:00Z" }],
    }],
  });
  const oneMatch = graphOf([contest("M1", 1, "A", "B")]);
  const absent = solveSchedule(noWindow, oneMatch);
  assert.equal(absent.audit.status, "INFEASIBLE");
  assert.equal(absent.contests.length, 0);
  assert.ok(absent.findings.some(({ code }) => code === "TSC403"));

  const impossibleDeadline = schedulerSpec("finish-deadline", { finishBy: "2026-09-05T09:20:00Z" });
  const late = solveSchedule(impossibleDeadline, oneMatch);
  assert.equal(late.audit.status, "INFEASIBLE");
  assert.ok(late.findings.some(({ code }) => code === "TSC404"));
});

test("same inputs produce the same complete schedule and proof metadata", () => {
  const spec = schedulerSpec("replay", { resourceQuantity: 2, minimumRestMinutes: 15 });
  const graph = graphOf([
    contest("M1", 1, "A", "B"),
    contest("M2", 2, "C", "D"),
    contest("M3", 3, "A", "C"),
    contest("M4", 4, "B", "D"),
  ]);
  const first = solveSchedule(spec, graph);
  const replay = solveSchedule(spec, graph);
  assert.deepEqual(first, replay);
  assert.equal(first.audit.scheduleHash, replay.audit.scheduleHash);
  assertValid(spec, graph, first);
});

test("shadow validation rejects independent mutations of completeness, identity, duration, calendar, dependency, and rest", () => {
  const spec = schedulerSpec("mutation", { resourceQuantity: 2, minimumRestMinutes: 20 });
  const nodes = [
    contest("SF1", 1, "A", "B"),
    contest("SF2", 2, "C", "D"),
    contest("F", 1, "unused-1", "unused-2", {
      round: "final", roundIndex: 2,
      slots: [{ type: "winner", contestId: "SF1" }, { type: "winner", contestId: "SF2" }],
    }),
  ];
  const graph = graphOf(nodes, [
    { fromContestId: "SF1", outcome: "winner", toContestId: "F", toSlot: 0 },
    { fromContestId: "SF2", outcome: "winner", toContestId: "F", toSlot: 1 },
  ]);
  const valid = solveSchedule(spec, graph);
  assertValid(spec, graph, valid);

  const missing = structuredClone(valid);
  missing.contests = missing.contests.filter(({ contestId }) => contestId !== "SF1");
  assert.ok(validateSchedule(spec, graph, missing).some(({ code }) => code === "TSV401"));

  const unknown = structuredClone(valid);
  unknown.contests[0]!.resourceId = "missing-resource.1";
  assert.ok(validateSchedule(spec, graph, unknown).some(({ code }) => code === "TSV402"));

  const wrongDuration = structuredClone(valid);
  wrongDuration.contests[0]!.end = new Date(Date.parse(wrongDuration.contests[0]!.end) + 60_000).toISOString();
  assert.ok(validateSchedule(spec, graph, wrongDuration).some(({ code }) => code === "TSV403"));

  const collision = structuredClone(valid);
  collision.contests[1]!.resourceId = collision.contests[0]!.resourceId;
  collision.contests[1]!.start = collision.contests[0]!.start;
  collision.contests[1]!.end = collision.contests[0]!.end;
  assert.ok(validateSchedule(spec, graph, collision).some(({ code }) => code === "TSV404"));

  const earlyFinal = structuredClone(valid);
  const final = earlyFinal.contests.find(({ contestId }) => contestId === "F")!;
  final.start = "2026-09-05T09:25:00.000Z";
  final.end = "2026-09-05T09:55:00.000Z";
  const earlyFindings = validateSchedule(spec, graph, earlyFinal);
  assert.ok(earlyFindings.some(({ code }) => code === "TSV405"));
  assert.ok(earlyFindings.some(({ code }) => code === "TSV406"));
});

test("shadow validation rejects duplicate assignments and malformed timestamps explicitly", () => {
  const spec = schedulerSpec("identity-and-time");
  const graph = graphOf([contest("M1", 1, "A", "B")]);
  const valid = solveSchedule(spec, graph);

  const duplicate = structuredClone(valid);
  duplicate.contests.push(structuredClone(duplicate.contests[0]!));
  assert.ok(validateSchedule(spec, graph, duplicate).some(({ code }) => code === "TSV408"));

  const malformed = structuredClone(valid);
  malformed.contests[0]!.start = "not-an-instant";
  assert.ok(validateSchedule(spec, graph, malformed).some(({ code }) => code === "TSV409"));
});

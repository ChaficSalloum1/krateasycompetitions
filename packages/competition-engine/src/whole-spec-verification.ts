import {
  canonicalHash,
  compileDefinition,
  deepFreeze,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { appendAdjudication, createAdjudicationLedger, effectiveOutcome, verifyAdjudicationLedger } from "./adjudication.js";
import { createEntrants } from "./graph.js";
import { runScenario } from "./scenario.js";

type Structure = "SINGLE_ELIMINATION" | "SINGLE_ROUND_ROBIN" | "GROUPS_TO_ELIMINATION" | "GROUPS_TO_DUAL_DESTINATION";
type ResultState = "COMPLETED" | "WALKOVER" | "WITHDRAWAL" | "PARTIAL_WITHDRAWAL";
type ScheduleVariant = "OPEN" | "HARD_LOCK" | "AVAILABILITY_CLOSURE";

interface WholeSpecCase {
  readonly id: string;
  readonly structure: Structure;
  readonly participantCount: number;
  readonly resourceCount: 1 | 2;
  readonly resultState: ResultState;
  readonly scheduleVariant: ScheduleVariant;
}

const grammar = {
  version: "whole-spec-grammar@2",
  structureParticipantCounts: {
    GROUPS_TO_DUAL_DESTINATION: [4, 6, 8], GROUPS_TO_ELIMINATION: [4, 6, 8],
    SINGLE_ELIMINATION: [2, 3, 4, 5, 6, 7, 8], SINGLE_ROUND_ROBIN: [2, 3, 4, 5, 6],
  },
  resultStateRule: "COMPLETED|WALKOVER|WITHDRAWAL for every case; PARTIAL_WITHDRAWAL only when the graph has at least two actual contests",
  schedulingRule: "OPEN|HARD_LOCK|AVAILABILITY_CLOSURE; closure is represented by split resource availability [09:30,10:00)",
  capabilityBoundary: "This finite grammar enumerates single elimination, single round robin, groups-to-elimination, and groups-to-two-destinations; other native primitives are certified by their dedicated bounded corpora.",
} as const;

export interface WholeSpecVerificationReport {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly metamorphicChecks: number;
  readonly searchComplete: true;
  readonly coverage: Readonly<{
    participantCounts: readonly number[];
    structures: readonly Structure[];
    resourceCounts: readonly number[];
    resultStates: readonly ResultState[];
    scheduleVariants: readonly ScheduleVariant[];
  }>;
  readonly grammar: typeof grammar;
  readonly grammarHash: string;
  readonly counterexamples: readonly Readonly<{ caseId: string; violations: readonly string[] }>[];
  readonly scaleEnvelope: string;
  readonly proofHash: string;
}

function baseDefinition(participantCount: number, resourceCount: 1 | 2): TournamentDefinition {
  return {
    sport: {
      id: "verification.head-to-head", adapterVersion: "1.0.0", participantUnit: "individual",
      contest: { kind: "head_to_head", sides: 2 }, scoringCapabilities: ["binary_result"], defaultResourceType: "court",
    },
    participants: { count: participantCount, shape: "individual" },
    divisions: [], stages: [], scoringSystems: [], standingsPolicies: [], qualificationPolicies: [],
    competitionStructures: [], drawPolicies: [], progressionPolicies: [],
    scheduling: {
      timezone: "UTC", start: "2026-01-01T09:00:00Z", finishBy: "2026-01-02T09:00:00Z",
      constraints: [{ id: "minimum-rest", rule: "minimum_rest", strength: "HARD", value: 0, unit: "minutes" }],
      durations: [], objective: "earliest_finish",
    },
    resources: [{
      id: "venue.courts", type: "court", quantity: resourceCount,
      availability: [{ start: "2026-01-01T09:00:00Z", end: "2026-01-02T09:00:00Z" }],
    }],
    operationalPolicies: [], randomisation: { mode: "deterministic", algorithm: "xoshiro128ss", seed: "whole-spec" },
    assumptions: [], requirements: [],
  };
}

function definitionFor(testCase: WholeSpecCase): TournamentDefinition {
  const definition = baseDefinition(testCase.participantCount, testCase.resourceCount);
  const division = {
    id: "open", label: "Open", participantCount: testCase.participantCount,
    participantShape: "individual" as const, stageIds: [] as string[],
  };
  definition.divisions = [division];
  if (testCase.structure === "SINGLE_ELIMINATION") {
    division.stageIds = ["open.knockout"];
    definition.stages = [{
      id: "open.knockout", label: "Knockout", divisionId: "open", primitive: "single_elimination",
      inputShape: "individual", outputShape: "individual", expectedEntrants: testCase.participantCount,
      bracket: { entrantCount: testCase.participantCount, topology: "arbitrary", thirdPlaceMatch: false },
    }];
  } else if (testCase.structure === "SINGLE_ROUND_ROBIN") {
    division.stageIds = ["open.league"];
    definition.stages = [{
      id: "open.league", label: "League", divisionId: "open", primitive: "single_round_robin",
      inputShape: "individual", outputShape: "individual", expectedEntrants: testCase.participantCount,
      pool: { poolCount: 1, sizes: [testCase.participantCount], rounds: 1, allocation: "snake" },
    }];
    definition.standingsPolicies = [{
      id: "open.table", stageIds: ["open.league"], metricOrder: [
        { metric: "wins", direction: "DESC" }, { metric: "score_difference", direction: "DESC" },
      ], tieFallback: "deterministic_draw",
    }];
    definition.assumptions = [{
      id: "evidence.table", rulePath: "/standingsPolicies/open.table", origin: "selected_template",
      knowledge: "KNOWN", sourceReference: "whole-spec-grammar@1", approved: true, critical: true,
    }];
  } else {
    const poolSize = testCase.participantCount / 2;
    const dualDestination = testCase.structure === "GROUPS_TO_DUAL_DESTINATION";
    division.stageIds = dualDestination ? ["open.groups", "open.gold", "open.silver"] : ["open.groups", "open.final"];
    definition.stages = [{
      id: "open.groups", label: "Groups", divisionId: "open", primitive: "groups",
      inputShape: "individual", outputShape: "individual", expectedEntrants: testCase.participantCount,
      pool: { poolCount: 2, sizes: [poolSize, poolSize], rounds: 1, allocation: "snake" },
    }, {
      id: dualDestination ? "open.gold" : "open.final", label: dualDestination ? "Gold final" : "Final", divisionId: "open", primitive: "single_elimination",
      inputShape: "individual", outputShape: "individual", expectedEntrants: 2,
      bracket: { entrantCount: 2, topology: "power_of_two", thirdPlaceMatch: false },
    }, ...(dualDestination ? [{
      id: "open.silver", label: "Silver final", divisionId: "open", primitive: "single_elimination" as const,
      inputShape: "individual" as const, outputShape: "individual" as const, expectedEntrants: 2,
      bracket: { entrantCount: 2, topology: "power_of_two" as const, thirdPlaceMatch: false },
    }] : [])];
    definition.standingsPolicies = [{
      id: "open.groups.table", stageIds: ["open.groups"], metricOrder: [
        { metric: "wins", direction: "DESC" }, { metric: "score_difference", direction: "DESC" },
      ], tieFallback: "deterministic_draw",
    }];
    definition.qualificationPolicies = [{
      id: "open.group-winners", sourceStageId: "open.groups", destinationStructureId: dualDestination ? "open.gold.structure" : "open.final.structure",
      outputCount: 2, selectors: [{ type: "pool_winners" }], normalization: "percentage",
    }, ...(dualDestination ? [{
      id: "open.group-runners", sourceStageId: "open.groups", destinationStructureId: "open.silver.structure",
      outputCount: 2, selectors: [{ type: "pool_position" as const, position: 2 }], normalization: "percentage" as const,
    }] : [])];
    definition.competitionStructures = dualDestination ? [
      { id: "open.gold.structure", label: "Gold", divisionId: "open", targetEntrants: 2, stageIds: ["open.gold"] },
      { id: "open.silver.structure", label: "Silver", divisionId: "open", targetEntrants: 2, stageIds: ["open.silver"] },
    ] : [{ id: "open.final.structure", label: "Final", divisionId: "open", targetEntrants: 2, stageIds: ["open.final"] }];
    definition.assumptions = [
      { id: "evidence.groups-table", rulePath: "/standingsPolicies/open.groups.table", origin: "selected_template",
        knowledge: "KNOWN", sourceReference: "whole-spec-grammar@1", approved: true, critical: true },
      { id: "evidence.group-winners", rulePath: "/qualificationPolicies/open.group-winners", origin: "selected_template",
        knowledge: "KNOWN", sourceReference: "whole-spec-grammar@1", approved: true, critical: true },
      ...(dualDestination ? [{ id: "evidence.group-runners", rulePath: "/qualificationPolicies/open.group-runners", origin: "selected_template" as const,
        knowledge: "KNOWN" as const, sourceReference: "whole-spec-grammar@2", approved: true, critical: true }] : []),
    ];
  }
  definition.scoringSystems = [{
    id: "binary", adapterRule: "verification.binary", version: "1.0.0", stageIds: definition.stages.map(({ id }) => id),
  }];
  definition.scheduling.durations = definition.stages.map(({ id }) => ({ stageId: id, contestMinutes: 5, turnaroundMinutes: 0 }));
  if (testCase.scheduleVariant === "AVAILABILITY_CLOSURE") definition.resources[0]!.availability = [
    { start: "2026-01-01T09:00:00Z", end: "2026-01-01T09:30:00Z" },
    { start: "2026-01-01T10:00:00Z", end: "2026-01-02T09:00:00Z" },
  ];
  if (testCase.scheduleVariant === "HARD_LOCK") {
    const contestId = testCase.structure === "SINGLE_ELIMINATION"
      ? `open.knockout.R${Math.ceil(Math.log2(testCase.participantCount))}.M1`
      : testCase.structure === "SINGLE_ROUND_ROBIN" ? "open.league.P1.R1.M1"
        : testCase.structure === "GROUPS_TO_DUAL_DESTINATION" ? "open.gold.R1.M1" : "open.final.R1.M1";
    const value = testCase.structure === "SINGLE_ROUND_ROBIN" ? "2026-01-01T09:00:00Z" : "2026-01-01T12:00:00Z";
    definition.scheduling.constraints.push({ id: `lock.${contestId}`, rule: "locked_match_start", strength: "HARD", value });
  }
  return definition;
}

function cases(): WholeSpecCase[] {
  const shapes: Array<readonly [Structure, readonly number[]]> = [
    ["SINGLE_ELIMINATION", [2, 3, 4, 5, 6, 7, 8]],
    ["SINGLE_ROUND_ROBIN", [2, 3, 4, 5, 6]],
    ["GROUPS_TO_ELIMINATION", [4, 6, 8]],
    ["GROUPS_TO_DUAL_DESTINATION", [4, 6, 8]],
  ];
  const output: WholeSpecCase[] = [];
  for (const [structure, participantCounts] of shapes) for (const participantCount of participantCounts) {
    const resultStates: ResultState[] = ["COMPLETED", "WALKOVER", "WITHDRAWAL"];
    const contestCount = structure === "SINGLE_ELIMINATION" ? participantCount - 1
      : structure === "SINGLE_ROUND_ROBIN" ? participantCount * (participantCount - 1) / 2
        : 2 * ((participantCount / 2) * (participantCount / 2 - 1) / 2) + (structure === "GROUPS_TO_DUAL_DESTINATION" ? 2 : 1);
    if (contestCount >= 2) resultStates.push("PARTIAL_WITHDRAWAL");
    for (const resourceCount of [1, 2] as const) for (const scheduleVariant of ["OPEN", "HARD_LOCK", "AVAILABILITY_CLOSURE"] as const) for (const resultState of resultStates) {
      output.push({
        id: `${structure.toLowerCase()}.${participantCount}.r${resourceCount}.${scheduleVariant.toLowerCase()}.${resultState.toLowerCase()}`,
        structure, participantCount, resourceCount, resultState, scheduleVariant,
      });
    }
  }
  return output;
}

function compile(testCase: WholeSpecCase): TournamentSpec {
  return compileDefinition(definitionFor(testCase), {
    specId: `whole-spec.${testCase.id}`, revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { verification: "1.0.0" }, sourcePrompt: testCase.id, createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
}

interface CaseOutcome { readonly contestCount: number; readonly graphHash: string; readonly scheduleHash: string; readonly violations: readonly string[]; }

function execute(testCase: WholeSpecCase): CaseOutcome {
  const spec = compile(testCase);
  const scenario = runScenario(spec, createEntrants(spec), `whole-spec:${testCase.id}`);
  const violations: string[] = [];
  if (scenario.certification.status !== "CERTIFIED") {
    violations.push(...scenario.certification.findings.filter(({ severity }) => severity === "ERROR")
      .map(({ code, message }) => `${code}: ${message}`));
  }
  if (scenario.graph.generatedActualContestCount !== scenario.graph.expectedActualContestCount) {
    violations.push("generated and independent contest cardinalities differ");
  }
  const expectedCompleted = scenario.graph.generatedActualContestCount
    - new Set(scenario.simulation?.skippedConditionalContestIds ?? []).size;
  if (scenario.simulation?.completedContestCount !== expectedCompleted) {
    violations.push("simulation did not complete every generated contest");
  }
  if (testCase.scheduleVariant === "HARD_LOCK") {
    const lock = spec.scheduling.constraints.find(({ rule }) => rule === "locked_match_start")!;
    const scheduled = scenario.schedule.contests.find(({ contestId }) => contestId === lock.id.slice("lock.".length));
    if (!scheduled || Date.parse(scheduled.start) !== Date.parse(String(lock.value))) violations.push("hard lock was not honored exactly");
  }
  if (testCase.scheduleVariant === "AVAILABILITY_CLOSURE" && scenario.schedule.contests.some(({ start, end }) =>
    Date.parse(start) < Date.parse("2026-01-01T10:00:00Z") && Date.parse(end) > Date.parse("2026-01-01T09:30:00Z"))) {
    violations.push("a contest overlaps the represented resource closure");
  }
  const result = scenario.simulation?.results[0];
  if (!result) violations.push("scenario produced no adjudicable contest result");
  else {
    let ledger = createAdjudicationLedger({ withdrawal: testCase.resultState === "PARTIAL_WITHDRAWAL" ? "VOID_CONTEST" : "AWARD_WALKOVER" });
    const audit = { contestId: result.contestId, actorId: "verifier", recordedAt: "2026-01-01T12:00:00Z", reason: "bounded corpus" };
    if (testCase.resultState === "COMPLETED") ledger = appendAdjudication(ledger, {
      ...audit, kind: "RECORD_RESULT", entrants: result.entrants, winnerId: result.winnerId, score: result.scoreFor,
    });
    else if (testCase.resultState === "WALKOVER") ledger = appendAdjudication(ledger, {
      ...audit, kind: "RECORD_WALKOVER", entrants: result.entrants, absentEntrantId: result.entrants[0],
    });
    else if (testCase.resultState === "WITHDRAWAL") ledger = appendAdjudication(ledger, {
      ...audit, kind: "ADJUDICATE_WITHDRAWAL", entrants: result.entrants, withdrawnEntrantId: result.entrants[0],
    });
    else {
      const second = scenario.simulation?.results[1];
      if (!second) violations.push("partial withdrawal requires at least two adjudicable contests");
      else {
        ledger = appendAdjudication(ledger, { ...audit, kind: "RECORD_RESULT", entrants: result.entrants,
          winnerId: result.winnerId, score: result.scoreFor });
        ledger = appendAdjudication(ledger, { ...audit, contestId: second.contestId, recordedAt: "2026-01-01T12:01:00Z",
          kind: "ADJUDICATE_WITHDRAWAL", entrants: second.entrants, withdrawnEntrantId: second.entrants[0] });
        if (effectiveOutcome(ledger, second.contestId)?.status !== "VOIDED") violations.push("partial withdrawal was not preserved as an explicit void");
      }
    }
    if (!verifyAdjudicationLedger(ledger).valid || !effectiveOutcome(ledger, result.contestId)) {
      violations.push("adjudication result-state proof failed");
    }
  }
  return { contestCount: scenario.graph.generatedActualContestCount, graphHash: canonicalHash(scenario.graph),
    scheduleHash: scenario.schedule.audit.scheduleHash ?? canonicalHash(scenario.schedule), violations };
}

/** Complete only for the finite grammar published in the report. */
export function runWholeSpecVerification(): Readonly<WholeSpecVerificationReport> {
  const testCases = cases();
  const outcomes = new Map<string, CaseOutcome>();
  const counterexamples: Array<{ caseId: string; violations: readonly string[] }> = [];
  for (const testCase of testCases) {
    const outcome = execute(testCase);
    outcomes.set(testCase.id, outcome);
    if (outcome.violations.length > 0) counterexamples.push({ caseId: testCase.id, violations: outcome.violations });
  }
  let metamorphicChecks = 0;
  for (const testCase of testCases.filter(({ resourceCount }) => resourceCount === 1)) {
    const expandedId = testCase.id.replace(".r1.", ".r2.");
    const baseline = outcomes.get(testCase.id)!; const expanded = outcomes.get(expandedId)!;
    metamorphicChecks += 1;
    if (baseline.contestCount !== expanded.contestCount || expanded.violations.length > 0) {
      counterexamples.push({ caseId: `${testCase.id}->${expandedId}`, violations: ["adding a compatible resource changed structural truth"] });
    }
  }
  const idFor = (value: WholeSpecCase): string => `${value.structure.toLowerCase()}.${value.participantCount}.r${value.resourceCount}.${value.scheduleVariant.toLowerCase()}.${value.resultState.toLowerCase()}`;
  for (const testCase of testCases.filter(({ resultState }) => resultState !== "COMPLETED")) {
    const baselineId = idFor({ ...testCase, id: "", resultState: "COMPLETED" });
    const baseline = outcomes.get(baselineId)!; const transformed = outcomes.get(testCase.id)!; metamorphicChecks += 1;
    if (baseline.contestCount !== transformed.contestCount || transformed.violations.length > 0) {
      counterexamples.push({ caseId: `${baselineId}->${testCase.id}`, violations: ["adjudication state changed structural tournament truth"] });
    }
  }
  for (const testCase of testCases.filter(({ scheduleVariant }) => scheduleVariant !== "OPEN")) {
    const baselineId = idFor({ ...testCase, id: "", scheduleVariant: "OPEN" });
    const baseline = outcomes.get(baselineId)!; const transformed = outcomes.get(testCase.id)!; metamorphicChecks += 1;
    if (baseline.contestCount !== transformed.contestCount || transformed.violations.length > 0) {
      counterexamples.push({ caseId: `${baselineId}->${testCase.id}`, violations: ["a feasible lock or closure changed structural tournament truth"] });
    }
  }
  for (const testCase of testCases) {
    const baseline = outcomes.get(testCase.id)!; const replay = execute(testCase); metamorphicChecks += 1;
    if (baseline.contestCount !== replay.contestCount || baseline.graphHash !== replay.graphHash || baseline.scheduleHash !== replay.scheduleHash || replay.violations.length > 0) {
      counterexamples.push({ caseId: `${testCase.id}->replay`, violations: ["deterministic whole-spec replay changed compiled or scheduled truth"] });
    }
  }
  const failedIds = new Set(counterexamples.map(({ caseId }) => caseId.split("->")[0]!));
  const grammarHash = canonicalHash(grammar);
  const base = {
    status: counterexamples.length === 0 ? "CERTIFIED" as const : "REJECTED" as const,
    totalCases: testCases.length, passedCases: testCases.length - failedIds.size, failedCases: failedIds.size,
    metamorphicChecks, searchComplete: true as const,
    coverage: {
      participantCounts: [2, 3, 4, 5, 6, 7, 8],
      structures: ["GROUPS_TO_DUAL_DESTINATION", "GROUPS_TO_ELIMINATION", "SINGLE_ELIMINATION", "SINGLE_ROUND_ROBIN"] as const,
      resourceCounts: [1, 2], resultStates: ["COMPLETED", "PARTIAL_WITHDRAWAL", "WALKOVER", "WITHDRAWAL"] as const,
      scheduleVariants: ["AVAILABILITY_CLOSURE", "HARD_LOCK", "OPEN"] as const,
    },
    grammar, grammarHash,
    counterexamples,
    scaleEnvelope: `${testCases.length} exhaustive TournamentSpec cases within whole-spec-grammar@2; ${metamorphicChecks} resource, adjudication, scheduling, and replay relations. This is a finite evidence envelope, not an arbitrary-complexity claim.`,
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

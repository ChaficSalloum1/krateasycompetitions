import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { validateEligibility } from "../src/eligibility.js";

const reference = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), {
  specId: "eligibility.test",
  revision: 1,
  schemaVersion: "1.0.0",
  compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", eligibility: "1.0.0" },
  sourcePrompt: "eligibility fixture",
  createdAt: "2026-09-05T09:00:00Z",
}) as TournamentSpec;

const fixedTeamReference = (): TournamentSpec => {
  const spec = structuredClone(reference());
  spec.participants.shape = "fixed_team";
  spec.participants.rosterSize = 2;
  spec.sport.participantUnit = "fixed_team";
  spec.sport.teamSize = 2;
  for (const division of spec.divisions) division.participantShape = "fixed_team";
  for (const stage of spec.stages) {
    stage.inputShape = "fixed_team";
    stage.outputShape = "fixed_team";
  }
  return spec;
};

test("a participant cannot occupy two entrants in the same division", () => {
  const result = validateEligibility(reference(), {
    advanced: [
      { id: "team-a", divisionId: "advanced", memberIds: ["player-1", "player-2"] },
      { id: "team-b", divisionId: "advanced", memberIds: ["player-1", "player-3"] },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings.find(({ code }) => code === "TSC140")?.evidence, {
    participantId: "player-1",
    divisionId: "advanced",
    entrantIds: ["team-a", "team-b"],
  });
});

test("a participant cannot occupy two roster slots in one entrant", () => {
  const result = validateEligibility(reference(), {
    advanced: [
      { id: "team-a", divisionId: "advanced", memberIds: ["player-1", "player-1"] },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings.find(({ code }) => code === "TSC140")?.evidence, {
    participantId: "player-1",
    divisionId: "advanced",
    entrantId: "team-a",
    membershipIndexes: [0, 1],
  });
});

test("fixed teams must have exactly the declared roster size", () => {
  const result = validateEligibility(fixedTeamReference(), {
    advanced: [
      { id: "short-team", divisionId: "advanced", memberIds: ["player-1"] },
      { id: "long-team", divisionId: "advanced", memberIds: ["player-2", "player-3", "player-4"] },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.findings.filter(({ code }) => code === "TSC141").map(({ evidence }) => evidence),
    [
      { entrantId: "long-team", divisionId: "advanced", expectedRosterSize: 2, actualRosterSize: 3 },
      { entrantId: "short-team", divisionId: "advanced", expectedRosterSize: 2, actualRosterSize: 1 },
    ],
  );
});

test("an entrant's declared division must match its input bucket", () => {
  const result = validateEligibility(reference(), {
    advanced: [{ id: "misfiled", divisionId: "beginner", memberIds: ["player-1", "player-2"] }],
  });

  assert.deepEqual(result.findings.find(({ code }) => code === "TSC142")?.evidence, {
    entrantId: "misfiled",
    containingDivisionId: "advanced",
    declaredDivisionId: "beginner",
  });
});

test("multi-category membership fails closed without an explicit compatibility rule", () => {
  const result = validateEligibility(reference(), {
    advanced: [{ id: "advanced-team", divisionId: "advanced", memberIds: ["shared-player", "player-2"] }],
    beginner: [{ id: "beginner-team", divisionId: "beginner", memberIds: ["shared-player", "player-3"] }],
  });

  assert.deepEqual(result.findings.find(({ code }) => code === "TSC143")?.evidence, {
    participantId: "shared-player",
    divisionIds: ["advanced", "beginner"],
  });
});

test("stage inputs must satisfy the tournament, sport, and division shape contracts", () => {
  const spec = structuredClone(reference());
  spec.stages.find(({ id }) => id === "advanced.pools")!.inputShape = "individual";
  const result = validateEligibility(spec, {});

  assert.deepEqual(result.findings.find(({ code }) => code === "TSC144")?.evidence, {
    stageId: "advanced.pools",
    divisionId: "advanced",
    actualInputShape: "individual",
    expectedInputShapes: ["pair"],
    divisionExists: true,
  });
});

test("valid eligibility input is accepted without findings", () => {
  const result = validateEligibility(reference(), {
    advanced: [{ id: "team-a", divisionId: "advanced", memberIds: ["player-1", "player-2"] }],
    beginner: [{ id: "team-b", divisionId: "beginner", memberIds: ["player-3", "player-4"] }],
  });

  assert.deepEqual(result, { valid: true, findings: [] });
});

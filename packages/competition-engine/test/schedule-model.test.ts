import assert from "node:assert/strict";
import test from "node:test";
import { compileScheduleModel, type ScheduleModelSource } from "../src/schedule-model.js";

const source = (): ScheduleModelSource => ({
  horizon: { start: "2026-09-05T09:00:00Z", end: "2026-09-05T18:00:00Z" },
  contests: [
    { id: "SF", durationMinutes: 40, participantIds: ["P2", "P1"], requirements: [
      { resourceKind: "venue", resourceType: "court", quantity: 1 },
      { resourceKind: "official", resourceType: "referee", quantity: 1 },
      { resourceKind: "equipment", resourceType: "scoreboard", quantity: 1 },
    ] },
    { id: "F", durationMinutes: 60, participantIds: ["P3", "P1"], requirements: [
      { resourceKind: "venue", resourceType: "court", quantity: 1 },
      { resourceKind: "official", resourceType: "referee", quantity: 1 },
    ] },
  ],
  precedence: [{ beforeContestId: "SF", afterContestId: "F", minimumLagMinutes: 5 }],
  resourceUnits: [
    { id: "court-1", kind: "venue", type: "court", availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T18:00:00Z" }] },
    { id: "ref-1", kind: "official", type: "referee", availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T18:00:00Z" }] },
    { id: "board-1", kind: "equipment", type: "scoreboard", availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T18:00:00Z" }] },
  ],
  closures: [{ resourceUnitId: "court-1", start: "2026-09-05T12:00:00Z", end: "2026-09-05T13:00:00Z" }],
  locks: [],
  minimumRestMinutes: 20,
  objectives: [
    { kind: "minimum_participant_waiting", priority: 2 },
    { kind: "earliest_finish", priority: 1 },
  ],
});

test("compilation normalizes and deeply freezes a complete typed scheduling model", () => {
  const result = compileScheduleModel(source());

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.model.contests.map(({ id }) => id), ["F", "SF"]);
  assert.deepEqual(result.model.contests.find(({ id }) => id === "SF")?.participantIds, ["P1", "P2"]);
  assert.deepEqual(result.model.resourceUnits.find(({ id }) => id === "court-1")?.availability, [
    { startMinute: 0, endMinute: 180 },
    { startMinute: 240, endMinute: 540 },
  ]);
  assert.deepEqual(result.model.objectives.map(({ priority }) => priority), [1, 2]);
  assert.equal(result.model.participantConflicts[0]?.minimumRestMinutes, 20);
  assert.equal(Object.isFrozen(result.model), true);
  assert.equal(Object.isFrozen(result.model.contests), true);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test("legacy hard start-lock constraints compile into explicit normalized locks", () => {
  const input = source();
  input.constraints = [{ id: "lock.SF", rule: "locked_match_start", strength: "HARD", value: "2026-09-05T10:00:00Z" }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.model.locks, [{ contestId: "SF", startMinute: 60, endMinute: 100, resourceUnitIds: [] }]);
});

test("legacy hard closure constraints compile into effective resource calendars", () => {
  const input = source();
  input.closures = [];
  input.constraints = [{
    id: "closure.court-1",
    rule: "resource_closure",
    strength: "HARD",
    value: { start: "2026-09-05T12:00:00Z", end: "2026-09-05T13:00:00Z" },
  }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.model.resourceUnits.find(({ id }) => id === "court-1")?.availability, [
    { startMinute: 0, endMinute: 180 },
    { startMinute: 240, endMinute: 540 },
  ]);
});

test("unknown contest and resource references fail closed with evidence", () => {
  const input = source();
  input.precedence = [{ beforeContestId: "missing", afterContestId: "F" }];
  input.closures = [{ resourceUnitId: "missing-unit", start: "2026-09-05T12:00:00Z", end: "2026-09-05T13:00:00Z" }];
  input.locks = [{ contestId: "missing", start: "2026-09-05T10:00:00Z", resourceUnitIds: ["missing-unit"] }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, false);
  assert.ok(result.findings.filter(({ code }) => code === "TSC411").length >= 3);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test("closures outside availability make the calendar inconsistent", () => {
  const input = source();
  input.closures = [{ resourceUnitId: "court-1", start: "2026-09-05T08:00:00Z", end: "2026-09-05T10:00:00Z" }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, false);
  assert.ok(result.findings.some(({ code }) => code === "TSC413"));
});

test("locks cannot violate duration, resource exclusivity, participant rest, or precedence", () => {
  const input = source();
  input.locks = [
    { contestId: "SF", start: "2026-09-05T10:00:00Z", end: "2026-09-05T10:40:00Z", resourceUnitIds: ["court-1", "ref-1", "board-1"] },
    { contestId: "F", start: "2026-09-05T10:35:00Z", end: "2026-09-05T11:35:00Z", resourceUnitIds: ["court-1", "ref-1"] },
  ];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, false);
  const lockFindings = result.findings.filter(({ code }) => code === "TSC412");
  assert.ok(lockFindings.some(({ message }) => message.includes("collision")));
  assert.ok(lockFindings.some(({ message }) => message.includes("rest")));
  assert.ok(lockFindings.some(({ message }) => message.includes("precedence")));
});

test("a supplied lock end must be valid and exactly match contest duration", () => {
  const input = source();
  input.locks = [{ contestId: "SF", start: "2026-09-05T10:00:00Z", end: "not-a-time", resourceUnitIds: [] }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, false);
  assert.ok(result.findings.some(({ code, message }) => code === "TSC412" && message.includes("duration")));
});

test("objective priorities must be explicit and unique", () => {
  const input = source();
  input.objectives = [{ kind: "earliest_finish", priority: 1 }, { kind: "minimum_resource_idle", priority: 1 }];
  const result = compileScheduleModel(input);

  assert.equal(result.valid, false);
  assert.ok(result.findings.some(({ code }) => code === "TSC414"));
});

test("semantically equivalent source ordering produces the same proof", () => {
  const first = compileScheduleModel(source());
  const reordered = source();
  reordered.contests = [...reordered.contests].reverse();
  reordered.resourceUnits = [...reordered.resourceUnits].reverse();
  reordered.objectives = [...reordered.objectives].reverse();
  const second = compileScheduleModel(reordered);

  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.equal(first.proofHash, second.proofHash);
});

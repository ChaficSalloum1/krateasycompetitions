import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";

const fixturePath = new URL("./fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url);
// The original production-lock candidate has no trailing newline. Keep the checked-in
// text editor friendly while reconstructing its exact source bytes at the boundary.
const fixture = readFileSync(fixturePath, "utf8").trimEnd();

test("the untrusted St Albans source is preserved and explained without accepting its audit claims", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture }, "st-albans.organiser");

  assert.equal(draft.name, "Encourt Padel & Wellness Club St Albans");
  assert.equal(draft.status, "NEEDS_INPUT");
  assert.equal(draft.workbench.sources.length, 1);
  assert.equal(draft.workbench.sources[0]?.original, fixture);
  assert.equal(draft.workbench.sources[0]?.sourceHash,
    "f86b1d34939f8f4b0ba158b3613b95bc2d5d74d9b921413850b3b377f8d541a5");
  const headlineFacts = new Set(["entrants.total", "fixtures.group", "fixtures.knockout", "fixtures.total", "pools.total"]);
  assert.deepEqual(Object.fromEntries(draft.workbench.understoodFacts.filter(({ id }) => headlineFacts.has(id))
    .map((fact) => [fact.id, fact.value])), {
    "entrants.total": 48,
    "fixtures.group": 66,
    "fixtures.knockout": 42,
    "fixtures.total": 108,
    "pools.total": 13,
  });
  assert.equal(draft.workbench.understoodFacts.filter(({ id }) => id.startsWith("entrant.")).length, 48 * 4);
  assert.deepEqual(draft.workbench.rules.find(({ id }) => id === "resource.availability")?.value, [
    { courts: [4, 5, 6, 7], from: "11:00", to: "12:00" },
    { courts: [1, 2, 3, 4, 5, 6, 7], from: "12:00", to: "20:00" },
  ]);
  assert.deepEqual(draft.workbench.rules.find(({ id }) => id === "progression.paths")?.value,
    ["Konnect", "Tower"]);
  assert.equal(draft.workbench.rules.find(({ id }) => id === "schedule.hard-stop")?.value, "20:00");
  assert.equal(draft.workbench.rules.find(({ id }) => id === "final.courts")?.value instanceof Object, true);
  assert.equal(draft.workbench.untrustedClaims.length, 12);
  assert.equal(draft.workbench.untrustedClaims.every(({ authority }) => authority === "SOURCE_ASSERTION_ONLY"), true);
  assert.deepEqual(draft.workbench.missingDecisions.map(({ id }) => id).sort(), [
    "approval-authority", "event-date", "normalisation", "qualification", "scoring", "tiebreak",
    "timezone", "withdrawal",
  ]);
  assert.equal(draft.compiled, null);
  assert.throws(() => journey.compile(draft.id, draft.draftVersion), /journey_not_ready/);
});

const decisions = [
  { id: "qualification", value: "top_four_konnect_remainder_tower" },
  { id: "scoring", value: "padel.timed.standard@1.0.0" },
  { id: "tiebreak", value: "wins_game_difference_games_won_head_to_head_manual" },
  { id: "normalisation", value: "percentage" },
  { id: "withdrawal", value: "preserve_played_walkover_future" },
  { id: "approval-authority", value: "separate_compiler_approver_publisher" },
  { id: "event-date", value: "2026-09-20" },
  { id: "timezone", value: "Europe/London" },
] as const;

test("structured decisions show impact before converging on one guarded 108-fixture definition", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture }, "st-albans.organiser");

  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "st-albans.organiser");
  assert.equal(preview.semanticDiff.length, decisions.length);
  assert.ok(preview.semanticDiff.every(({ operation }) => operation === "add"));
  assert.ok(preview.operationalImpact.some((line) => line.includes("108-fixture recompilation")));
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  assert.equal(journey.read(draft.id)?.draftVersion, draft.draftVersion, "preview must not mutate the definition");

  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions,
    preview.previewHash, "st-albans.organiser");
  assert.equal(resolved.status, "DRAFT");
  assert.equal(resolved.workbench.definitionVersion, 2);
  assert.equal(resolved.workbench.sources.length, 2);
  assert.deepEqual(resolved.workbench.missingDecisions, []);
  assert.equal(resolved.workbench.assumptions.length, decisions.length);
  assert.equal(resolved.workbench.pendingImpact?.previewHash, preview.previewHash);

  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  assert.equal(compiled.status, "READY_FOR_APPROVAL");
  assert.equal(compiled.blueprint.participantCount, 48);
  assert.equal(compiled.compiled?.actualContestCount, 108);
  assert.equal(compiled.compiled?.scheduledContestCount, 108);
  assert.equal(compiled.compiled?.guardStatus, "PASSED");
  assert.equal(compiled.compiled?.changeSet?.reviewedImpact?.previewHash, preview.previewHash);
  assert.equal(compiled.compiled?.changeSet?.toRevision, compiled.revision);
  assert.equal(compiled.compiled?.schedule.every(({ end }) => end <= "2026-09-20T19:00:00.000Z"), true);
  const finalIds = new Set(["advanced.konnect.R2.M1", "advanced.tower.R3.M1", "beginner.konnect.R2.M1",
    "beginner.tower.R4.M1", "intermediate.konnect.R2.M1", "intermediate.tower.R5.M1"]);
  assert.deepEqual(Object.fromEntries(compiled.compiled?.schedule.filter(({ contestId }) => finalIds.has(contestId))
    .map(({ contestId, resourceId }) => [contestId, resourceId]) ?? []), {
    "advanced.konnect.R2.M1": "venue.courts.main.5",
    "advanced.tower.R3.M1": "venue.courts.main.4",
    "beginner.konnect.R2.M1": "venue.courts.main.7",
    "beginner.tower.R4.M1": "venue.courts.main.3",
    "intermediate.konnect.R2.M1": "venue.courts.main.6",
    "intermediate.tower.R5.M1": "venue.courts.main.2",
  });
});

test("multiple original sources retain their hashes and provenance while disagreements block convergence", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture });
  const corroborated = journey.addSource(draft.id, draft.draftVersion, { mode: "json", text: fixture });
  assert.equal(corroborated.workbench.sources.length, 2);
  assert.equal(corroborated.workbench.sources[0]?.sourceHash, corroborated.workbench.sources[1]?.sourceHash);
  assert.equal(corroborated.workbench.understoodFacts.every(({ provenance }) => provenance.length === 2), true);
  assert.deepEqual(corroborated.workbench.conflicts, []);

  const disputedValue = JSON.parse(fixture) as { pools: { Advanced: { "1": string[] } } };
  disputedValue.pools.Advanced["1"] = disputedValue.pools.Advanced["1"].slice(1);
  const disputed = journey.addSource(draft.id, corroborated.draftVersion,
    { mode: "json", text: JSON.stringify(disputedValue) });
  assert.equal(disputed.status, "NEEDS_INPUT");
  assert.ok(disputed.workbench.conflicts.some(({ id }) => id.includes("entrants.total")));
  assert.throws(() => journey.compile(disputed.id, disputed.draftVersion), /journey_not_ready/);
});

test("structured edits fail closed on unregistered policy values and a changed preview", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture });
  assert.throws(() => journey.planStructuredEdit(draft.id, draft.draftVersion,
    [{ id: "qualification", value: "whatever-the-client-wants" }], "organiser"), /unsupported_structured_decision/);
  assert.throws(() => journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions,
    "0".repeat(64), "organiser"), /structured_edit_preview_mismatch/);
  assert.equal(journey.read(draft.id)?.draftVersion, draft.draftVersion);
});

test("Structure Map and its hash-bound proposal are server-derived, stale-safe, and replay-safe", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture }, "st-albans.organiser");
  assert.equal(draft.structureMap.definitionAvailable, false);
  assert.match(draft.structureMap.unavailableReason ?? "", /incomplete/i);

  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "st-albans.organiser");
  assert.equal(preview.review?.affectedMatchCount, 108);
  assert.equal(preview.review?.affectedQualificationCount, 6);
  assert.equal(preview.review?.assurance.status, "PENDING_EXACT_COMPILE");
  assert.equal(preview.review?.guard.status, "PENDING_EXACT_COMPILE");
  assert.equal(preview.review?.publication.possible, false);
  assert.throws(() => journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions,
    "f".repeat(64), "st-albans.organiser"), /structured_edit_preview_mismatch/);
  assert.equal(journey.read(draft.id)?.draftVersion, draft.draftVersion, "forgery must not mutate");

  const applied = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "st-albans.organiser");
  assert.equal(applied.structureMap.definitionAvailable, true);
  assert.equal(applied.structureMap.nodes.filter(({ kind }) => kind === "POOL").length, 3);
  assert.equal(applied.structureMap.edges.length, 6);
  assert.equal(applied.structureMap.edges.every(({ warnings }) => warnings.some(({ code }) => code === "CONSEQUENTIAL_EDGE")), true);
  assert.throws(() => journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions,
    preview.previewHash, "st-albans.organiser"), /journey_version_conflict/);
  assert.throws(() => journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "st-albans.organiser"),
    /journey_version_conflict/);

  const compiled = journey.compile(applied.id, applied.draftVersion);
  assert.equal(compiled.compiled?.guardStatus, "PASSED");
  const published = journey.approve(compiled.id, compiled.revision, "separate.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
  assert.equal(published.status, "PUBLISHED");
  assert.throws(() => journey.applyStructuredEdit(published.id, published.draftVersion, decisions,
    preview.previewHash, "st-albans.organiser"), /approved_revision_is_immutable/);
});

test("golden compilation is deterministic and never trusts forged source audit claims", () => {
  const value = JSON.parse(fixture) as { audit: Array<{ pass: boolean; detail: string }> };
  value.audit = value.audit.map((claim) => ({ ...claim, pass: true, detail: "client says this passed" }));
  const untrusted = JSON.stringify(value);
  const compile = () => {
    const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
    const draft = journey.create({ mode: "json", text: untrusted });
    const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser");
    const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser");
    return journey.compile(resolved.id, resolved.draftVersion);
  };
  const first = compile(); const replay = compile();
  assert.equal(first.compiled?.guardStatus, "PASSED");
  assert.equal(first.compiled?.specHash, replay.compiled?.specHash);
  assert.equal(first.compiled?.graphHash, replay.compiled?.graphHash);
  assert.equal(first.compiled?.scheduleHash, replay.compiled?.scheduleHash);
  assert.equal(first.compiled?.guardReportHash, replay.compiled?.guardReportHash);
  assert.equal(first.workbench.untrustedClaims.every(({ authority }) => authority === "SOURCE_ASSERTION_ONLY"), true);
});

test("missing contests and a forged final-court assignment fail closed before compilation", () => {
  const value = JSON.parse(fixture) as { schedule: Array<{ id: string; court: number }> };
  value.schedule = value.schedule.filter(({ id }) => id !== "A-G-A-1");
  const missingJourney = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const missing = missingJourney.create({ mode: "json", text: JSON.stringify(value) });
  assert.ok(missing.workbench.conflicts.some(({ id }) => id === "conflict.fixture-count.group"));

  const forgedValue = JSON.parse(fixture) as { schedule: Array<{ id: string; court: number }> };
  forgedValue.schedule.find(({ id }) => id === "A-K-F")!.court = 1;
  const forgedJourney = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const forged = forgedJourney.create({ mode: "json", text: JSON.stringify(forgedValue) });
  assert.ok(forged.workbench.conflicts.some(({ id }) => id === "conflict.final-court.Advanced Konnect Final"));
  assert.throws(() => missingJourney.compile(missing.id, missing.draftVersion), /journey_not_ready/);
  assert.throws(() => forgedJourney.compile(forged.id, forged.draftVersion), /journey_not_ready/);
});

test("the AI-free golden journey publishes one exact revision and replays it after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "st-albans-workbench-"));
  const storagePath = join(directory, "journey.json");
  const times = ["2026-09-14T10:00:00.000Z", "2026-09-14T10:01:00.000Z",
    "2026-09-14T10:02:00.000Z", "2026-09-14T10:03:00.000Z"];
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => times.shift()! });
    const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
    const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
    const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions,
      preview.previewHash, "organiser.author");
    const compiled = journey.compile(resolved.id, resolved.draftVersion);
    const published = journey.approve(compiled.id, compiled.revision, "organiser.approver",
      compiled.compiled?.requiredAcknowledgementCodes ?? []);
    assert.equal(published.status, "PUBLISHED");
    assert.equal(published.publication?.revision, published.compiled?.revision);
    assert.equal(published.publication?.definitionHash, published.compiled?.specHash);
    assert.equal(published.approval?.changeSetHash, published.compiled?.changeSetHash);
    assert.equal(published.publication?.changeSetHash, published.compiled?.changeSetHash);
    assert.equal(published.publication?.outboxIntents[0]?.payload.changeSetHash, published.compiled?.changeSetHash);
    assert.equal(published.publication?.outboxIntents[0]?.payload.revision, published.revision);
    assert.equal(published.webPath, `/competitions/${encodeURIComponent(published.id)}`);

    const restarted = new CompetitionJourney({ storagePath }).read(published.id);
    assert.deepEqual(restarted, published);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

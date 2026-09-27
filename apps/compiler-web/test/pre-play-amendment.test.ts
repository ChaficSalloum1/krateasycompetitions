import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompetitionJourney } from "../src/competition-journey.js";
import { CLOSE_ACKNOWLEDGEMENTS } from "../src/competition-lifecycle.js";

// B2: changes after approval but before play. A published revision is reopened, changed as a draft
// (a withdrawal, a late entry, another court), compiled as the next revision against the published one,
// and replaces it only when approved. Once live play starts, only the guarded live repairs remain.

const rules = { scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order" } as const;
const facts = { name: "Harbour Eight", sport: "padel", participantUnit: "pairs", participantCount: 8, resourceCount: 2,
  resourceLabel: "courts", format: "round_robin", minimumMatches: 7, minimumRestMinutes: 10, matchDurationMinutes: 20,
  timezone: "Europe/London", priority: "fair_recovery", startsAt: "2026-10-18T08:00:00.000Z",
  endsAt: "2026-10-18T17:00:00.000Z", ...rules } as const;
const roster = (ids: readonly number[]) => ["entrant_id,display_name,division_id,member_ids,seed",
  ...ids.map((n, index) => `h8.pair.${n},Harbour Pair ${n},open,h8.pair.${n}.a|h8.pair.${n}.b,${index + 1}`)].join("\n");

function published(clock = { now: "2026-10-01T08:00:00.000Z" }) {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => clock.now });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([1, 2, 3, 4, 5, 6, 7, 8]) });
  c = journey.compile(c.id, c.draftVersion);
  c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  assert.equal(c.status, "PUBLISHED");
  return { journey, c };
}

test("before play, a withdrawal, a late entry and another court are published as the next revision", () => {
  const clock = { now: "2026-10-01T08:00:00.000Z" };
  const { journey, c: first } = published(clock);
  let c = journey.amend(first.id, 1, "organiser.author");
  assert.deepEqual(c.amendment && { from: c.amendment.fromRevision, by: c.amendment.requestedBy }, { from: 1, by: "organiser.author" });
  assert.notEqual(c.status, "PUBLISHED", "the change is a draft until it is approved");

  // Pair 8 withdraws and pair 9 enters late: the roster is replaced. A third court is added.
  c = journey.revise(c.id, c.draftVersion, { mode: "quick", value: { ...facts, resourceCount: 3 } });
  const rosterSource = c.workbench.sources.at(-1)!;
  c = journey.removeSource(c.id, c.draftVersion, rosterSource.id);
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([1, 2, 3, 4, 5, 6, 7, 9]) });
  assert.equal(c.status, "DRAFT");
  assert.equal(c.amendment?.fromRevision, 1, "the amendment survives every edit");

  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.status, "READY_FOR_APPROVAL");
  assert.equal(c.revision, 2, "the change is the next revision, not a fresh revision 1");
  assert.equal(c.compiled!.guardStatus, "PASSED");
  const record = (journey as unknown as { records: Map<string, { compiled: { changeSet: { fromRevision: number | null; toRevision: number } } }> })
    .records.get(c.id)!;
  assert.deepEqual({ from: record.compiled.changeSet.fromRevision, to: record.compiled.changeSet.toRevision }, { from: 1, to: 2 },
    "the change set compares the change with what was published");
  assert.equal(new Set(c.compiled!.schedule.map(({ contestId }) => contestId)).size, 28, "seven original pairs and the late entry play a full round robin");
  assert.equal(new Set(c.compiled!.schedule.map(({ resourceId }) => resourceId)).size, 3, "the extra court is used");

  c = journey.approve(c.id, 2, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  assert.equal(c.status, "PUBLISHED");
  assert.equal(c.publication!.revision, 2);
  assert.equal(c.amendment, undefined);
  assert.deepEqual(c.publicationHistory!.map(({ revision, amendmentRequestedBy }) => ({ revision, amendmentRequestedBy })),
    [{ revision: 1, amendmentRequestedBy: "organiser.author" }], "the replaced revision stays on record");
  assert.equal(c.publicationHistory![0]!.certificateHash, first.publication!.certificateHash);

  c = journey.activateLive(c.id, 2, "operator.lead");
  const entrants = new Set(c.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
  assert.ok(entrants.has("h8.pair.9") && !entrants.has("h8.pair.8"), "live play runs the amended roster");

  // Play the amended event to the end and close it: the closure evidence must verify across the amendment.
  let now = "2026-10-18T07:50:00.000Z";
  const submit = (command: Record<string, unknown>) => {
    clock.now = now;
    c = journey.submitLiveCommand(c.id, 2, { ...command, commandId: `amended.${c.live!.state.version + 1}`,
      expectedVersion: c.live!.state.version, actorId: "operator.lead", occurredAt: now } as never);
  };
  for (const entrantId of [...entrants].sort()) submit({ kind: "CHECK_IN", entrantId });
  const plan = [...c.compiled!.schedule].sort((a, b) => a.start.localeCompare(b.start) || a.contestId.localeCompare(b.contestId));
  for (const fixture of plan) {
    if (Date.parse(now) < Date.parse(fixture.start)) now = fixture.start;
    const [first, second] = c.live!.state.resolvedEntrants[fixture.contestId]!;
    submit({ kind: "START_CONTEST", contestId: fixture.contestId, courtId: fixture.resourceId, startedAt: now });
    submit({ kind: "RECORD_SCORE", contestId: fixture.contestId, scores: [{ entrantId: first, value: 6 }, { entrantId: second, value: 3 }] });
    submit({ kind: "COMPLETE_CONTEST", contestId: fixture.contestId, endedAt: fixture.end < now ? now : fixture.end });
    submit({ kind: "RECORD_RESULT_RECEIPT", contestId: fixture.contestId, source: "desk" });
  }
  clock.now = new Date(Date.parse(now) + 60 * 60_000).toISOString();
  const closed = journey.closeCompetition({ organizationId: "org.flexible", competitionId: c.id, expectedPublishedRevision: 2,
    expectedOperationalRevision: 2, expectedLiveVersion: c.live!.state.version, acknowledgedCodes: [...CLOSE_ACKNOWLEDGEMENTS],
    closedBy: "organiser.closer" });
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closure!.publishedRevision, 2);
  assert.equal(closed.closure!.resultSummary.unresolved, 0);
});

test("an amendment is refused on a stale revision, once live play starts, and until something is published", () => {
  const { journey, c } = published();
  assert.throws(() => journey.amend(c.id, 2, "organiser.author"), /journey_revision_conflict/);
  const live = journey.activateLive(c.id, 1, "operator.lead");
  assert.throws(() => journey.amend(live.id, 1, "organiser.author"), /amendment_requires_no_live_play/);

  const fresh = new CompetitionJourney({ organizationId: "org.flexible", now: () => "2026-10-01T08:00:00.000Z" });
  const draft = fresh.create({ mode: "quick", value: facts }, "organiser.author");
  assert.throws(() => fresh.amend(draft.id, 1, "organiser.author"), /journey_revision_conflict/);
});

test("an amendment survives a restart, and the restored record still verifies", () => {
  const directory = mkdtempSync(join(tmpdir(), "amendment-"));
  try {
    const storagePath = join(directory, "journeys.json");
    const options = { organizationId: "org.flexible", now: () => "2026-10-01T08:00:00.000Z", storagePath };
    const journey = new CompetitionJourney(options);
    let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
    c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([1, 2, 3, 4, 5, 6, 7, 8]) });
    c = journey.compile(c.id, c.draftVersion);
    c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
    const amending = journey.amend(c.id, 1, "organiser.author");
    const restored = new CompetitionJourney(options);
    assert.deepEqual(restored.read(amending.id)?.amendment, amending.amendment);
    const recompiled = restored.compile(amending.id, amending.draftVersion);
    assert.equal(recompiled.revision, 2, "the restored amendment still compiles as the next revision");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

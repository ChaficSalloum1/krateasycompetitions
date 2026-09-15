import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CLOSE_ACKNOWLEDGEMENTS } from "../src/competition-lifecycle.js";
import { CompetitionJourney } from "../src/competition-journey.js";

const policy = {
  sport: "padel", participantUnit: "pairs", resourceCount: 4, resourceLabel: "courts",
  minimumRestMinutes: 10, matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery",
  scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
} as const;

const fixtures = [{
  name: "Harbour Six-Pair Round Robin", format: "round_robin", participantCount: 6, minimumMatches: 5,
  startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z", expectedContests: 15,
}, {
  name: "Northside Eight-Pair Knockout", format: "single_elimination", participantCount: 8, minimumMatches: 1,
  startsAt: "2026-10-25T09:00:00.000Z", endsAt: "2026-10-25T18:00:00.000Z", expectedContests: 7,
}] as const;

function rosterCsv(name: string, participantCount: number, change?: (rows: string[][]) => void): string {
  const prefix = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rows = [["entrant_id", "display_name", "division_id", "member_ids", "seed"],
    ...Array.from({ length: participantCount }, (_, index) => {
      const number = index + 1; const entrantId = `${prefix}.pair.${number}`;
      return [entrantId, `${name} Pair ${number}`, "open",
        `${entrantId}.member.1|${entrantId}.member.2`, String(number)];
    })];
  change?.(rows);
  return rows.map((row) => row.join(",")).join("\n");
}

function completeAvailable(journey: CompetitionJourney, competitionId: string, operationalRevision: number,
  snapshot: ReturnType<CompetitionJourney["read"]>) {
  let current = snapshot!; let command = 0;
  const submit = (body: Record<string, unknown>, occurredAt: string) => {
    command += 1;
    current = journey.submitLiveCommand(competitionId, operationalRevision, { ...body,
      commandId: `generic.${command}`, expectedVersion: current.live!.state.version,
      actorId: "operator.lead", occurredAt } as never);
  };
  const terminal = new Set(["COMPLETED", "WALKOVER", "RETIRED"]);
  const absent = Object.entries(current.live!.state.entrantPresence).find(([, status]) => status === "NO_SHOW")?.[0];
  const participantIds = [...new Set(current.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
  for (const entrantId of participantIds) if (entrantId !== absent)
    submit({ kind: "CHECK_IN", entrantId }, current.live!.activatedAt);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const contest of current.live!.state.definition.contests) {
      if (terminal.has(current.live!.state.contests[contest.contestId]!.status)) continue;
      const entrants = current.live!.state.resolvedEntrants[contest.contestId];
      if (!entrants || entrants.length !== 2 || (contest.dependencyContestIds ?? []).some((id) =>
        !terminal.has(current.live!.state.contests[id]!.status))) continue;
      submit({ kind: "START_CONTEST", contestId: contest.contestId, courtId: contest.courtId,
        startedAt: contest.scheduledStart }, contest.scheduledStart);
      submit({ kind: "RECORD_SCORE", contestId: contest.contestId,
        scores: entrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) }, contest.scheduledStart);
      submit({ kind: "COMPLETE_CONTEST", contestId: contest.contestId,
        endedAt: contest.scheduledEnd }, contest.scheduledEnd);
      progressed = true;
    }
  }
  assert.equal(Object.values(current.live!.state.contests).every(({ status }) => terminal.has(status)), true);
  return current;
}

for (const fixture of fixtures) test(`${fixture.name} uses the same authoritative lifecycle without fixture code`, () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-flexible-journey-"));
  const storagePath = join(directory, "journey.json");
  let clock = fixture.startsAt;
  try {
    const { expectedContests, ...fixtureInput } = fixture;
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.flexible", now: () => clock,
      participantTokenSecret: "generic-fixture-participant-key-32-bytes-minimum" });
    const blueprintDraft = journey.create({ mode: "quick", value: { ...policy, ...fixtureInput } }, "organiser.author");
    assert.equal(blueprintDraft.status, "NEEDS_INPUT");
    assert.ok(blueprintDraft.workbench.missingDecisions.some(({ id }) => id === "entrant-roster"));
    const draft = journey.addSource(blueprintDraft.id, blueprintDraft.draftVersion,
      { mode: "csv", text: rosterCsv(fixture.name, fixture.participantCount) });
    assert.equal(draft.status, "DRAFT");
    assert.deepEqual(draft.supportFindings, []);
    assert.equal(draft.workbench.sources.length, 2);
    assert.deepEqual(draft.workbench.missingDecisions, []);
    assert.equal(draft.workbench.understoodFacts.find(({ id }) => id === "entrants.total")?.value,
      fixture.participantCount);
    assert.equal(draft.workbench.understoodFacts.find(({ id }) => id === "entrants.order")?.provenance.length, 1);
    assert.ok(draft.workbench.understoodFacts.some(({ id, provenance }) => id === "blueprint.participantCount"
      && provenance[0]?.sourceHash === draft.workbench.sources[0]?.sourceHash));
    assert.ok(draft.workbench.rules.some(({ id }) => id === "blueprint.scoringPolicy"));
    assert.ok(draft.requirements.length > 0 && draft.requirements.every(({ id }) => id.startsWith("GEN-")));
    assert.ok(draft.assumptions.length > 0 && draft.assumptions.every(({ id }) => id.startsWith("blueprint.")));

    const preview = journey.planStructuredEdit(draft.id, draft.draftVersion,
      [{ id: "event-name", value: `${fixture.name} — reviewed` }], "organiser.author");
    assert.ok(preview.semanticDiff.some(({ path }) => path === "/identity/name"));
    const reviewed = journey.applyStructuredEdit(draft.id, draft.draftVersion,
      [{ id: "event-name", value: `${fixture.name} — reviewed` }], preview.previewHash, "organiser.author");
    assert.equal(reviewed.name, `${fixture.name} — reviewed`);
    assert.equal(reviewed.workbench.pendingImpact?.previewHash, preview.previewHash);
    assert.deepEqual(reviewed.workbench.missingDecisions, []);

    clock = new Date(Date.parse(fixture.startsAt) - 60_000).toISOString();
    const compiled = journey.compile(reviewed.id, reviewed.draftVersion);
    assert.equal(compiled.compiled?.actualContestCount, expectedContests);
    assert.equal(compiled.compiled?.scheduledContestCount, expectedContests);
    assert.equal(compiled.compiled?.guardStatus, "PASSED");
    assert.equal(compiled.compiled?.guardPreflight.detailed.accounting.reconciled, true);
    assert.equal(compiled.compiled?.changeSet?.reviewedImpact?.previewHash, preview.previewHash);
    const published = journey.approve(compiled.id, compiled.revision, "organiser.approver",
      compiled.compiled?.requiredAcknowledgementCodes ?? []);
    assert.equal(published.status, "PUBLISHED");
    assert.deepEqual(new CompetitionJourney({ storagePath, organizationId: "org.flexible" }).read(published.id), published);

    let active = journey.activateLive(published.id, published.revision, "operator.lead");
    const contest = active.live!.state.definition.contests.find(({ contestId }) =>
      active.live!.state.resolvedEntrants[contestId]?.length === 2
      && active.live!.state.contests[contestId]?.status === "SCHEDULED")!;
    const absentParticipantId = contest.entrantIds[0]!;
    const proposal = journey.proposeNoShow(active.id, active.revision, active.live!.state.version, {
      proposalId: "generic.no-show", contestId: contest.contestId, entrantId: absentParticipantId,
      reason: "Absent after the final published call.", proposedBy: "operator.lead", proposedAt: clock,
    });
    active = journey.approveNoShow(active.id, active.revision, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "competition.director", clock);
    const operationalRevision = 2;
    assert.equal(active.live?.publication?.revision, operationalRevision);
    assert.ok(active.live!.publication!.outboxIntents.length > 0);
    const participantId = contest.entrantIds.find((entrantId) => entrantId !== absentParticipantId)!;
    const expiresAt = new Date(Date.parse(clock) + 60 * 60_000).toISOString();
    const access = journey.issueParticipantAccess({ organizationId: "org.flexible", competitionId: active.id,
      expectedPublishedRevision: 1, participantId, expiresAt });
    const participant = journey.readParticipantNext({ organizationId: "org.flexible", competitionId: active.id,
      expectedOperationalRevision: operationalRevision, token: access.token, at: clock });
    const publicProjection = journey.readPublicLive({ organizationId: "org.flexible", competitionId: active.id,
      expectedOperationalRevision: operationalRevision });
    const organiserProjection = journey.readOrganiserLive({ organizationId: "org.flexible", competitionId: active.id,
      expectedOperationalRevision: operationalRevision, at: clock });
    assert.equal(participant.competition.id, active.id);
    assert.equal(participant.revision, operationalRevision);
    assert.equal(participant.participant.displayName,
      `${fixture.name} Pair ${Number(participantId.split(".").at(-1))}`);
    assert.ok(publicProjection.contests.some(({ participantNames }) => participantNames.includes(participant.participant.displayName)));
    assert.equal(publicProjection.operationalRevision, operationalRevision);
    assert.equal(organiserProjection.public.operationalRevision, operationalRevision);
    const finished = completeAvailable(journey, active.id, operationalRevision, active);
    clock = new Date(Math.max(...finished.live!.state.definition.contests.map(({ scheduledEnd }) => Date.parse(scheduledEnd))) + 60_000).toISOString();
    const closed = journey.closeCompetition({ organizationId: "org.flexible", competitionId: finished.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: operationalRevision,
      expectedLiveVersion: finished.live!.state.version, acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS,
      closedBy: "organiser.closer" });
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.closure?.resultSummary.total, expectedContests);
    assert.equal(closed.closure?.resultSummary.unresolved, 0);
    const bundle = journey.exportClosedBundle({ organizationId: "org.flexible", competitionId: closed.id,
      expectedClosureHash: closed.closure!.closureHash });
    const restored = new CompetitionJourney({ organizationId: "org.flexible", now: () => clock })
      .restoreClosedBundle({ organizationId: "org.flexible", bundle });
    assert.equal(restored.report.status, "VERIFIED");
    assert.equal(restored.snapshot.closure?.closureHash, closed.closure?.closureHash);

    const duplicate = journey.duplicateClosed({ organizationId: "org.flexible", competitionId: closed.id,
      expectedClosureHash: closed.closure!.closureHash, name: `${fixture.name} 2027`, eventDate: "2027-10-24",
      createdBy: "organiser.author" });
    assert.equal(duplicate.status, "DRAFT");
    assert.equal(duplicate.name, `${fixture.name} 2027`);
    const duplicatedCompiled = journey.compile(duplicate.id, duplicate.draftVersion);
    assert.equal(duplicatedCompiled.compiled?.actualContestCount, expectedContests);
    assert.equal(duplicatedCompiled.compiled?.schedule.every(({ start }) => start.startsWith("2027-10-24")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("advertised but unconnected semantics remain explicit and fail closed", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const unsupported = journey.create({ mode: "quick", value: {
    ...policy, name: "Unproven Swiss", format: "swiss", participantCount: 12, minimumMatches: 4,
    startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z",
  } });
  assert.equal(unsupported.status, "NEEDS_INPUT");
  assert.ok(unsupported.supportFindings.some((finding) => finding.includes("round robin and single elimination")));
  assert.throws(() => journey.compile(unsupported.id, unsupported.draftVersion), /journey_not_ready/);

  const oversized = journey.create({ mode: "quick", value: { ...policy, name: "Unproven Scale",
    format: "round_robin", participantCount: 65, minimumMatches: 1,
    startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z" } });
  assert.equal(oversized.status, "NEEDS_INPUT");
  assert.ok(oversized.supportFindings.some((finding) => finding.includes("2 to 64 entrants")));
  assert.throws(() => journey.compile(oversized.id, oversized.draftVersion), /journey_not_ready/);
});

test("generic rosters fail closed on cardinality, identity, shape, seed and cross-source conflicts", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const blueprint = journey.create({ mode: "quick", value: { ...policy, name: "Roster Boundary",
    format: "round_robin", participantCount: 6, minimumMatches: 5,
    startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z" } });
  const short = journey.addSource(blueprint.id, blueprint.draftVersion,
    { mode: "csv", text: rosterCsv("Roster Boundary", 5) });
  assert.ok(short.workbench.conflicts.some(({ id }) => id === "conflict.blueprint.roster-cardinality"));
  assert.throws(() => journey.compile(short.id, short.draftVersion), /journey_not_ready/);

  const clean = journey.removeSource(short.id, short.draftVersion, short.workbench.sources[1]!.id);
  const rostered = journey.addSource(clean.id, clean.draftVersion,
    { mode: "csv", text: rosterCsv("Roster Boundary", 6) });
  assert.deepEqual(rostered.workbench.conflicts, []);
  const forgedName = journey.addSource(rostered.id, rostered.draftVersion, { mode: "csv",
    text: rosterCsv("Roster Boundary", 6, (rows) => { rows[1]![1] = "Forged Pair"; }) });
  assert.ok(forgedName.workbench.conflicts.some(({ id }) => id.includes("display-name")));
  assert.throws(() => journey.compile(forgedName.id, forgedName.draftVersion), /journey_not_ready/);

  const shapeJourney = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const shapeBlueprint = shapeJourney.create({ mode: "quick", value: { ...policy, name: "Shape Boundary",
    format: "single_elimination", participantCount: 4, minimumMatches: 1,
    startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z" } });
  const invalidShape = shapeJourney.addSource(shapeBlueprint.id, shapeBlueprint.draftVersion, { mode: "csv",
    text: rosterCsv("Shape Boundary", 4, (rows) => {
      rows[1]![2] = "another-division"; rows[2]![3] = rows[2]![3]!.split("|")[0]!; rows[3]![4] = "";
    }) });
  for (const id of ["conflict.blueprint.roster-division", "conflict.blueprint.roster-shape",
    "conflict.blueprint.roster-partial-seeding"]) assert.ok(invalidShape.workbench.conflicts.some((entry) => entry.id === id));
  assert.throws(() => shapeJourney.compile(invalidShape.id, invalidShape.draftVersion), /journey_not_ready/);
});

test("restart independently rejects a re-hashed generic workbench roster forged away from its source", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-generic-roster-forgery-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.flexible",
      now: () => "2026-09-15T10:00:00.000Z" });
    const blueprint = journey.create({ mode: "quick", value: { ...policy, name: "Roster Integrity",
      format: "round_robin", participantCount: 4, minimumMatches: 3,
      startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z" } });
    const rostered = journey.addSource(blueprint.id, blueprint.draftVersion,
      { mode: "csv", text: rosterCsv("Roster Integrity", 4) });
    journey.compile(rostered.id, rostered.draftVersion);

    const envelope = JSON.parse(readFileSync(storagePath, "utf8")) as any;
    const record = envelope.records[0];
    const displayName = record.workbench.understoodFacts.find((fact: { path: string }) => fact.path.endsWith("/displayName"));
    displayName.value = "Forged Pair";
    const { recordHash: _recordHash, ...recordBody } = record;
    record.recordHash = canonicalHash(recordBody);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, `${JSON.stringify(envelope, null, 2)}\n`);
    assert.throws(() => new CompetitionJourney({ storagePath, organizationId: "org.flexible" }),
      /journey_store_integrity_failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { renderCourtTimeline, timelineChangesFor } from "../src/court-timeline-view.js";
import { courtLabel, organiserContextOf } from "../src/design-system.js";
import { createCompilerServer } from "../src/server.js";
import { journeyWithLiveCompetition } from "./support/harbour-journey.js";

// E3: a read-only court timeline over the live operational plan, leading only into the guarded
// Change Review. It must show the plan in force (not the compiled one) and carry no command.

async function get(server: ReturnType<typeof createCompilerServer>, url: string) {
  const request = Readable.from([]) as never;
  Object.assign(request, { method: "GET", url, headers: {} });
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
    let status = 0; let headers: Record<string, string> = {};
    server.emit("request", request, { writeHead: (next: number, h: Record<string, string> = {}) => { status = next; headers = h; },
      end: (body = "") => resolve({ status, headers, body }) } as never);
  });
}
const org = "org.flexible";

test("the timeline lists every live fixture once, on its court, in time order, with the plan's times", () => {
  const { journey, live } = journeyWithLiveCompetition();
  const snapshot = journey.read(live.id)!;
  const revision = live.publication!.revision;
  const timeline = journey.readCourtTimeline({ organizationId: org, competitionId: live.id, expectedOperationalRevision: revision });
  const listed = timeline.courts.flatMap(({ courtId, contests }) => contests.map((contest) => ({ courtId, ...contest })));
  const assignments = new Map(snapshot.compiled!.schedule.map((assignment) => [assignment.contestId, assignment]));

  assert.equal(listed.length, snapshot.live!.state.definition.contests.length, "every fixture appears");
  assert.equal(new Set(listed.map(({ contestId }) => contestId)).size, listed.length, "and only once");
  for (const contest of listed) {
    assert.equal(contest.courtId, assignments.get(contest.contestId)!.resourceId);
    assert.equal(contest.startsAt, assignments.get(contest.contestId)!.start);
    assert.equal(contest.endsAt, assignments.get(contest.contestId)!.end);
    assert.equal(contest.participantNames.length, 2);
  }
  for (const { contests } of timeline.courts)
    assert.deepEqual(contests.map(({ startsAt }) => startsAt), contests.map(({ startsAt }) => startsAt).sort(), "time order");
  assert.deepEqual(timeline.courts.map(({ courtId }) => courtId), ["venue.courts.1", "venue.courts.2", "venue.courts.3", "venue.courts.4"]);
});

test("after an approved court outage the timeline shows the repaired operational plan, not the compiled one", () => {
  const { journey, live } = journeyWithLiveCompetition();
  const revision = live.publication!.revision;
  const before = journey.readCourtTimeline({ organizationId: org, competitionId: live.id, expectedOperationalRevision: revision });
  const closed = "venue.courts.4";
  const proposed = journey.proposeCourtOutage(live.id, revision, journey.read(live.id)!.live!.state.version, {
    proposalId: "timeline.outage", courtId: closed, reason: "Net broken", expectedReopenAt: "2026-10-18T08:40:00.000Z",
    proposedBy: "operator.lead", proposedAt: "2026-10-18T08:00:00.000Z" });
  const proposal = proposed.live!.courtOutageProposal!;
  assert.equal(proposal.competitionGuard.status, "PASSED");
  const approved = journey.approveCourtOutage(live.id, revision, proposal.proposalHash, "tournament.director", "2026-10-18T08:01:00.000Z");
  const next = approved.live!.publication!.revision;
  const after = journey.readCourtTimeline({ organizationId: org, competitionId: live.id, expectedOperationalRevision: next });

  assert.equal(after.operationalRevision, next);
  const onClosedCourt = after.courts.find(({ courtId }) => courtId === closed)?.contests ?? [];
  assert.ok(onClosedCourt.every(({ startsAt }) => Date.parse(startsAt) >= Date.parse("2026-10-18T08:40:00.000Z")),
    "nothing is scheduled on the closed court before it reopens");
  const operational = new Map(approved.live!.publication!.operationalAssignments.map((a) => [a.contestId, a]));
  for (const court of after.courts) for (const contest of court.contests) {
    assert.equal(court.courtId, operational.get(contest.contestId)!.resourceId, `${contest.contestId} is on its repaired court`);
    assert.equal(contest.startsAt, operational.get(contest.contestId)!.start);
  }
  assert.notDeepEqual(after.courts, before.courts, "the repair is visible");
  // Run Control's start command takes its court from the organiser projection: it must be the repaired court too.
  const control = journey.readOrganiserLive({ organizationId: org, competitionId: live.id, expectedOperationalRevision: next,
    at: "2026-10-18T08:02:00.000Z" }).controlContests;
  for (const contest of control)
    assert.equal(contest.courtId, operational.get(contest.contestId)!.resourceId, `Run Control starts ${contest.contestId} on its repaired court`);
  assert.ok(control.every(({ courtId, scheduledStart }) => courtId !== closed || Date.parse(scheduledStart) >= Date.parse("2026-10-18T08:40:00.000Z")),
    "Run Control never offers the closed court for a fixture moved off it");
  assert.throws(() => journey.readCourtTimeline({ organizationId: org, competitionId: live.id, expectedOperationalRevision: revision }),
    "a superseded operational revision is never shown as current");
});

test("the timeline page is read-only and script-free, named for people, and reached from Run Control", async () => {
  const { journey, live, draft } = journeyWithLiveCompetition();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: org });
  const id = encodeURIComponent(live.id); const revision = live.publication!.revision;
  const page = await get(server, `/competitions/${id}/timeline`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.headers["content-security-policy"]!, /script-src/, "no script may run on the timeline");
  assert.doesNotMatch(page.body, /<script|<form|<button|method="post"/i, "no command can be sent from the timeline");
  assert.doesNotMatch(page.body.replace(/data-court-id="[^"]*"|href="[^"]*"/g, ""), /venue\.courts/, "court identities are never shown");
  assert.match(page.body, /<h2 id="court-1">Court 1<\/h2>/);
  assert.match(page.body, /aria-current="page">Run Control<\/a>/, "the timeline belongs to Run Control");
  assert.match(page.body, new RegExp(`href="/attention\\?competition=${id.replace(/\./g, "\\.")}&amp;revision=${revision}&amp;change=COURT_OUTAGE&amp;court=venue\\.courts\\.1#change-review"`));
  assert.match(page.body, /Report running late<span class="visually-hidden"> for Harbour Pair \d vs Harbour Pair \d at \d\d:\d\d on Court \d<\/span>/);
  assert.match(page.body, /<time datetime="2026-10-18T08:00:00.000Z">09:00<\/time>/, "times read in the competition's own timezone");

  const runControl = await get(server, `/attention?competition=${id}&revision=${revision}`);
  assert.match(runControl.body, new RegExp(`<a class="timeline-link" href="/competitions/${id.replace(/\./g, "\\.")}/timeline">Court timeline</a>`));
  assert.match(runControl.body, /id="change-review" tabindex="-1"/);

  const notLive = await get(server, `/competitions/${encodeURIComponent(draft.id)}/timeline`);
  assert.equal(notLive.status, 409);
  assert.match(notLive.body, /role="alert" data-competition-state="UNAVAILABLE"/);
  assert.equal((await get(server, "/competitions/unknown/timeline")).status, 404);
  assert.notEqual((await get(createCompilerServer({ production: true, competitionJourney: journey }), `/competitions/${id}/timeline`)).status, 200,
    "production never serves it without an authorised projection");
});

test("finished fixtures offer no change, and courts are named the same way on every surface", () => {
  assert.deepEqual(timelineChangesFor("SCHEDULED"), ["DELAY_OVERRUN", "NO_SHOW"]);
  assert.deepEqual(timelineChangesFor("IN_PROGRESS"), ["DELAY_OVERRUN"]);
  for (const status of ["COMPLETED", "WALKOVER", "RETIRED"] as const) assert.deepEqual(timelineChangesFor(status), []);
  assert.equal(courtLabel("venue.courts.3"), "Court 3");
  assert.equal(courtLabel("venue.courts.main.12"), "Court 12");
  assert.equal(courtLabel("venue.court-07"), "Court 7");
  assert.equal(courtLabel("venue.centre_court"), "Centre Court");

  const { journey, live } = journeyWithLiveCompetition();
  const timeline = journey.readCourtTimeline({ organizationId: org, competitionId: live.id, expectedOperationalRevision: live.publication!.revision });
  const first = timeline.courts[0]!.contests[0]!;
  const done = { ...timeline, courts: [{ ...timeline.courts[0]!, contests: [{ ...first, status: "COMPLETED" as const }] }] };
  const html = renderCourtTimeline(done, organiserContextOf(journey.read(live.id)!), "Europe/London");
  assert.doesNotMatch(html.slice(html.indexOf("<li")), /Report running late|Report a no-show/);
  assert.match(html, /data-status="COMPLETED"><div class="row">.*?Completed<\/span>/);
});

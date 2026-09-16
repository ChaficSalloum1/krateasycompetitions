import assert from "node:assert/strict";
import test from "node:test";
import { deriveRunControlTriage, runControlHtml, type RunControlAttentionRow } from "../src/run-control-view.js";
import { renderOrganiserStudio } from "../src/organiser-studio-view.js";

const row = (kind: RunControlAttentionRow["kind"], contestId: string, start: string,
  reasons: readonly string[] = [], courtId = "Court A"): RunControlAttentionRow => ({
  kind, contestId, courtId, scheduledStart: `2026-09-20T${start}:00.000Z`, reasons,
});

test("derived dependency fixtures collapse under the first unresolved actionable cause", () => {
  const triage = deriveRunControlTriage([
    row("BLOCKED", "fixture.root", "10:00", ["ENTRANT_NOT_CHECKED_IN: entrant.alex"]),
    row("BLOCKED", "fixture.same-cause", "10:05", ["ENTRANT_NOT_CHECKED_IN: entrant.alex"]),
    row("BLOCKED", "fixture.child", "10:10", ["PENDING_PREDECESSOR: fixture.root"]),
    row("BLOCKED", "fixture.grandchild", "10:20", ["PENDING_PREDECESSOR: fixture.child"]),
  ]);

  assert.equal(triage.length, 1);
  assert.deepEqual(triage[0], {
    key: "ENTRANT_NOT_CHECKED_IN:entrant.alex",
    code: "ENTRANT_NOT_CHECKED_IN",
    subjectIds: ["entrant.alex"],
    urgency: 76,
    urgencyLabel: "Next",
    action: "CHECK_IN",
    rootContestId: "fixture.root",
    affectedContestIds: ["fixture.root", "fixture.same-cause", "fixture.child", "fixture.grandchild"],
    derivedBlockedContestIds: ["fixture.child", "fixture.grandchild"],
    courtIds: ["Court A"],
    reasons: [
      "ENTRANT_NOT_CHECKED_IN: entrant.alex",
      "PENDING_PREDECESSOR: fixture.child",
      "PENDING_PREDECESSOR: fixture.root",
    ],
  });
});

test("root causes rank by operational urgency, then affected scope, with contextual actions", () => {
  const triage = deriveRunControlTriage([
    row("LATE", "fixture.late", "10:10", ["12 minutes late"]),
    row("NOW", "fixture.live", "10:05"),
    row("NEEDS_ATTENTION", "fixture.result", "09:40", ["Result receipt is missing"]),
    row("BLOCKED", "fixture.check-in-small", "10:00", ["ENTRANT_NOT_CHECKED_IN: entrant.small"]),
    row("BLOCKED", "fixture.check-in-wide-a", "09:50", ["ENTRANT_NOT_CHECKED_IN: entrant.wide"]),
    row("BLOCKED", "fixture.check-in-wide-b", "09:55", ["ENTRANT_NOT_CHECKED_IN: entrant.wide"]),
    row("BLOCKED", "fixture.court", "09:45", ["COURT_CLOSED: Court B"], "Court B"),
    row("BLOCKED", "fixture.no-show", "09:35", ["ENTRANT_NO_SHOW: entrant.absent"]),
    row("NEXT", "fixture.next", "10:30"),
  ]);

  assert.deepEqual(triage.map(({ code }) => code), [
    "COURT_CLOSED", "ENTRANT_NO_SHOW", "NEEDS_ATTENTION", "ENTRANT_NOT_CHECKED_IN",
    "ENTRANT_NOT_CHECKED_IN", "LATE", "NOW", "NEXT",
  ]);
  assert.deepEqual(triage.map(({ action }) => action), [
    "INCIDENT", "INCIDENT", "RECORD_SCORE", "CHECK_IN", "CHECK_IN",
    "CALL_CONTEST", "RECORD_SCORE", "CALL_CONTEST",
  ]);
  assert.equal(triage[3]?.affectedContestIds.length, 2, "wider equal-urgency cause ranks first");
  assert.deepEqual([...new Set(triage.flatMap(({ affectedContestIds }) => affectedContestIds))].sort(), [
    "fixture.check-in-small", "fixture.check-in-wide-a", "fixture.check-in-wide-b", "fixture.court",
    "fixture.late", "fixture.live", "fixture.next", "fixture.no-show", "fixture.result",
  ]);
});

test("dependency cycles fail visibly into deterministic incident evidence", () => {
  const triage = deriveRunControlTriage([
    row("BLOCKED", "fixture.a", "10:00", ["PENDING_PREDECESSOR: fixture.b"]),
    row("BLOCKED", "fixture.b", "10:05", ["PENDING_PREDECESSOR: fixture.a"]),
  ]);
  assert.equal(triage.length, 2);
  assert.ok(triage.every(({ code, action }) => code === "PENDING_PREDECESSOR" && action === "INCIDENT"));
  assert.equal(triage.flatMap(({ affectedContestIds }) => affectedContestIds).length, 2);
});

test("Run Control exposes contextual controls while keeping stable identities in technical evidence", () => {
  for (const expected of ["deriveTriage", "data-context-action", "Check in ", "Call fixture",
    "Record score", "Open incident review", "Technical evidence", "Technical head evidence",
    "Close Receipt", "Ranked by urgency, then affected scope"])
    assert.ok(runControlHtml.includes(expected), `Run Control is missing ${expected}`);
  assert.ok(!runControlHtml.includes("<strong>'+esc(x.contestId)"));
  assert.ok(!runControlHtml.includes("x.displayName+' · '+x.participantId"));
  assert.match(runControlHtml, /JSON\.stringify\(\{expectedRevision:state\.public\.operationalRevision,command:liveCommand\(\)\}\)/);
});

test("published and closed Studio wording keeps canonical truth ahead of historical provenance", () => {
  const html = renderOrganiserStudio("competition.published");
  for (const expected of ["Published canonical facts", "Closed canonical facts", "Revision-bound competition truth",
    "Revision-bound competition record", "Historical provenance — source records",
    "Historical provenance — draft questions and conflicts", "The published plan is not unresolved",
    "Technical revision evidence"])
    assert.ok(html.includes(expected), `Studio is missing ${expected}`);
  assert.ok(html.indexOf("data-canonical-truth") < html.indexOf("Historical provenance — source records"));
});

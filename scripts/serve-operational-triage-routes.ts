/** Deterministic local-only state for routed Run Control and reflow rehearsals. */
import { readFileSync } from "node:fs";
import { CompetitionJourney } from "../apps/compiler-web/src/competition-journey.js";
import { CLOSE_ACKNOWLEDGEMENTS } from "../apps/compiler-web/src/competition-lifecycle.js";
import { createCompilerServer } from "../apps/compiler-web/src/server.js";

const fixture = readFileSync(new URL("../apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url), "utf8").trimEnd();
const closedMode = process.env.CLOSED_STUDIO === "1";
const at = closedMode ? "2026-09-20T20:30:00.000Z" : "2026-09-20T00:00:00.000Z";
const organizationId = "org.st-albans";
const journey = new CompetitionJourney({ organizationId, now: () => at });
const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
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
const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
const compiled = journey.compile(resolved.id, resolved.draftVersion);
const published = journey.approve(compiled.id, 1, "organiser.approver", compiled.compiled?.requiredAcknowledgementCodes ?? []);
let current = journey.activateLive(published.id, 1, "operator.lead");
const participantIds = [...new Set(current.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
const missingEntrantId = closedMode ? "" : participantIds[0]!;
for (const entrantId of closedMode ? participantIds : participantIds.slice(1)) {
  current = journey.submitLiveCommand(published.id, 1, {
    kind: "CHECK_IN", entrantId, commandId: `browser.seed.checkin.${entrantId}`,
    expectedVersion: current.live!.state.version, actorId: "operator.lead", occurredAt: at,
  } as never);
}
let closedCourtId = "";
let noShowEntrantId = "";
let noShowContestId = "";
let withdrawnEntrantId = "";
let receiptContestId = "";
if (closedMode) {
  const terminal = new Set(["COMPLETED", "WALKOVER", "RETIRED"]);
  let progressed = true;
  let command = 0;
  while (progressed) {
    progressed = false;
    for (const contest of current.live!.state.definition.contests) {
      if (terminal.has(current.live!.state.contests[contest.contestId]!.status)) continue;
      const entrants = current.live!.state.resolvedEntrants[contest.contestId];
      if (!entrants || entrants.length !== 2 || (contest.dependencyContestIds ?? []).some((id) =>
        !terminal.has(current.live!.state.contests[id]!.status))) continue;
      const submit = (body: Record<string, unknown>) => {
        command += 1;
        current = journey.submitLiveCommand(published.id, 1, { ...body,
          commandId: `browser.closed.${command}`, expectedVersion: current.live!.state.version,
          actorId: "operator.lead", occurredAt: at } as never);
      };
      submit({ kind: "START_CONTEST", contestId: contest.contestId,
        courtId: contest.courtId, startedAt: contest.scheduledStart });
      submit({ kind: "RECORD_SCORE", contestId: contest.contestId,
        scores: entrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) });
      submit({ kind: "COMPLETE_CONTEST", contestId: contest.contestId, endedAt: contest.scheduledEnd });
      progressed = true;
    }
  }
  current = journey.closeCompetition({ organizationId, competitionId: published.id,
    expectedPublishedRevision: 1, expectedOperationalRevision: 1,
    expectedLiveVersion: current.live!.state.version, acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS,
    closedBy: "organiser.closer" });
} else {
  const definition = current.live!.state.definition;
  const leafContests = definition.contests.filter(({ contestId, dependencyContestIds }) =>
    !(dependencyContestIds ?? []).length && (current.live!.state.resolvedEntrants[contestId]?.length ?? 0) === 2);
  const noShowContest = leafContests.find(({ contestId }) =>
    !current.live!.state.resolvedEntrants[contestId]!.includes(missingEntrantId));
  if (!noShowContest) throw new Error("no_show_seed_contest_unavailable");
  noShowContestId = noShowContest.contestId;
  noShowEntrantId = current.live!.state.resolvedEntrants[noShowContestId]![1]!;
  withdrawnEntrantId = participantIds.find((entrantId) =>
    entrantId !== missingEntrantId && entrantId !== noShowEntrantId
    && leafContests.some(({ contestId }) => current.live!.state.resolvedEntrants[contestId]!.includes(entrantId))) ?? "";
  const receiptContest = leafContests.find(({ contestId }) => {
    const entrants = current.live!.state.resolvedEntrants[contestId]!;
    return !entrants.some((entrantId) => [missingEntrantId, noShowEntrantId, withdrawnEntrantId].includes(entrantId));
  });
  if (!withdrawnEntrantId || !receiptContest) throw new Error("closure_seed_context_unavailable");
  receiptContestId = receiptContest.contestId;
  const submit = (body: Record<string, unknown>, id: string) => {
    current = journey.submitLiveCommand(published.id, 1, { ...body, commandId: `browser.seed.${id}`,
      expectedVersion: current.live!.state.version, actorId: "operator.lead", occurredAt: at } as never);
  };
  submit({ kind: "DECLARE_NO_SHOW", contestId: noShowContestId, entrantId: noShowEntrantId,
    reason: "Deterministic rehearsal no-show" }, "no-show");
  submit({ kind: "WITHDRAW_ENTRANT", entrantId: withdrawnEntrantId,
    reason: "Deterministic rehearsal withdrawal" }, "withdrawal");
  const receiptEntrants = current.live!.state.resolvedEntrants[receiptContestId]!;
  submit({ kind: "START_CONTEST", contestId: receiptContestId, courtId: receiptContest.courtId,
    startedAt: receiptContest.scheduledStart }, "receipt-start");
  submit({ kind: "RECORD_SCORE", contestId: receiptContestId,
    scores: receiptEntrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) }, "receipt-score");
  submit({ kind: "COMPLETE_CONTEST", contestId: receiptContestId,
    endedAt: receiptContest.scheduledEnd }, "receipt-complete");
  closedCourtId = current.live!.state.definition.courts[0]!;
  submit({ kind: "CLOSE_COURT", courtId: closedCourtId, reason: "Deterministic rehearsal outage" }, "close-court");
}

const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId });
const port = Number(process.env.PORT ?? 4179);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const origin = `http://127.0.0.1:${actualPort}`;
  const competition = encodeURIComponent(published.id);
  process.stdout.write(JSON.stringify({
    origin,
    portfolioUrl: `${origin}/`,
    studioUrl: `${origin}/competitions/${competition}`,
    runControlUrl: `${origin}/attention?competition=${competition}&revision=1`,
    receiptUrl: `${origin}/competitions/${competition}/receipt`,
    competitionId: published.id,
    missingEntrantId,
    closedCourtId,
    noShowEntrantId,
    noShowContestId,
    withdrawnEntrantId,
    receiptContestId,
    fixtureCount: current.live!.state.definition.contests.length,
    seededLiveVersion: current.live!.state.version,
    closed: closedMode,
  }) + "\n");
});

import { readFileSync } from "node:fs";
import { CompetitionJourney } from "../apps/compiler-web/src/competition-journey.js";
import { createCompilerServer } from "../apps/compiler-web/src/server.js";

const fixture = readFileSync(new URL("../apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json",
  import.meta.url), "utf8").trimEnd();
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
const at = "2026-09-20T13:00:00.000Z";
const organizationId = "org.st-albans";
const journey = new CompetitionJourney({ organizationId,
  participantTokenSecret: "local-browser-verification-participant-secret-2026", now: () => at });
const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
const edit = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, edit.previewHash, "organiser.author");
const compiled = journey.compile(resolved.id, resolved.draftVersion);
const published = journey.approve(compiled.id, 1, "organiser.approver",
  compiled.compiled?.requiredAcknowledgementCodes ?? []);
let current = journey.activateLive(published.id, 1, "operator.lead");
const groups = current.live!.state.definition.contests.filter(({ contestId }) => contestId.includes(".pools."));
const completed = groups[0]!;
const inProgress = groups.find(({ entrantIds }) => entrantIds.every((id) => !completed.entrantIds.includes(id)))!;
const noShow = groups.find(({ entrantIds }) => entrantIds.every((id) =>
  !completed.entrantIds.includes(id) && !inProgress.entrantIds.includes(id)))!;
const submit = (command: Record<string, unknown>) => {
  current = journey.submitLiveCommand(published.id, 1, { ...command,
    commandId: `browser.command.${current.live!.state.version + 1}`,
    expectedVersion: current.live!.state.version, actorId: "operator.lead", occurredAt: at } as never);
};
for (const participantId of [...completed.entrantIds, ...inProgress.entrantIds])
  submit({ kind: "CHECK_IN", entrantId: participantId });
submit({ kind: "CALL_CONTEST", contestId: completed.contestId });
submit({ kind: "START_CONTEST", contestId: completed.contestId, courtId: completed.courtId,
  startedAt: "2026-09-20T11:00:00.000Z" });
submit({ kind: "RECORD_SCORE", contestId: completed.contestId,
  scores: completed.entrantIds.map((entrantId, index) => ({ entrantId, value: 6 - index })) });
submit({ kind: "COMPLETE_CONTEST", contestId: completed.contestId, endedAt: "2026-09-20T11:30:00.000Z" });
submit({ kind: "START_CONTEST", contestId: inProgress.contestId, courtId: inProgress.courtId,
  startedAt: "2026-09-20T12:30:00.000Z" });
const participantId = noShow.entrantIds[0]!;
const access = journey.issueParticipantAccess({ organizationId, competitionId: published.id,
  expectedPublishedRevision: 1, participantId, expiresAt: "2026-09-21T00:00:00.000Z" });
const proposal = journey.proposeNoShow(published.id, 1, current.live!.state.version, {
  proposalId: "browser.no-show", contestId: noShow.contestId, entrantId: participantId,
  reason: "Absent after reporting window.", proposedBy: "operator.lead", proposedAt: at });
journey.approveNoShow(published.id, 1, proposal.live!.proposal!.proposalHash,
  proposal.live!.proposal!.options[1]!.optionHash, "RELEASE_WALKOVER_SLOTS", "tournament.director", at);

const port = Number(process.env.PORT ?? 4178);
const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId, now: () => at });
server.listen(port, "127.0.0.1", () => {
  const origin = `http://127.0.0.1:${port}`;
  const participantUrl = new URL(access.path, origin); participantUrl.searchParams.set("revision", "2");
  process.stdout.write(`${JSON.stringify({ competitionId: published.id, participantId,
    participantUrl: participantUrl.toString(), publicUrl: `${origin}/display?competition=${encodeURIComponent(published.id)}&revision=2`,
    organiserUrl: `${origin}/attention?competition=${encodeURIComponent(published.id)}&revision=2` })}\n`);
});

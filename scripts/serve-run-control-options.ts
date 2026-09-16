/** Local, deterministic browser rehearsal state; no production data or provider calls. */
import { readFileSync } from "node:fs";
import { CompetitionJourney } from "../apps/compiler-web/src/competition-journey.js";
import { createCompilerServer } from "../apps/compiler-web/src/server.js";

const fixture = readFileSync(new URL("../apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url), "utf8").trimEnd();
const at = "2026-09-20T13:00:00.000Z";
const organizationId = "org.st-albans";
const journey = new CompetitionJourney({ organizationId, now: () => at });
const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
const decisions = [{ id: "qualification", value: "top_four_konnect_remainder_tower" }, { id: "scoring", value: "padel.timed.standard@1.0.0" }, { id: "tiebreak", value: "wins_game_difference_games_won_head_to_head_manual" }, { id: "normalisation", value: "percentage" }, { id: "withdrawal", value: "preserve_played_walkover_future" }, { id: "approval-authority", value: "separate_compiler_approver_publisher" }, { id: "event-date", value: "2026-09-20" }, { id: "timezone", value: "Europe/London" }] as const;
const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
const compiled = journey.compile(resolved.id, resolved.draftVersion);
const published = journey.approve(compiled.id, 1, "organiser.approver", compiled.compiled?.requiredAcknowledgementCodes ?? []);
let current = journey.activateLive(published.id, 1, "operator.lead");
const contest = current.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
for (const entrantId of contest.entrantIds) current = journey.submitLiveCommand(published.id, 1, { kind: "CHECK_IN", entrantId, commandId: "browser.checkin." + entrantId, expectedVersion: current.live!.state.version, actorId: "operator.lead", occurredAt: at } as never);
const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId, now: () => at });
const port = Number(process.env.PORT ?? 4178);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(JSON.stringify({ organiserUrl: "http://127.0.0.1:" + actualPort + "/attention?competition=" + encodeURIComponent(published.id) + "&revision=1", contestId: contest.contestId, entrantId: contest.entrantIds[0] }) + "\n");
});

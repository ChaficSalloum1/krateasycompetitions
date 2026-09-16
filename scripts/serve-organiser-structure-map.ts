/** Deterministic local state for the Organiser Studio structure-revision rehearsal. */
import { readFileSync } from "node:fs";
import { CompetitionJourney } from "../apps/compiler-web/src/competition-journey.js";
import { createCompilerServer } from "../apps/compiler-web/src/server.js";

const fixture = readFileSync(new URL("../apps/compiler-web/test/fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url), "utf8").trimEnd();
const at = "2026-09-14T10:00:00.000Z";
const journey = new CompetitionJourney({ organizationId: "org.st-albans", now: () => at });
const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
const nonQualification = [
  { id: "scoring", value: "padel.timed.standard@1.0.0" }, { id: "tiebreak", value: "wins_game_difference_games_won_head_to_head_manual" },
  { id: "normalisation", value: "percentage" }, { id: "withdrawal", value: "preserve_played_walkover_future" },
  { id: "approval-authority", value: "separate_compiler_approver_publisher" }, { id: "event-date", value: "2026-09-20" }, { id: "timezone", value: "Europe/London" },
] as const;
const partial = journey.planStructuredEdit(draft.id, draft.draftVersion, nonQualification, "organiser.author");
const readyForStructure = journey.applyStructuredEdit(draft.id, draft.draftVersion, nonQualification, partial.previewHash, "organiser.author");
const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.st-albans", now: () => at });
server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(JSON.stringify({ organiserUrl: `http://127.0.0.1:${port}/competitions/${encodeURIComponent(readyForStructure.id)}`, competitionId: readyForStructure.id }) + "\n");
});

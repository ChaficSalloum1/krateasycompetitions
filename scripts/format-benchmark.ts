// Format benchmark: the definition of "the engine works". Each case is a realistic club event created
// the way an organiser creates it (quick facts + roster), compiled through the product journey, and
// judged on one bar: a Guard-passed plan within the time limit. Prints a table; with --json, writes
// evidence/format-benchmark.json.
//   npm run bench:formats            (node --import tsx scripts/format-benchmark.ts [--json] [--only=<substring>])
// Exits non-zero when any case fails, so CI can hold the bar.
import { writeFileSync, mkdirSync } from "node:fs";
import { CompetitionJourney } from "../apps/compiler-web/src/competition-journey.js";

type Case = { id: string; format: "round_robin" | "single_elimination"; entrants: number; courts: number; minutes: number };
const LIMIT_SECONDS = 10;
const cases: Case[] = [];
for (const format of ["round_robin", "single_elimination"] as const)
  for (const entrants of format === "round_robin" ? [6, 8, 12] : [8, 16, 32])
    for (const courts of [2, 3, 4, 6])
      for (const minutes of [20, 30])
        cases.push({ id: `${format}.${entrants}p.${courts}c.${minutes}m`, format, entrants, courts, minutes });

const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const results: Array<Case & { status: string; guard: string | null; seconds: number; pass: boolean; detail: string }> = [];
for (const c of cases.filter(({ id }) => !only || id.includes(only))) {
  const facts = { name: `Benchmark ${c.id}`, sport: "padel", participantUnit: "pairs", participantCount: c.entrants,
    resourceCount: c.courts, resourceLabel: "courts", format: c.format, minimumMatches: c.format === "round_robin" ? c.entrants - 1 : 1,
    minimumRestMinutes: 10, matchDurationMinutes: c.minutes, timezone: "Europe/London", priority: "fair_recovery",
    scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
    withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
    startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" };
  const roster = ["entrant_id,display_name,division_id,member_ids,seed", ...Array.from({ length: c.entrants }, (_, i) =>
    `bench.pair.${i + 1},Pair ${i + 1},open,bench.pair.${i + 1}.a|bench.pair.${i + 1}.b,${i + 1}`)].join("\n");
  const journey = new CompetitionJourney({ organizationId: "org.bench", now: () => "2026-11-07T08:00:00.000Z" });
  const started = Date.now();
  let status = "ERROR"; let guard: string | null = null; let detail = "";
  try {
    let snapshot = journey.create({ mode: "quick", value: facts } as never, "bench");
    snapshot = journey.addSource(snapshot.id, snapshot.draftVersion, { mode: "csv", text: roster });
    if (snapshot.status !== "DRAFT") throw new Error(`not_ready:${snapshot.supportFindings.join("|") || snapshot.status}`);
    snapshot = journey.compile(snapshot.id, snapshot.draftVersion);
    status = snapshot.compiled!.solverStatus; guard = snapshot.compiled!.guardStatus;
    if (guard !== "PASSED") detail = snapshot.compiled!.guardFindings.filter((f: { publicationDisposition?: string }) => f.publicationDisposition === "BLOCK")
      .map((f: { sourceCode?: string; code?: string }) => f.sourceCode ?? f.code).join(",");
  } catch (error) { detail = (error as Error).message; }
  const seconds = (Date.now() - started) / 1000;
  // An event whose matches cannot fit its courts and hours must be refused with the reason, not planned.
  const matches = c.format === "round_robin" ? c.entrants * (c.entrants - 1) / 2 : c.entrants - 1;
  const impossible = matches * c.minutes > c.courts * 12 * 60;
  const pass = impossible ? detail === "journey_capacity_insufficient" : guard === "PASSED" && seconds <= LIMIT_SECONDS;
  if (impossible) status = "REFUSED";
  results.push({ ...c, status, guard, seconds, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(34)} ${status.padEnd(10)} guard=${String(guard).padEnd(8)} ${seconds.toFixed(1).padStart(6)}s  ${detail}`);
}
const passed = results.filter(({ pass }) => pass).length;
console.log(`\n${passed}/${results.length} cases pass: a Guard-passed plan within ${LIMIT_SECONDS}s, or an impossible event refused with its reason`);
if (process.argv.includes("--json")) {
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/format-benchmark.json", JSON.stringify({ limitSeconds: LIMIT_SECONDS, passed, total: results.length, results }, null, 2));
}
if (passed !== results.length) process.exitCode = 1;

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";
import { createCompilerServer } from "../src/server.js";

// Compiling a generic competition runs CP-SAT. It must not stall every other request on the host
// (live scoring, check-in, health) while it solves, and the off-path result is only ever a cache.

const clock = "2026-10-18T08:00:00.000Z";
const harbour = {
  sport: "padel", participantUnit: "pairs", resourceCount: 4, resourceLabel: "courts",
  minimumRestMinutes: 10, matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery",
  scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
  name: "Harbour Six-Pair Round Robin", format: "round_robin", participantCount: 6, minimumMatches: 5,
  startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z",
} as const;
const roster = ["entrant_id,display_name,division_id,member_ids,seed", ...Array.from({ length: 6 }, (_, index) =>
  `harbour.pair.${index + 1},Harbour Pair ${index + 1},open,harbour.pair.${index + 1}.member.1|harbour.pair.${index + 1}.member.2,${index + 1}`)].join("\n");

function readyDraft() {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => clock });
  const blueprint = journey.create({ mode: "quick", value: harbour }, "organiser.author");
  const draft = journey.addSource(blueprint.id, blueprint.draftVersion, { mode: "csv", text: roster });
  return { journey, draft };
}

async function http(server: ReturnType<typeof createCompilerServer>, method: "GET" | "POST", url: string,
  body?: unknown): Promise<{ status: number; body: any }> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(payload.length ? [payload] : []) as never;
  Object.assign(request, { method, url, headers: body === undefined ? {} : {
    "content-type": "application/json", "content-length": String(payload.length) } });
  return new Promise((resolve) => {
    let status = 0; let headers: Record<string, string> = {};
    server.emit("request", request, { writeHead: (nextStatus: number, nextHeaders: Record<string, string>) => {
      status = nextStatus; headers = nextHeaders ?? {};
    }, end: (encoded = "") => resolve({ status,
      body: (headers["content-type"] ?? "").includes("application/json") ? JSON.parse(encoded) : encoded }) } as never);
  });
}

test("an HTTP compile solves off the event loop and yields the same plan as a direct compile", async () => {
  const { journey, draft } = readyDraft();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  const finished: string[] = [];
  const compiling = http(server, "POST", `/v1/competition-journey/${encodeURIComponent(draft.id)}/compile`,
    { expectedDraftVersion: draft.draftVersion }).then((response) => { finished.push("compile"); return response; });
  // Ask for health on a timer: a compile that blocks the event loop would not let this timer fire at all
  // until it had finished, so the order below distinguishes solving off the loop from blocking it.
  const health = await new Promise<{ status: number; body: any }>((resolve) => setTimeout(() =>
    resolve(http(server, "GET", "/health/live")), 20));
  finished.push("health");
  const compiled = await compiling;

  assert.equal(health.status, 200);
  assert.deepEqual(finished, ["health", "compile"], "the health check answered while CP-SAT was still solving");
  assert.equal(compiled.status, 200, JSON.stringify(compiled.body));
  assert.equal(compiled.body.compiled.solverStatus, "OPTIMAL");

  const direct = readyDraft();
  const directlyCompiled = direct.journey.compile(direct.draft.id, direct.draft.draftVersion);
  assert.equal(compiled.body.compiled.scheduleHash, directlyCompiled.compiled!.scheduleHash,
    "the prepared result is the same plan the synchronous path would have produced");
});

test("a prepared result is never trusted: a tampered one cannot become a plan, a stale one is ignored", async () => {
  const { journey, draft } = readyDraft();
  const prepared = await journey.prepareCompile(draft.id, draft.draftVersion);
  assert.ok(prepared.presolved, "the Harbour draft is scheduled through CP-SAT");
  // Stack every contest on one court at minute 0, keeping the content hash so the cache would match.
  const tampered = { ...prepared, presolved: { ...prepared.presolved!, result: { ...prepared.presolved!.result,
    assignments: prepared.presolved!.result.assignments.map((assignment) => ({ ...assignment,
      resourceId: prepared.presolved!.result.assignments[0]!.resourceId, startMinute: 0,
      endMinute: assignment.endMinute - assignment.startMinute })) } } };
  assert.throws(() => journey.compile(draft.id, draft.draftVersion, tampered), /journey_solver_rejected/,
    "the independent validation of the CP-SAT answer still runs on a cached result");

  const stale = { ...tampered, draftVersion: draft.draftVersion - 1 };
  const compiled = journey.compile(draft.id, draft.draftVersion, stale);
  assert.equal(compiled.compiled?.solverStatus, "OPTIMAL", "a result prepared for another draft is ignored and solved afresh");
});

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";
import { createCompilerServer } from "../src/server.js";

const timestamp = "2026-09-20T13:00:00.000Z";

async function http(server: ReturnType<typeof createCompilerServer>, method: "GET" | "POST", url: string,
  body?: unknown): Promise<{ status: number; body: any }> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(payload.length ? [payload] : []) as never;
  Object.assign(request, { method, url, headers: body === undefined ? {} : {
    "content-type": "application/json", "content-length": String(payload.length) } });
  return new Promise((resolve) => {
    let status = 0;
    server.emit("request", request, { writeHead: (nextStatus: number) => { status = nextStatus; },
      end: (encoded = "") => resolve({ status, body: JSON.parse(encoded) }) } as never);
  });
}

const quickSource = {
  mode: "quick", value: { name: "Readiness Cup", sport: "padel", participantUnit: "pairs",
    participantCount: 4, resourceCount: 2, resourceLabel: "courts", format: "round_robin", minimumMatches: 3,
    minimumRestMinutes: 10, matchDurationMinutes: 20, startsAt: "2026-10-18T08:00:00.000Z",
    endsAt: "2026-10-18T17:00:00.000Z", timezone: "Europe/London", priority: "fair_recovery",
    scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
    withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order" },
};

const roster = ["entrant_id,display_name,division_id,member_ids,seed",
  ...Array.from({ length: 4 }, (_, index) => { const n = index + 1;
    return `pair.${n},Pair ${n},open,pair.${n}.m1|pair.${n}.m2,${n}`; })].join("\n");

test("certificationReadiness is UNCERTIFIED for a draft that has never been compiled, never REJECTED", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.readiness", now: () => timestamp });
  const server = createCompilerServer({ competitionJourney: journey });
  const created = await http(server, "POST", "/v1/competition-journey", { source: quickSource });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "NEEDS_INPUT");

  const list = await http(server, "GET", "/v1/tournaments");
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].certificationReadiness, "UNCERTIFIED");
  assert.equal(list.body.items[0].certificationStatus, "REJECTED", "the legacy binary field must stay untouched for the Mac/iOS client");

  const blueprint = await http(server, "GET", `/v1/tournaments/${encodeURIComponent(created.body.id)}/blueprint`);
  assert.equal(blueprint.body.certificationReadiness, "UNCERTIFIED");
  assert.equal(blueprint.body.certificationStatus, "REJECTED");
  server.close();
});

test("certificationReadiness becomes CERTIFIED once Guard passes, before publication", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.readiness", now: () => timestamp });
  const server = createCompilerServer({ competitionJourney: journey });
  const created = await http(server, "POST", "/v1/competition-journey", { source: quickSource });
  const rostered = await http(server, "POST", `/v1/competition-journey/${encodeURIComponent(created.body.id)}/sources`,
    { expectedDraftVersion: created.body.draftVersion, source: { mode: "csv", text: roster } });
  assert.equal(rostered.status, 200);
  const compiled = await http(server, "POST", `/v1/competition-journey/${encodeURIComponent(created.body.id)}/compile`,
    { expectedDraftVersion: rostered.body.draftVersion });
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.compiled.guardStatus, "PASSED");

  const list = await http(server, "GET", "/v1/tournaments");
  assert.equal(list.body.items[0].certificationReadiness, "CERTIFIED");
  assert.equal(list.body.items[0].certificationStatus, "REJECTED",
    "the legacy field only turns CERTIFIED at PUBLISHED, which is the pre-existing (unchanged) behaviour");

  const published = await http(server, "POST", `/v1/competition-journey/${encodeURIComponent(created.body.id)}/approve`,
    { expectedRevision: compiled.body.revision, acknowledgedFindingCodes: compiled.body.compiled.requiredAcknowledgementCodes });
  assert.equal(published.status, 200);
  assert.equal(published.body.status, "PUBLISHED");

  const afterPublish = await http(server, "GET", "/v1/tournaments");
  assert.equal(afterPublish.body.items[0].certificationReadiness, "PUBLISHED");
  assert.equal(afterPublish.body.items[0].certificationStatus, "CERTIFIED");

  const certification = await http(server, "GET", `/v1/tournaments/${encodeURIComponent(created.body.id)}/certification`);
  assert.equal(certification.body.readinessStatus, "PUBLISHED");
  assert.equal(certification.body.status, "CERTIFIED");
  server.close();
});

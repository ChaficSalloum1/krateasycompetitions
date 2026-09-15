import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";
import { createCompilerServer } from "../src/server.js";

async function get(server: ReturnType<typeof createCompilerServer>, url: string): Promise<{
  readonly status: number; readonly body: string;
}> {
  const request = Readable.from([]) as never;
  Object.assign(request, { method: "GET", url, headers: {} });
  return new Promise((resolve) => {
    const result = { status: 0, body: "" };
    server.emit("request", request, {
      writeHead: (status: number) => { result.status = status; },
      end: (body = "") => { result.body = String(body); resolve(result); },
    } as never);
  });
}

test("the default web portfolio lists only authoritative journey records and isolates the demo", async () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T12:00:00.000Z" });
  const draft = journey.create({ mode: "describe", text: "A private organiser draft" });
  const server = createCompilerServer({ competitionJourney: journey });

  const portfolio = await get(server, "/");
  assert.equal(portfolio.status, 200);
  assert.match(portfolio.body, /Authoritative competition portfolio/);
  assert.match(portfolio.body, new RegExp(draft.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(portfolio.body, /platform-demo|Play &amp; Konnect|Sunday Crew|xG Leagues/);
  assert.match(portfolio.body, /href="\/create"/);

  const demo = await get(server, "/demo");
  assert.equal(demo.status, 200);
  assert.match(demo.body, /reference/i);
});

test("production fails closed instead of serving reference UI or compiler demo truth", async () => {
  const server = createCompilerServer({ production: true, authorize: async () => true });
  const root = await get(server, "/");
  assert.equal(root.status, 503);
  assert.deepEqual(JSON.parse(root.body), { apiVersion: "1.0", error: "pilot_web_projection_not_configured" });
  assert.equal((await get(server, "/demo")).status, 404);
  assert.equal((await get(server, "/lab")).status, 404);
  assert.equal((await get(server, "/api/workspace")).status, 404);
  assert.equal((await get(server, "/api/demo")).status, 404);
});

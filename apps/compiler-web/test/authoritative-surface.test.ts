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
  assert.match(portfolio.body, /Organiser Studio/);
  assert.match(portfolio.body, new RegExp(draft.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(portfolio.body, /<summary>Technical identity<\/summary>/);
  assert.doesNotMatch(portfolio.body, /platform-demo|Play &amp; Konnect|Sunday Crew|xG Leagues/);
  assert.match(portfolio.body, /href="\/create"/);

  const studio = await get(server, `/competitions/${encodeURIComponent(draft.id)}`);
  assert.equal(studio.status, 200);
  for (const expected of ["Organiser Studio", "Competition Design", "Run Assurance", "Publish Review"])
    assert.match(studio.body, new RegExp(expected));
  assert.doesNotMatch(studio.body, /platform-demo|Play &amp; Konnect/);

  const receipt = await get(server, `/competitions/${encodeURIComponent(draft.id)}/receipt`);
  assert.equal(receipt.status, 200);
  assert.match(receipt.body, /Close &amp; Integrity Receipt/);
  assert.match(receipt.body, /immutable closure/);
  assert.match(receipt.body, /Skip to Close Receipt/);

  const runControl = await get(server, `/attention?competition=${encodeURIComponent(draft.id)}&revision=1`);
  assert.equal(runControl.status, 200);
  for (const expected of ["Run Control", "data-context-action", "Technical evidence", "Close Receipt"])
    assert.match(runControl.body, new RegExp(expected));

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

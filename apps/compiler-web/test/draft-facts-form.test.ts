import assert from "node:assert/strict";
import test from "node:test";
import { renderDraftFactsForm } from "../src/organiser-studio-view.js";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const base = { participantCount: 12, resourceCount: 3, poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3,
  matchDurationMinutes: 20, minimumRestMinutes: 10 };

test("the facts form shows times as wall-clock time in the event's own timezone, summer and winter", () => {
  const summer = renderDraftFactsForm({ ...base, timezone: "Europe/London", startsAt: "2026-06-06T08:00:00.000Z", endsAt: "2026-06-06T17:30:00.000Z" }, escape);
  assert.match(summer, /id="fact-startsAt"[^>]*value="2026-06-06T09:00"/);
  assert.match(summer, /id="fact-endsAt"[^>]*value="2026-06-06T18:30"/);
  const winter = renderDraftFactsForm({ ...base, timezone: "Europe/London", startsAt: "2026-12-05T09:00:00.000Z" }, escape);
  assert.match(winter, /id="fact-startsAt"[^>]*value="2026-12-05T09:00"/);
  const sydney = renderDraftFactsForm({ ...base, timezone: "Australia/Sydney", startsAt: "2026-12-05T22:00:00.000Z" }, escape);
  assert.match(sydney, /id="fact-startsAt"[^>]*value="2026-12-06T09:00"/, "the date follows the event, not the server");
  assert.match(renderDraftFactsForm({ ...base, timezone: "Not/AZone", startsAt: "2026-12-05T09:00:00.000Z" }, escape),
    /id="fact-startsAt"[^>]*value=""/, "an unknown timezone shows no time rather than a wrong one");
});

test("the facts form escapes names, asks for unchosen rules and shows pool fields only for pools", () => {
  const html = renderDraftFactsForm({ ...base, name: `Harbour "Open" <b>`, format: "round_robin", scoringPolicy: null }, escape);
  assert.ok(html.includes("Harbour &#34;Open&#34; &#60;b&#62;") && !html.includes("<b>"));
  assert.match(html, /<select id="fact-scoringPolicy" name="scoringPolicy"><option value="" selected>Choose…<\/option>/);
  assert.match(html, /<div class="pool-facts" hidden>/);
  assert.doesNotMatch(renderDraftFactsForm({ ...base, format: "pools_to_knockout" }, escape), /pool-facts" hidden/);
  assert.match(renderDraftFactsForm({ ...base, format: "swiss" }, escape), /<option value="swiss" selected>swiss<\/option>/,
    "a format the form does not offer is kept, not silently replaced");
});

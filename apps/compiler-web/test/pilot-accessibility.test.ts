import assert from "node:assert/strict";
import test from "node:test";
import { participantOperationsHtml, venueDisplayHtml } from "../src/attention-views.js";
import { competitionJourneyHtml } from "../src/competition-journey.js";
import { playerHtml } from "../src/player-view.js";
import { participantRecoveryHtml } from "../src/participant-recovery-view.js";

const coreSurfaces = [
  ["participant next", playerHtml],
  ["participant recovery", participantRecoveryHtml],
  ["organiser live", participantOperationsHtml],
  ["venue display", venueDisplayHtml],
  ["published and closed competition", competitionJourneyHtml("competition.accessibility")],
] as const;

test("every connected live-information surface carries the pilot accessibility contract", () => {
  for (const [name, html] of coreSurfaces) {
    for (const expected of [
      '<html lang="en">',
      'name="viewport"',
      'href="#main"',
      'id="main"',
      ':focus-visible',
      'prefers-reduced-motion:reduce',
      'prefers-contrast:more',
      'forced-colors:active',
      '@media print',
      'overflow-wrap:anywhere',
    ]) assert.ok(html.includes(expected), `${name} is missing ${expected}`);
    assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i,
      `${name} must permit browser text zoom`);
  }
});

test("dynamic status and dense information have explicit names and announcements", () => {
  assert.match(playerHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(playerHtml, /<time[^>]*id="next-time"/);
  assert.match(playerHtml, /aria-labelledby="proof-title"/);
  assert.match(participantOperationsHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(participantOperationsHtml, /aria-labelledby="participants-title"/);
  assert.match(venueDisplayHtml, /aria-labelledby="matches-title"/);
  assert.match(venueDisplayHtml, /aria-live="off"/);
  assert.match(competitionJourneyHtml("competition.accessibility"), /<caption>Published schedule<\/caption>/);
  assert.match(competitionJourneyHtml("competition.accessibility"), /<th scope="col">Contest<\/th>/);
});

function channel(value: number): number {
  const component = value / 255;
  return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  return 0.2126 * channel(Number.parseInt(value.slice(0, 2), 16))
    + 0.7152 * channel(Number.parseInt(value.slice(2, 4), 16))
    + 0.0722 * channel(Number.parseInt(value.slice(4, 6), 16));
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("pilot surface colour pairs meet WCAG AA normal-text contrast", () => {
  const pairs = [
    ["#17201d", "#f3f2ed"], ["#65706b", "#f3f2ed"], ["#087b59", "#fffefb"],
    ["#8a2b1f", "#fff0ed"], ["#73d2b2", "#17201d"], ["#c9d6d0", "#17201d"],
    ["#f4f5f2", "#101916"], ["#aab3af", "#101916"], ["#63d5aa", "#17241f"],
    ["#17201d", "#e3f3ed"],
  ] as const;
  for (const [foreground, background] of pairs) assert.ok(contrast(foreground, background) >= 4.5,
    `${foreground} on ${background} must be at least 4.5:1`);
});

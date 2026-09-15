import assert from "node:assert/strict";
import test from "node:test";
import { participantOperationsHtml, venueDisplayHtml } from "../src/attention-views.js";
import { competitionJourneyHtml } from "../src/competition-journey.js";
import { playerHtml } from "../src/player-view.js";
import { participantRecoveryHtml } from "../src/participant-recovery-view.js";
import { renderCompetitionGuardPreflight } from "../src/guard-preflight-view.js";

const preflightHtml = renderCompetitionGuardPreflight({ competitionId: "competition.accessibility",
  competitionName: "Accessible competition", preflight: {
    outcome: "READY", guardReportHash: "a".repeat(64), projectionHash: "b".repeat(64),
    simple: { headline: "Passed.", action: "Approve separately.", requiredAcknowledgementCodes: [] },
    detailed: { assurance: { integrityGrade: "CERTIFIED", operationalQuality: "CLEAR",
      operationalFindingCodes: [] }, findings: [], sections: [
      "DEFINITION", "SCHEDULE", "ACCOUNTING", "DEPENDENCIES",
    ].map((id) => ({ id, status: "PASSED", findingCodes: [], evidenceHash: "c".repeat(64) })),
    accounting: { contestLedger: [{ divisionId: "open", stageId: "groups", poolId: "A", round: "1",
      requiredContestIds: ["match.1"], scheduledContestIds: ["match.1"], contestMinutes: 25,
      turnaroundMinutes: 5 }], reconciled: true } },
    technical: { guardVersion: "1.2.0", certificationHash: "d".repeat(64), reportHash: "a".repeat(64), binding: {} },
  } as never });

const coreSurfaces = [
  ["participant next", playerHtml],
  ["participant recovery", participantRecoveryHtml],
  ["organiser live", participantOperationsHtml],
  ["venue display", venueDisplayHtml],
  ["published and closed competition", competitionJourneyHtml("competition.accessibility")],
  ["Guard pre-flight", preflightHtml],
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
  assert.match(preflightHtml, /<caption>Bottom-up contest and minute ledger<\/caption>/);
  assert.match(preflightHtml, /<summary>Technical evidence<\/summary>/);
});

test("the closed-edition control is accessible and submits only authoritative closure identity plus new facts", () => {
  const html = competitionJourneyHtml("competition.accessibility");
  assert.match(html, /id="duplicate-form"/);
  assert.match(html, /for="duplicate-name"/);
  assert.match(html, /for="duplicate-date"/);
  assert.match(html, /id="duplicate-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /v\.closure\?[^;]+duplicate-form/);
  assert.match(html, /JSON\.stringify\(\{expectedClosureHash:v\.closure\.closureHash,name,eventDate\}\)/);
  assert.doesNotMatch(html, /JSON\.stringify\(\{[^}]*guardInput/);
});

test("the draft roster control is accessible, reversible and submits source data only", () => {
  const html = competitionJourneyHtml("competition.accessibility");
  for (const expected of ['id="source-import"', 'aria-labelledby="source-title"', 'for="source-csv"',
    'for="source-xlsx"', 'id="source-status"', 'role="status"', 'Remove last source'])
    assert.ok(html.includes(expected), `draft roster control is missing ${expected}`);
  assert.match(html, /JSON\.stringify\(\{expectedDraftVersion:view\.draftVersion,source\}\)/);
  assert.match(html, /JSON\.stringify\(\{expectedDraftVersion:view\.draftVersion,sourceId:documents\.at\(-1\)\.id\}\)/);
  assert.ok(html.includes("v.workbench.missingDecisions.map"));
  assert.doesNotMatch(html, /JSON\.stringify\(\{[^}]*guardInput/);
});

test("the organiser lifecycle control sends only authoritative revision commands", () => {
  const html = competitionJourneyHtml("competition.accessibility");
  for (const expected of ['id="lifecycle"', 'aria-labelledby="lifecycle-title"',
    'id="lifecycle-status"', 'Compile and run Guard', 'Approve and publish exact revision',
    'Activate live play', 'Open live control room', 'Open venue display'])
    assert.ok(html.includes(expected), `organiser lifecycle control is missing ${expected}`);
  assert.ok(html.includes("expectedDraftVersion:view.draftVersion"));
  assert.ok(html.includes("expectedRevision:view.revision,acknowledgedFindingCodes"));
  assert.ok(html.includes("expectedRevision:view.revision"));
  assert.doesNotMatch(html, /payload[^;]*(?:spec|graph|schedule|simulation|guardInput|guardReport)/i);
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  NICHE_SPORT_CATALOG_ASSURANCE,
  NICHE_SPORT_PACKS,
  NICHE_SPORT_PROFILES,
  createNicheSportRegistry,
} from "../src/niche-sport-catalog.js";

const lookup = (policyId: string, entrants: readonly string[], result: unknown) => createNicheSportRegistry().evaluate({
  packId: `illustrative-${policyId}`, jurisdiction: "EXAMPLE/GLOBAL", at: "2026-06-01T00:00:00.000Z",
  contestId: `${policyId}.fixture`, entrants, result,
});

test("publishes explicit illustrative profiles for pickleball, badminton, squash, and golf", () => {
  assert.deepEqual(NICHE_SPORT_PROFILES.map(({ sport }) => sport), ["PICKLEBALL", "BADMINTON", "SQUASH", "GOLF"]);
  assert.equal(NICHE_SPORT_PACKS.length, 6);
  assert.match(NICHE_SPORT_CATALOG_ASSURANCE, /governing-body approval.*remain external/i);
  assert.ok(NICHE_SPORT_PROFILES.every(({ boundaries, references }) => boundaries.length > 0 && references.every((url) => url.startsWith("https://"))));
  assert.ok(NICHE_SPORT_PACKS.every(({ content }) => content.assurance === "ILLUSTRATIVE_CONFORMANCE_ONLY"));
});

test("certifies pickleball and squash win-by-two series and rejects a one-point game", () => {
  const pickleball = lookup("pickleball-best-of-three-11-win-by-two", ["pair-a", "pair-b"], {
    shape: "BEST_OF_UNITS", units: [[11, 5], [12, 10]],
  });
  assert.equal(pickleball.status, "CERTIFIED");
  assert.equal(pickleball.semanticResult?.outcomePorts.winnerId, "pair-a");
  const squash = lookup("squash-best-of-five-11-win-by-two", ["player-a", "player-b"], {
    shape: "BEST_OF_UNITS", units: [[11, 8], [9, 11], [13, 11], [11, 4]],
  });
  assert.equal(squash.status, "CERTIFIED");
  assert.equal(lookup("squash-best-of-five-11-win-by-two", ["player-a", "player-b"], {
    shape: "BEST_OF_UNITS", units: [[11, 10], [11, 5], [11, 7]],
  }).status, "REJECTED");
});

test("models badminton deuce and the deciding point at 29-all without weakening ordinary margins", () => {
  const valid = lookup("badminton-best-of-three-21-cap-30", ["side-a", "side-b"], {
    shape: "BEST_OF_UNITS", units: [[22, 20], [30, 29]],
  });
  assert.equal(valid.status, "CERTIFIED");
  assert.equal(valid.semanticResult?.outcomePorts.winnerId, "side-a");
  for (const units of [[[21, 20], [21, 10]], [[31, 29], [21, 10]], [[29, 28], [21, 10]]]) {
    assert.equal(lookup("badminton-best-of-three-21-cap-30", ["side-a", "side-b"], { shape: "BEST_OF_UNITS", units }).status, "REJECTED");
  }
});

test("certifies golf stroke, Stableford, and match-play result shapes with explicit tie behavior", () => {
  const holesA = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  const holesB = holesA.map((score, index) => index === 17 ? score + 1 : score);
  const stroke = lookup("golf-18-hole-stroke-play", ["golfer-b", "golfer-a"], {
    shape: "PERFORMANCE_ATTEMPTS", metricId: "strokes-per-hole", performances: [
      { competitorId: "golfer-b", status: "VALID", attempts: holesB },
      { competitorId: "golfer-a", status: "VALID", attempts: holesA },
    ],
  });
  assert.equal(stroke.status, "CERTIFIED");
  assert.equal(stroke.semanticResult?.placements[0]?.competitorId, "golfer-a");
  const stableford = lookup("golf-18-hole-stableford", ["golfer-a", "golfer-b"], {
    shape: "PERFORMANCE_ATTEMPTS", metricId: "stableford-points-per-hole", performances: [
      { competitorId: "golfer-a", status: "VALID", attempts: Array(18).fill(2) },
      { competitorId: "golfer-b", status: "VALID", attempts: [...Array(17).fill(2), 3] },
    ],
  });
  assert.equal(stableford.semanticResult?.placements[0]?.competitorId, "golfer-b");
  const matchPlay = lookup("golf-match-play-holes", ["golfer-a", "golfer-b"], { shape: "TOTAL_SCORE", score: [5, 4] });
  assert.equal(matchPlay.semanticResult?.outcomePorts.winnerId, "golfer-a");
  assert.equal(lookup("golf-18-hole-stroke-play", ["golfer-a", "golfer-b"], {
    shape: "PERFORMANCE_ATTEMPTS", metricId: "strokes-per-hole", performances: [
      { competitorId: "golfer-a", status: "VALID", attempts: holesA },
      { competitorId: "golfer-b", status: "VALID", attempts: holesA },
    ],
  }).status, "REJECTED");
});

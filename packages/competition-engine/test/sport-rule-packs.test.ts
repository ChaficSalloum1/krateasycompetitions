import assert from "node:assert/strict";
import test from "node:test";
import {
  ILLUSTRATIVE_RULE_PACK_DISCLAIMER,
  SPORT_RULE_PACK_SCALE_ENVELOPE,
  createSportRulePackRegistry,
  sealSportRulePack,
  type SportRulePackContent,
} from "../src/sport-rule-packs.js";
import type { SportPolicy } from "../src/sport-semantics.js";

const footballPolicy = {
  id: "football-points", version: "1.0.0" as const, adapter: "HEAD_TO_HEAD" as const, resultShape: "TOTAL_SCORE" as const,
  valueRule: { kind: "NON_NEGATIVE_INTEGER" as const }, draws: "ALLOWED" as const,
  standingsPoints: { win: 3, draw: 1, loss: 0 }, walkover: "OPPONENT_WINS" as const,
};

function content(overrides: Partial<SportRulePackContent> = {}): SportRulePackContent {
  return {
    id: "example-football", version: "1.0.0", title: "Illustrative football rules",
    owner: { id: "example-owner", name: "TournamentOS Example Owner" },
    authority: { id: "example-authority", name: "TournamentOS Example Authority", kind: "ORGANIZER" },
    jurisdiction: "EXAMPLE/LOCAL", effectiveFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
    assurance: "ILLUSTRATIVE_CONFORMANCE_ONLY",
    semanticReference: { policyId: footballPolicy.id, policyVersion: footballPolicy.version, adapter: footballPolicy.adapter },
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" },
    ...overrides,
  };
}

test("resolves an approved hash-bound rule pack and evaluates only its referenced semantics", () => {
  const pack = sealSportRulePack(content(), {
    decision: "APPROVED", authorityId: "example-authority", approverId: "organizer-7",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: "record:approval-7",
  });
  const registry = createSportRulePackRegistry({ packs: [pack], policies: [footballPolicy],
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  const result = registry.evaluate({ packId: pack.content.id, jurisdiction: "EXAMPLE/LOCAL", at: "2026-06-01T00:00:00.000Z",
    contestId: "match-1", entrants: ["home", "away"], result: { shape: "TOTAL_SCORE", score: [2, 1] } });

  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.pack?.proofHash, pack.proofHash);
  assert.equal(result.semanticResult?.outcomePorts.winnerId, "home");
  assert.match(result.governanceProofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(pack));
  assert.ok(Object.isFrozen(pack.approval));
  assert.match(pack.contentHash, /^[a-f0-9]{64}$/);
  assert.match(pack.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(registry.evaluate({ packId: pack.content.id, jurisdiction: "EXAMPLE/LOCAL", at: "2026-06-01T00:00:00.000Z",
    contestId: "match-1", entrants: ["home", "away"], result: { shape: "TOTAL_SCORE", score: [2, 1] } }).proofHash, result.proofHash);
  assert.notEqual(registry.evaluate({ packId: pack.content.id, jurisdiction: "EXAMPLE/LOCAL", at: "2026-06-02T00:00:00.000Z",
    contestId: "match-1", entrants: ["home", "away"], result: { shape: "TOTAL_SCORE", score: [2, 1] } }).proofHash, result.proofHash);
});

test("fails closed for unknown, expired, unapproved, tampered, incompatible, or unauthorized packs", () => {
  const approval = { decision: "APPROVED" as const, authorityId: "example-authority", approverId: "reviewer-1",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: "record:approval-1" };
  const approved = sealSportRulePack(content(), approval);
  const tampered = structuredClone(approved);
  (tampered.content as { title: string }).title = "Changed after approval";
  const pending = sealSportRulePack(content({ id: "pending" }), { ...approval, decision: "PENDING" });
  const unauthorized = sealSportRulePack(content({ id: "unauthorized" }), { ...approval, authorityId: "someone-else" });
  const incompatible = sealSportRulePack(content({ id: "incompatible",
    compatibility: { sportSemanticsApiVersion: "2.0.0", engineVersion: "1.0.0" } }), approval);
  const missingPolicy = sealSportRulePack(content({ id: "missing-policy",
    semanticReference: { policyId: "not-registered", policyVersion: "1.0.0", adapter: "HEAD_TO_HEAD" } }), approval);
  const registry = createSportRulePackRegistry({ packs: [tampered, pending, unauthorized, incompatible, missingPolicy],
    policies: [footballPolicy], compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  const lookup = (packId: string, at = "2026-06-01T00:00:00.000Z") =>
    registry.resolve({ packId, jurisdiction: "EXAMPLE/LOCAL", at }).findings[0]?.code;

  assert.equal(lookup("unknown"), "UNKNOWN_RULE_PACK");
  assert.equal(lookup("example-football"), "TAMPERED_RULE_PACK");
  assert.equal(lookup("pending"), "UNAPPROVED_RULE_PACK");
  assert.equal(lookup("unauthorized"), "APPROVAL_AUTHORITY_MISMATCH");
  assert.equal(lookup("incompatible"), "INCOMPATIBLE_RULE_PACK");
  assert.equal(lookup("missing-policy"), "INCOMPATIBLE_SEMANTIC_REFERENCE");
  const expiredRegistry = createSportRulePackRegistry({ packs: [approved], policies: [footballPolicy],
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  assert.equal(expiredRegistry.resolve({ packId: approved.content.id, jurisdiction: "EXAMPLE/LOCAL",
    at: "2028-01-01T00:00:00.000Z" }).findings[0]?.code, "EXPIRED_RULE_PACK");
  assert.equal(expiredRegistry.resolve({ packId: approved.content.id, jurisdiction: "EXAMPLE/LOCAL",
    at: "2025-12-15T00:00:00.000Z" }).findings[0]?.code, "RULE_PACK_NOT_YET_EFFECTIVE");
  assert.equal(expiredRegistry.resolve({ packId: approved.content.id, jurisdiction: "EXAMPLE/NATIONAL",
    at: "2026-06-01T00:00:00.000Z" }).findings[0]?.code, "JURISDICTION_MISMATCH");
});

test("selects the highest exact semantic version deterministically and rejects duplicate identities", () => {
  const approval = { decision: "APPROVED" as const, authorityId: "example-authority", approverId: "reviewer-1",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: "record:approval-1" };
  const v1 = sealSportRulePack(content({ version: "1.0.0" }), approval);
  const v2 = sealSportRulePack(content({ version: "2.1.0" }), approval);
  const make = (packs: readonly typeof v1[]) => createSportRulePackRegistry({ packs, policies: [footballPolicy],
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  const lookup = { packId: "example-football", jurisdiction: "EXAMPLE/LOCAL", at: "2026-06-01T00:00:00.000Z" };
  const forward = make([v1, v2]).resolve(lookup);
  const reverse = make([v2, v1]).resolve(lookup);
  assert.equal(forward.pack?.content.version, "2.1.0");
  assert.equal(reverse.proofHash, forward.proofHash);
  assert.equal(make([v2, v2]).resolve(lookup).findings[0]?.code, "AMBIGUOUS_RULE_PACK");
});

test("approved illustrative packs govern a structurally diverse cross-sport conformance corpus", () => {
  assert.match(ILLUSTRATIVE_RULE_PACK_DISCLAIMER, /not official federation rules or certification/i);
  const policies = [
    footballPolicy,
    { id: "racket-series", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "BEST_OF_UNITS",
      valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 3, draws: "FORBIDDEN",
      standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS" },
    { id: "chess-score", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "TOTAL_SCORE",
      valueRule: { kind: "ENUM", values: [0, 0.5, 1] }, draws: "ALLOWED",
      standingsPoints: { win: 1, draw: 0.5, loss: 0 }, walkover: "OPPONENT_WINS" },
    { id: "distance", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
      metricId: "metres", direction: "HIGHER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_NUMBER" },
      attempts: { minimum: 1, maximum: 3, aggregation: "BEST" }, tiePolicy: "REJECT", permittedNonResults: ["DNS"] },
    { id: "elapsed", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
      metricId: "milliseconds", direction: "LOWER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_INTEGER" },
      attempts: { minimum: 1, maximum: 1, aggregation: "BEST" }, tiePolicy: "REJECT", permittedNonResults: ["DNF"] },
    { id: "combat-decision", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "OUTCOME",
      valueRule: { kind: "NON_NEGATIVE_INTEGER" }, draws: "FORBIDDEN", decisionScore: "REQUIRED",
      standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "REJECT", permittedOutcomes: ["DECISION", "DISQUALIFICATION", "NO_CONTEST"] },
    { id: "ordered-race", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "ORDERED_FINISH",
      nonResultOrder: ["DNF", "DSQ", "DNS"], permittedNonResults: ["DNS", "DNF", "DSQ"] },
    { id: "judged-team", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
      metricId: "panel-points", direction: "HIGHER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_NUMBER" },
      attempts: { minimum: 5, maximum: 5, aggregation: { kind: "TRIMMED_MEAN", dropHighest: 1, dropLowest: 1 } },
      tiePolicy: "REJECT", permittedNonResults: ["DQ"], participantUnit: { kind: "TEAM", memberCount: 2 } },
  ] as const satisfies readonly SportPolicy[];
  const approval = { decision: "APPROVED" as const, authorityId: "example-authority", approverId: "reviewer-1",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: "record:cross-sport-corpus" };
  const packs = policies.map((policy) => sealSportRulePack(content({ id: `example-${policy.id}`, title: `Illustrative ${policy.id}`,
    semanticReference: { policyId: policy.id, policyVersion: policy.version, adapter: policy.adapter } }), approval));
  const registry = createSportRulePackRegistry({ packs, policies,
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  const cases = [
    { id: "football-points", entrants: ["a", "b"], result: { shape: "TOTAL_SCORE", score: [2, 1] } },
    { id: "racket-series", entrants: ["a", "b"], result: { shape: "BEST_OF_UNITS", units: [[6, 4], [6, 3]] } },
    { id: "chess-score", entrants: ["a", "b"], result: { shape: "TOTAL_SCORE", score: [0.5, 0.5] } },
    { id: "distance", entrants: ["a", "b"], result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "metres", performances: [
      { competitorId: "a", status: "VALID", attempts: [6.1, 6.3] }, { competitorId: "b", status: "VALID", attempts: [6.2] }] } },
    { id: "elapsed", entrants: ["a", "b"], result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "milliseconds", performances: [
      { competitorId: "a", status: "VALID", attempts: [49000] }, { competitorId: "b", status: "DNF" }] } },
    { id: "combat-decision", entrants: ["a", "b"], result: {
      shape: "OUTCOME", outcome: "DECISION", winnerCompetitorId: "a", score: [30, 27] } },
    { id: "ordered-race", entrants: ["a", "b", "c"], result: { shape: "ORDERED_FINISH", finishers: ["b", "a"],
      nonResults: [{ competitorId: "c", status: "DNF" }] } },
    { id: "judged-team", entrants: ["a", "b"], result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "panel-points", performances: [
      { competitorId: "a", memberIds: ["a1", "a2"], status: "VALID", attempts: [8, 9, 9.1, 9.2, 10] },
      { competitorId: "b", memberIds: ["b1", "b2"], status: "VALID", attempts: [8, 8.5, 8.7, 9, 10] }] } },
  ];
  for (const fixture of cases) {
    const result = registry.evaluate({ packId: `example-${fixture.id}`, jurisdiction: "EXAMPLE/LOCAL",
      at: "2026-06-01T00:00:00.000Z", contestId: `${fixture.id}-contest`, entrants: fixture.entrants, result: fixture.result });
    assert.equal(result.status, "CERTIFIED", fixture.id);
    assert.equal(result.pack?.content.assurance, "ILLUSTRATIVE_CONFORMANCE_ONLY");
  }
});

test("publishes and enforces a finite registry scale envelope", () => {
  const approval = { decision: "APPROVED" as const, authorityId: "example-authority", approverId: "reviewer-1",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: "record:scale" };
  const packs = Array.from({ length: SPORT_RULE_PACK_SCALE_ENVELOPE.maximumVersionsPerPack + 1 }, (_, index) =>
    sealSportRulePack(content({ version: `1.0.${index}` }), approval));
  const registry = createSportRulePackRegistry({ packs, policies: [footballPolicy],
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  assert.equal(registry.resolve({ packId: "example-football", jurisdiction: "EXAMPLE/LOCAL",
    at: "2026-06-01T00:00:00.000Z" }).findings[0]?.code, "RULE_PACK_SCALE_EXCEEDED");
  assert.deepEqual(SPORT_RULE_PACK_SCALE_ENVELOPE, { maximumPacks: 10_000, maximumVersionsPerPack: 100 });
});

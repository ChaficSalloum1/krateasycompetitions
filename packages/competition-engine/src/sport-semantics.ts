import { createHash } from "node:crypto";

export const SPORT_SEMANTICS_SCALE_ENVELOPE = Object.freeze({ maximumEntrants: 1_024, maximumUnits: 32, maximumAttempts: 64, maximumMembersPerEntrant: 64 });
export type Finding = Readonly<{ code: string; message: string; competitorIds?: readonly string[] }>;
export type Placement = Readonly<{
  competitorId: string;
  rank: number | null;
  outcome: "WIN" | "LOSS" | "DRAW" | "VALID" | "DNS" | "DNF" | "DQ" | "DSQ" | "NO_CONTEST";
  standingsPoints?: number;
  mark?: number;
}>;

type ValueRule = Readonly<
  | { kind: "NON_NEGATIVE_INTEGER" }
  | { kind: "NON_NEGATIVE_NUMBER" }
  | { kind: "ENUM"; values: readonly number[] }
>;

export type HeadToHeadPolicy = Readonly<{
  id: string;
  version: "1.0.0";
  adapter: "HEAD_TO_HEAD";
  resultShape: "TOTAL_SCORE" | "BEST_OF_UNITS" | "OUTCOME";
  valueRule: ValueRule;
  draws: "ALLOWED" | "FORBIDDEN";
  standingsPoints: Readonly<{ win: number; draw: number; loss: number }>;
  walkover: "OPPONENT_WINS" | "REJECT";
  bestOf?: number;
  unitWinRule?: Readonly<{ minimum: number; decidingMinimum?: number; margin: number; cap?: number }>;
  permittedOutcomes?: readonly ("DECISION" | "DISQUALIFICATION" | "NO_CONTEST")[];
  decisionScore?: "REQUIRED" | "OPTIONAL" | "FORBIDDEN";
}>;

type PerformanceAttemptPolicy = Readonly<{
  id: string;
  version: "1.0.0";
  adapter: "RANKED_PERFORMANCE";
  resultShape: "PERFORMANCE_ATTEMPTS";
  metricId: string;
  direction: "LOWER_IS_BETTER" | "HIGHER_IS_BETTER";
  valueRule: ValueRule;
  attempts: Readonly<{ minimum: number; maximum: number; aggregation: "BEST" | "SUM" |
    Readonly<{ kind: "TRIMMED_MEAN"; dropHighest: number; dropLowest: number }> }>;
  tiePolicy: "REJECT" | "SHARED_RANK" | "EARLIEST_BEST_ATTEMPT";
  permittedNonResults: readonly ("DNS" | "DNF" | "DQ" | "DSQ")[];
  participantUnit?: Readonly<{ kind: "INDIVIDUAL" | "TEAM" | "RELAY"; memberCount: number }>;
}>;

type OrderedFinishPolicy = Readonly<{
  id: string;
  version: "1.0.0";
  adapter: "RANKED_PERFORMANCE";
  resultShape: "ORDERED_FINISH";
  nonResultOrder: readonly ("DNS" | "DNF" | "DQ" | "DSQ")[];
  permittedNonResults: readonly ("DNS" | "DNF" | "DQ" | "DSQ")[];
  participantUnit?: Readonly<{ kind: "INDIVIDUAL" | "TEAM" | "RELAY"; memberCount: number }>;
}>;

export type RankedPerformancePolicy = PerformanceAttemptPolicy | OrderedFinishPolicy;

export type SportPolicy = HeadToHeadPolicy | RankedPerformancePolicy;

export type EvaluationRequest = Readonly<{
  policyId: string;
  contestId: string;
  entrants: readonly string[];
  result: unknown;
}>;

export type EvaluationResult = Readonly<{
  status: "CERTIFIED" | "REJECTED";
  adapter: SportPolicy["adapter"] | "UNRESOLVED";
  policyId: string;
  contestId: string;
  placements: readonly Placement[];
  findings: readonly Finding[];
  proof: Readonly<{ policyHash: string | null; assertions: readonly string[];
    scaleEnvelope: typeof SPORT_SEMANTICS_SCALE_ENVELOPE }>;
  outcomePorts: Readonly<{ winnerId: string | null; loserId: string | null }>;
  proofHash: string;
}>;

/** The deliberately small seam used by all sport-specific configurations. */
export interface SportSemantics {
  evaluate(request: EvaluationRequest): EvaluationResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

type EvaluationBody = Omit<EvaluationResult, "proofHash" | "outcomePorts" | "proof"> & {
  outcomePorts?: EvaluationResult["outcomePorts"];
  proof: Omit<EvaluationResult["proof"], "scaleEnvelope">;
};
function finalize(body: EvaluationBody): EvaluationResult {
  const complete = { ...body, proof: { ...body.proof, scaleEnvelope: SPORT_SEMANTICS_SCALE_ENVELOPE },
    outcomePorts: body.outcomePorts ?? { winnerId: null, loserId: null } };
  return immutable({ ...complete, proofHash: digest(complete) });
}

function rejected(request: EvaluationRequest, adapter: EvaluationResult["adapter"], policyHash: string | null,
  code: string, message: string, competitorIds?: readonly string[]): EvaluationResult {
  const finding: Finding = competitorIds === undefined ? { code, message } : { code, message, competitorIds };
  return finalize({ status: "REJECTED", adapter, policyId: request.policyId, contestId: request.contestId,
    placements: [], findings: [finding], proof: { policyHash, assertions: ["fail-closed"] } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validValue(value: unknown, rule: ValueRule): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  if (rule.kind === "NON_NEGATIVE_INTEGER") return Number.isInteger(value);
  if (rule.kind === "ENUM") return rule.values.includes(value);
  return rule.kind === "NON_NEGATIVE_NUMBER";
}

function validEntrants(request: EvaluationRequest, expectedMinimum: number): Finding | undefined {
  const invalid = request.entrants.filter((id) => typeof id !== "string" || !id.trim());
  const duplicates = request.entrants.filter((id, index) => request.entrants.indexOf(id) !== index);
  if (!request.contestId.trim() || request.entrants.length < expectedMinimum ||
    request.entrants.length > SPORT_SEMANTICS_SCALE_ENVELOPE.maximumEntrants || invalid.length > 0 || duplicates.length > 0) {
    return { code: "INVALID_ENTRANTS", message: "Contest and uniquely identified entrants are required.",
      competitorIds: [...new Set([...invalid, ...duplicates])].sort() };
  }
  return undefined;
}

interface SemanticsAdapter<P extends SportPolicy> {
  readonly kind: P["adapter"];
  evaluate(policy: P, request: EvaluationRequest): EvaluationResult;
}

const headToHeadAdapter: SemanticsAdapter<HeadToHeadPolicy> = {
  kind: "HEAD_TO_HEAD",
  evaluate(policy, request) {
    const policyHash = digest(policy);
    const entrantsFinding = validEntrants(request, 2);
    if (entrantsFinding || request.entrants.length !== 2) {
      return rejected(request, this.kind, policyHash, entrantsFinding?.code ?? "INVALID_ENTRANTS",
        entrantsFinding?.message ?? "Head-to-head contests require exactly two entrants.", entrantsFinding?.competitorIds);
    }
    const [left, right] = request.entrants as unknown as [string, string];
    if (isRecord(request.result) && request.result.shape === "WALKOVER") {
      if (policy.walkover === "REJECT") return rejected(request, this.kind, policyHash, "WALKOVER_FORBIDDEN", "The registered policy does not authorize a walkover outcome.");
      if (typeof request.result.absentCompetitorId !== "string" || !request.entrants.includes(request.result.absentCompetitorId)) {
        return rejected(request, this.kind, policyHash, "INVALID_WALKOVER", "The absent competitor must be one of the two registered entrants.");
      }
      const winner = request.result.absentCompetitorId === left ? right : left;
      return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
        placements: [{ competitorId: winner, rank: 1, outcome: "WIN", standingsPoints: policy.standingsPoints.win },
          { competitorId: request.result.absentCompetitorId, rank: 2, outcome: "LOSS", standingsPoints: policy.standingsPoints.loss }],
        findings: [], proof: { policyHash, assertions: ["registered-policy", "absent-is-entrant", "winner-derived-as-opponent", "scoreless-walkover"] },
        outcomePorts: { winnerId: winner, loserId: request.result.absentCompetitorId } });
    }
    if (!isRecord(request.result) || request.result.shape !== policy.resultShape) {
      return rejected(request, this.kind, policyHash, "RESULT_SHAPE_MISMATCH", "Result does not match the registered head-to-head shape.");
    }
    let leftScore: number; let rightScore: number; let scoreAssertion: string;
    if (policy.resultShape === "OUTCOME") {
      const permitted = policy.permittedOutcomes ?? [];
      const outcome = request.result.outcome;
      if (typeof outcome !== "string" || !permitted.includes(outcome as "DECISION" | "DISQUALIFICATION" | "NO_CONTEST")) {
        return rejected(request, this.kind, policyHash, "UNREGISTERED_OUTCOME", "The submitted outcome is not registered by this policy.");
      }
      if (outcome === "NO_CONTEST") {
        if (request.result.winnerCompetitorId !== undefined || request.result.disqualifiedCompetitorId !== undefined ||
          request.result.score !== undefined) {
          return rejected(request, this.kind, policyHash, "INVALID_OUTCOME", "A no-contest cannot carry winner or disqualification provenance.");
        }
        return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
          placements: [...request.entrants].sort().map((competitorId) => ({ competitorId, rank: null, outcome: "NO_CONTEST" as const })),
          findings: [], proof: { policyHash, assertions: ["registered-policy", "explicit-no-contest", "no-outcome-ports"] } });
      }
      const provenanceField = outcome === "DECISION" ? "winnerCompetitorId" : "disqualifiedCompetitorId";
      const provenanceId = request.result[provenanceField];
      if (typeof provenanceId !== "string" || !request.entrants.includes(provenanceId) ||
        (outcome === "DECISION" && request.result.disqualifiedCompetitorId !== undefined) ||
        (outcome === "DISQUALIFICATION" && (request.result.winnerCompetitorId !== undefined || request.result.score !== undefined))) {
        return rejected(request, this.kind, policyHash, "INVALID_OUTCOME", `${provenanceField} must identify a registered entrant.`);
      }
      const winner = outcome === "DECISION" ? provenanceId : (provenanceId === left ? right : left);
      const loser = winner === left ? right : left;
      if (outcome === "DECISION") {
        const scoreMode = policy.decisionScore ?? "FORBIDDEN";
        const score = request.result.score;
        const hasScore = score !== undefined;
        if ((scoreMode === "REQUIRED" && !hasScore) || (scoreMode === "FORBIDDEN" && hasScore) ||
          (hasScore && (!Array.isArray(score) || score.length !== 2 || !score.every((value) => validValue(value, policy.valueRule)) ||
            score[0] === score[1] || (score[0]! > score[1]! ? left : right) !== winner))) {
          return rejected(request, this.kind, policyHash, "INVALID_DECISION_SCORE",
            "A decision score must follow its registered rule and agree with the declared winner.");
        }
      }
      const placements: Placement[] = [
        { competitorId: winner, rank: 1, outcome: "WIN", standingsPoints: policy.standingsPoints.win },
        { competitorId: loser, rank: 2, outcome: outcome === "DISQUALIFICATION" ? "DQ" : "LOSS", standingsPoints: policy.standingsPoints.loss },
      ];
      return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
        placements, findings: [], proof: { policyHash, assertions: ["registered-policy", `explicit-${outcome.toLowerCase()}`,
          "winner-and-loser-provenance"] }, outcomePorts: { winnerId: winner, loserId: loser } });
    } else if (policy.resultShape === "TOTAL_SCORE") {
      if (!Array.isArray(request.result.score) || request.result.score.length !== 2 ||
        !request.result.score.every((value) => validValue(value, policy.valueRule))) {
        return rejected(request, this.kind, policyHash, "INVALID_SCORE", "Total scores violate the registered value rule.");
      }
      [leftScore, rightScore] = request.result.score as [number, number];
      scoreAssertion = "valid-total-score";
    } else {
      if (!Number.isInteger(policy.bestOf) || policy.bestOf === undefined || policy.bestOf < 1 ||
        policy.bestOf > SPORT_SEMANTICS_SCALE_ENVELOPE.maximumUnits || policy.bestOf % 2 === 0 ||
        !Array.isArray(request.result.units) || request.result.units.length < 1 || request.result.units.length > policy.bestOf) {
        return rejected(request, this.kind, policyHash, "INVALID_SERIES", "Best-of policy and submitted units must form a bounded odd-length series.");
      }
      const required = Math.floor(policy.bestOf / 2) + 1;
      let leftWins = 0; let rightWins = 0; let clinchedAt = -1;
      for (let index = 0; index < request.result.units.length; index += 1) {
        const unit = request.result.units[index];
        if (!Array.isArray(unit) || unit.length !== 2 || !unit.every((value) => validValue(value, policy.valueRule)) || unit[0] === unit[1]) {
          return rejected(request, this.kind, policyHash, "INVALID_UNIT_SCORE", "Every played unit needs two valid, non-tied values.");
        }
        if (policy.unitWinRule) {
          const minimum = index === policy.bestOf - 1 ? (policy.unitWinRule.decidingMinimum ?? policy.unitWinRule.minimum) : policy.unitWinRule.minimum;
          const winnerScore = Math.max(unit[0]!, unit[1]!); const loserScore = Math.min(unit[0]!, unit[1]!);
          const cap = policy.unitWinRule.cap;
          const validCap = cap === undefined || (Number.isInteger(cap) && cap > minimum);
          const wonAtCap = cap !== undefined && winnerScore === cap && loserScore === cap - 1;
          if (!Number.isInteger(minimum) || minimum < 1 || !Number.isInteger(policy.unitWinRule.margin) || policy.unitWinRule.margin < 1 ||
            !validCap || (cap !== undefined && winnerScore > cap) ||
            (!wonAtCap && (winnerScore < minimum || winnerScore - loserScore < policy.unitWinRule.margin))) {
            return rejected(request, this.kind, policyHash, "UNIT_WIN_RULE_VIOLATION", "A unit does not satisfy its registered minimum and winning margin.");
          }
        }
        unit[0]! > unit[1]! ? leftWins += 1 : rightWins += 1;
        if (leftWins === required || rightWins === required) { clinchedAt = index; break; }
      }
      if (clinchedAt < 0) return rejected(request, this.kind, policyHash, "SERIES_INCOMPLETE", "No entrant has won the units required by the registered best-of policy.");
      if (clinchedAt !== request.result.units.length - 1) {
        return rejected(request, this.kind, policyHash, "SERIES_CONTINUED_AFTER_CLINCH", "A completed series cannot contain later units.");
      }
      leftScore = leftWins; rightScore = rightWins; scoreAssertion = `valid-best-of-${policy.bestOf}-series`;
    }
    if (leftScore === rightScore && policy.draws === "FORBIDDEN") {
      return rejected(request, this.kind, policyHash, "DRAW_FORBIDDEN", "The registered policy forbids a drawn result.");
    }
    const draw = leftScore === rightScore;
    const leftWon = leftScore > rightScore;
    const placements: Placement[] = draw
      ? [{ competitorId: left, rank: 1, outcome: "DRAW", standingsPoints: policy.standingsPoints.draw },
        { competitorId: right, rank: 1, outcome: "DRAW", standingsPoints: policy.standingsPoints.draw }]
      : [{ competitorId: leftWon ? left : right, rank: 1, outcome: "WIN", standingsPoints: policy.standingsPoints.win },
        { competitorId: leftWon ? right : left, rank: 2, outcome: "LOSS", standingsPoints: policy.standingsPoints.loss }];
    placements.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.competitorId.localeCompare(b.competitorId));
    return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
      placements, findings: [], proof: { policyHash, assertions: ["registered-policy", "two-distinct-entrants", scoreAssertion, "outcome-derived"] },
      outcomePorts: draw ? { winnerId: null, loserId: null } : { winnerId: leftWon ? left : right, loserId: leftWon ? right : left } });
  },
};

const rankedPerformanceAdapter: SemanticsAdapter<RankedPerformancePolicy> = {
  kind: "RANKED_PERFORMANCE",
  evaluate(policy, request) {
    const policyHash = digest(policy); const entrantsFinding = validEntrants(request, 2);
    if (entrantsFinding) return rejected(request, this.kind, policyHash, entrantsFinding.code, entrantsFinding.message, entrantsFinding.competitorIds);
    if (policy.resultShape === "ORDERED_FINISH") {
      const recognized = ["DNS", "DNF", "DQ", "DSQ"] as const;
      const configured = [...policy.nonResultOrder];
      if (configured.length !== new Set(configured).size || configured.some((status) => !recognized.includes(status)) ||
        policy.permittedNonResults.some((status) => !configured.includes(status))) {
        return rejected(request, this.kind, policyHash, "INVALID_NON_RESULT_POLICY",
          "Ordered finishes require a unique explicit order for every permitted non-result.");
      }
      if (!isRecord(request.result) || request.result.shape !== "ORDERED_FINISH" || !Array.isArray(request.result.finishers) ||
        !Array.isArray(request.result.nonResults)) {
        return rejected(request, this.kind, policyHash, "RESULT_SHAPE_MISMATCH", "Ordered finish result does not match the registered policy.");
      }
      const finishers = request.result.finishers;
      if (finishers.some((id) => typeof id !== "string") || new Set(finishers).size !== finishers.length) {
        return rejected(request, this.kind, policyHash, "INVALID_ORDERED_FINISH", "Finishers must be unique registered competitor ids.");
      }
      const nonResults: Placement[] = [];
      for (const raw of request.result.nonResults) {
        if (!isRecord(raw) || typeof raw.competitorId !== "string" || typeof raw.status !== "string" ||
          !policy.permittedNonResults.includes(raw.status as "DNS" | "DNF" | "DQ" | "DSQ")) {
          return rejected(request, this.kind, policyHash, "UNREGISTERED_NON_RESULT", "Every ordered-finish non-result must be explicitly registered.");
        }
        nonResults.push({ competitorId: raw.competitorId, rank: null,
          outcome: raw.status as "DNS" | "DNF" | "DQ" | "DSQ" });
      }
      const actualIds = [...finishers as string[], ...nonResults.map(({ competitorId }) => competitorId)].sort();
      const expectedIds = [...request.entrants].sort();
      if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
        return rejected(request, this.kind, policyHash, "INCOMPLETE_PERFORMANCE_COVERAGE",
          "Every entrant must occur exactly once as a finisher or explicit non-result.");
      }
      const placements: Placement[] = (finishers as string[]).map((competitorId, index) =>
        ({ competitorId, rank: index + 1, outcome: "VALID" }));
      nonResults.sort((left, right) => configured.indexOf(left.outcome as typeof configured[number]) -
        configured.indexOf(right.outcome as typeof configured[number]) || left.competitorId.localeCompare(right.competitorId));
      placements.push(...nonResults);
      return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
        placements, findings: [], proof: { policyHash, assertions: ["registered-ordered-finish", "complete-entrant-coverage",
          `non-result-order:${configured.join(",")}`, "non-results-preserved"] } });
    }
    if (!Number.isInteger(policy.attempts.minimum) || !Number.isInteger(policy.attempts.maximum) || policy.attempts.minimum < 1 ||
      policy.attempts.maximum < policy.attempts.minimum || policy.attempts.maximum > SPORT_SEMANTICS_SCALE_ENVELOPE.maximumAttempts) {
      return rejected(request, this.kind, policyHash, "INVALID_ATTEMPT_POLICY", "Attempt bounds must be positive ordered integers.");
    }
    const aggregation = policy.attempts.aggregation;
    if (policy.tiePolicy === "EARLIEST_BEST_ATTEMPT" && aggregation !== "BEST") {
      return rejected(request, this.kind, policyHash, "INVALID_TIE_POLICY", "Earliest-best tie resolution is only defined for BEST aggregation.");
    }
    if (typeof aggregation === "object" && (aggregation.kind !== "TRIMMED_MEAN" || !Number.isInteger(aggregation.dropHighest) ||
      !Number.isInteger(aggregation.dropLowest) || aggregation.dropHighest < 0 || aggregation.dropLowest < 0 ||
      aggregation.dropHighest + aggregation.dropLowest >= policy.attempts.minimum)) {
      return rejected(request, this.kind, policyHash, "INVALID_AGGREGATION", "Trimmed means require bounded drops leaving at least one score.");
    }
    if (policy.participantUnit && (!Number.isInteger(policy.participantUnit.memberCount) || policy.participantUnit.memberCount < 1 ||
      policy.participantUnit.memberCount > SPORT_SEMANTICS_SCALE_ENVELOPE.maximumMembersPerEntrant)) {
      return rejected(request, this.kind, policyHash, "INVALID_PARTICIPANT_POLICY", "Participant composition exceeds the scale envelope.");
    }
    if (!isRecord(request.result) || request.result.shape !== policy.resultShape || request.result.metricId !== policy.metricId ||
      !Array.isArray(request.result.performances)) {
      return rejected(request, this.kind, policyHash, "RESULT_SHAPE_MISMATCH", "Performance result shape and metric must match the registered policy.");
    }
    const performances = request.result.performances;
    const submittedIds = performances.map((entry) => isRecord(entry) && typeof entry.competitorId === "string" ? entry.competitorId : "");
    const expectedIds = [...request.entrants].sort(); const actualIds = [...submittedIds].sort();
    if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
      return rejected(request, this.kind, policyHash, "INCOMPLETE_PERFORMANCE_COVERAGE",
        "Every registered entrant needs exactly one performance or non-result.", [...new Set([...expectedIds, ...actualIds])].sort());
    }

    if (policy.participantUnit && policy.participantUnit.kind !== "INDIVIDUAL") {
      const allMembers: string[] = [];
      for (const raw of performances) {
        if (!isRecord(raw) || !Array.isArray(raw.memberIds) || raw.memberIds.length !== policy.participantUnit.memberCount ||
          raw.memberIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(raw.memberIds).size !== raw.memberIds.length) {
          return rejected(request, this.kind, policyHash, "INVALID_PARTICIPANT_COMPOSITION",
            "Every team or relay entrant requires the registered number of unique member ids.");
        }
        allMembers.push(...raw.memberIds as string[]);
      }
      if (new Set(allMembers).size !== allMembers.length) {
        return rejected(request, this.kind, policyHash, "INVALID_PARTICIPANT_COMPOSITION",
          "A member cannot represent multiple entrants in the same contest.");
      }
    }

    type ValidPerformance = { competitorId: string; mark: number; bestAttemptIndex: number };
    const valid: ValidPerformance[] = []; const nonResults: Placement[] = [];
    for (const raw of performances) {
      if (!isRecord(raw) || typeof raw.competitorId !== "string" || typeof raw.status !== "string") {
        return rejected(request, this.kind, policyHash, "INVALID_PERFORMANCE", "Performance entries require registered competitor and status fields.");
      }
      if (raw.status === "VALID") {
        if (!Array.isArray(raw.attempts) || raw.attempts.length < policy.attempts.minimum || raw.attempts.length > policy.attempts.maximum ||
          !raw.attempts.every((attempt) => validValue(attempt, policy.valueRule))) {
          return rejected(request, this.kind, policyHash, "INVALID_ATTEMPTS", "Valid performances must satisfy registered attempt bounds and value rules.", [raw.competitorId]);
        }
        const attempts = raw.attempts as number[];
        let mark: number; let bestAttemptIndex = 0;
        if (aggregation === "BEST") {
          mark = policy.direction === "HIGHER_IS_BETTER" ? Math.max(...attempts) : Math.min(...attempts);
          bestAttemptIndex = attempts.indexOf(mark);
        } else if (aggregation === "SUM") {
          mark = attempts.reduce((sum, attempt) => sum + attempt, 0);
        } else {
          if (aggregation.dropHighest + aggregation.dropLowest >= attempts.length) {
            return rejected(request, this.kind, policyHash, "INVALID_ATTEMPTS",
              "Submitted attempts do not leave a score after registered trimming.", [raw.competitorId]);
          }
          const ordered = [...attempts].sort((left, right) => left - right);
          const retained = ordered.slice(aggregation.dropLowest, ordered.length - aggregation.dropHighest);
          mark = retained.reduce((sum, attempt) => sum + attempt, 0) / retained.length;
        }
        valid.push({ competitorId: raw.competitorId, mark, bestAttemptIndex });
      } else {
        if (!(["DNS", "DNF", "DQ", "DSQ"] as const).includes(raw.status as "DNS" | "DNF" | "DQ" | "DSQ") ||
          !policy.permittedNonResults.includes(raw.status as "DNS" | "DNF" | "DQ" | "DSQ") || raw.attempts !== undefined) {
          return rejected(request, this.kind, policyHash, "UNREGISTERED_NON_RESULT", "Non-result status or attached attempt data is not permitted by policy.", [raw.competitorId]);
        }
        nonResults.push({ competitorId: raw.competitorId, rank: null, outcome: raw.status as "DNS" | "DNF" | "DQ" | "DSQ" });
      }
    }
    const direction = policy.direction === "HIGHER_IS_BETTER" ? -1 : 1;
    valid.sort((left, right) => direction * (left.mark - right.mark) ||
      (policy.tiePolicy === "EARLIEST_BEST_ATTEMPT" ? left.bestAttemptIndex - right.bestAttemptIndex : 0) ||
      left.competitorId.localeCompare(right.competitorId));
    for (let index = 1; index < valid.length; index += 1) {
      const prior = valid[index - 1]!; const current = valid[index]!;
      const remainsTied = prior.mark === current.mark &&
        (policy.tiePolicy !== "EARLIEST_BEST_ATTEMPT" || prior.bestAttemptIndex === current.bestAttemptIndex);
      if (remainsTied && policy.tiePolicy !== "SHARED_RANK") {
        return rejected(request, this.kind, policyHash, "UNRESOLVED_TIE", "Equal performances require an explicit policy that fully resolves or shares the rank.",
          [prior.competitorId, current.competitorId].sort());
      }
    }
    const placements: Placement[] = valid.map((entry, index) => {
      const prior = valid[index - 1];
      const rank = policy.tiePolicy === "SHARED_RANK" && prior?.mark === entry.mark
        ? valid.findIndex(({ mark }) => mark === entry.mark) + 1 : index + 1;
      return { competitorId: entry.competitorId, rank, outcome: "VALID", mark: entry.mark };
    });
    const statusOrder = { DNS: 0, DNF: 1, DQ: 2, DSQ: 3 } as const;
    nonResults.sort((left, right) => statusOrder[left.outcome as keyof typeof statusOrder] - statusOrder[right.outcome as keyof typeof statusOrder] ||
      left.competitorId.localeCompare(right.competitorId));
    placements.push(...nonResults);
    return finalize({ status: "CERTIFIED", adapter: this.kind, policyId: policy.id, contestId: request.contestId,
      placements, findings: [], proof: { policyHash, assertions: ["registered-policy-and-metric", "complete-entrant-coverage",
        `aggregation:${typeof aggregation === "string" ? aggregation : `${aggregation.kind}:${aggregation.dropHighest}:${aggregation.dropLowest}`}`,
        `bounded-attempts:${policy.attempts.minimum}-${policy.attempts.maximum}`, `direction:${policy.direction}`, `tie:${policy.tiePolicy}`,
        `participant-unit:${policy.participantUnit?.kind ?? "INDIVIDUAL"}:${policy.participantUnit?.memberCount ?? 1}`, "non-results-preserved"] } });
  },
};

export function createSportSemantics(policies: readonly SportPolicy[]): SportSemantics {
  const byId = new Map<string, SportPolicy>();
  for (const policy of policies) {
    if (!policy.id.trim() || byId.has(policy.id)) throw new Error("Sport policy ids must be non-empty and unique");
    byId.set(policy.id, structuredClone(policy));
  }
  return immutable({
    evaluate(request: EvaluationRequest): EvaluationResult {
      const policy = byId.get(request.policyId);
      if (!policy) return rejected(request, "UNRESOLVED", null, "UNREGISTERED_POLICY", "No registered sport policy matches this result.");
      if (policy.version !== "1.0.0") return rejected(request, "UNRESOLVED", digest(policy), "UNSUPPORTED_POLICY_VERSION", "No semantics implementation is registered for this policy version.");
      if (policy.adapter === "HEAD_TO_HEAD") return headToHeadAdapter.evaluate(policy, request);
      if (policy.adapter === "RANKED_PERFORMANCE") return rankedPerformanceAdapter.evaluate(policy, request);
      return rejected(request, "UNRESOLVED", digest(policy), "UNREGISTERED_ADAPTER", "No semantics adapter is registered for this scoring policy.");
    },
  });
}

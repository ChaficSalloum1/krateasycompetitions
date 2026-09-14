import { createHash } from "node:crypto";

export type StaticFormat =
  | "SINGLE_ROUND_ROBIN"
  | "DOUBLE_ROUND_ROBIN"
  | "DOUBLE_ELIMINATION"
  | "REPECHAGE_CLASSIFICATION";

export type ResetFinalPolicy = "NEVER" | "IF_NECESSARY";

export type StaticFormatRequest =
  | { readonly id: string; readonly format: "SINGLE_ROUND_ROBIN" | "DOUBLE_ROUND_ROBIN"; readonly entrantCount: number }
  | { readonly id: string; readonly format: "DOUBLE_ELIMINATION"; readonly entrantCount: number; readonly resetFinalPolicy: ResetFinalPolicy }
  | { readonly id: string; readonly format: "REPECHAGE_CLASSIFICATION"; readonly entrantCount: number };

export type ContestOutcome = "WINNER" | "LOSER";
export type ContestSlot =
  | { readonly type: "ENTRANT"; readonly seed: number }
  | { readonly type: "OUTCOME"; readonly contestId: string; readonly outcome: ContestOutcome };

export interface StaticContest {
  readonly id: string;
  readonly bracket: "ROUND_ROBIN" | "WINNERS" | "LOSERS" | "FINALS" | "REPECHAGE" | "CLASSIFICATION";
  readonly round: number;
  readonly sequence: number;
  readonly requirement: "REQUIRED" | "CONDITIONAL";
  readonly label: string;
  readonly inputs: readonly [ContestSlot, ContestSlot];
  readonly condition?: Readonly<{ readonly type: "SOURCE_SLOT_WON"; readonly sourceContestId: string; readonly sourceSlot: 0 | 1 }>;
}

export interface StaticEdge {
  readonly fromContestId: string;
  readonly outcome: ContestOutcome;
  readonly toContestId: string;
  readonly inputIndex: 0 | 1;
}

export type ChampionResolution =
  | { readonly type: "STANDINGS"; readonly contestIds: readonly string[] }
  | { readonly type: "CONTEST_WINNER"; readonly contestId: string }
  | { readonly type: "RESET_AWARE"; readonly firstFinalId: string; readonly resetFinalId: string };

export interface StaticFormatFinding {
  readonly code: string;
  readonly severity: "INFO" | "WARNING";
  readonly message: string;
}

export interface StaticFormatProof {
  readonly valid: boolean;
  readonly entrantCount: number;
  readonly expectedRequiredContestCount: number;
  readonly generatedRequiredContestCount: number;
  readonly generatedConditionalContestCount: number;
  readonly allEntrantsReachable: boolean;
  readonly allInputOutcomesResolved: boolean;
  readonly noLoserFromNonContest: boolean;
  readonly acyclic: boolean;
  readonly proofHash: string;
}

export interface CompiledStaticFormat {
  readonly id: string;
  readonly format: StaticFormat;
  readonly contests: readonly StaticContest[];
  readonly edges: readonly StaticEdge[];
  readonly champion: ChampionResolution;
  readonly findings: readonly StaticFormatFinding[];
  readonly proof: StaticFormatProof;
}

export class StaticFormatCompileError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "StaticFormatCompileError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateCommon(request: StaticFormatRequest): void {
  if (!request.id.trim()) throw new StaticFormatCompileError("SFC001", "Format id is required");
  if (!Number.isInteger(request.entrantCount) || request.entrantCount < 2 || request.entrantCount > 64) {
    throw new StaticFormatCompileError("SFC002", "Entrant count must be an integer from 2 to 64");
  }
}

function roundRobin(id: string, entrantCount: number, legs: 1 | 2): StaticContest[] {
  const rotation: Array<number | null> = Array.from({ length: entrantCount }, (_, index) => index + 1);
  if (rotation.length % 2 === 1) rotation.push(null);
  const roundsPerLeg = rotation.length - 1;
  const contests: StaticContest[] = [];
  let sequence = 1;
  for (let leg = 0; leg < legs; leg += 1) {
    for (let round = 0; round < roundsPerLeg; round += 1) {
      for (let pair = 0; pair < rotation.length / 2; pair += 1) {
        const left = rotation[pair];
        const right = rotation[rotation.length - 1 - pair];
        if (left === null || right === null || left === undefined || right === undefined) continue;
        const reversed = (round + leg) % 2 === 1;
        const first = reversed ? right : left;
        const second = reversed ? left : right;
        const globalRound = leg * roundsPerLeg + round + 1;
        contests.push({
          id: `${id}.RR.R${globalRound}.M${pair + 1}`,
          bracket: "ROUND_ROBIN",
          round: globalRound,
          sequence,
          requirement: "REQUIRED",
          label: `Round ${globalRound}`,
          inputs: [{ type: "ENTRANT", seed: first }, { type: "ENTRANT", seed: second }],
        });
        sequence += 1;
      }
      const fixed = rotation[0]!;
      const tail = rotation.slice(1);
      const moved = tail.pop()!;
      rotation.splice(0, rotation.length, fixed, moved, ...tail);
    }
  }
  return contests;
}

function outcome(contestId: string, result: ContestOutcome): ContestSlot {
  return { type: "OUTCOME", contestId, outcome: result };
}

interface DoubleEliminationResult {
  readonly contests: StaticContest[];
  readonly champion: ChampionResolution;
}

function doubleElimination(id: string, entrantCount: number, resetFinalPolicy: ResetFinalPolicy): DoubleEliminationResult {
  const contests: StaticContest[] = [];
  const winnersRounds: StaticContest[][] = [];
  let sequence = 1;
  let inputs: ContestSlot[] = Array.from({ length: entrantCount }, (_, index) => ({ type: "ENTRANT", seed: index + 1 }));
  let winnersRound = 1;
  while (inputs.length > 1) {
    const round: StaticContest[] = [];
    for (let index = 0; index < inputs.length; index += 2) {
      const contest: StaticContest = {
        id: `${id}.W.R${winnersRound}.M${index / 2 + 1}`,
        bracket: "WINNERS",
        round: winnersRound,
        sequence,
        requirement: "REQUIRED",
        label: `Winners round ${winnersRound}`,
        inputs: [inputs[index]!, inputs[index + 1]!],
      };
      round.push(contest);
      contests.push(contest);
      sequence += 1;
    }
    winnersRounds.push(round);
    inputs = round.map(({ id: contestId }) => outcome(contestId, "WINNER"));
    winnersRound += 1;
  }
  const winnersFinal = winnersRounds.at(-1)![0]!;
  let lowerChampion: ContestSlot = outcome(winnersFinal.id, "LOSER");
  if (entrantCount > 2) {
    const firstWinnersRound = winnersRounds[0]!;
    let losersRound = 1;
    let previous: StaticContest[] = [];
    for (let index = 0; index < firstWinnersRound.length; index += 2) {
      const contest: StaticContest = {
        id: `${id}.L.R${losersRound}.M${index / 2 + 1}`,
        bracket: "LOSERS",
        round: losersRound,
        sequence,
        requirement: "REQUIRED",
        label: `Losers round ${losersRound}`,
        inputs: [outcome(firstWinnersRound[index]!.id, "LOSER"), outcome(firstWinnersRound[index + 1]!.id, "LOSER")],
      };
      previous.push(contest);
      contests.push(contest);
      sequence += 1;
    }
    for (let winnersIndex = 1; winnersIndex < winnersRounds.length; winnersIndex += 1) {
      const incomingLosers = winnersRounds[winnersIndex]!;
      if (previous.length > incomingLosers.length) {
        losersRound += 1;
        const contraction: StaticContest[] = [];
        for (let index = 0; index < previous.length; index += 2) {
          const contest: StaticContest = {
            id: `${id}.L.R${losersRound}.M${index / 2 + 1}`,
            bracket: "LOSERS",
            round: losersRound,
            sequence,
            requirement: "REQUIRED",
            label: `Losers round ${losersRound}`,
            inputs: [outcome(previous[index]!.id, "WINNER"), outcome(previous[index + 1]!.id, "WINNER")],
          };
          contraction.push(contest);
          contests.push(contest);
          sequence += 1;
        }
        previous = contraction;
      }
      losersRound += 1;
      const integration: StaticContest[] = [];
      for (let index = 0; index < incomingLosers.length; index += 1) {
        const contest: StaticContest = {
          id: `${id}.L.R${losersRound}.M${index + 1}`,
          bracket: "LOSERS",
          round: losersRound,
          sequence,
          requirement: "REQUIRED",
          label: `Losers round ${losersRound}`,
          inputs: [outcome(previous[index]!.id, "WINNER"), outcome(incomingLosers[index]!.id, "LOSER")],
        };
        integration.push(contest);
        contests.push(contest);
        sequence += 1;
      }
      previous = integration;
    }
    lowerChampion = outcome(previous[0]!.id, "WINNER");
  }
  const firstFinal: StaticContest = {
    id: `${id}.GF1`,
    bracket: "FINALS",
    round: winnersRounds.length + 1,
    sequence,
    requirement: "REQUIRED",
    label: "Grand final",
    inputs: [outcome(winnersFinal.id, "WINNER"), lowerChampion],
  };
  contests.push(firstFinal);
  if (resetFinalPolicy === "NEVER") {
    return { contests, champion: { type: "CONTEST_WINNER", contestId: firstFinal.id } };
  }
  const resetFinal: StaticContest = {
    id: `${id}.GF2`,
    bracket: "FINALS",
    round: winnersRounds.length + 2,
    sequence: sequence + 1,
    requirement: "CONDITIONAL",
    label: "Grand final reset (if lower-bracket entrant wins grand final)",
    inputs: [outcome(firstFinal.id, "WINNER"), outcome(firstFinal.id, "LOSER")],
    condition: { type: "SOURCE_SLOT_WON", sourceContestId: firstFinal.id, sourceSlot: 1 },
  };
  contests.push(resetFinal);
  return { contests, champion: { type: "RESET_AWARE", firstFinalId: firstFinal.id, resetFinalId: resetFinal.id } };
}

function repechageClassification(id: string, entrantCount: number): DoubleEliminationResult {
  const contests: StaticContest[] = [];
  const mainRounds: StaticContest[][] = [];
  let sequence = 1;
  let inputs: ContestSlot[] = Array.from({ length: entrantCount }, (_, index) => ({ type: "ENTRANT", seed: index + 1 }));
  let roundNumber = 1;
  while (inputs.length > 1) {
    const round: StaticContest[] = [];
    for (let index = 0; index < inputs.length; index += 2) {
      const contest: StaticContest = {
        id: `${id}.W.R${roundNumber}.M${index / 2 + 1}`,
        bracket: "WINNERS",
        round: roundNumber,
        sequence,
        requirement: "REQUIRED",
        label: `Main draw round ${roundNumber}`,
        inputs: [inputs[index]!, inputs[index + 1]!],
      };
      round.push(contest);
      contests.push(contest);
      sequence += 1;
    }
    mainRounds.push(round);
    inputs = round.map(({ id: contestId }) => outcome(contestId, "WINNER"));
    roundNumber += 1;
  }
  const quarterfinals = mainRounds[mainRounds.length - 3]!;
  const semifinals = mainRounds[mainRounds.length - 2]!;
  const final = mainRounds.at(-1)![0]!;
  const repechage: StaticContest[] = [];
  for (let half = 0; half < 2; half += 1) {
    const contest: StaticContest = {
      id: `${id}.REP.M${half + 1}`,
      bracket: "REPECHAGE",
      round: 1,
      sequence,
      requirement: "REQUIRED",
      label: `Repechage path ${half + 1}`,
      inputs: [outcome(quarterfinals[half * 2]!.id, "LOSER"), outcome(quarterfinals[half * 2 + 1]!.id, "LOSER")],
    };
    repechage.push(contest);
    contests.push(contest);
    sequence += 1;
  }
  for (let half = 0; half < 2; half += 1) {
    contests.push({
      id: `${id}.CLASS.M${half + 1}`,
      bracket: "CLASSIFICATION",
      round: 2,
      sequence,
      requirement: "REQUIRED",
      label: `Classification match ${half + 1}`,
      inputs: [outcome(repechage[half]!.id, "WINNER"), outcome(semifinals[half]!.id, "LOSER")],
    });
    sequence += 1;
  }
  return { contests, champion: { type: "CONTEST_WINNER", contestId: final.id } };
}

function deriveEdges(contests: readonly StaticContest[]): StaticEdge[] {
  return contests.flatMap((contest) => contest.inputs.flatMap((slot, inputIndex) => slot.type === "OUTCOME"
    ? [{ fromContestId: slot.contestId, outcome: slot.outcome, toContestId: contest.id, inputIndex: inputIndex as 0 | 1 }]
    : []));
}

function isAcyclic(contests: readonly StaticContest[], edges: readonly StaticEdge[]): boolean {
  const incoming = new Map(contests.map(({ id }) => [id, 0]));
  const outgoing = new Map(contests.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!incoming.has(edge.fromContestId) || !incoming.has(edge.toContestId)) return false;
    incoming.set(edge.toContestId, incoming.get(edge.toContestId)! + 1);
    outgoing.get(edge.fromContestId)!.push(edge.toContestId);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const target of outgoing.get(id)!) {
      const next = incoming.get(target)! - 1;
      incoming.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  return visited === contests.length;
}

function finalize(
  request: StaticFormatRequest,
  contests: StaticContest[],
  champion: ChampionResolution,
  expectedRequiredContestCount: number,
  findings: StaticFormatFinding[],
): CompiledStaticFormat {
  const edges = deriveEdges(contests);
  const contestIds = new Set(contests.map(({ id }) => id));
  const directSeeds = new Set(contests.flatMap(({ inputs }) => inputs.flatMap((slot) => slot.type === "ENTRANT" ? [slot.seed] : [])));
  const allEntrantsReachable = Array.from({ length: request.entrantCount }, (_, index) => index + 1)
    .every((seed) => directSeeds.has(seed));
  const allInputOutcomesResolved = edges.every(({ fromContestId }) => contestIds.has(fromContestId));
  const base = {
    valid: false,
    entrantCount: request.entrantCount,
    expectedRequiredContestCount,
    generatedRequiredContestCount: contests.filter(({ requirement }) => requirement === "REQUIRED").length,
    generatedConditionalContestCount: contests.filter(({ requirement }) => requirement === "CONDITIONAL").length,
    allEntrantsReachable,
    allInputOutcomesResolved,
    noLoserFromNonContest: allInputOutcomesResolved,
    acyclic: isAcyclic(contests, edges),
  };
  const valid = base.generatedRequiredContestCount === expectedRequiredContestCount
    && base.allEntrantsReachable && base.allInputOutcomesResolved && base.acyclic;
  const proofWithoutHash = { ...base, valid };
  const proof = { ...proofWithoutHash, proofHash: digest({ request, contests, edges, champion, findings, proof: proofWithoutHash }) };
  if (!proof.valid) throw new StaticFormatCompileError("SFC900", "Generated format failed its structural proof");
  return deepFreeze({ id: request.id, format: request.format, contests, edges, champion, findings, proof });
}

export function compileStaticFormat(request: StaticFormatRequest): CompiledStaticFormat {
  validateCommon(request);
  if (request.format === "SINGLE_ROUND_ROBIN") {
    const contests = roundRobin(request.id, request.entrantCount, 1);
    return finalize(request, contests, { type: "STANDINGS", contestIds: contests.map(({ id }) => id) },
      request.entrantCount * (request.entrantCount - 1) / 2,
      [{ code: "SFC100", severity: "INFO", message: "Every unordered entrant pairing is scheduled exactly once." }]);
  }
  if (request.format === "DOUBLE_ROUND_ROBIN") {
    const contests = roundRobin(request.id, request.entrantCount, 2);
    return finalize(request, contests, { type: "STANDINGS", contestIds: contests.map(({ id }) => id) },
      request.entrantCount * (request.entrantCount - 1),
      [{ code: "SFC101", severity: "INFO", message: "Every entrant pairing has one fixture in each orientation." }]);
  }
  if (request.format === "DOUBLE_ELIMINATION") {
    if ((request.entrantCount & (request.entrantCount - 1)) !== 0) {
      throw new StaticFormatCompileError("SFC210", "Double elimination requires a power-of-two entrant count; explicit qualification or play-ins must be compiled first");
    }
    if (request.resetFinalPolicy !== "NEVER" && request.resetFinalPolicy !== "IF_NECESSARY") {
      throw new StaticFormatCompileError("SFC211", "Reset-final policy must be NEVER or IF_NECESSARY");
    }
    const result = doubleElimination(request.id, request.entrantCount, request.resetFinalPolicy);
    const findings: StaticFormatFinding[] = [{
      code: "SFC200", severity: "INFO", message: "Every winner-bracket defeat has one explicit lower-bracket or final destination.",
    }];
    if (request.resetFinalPolicy === "IF_NECESSARY") findings.push({
      code: "SFC201", severity: "INFO", message: "The reset final is conditional and is played only after the previously unbeaten finalist receives a first defeat.",
    });
    return finalize(request, result.contests, result.champion, 2 * request.entrantCount - 2, findings);
  }
  if (request.format === "REPECHAGE_CLASSIFICATION") {
    if (request.entrantCount < 8 || (request.entrantCount & (request.entrantCount - 1)) !== 0) {
      throw new StaticFormatCompileError("SFC310", "Quarterfinal repechage requires a power-of-two entrant count from 8 to 64; explicit qualification or play-ins must be compiled first");
    }
    const result = repechageClassification(request.id, request.entrantCount);
    return finalize(request, result.contests, result.champion, request.entrantCount + 3, [{
      code: "SFC300", severity: "INFO", message: "Quarterfinal losers enter two repechage paths whose winners face the corresponding semifinal losers in classification contests.",
    }]);
  }
  throw new StaticFormatCompileError("SFC003", `Format ${request.format} is not implemented`);
}

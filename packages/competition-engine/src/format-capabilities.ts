import type { StagePrimitive } from "@tournament-os/tournament-schema";
import {
  createCapabilityLedger,
  type CapabilityLedger,
  type CapabilityModuleEvidence,
} from "./capability-ledger.js";

const DECLARED_STAGE_PRIMITIVES: readonly StagePrimitive[] = [
  "single_round_robin", "double_round_robin", "groups", "single_elimination",
  "double_elimination", "consolation", "placement", "swiss", "ladder",
  "league_table", "qualifying_heat", "time_trial", "ranking_stage", "play_in",
  "repechage", "custom_graph",
];

const evidence = (
  capabilityId: StagePrimitive,
  moduleId: string,
  endToEnd: boolean,
  scaleEnvelope: string,
  checks: readonly string[],
): CapabilityModuleEvidence => ({
  capabilityId, moduleId, version: "1.0.0", executable: true, deterministic: true,
  independentlyVerified: true, endToEnd, evidence: checks, scaleEnvelope,
});

const modules: readonly CapabilityModuleEvidence[] = [
  evidence("groups", "competition-graph/round-robin", true, "Configured pools with 2-64 entrants per stage; 1 or 2 legs.", [
    "independent contest-cardinality check", "deterministic scenario replay", "schedule shadow validation",
  ]),
  evidence("single_round_robin", "competition-graph/round-robin", true, "2-64 entrants; one complete leg.", [
    "all unordered pairs exactly once", "bounded small-field replay suite",
  ]),
  evidence("double_round_robin", "competition-graph/round-robin", true, "2-64 entrants; two oriented legs.", [
    "both orientations for every pair", "bounded small-field replay suite",
  ]),
  evidence("league_table", "competition-graph/round-robin", true, "Configured pool league with registered standings metrics.", [
    "standings metric registry", "fail-closed tie policy", "scenario certification",
  ]),
  evidence("single_elimination", "competition-graph/single-elimination", true, "2-64 entrants; explicit byes; binary head-to-head contests.", [
    "n-1 contest cardinality", "seed topology proof", "dependency-complete simulation",
  ]),
  evidence("consolation", "competition-graph/consolation-knockout", true, "2-64 qualified entrants; single-elimination consolation topology.", [
    "qualification cardinality", "n-1 contest cardinality", "scenario certification",
  ]),
  evidence("double_elimination", "native-static-format/double-elimination", true, "Power-of-two fields from 2-64; explicit NEVER or IF_NECESSARY reset policy.", [
    "winner/loser-path proof", "conditional grand-final reset semantics", "primary graph/schedule/simulation/certification scenario",
  ]),
  evidence("repechage", "native-static-format/repechage-classification", true, "Power-of-two fields from 8-64; QUARTERFINAL_LOSERS_TO_SEMIFINAL_LOSERS model.", [
    "two explicit repechage paths", "no bye-derived losers", "primary graph/schedule/simulation/certification scenario",
  ]),
  evidence("swiss", "primary-dynamic-stage/swiss", true, "Explicit multi-round fields; exact pairing per round up to the pinned search-node limit; transactional SQLite operations.", [
    "TournamentSpec configuration type-check", "complete active-field coverage", "rematch and bye invariants", "multi-round transactional replay", "production schedule validation", "final ranking certification",
  ]),
  evidence("ladder", "primary-dynamic-stage/ladder", true, "Finite audited challenge sequences over a uniquely identified ladder; transactional SQLite operations.", [
    "TournamentSpec configuration type-check", "hash-chained audit events", "challenge-distance invariant", "production-scheduled challenge reference", "transactional replay and certification",
  ]),
  evidence("qualifying_heat", "primary-dynamic-stage/qualifying-heats", true, "Entrants fitting explicit heat × lane capacity; finite recorded time results; transactional SQLite operations.", [
    "TournamentSpec configuration type-check", "serpentine distribution", "unique lane assignment", "fail-closed seed ties", "production schedule validation", "result replay and qualification certification",
  ]),
  evidence("time_trial", "primary-dynamic-stage/time-trial", true, "Finite registered marks plus explicit DNS/DNF/DQ handling; transactional SQLite operations.", [
    "TournamentSpec configuration type-check", "status-aware ranking", "explicit tie policy", "production schedule validation", "transactional replay and qualification certification",
  ]),
  evidence("ranking_stage", "primary-dynamic-stage/ranking-qualification", true, "One complete finite score set with explicit score direction and cutoff-tie policy; transactional SQLite operations.", [
    "TournamentSpec configuration type-check", "score direction preservation", "qualification cardinality", "cutoff tie closure", "production schedule validation", "transactional replay and certification",
  ]),
  evidence("play_in", "native-static-format/play-in", true, "Single-round reduction compiler bounded to 4,096 entrants; primary certified fixture 10 entrants into an 8-place draw.", [
    "entrant coverage", "direct/qualifier cardinality", "explicit multi-round infeasibility", "primary graph/schedule/simulation/certification scenario",
  ]),
  evidence("placement", "native-static-format/classification", true, "Version 1 explicit classification graph bounded to 4,096 contests; primary certified cross-stage fixture.", [
    "winner/loser place provenance", "outcome reuse guard", "bye-loser rejection", "cross-stage source closure", "primary graph/schedule/simulation/certification scenario",
  ]),
  evidence("custom_graph", "native-static-format/custom-graph", true, "Version 1 definitions structurally bounded to 4,096 entrants and nodes; primary certified fixture at 4 entrants and 3 contests.", [
    "entrant coverage", "port and outcome provenance", "fan-out and acyclicity validation", "stage namespace isolation", "primary graph/schedule/simulation/certification scenario",
  ]),
];

/**
 * Evidence-backed public truth. A schema enum is deliberately insufficient:
 * only modules with executable verification evidence can rise above
 * EXTENSION_REQUIRED, and only the scenario/operations path can be NATIVE.
 */
export function tournamentFormatCapabilities(
  requestedCapabilities: readonly string[] = DECLARED_STAGE_PRIMITIVES,
): Readonly<CapabilityLedger> {
  return createCapabilityLedger({
    declaredCapabilities: DECLARED_STAGE_PRIMITIVES,
    requestedCapabilities,
    modules,
  });
}

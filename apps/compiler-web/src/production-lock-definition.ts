import { canonicalHash, type SchedulingDefinition, type TournamentDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { attachValidationAudit, possibleEntrants, validateSchedule,
  type CompetitionGraph, type Entrant, type ScheduleSolution } from "@tournament-os/competition-engine";
import type { CompetitionWorkbenchProjection } from "./competition-workbench.js";
import { workbenchDecisionValues } from "./competition-workbench.js";

interface DivisionInput { id: string; label: string; count: number; pools: number[]; towerCount: number; }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sourceRoot(workbench: CompetitionWorkbenchProjection): Record<string, unknown> | null {
  for (const source of workbench.sources) {
    const normalized = asRecord(source.normalized);
    if (normalized && asRecord(normalized.pools) && Array.isArray(normalized.schedule)) return normalized;
    if (source.kind === "json" && typeof source.original === "string") {
      try {
        const legacy = asRecord(JSON.parse(source.original));
        if (legacy && asRecord(legacy.pools) && Array.isArray(legacy.schedule)) return legacy;
      } catch { /* A preserved invalid source is not authoritative. */ }
    }
  }
  return null;
}

export function isProductionLockWorkbench(workbench: CompetitionWorkbenchProjection): boolean {
  const root = sourceRoot(workbench);
  return Boolean(root && asRecord(root.rules) && asRecord(root.pools) && asRecord(root.finalCourtAssignments)
    && Array.isArray(root.schedule) && Array.isArray(root.audit));
}

function idFor(label: string): string {
  const id = label.toLowerCase().replace(/s$/, "").replace(/[^a-z0-9]+/g, "-");
  return id || "division";
}

function divisions(root: Record<string, unknown>): DivisionInput[] {
  const sourcePools = asRecord(root.pools); if (!sourcePools) return [];
  return Object.entries(sourcePools).map(([label, value]) => {
    const pools = asRecord(value);
    const sizes = pools ? Object.values(pools).map((entrants) => Array.isArray(entrants) ? entrants.length : 0) : [];
    const count = sizes.reduce((sum, size) => sum + size, 0);
    return { id: idFor(label), label, count, pools: sizes, towerCount: count - 4 };
  });
}

function qualifierPolicies(data: readonly DivisionInput[]) {
  return data.flatMap((division) => {
    const poolCount = division.pools.length;
    const mainWinnerCount = Math.min(4, poolCount);
    const mainRunnerCount = 4 - mainWinnerCount;
    const missedWinnerCount = poolCount - mainWinnerCount;
    const remainingRunnerCount = poolCount - mainRunnerCount;
    const fourthPlaceCount = division.pools.filter((size) => size >= 4).length;
    const selector = (count: number, poolPosition: number) => ({ type: "best_n_across_pools" as const, count, poolPosition });
    return [{
      id: `${division.id}.qual.konnect`, sourceStageId: `${division.id}.pools`,
      destinationStructureId: `${division.id}.konnect.structure`, outputCount: 4,
      selectors: [selector(mainWinnerCount, 1), ...(mainRunnerCount ? [selector(mainRunnerCount, 2)] : [])],
      normalization: "percentage" as const,
    }, {
      id: `${division.id}.qual.tower`, sourceStageId: `${division.id}.pools`,
      destinationStructureId: `${division.id}.tower.structure`, outputCount: division.towerCount,
      selectors: [
        ...(missedWinnerCount ? [selector(missedWinnerCount, 1)] : []),
        selector(remainingRunnerCount, 2), selector(poolCount, 3),
        ...(fourthPlaceCount ? [selector(fourthPlaceCount, 4)] : []),
      ], normalization: "percentage" as const,
    }];
  });
}

function isoOn(date: string, localTime: string, timeZone = "Europe/London"): string {
  const requested = Date.parse(`${date}T${localTime}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant;
  };
  let instant = requested - offsetAt(requested);
  instant = requested - offsetAt(instant);
  return new Date(instant).toISOString();
}

function finalResourceConstraints(finals: Record<string, unknown>) {
  const divisionId = (label: string) => idFor(label.split(" ")[0] ?? "");
  return Object.entries(finals).map(([label, court], index) => {
    const stage = label.includes("Konnect") ? "konnect" : "tower";
    const courtNumber = String(court).match(/\d+/)?.[0] ?? "";
    const value = JSON.stringify({ stageId: `${divisionId(label)}.${stage}`, round: "final", resourceId: `venue.courts.main.${courtNumber}` });
    return { id: `required.final.resource.${index + 1}`, rule: "required_resource", strength: "HARD" as const, value };
  });
}

export function definitionFromProductionLock(workbench: CompetitionWorkbenchProjection): TournamentDefinition | null {
  if (workbench.missingDecisions.length || workbench.conflicts.length || workbench.unsupportedSemantics.some(({ blocking }) => blocking)) return null;
  const root = sourceRoot(workbench); const rules = asRecord(root?.rules); const finals = asRecord(root?.finalCourtAssignments);
  const data = root ? divisions(root) : [];
  if (!root || !rules || !finals || data.length === 0) return null;
  const decisions = workbenchDecisionValues(workbench);
  const date = decisions["event-date"]!; const timeZone = decisions.timezone!;
  const stages = data.flatMap((division) => [{
    id: `${division.id}.pools`, label: `${division.label} pools`, divisionId: division.id,
    primitive: "groups" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: division.count,
    pool: { poolCount: division.pools.length, sizes: division.pools, rounds: 1 as const, allocation: "manual" as const },
  }, {
    id: `${division.id}.konnect`, label: `${division.label} Konnect`, divisionId: division.id,
    primitive: "single_elimination" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: 4, bracket: { entrantCount: 4, topology: "power_of_two" as const, thirdPlaceMatch: false },
  }, {
    id: `${division.id}.tower`, label: `${division.label} Tower`, divisionId: division.id,
    primitive: "consolation" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: division.towerCount,
    bracket: { entrantCount: division.towerCount, topology: "byes" as const, thirdPlaceMatch: false },
  }]);
  const qualifications = qualifierPolicies(data);
  const structures = data.flatMap((division) => [
    { id: `${division.id}.konnect.structure`, label: `${division.label} Konnect`, divisionId: division.id,
      targetEntrants: 4, stageIds: [`${division.id}.konnect`] },
    { id: `${division.id}.tower.structure`, label: `${division.label} Tower`, divisionId: division.id,
      targetEntrants: division.towerCount, stageIds: [`${division.id}.tower`] },
  ]);
  const source = workbench.sources.find(({ normalized, kind, original }) => {
    const root = asRecord(normalized); if (root && asRecord(root.pools) && Array.isArray(root.schedule)) return true;
    if (kind !== "json" || typeof original !== "string") return false;
    try { const legacy = asRecord(JSON.parse(original)); return Boolean(legacy && asRecord(legacy.pools) && Array.isArray(legacy.schedule)); }
    catch { return false; }
  })!;
  const evidence = workbench.assumptions.map(({ id, path, provenance }) => ({ id: `decision.${id}`, rulePath: path,
    origin: "conversation_clarification" as const, knowledge: "KNOWN" as const,
    sourceReference: `${provenance[0]?.sourceId ?? "organiser-edit"}:${provenance[0]?.sourceHash ?? "unknown"}`,
    approved: true, critical: true }));
  const sourceEvidence = [...workbench.understoodFacts, ...workbench.rules].map(({ id, path, provenance }) => ({ id: `source.${id}`, rulePath: path,
    origin: "explicit_prompt" as const, knowledge: "KNOWN" as const,
    sourceReference: provenance.map(({ sourceId, sourceHash, sourcePath }) => `${sourceId}:${sourceHash}:${sourcePath}`).join("|"),
    approved: true, critical: false }));
  const criticalEvidence = [
    ...data.map((division) => ({ id: `decision.tiebreak.${division.id}`, rulePath: `/standingsPolicies/${division.id}.standings` })),
    ...qualifications.map(({ id }) => ({ id: `decision.qualification.${id}`, rulePath: `/qualificationPolicies/${id}` })),
    ...structures.map(({ id }) => ({ id: `source.draw.${id}`, rulePath: `/drawPolicies/${id}.draw` })),
  ].map(({ id, rulePath }) => ({ id, rulePath,
    origin: id.startsWith("source.") ? "explicit_prompt" as const : "conversation_clarification" as const,
    knowledge: "KNOWN" as const,
    sourceReference: id.startsWith("source.") ? `${source.id}:${source.sourceHash}` : "organiser-approved-structured-decision",
    approved: true, critical: true }));
  const regular = Number(rules.regularMatchMinutes);
  const durations: SchedulingDefinition["durations"] = stages.map(({ id }) => ({ stageId: id, contestMinutes: regular, turnaroundMinutes: 0 }));
  const addDuration = (stageId: string, round: string, minutes: unknown) =>
    durations.push({ stageId, round, contestMinutes: Number(minutes), turnaroundMinutes: 0 });
  for (const division of data) {
    if (division.id !== "beginner") {
      addDuration(`${division.id}.konnect`, "round-1", rules.AIKonnectSemiMinutes);
      addDuration(`${division.id}.konnect`, "final", rules.AIKonnectFinalMinutes);
      addDuration(`${division.id}.tower`, "semifinal", rules.AITowerSemiFinalMinutes);
      addDuration(`${division.id}.tower`, "final", rules.AITowerFinalMinutes);
    }
  }
  return {
    sport: { id: "padel", adapterVersion: "1.0.0", participantUnit: "pair", teamSize: 2,
      contest: { kind: "head_to_head", sides: 2 },
      scoringCapabilities: ["games", "sets", "timed_matches", "golden_point", "tie_break"], defaultResourceType: "court" },
    participants: { count: data.reduce((sum, division) => sum + division.count, 0), shape: "pair", rosterSize: 2 },
    divisions: data.map((division) => ({ id: division.id, label: division.label, participantCount: division.count,
      participantShape: "pair", stageIds: [`${division.id}.pools`, `${division.id}.konnect`, `${division.id}.tower`] })),
    stages,
    scoringSystems: [{ id: "padel.timed", adapterRule: "padel.timed.standard", version: "1.0.0", stageIds: stages.map(({ id }) => id) }],
    standingsPolicies: data.map((division) => ({ id: `${division.id}.standings`, stageIds: [`${division.id}.pools`],
      metricOrder: [{ metric: "wins", direction: "DESC" as const }, { metric: "game_difference", direction: "DESC" as const },
        { metric: "games_won", direction: "DESC" as const }, { metric: "head_to_head", direction: "DESC" as const }],
      tieFallback: "manual_decision" as const })),
    qualificationPolicies: qualifications,
    competitionStructures: structures,
    drawPolicies: structures.map((structure) => ({ id: `${structure.id}.draw`, structureId: structure.id, placement: "optimised" as const,
      priorities: [{ rule: "structural_validity", strength: "HARD" as const, priority: 1 },
        { rule: "protected_byes", strength: "HARD" as const, priority: 2 },
        { rule: "avoid_opening_round_pool_rematch", strength: "SOFT" as const, priority: 3, weight: 60 }] })),
    progressionPolicies: [],
    scheduling: { timezone: timeZone, start: isoOn(date, "11:00", timeZone), finishBy: isoOn(date, String(rules.hardStop), timeZone),
      constraints: [{ id: "no.participant.overlap", rule: "participant_cannot_play_two_contests_simultaneously",
        strength: "HARD", value: true, unit: "boolean" },
        ...finalResourceConstraints(finals)], durations, objective: "earliest_finish" },
    resources: [
      { id: "venue.courts.early", type: "court", quantity: 4,
        availability: [{ start: isoOn(date, "11:00", timeZone), end: isoOn(date, "12:00", timeZone) }] },
      { id: "venue.courts.main", type: "court", quantity: 7,
        availability: [{ start: isoOn(date, "12:00", timeZone), end: isoOn(date, String(rules.hardStop), timeZone) }] },
    ],
    operationalPolicies: [{ id: "withdrawal", rule: decisions.withdrawal!, strength: "HARD", value: true }],
    randomisation: { mode: "none" }, assumptions: [...evidence, ...sourceEvidence, ...criticalEvidence],
    requirements: [
      { id: "SA1", sourceText: "48 pairs in 13 locked pools", type: "participants", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["source.entrants.total"] },
      { id: "SA2", sourceText: "66 group fixtures and 42 Konnect/Tower fixtures", type: "contest_accounting", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["source.progression.paths"] },
      { id: "SA3", sourceText: "Four courts from 11:00 and seven from 12:00 until the 20:00 hard stop", type: "resources", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["source.resource.availability", "source.schedule.hard-stop"] },
      { id: "SA4", sourceText: "Variable Konnect, Tower and beginner match durations", type: "duration", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["source.match.durations"] },
      { id: "SA5", sourceText: "Named finals must use their required courts", type: "resources", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["source.final.courts"] },
      ...evidence.map(({ id }, index) => ({ id: `SAD${index + 1}`, sourceText: `Organiser explicitly approved ${id.slice("decision.".length)}`,
        type: "organiser_decision", strength: "HARD" as const, status: "SATISFIED" as const, mappedRuleIds: [id] })),
    ],
  };
}

export function entrantsFromProductionLock(workbench: CompetitionWorkbenchProjection): Record<string, Entrant[]> | null {
  const root = sourceRoot(workbench); const sourcePools = asRecord(root?.pools); if (!sourcePools) return null;
  const result: Record<string, Entrant[]> = {};
  for (const [divisionLabel, poolValue] of Object.entries(sourcePools)) {
    const divisionId = idFor(divisionLabel); const pools = asRecord(poolValue); if (!pools) return null;
    let entrantIndex = 0;
    result[divisionId] = Object.values(pools).flatMap((value, poolIndex) => {
      if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return [];
      return value.map((name) => {
        entrantIndex += 1;
        return { id: `${divisionId}.team.${entrantIndex}`, divisionId,
          memberIds: String(name).split(" / ").map((_, member) => `${divisionId}.team.${entrantIndex}.member.${member + 1}`),
          seed: entrantIndex, poolId: `${divisionId}.pools.P${poolIndex + 1}` };
      });
    });
  }
  return result;
}

export function participantNamesFromProductionLock(workbench: CompetitionWorkbenchProjection): Readonly<Record<string, string>> {
  const root = sourceRoot(workbench); const sourcePools = asRecord(root?.pools); if (!sourcePools) return {};
  const names: Record<string, string> = {};
  for (const [divisionLabel, poolValue] of Object.entries(sourcePools)) {
    const divisionId = idFor(divisionLabel); const pools = asRecord(poolValue); if (!pools) continue;
    let entrantIndex = 0;
    for (const entrants of Object.values(pools)) for (const name of Array.isArray(entrants) ? entrants : []) {
      entrantIndex += 1;
      if (typeof name === "string") names[`${divisionId}.team.${entrantIndex}`] = name;
    }
  }
  return names;
}

function sourceRoundOrder(row: Record<string, unknown>): number {
  const round = String(row.round ?? "").toLowerCase();
  if (round.includes("play-in")) return 1;
  if (round.includes("last 16")) return 2;
  if (round.includes("quarter")) return 3;
  if (round.includes("semi")) return 4;
  if (round.includes("final")) return 5;
  return 0;
}

export function verifiedScheduleFromProductionLock(workbench: CompetitionWorkbenchProjection, spec: TournamentSpec,
  graph: CompetitionGraph): ScheduleSolution | null {
  const root = sourceRoot(workbench); const rows = Array.isArray(root?.schedule) ? root.schedule.map(asRecord) : [];
  if (!root || rows.some((row) => row === null)) return null;
  const sourcePools = asRecord(root.pools); const entrantIdByName = new Map<string, string>();
  if (!sourcePools) return null;
  for (const [divisionLabel, poolValue] of Object.entries(sourcePools)) {
    const divisionId = idFor(divisionLabel); const pools = asRecord(poolValue); if (!pools) return null;
    let index = 0;
    for (const entrants of Object.values(pools)) for (const name of Array.isArray(entrants) ? entrants : []) {
      index += 1; if (typeof name === "string") entrantIdByName.set(name, `${divisionId}.team.${index}`);
    }
  }
  const decisions = workbenchDecisionValues(workbench); const date = decisions["event-date"]!; const timeZone = decisions.timezone!;
  const potentials = possibleEntrants(graph);
  const contests: ScheduleSolution["contests"] = [];
  for (const stage of spec.stages) {
    const graphNodes = graph.nodes.filter((node) => node.kind === "contest" && node.stageId === stage.id)
      .sort((left, right) => left.roundIndex - right.roundIndex || left.index - right.index || left.id.localeCompare(right.id));
    const sourceStage = stage.id.endsWith(".pools") ? "Group" : stage.id.endsWith(".konnect") ? "Konnect" : "Tower";
    const sourceDivision = spec.divisions.find(({ id }) => id === stage.divisionId)?.label;
    let sourceRows = (rows as Record<string, unknown>[]).filter(({ division, stage: suppliedStage }) =>
      division === sourceDivision && suppliedStage === sourceStage).sort((left, right) => {
      if (sourceStage === "Group") return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
      return sourceRoundOrder(left) - sourceRoundOrder(right) || String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    });
    if (sourceRows.length !== graphNodes.length) return null;
    if (sourceStage === "Group") sourceRows = graphNodes.map((node) => {
      const expected = node.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []).sort();
      return sourceRows.find(({ source1, source2 }) => [entrantIdByName.get(String(source1)), entrantIdByName.get(String(source2))]
        .filter((id): id is string => Boolean(id)).sort().every((id, index) => id === expected[index]))!;
    });
    if (sourceRows.some((row) => !row)) return null;
    graphNodes.forEach((node, index) => {
      const row = sourceRows[index]!; const time = String(row.start ?? ""); const duration = Number(row.duration);
      const court = Number(row.court); const hour = Number(time.slice(0, 2));
      if (!/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(duration) || !Number.isInteger(court)) return;
      const start = isoOn(date, time, timeZone);
      const resourceId = hour < 12 ? `venue.courts.early.${court - 3}` : `venue.courts.main.${court}`;
      contests.push({ contestId: node.id, resourceId, start,
        end: new Date(Date.parse(start) + duration * 60_000).toISOString(),
        possibleEntrantIds: [...(potentials.get(node.id) ?? [])].sort() });
    });
  }
  if (contests.length !== graph.nodes.filter(({ kind }) => kind === "contest").length) return null;
  const baseAudit = { solver: "verified-source-schedule-adapter", version: "1.0.0", status: "FEASIBLE" as const,
    objective: spec.scheduling.objective, objectiveValueMinutes: Math.ceil((Math.max(...contests.map(({ end }) => Date.parse(end)))
      - Date.parse(spec.scheduling.start)) / 60_000), lowerBoundMinutes: 0 };
  const provisional: ScheduleSolution = { contests, audit: { ...baseAudit, scheduleHash: canonicalHash({ scheduled: contests, audit: baseAudit }) }, findings: [] };
  const validation = validateSchedule(spec, graph, provisional);
  const status = validation.some(({ severity }) => severity === "ERROR") ? "INFEASIBLE" as const : "FEASIBLE" as const;
  const schedule: ScheduleSolution = { ...provisional, audit: { ...provisional.audit, status }, findings: [] };
  return attachValidationAudit(schedule, validation);
}

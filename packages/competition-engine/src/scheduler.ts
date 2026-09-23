import { canonicalHash, type SchedulingDefinition, type TournamentSpec, type ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, ContestNode, ScheduleSolution, ScheduledContest } from "./types.js";
import { calculateSchedulingLowerBounds } from "./lower-bounds.js";
import { deriveContestEntrantsIndependently } from "./independent-entrants.js";

const minutes = (value: number) => value * 60_000;
const iso = (value: number) => new Date(value).toISOString();

function durationFor(node: ContestNode, scheduling: SchedulingDefinition): number {
  const exact = [...scheduling.durations].reverse().find(({ stageId, round }) => stageId === node.stageId && round === node.round);
  const general = [...scheduling.durations].reverse().find(({ stageId, round }) => stageId === node.stageId && round === undefined);
  const selected = exact ?? general;
  if (!selected) throw new Error(`No duration for ${node.id}`);
  return selected.contestMinutes + selected.turnaroundMinutes;
}

function dependencyMap(graph: CompetitionGraph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of graph.nodes) map.set(node.id, []);
  for (const edge of graph.edges) map.get(edge.toContestId)?.push(edge.fromContestId);
  return map;
}

export function topologicalNodes(graph: CompetitionGraph): ContestNode[] {
  const dependencies = dependencyMap(graph);
  const outgoing = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) outgoing.get(edge.fromContestId)?.push(edge.toContestId);
  const downstream = new Map<string, number>();
  const downstreamCount = (id: string, visiting = new Set<string>()): number => {
    const cached = downstream.get(id); if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    const nextVisiting = new Set(visiting).add(id);
    const descendants = new Set<string>();
    const queue = [...(outgoing.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (descendants.has(next)) continue;
      descendants.add(next);
      if (!nextVisiting.has(next)) queue.push(...(outgoing.get(next) ?? []));
    }
    downstream.set(id, descendants.size);
    return descendants.size;
  };
  const remaining = new Map([...dependencies].map(([id, values]) => [id, new Set(values)]));
  const result: ContestNode[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id).sort((leftId, rightId) => {
      const left = graph.nodes.find(({ id }) => id === leftId)!; const right = graph.nodes.find(({ id }) => id === rightId)!;
      return downstreamCount(right.id) - downstreamCount(left.id) || left.roundIndex - right.roundIndex ||
        left.index - right.index || left.id.localeCompare(right.id);
    });
    if (!ready.length) throw new Error("Competition graph is cyclic");
    for (const id of ready) {
      result.push(graph.nodes.find((node) => node.id === id)!);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return result;
}

export function possibleEntrants(graph: CompetitionGraph): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const node of topologicalNodes(graph)) {
    const values = new Set<string>();
    for (const slot of node.slots) {
      if (slot.type === "entrant") values.add(slot.entrantId);
      else if (slot.type !== "bye") for (const id of result.get(slot.contestId) ?? []) values.add(id);
    }
    result.set(node.id, values);
  }
  return result;
}

interface ResourceUnit { id: string; type: string; availability: Array<[number, number]>; }

function units(spec: TournamentSpec): ResourceUnit[] {
  return spec.resources.flatMap((resource) => Array.from({ length: resource.quantity }, (_, index) => ({
    id: `${resource.id}.${index + 1}`, type: resource.type,
    availability: resource.availability.map(({ start, end }) => [Date.parse(start), Date.parse(end)] as [number, number]),
  })));
}

function fits(start: number, end: number, resource: ResourceUnit, scheduled: ScheduledContest[]): boolean {
  if (!resource.availability.some(([from, to]) => start >= from && end <= to)) return false;
  return scheduled.filter(({ resourceId }) => resourceId === resource.id).every((entry) => end <= Date.parse(entry.start) || start >= Date.parse(entry.end));
}

function lockedStarts(spec: TournamentSpec): Map<string, number> {
  return new Map(spec.scheduling.constraints
    .filter(({ id, rule, strength, value }) => rule === "locked_match_start" && strength === "HARD" && id.startsWith("lock.") && typeof value === "string")
    .map(({ id, value }) => [id.slice("lock.".length), Date.parse(value as string)]));
}

interface RequiredResourceRule { readonly stageId: string; readonly round: string; readonly resourceId: string; }

function requiredResourceRules(spec: TournamentSpec): RequiredResourceRule[] {
  return spec.scheduling.constraints.filter(({ rule, strength, value }) =>
    rule === "required_resource" && strength === "HARD" && typeof value === "string").flatMap(({ value }) => {
    try {
      const parsed = JSON.parse(value as string) as Partial<RequiredResourceRule>;
      return typeof parsed.stageId === "string" && typeof parsed.round === "string" && typeof parsed.resourceId === "string"
        ? [{ stageId: parsed.stageId, round: parsed.round, resourceId: parsed.resourceId }] : [];
    } catch { return []; }
  });
}

function requiredResourceId(spec: TournamentSpec, node: ContestNode): string | undefined {
  return requiredResourceRules(spec).find(({ stageId, round }) => stageId === node.stageId && round === node.round)?.resourceId;
}

function requiredResourceConstraintFindings(spec: TournamentSpec, graph: CompetitionGraph): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seen = new Map<string, string>(); const resourceIds = new Set(units(spec).map(({ id }) => id));
  for (const constraint of spec.scheduling.constraints.filter(({ rule }) => rule === "required_resource")) {
    let parsed: Partial<RequiredResourceRule> | null = null;
    try { parsed = typeof constraint.value === "string" ? JSON.parse(constraint.value) as Partial<RequiredResourceRule> : null; }
    catch { parsed = null; }
    const valid = constraint.strength === "HARD" && typeof parsed?.stageId === "string" && typeof parsed.round === "string"
      && typeof parsed.resourceId === "string" && resourceIds.has(parsed.resourceId)
      && graph.nodes.some(({ kind, stageId, round }) => kind === "contest" && stageId === parsed!.stageId && round === parsed!.round);
    if (!valid) {
      findings.push({ code: "TSV411", severity: "ERROR", path: `/scheduling/constraints/${constraint.id}`,
        message: "A required_resource constraint must be HARD JSON naming an existing contest stage/round and resource unit." });
      continue;
    }
    const key = `${parsed!.stageId}:${parsed!.round}`; const previous = seen.get(key);
    if (previous && previous !== parsed!.resourceId) findings.push({ code: "TSV411", severity: "ERROR",
      path: `/scheduling/constraints/${constraint.id}`, message: "A contest stage/round cannot require conflicting resource units." });
    seen.set(key, parsed!.resourceId!);
  }
  return findings;
}

function enforceRequiredResources(spec: TournamentSpec, graph: CompetitionGraph, scheduled: ScheduledContest[],
  resources: readonly ResourceUnit[]): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const entry of [...scheduled].sort((left, right) => left.contestId.localeCompare(right.contestId))) {
    const node = nodes.get(entry.contestId); if (!node) continue;
    const requiredId = requiredResourceId(spec, node); if (!requiredId || entry.resourceId === requiredId) continue;
    const required = resources.find(({ id }) => id === requiredId); if (!required) continue;
    const start = Date.parse(entry.start); const end = Date.parse(entry.end);
    const others = scheduled.filter(({ contestId }) => contestId !== entry.contestId);
    if (fits(start, end, required, others)) { entry.resourceId = requiredId; continue; }
    const conflicts = others.filter(({ resourceId, start: otherStart, end: otherEnd }) => resourceId === requiredId
      && start < Date.parse(otherEnd) && end > Date.parse(otherStart));
    const working = others.filter(({ contestId }) => !conflicts.some((conflict) => conflict.contestId === contestId));
    const moved: ScheduledContest[] = [];
    let possible = true;
    for (const conflict of conflicts.sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId))) {
      const conflictNode = nodes.get(conflict.contestId);
      if (!conflictNode || requiredResourceId(spec, conflictNode)) { possible = false; break; }
      const conflictStart = Date.parse(conflict.start); const conflictEnd = Date.parse(conflict.end);
      const replacement = resources.filter(({ type, id }) => type === conflictNode.requiredResourceType && id !== requiredId)
        .sort((left, right) => left.id === entry.resourceId ? -1 : right.id === entry.resourceId ? 1 : left.id.localeCompare(right.id))
        .find((resource) => fits(conflictStart, conflictEnd, resource, [...working, ...moved]));
      if (!replacement) { possible = false; break; }
      moved.push({ ...conflict, resourceId: replacement.id });
    }
    if (!possible || !fits(start, end, required, [...working, ...moved])) continue;
    for (const replacement of moved) {
      const index = scheduled.findIndex(({ contestId }) => contestId === replacement.contestId);
      scheduled[index] = replacement;
    }
    entry.resourceId = requiredId;
  }
}

function headlineFinalStageIds(spec: TournamentSpec): Set<string> {
  const value = spec.scheduling.constraints.find(({ rule, strength }) => rule === "headline_final_climax" && strength === "SOFT")?.value;
  return new Set(typeof value === "string" ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : []);
}

function alignHeadlineFinals(spec: TournamentSpec, graph: CompetitionGraph, scheduled: ScheduledContest[],
  resources: readonly ResourceUnit[], dependencies: ReadonlyMap<string, string[]>): void {
  const headlineStages = headlineFinalStageIds(spec);
  if (!headlineStages.size || !scheduled.length) return;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const finish = Math.max(...scheduled.map(({ end }) => Date.parse(end)));
  const candidates = scheduled.filter(({ contestId }) => {
    const node = nodes.get(contestId);
    return node?.kind === "contest" && node.round.toLowerCase() === "final" && headlineStages.has(node.stageId);
  }).sort((left, right) => left.contestId.localeCompare(right.contestId));
  for (const original of candidates) {
    const duration = Date.parse(original.end) - Date.parse(original.start); const targetStart = finish - duration;
    const dependencyEnd = Math.max(0, ...(dependencies.get(original.contestId) ?? []).map((id) => {
      const entry = scheduled.find(({ contestId }) => contestId === id); return entry ? Date.parse(entry.end) : Number.POSITIVE_INFINITY;
    }));
    if (dependencyEnd > targetStart) continue;
    const others = scheduled.filter(({ contestId }) => contestId !== original.contestId);
    const participantCollision = others.some((entry) => entry.possibleEntrantIds.some((id) => original.possibleEntrantIds.includes(id)) &&
      targetStart < Date.parse(entry.end) && finish > Date.parse(entry.start));
    if (participantCollision) continue;
    const resource = resources.filter(({ type }) => type === nodes.get(original.contestId)?.requiredResourceType)
      .find((unit) => fits(targetStart, finish, unit, others));
    if (!resource) continue;
    const index = scheduled.findIndex(({ contestId }) => contestId === original.contestId);
    scheduled[index] = { ...original, resourceId: resource.id, start: iso(targetStart), end: iso(finish) };
  }
}

export function solveSchedule(spec: TournamentSpec, graph: CompetitionGraph): ScheduleSolution {
  const findings: ValidationFinding[] = [];
  const resourceUnits = units(spec);
  const dependencies = dependencyMap(graph);
  const potentials = possibleEntrants(graph);
  const readyEnd = new Map<string, number>();
  const participantLastEnd = new Map<string, number>();
  const locks = lockedStarts(spec);
  const scheduled: ScheduledContest[] = [];
  const startFloor = Date.parse(spec.scheduling.start);
  const minimumRest = Number(spec.scheduling.constraints.find(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD")?.value ?? 0);
  for (const node of topologicalNodes(graph)) {
    const dependencyEnd = Math.max(startFloor, ...(dependencies.get(node.id) ?? []).map((id) => readyEnd.get(id) ?? startFloor));
    if (node.kind === "bye") { readyEnd.set(node.id, dependencyEnd); continue; }
    const participantReady = Math.max(startFloor, ...[...(potentials.get(node.id) ?? [])].map((id) => (participantLastEnd.get(id) ?? (startFloor - minutes(minimumRest))) + minutes(minimumRest)));
    const earliestLegalStart = Math.max(dependencyEnd, participantReady);
    const lockedStart = locks.get(node.id);
    let cursor = lockedStart ?? earliestLegalStart;
    const duration = minutes(durationFor(node, spec.scheduling));
    let chosen: ResourceUnit | undefined;
    const hardLimit = Math.max(...resourceUnits.flatMap(({ availability }) => availability.map(([, end]) => end)));
    if (lockedStart !== undefined && (!Number.isFinite(lockedStart) || lockedStart < earliestLegalStart)) {
      findings.push({ code: "TSC405", severity: "ERROR", path: `/scheduling/constraints/lock.${node.id}`, message: "Locked match start violates a dependency or participant-rest constraint.", evidence: { contestId: node.id, lockedStart: Number.isFinite(lockedStart) ? iso(lockedStart) : "invalid", earliestLegalStart: iso(earliestLegalStart) } });
      continue;
    }
    while (cursor + duration <= hardLimit) {
      chosen = resourceUnits.filter(({ type }) => type === node.requiredResourceType)
        .find((resource) => fits(cursor, cursor + duration, resource, scheduled));
      if (chosen || lockedStart !== undefined) break;
      cursor += minutes(5);
    }
    if (!chosen) {
      findings.push(lockedStart === undefined
        ? { code: "TSC403", severity: "ERROR", path: `/schedule/${node.id}`, message: "No legal resource/time placement was found." }
        : { code: "TSC405", severity: "ERROR", path: `/schedule/${node.id}`, message: "The locked match start has no legal resource placement.", evidence: { contestId: node.id, lockedStart: iso(lockedStart) } });
      continue;
    }
    const entry: ScheduledContest = { contestId: node.id, resourceId: chosen.id, start: iso(cursor), end: iso(cursor + duration), possibleEntrantIds: [...(potentials.get(node.id) ?? [])].sort() };
    scheduled.push(entry); readyEnd.set(node.id, cursor + duration);
    for (const id of entry.possibleEntrantIds) participantLastEnd.set(id, cursor + duration);
  }
  alignHeadlineFinals(spec, graph, scheduled, resourceUnits, dependencies);
  enforceRequiredResources(spec, graph, scheduled, resourceUnits);
  const lowerBoundMinutes = calculateSchedulingLowerBounds(spec, graph).verifiedLowerBoundMinutes;
  const finish = scheduled.length ? Math.max(...scheduled.map(({ end }) => Date.parse(end))) : startFloor;
  if (spec.scheduling.finishBy && finish > Date.parse(spec.scheduling.finishBy)) findings.push({ code: "TSC404", severity: "ERROR", path: "/scheduling/finishBy", message: "Schedule exceeds the hard finish deadline.", evidence: { finish: iso(finish), finishBy: spec.scheduling.finishBy } });
  const audit = {
    solver: "deterministic-list-scheduler", version: "1.0.0", status: findings.some(({ severity }) => severity === "ERROR") ? "INFEASIBLE" as const : "FEASIBLE" as const,
    objective: spec.scheduling.objective, objectiveValueMinutes: Math.ceil((finish - startFloor) / 60_000), lowerBoundMinutes,
  };
  const scheduleHash = canonicalHash({ scheduled, audit });
  return { contests: scheduled, audit: { ...audit, scheduleHash }, findings };
}

function ancestorReady(id: string, scheduled: Map<string, ScheduledContest>, dependencies: Map<string, string[]>, memo: Map<string, number>): number {
  const cached = memo.get(id); if (cached !== undefined) return cached;
  const direct = scheduled.get(id); if (direct) { const end = Date.parse(direct.end); memo.set(id, end); return end; }
  const end = Math.max(0, ...(dependencies.get(id) ?? []).map((dep) => ancestorReady(dep, scheduled, dependencies, memo)));
  memo.set(id, end); return end;
}

export function validateSchedule(spec: TournamentSpec, graph: CompetitionGraph, solution: ScheduleSolution): ValidationFinding[] {
  const findings: ValidationFinding[] = [...requiredResourceConstraintFindings(spec, graph)];
  const actualNodes = graph.nodes.filter(({ kind }) => kind === "contest");
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const scheduledMap = new Map(solution.contests.map((entry) => [entry.contestId, entry]));
  const duplicateContestIds = [...new Set(solution.contests.map(({ contestId }) => contestId)
    .filter((contestId, index, values) => values.indexOf(contestId) !== index))].sort();
  if (duplicateContestIds.length) findings.push({ code: "TSV408", severity: "ERROR", path: "/schedule", message: "A contest must be scheduled exactly once.", evidence: { duplicateContestIds } });
  const resourceMap = new Map(units(spec).map((unit) => [unit.id, unit]));
  const deps = dependencyMap(graph); const memo = new Map<string, number>();
  const locks = lockedStarts(spec);
  for (const node of actualNodes) if (!scheduledMap.has(node.id)) findings.push({ code: "TSV401", severity: "ERROR", path: `/schedule/${node.id}`, message: "Actual contest is missing from the schedule." });
  for (const entry of solution.contests) {
    const node = nodeMap.get(entry.contestId); const resource = resourceMap.get(entry.resourceId);
    if (!node || !resource) { findings.push({ code: "TSV402", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Schedule references an unknown node or resource." }); continue; }
    const start = Date.parse(entry.start); const end = Date.parse(entry.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      findings.push({ code: "TSV409", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Schedule timestamps must be valid instants with positive duration.", evidence: { start: entry.start, end: entry.end } });
      continue;
    }
    if (end - start !== minutes(durationFor(node, spec.scheduling))) findings.push({ code: "TSV403", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Scheduled duration differs from the declared duration." });
    if (!fits(start, end, resource, solution.contests.filter((other) => other.contestId !== entry.contestId))) findings.push({ code: "TSV404", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Resource collision or availability violation." });
    const dependencyEnd = Math.max(0, ...(deps.get(entry.contestId) ?? []).map((id) => ancestorReady(id, scheduledMap, deps, memo)));
    if (start < dependencyEnd) findings.push({ code: "TSV405", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Contest starts before a dependency can complete." });
    const lockedStart = locks.get(entry.contestId);
    if (lockedStart !== undefined && start !== lockedStart) findings.push({ code: "TSV407", severity: "ERROR", path: `/schedule/${entry.contestId}`, message: "Contest does not start at its declared hard lock.", evidence: { expectedStart: iso(lockedStart), actualStart: entry.start } });
    const requiredId = requiredResourceId(spec, node);
    if (requiredId && entry.resourceId !== requiredId) findings.push({ code: "TSV410", severity: "ERROR", path: `/schedule/${entry.contestId}`,
      message: "Contest is not assigned to its declared hard resource.", evidence: { expectedResourceId: requiredId, actualResourceId: entry.resourceId } });
  }
  // Who can play is derived from the graph, not taken from the schedule: a candidate that understates a
  // contest's entrants is rejected, and collisions/rest are judged on the union of claim and derivation.
  const derivedEntrants = deriveContestEntrantsIndependently(graph);
  for (const entry of solution.contests) {
    const missingEntrantIds = [...(derivedEntrants.get(entry.contestId) ?? [])]
      .filter((id) => !entry.possibleEntrantIds.includes(id)).sort();
    if (missingEntrantIds.length) findings.push({ code: "TSV411", severity: "ERROR", path: `/schedule/${entry.contestId}`,
      message: "Schedule omits entrants the competition graph says can occupy this contest.", evidence: { missingEntrantIds } });
  }
  const minimumRest = Number(spec.scheduling.constraints.find(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD")?.value ?? 0);
  const byEntrant = new Map<string, ScheduledContest[]>();
  for (const entry of solution.contests) {
    const entrantIds = new Set([...entry.possibleEntrantIds, ...(derivedEntrants.get(entry.contestId) ?? [])]);
    for (const id of entrantIds) byEntrant.set(id, [...(byEntrant.get(id) ?? []), entry]);
  }
  for (const [entrantId, entries] of byEntrant) {
    entries.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (let index = 1; index < entries.length; index += 1) if (Date.parse(entries[index]!.start) - Date.parse(entries[index - 1]!.end) < minutes(minimumRest)) findings.push({ code: "TSV406", severity: "ERROR", path: `/schedule/${entries[index]!.contestId}`, message: "Participant rest/collision invariant failed.", evidence: { entrantId } });
  }
  return findings;
}

export function attachValidationAudit(solution: ScheduleSolution, findings: ValidationFinding[]): ScheduleSolution {
  const validationHash = canonicalHash(findings);
  return { ...solution, findings: [...solution.findings, ...findings], audit: { ...solution.audit, validationHash } };
}

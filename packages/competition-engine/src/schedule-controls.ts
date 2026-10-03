import type { ResourceDefinition, TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph } from "./types.js";

// Organiser scheduling controls, read from a specification the same way by every scheduler and by the
// independent schedule validator: each court's own opening hours, and protected assignments that pin a
// contest's start, its court, or both.

export interface ResourceUnitDefinition {
  readonly id: string;
  readonly resourceId: string;
  readonly type: string;
  readonly availability: readonly { readonly start: string; readonly end: string }[];
}

/** Every concrete resource unit, with its own opening hours where the definition gives them. */
export function resourceUnitDefinitions(spec: Pick<TournamentSpec, "resources">): ResourceUnitDefinition[] {
  return spec.resources.flatMap((resource) => Array.from({ length: resource.quantity }, (_, index) => ({
    id: `${resource.id}.${index + 1}`, resourceId: resource.id, type: resource.type,
    availability: unitWindows(resource, index + 1),
  })));
}

function unitWindows(resource: ResourceDefinition, unit: number): ResourceDefinition["availability"] {
  return resource.unitAvailability?.find((entry) => entry.unit === unit)?.availability ?? resource.availability;
}

const finding = (code: string, path: string, message: string, evidence?: Record<string, unknown>): ValidationFinding =>
  ({ code, severity: "ERROR", path, message, ...(evidence ? { evidence } : {}) });

/**
 * Per-unit opening hours must name a real unit once, use valid non-overlapping windows, and stay inside
 * the resource's declared availability: a court cannot be open when the venue is not.
 */
export function resourceUnitFindings(spec: Pick<TournamentSpec, "resources">): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const resource of spec.resources) {
    const seen = new Set<number>();
    for (const entry of resource.unitAvailability ?? []) {
      const path = `/resources/${resource.id}/unitAvailability/${entry.unit}`;
      if (!Number.isInteger(entry.unit) || entry.unit < 1 || entry.unit > resource.quantity || seen.has(entry.unit)) {
        findings.push(finding("TSV415", path, "Per-unit opening hours must name each existing unit at most once.", { unit: entry.unit }));
        continue;
      }
      seen.add(entry.unit);
      const windows = entry.availability.map(({ start, end }) => [Date.parse(start), Date.parse(end)] as const)
        .sort((left, right) => left[0] - right[0]);
      const malformed = windows.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end) || end <= start);
      const overlapping = windows.some(([start], index) => index > 0 && start < windows[index - 1]![1]);
      const outside = windows.some(([start, end]) => !resource.availability.some((window) =>
        start >= Date.parse(window.start) && end <= Date.parse(window.end)));
      if (malformed || overlapping || outside) findings.push(finding("TSV415", path,
        "Per-unit opening hours must be valid, non-overlapping windows inside the resource's availability.", { malformed, overlapping, outside }));
    }
  }
  return findings;
}

export interface ProtectedAssignment {
  readonly contestId: string;
  /** Epoch milliseconds the contest must start at, when pinned. */
  readonly start?: number;
  /** The resource unit the contest must use, when pinned. */
  readonly resourceId?: string;
}

export const PROTECTED_ASSIGNMENT_RULE = "protected_assignment";

/**
 * A protected assignment is a HARD `protected_assignment` constraint with id `protect.<contestId>` whose
 * value is JSON `{ "contestId", "start"?, "resourceId"? }` naming at least one of start and resource.
 * A legacy `locked_match_start` (`lock.<contestId>`) is the same thing with a start only.
 */
export function protectedAssignments(spec: Pick<TournamentSpec, "scheduling">): Map<string, ProtectedAssignment> {
  return new Map(readProtectedAssignments(spec).assignments.map((entry) => [entry.contestId, entry]));
}

function readProtectedAssignments(spec: Pick<TournamentSpec, "scheduling">) {
  const assignments: ProtectedAssignment[] = []; const malformed: string[] = [];
  for (const constraint of spec.scheduling.constraints) {
    if (constraint.rule === "locked_match_start") {
      const start = typeof constraint.value === "string" ? Date.parse(constraint.value) : Number.NaN;
      if (constraint.strength !== "HARD" || !constraint.id.startsWith("lock.") || !Number.isFinite(start)) { malformed.push(constraint.id); continue; }
      assignments.push({ contestId: constraint.id.slice("lock.".length), start });
    } else if (constraint.rule === PROTECTED_ASSIGNMENT_RULE) {
      type Declared = { contestId?: unknown; start?: unknown; resourceId?: unknown };
      let parsed: Declared | null = null;
      try { parsed = typeof constraint.value === "string" ? JSON.parse(constraint.value) as Declared : null; } catch { parsed = null; }
      const start = typeof parsed?.start === "string" ? Date.parse(parsed.start) : undefined;
      const valid = constraint.strength === "HARD" && parsed !== null && typeof parsed.contestId === "string"
        && constraint.id === `protect.${parsed.contestId}`
        && (parsed.start === undefined || (start !== undefined && Number.isFinite(start)))
        && (parsed.resourceId === undefined || (typeof parsed.resourceId === "string" && parsed.resourceId.length > 0))
        && (parsed.start !== undefined || parsed.resourceId !== undefined);
      if (!valid) { malformed.push(constraint.id); continue; }
      assignments.push({ contestId: parsed!.contestId as string, ...(start === undefined ? {} : { start }),
        ...(typeof parsed!.resourceId === "string" ? { resourceId: parsed!.resourceId } : {}) });
    }
  }
  return { assignments, malformed };
}

/**
 * Protected assignments must be well formed, one per contest, and name a scheduled contest and a unit of
 * the type it needs. A protection that names a contest the graph no longer has is a blocking finding,
 * never silently dropped: a recompile must not lose a promise made to an entrant.
 */
export function protectedAssignmentFindings(spec: TournamentSpec, graph: CompetitionGraph): ValidationFinding[] {
  const { assignments, malformed } = readProtectedAssignments(spec);
  const findings = malformed.map((id) => finding("TSV412", `/scheduling/constraints/${id}`,
    "A protected assignment must be HARD JSON with id 'protect.<contestId>' naming a start, a resource, or both."));
  const counts = new Map<string, number>();
  for (const { contestId } of assignments) counts.set(contestId, (counts.get(contestId) ?? 0) + 1);
  const units = new Map(resourceUnitDefinitions(spec).map((unit) => [unit.id, unit]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const [contestId, count] of counts) if (count > 1) findings.push(finding("TSV412", "/scheduling/constraints",
    "A contest can have at most one protected assignment.", { contestId }));
  for (const assignment of assignments) {
    const node = nodes.get(assignment.contestId);
    if (!node || node.kind !== "contest") {
      findings.push(finding("TSV413", `/scheduling/constraints/protect.${assignment.contestId}`,
        "A protected assignment names a contest this competition does not schedule.", { contestId: assignment.contestId }));
      continue;
    }
    if (assignment.resourceId !== undefined && units.get(assignment.resourceId)?.type !== node.requiredResourceType)
      findings.push(finding("TSV413", `/scheduling/constraints/protect.${assignment.contestId}`,
        "A protected assignment names a resource unit that does not exist or cannot host the contest.",
        { contestId: assignment.contestId, resourceId: assignment.resourceId }));
  }
  return findings;
}

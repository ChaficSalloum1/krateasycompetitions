import type { RequirementStatus, RuleStrength, ValidationFinding } from "@tournament-os/tournament-schema";
import { analyzeParticipantPaths } from "./analytics.js";
import type { ScenarioResult, SlotSource } from "./types.js";

export interface BlueprintFinding {
  readonly code: string; readonly severity: "ERROR" | "WARNING"; readonly path: string; readonly message: string;
  readonly evidence?: Readonly<Record<string, unknown>>; readonly origins: readonly string[];
  readonly debugId: string; readonly accessibilityLabel: string; readonly hidden: false;
}
export interface BlueprintView {
  readonly summary: {
    readonly title: string; readonly certificationStatus: "CERTIFIED" | "REJECTED";
    readonly solverStatus: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN"; readonly actionRequired: boolean;
    readonly participantCount: number; readonly actualContestCount: number; readonly scheduledContestCount: number;
    readonly accessibilityLabel: string;
  };
  readonly governance: {
    readonly rules: readonly { readonly id: string; readonly category: string; readonly path: string; readonly strength: RuleStrength | "DECLARED"; readonly label: string; readonly value: unknown; readonly debugId: string }[];
    readonly assumptions: readonly { readonly id: string; readonly path: string; readonly knowledge: string; readonly origin: string; readonly approved: boolean; readonly critical: boolean; readonly sourceReference: string; readonly accessibilityLabel: string; readonly debugId: string }[];
    readonly requirementCoverage: readonly { readonly id: string; readonly sourceText: string; readonly strength: RuleStrength; readonly status: RequirementStatus; readonly mappedRuleIds: readonly string[]; readonly resolution: string; readonly accessibilityLabel: string; readonly debugId: string }[];
  };
  readonly graph: {
    readonly nodes: readonly { readonly id: string; readonly stageId: string; readonly kind: "contest" | "bye"; readonly round: string; readonly inputs: readonly string[]; readonly accessibilityLabel: string; readonly debugId: string }[];
    readonly edges: readonly { readonly id: string; readonly from: string; readonly to: string; readonly outcome: string; readonly slot: number; readonly accessibilityLabel: string; readonly debugId: string }[];
    readonly participantPaths: readonly { readonly entrantId: string; readonly minimumContests: number; readonly maximumContests: number; readonly guaranteedContestIds: readonly string[]; readonly possibleContestIds: readonly string[]; readonly counterexample: readonly string[]; readonly accessibilityLabel: string; readonly debugId: string }[];
  };
  readonly schedule: {
    readonly timeline: readonly { readonly contestId: string; readonly resourceId: string; readonly start: string; readonly end: string; readonly durationMinutes: number; readonly possibleEntrantIds: readonly string[]; readonly accessibilityLabel: string; readonly debugId: string }[];
    readonly utilisation: readonly { readonly resourceId: string; readonly busyMinutes: number; readonly availableMinutes: number; readonly ratio: number; readonly accessibilityLabel: string }[];
    readonly objective: string; readonly objectiveValueMinutes: number | null; readonly lowerBoundMinutes: number; readonly optimalityGap: number | null;
  };
  readonly dryRun: { readonly available: boolean; readonly completedContests: number; readonly expectedContests: number; readonly completionRate: number; readonly unresolvedDependencies: readonly string[]; readonly seed: string | null; readonly hash: string | null; readonly accessibilityLabel: string };
  readonly findings: { readonly errors: readonly BlueprintFinding[]; readonly warnings: readonly BlueprintFinding[]; readonly all: readonly BlueprintFinding[] };
  readonly proofs: readonly { readonly id: string; readonly kind: string; readonly value: string; readonly label: string; readonly href: string }[];
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function debugId(kind: string, value: string): string { return `debug-${kind}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`; }
function slotLabel(slot: SlotSource): string {
  if (slot.type === "entrant") return `Entrant ${slot.entrantId}`;
  if (slot.type === "bye") return "Bye";
  return `${slot.type === "winner" ? "Winner" : "Loser"} of ${slot.contestId}`;
}
function collectFindings(scenario: ScenarioResult): BlueprintFinding[] {
  const sources: Array<[string, readonly ValidationFinding[]]> = [
    ["competition graph", scenario.graph.findings], ["schedule", scenario.schedule.findings], ["certification", scenario.certification.findings],
  ];
  const grouped = new Map<string, { finding: ValidationFinding; origins: Set<string> }>();
  for (const [origin, findings] of sources) for (const finding of findings) {
    const key = `${finding.code}\u0000${finding.severity}\u0000${finding.path}\u0000${finding.message}`;
    const current = grouped.get(key);
    if (current) current.origins.add(origin); else grouped.set(key, { finding, origins: new Set([origin]) });
  }
  return [...grouped.values()].map(({ finding, origins }): BlueprintFinding => ({
    code: finding.code, severity: finding.severity, path: finding.path, message: finding.message,
    ...(finding.evidence ? { evidence: finding.evidence } : {}), origins: [...origins].sort(), debugId: debugId("finding", `${finding.code}-${finding.path}`),
    accessibilityLabel: `${finding.severity === "ERROR" ? "Error" : "Warning"} ${finding.code}: ${finding.message}. Path ${finding.path}.`, hidden: false,
  })).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1) || a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
}

export function buildBlueprintView(scenario: ScenarioResult): BlueprintView {
  const findings = collectFindings(scenario);
  const rules: BlueprintView["governance"]["rules"][number][] = [];
  const addRule = (id: string, category: string, path: string, strength: RuleStrength | "DECLARED", label: string, value: unknown) =>
    rules.push({ id, category, path, strength, label, value, debugId: debugId("rule", id) });
  scenario.spec.stages.forEach((rule, index) => addRule(rule.id, "format", `/stages/${index}`, "DECLARED", `${rule.label}: ${rule.primitive}`, rule));
  scenario.spec.scoringSystems.forEach((rule, index) => addRule(rule.id, "scoring", `/scoringSystems/${index}`, "DECLARED", `Scoring ${rule.adapterRule} version ${rule.version}`, rule.stageIds));
  scenario.spec.standingsPolicies.forEach((rule, index) => addRule(rule.id, "standings", `/standingsPolicies/${index}`, "DECLARED", `Standings with ${rule.tieFallback}`, rule.metricOrder));
  scenario.spec.scheduling.constraints.forEach((rule, index) => addRule(rule.id, "scheduling", `/scheduling/constraints/${index}`, rule.strength, rule.rule, rule.value ?? null));
  scenario.spec.scheduling.durations.forEach((rule, index) => addRule(`duration:${rule.stageId}:${rule.round ?? "all"}:${index}`, "scheduling", `/scheduling/durations/${index}`, "DECLARED",
    `${rule.stageId} ${rule.round ?? "all rounds"}: ${rule.contestMinutes} minutes plus ${rule.turnaroundMinutes} turnaround`, rule));
  scenario.spec.operationalPolicies.forEach((rule, index) => addRule(rule.id, "operations", `/operationalPolicies/${index}`, rule.strength, rule.rule, rule.value ?? null));
  scenario.spec.qualificationPolicies.forEach((rule, index) => addRule(rule.id, "qualification", `/qualificationPolicies/${index}`, "DECLARED", `Qualify ${rule.outputCount} entrants`, rule.selectors));
  scenario.spec.drawPolicies.forEach((rule, index) => addRule(rule.id, "draw", `/drawPolicies/${index}`, "DECLARED", `${rule.placement} draw`, rule.priorities));
  scenario.spec.progressionPolicies.forEach((rule, index) => addRule(rule.id, "progression", `/progressionPolicies/${index}`, "DECLARED", `${rule.outcome} from ${rule.fromStageId} to ${rule.toStageId}`, rule));
  addRule("randomisation", "randomisation", "/randomisation", "DECLARED", `${scenario.spec.randomisation.mode} randomisation`, scenario.spec.randomisation);
  rules.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

  const assumptions = [...scenario.spec.assumptions].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
    id: entry.id, path: entry.rulePath, knowledge: entry.knowledge, origin: entry.origin, approved: entry.approved, critical: entry.critical,
    sourceReference: entry.sourceReference, accessibilityLabel: `${entry.critical ? "Critical" : "Non-critical"} ${entry.knowledge.toLowerCase()} assumption ${entry.id}, ${entry.approved ? "approved" : "not approved"}.`,
    debugId: debugId("assumption", entry.id),
  }));
  const requirementCoverage = [...scenario.spec.requirements].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
    id: entry.id, sourceText: entry.sourceText, strength: entry.strength, status: entry.status, mappedRuleIds: [...entry.mappedRuleIds].sort(),
    resolution: entry.resolutionNote ?? "No resolution note", accessibilityLabel: `Requirement ${entry.id} is ${entry.status.toLowerCase().replaceAll("_", " ")}: ${entry.sourceText}`,
    debugId: debugId("requirement", entry.id),
  }));
  const nodes = [...scenario.graph.nodes].sort((a, b) => a.roundIndex - b.roundIndex || a.index - b.index || a.id.localeCompare(b.id)).map((node) => {
    const inputs = node.slots.map(slotLabel);
    return { id: node.id, stageId: node.stageId, kind: node.kind, round: node.round, inputs,
      accessibilityLabel: `${node.kind === "bye" ? "Bye" : "Contest"} ${node.id}, ${node.round}, ${inputs.join(" versus ")}.`, debugId: debugId("node", node.id) };
  });
  const edges = [...scenario.graph.edges].sort((a, b) => a.fromContestId.localeCompare(b.fromContestId) || a.toContestId.localeCompare(b.toContestId) || a.toSlot - b.toSlot).map((edge) => ({
    id: `${edge.fromContestId}-${edge.outcome}-${edge.toContestId}-${edge.toSlot}`, from: edge.fromContestId, to: edge.toContestId, outcome: edge.outcome, slot: edge.toSlot,
    accessibilityLabel: `${edge.outcome} from ${edge.fromContestId} advances to slot ${edge.toSlot + 1} of ${edge.toContestId}.`,
    debugId: debugId("edge", `${edge.fromContestId}-${edge.outcome}-${edge.toContestId}-${edge.toSlot}`),
  }));
  const participantPaths = analyzeParticipantPaths(scenario.graph).map((path) => ({ entrantId: path.entrantId,
    minimumContests: path.minimumContestCount, maximumContests: path.maximumContestCount,
    guaranteedContestIds: [...path.guaranteedContestIds], possibleContestIds: [...path.possibleContestIds], counterexample: [...path.counterexample],
    accessibilityLabel: `${path.entrantId} plays between ${path.minimumContestCount} and ${path.maximumContestCount} contests.`, debugId: debugId("participant", path.entrantId) }));

  const timeline = [...scenario.schedule.contests].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.resourceId.localeCompare(b.resourceId) || a.contestId.localeCompare(b.contestId)).map((entry) => ({
    contestId: entry.contestId, resourceId: entry.resourceId, start: entry.start, end: entry.end,
    durationMinutes: (Date.parse(entry.end) - Date.parse(entry.start)) / 60_000, possibleEntrantIds: [...entry.possibleEntrantIds].sort(),
    accessibilityLabel: `${entry.contestId} on ${entry.resourceId}, starts ${entry.start}, ends ${entry.end}.`, debugId: debugId("schedule", entry.contestId),
  }));
  const utilisation = scenario.spec.resources.flatMap((resource) => Array.from({ length: resource.quantity }, (_, index) => {
    const resourceId = `${resource.id}.${index + 1}`;
    const busyMinutes = timeline.filter((entry) => entry.resourceId === resourceId).reduce((sum, entry) => sum + entry.durationMinutes, 0);
    const availableMinutes = resource.availability.reduce((sum, window) => sum + (Date.parse(window.end) - Date.parse(window.start)) / 60_000, 0);
    const ratio = availableMinutes > 0 ? busyMinutes / availableMinutes : 0;
    return { resourceId, busyMinutes, availableMinutes, ratio, accessibilityLabel: `${resourceId} is scheduled for ${busyMinutes} of ${availableMinutes} available minutes, ${Math.round(ratio * 100)} percent utilisation.` };
  })).sort((a, b) => a.resourceId.localeCompare(b.resourceId));

  const simulation = scenario.simulation;
  const expected = scenario.graph.generatedActualContestCount - new Set(simulation?.skippedConditionalContestIds ?? []).size;
  const completed = simulation?.completedContestCount ?? 0;
  const dryRun = { available: Boolean(simulation), completedContests: completed, expectedContests: expected,
    completionRate: expected > 0 ? completed / expected : 1, unresolvedDependencies: [...(simulation?.unresolvedDependencies ?? [])].sort(),
    seed: simulation?.seed ?? null, hash: simulation?.hash ?? null,
    accessibilityLabel: simulation ? `Dry run completed ${completed} of ${expected} contests with ${simulation.unresolvedDependencies.length} unresolved dependencies.` : "Dry run is not available." };

  const proofValues: Array<[string, string | undefined]> = [
    ["spec", scenario.spec.metadata.compiledSpecHash], ["graph", scenario.certification.graphHash],
    ["schedule", scenario.schedule.audit.scheduleHash], ["validation", scenario.schedule.audit.validationHash],
    ["simulation", simulation?.hash], ["certification", scenario.certification.certificationHash],
  ];
  const proofs = proofValues.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([kind, value]) => {
    const id = debugId(kind, value); return { id, kind, value, label: `${kind[0]!.toUpperCase()}${kind.slice(1)} proof ${value}`, href: `#${id}` };
  });
  const errors = findings.filter(({ severity }) => severity === "ERROR"); const warnings = findings.filter(({ severity }) => severity === "WARNING");
  const summary = {
    title: `Tournament blueprint ${scenario.spec.metadata.specId}, revision ${scenario.spec.metadata.revision}`,
    certificationStatus: scenario.certification.status, solverStatus: scenario.schedule.audit.status,
    actionRequired: scenario.certification.status === "REJECTED" || errors.length > 0,
    participantCount: scenario.spec.participants.count, actualContestCount: scenario.graph.generatedActualContestCount,
    scheduledContestCount: scenario.schedule.contests.length,
    accessibilityLabel: `${scenario.certification.status === "CERTIFIED" ? "Certified" : "Rejected"} tournament blueprint with ${errors.length} errors and ${warnings.length} warnings.`,
  };
  return freeze({ summary, governance: { rules, assumptions, requirementCoverage }, graph: { nodes, edges, participantPaths },
    schedule: { timeline, utilisation, objective: scenario.schedule.audit.objective,
      objectiveValueMinutes: scenario.schedule.audit.objectiveValueMinutes ?? null, lowerBoundMinutes: scenario.schedule.audit.lowerBoundMinutes,
      optimalityGap: scenario.schedule.audit.optimalityGap ?? null }, dryRun, findings: { errors, warnings, all: findings }, proofs });
}

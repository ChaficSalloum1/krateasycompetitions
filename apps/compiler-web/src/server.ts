import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import {
  aggregateReadiness,
  compileRegisteredIntent,
  createLiveOperationsState,
  deriveLiveControlRoom,
  submitLiveOperationsCommand,
  tournamentFormatCapabilities,
  type CompiledIntent,
  type OrganizationPlatformApi,
  type PlatformApiPrincipal,
  type ProductionReadinessReport,
  type LivenessReport,
  type RegisteredIntentNode,
  type SourceCitation,
} from "@tournament-os/competition-engine";
import { runReferenceDemo } from "./demo.js";
import { compilerHtml } from "./ui.js";
import { creatorHtml } from "./creator-view.js";
import { productHtml } from "./product-view.js";
import { createCompetitionProposal, parseCreationProposalPayload } from "./creation-proposal.js";
import { CompetitionJourney, competitionJourneyHtml, parseConnectedLiveCommand, parseCreationSource,
  type CompetitionJourneyOptions } from "./competition-journey.js";
import { renderCompetitionGuardPreflight } from "./guard-preflight-view.js";
import { renderCompetitionPortfolio } from "./competition-portfolio-view.js";
import { analyseCompetitionSources, recognisedCompetitionName } from "./competition-workbench.js";
import { playerHtml } from "./player-view.js";
import { participantRecoveryHtml } from "./participant-recovery-view.js";
import { participantOperationsHtml, venueDisplayHtml } from "./attention-views.js";
import { verifyOfflineEventPack } from "./offline-event-pack.js";
import { renderPrintableManualFallback } from "./manual-fallback-view.js";
import { createPlatformDemo } from "./platform-demo.js";
import { createInMemoryRateLimitStore, type ProductionPilotApi, type RateLimitStore } from "./production-pilot-api.js";

const json = (response: ServerResponse, status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", ...headers });
  response.end(JSON.stringify(value));
};

export async function readRequestBody(request: IncomingMessage, maximumBytes = 256_000): Promise<Uint8Array> {
  const declaredLength = request.headers["content-length"];
  if (typeof declaredLength === "string") {
    if (!/^\d+$/.test(declaredLength)) throw new Error("invalid_content_length");
    if (Number(declaredLength) > maximumBytes) throw new Error("request_too_large");
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maximumBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonRequestBody(request: IncomingMessage, maximumBytes = 256_000): Promise<unknown> {
  const encoded = await readRequestBody(request, maximumBytes);
  try {
    return JSON.parse(new TextDecoder().decode(encoded));
  } catch {
    throw new Error("invalid_json");
  }
}

export interface CompilerServerOptions {
  production?: boolean;
  authorize?: (request: IncomingMessage) => boolean | Promise<boolean>;
  platformApi?: OrganizationPlatformApi;
  authenticatePlatform?: (request: IncomingMessage) => PlatformApiPrincipal | null | Promise<PlatformApiPrincipal | null>;
  productionPilotApi?: ProductionPilotApi;
  maximumRequestBodyBytes?: number;
  productionReadiness?: () => Readonly<ProductionReadinessReport> | Promise<Readonly<ProductionReadinessReport>>;
  productionLiveness?: () => Readonly<LivenessReport>;
  competitionJourney?: CompetitionJourney;
  organizationId?: string;
  now?: () => string;
  participantRecoveryRateLimitStore?: RateLimitStore;
}

function normalizedHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) result[name] = Array.isArray(value) ? value.join(",") : value;
  return result;
}

let platformDemo: ReturnType<typeof createPlatformDemo> | undefined;
const getPlatformDemo = () => platformDemo ??= createPlatformDemo();
export type PilotDemoAction = "read" | "publish" | "propose-outage" | "approve-outage";

function participantTokenConfiguration(): Partial<Pick<CompetitionJourneyOptions,
  "participantTokenSecret" | "participantTokenKeys" | "participantTokenKeyVersion">> {
  const keyVersion = process.env.KRATEASY_PARTICIPANT_TOKEN_KEY_VERSION ?? "v1";
  const encodedKeys = process.env.KRATEASY_PARTICIPANT_TOKEN_KEYS;
  if (!encodedKeys) return process.env.KRATEASY_PARTICIPANT_TOKEN_SECRET
    ? { participantTokenSecret: process.env.KRATEASY_PARTICIPANT_TOKEN_SECRET, participantTokenKeyVersion: keyVersion } : {};
  let value: unknown;
  try { value = JSON.parse(encodedKeys); } catch { throw new Error("participant_signing_not_configured"); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length < 1 || Object.entries(value).some(([version, secret]) =>
      !version.trim() || typeof secret !== "string" || secret.length < 32))
    throw new Error("participant_signing_not_configured");
  return { participantTokenKeys: value as Record<string, string>, participantTokenKeyVersion: keyVersion };
}

export async function pilotDemoAction(action: PilotDemoAction) {
  const demo = await getPlatformDemo();
  if (action === "publish") return demo.publishPilot();
  if (action === "propose-outage") return demo.proposePilotOutage();
  if (action === "approve-outage") return demo.approvePilotOutage();
  return demo.pilotJourney();
}

export interface IntentClarification {
  readonly code: string;
  readonly message: string;
  readonly question: string;
  readonly citation: SourceCitation;
}

export interface OrganiserPlanProposal {
  readonly kind: "INTENT_PROPOSAL";
  readonly grammarVersion: "1.0.0";
  readonly semanticHash: string;
  readonly facts: CompiledIntent["facts"];
  readonly operations: readonly RegisteredIntentNode[];
  readonly approvalRequired: true;
}

export interface OrganiserPromptResult {
  readonly status: "PROPOSED" | "CLARIFICATION_REQUIRED" | "REJECTED";
  readonly executable: false;
  readonly intent: CompiledIntent;
  readonly plan: OrganiserPlanProposal | null;
  readonly clarifications: readonly IntentClarification[];
  readonly proposalHash: string;
}

const intentConfig = {
  grammarVersion: "1.0.0" as const,
  defaults: {
    id: "tournamentos.studio.defaults",
    version: "2026.1",
    source: "bundled-approved-defaults:2026.1",
    scoringRulesetId: "padel.standard.2026",
  },
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function factKey(node: RegisteredIntentNode): string | undefined {
  if (node.kind === "DIVISION_COUNT") return `${node.kind}:${node.division}`;
  if (node.kind === "CONTEST_DURATION") return `${node.kind}:${node.round}`;
  if (node.kind === "MINIMUM_MATCHES") return `${node.kind}:${node.scope}`;
  if (node.kind === "OPTIMISE_POOL_SIZES") return undefined;
  return node.kind;
}

function factValue(node: RegisteredIntentNode): string {
  switch (node.kind) {
    case "PARTICIPANT_COUNT": return `${node.count}:${node.unit}`;
    case "RESOURCE_COUNT": return `${node.resource}:${node.count}`;
    case "DIVISION_COUNT": return String(node.count);
    case "MINIMUM_MATCHES": return String(node.count);
    case "CONTEST_DURATION": return String(node.minutes);
    case "QUALIFICATION_COUNT": return String(node.count);
    case "OPTIMISE_POOL_SIZES": return node.objective;
    case "USE_PINNED_SCORING_DEFAULT": return node.rulesetId;
  }
}

function conflictClarifications(nodes: readonly RegisteredIntentNode[]): IntentClarification[] {
  const groups = new Map<string, RegisteredIntentNode[]>();
  for (const node of nodes) {
    const key = factKey(node); if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const conflicts: IntentClarification[] = [];
  for (const [key, group] of groups) {
    if (new Set(group.map(factValue)).size < 2) continue;
    const citation = group[1]?.citation ?? group[0]!.citation;
    conflicts.push({ code: `CONFLICTING_${key.split(":")[0]}`, message: `The prompt supplies contradictory values for ${key.toLowerCase().replaceAll("_", " ")}.`,
      question: "Which single value should the compiler use?", citation });
  }
  return conflicts.sort((left, right) => left.citation.start - right.citation.start || left.code.localeCompare(right.code));
}

const LANGUAGE_GLUE = new Set([
  "a", "also", "an", "and", "are", "across", "be", "consist", "consists", "each", "everyone", "give", "has", "have",
  "i", "include", "includes", "is", "like", "my", "of", "on", "organise", "organize", "our", "playing", "please", "run",
  "the", "there", "to", "tournament", "try", "using", "want", "we", "will", "with", "would",
]);

function residualClarifications(source: string, intent: CompiledIntent): IntentClarification[] {
  if (intent.status === "REJECTED") return [];
  const covered = new Uint8Array(source.length);
  const citations = [...intent.ast.map(({ citation }) => citation), ...intent.ambiguities.map(({ citation }) => citation),
    ...intent.unresolved.map(({ citation }) => citation)];
  for (const citation of citations) for (let index = citation.start; index < citation.end; index += 1) covered[index] = 1;
  const unknown = [...source.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)].filter((match) => {
    const start = match.index!; const end = start + match[0].length;
    return !covered.slice(start, end).some(Boolean) && !LANGUAGE_GLUE.has(match[0].toLowerCase());
  });
  if (unknown.length === 0) return [];
  const start = unknown[0]!.index!; const last = unknown.at(-1)!; const end = last.index! + last[0].length;
  const citation: SourceCitation = { sourceId: "prompt", start, end, text: source.slice(start, end) };
  return [{ code: "UNPARSED_CONSTRAINT_FRAGMENT", message: "Part of a recognized sentence is outside the registered grammar and was not applied.",
    question: "What explicit tournament rule should this phrase represent?", citation }];
}

export function compileOrganiserPrompt(source: string): OrganiserPromptResult {
  const intent = compileRegisteredIntent(source, intentConfig);
  const emptyCitation: SourceCitation = { sourceId: "prompt", start: 0, end: 0, text: "" };
  const clarifications: IntentClarification[] = [];
  if (!source.trim()) clarifications.push({ code: "EMPTY_PROMPT", message: "No organiser request was supplied.",
    question: "What tournament should be compiled?", citation: emptyCitation });
  for (const ambiguity of intent.ambiguities.filter(({ severity }) => severity === "BLOCKING")) {
    clarifications.push({ code: ambiguity.code, message: ambiguity.message,
      question: "Please provide the missing rule explicitly.", citation: ambiguity.citation });
  }
  for (const unresolved of intent.unresolved) {
    clarifications.push({ code: unresolved.reason, message: unresolved.message,
      question: unresolved.reason === "UNREGISTERED_GRAMMAR" ? "Can you express this as a supported, explicit tournament rule?" : "Please resolve this before compilation.",
      citation: unresolved.citation });
  }
  clarifications.push(...residualClarifications(source, intent));
  clarifications.push(...conflictClarifications(intent.ast));
  const deduplicated = clarifications.filter((entry, index, entries) => entries.findIndex((candidate) =>
    candidate.code === entry.code && candidate.citation.start === entry.citation.start && candidate.citation.end === entry.citation.end) === index);
  const status = intent.status === "REJECTED" ? "REJECTED" as const
    : deduplicated.length > 0 || intent.status === "BLOCKED" ? "CLARIFICATION_REQUIRED" as const : "PROPOSED" as const;
  const plan: OrganiserPlanProposal | null = status === "PROPOSED" ? {
    kind: "INTENT_PROPOSAL", grammarVersion: intent.grammarVersion, semanticHash: intent.semanticHash,
    facts: intent.facts, operations: intent.ast, approvalRequired: true,
  } : null;
  const body = { status, executable: false as const, intent, plan, clarifications: deduplicated };
  return immutable({ ...body, proposalHash: createHash("sha256").update(canonical(body)).digest("hex") });
}

export function interpretApiPayload(value: unknown): OrganiserPromptResult {
  const prompt = value && typeof value === "object" && "prompt" in value
    ? (value as { prompt?: unknown }).prompt : undefined;
  return compileOrganiserPrompt(typeof prompt === "string" ? prompt : "");
}

export function compilerReadiness(input: { production: boolean; hasAuthorizer: boolean }) {
  return aggregateReadiness([
    { name: "competition-engine", critical: true, status: "HEALTHY" },
    ...(input.production ? [{
      name: "identity-boundary",
      critical: true,
      status: input.hasAuthorizer ? "HEALTHY" as const : "UNKNOWN" as const,
      detail: input.hasAuthorizer ? "authorization adapter configured" : "authorization adapter is not configured",
    }] : []),
  ]);
}

export function apiAccessDecision(input: { production: boolean; hasAuthorizer: boolean; authorized: boolean }):
  { status: 503 | 403; body: { error: "authentication_not_configured" | "forbidden" } } | undefined {
  if (input.production && !input.hasAuthorizer) return { status: 503, body: { error: "authentication_not_configured" } };
  if (input.hasAuthorizer && !input.authorized) return { status: 403, body: { error: "forbidden" } };
  return undefined;
}

export function compilerWorkspace() {
  const { scenario, risk } = runReferenceDemo();
  const byResource = new Map<string, (typeof scenario.schedule.contests)[number]>();
  for (const contest of scenario.schedule.contests) if (!byResource.has(contest.resourceId)) byResource.set(contest.resourceId, contest);
  const selected = [...byResource.values()].slice(0, 3);
  const liveDefinition = {
    tournamentId: scenario.spec.metadata.specId,
    courts: selected.map(({ resourceId }) => resourceId),
    contests: selected.map((contest) => ({ contestId: contest.contestId,
      entrantIds: contest.possibleEntrantIds.length ? [...contest.possibleEntrantIds] : [`${contest.contestId}.unresolved`],
      courtId: contest.resourceId, scheduledStart: new Date(contest.start).toISOString(), scheduledEnd: new Date(contest.end).toISOString() })),
  };
  let liveState = createLiveOperationsState(liveDefinition);
  let sequence = 0;
  const execute = (command: Parameters<typeof submitLiveOperationsCommand>[1]) => {
    const result = submitLiveOperationsCommand(liveState, command);
    if (!result.accepted) throw new Error(`Reference live operation rejected: ${result.findings.map(({ code }) => code).join(",")}`);
    liveState = result.state;
  };
  const first = liveDefinition.contests[0]; const second = liveDefinition.contests[1]; const third = liveDefinition.contests[2];
  for (const entrantId of [...new Set([...(first?.entrantIds ?? []), ...(second?.entrantIds ?? [])])]) {
    sequence += 1; execute({ kind: "CHECK_IN", commandId: `reference.checkin.${sequence}`, expectedVersion: liveState.version,
      actorId: "reference.operator", occurredAt: "2026-09-05T09:00:00.000Z", entrantId });
  }
  if (first) {
    sequence += 1; execute({ kind: "START_CONTEST", commandId: `reference.start.${sequence}`, expectedVersion: liveState.version,
      actorId: "reference.operator", occurredAt: first.scheduledStart, contestId: first.contestId, courtId: first.courtId, startedAt: first.scheduledStart });
  }
  if (third) {
    sequence += 1; execute({ kind: "CLOSE_COURT", commandId: `reference.closure.${sequence}`, expectedVersion: liveState.version,
      actorId: "reference.operator", occurredAt: "2026-09-05T09:00:00.000Z", courtId: third.courtId, reason: "Reference surface inspection" });
  }
  const generatedAt = first ? new Date(Date.parse(first.scheduledStart) + 5 * 60_000).toISOString() : "2026-09-05T09:05:00.000Z";
  const operations = deriveLiveControlRoom(liveState, generatedAt);
  return { scenario, operationalRisk: risk, capabilities: tournamentFormatCapabilities(), operations };
}

const CLIENT_API_VERSION = "1.0" as const;
const REFERENCE_TOURNAMENT_NAME = "Play & Konnect 2026";
const entrantDisplayName = (entrantId: string): string => {
  const pair = /^([^.]+)\.team\.(\d+)$/.exec(entrantId);
  if (pair) return `${pair[1]![0]!.toUpperCase()}${pair[1]!.slice(1)} pair ${pair[2]}`;
  return entrantId.replaceAll(".", " ");
};

export function compilerClientApi() {
  const { scenario, operations: liveOperations } = compilerWorkspace();
  const tournamentID = scenario.spec.metadata.specId;
  const certificationStatus = scenario.certification.status;
  const solverStatus = scenario.schedule.audit.status;
  const portfolio = {
    apiVersion: CLIENT_API_VERSION,
    items: [{ id: tournamentID, name: REFERENCE_TOURNAMENT_NAME, revision: scenario.spec.metadata.revision, certificationStatus }],
  };
  const blueprint = {
    apiVersion: CLIENT_API_VERSION, id: tournamentID, name: REFERENCE_TOURNAMENT_NAME, revision: scenario.spec.metadata.revision,
    certificationStatus, solverStatus, participantCount: scenario.spec.participants.count,
    actualContestCount: scenario.graph.generatedActualContestCount, scheduledContestCount: scenario.schedule.contests.length,
    actionRequired: scenario.certification.findings.some(({ severity }) => severity === "ERROR"),
  };
  const schedule = {
    apiVersion: CLIENT_API_VERSION, tournamentID, timezone: "Europe/Athens", solverStatus,
    objectiveValueMinutes: scenario.schedule.audit.objectiveValueMinutes ?? null,
    lowerBoundMinutes: scenario.schedule.audit.lowerBoundMinutes,
    optimalityGap: scenario.schedule.audit.optimalityGap ?? null,
    items: scenario.schedule.contests.map((contest) => ({ id: contest.contestId, resourceID: contest.resourceId,
      start: contest.start, end: contest.end, possibleEntrantIDs: [...contest.possibleEntrantIds],
      accessibilityLabel: `${contest.contestId} on ${contest.resourceId}, ${contest.start} to ${contest.end}` })),
  };
  const operationalItems = [
    ...liveOperations.now.map((contest) => ({ contest, status: "NOW" as const, statusText: "In progress", detail: "Contest is active now." })),
    ...liveOperations.next.map((contest) => ({ contest, status: "NEXT" as const, statusText: "Up next", detail: "Entrants and assigned resource are ready." })),
    ...liveOperations.late.map((contest) => ({ contest, status: "LATE" as const, statusText: `${contest.minutesLate} minutes late`, detail: "Scheduled start has passed and the contest has not begun." })),
    ...liveOperations.blocked.map((contest) => ({ contest, status: "BLOCKED" as const, statusText: "Blocked",
      detail: contest.reasons.map(({ code, subjectIds }) => `${code}: ${subjectIds.join(", ")}`).join("; ") })),
    ...liveOperations.unreported.map((contest) => ({ contest, status: "UNREPORTED" as const, statusText: "Result unreported", detail: "Contest is settled but its result receipt is outstanding." })),
  ];
  const entrantIDsByContest = new Map(scenario.schedule.contests.map((contest) => [contest.contestId, [...contest.possibleEntrantIds]]));
  const operations = {
    apiVersion: CLIENT_API_VERSION, tournamentID, revision: liveOperations.version, asOf: liveOperations.generatedAt, timezone: "Europe/Athens",
    summary: { now: liveOperations.now.length, next: liveOperations.next.length, late: liveOperations.late.length,
      blocked: liveOperations.blocked.length, unreported: liveOperations.unreported.length },
    items: operationalItems.map(({ contest, status, statusText, detail }) => {
      const participantNames = (entrantIDsByContest.get(contest.contestId) ?? []).map(entrantDisplayName);
      return { id: `${status}.${contest.contestId}`, contestID: contest.contestId, status, title: contest.contestId, statusText, detail,
        resourceID: contest.courtId, scheduledStart: contest.scheduledStart, participantNames,
        accessibilityLabel: `${contest.contestId}, ${statusText}, ${contest.courtId}, scheduled ${contest.scheduledStart}${detail ? `, ${detail}` : ""}` };
    }),
  };
  const findings = {
    apiVersion: CLIENT_API_VERSION, tournamentID,
    items: scenario.certification.findings.map((finding, index) => ({ id: `${finding.code}.${index + 1}`, code: finding.code,
      severity: finding.severity, path: finding.path, message: finding.message,
      accessibilityLabel: `${finding.severity}: ${finding.message}`, debugID: `${scenario.certification.certificationHash.slice(0, 12)}.${finding.code}.${index + 1}` })),
  };
  const certification = {
    apiVersion: CLIENT_API_VERSION, tournamentID, status: certificationStatus, statement: scenario.certification.statement,
    certificationHash: scenario.certification.certificationHash,
    proofIDs: { spec: scenario.certification.specHash, graph: scenario.certification.graphHash,
      ...(scenario.certification.scheduleHash ? { schedule: scenario.certification.scheduleHash } : {}),
      ...(scenario.certification.simulationHash ? { simulation: scenario.certification.simulationHash } : {}) },
  };
  return immutable({ portfolio, blueprint, schedule, operations, findings, certification });
}

export function clientApiResponse(path: string): unknown | undefined {
  const api = compilerClientApi();
  if (path === "/v1/tournaments") return api.portfolio;
  const match = /^\/v1\/tournaments\/([^/]+)\/(blueprint|schedule|operations|findings|certification)$/.exec(path);
  if (!match || decodeURIComponent(match[1]!) !== api.blueprint.id) return undefined;
  return api[match[2] as "blueprint" | "schedule" | "operations" | "findings" | "certification"];
}

function journeyClientApiResponse(path: string, journey: CompetitionJourney): unknown | undefined {
  const snapshots = journey.list();
  if (path === "/v1/tournaments") {
    return immutable({ apiVersion: CLIENT_API_VERSION, items:
      snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, revision: snapshot.revision,
        certificationStatus: ["PUBLISHED", "CLOSED"].includes(snapshot.status) && snapshot.compiled?.guardStatus === "PASSED"
          ? "CERTIFIED" as const : "REJECTED" as const })) });
  }
  const match = /^\/v1\/tournaments\/([^/]+)\/(blueprint|schedule|operations|findings|certification)$/.exec(path);
  if (!match) return undefined;
  const snapshot = journey.read(decodeURIComponent(match[1]!));
  if (!snapshot) return undefined;
  const compiled = snapshot.compiled;
  const certificationStatus = ["PUBLISHED", "CLOSED"].includes(snapshot.status) && compiled?.guardStatus === "PASSED"
    ? "CERTIFIED" as const : "REJECTED" as const;
  const section = match[2]!;
  if (section === "blueprint") return immutable({ apiVersion: CLIENT_API_VERSION, id: snapshot.id, name: snapshot.name,
    revision: snapshot.revision, certificationStatus, solverStatus: compiled?.solverStatus ?? "UNKNOWN",
    participantCount: snapshot.blueprint.participantCount ?? 0, actualContestCount: compiled?.actualContestCount ?? 0,
    scheduledContestCount: compiled?.scheduledContestCount ?? 0,
    actionRequired: !["PUBLISHED", "CLOSED"].includes(snapshot.status) });
  if (section === "schedule") return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id,
    timezone: compiled?.timezone ?? "UTC", solverStatus: compiled?.solverStatus ?? "UNKNOWN", objectiveValueMinutes: null,
    lowerBoundMinutes: 0, optimalityGap: null,
    items: compiled?.schedule.map((contest) => ({ id: contest.contestId, resourceID: contest.resourceId,
      start: contest.start, end: contest.end, possibleEntrantIDs: [],
      accessibilityLabel: `${contest.contestId} on ${contest.resourceId}, ${contest.start} to ${contest.end}` })) ?? [] });
  if (section === "operations") {
    if (!snapshot.live) return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id,
      revision: 0, asOf: compiled?.compiledAt ?? new Date(0).toISOString(), timezone: compiled?.timezone ?? "UTC",
      summary: { now: 0, next: 0, late: 0, blocked: 0, unreported: 0 }, items: [] });
    const state = snapshot.live.state;
    const asOf = state.events.at(-1)?.occurredAt ?? compiled?.compiledAt ?? new Date(0).toISOString();
    const operations = deriveLiveControlRoom(state, asOf);
    const groups = [
      ...operations.now.map((contest) => ({ contest, status: "NOW" as const, statusText: "In progress", detail: "Contest is active now." })),
      ...operations.next.map((contest) => ({ contest, status: "NEXT" as const, statusText: "Up next", detail: "Entrants and assigned resource are ready." })),
      ...operations.late.map((contest) => ({ contest, status: "LATE" as const, statusText: `${contest.minutesLate} minutes late`, detail: "Scheduled start has passed and the contest has not begun." })),
      ...operations.blocked.map((contest) => ({ contest, status: "BLOCKED" as const, statusText: "Blocked",
        detail: contest.reasons.map(({ code, subjectIds }) => `${code}: ${subjectIds.join(", ")}`).join("; ") })),
      ...operations.unreported.map((contest) => ({ contest, status: "UNREPORTED" as const,
        statusText: "Result unreported", detail: "Contest is settled but its result receipt is outstanding." })),
    ];
    const definitions = new Map(state.definition.contests.map((contest) => [contest.contestId, contest]));
    return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id, revision: state.version,
      publishedRevision: snapshot.publication?.revision ?? snapshot.revision,
      operationalRevision: snapshot.live.publication?.revision ?? snapshot.publication?.revision ?? snapshot.revision,
      stateProofHash: state.proofHash,
      asOf: operations.generatedAt, timezone: compiled?.timezone ?? "UTC",
      summary: { now: operations.now.length, next: operations.next.length, late: operations.late.length,
        blocked: operations.blocked.length, unreported: operations.unreported.length },
      items: groups.map(({ contest, status, statusText, detail }) => {
        const participantIDs = [...(state.resolvedEntrants[contest.contestId]
          ?? definitions.get(contest.contestId)?.entrantIds ?? [])];
        return { id: `${status}.${contest.contestId}`, contestID: contest.contestId, status,
          title: contest.contestId, statusText, detail, resourceID: contest.courtId,
          scheduledStart: contest.scheduledStart, participantIDs,
          participantNames: participantIDs.map(entrantDisplayName),
          accessibilityLabel: `${contest.contestId}, ${statusText}, ${contest.courtId}, scheduled ${contest.scheduledStart}${detail ? `, ${detail}` : ""}` };
      }) });
  }
  if (section === "findings") return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id,
    items: compiled?.guardFindings.map((finding, index) => ({ id: `${finding.sourceCode}.${index + 1}`, code: finding.sourceCode,
      severity: ["CRITICAL", "INTEGRITY"].includes(finding.severity) ? "ERROR" as const : "WARNING" as const,
      path: finding.path, message: finding.message, accessibilityLabel: `${finding.severity}: ${finding.message}`,
      debugID: `${compiled.guardReportHash.slice(0, 12)}.${finding.sourceCode}.${index + 1}` })) ?? [] });
  return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id, status: certificationStatus,
    statement: snapshot.publication
      ? `Competition Guard ${compiled?.guardStatus}; published revision ${snapshot.publication.revision}.`
      : "No published revision.",
    certificationHash: snapshot.publication?.certificateHash ?? "pending",
    proofIDs: compiled ? { spec: compiled.specHash, graph: compiled.graphHash, schedule: compiled.scheduleHash,
      ...(compiled.simulationHash ? { simulation: compiled.simulationHash } : {}) } : {} });
}

export function createCompilerServer(options: CompilerServerOptions = {}) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const organizationId = options.organizationId ?? process.env.KRATEASY_ORGANIZATION_ID ?? "org.local";
  const serverNow = options.now ?? (() => new Date().toISOString());
  const competitionJourney = options.competitionJourney ?? new CompetitionJourney({
    ...(production ? {} : { storagePath: process.env.KRATEASY_JOURNEY_STORE ?? `${process.cwd()}/work/competition-journey.json` }),
    organizationId, ...participantTokenConfiguration(),
    ...(process.env.KRATEASY_OFFLINE_PACK_SIGNING_SEED
      ? { offlinePackSigningSeedHex: process.env.KRATEASY_OFFLINE_PACK_SIGNING_SEED } : {}),
  });
  const participantRecoveryRateLimitStore = options.participantRecoveryRateLimitStore ?? createInMemoryRateLimitStore();
  const readiness = () => options.productionReadiness?.()
    ?? compilerReadiness({ production, hasAuthorizer: Boolean(options.authorize) });

  return createServer(async (request, response) => {
    try {
      if (request.url === "/health/live" && request.method === "GET") {
        json(response, 200, options.productionLiveness?.() ?? { status: "ALIVE" });
        return;
      }
      if (request.url === "/health/ready" && request.method === "GET") {
        const report = await readiness();
        const routeTraffic = "routeTraffic" in report
          ? report.routeTraffic : report.status === "READY" || report.status === "DEGRADED";
        json(response, routeTraffic ? 200 : 503, report);
        return;
      }
      if (request.url === "/favicon.ico" && request.method === "GET") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }
      if (!production && request.url?.startsWith("/next-qr.svg") && request.method === "GET") {
        const query = new URL(request.url, "http://local.invalid").searchParams;
        const competition = query.get("competition"); const revision = query.get("revision"); const token = query.get("token");
        if (!competition || !revision || !token) { json(response, 400, { error: "participant_access_denied" }); return; }
        const host = String(request.headers.host ?? "127.0.0.1:4173");
        const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? host : "127.0.0.1:4173";
        const target = new URL(`http://${safeHost}/next`);
        target.searchParams.set("competition", competition); target.searchParams.set("revision", revision);
        target.searchParams.set("token", token);
        const svg = await QRCode.toString(target.toString(), { type: "svg", margin: 1,
          color: { dark: "#17201d", light: "#ffffff" }, errorCorrectionLevel: "M" });
        response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff" });
        response.end(svg);
        return;
      }
      if (!production && request.url?.startsWith("/next-recovery-qr.svg") && request.method === "GET") {
        const query = new URL(request.url, "http://local.invalid").searchParams;
        const competition = query.get("competition"); const revision = query.get("revision");
        if (!competition || !/^\d+$/.test(revision ?? "")) {
          json(response, 400, { error: "participant_recovery_denied" }); return;
        }
        const host = String(request.headers.host ?? "127.0.0.1:4173");
        const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? host : "127.0.0.1:4173";
        const target = new URL(`http://${safeHost}/next/recover`);
        target.searchParams.set("competition", competition); target.searchParams.set("revision", revision!);
        const svg = await QRCode.toString(target.toString(), { type: "svg", margin: 1,
          color: { dark: "#17201d", light: "#ffffff" }, errorCorrectionLevel: "M" });
        response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        response.end(svg);
        return;
      }
      if (!production && (request.url === "/next/recover" || request.url?.startsWith("/next/recover?"))
        && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        response.end(participantRecoveryHtml);
        return;
      }
      if (!production && (request.url === "/attention" || request.url?.startsWith("/attention?")) && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(participantOperationsHtml);
        return;
      }
      if (!production && (request.url === "/display" || request.url?.startsWith("/display?")) && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(venueDisplayHtml);
        return;
      }
      if (!production && request.url === "/create" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(creatorHtml);
        return;
      }
      if (!production && request.url === "/api/creation-proposal" && request.method === "POST") {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers["content-type"] ?? ""))) {
          json(response, 415, { apiVersion: "1.0", error: "unsupported_media_type" });
          return;
        }
        json(response, 200, parseCreationProposalPayload(await readJsonRequestBody(request, 65_536)));
        return;
      }
      if (!production && request.url === "/api/competition-source-preview" && request.method === "POST") {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers["content-type"] ?? ""))) {
          json(response, 415, { apiVersion: "1.0", error: "unsupported_media_type" });
          return;
        }
        const body = await readJsonRequestBody(request, 8_388_608);
        const bundle = body && typeof body === "object" && !Array.isArray(body) && "source" in body
          ? body as { source: unknown; supportingSources?: unknown }
          : null;
        if (bundle && (Object.keys(bundle).some((key) => key !== "source" && key !== "supportingSources")
          || (bundle.supportingSources !== undefined && (!Array.isArray(bundle.supportingSources) || bundle.supportingSources.length > 7))))
          throw new Error("invalid_creation_source_bundle");
        const source = parseCreationSource(bundle ? bundle.source : body);
        const supportingSources = Array.isArray(bundle?.supportingSources) ? bundle.supportingSources : [];
        const sources = [source, ...supportingSources.map(parseCreationSource)];
        const proposal = createCompetitionProposal(source); const workbench = analyseCompetitionSources(sources, serverNow());
        const accepted = workbench.sources[0]?.status === "ACCEPTED";
        const participantCount = workbench.understoodFacts.find(({ id }) => id === "entrants.total")?.value;
        json(response, 200, { ...proposal, status: accepted ? "NEEDS_INPUT" : "REJECTED",
          draftCanBeSaved: accepted, compilationCanStart: false,
          blueprint: typeof participantCount === "number" ? { ...proposal.blueprint,
            name: recognisedCompetitionName(workbench), sport: recognisedCompetitionName(workbench) ? "padel" : null,
            participantUnit: "pairs", participantCount } : proposal.blueprint,
          questions: workbench.missingDecisions.map(({ prompt }) => ({ field: "source", prompt,
            why: "The authoritative draft keeps this decision explicit and cannot compile until it is resolved.", blocking: true })),
          understood: workbench.understoodFacts.map(({ id }) => id),
          warnings: workbench.sources[0]?.findings ?? [], workbench });
        return;
      }
      if (!production && request.url === "/api/platform-demo/workspace" && request.method === "GET") {
        json(response, 200, await (await getPlatformDemo()).workspace());
        return;
      }
      if (!production && request.url === "/api/pilot-journey" && request.method === "GET") {
        json(response, 200, await pilotDemoAction("read"));
        return;
      }
      if (!production && request.method === "POST") {
        const action = /^\/api\/pilot-journey\/(publish|propose-outage|approve-outage)$/.exec(request.url ?? "")?.[1] as PilotDemoAction | undefined;
        if (action) {
          json(response, 200, await pilotDemoAction(action));
          return;
        }
      }
      if (!production && (request.url === "/api/platform-demo/privacy" || request.url === "/api/platform-demo/backup") && request.method === "GET") {
        const demo = await getPlatformDemo();
        const path = request.url.endsWith("privacy")
          ? "/v1/organizations/org.demo/privacy/user.demo-owner" : "/v1/organizations/org.demo/backup";
        const result = await demo.api.handle({ method: "GET", path, principal: demo.principal });
        json(response, result.status, result.body);
        return;
      }
      if (!production && request.url === "/api/platform-demo/commands" && request.method === "POST") {
        const demo = await getPlatformDemo();
        const result = await demo.api.handle({ method: "POST", path: "/v1/organizations/org.demo/commands", principal: demo.principal,
          ...(typeof request.headers["idempotency-key"] === "string" ? { idempotencyKey: request.headers["idempotency-key"] } : {}),
          body: await readJsonRequestBody(request) });
        json(response, result.status, result.body);
        return;
      }
      const securePilotRoute = /^\/v1\/webhooks\/[a-z0-9][a-z0-9._-]{1,99}$/.test(request.url ?? "")
        || /^\/v1\/organizations\/[^/]+\/(dashboard|commands)$/.test(request.url ?? "");
      if (options.productionPilotApi && securePilotRoute) {
        if (request.method !== "GET" && request.method !== "POST") {
          json(response, 405, { apiVersion: "1.0", error: "method_not_allowed" }, { allow: "GET, POST" });
          return;
        }
        const method = request.method === "POST" ? "POST" : "GET";
        const isWebhook = request.url?.startsWith("/v1/webhooks/") ?? false;
        const principal = isWebhook || !options.authenticatePlatform ? null : await options.authenticatePlatform(request);
        const result = await options.productionPilotApi.handle({ method, path: request.url!, headers: normalizedHeaders(request), principal,
          ...(method === "POST" ? { body: await readRequestBody(request, options.maximumRequestBodyBytes ?? 2_097_152) } : {}) });
        json(response, result.status, result.body, result.headers ?? {});
        return;
      }
      if (request.url?.startsWith("/v1/organizations/")) {
        if (!options.platformApi || !options.authenticatePlatform) {
          json(response, 503, { apiVersion: "1.0", error: "platform_authentication_not_configured" });
          return;
        }
        const principal = await options.authenticatePlatform(request);
        const method = request.method === "POST" ? "POST" : "GET";
        const result = await options.platformApi.handle({ method, path: request.url, principal,
          ...(typeof request.headers["idempotency-key"] === "string" ? { idempotencyKey: request.headers["idempotency-key"] } : {}),
          ...(method === "POST" ? { body: await readJsonRequestBody(request) } : {}) });
        json(response, result.status, result.body);
        return;
      }
      if (request.url?.startsWith("/api/") || request.url?.startsWith("/v1/")) {
        const authorized = options.authorize ? await options.authorize(request) : false;
        const access = apiAccessDecision({ production, hasAuthorizer: Boolean(options.authorize), authorized });
        if (access) {
          json(response, access.status, access.body);
          return;
        }
      }
      if (!production && request.method === "GET" && (request.url === "/player" || request.url?.startsWith("/player?")
        || request.url === "/next" || request.url?.startsWith("/next?"))) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(playerHtml);
        return;
      }
      if (!production && (request.url === "/lab" || request.url?.startsWith("/lab?")) && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(compilerHtml);
        return;
      }
      if (!production && request.url === "/demo" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(productHtml);
        return;
      }
      if (request.url === "/" && request.method === "GET") {
        if (production) {
          json(response, 503, { apiVersion: "1.0", error: "pilot_web_projection_not_configured" });
          return;
        }
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(renderCompetitionPortfolio(competitionJourney.list()));
        return;
      }
      const preflightPage = !production && /^\/competitions\/([^/?#]+)\/preflight$/.exec(request.url ?? "");
      if (preflightPage && request.method === "GET") {
        const competitionId = decodeURIComponent(preflightPage[1]!);
        const snapshot = competitionJourney.read(competitionId);
        if (!snapshot?.compiled) {
          json(response, 404, { apiVersion: "1.0", error: "journey_not_found" });
          return;
        }
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(renderCompetitionGuardPreflight({ competitionId, competitionName: snapshot.name,
          preflight: snapshot.compiled.guardPreflight }));
        return;
      }
      const journeyPage = !production && /^\/competitions\/([^/?#]+)$/.exec(request.url ?? "");
      if (journeyPage && request.method === "GET") {
        const competitionId = decodeURIComponent(journeyPage[1]!);
        if (!competitionJourney.read(competitionId)) {
          json(response, 404, { apiVersion: "1.0", error: "journey_not_found" });
          return;
        }
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        });
        response.end(competitionJourneyHtml(competitionId));
        return;
      }
      if (!production && request.url === "/v1/competition-journey" && request.method === "GET") {
        json(response, 200, { apiVersion: "1.0", items: competitionJourney.list() });
        return;
      }
      if (!production && request.url === "/v1/competition-journey/restore" && request.method === "POST") {
        const body = await readJsonRequestBody(request, 8_388_608);
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body as Record<string, unknown>).some((key) => key !== "bundle")
          || !("bundle" in body)) throw new Error("invalid_journey_command");
        json(response, 201, competitionJourney.restoreClosedBundle({ organizationId,
          bundle: (body as { bundle: Parameters<CompetitionJourney["restoreClosedBundle"]>[0]["bundle"] }).bundle }));
        return;
      }
      if (!production && request.url === "/v1/competition-journey" && request.method === "POST") {
        const body = await readJsonRequestBody(request, 8_388_608);
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body as Record<string, unknown>).some((key) => key !== "source" && key !== "supportingSources")
          || !("source" in body)) throw new Error("invalid_journey_command");
        const command = body as { source: unknown; supportingSources?: unknown };
        if (command.supportingSources !== undefined && (!Array.isArray(command.supportingSources) || command.supportingSources.length > 7))
          throw new Error("invalid_journey_command");
        json(response, 201, competitionJourney.createWithSources([parseCreationSource(command.source),
          ...(command.supportingSources ?? []).map(parseCreationSource)]));
        return;
      }
      const journeyRequestUrl = new URL(request.url ?? "/", "http://local.invalid");
      const participantProjection = !production && /^\/v1\/competition-journey\/([^/]+)\/participant-next$/.exec(journeyRequestUrl.pathname);
      if (participantProjection && request.method === "GET") {
        const expectedOperationalRevision = Number(journeyRequestUrl.searchParams.get("revision"));
        const token = journeyRequestUrl.searchParams.get("token") ?? "";
        if (!Number.isSafeInteger(expectedOperationalRevision)) throw new Error("invalid_journey_command");
        json(response, 200, competitionJourney.readParticipantNext({ organizationId,
          competitionId: decodeURIComponent(participantProjection[1]!), expectedOperationalRevision, token,
          at: serverNow() }));
        return;
      }
      const publicProjection = !production && /^\/v1\/competition-journey\/([^/]+)\/(public-live|organiser-live)$/.exec(journeyRequestUrl.pathname);
      if (publicProjection && request.method === "GET") {
        const expectedOperationalRevision = Number(journeyRequestUrl.searchParams.get("revision"));
        if (!Number.isSafeInteger(expectedOperationalRevision)) throw new Error("invalid_journey_command");
        const input = { organizationId, competitionId: decodeURIComponent(publicProjection[1]!),
          expectedOperationalRevision };
        json(response, 200, publicProjection[2] === "public-live" ? competitionJourney.readPublicLive(input)
          : competitionJourney.readOrganiserLive({ ...input, at: serverNow() }));
        return;
      }
      const manualPackProjection = !production && /^\/v1\/competition-journey\/([^/]+)\/manual-pack$/.exec(journeyRequestUrl.pathname);
      if (manualPackProjection && request.method === "GET") {
        if ([...journeyRequestUrl.searchParams.keys()].sort().join(",") !== "operational,published")
          throw new Error("invalid_journey_command");
        const expectedPublishedRevision = Number(journeyRequestUrl.searchParams.get("published"));
        const expectedOperationalRevision = Number(journeyRequestUrl.searchParams.get("operational"));
        if (!Number.isSafeInteger(expectedPublishedRevision) || !Number.isSafeInteger(expectedOperationalRevision))
          throw new Error("invalid_journey_command");
        const generatedAt = serverNow();
        const pack = competitionJourney.issueOfflineEventPack({ organizationId,
          competitionId: decodeURIComponent(manualPackProjection[1]!), expectedPublishedRevision,
          expectedOperationalRevision, expiresAt: new Date(Date.parse(generatedAt) + 8 * 60 * 60_000).toISOString() });
        const signedGeneratedAt = String((JSON.parse(Buffer.from(pack.payloadBase64, "base64").toString("utf8")) as
          Record<string, unknown>).generatedAt ?? "");
        const body = verifyOfflineEventPack(pack, pack.publicKeyBase64, signedGeneratedAt);
        const host = String(request.headers.host ?? "127.0.0.1:4173");
        const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? host : "127.0.0.1:4173";
        const html = await renderPrintableManualFallback({ body, envelope: pack, origin: `http://${safeHost}` });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        response.end(html);
        return;
      }
      const journeyApi = !production && /^\/v1\/competition-journey\/([^/?#]+)(?:\/(draft|sources|source-remove|edit-preview|edit-apply|compile|approve|live-activate|live-command|no-show-preview|no-show-approve|court-outage-preview|court-outage-approve|delay-preview|delay-approve|participant-access|participant-access-rotate|participant-access-revoke|participant-recovery-code|participant-recover|offline-pack|operational-incident|operational-transition|operational-clearance|operational-transfer|close|closure-bundle|duplicate))?(?:\?[^#]*)?$/.exec(request.url ?? "");
      if (journeyApi) {
        const competitionId = decodeURIComponent(journeyApi[1]!);
        const operation = journeyApi[2];
        if (!operation && request.method === "GET") {
          const snapshot = competitionJourney.read(competitionId);
          json(response, snapshot ? 200 : 404, snapshot ?? { apiVersion: "1.0", error: "journey_not_found" });
          return;
        }
        if (operation === "closure-bundle" && request.method === "GET") {
          const url = new URL(request.url ?? "/", "http://local.invalid");
          if ([...url.searchParams.keys()].join(",") !== "closure") throw new Error("invalid_journey_command");
          const expectedClosureHash = url.searchParams.get("closure") ?? "";
          json(response, 200, competitionJourney.exportClosedBundle({ organizationId, competitionId,
            expectedClosureHash }));
          return;
        }
        if (request.method !== "POST") {
          json(response, 405, { apiVersion: "1.0", error: "method_not_allowed" }, { allow: "GET, POST" });
          return;
        }
        const body = await readJsonRequestBody(request, operation === "sources" || operation === "draft" ? 8_388_608 : 65_536);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_journey_command");
        const command = body as Record<string, unknown>;
        if (operation === "draft") {
          if (Object.keys(command).some((key) => !["expectedDraftVersion", "source"].includes(key))
            || !Number.isSafeInteger(command.expectedDraftVersion)) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.revise(competitionId, command.expectedDraftVersion as number, parseCreationSource(command.source)));
          return;
        }
        if (operation === "sources") {
          if (Object.keys(command).some((key) => !["expectedDraftVersion", "source"].includes(key))
            || !Number.isSafeInteger(command.expectedDraftVersion)) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.addSource(competitionId, command.expectedDraftVersion as number,
            parseCreationSource(command.source)));
          return;
        }
        if (operation === "source-remove") {
          if (Object.keys(command).some((key) => !["expectedDraftVersion", "sourceId"].includes(key))
            || !Number.isSafeInteger(command.expectedDraftVersion) || typeof command.sourceId !== "string")
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.removeSource(competitionId, command.expectedDraftVersion as number,
            command.sourceId));
          return;
        }
        if (operation === "edit-preview" || operation === "edit-apply") {
          const allowed = operation === "edit-preview" ? ["expectedDraftVersion", "edits"]
            : ["expectedDraftVersion", "edits", "expectedPreviewHash"];
          if (Object.keys(command).some((key) => !allowed.includes(key)) || !Number.isSafeInteger(command.expectedDraftVersion)
            || !Array.isArray(command.edits) || !command.edits.every((edit) => edit && typeof edit === "object"
              && !Array.isArray(edit) && Object.keys(edit as Record<string, unknown>).every((key) => ["id", "value"].includes(key))
              && typeof (edit as Record<string, unknown>).id === "string" && typeof (edit as Record<string, unknown>).value === "string"))
            throw new Error("invalid_journey_command");
          if (operation === "edit-preview") {
            json(response, 200, competitionJourney.planStructuredEdit(competitionId, command.expectedDraftVersion as number,
              command.edits as Array<{ id: string; value: string }>, "local.organiser"));
          } else {
            if (typeof command.expectedPreviewHash !== "string") throw new Error("invalid_journey_command");
            json(response, 200, competitionJourney.applyStructuredEdit(competitionId, command.expectedDraftVersion as number,
              command.edits as Array<{ id: string; value: string }>, command.expectedPreviewHash, "local.organiser"));
          }
          return;
        }
        if (operation === "compile") {
          if (Object.keys(command).some((key) => key !== "expectedDraftVersion")
            || !Number.isSafeInteger(command.expectedDraftVersion)) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.compile(competitionId, command.expectedDraftVersion as number));
          return;
        }
        if (operation === "approve") {
          if (Object.keys(command).some((key) => !["expectedRevision", "acknowledgedFindingCodes"].includes(key))
            || !Number.isSafeInteger(command.expectedRevision) || !Array.isArray(command.acknowledgedFindingCodes)
            || !command.acknowledgedFindingCodes.every((value) => typeof value === "string")) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.approve(competitionId, command.expectedRevision as number,
            "local.organiser", command.acknowledgedFindingCodes as string[]));
          return;
        }
        if (operation === "live-activate") {
          if (Object.keys(command).some((key) => key !== "expectedRevision")
            || !Number.isSafeInteger(command.expectedRevision)) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.activateLive(competitionId, command.expectedRevision as number,
            "local.live-operator"));
          return;
        }
        if (operation === "close") {
          if (Object.keys(command).some((key) => !["expectedPublishedRevision", "expectedOperationalRevision",
            "expectedLiveVersion", "acknowledgedCodes"].includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision)
            || !Number.isSafeInteger(command.expectedOperationalRevision)
            || !Number.isSafeInteger(command.expectedLiveVersion) || !Array.isArray(command.acknowledgedCodes)
            || !command.acknowledgedCodes.every((code) => typeof code === "string"))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.closeCompetition({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            expectedLiveVersion: command.expectedLiveVersion as number,
            acknowledgedCodes: command.acknowledgedCodes as string[], closedBy: "local.competition-closer" }));
          return;
        }
        if (operation === "duplicate") {
          if (Object.keys(command).some((key) => !["expectedClosureHash", "name", "eventDate"].includes(key))
            || typeof command.expectedClosureHash !== "string" || typeof command.name !== "string"
            || typeof command.eventDate !== "string") throw new Error("invalid_journey_command");
          json(response, 201, competitionJourney.duplicateClosed({ organizationId, competitionId,
            expectedClosureHash: command.expectedClosureHash, name: command.name, eventDate: command.eventDate,
            createdBy: "local.organiser" }));
          return;
        }
        if (operation === "live-command") {
          if (Object.keys(command).some((key) => !["expectedRevision", "command"].includes(key))
            || !Number.isSafeInteger(command.expectedRevision)) throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.submitLiveCommand(competitionId, command.expectedRevision as number,
            parseConnectedLiveCommand(command.command, "local.live-operator", serverNow())));
          return;
        }
        if (operation === "participant-access") {
          if (Object.keys(command).some((key) => !["expectedPublishedRevision", "participantId", "expiresAt"].includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision) || typeof command.participantId !== "string"
            || typeof command.expiresAt !== "string") throw new Error("invalid_journey_command");
          json(response, 201, competitionJourney.issueParticipantAccess({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            participantId: command.participantId, expiresAt: command.expiresAt }));
          return;
        }
        if (operation === "participant-access-rotate") {
          const allowed = ["expectedPublishedRevision", "expectedOperationalRevision", "participantId", "expiresAt",
            "commandId", "reason"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision)
            || !Number.isSafeInteger(command.expectedOperationalRevision)
            || !["participantId", "expiresAt", "commandId", "reason"].every((key) => typeof command[key] === "string"))
            throw new Error("invalid_journey_command");
          json(response, 201, competitionJourney.rotateParticipantAccess({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            participantId: command.participantId as string, expiresAt: command.expiresAt as string,
            commandId: command.commandId as string, reason: command.reason as string,
            actorId: "local.communications-lead" }));
          return;
        }
        if (operation === "participant-access-revoke") {
          const allowed = ["expectedPublishedRevision", "expectedOperationalRevision", "participantId", "commandId", "reason"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision)
            || !Number.isSafeInteger(command.expectedOperationalRevision)
            || !["participantId", "commandId", "reason"].every((key) => typeof command[key] === "string"))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.revokeParticipantAccess({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            participantId: command.participantId as string, commandId: command.commandId as string,
            reason: command.reason as string, actorId: "local.communications-lead" }));
          return;
        }
        if (operation === "participant-recovery-code") {
          const allowed = ["expectedPublishedRevision", "expectedOperationalRevision", "participantId", "codeExpiresAt",
            "accessExpiresAt", "commandId"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision)
            || !Number.isSafeInteger(command.expectedOperationalRevision)
            || !["participantId", "codeExpiresAt", "accessExpiresAt", "commandId"]
              .every((key) => typeof command[key] === "string")) throw new Error("invalid_journey_command");
          json(response, 201, competitionJourney.issueParticipantRecoveryCode({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            participantId: command.participantId as string, codeExpiresAt: command.codeExpiresAt as string,
            accessExpiresAt: command.accessExpiresAt as string, commandId: command.commandId as string,
            actorId: "local.communications-lead" }));
          return;
        }
        if (operation === "participant-recover") {
          if (Object.keys(command).some((key) => !["expectedOperationalRevision", "code"].includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || typeof command.code !== "string")
            throw new Error("participant_recovery_denied");
          const clientKey = createHash("sha256").update(`${organizationId}\0${competitionId}\0${request.socket.remoteAddress ?? "unknown"}\0${request.headers["user-agent"] ?? "unknown"}`).digest("hex");
          const rate = await participantRecoveryRateLimitStore.consume({ key: `participant-recovery:${clientKey}`,
            limit: 5, windowMs: 60_000, nowMs: Date.parse(serverNow()) });
          if (!rate.allowed) {
            json(response, 429, { error: "participant_recovery_rate_limited" },
              { "retry-after": String(rate.retryAfterSeconds) });
            return;
          }
          json(response, 200, competitionJourney.recoverParticipantAccess({ organizationId, competitionId,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            code: command.code, at: serverNow() }));
          return;
        }
        if (operation === "offline-pack") {
          if (Object.keys(command).some((key) => !["expectedPublishedRevision", "expectedOperationalRevision", "expiresAt"].includes(key))
            || !Number.isSafeInteger(command.expectedPublishedRevision)
            || !Number.isSafeInteger(command.expectedOperationalRevision) || typeof command.expiresAt !== "string")
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.issueOfflineEventPack({ organizationId, competitionId,
            expectedPublishedRevision: command.expectedPublishedRevision as number,
            expectedOperationalRevision: command.expectedOperationalRevision as number,
            expiresAt: command.expiresAt }));
          return;
        }
        if (operation === "operational-incident") {
          const allowed = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "incidentId", "category",
            "severity", "acknowledgement", "location", "summary", "affectedContestIds", "affectedResourceIds",
            "affectedParticipantIds", "evidenceRefs"];
          const arrays = ["affectedContestIds", "affectedResourceIds", "affectedParticipantIds", "evidenceRefs"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedStateVersion)
            || !["commandId", "incidentId", "location", "summary"].every((key) => typeof command[key] === "string")
            || !["MEDICAL", "FIRE", "STRUCTURAL", "WEATHER", "SECURITY", "EVACUATION", "SAFEGUARDING", "SERVICE",
              "RESOURCE", "COMPETITION"].includes(String(command.category))
            || !["INFO", "MINOR", "MAJOR", "LIFE_SAFETY"].includes(String(command.severity))
            || !["UNVERIFIED", "ACKNOWLEDGED"].includes(String(command.acknowledgement))
            || !arrays.every((key) => Array.isArray(command[key])
              && (command[key] as unknown[]).every((value) => typeof value === "string")))
            throw new Error("invalid_journey_command");
          const snapshot = competitionJourney.read(competitionId);
          if (!snapshot?.live) throw new Error("journey_revision_conflict");
          json(response, 200, competitionJourney.submitOperationalCommand(competitionId,
            command.expectedOperationalRevision as number, { kind: "RECORD_INCIDENT",
              commandId: command.commandId as string, expectedVersion: command.expectedStateVersion as number,
              actorId: snapshot.live.operations.authorityAssignments.scribe, authorityFunction: "SCRIBE",
              occurredAt: serverNow(), incident: { incidentId: command.incidentId as string,
                category: command.category as never, severity: command.severity as never,
                acknowledgement: command.acknowledgement as never, location: command.location as string,
                summary: command.summary as string, affectedContestIds: command.affectedContestIds as string[],
                affectedResourceIds: command.affectedResourceIds as string[],
                affectedParticipantIds: command.affectedParticipantIds as string[], evidenceRefs: command.evidenceRefs as string[] } }));
          return;
        }
        if (operation === "operational-transition") {
          const allowed = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "targetMode", "reason",
            "sourceIncidentId", "scope"];
          const scope = command.scope as Record<string, unknown> | undefined;
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedStateVersion)
            || !["commandId", "targetMode", "reason"].every((key) => typeof command[key] === "string")
            || (command.sourceIncidentId !== undefined && typeof command.sourceIncidentId !== "string")
            || !scope || Array.isArray(scope) || Object.keys(scope).some((key) => !["kind", "ids"].includes(key))
            || !["VENUE", "RESOURCE", "CONTEST", "PARTICIPANT"].includes(String(scope.kind))
            || !Array.isArray(scope.ids) || !scope.ids.every((value) => typeof value === "string"))
            throw new Error("invalid_journey_command");
          const snapshot = competitionJourney.read(competitionId);
          if (!snapshot?.live) throw new Error("journey_revision_conflict");
          const target = command.targetMode as "NORMAL" | "DEGRADED" | "PAUSED" | "STOPPED" | "CANCELLED" | "RECOVERING";
          const functionName = target === "STOPPED" ? "SAFETY_LEAD" as const
            : target === "CANCELLED" || target === "RECOVERING"
              || (target === "NORMAL" && snapshot.live.operations.mode === "RECOVERING") ? "INCIDENT_LEAD" as const
              : "COMPETITION_LEAD" as const;
          const actorKey = functionName === "SAFETY_LEAD" ? "safetyLead"
            : functionName === "INCIDENT_LEAD" ? "incidentLead" : "competitionLead";
          const publicMessageCode = { NORMAL: "PLAY_RESUMED_CHECK_NEXT", DEGRADED: "SERVICE_DEGRADED_USE_VENUE_BOARD",
            PAUSED: "PLAY_PAUSED_STAY_CLEAR", STOPPED: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS",
            CANCELLED: "EVENT_CANCELLED_AWAIT_CONTACT", RECOVERING: "RECOVERY_IN_PROGRESS_AWAIT_UPDATE" }[target] as
            "PLAY_RESUMED_CHECK_NEXT" | "SERVICE_DEGRADED_USE_VENUE_BOARD" | "PLAY_PAUSED_STAY_CLEAR"
            | "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS" | "EVENT_CANCELLED_AWAIT_CONTACT"
            | "RECOVERY_IN_PROGRESS_AWAIT_UPDATE";
          const occurredAt = serverNow();
          const needsUpdate = target === "PAUSED" || target === "STOPPED" || target === "RECOVERING";
          json(response, 200, competitionJourney.submitOperationalCommand(competitionId,
            command.expectedOperationalRevision as number, { kind: "TRANSITION_MODE",
              commandId: command.commandId as string, expectedVersion: command.expectedStateVersion as number,
              actorId: snapshot.live.operations.authorityAssignments[actorKey], authorityFunction: functionName,
              occurredAt, targetMode: target, reason: command.reason as string,
              ...(command.sourceIncidentId ? { sourceIncidentId: command.sourceIncidentId as string } : {}),
              publicMessageCode,
              ...(needsUpdate ? { nextUpdateAt: new Date(Date.parse(occurredAt) + 10 * 60_000).toISOString() } : {}),
              scope: { kind: scope.kind as never, ids: scope.ids as string[] } }));
          return;
        }
        if (operation === "operational-clearance") {
          const allowed = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "clearance", "statement",
            "evidenceRefs"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedStateVersion)
            || typeof command.commandId !== "string" || !["SAFETY", "COMPETITION"].includes(String(command.clearance))
            || typeof command.statement !== "string" || !Array.isArray(command.evidenceRefs)
            || !command.evidenceRefs.every((value) => typeof value === "string")) throw new Error("invalid_journey_command");
          const snapshot = competitionJourney.read(competitionId);
          if (!snapshot?.live) throw new Error("journey_revision_conflict");
          const isSafety = command.clearance === "SAFETY";
          json(response, 200, competitionJourney.submitOperationalCommand(competitionId,
            command.expectedOperationalRevision as number, { kind: "RECORD_RESTART_CLEARANCE",
              commandId: command.commandId, expectedVersion: command.expectedStateVersion as number,
              actorId: isSafety ? snapshot.live.operations.authorityAssignments.safetyLead
                : snapshot.live.operations.authorityAssignments.competitionLead,
              authorityFunction: isSafety ? "SAFETY_LEAD" : "COMPETITION_LEAD", occurredAt: serverNow(),
              clearance: command.clearance as "SAFETY" | "COMPETITION", statement: command.statement,
              evidenceRefs: command.evidenceRefs as string[] }));
          return;
        }
        if (operation === "operational-transfer") {
          const allowed = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "transferredFunction",
            "newActorId", "reason", "evidenceRefs"];
          const functions = ["INCIDENT_LEAD", "COMPETITION_LEAD", "SAFETY_LEAD", "COMMUNICATIONS_LEAD", "SCRIBE"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedStateVersion)
            || typeof command.commandId !== "string" || !functions.includes(String(command.transferredFunction))
            || typeof command.newActorId !== "string" || typeof command.reason !== "string"
            || !Array.isArray(command.evidenceRefs) || !command.evidenceRefs.every((value) => typeof value === "string"))
            throw new Error("invalid_journey_command");
          const snapshot = competitionJourney.read(competitionId);
          if (!snapshot?.live) throw new Error("journey_revision_conflict");
          const functionName = command.transferredFunction as "INCIDENT_LEAD" | "COMPETITION_LEAD" | "SAFETY_LEAD"
            | "COMMUNICATIONS_LEAD" | "SCRIBE";
          const actorKey = { INCIDENT_LEAD: "incidentLead", COMPETITION_LEAD: "competitionLead",
            SAFETY_LEAD: "safetyLead", COMMUNICATIONS_LEAD: "communicationsLead", SCRIBE: "scribe" }[functionName] as
            "incidentLead" | "competitionLead" | "safetyLead" | "communicationsLead" | "scribe";
          json(response, 200, competitionJourney.submitOperationalCommand(competitionId,
            command.expectedOperationalRevision as number, { kind: "TRANSFER_AUTHORITY",
              commandId: command.commandId, expectedVersion: command.expectedStateVersion as number,
              actorId: snapshot.live.operations.authorityAssignments[actorKey], authorityFunction: functionName,
              occurredAt: serverNow(), transferredFunction: functionName, newActorId: command.newActorId,
              reason: command.reason, evidenceRefs: command.evidenceRefs as string[] }));
          return;
        }
        if (operation === "no-show-preview") {
          const allowed = ["expectedRevision", "expectedLiveVersion", "proposalId", "contestId", "entrantId", "reason"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedRevision) || !Number.isSafeInteger(command.expectedLiveVersion)
            || !["proposalId", "contestId", "entrantId", "reason"].every((key) => typeof command[key] === "string"))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.proposeNoShow(competitionId, command.expectedRevision as number,
            command.expectedLiveVersion as number, { proposalId: command.proposalId as string,
              contestId: command.contestId as string, entrantId: command.entrantId as string,
              reason: command.reason as string, proposedBy: "local.live-operator", proposedAt: serverNow() }));
          return;
        }
        if (operation === "no-show-approve") {
          if (Object.keys(command).some((key) => !["expectedRevision", "expectedProposalHash", "strategy"].includes(key))
            || !Number.isSafeInteger(command.expectedRevision) || typeof command.expectedProposalHash !== "string"
            || !["KEEP_ANNOUNCED_SLOTS", "RELEASE_WALKOVER_SLOTS"].includes(String(command.strategy)))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.approveNoShow(competitionId, command.expectedRevision as number,
            command.expectedProposalHash, command.strategy as "KEEP_ANNOUNCED_SLOTS" | "RELEASE_WALKOVER_SLOTS",
            "local.tournament-director", serverNow()));
          return;
        }
        if (operation === "court-outage-preview") {
          const allowed = ["expectedOperationalRevision", "expectedLiveVersion", "proposalId", "courtId", "reason", "expectedReopenAt"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedLiveVersion)
            || !["proposalId", "courtId", "reason", "expectedReopenAt"].every((key) => typeof command[key] === "string"))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.proposeCourtOutage(competitionId,
            command.expectedOperationalRevision as number, command.expectedLiveVersion as number,
            { proposalId: command.proposalId as string, courtId: command.courtId as string,
              reason: command.reason as string, expectedReopenAt: command.expectedReopenAt as string,
              proposedBy: "local.live-operator", proposedAt: serverNow() }));
          return;
        }
        if (operation === "court-outage-approve") {
          if (Object.keys(command).some((key) => !["expectedOperationalRevision", "expectedProposalHash"].includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || typeof command.expectedProposalHash !== "string")
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.approveCourtOutage(competitionId,
            command.expectedOperationalRevision as number, command.expectedProposalHash,
            "local.tournament-director", serverNow()));
          return;
        }
        if (operation === "delay-preview") {
          const allowed = ["expectedOperationalRevision", "expectedLiveVersion", "proposalId", "contestId", "reason", "expectedEndAt"];
          if (Object.keys(command).some((key) => !allowed.includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || !Number.isSafeInteger(command.expectedLiveVersion)
            || !["proposalId", "contestId", "reason", "expectedEndAt"].every((key) => typeof command[key] === "string"))
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.proposeDelayOverrun(competitionId,
            command.expectedOperationalRevision as number, command.expectedLiveVersion as number,
            { proposalId: command.proposalId as string, contestId: command.contestId as string,
              reason: command.reason as string, expectedEndAt: command.expectedEndAt as string,
              proposedBy: "local.live-operator", proposedAt: serverNow() }));
          return;
        }
        if (operation === "delay-approve") {
          if (Object.keys(command).some((key) => !["expectedOperationalRevision", "expectedProposalHash"].includes(key))
            || !Number.isSafeInteger(command.expectedOperationalRevision) || typeof command.expectedProposalHash !== "string")
            throw new Error("invalid_journey_command");
          json(response, 200, competitionJourney.approveDelayOverrun(competitionId,
            command.expectedOperationalRevision as number, command.expectedProposalHash,
            "local.tournament-director", serverNow()));
          return;
        }
      }
      if (!production && request.url === "/api/interpret" && request.method === "POST") {
        json(response, 200, interpretApiPayload(await readJsonRequestBody(request)));
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/v1/")) {
        const authorized = options.authorize ? await options.authorize(request) : false;
        const access = apiAccessDecision({ production, hasAuthorizer: Boolean(options.authorize), authorized });
        if (access) {
          json(response, access.status, access.body);
          return;
        }
        const value = journeyClientApiResponse(request.url, competitionJourney);
        if (value !== undefined) json(response, 200, value);
        else json(response, 404, { error: "not_found" });
        return;
      }
      if (!production && (request.url === "/api/demo" || request.url === "/api/workspace") && request.method === "GET") {
        const workspace = compilerWorkspace();
        const { scenario } = workspace;
        if (request.url === "/api/workspace") json(response, 200, workspace);
        else json(response, 200, {
          certification: scenario.certification,
          solverAudit: scenario.schedule.audit,
          graph: { nodes: scenario.graph.nodes.length, actualContests: scenario.graph.generatedActualContestCount, edges: scenario.graph.edges.length },
          operationalRisk: workspace.operationalRisk,
          capabilities: workspace.capabilities,
        });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      json(response, message === "request_too_large" ? 413 : 400, { error: message });
    }
  });
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "127.0.0.1";
  createCompilerServer().listen(port, host, () => console.log(`TournamentOS Studio: http://${host}:${port}`));
}

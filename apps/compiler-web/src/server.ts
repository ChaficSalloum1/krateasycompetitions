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
import { parseCreationProposalPayload } from "./creation-proposal.js";
import { CompetitionJourney, competitionJourneyHtml, parseConnectedLiveCommand, parseCreationSource } from "./competition-journey.js";
import { playerHtml } from "./player-view.js";
import { participantOperationsHtml, venueDisplayHtml } from "./attention-views.js";
import { createPlatformDemo } from "./platform-demo.js";
import type { ProductionPilotApi } from "./production-pilot-api.js";

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
}

function normalizedHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) result[name] = Array.isArray(value) ? value.join(",") : value;
  return result;
}

let platformDemo: ReturnType<typeof createPlatformDemo> | undefined;
const getPlatformDemo = () => platformDemo ??= createPlatformDemo();
export type PilotDemoAction = "read" | "publish" | "propose-outage" | "approve-outage";

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
    const reference = compilerClientApi().portfolio;
    return immutable({ ...reference, items: [
      ...snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, revision: snapshot.revision,
        certificationStatus: snapshot.status === "PUBLISHED" && snapshot.compiled?.guardStatus === "PASSED"
          ? "CERTIFIED" as const : "REJECTED" as const })),
      ...reference.items.filter(({ id }) => !snapshots.some((snapshot) => snapshot.id === id)),
    ] });
  }
  const match = /^\/v1\/tournaments\/([^/]+)\/(blueprint|schedule|operations|findings|certification)$/.exec(path);
  if (!match) return undefined;
  const snapshot = journey.read(decodeURIComponent(match[1]!));
  if (!snapshot) return undefined;
  const compiled = snapshot.compiled;
  const certificationStatus = snapshot.status === "PUBLISHED" && compiled?.guardStatus === "PASSED"
    ? "CERTIFIED" as const : "REJECTED" as const;
  const section = match[2]!;
  if (section === "blueprint") return immutable({ apiVersion: CLIENT_API_VERSION, id: snapshot.id, name: snapshot.name,
    revision: snapshot.revision, certificationStatus, solverStatus: compiled?.solverStatus ?? "UNKNOWN",
    participantCount: snapshot.blueprint.participantCount ?? 0, actualContestCount: compiled?.actualContestCount ?? 0,
    scheduledContestCount: compiled?.scheduledContestCount ?? 0, actionRequired: snapshot.status !== "PUBLISHED" });
  if (section === "schedule") return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id,
    timezone: "Asia/Beirut", solverStatus: compiled?.solverStatus ?? "UNKNOWN", objectiveValueMinutes: null,
    lowerBoundMinutes: 0, optimalityGap: null,
    items: compiled?.schedule.map((contest) => ({ id: contest.contestId, resourceID: contest.resourceId,
      start: contest.start, end: contest.end, possibleEntrantIDs: [],
      accessibilityLabel: `${contest.contestId} on ${contest.resourceId}, ${contest.start} to ${contest.end}` })) ?? [] });
  if (section === "operations") return immutable({ apiVersion: CLIENT_API_VERSION, tournamentID: snapshot.id,
    revision: snapshot.revision, asOf: compiled?.compiledAt ?? new Date(0).toISOString(), timezone: "Asia/Beirut",
    summary: { now: 0, next: 0, late: 0, blocked: 0, unreported: 0 }, items: [] });
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
    organizationId, ...(process.env.KRATEASY_PARTICIPANT_TOKEN_SECRET
      ? { participantTokenSecret: process.env.KRATEASY_PARTICIPANT_TOKEN_SECRET } : {}),
  });
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
      if ((request.url === "/lab" || request.url?.startsWith("/lab?")) && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(compilerHtml);
        return;
      }
      if (request.url === "/" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(productHtml);
        return;
      }
      const journeyPage = !production && /^\/competitions\/([^/?#]+)$/.exec(request.url ?? "");
      if (journeyPage && request.method === "GET") {
        const competitionId = decodeURIComponent(journeyPage[1]!);
        if (competitionJourney.read(competitionId)?.status !== "PUBLISHED") {
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
      if (!production && request.url === "/v1/competition-journey" && request.method === "POST") {
        const body = await readJsonRequestBody(request, 65_536);
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body as Record<string, unknown>).some((key) => key !== "source")
          || !("source" in body)) throw new Error("invalid_journey_command");
        json(response, 201, competitionJourney.create(parseCreationSource((body as { source: unknown }).source)));
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
      const journeyApi = !production && /^\/v1\/competition-journey\/([^/?#]+)(?:\/(draft|sources|edit-preview|edit-apply|compile|approve|live-activate|live-command|no-show-preview|no-show-approve|participant-access))?$/.exec(request.url ?? "");
      if (journeyApi) {
        const competitionId = decodeURIComponent(journeyApi[1]!);
        const operation = journeyApi[2];
        if (!operation && request.method === "GET") {
          const snapshot = competitionJourney.read(competitionId);
          json(response, snapshot ? 200 : 404, snapshot ?? { apiVersion: "1.0", error: "journey_not_found" });
          return;
        }
        if (request.method !== "POST") {
          json(response, 405, { apiVersion: "1.0", error: "method_not_allowed" }, { allow: "GET, POST" });
          return;
        }
        const body = await readJsonRequestBody(request, 65_536);
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
      }
      if (request.url === "/api/interpret" && request.method === "POST") {
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
        const value = journeyClientApiResponse(request.url, competitionJourney) ?? clientApiResponse(request.url);
        if (value !== undefined) json(response, 200, value);
        else json(response, 404, { error: "not_found" });
        return;
      }
      if ((request.url === "/api/demo" || request.url === "/api/workspace") && request.method === "GET") {
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

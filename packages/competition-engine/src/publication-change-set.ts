import { canonicalHash, deepFreeze, semanticDiff, type SemanticChange } from "@tournament-os/tournament-schema";

interface PublicationScheduleContest {
  readonly contestId: string;
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
}

interface PublicationSchedule {
  readonly contests: readonly PublicationScheduleContest[];
}

export interface ReviewedPublicationImpact {
  readonly previewHash: string;
  readonly semanticChanges: readonly SemanticChange[];
  readonly operationalImpact: readonly string[];
}

export interface PublicationOperationalChangeSet {
  readonly addedContestIds: readonly string[];
  readonly removedContestIds: readonly string[];
  readonly reassignedContestIds: readonly string[];
  readonly retimedContestIds: readonly string[];
  readonly durationChangedContestIds: readonly string[];
}

export interface PublicationChangeSet {
  readonly schemaVersion: "1.0.0";
  readonly fromRevision: number | null;
  readonly toRevision: number;
  readonly previousDefinitionHash: string | null;
  readonly definitionHash: string;
  readonly specHash: string;
  readonly scheduleHash: string;
  readonly semanticChanges: readonly SemanticChange[];
  readonly operationalChanges: PublicationOperationalChangeSet;
  readonly reviewedImpact: ReviewedPublicationImpact | null;
  readonly changeSetHash: string;
}

export interface PublicationChangeSetInput {
  readonly fromRevision: number | null;
  readonly toRevision: number;
  readonly previousDefinition?: unknown;
  readonly definition: unknown;
  readonly specHash: string;
  readonly previousSchedule?: PublicationSchedule;
  readonly schedule: PublicationSchedule;
  readonly reviewedImpact?: ReviewedPublicationImpact;
}

function scheduleIndex(schedule: PublicationSchedule | undefined): Map<string, PublicationScheduleContest> {
  const index = new Map<string, PublicationScheduleContest>();
  for (const contest of schedule?.contests ?? []) {
    if (!contest.contestId.trim() || index.has(contest.contestId)) throw new Error("Publication change set requires unique contest identities");
    index.set(contest.contestId, contest);
  }
  return index;
}

export function createPublicationChangeSet(input: PublicationChangeSetInput): Readonly<PublicationChangeSet> {
  if (!Number.isInteger(input.toRevision) || input.toRevision < 1
    || (input.fromRevision !== null && (!Number.isInteger(input.fromRevision) || input.fromRevision < 1
      || input.toRevision !== input.fromRevision + 1))) {
    throw new Error("Publication change set revisions must be consecutive");
  }
  if ((input.fromRevision === null) !== (input.previousDefinition === undefined)
    || (input.fromRevision === null) !== (input.previousSchedule === undefined)) {
    throw new Error("Publication change set requires the complete previous revision or no previous revision");
  }
  if (!/^[a-f0-9]{64}$/.test(input.specHash)) throw new Error("Publication change set spec hash is invalid");
  if (input.reviewedImpact && !/^[a-f0-9]{64}$/.test(input.reviewedImpact.previewHash)) {
    throw new Error("Publication change set reviewed preview hash is invalid");
  }

  const before = scheduleIndex(input.previousSchedule);
  const after = scheduleIndex(input.schedule);
  const beforeIds = [...before.keys()].sort();
  const afterIds = [...after.keys()].sort();
  const shared = afterIds.filter((id) => before.has(id));
  const operationalChanges: PublicationOperationalChangeSet = {
    addedContestIds: afterIds.filter((id) => !before.has(id)),
    removedContestIds: beforeIds.filter((id) => !after.has(id)),
    reassignedContestIds: shared.filter((id) => before.get(id)!.resourceId !== after.get(id)!.resourceId),
    retimedContestIds: shared.filter((id) => before.get(id)!.start !== after.get(id)!.start),
    durationChangedContestIds: shared.filter((id) => {
      const prior = before.get(id)!; const current = after.get(id)!;
      return Date.parse(prior.end) - Date.parse(prior.start) !== Date.parse(current.end) - Date.parse(current.start);
    }),
  };
  const body = {
    schemaVersion: "1.0.0" as const,
    fromRevision: input.fromRevision,
    toRevision: input.toRevision,
    previousDefinitionHash: input.previousDefinition === undefined ? null : canonicalHash(input.previousDefinition),
    definitionHash: canonicalHash(input.definition),
    specHash: input.specHash,
    scheduleHash: canonicalHash(input.schedule),
    semanticChanges: semanticDiff(input.previousDefinition ?? null, input.definition),
    operationalChanges,
    reviewedImpact: input.reviewedImpact ? structuredClone(input.reviewedImpact) : null,
  };
  return deepFreeze({ ...body, changeSetHash: canonicalHash(body) });
}

export function verifyPublicationChangeSet(changeSet: PublicationChangeSet): boolean {
  const { changeSetHash, ...body } = changeSet;
  return canonicalHash(body) === changeSetHash;
}

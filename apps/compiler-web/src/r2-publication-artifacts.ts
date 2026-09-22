import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AuthoritativePublicationArtifactResolver, AuthoritativePublicationArtifacts } from "@tournament-os/competition-engine";

export interface PublicationArtifactObjectStore {
  /** Returns the stored body, or null when the key does not exist. Any other failure must throw, never swallow. */
  getObject(key: string): Promise<string | null>;
  putObject(key: string, body: string): Promise<void>;
}

export interface R2PublicationArtifactStoreOptions {
  readonly bucket: string;
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injection seam for tests; defaults to a real Cloudflare R2 (S3-compatible) client. */
  readonly store?: PublicationArtifactObjectStore;
}

export interface PublicationArtifactStore extends AuthoritativePublicationArtifactResolver {
  save(artifacts: Readonly<AuthoritativePublicationArtifacts>): Promise<void>;
}

const segmentPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function requireSegment(value: string, name: string): string {
  if (!segmentPattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

export function artifactObjectKey(input: {
  readonly organizationId: string; readonly tournamentId: string; readonly tournamentRevision: number;
}): string {
  if (!Number.isSafeInteger(input.tournamentRevision) || input.tournamentRevision < 1) {
    throw new Error("tournamentRevision is invalid");
  }
  return `publication-artifacts/${requireSegment(input.organizationId, "organizationId")}/`
    + `${requireSegment(input.tournamentId, "tournamentId")}/v${input.tournamentRevision}.json`;
}

export function createR2ObjectStore(options: {
  readonly bucket: string; readonly accountId: string; readonly accessKeyId: string; readonly secretAccessKey: string;
}): PublicationArtifactObjectStore {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return {
    async getObject(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
        return (await response.Body?.transformToString("utf8")) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        if (error instanceof Error && error.name === "NotFound") return null;
        throw error;
      }
    },
    async putObject(key, body) {
      await client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, ContentType: "application/json" }));
    },
  };
}

/**
 * Durable, content-verified storage for authoritative publication artifacts.
 * `load` is the boundary `PUBLISH_TOURNAMENT` calls to independently re-derive
 * the Guard report before publication (see platform.ts); it must never return
 * an artifact set for a different organisation, tournament or revision than
 * requested, so every load re-checks that binding even though the object key
 * already encodes it -- a wrong key must fail closed, not trust the path.
 */
export function createR2PublicationArtifactStore(options: R2PublicationArtifactStoreOptions): PublicationArtifactStore {
  const store = options.store ?? createR2ObjectStore(options);
  return {
    async load(input) {
      const key = artifactObjectKey(input);
      const body = await store.getObject(key);
      if (body === null) return undefined;
      const parsed = JSON.parse(body) as AuthoritativePublicationArtifacts;
      if (parsed.organizationId !== input.organizationId || parsed.tournamentId !== input.tournamentId
        || parsed.tournamentRevision !== input.tournamentRevision) {
        throw new Error("publication_artifact_binding_mismatch");
      }
      return parsed;
    },
    async save(artifacts) {
      const key = artifactObjectKey(artifacts);
      await store.putObject(key, JSON.stringify(artifacts));
    },
  };
}

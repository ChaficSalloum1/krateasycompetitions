import type { IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";
import type { PlatformApiPrincipal } from "@tournament-os/competition-engine";

export interface ClerkAuthenticationOptions {
  /** Clerk backend secret key (`sk_live_...` / `sk_test_...`). Never accept it from a request. */
  readonly secretKey: string;
  readonly authorizedParties?: readonly string[];
  /** Injection seam for tests; defaults to a real Clerk `verifyToken` call. */
  readonly verify?: (token: string) => Promise<Record<string, unknown>>;
}

const bearerPattern = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export function bearerTokenFrom(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = bearerPattern.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Maps verified Clerk claims to the platform's tenant principal. Every
 * consequential action in this product is organisation-scoped (see the
 * master specification's tenant-isolation invariant), so a session with no
 * active Clerk organisation carries no authority here and is rejected
 * rather than falling back to a personal-account identity.
 */
export function principalFromClerkClaims(claims: Record<string, unknown> | null | undefined): PlatformApiPrincipal | null {
  if (!claims) return null;
  const userId = claims.sub;
  const organizationId = claims.org_id;
  if (typeof userId !== "string" || !userId.trim()) return null;
  if (typeof organizationId !== "string" || !organizationId.trim()) return null;
  return { organizationId, userId };
}

/**
 * Builds an `authenticatePlatform` function for `createCompilerServer` /
 * `ProductionAdapters.authenticate` backed by real Clerk session
 * verification. Fails closed (returns null) on a missing, malformed,
 * expired, forged or organisation-less token; it never throws past this
 * boundary and never trusts a client-supplied organisation id.
 */
export function createClerkPlatformAuthenticator(options: ClerkAuthenticationOptions):
  (request: IncomingMessage) => Promise<PlatformApiPrincipal | null> {
  if (!/^sk_(live|test)_/.test(options.secretKey)) throw new Error("clerk_secret_key_invalid");
  const verify = options.verify ?? (async (token: string) => {
    const payload = await verifyToken(token, {
      secretKey: options.secretKey,
      authorizedParties: options.authorizedParties ? [...options.authorizedParties] : undefined,
    });
    return payload as unknown as Record<string, unknown>;
  });
  return async (request: IncomingMessage): Promise<PlatformApiPrincipal | null> => {
    const token = bearerTokenFrom(request);
    if (!token) return null;
    try {
      return principalFromClerkClaims(await verify(token));
    } catch {
      return null;
    }
  };
}

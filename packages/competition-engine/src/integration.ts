import type { Certification, ContestResult, Entrant } from "./types.js";

export interface ExternalIdentityReference { provider: string; externalPlayerId: string; externalRatingId?: string; }
export interface PublicationEnvelope {
  specHash: string;
  certificationHash: string;
  participants: Array<{ competitionEntrantId: string; members: ExternalIdentityReference[] }>;
  results: ContestResult[];
}

export function createPublicationEnvelope(
  certification: Certification,
  entrants: Entrant[],
  identities: Record<string, ExternalIdentityReference>,
  results: ContestResult[],
): PublicationEnvelope {
  if (certification.status !== "CERTIFIED") throw new Error("Only certified tournament truth may cross the integration boundary");
  return {
    specHash: certification.specHash, certificationHash: certification.certificationHash,
    participants: entrants.map((entrant) => ({ competitionEntrantId: entrant.id, members: entrant.memberIds.map((id) => {
      const identity = identities[id]; if (!identity) throw new Error(`Missing external identity for ${id}`); return identity;
    }) })),
    results,
  };
}

import { canonicalHash } from "@tournament-os/tournament-schema";
import type { Entrant } from "./types.js";

/** Independent verifier: does not import the draw producer, its evaluations or proof assertions. */
export function assurePlacement(input: {
  qualifiers: readonly Entrant[]; slots: readonly (string | null)[]; protectedSeedCount: number;
  priorMeetings: readonly (readonly [string, string])[];
  avoidSamePool: boolean; avoidPriorOpponent: boolean;
}) {
  const { qualifiers, slots } = input;
  const findings: { code: string; message: string; entries: string[] }[] = [];
  const add = (code: string, message: string, entries: string[] = []) => findings.push({ code, message, entries });
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, qualifiers.length)));
  const actual = slots.filter((x): x is string => x !== null);
  if (slots.length !== size) add("SLOT_COUNT", `Expected ${size} slots; received ${slots.length}.`);
  if (new Set(qualifiers.map(x => x.id)).size !== qualifiers.length) add("DUPLICATE_QUALIFIER", "Qualification identities must be unique.");
  for (const entry of qualifiers) {
    const count = actual.filter(id => id === entry.id).length;
    if (count !== 1) add("QUALIFIER_MULTIPLICITY", `${entry.id} occupies ${count} slots; expected one.`, [entry.id]);
  }
  for (const id of actual) if (!qualifiers.some(e => e.id === id)) add("NON_QUALIFIER", `${id} did not qualify.`, [id]);
  const byes = slots.filter(x => x === null).length;
  if (byes !== size - qualifiers.length) add("BYE_COUNT", `Expected ${size - qualifiers.length} byes; received ${byes}.`);
  const seeds = [...qualifiers].sort((a,b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));
  if (seeds.some((e,i) => e.seed !== i + 1)) add("INVALID_SEEDS", "An exact, consecutive seed assignment is required.");
  for (let tier = 2; tier <= input.protectedSeedCount; tier *= 2) {
    const sections = seeds.slice(0,tier).map(e => Math.floor(slots.indexOf(e.id) / (size / tier)));
    if (new Set(sections).size !== tier) add("SEED_PROTECTION", `Top ${tier} seeds share a protected section.`, seeds.slice(0,tier).map(e=>e.id));
  }
  for (const entry of seeds.slice(0,size - qualifiers.length)) {
    const at = slots.indexOf(entry.id);
    if (at < 0 || slots[at ^ 1] !== null) add("PROTECTED_BYE", `${entry.id} must receive a bye.`, [entry.id]);
  }
  for (let i=0; i<slots.length; i+=2) {
    const a=slots[i], b=slots[i+1];
    if (a === null && b === null) add("EMPTY_CONTEST", `Opening contest ${i/2+1} contains two byes.`);
    if (!a || !b) continue;
    const ea=qualifiers.find(e=>e.id===a), eb=qualifiers.find(e=>e.id===b);
    if (input.avoidSamePool && ea?.poolId && ea.poolId === eb?.poolId) add("SAME_POOL_REMATCH", `${a} and ${b} came from ${ea.poolId}.`, [a,b]);
    if (input.avoidPriorOpponent && input.priorMeetings.some(([x,y])=>(x===a&&y===b)||(x===b&&y===a))) add("PRIOR_OPPONENT", `${a} and ${b} have already met.`, [a,b]);
  }
  return { status: findings.length ? "BLOCKED" as const : "READY" as const, findings, proofHash: canonicalHash({ input, findings }) };
}

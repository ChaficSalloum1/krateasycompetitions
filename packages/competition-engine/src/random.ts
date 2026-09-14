import { createHash } from "node:crypto";

export interface RandomSource { next(): number; int(maxExclusive: number): number; }

export type RegisteredRandomAlgorithm = "xoshiro128ss" | "pcg32";
export interface RegisteredRandomSource extends RandomSource {
  readonly metadata: Readonly<{ algorithm: RegisteredRandomAlgorithm; version: "1.0.0"; seedHash: string }>;
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;
const rotateLeft32 = (value: number, shift: number): number => ((value << shift) | (value >>> (32 - shift))) >>> 0;

function boundedInt(nextUint32: () => number, maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new Error("Random integer bound must be a positive integer no greater than 2^32");
  }
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  let value: number;
  do value = nextUint32(); while (value >= limit);
  return value % maxExclusive;
}

/**
 * Versioned random algorithms used when the TournamentSpec names an algorithm.
 * Version 1 seeds both algorithms from SHA-256(seed) in little-endian order.
 */
export function createRegisteredRandomSource(input: { readonly algorithm: RegisteredRandomAlgorithm; readonly seed: string }): RegisteredRandomSource {
  if (!input.seed.trim()) throw new Error("Registered random source requires a non-empty seed");
  const bytes = createHash("sha256").update(input.seed).digest();
  const metadata = Object.freeze({ algorithm: input.algorithm, version: "1.0.0" as const, seedHash: bytes.toString("hex") });
  let nextUint32: () => number;
  if (input.algorithm === "xoshiro128ss") {
    const state: number[] = [0, 4, 8, 12].map((offset) => bytes.readUInt32LE(offset));
    const allZero = state.reduce((zero, value) => zero && value === 0, true);
    if (allZero) state[0] = 1;
    nextUint32 = () => {
      const result = Math.imul(rotateLeft32(Math.imul(state[1]!, 5) >>> 0, 7), 9) >>> 0;
      const shifted = state[1]! << 9;
      state[2] = (state[2]! ^ state[0]!) >>> 0;
      state[3] = (state[3]! ^ state[1]!) >>> 0;
      state[1] = (state[1]! ^ state[2]!) >>> 0;
      state[0] = (state[0]! ^ state[3]!) >>> 0;
      state[2] = (state[2]! ^ shifted) >>> 0;
      state[3] = rotateLeft32(state[3]!, 11);
      return result;
    };
  } else if (input.algorithm === "pcg32") {
    const mask = (1n << 64n) - 1n;
    const multiplier = 6364136223846793005n;
    let state = 0n;
    const increment = ((bytes.readBigUInt64LE(8) << 1n) | 1n) & mask;
    const initialState = bytes.readBigUInt64LE(0);
    const step = (): number => {
      const previous = state;
      state = (previous * multiplier + increment) & mask;
      const xorshifted = Number((((previous >> 18n) ^ previous) >> 27n) & 0xffff_ffffn) >>> 0;
      const rotation = Number(previous >> 59n);
      return ((xorshifted >>> rotation) | (xorshifted << ((-rotation) & 31))) >>> 0;
    };
    step(); state = (state + initialState) & mask; step();
    nextUint32 = step;
  } else {
    throw new Error("Unregistered random algorithm");
  }
  return {
    metadata,
    nextUint32,
    next: () => nextUint32() / UINT32_RANGE,
    int: (maxExclusive) => boundedInt(nextUint32, maxExclusive),
  };
}

export function deterministicRandom(seed: string): RandomSource {
  const bytes = createHash("sha256").update(seed).digest();
  let state = bytes.readUInt32LE(0) || 0x9e3779b9;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  return { next, int: (maxExclusive) => Math.floor(next() * maxExclusive) };
}

export function shuffle<T>(values: readonly T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = random.int(index + 1);
    [result[index], result[selected]] = [result[selected]!, result[index]!];
  }
  return result;
}

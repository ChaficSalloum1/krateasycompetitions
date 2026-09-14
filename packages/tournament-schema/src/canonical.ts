import { createHash } from "node:crypto";

function normalise(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalise(entry, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Canonical JSON rejects cyclic values");
    seen.add(value);
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw new TypeError(`Canonical JSON rejects undefined at ${key}`);
      result[key] = normalise(source[key], seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalise(value, new Set()));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalStringify(value));
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

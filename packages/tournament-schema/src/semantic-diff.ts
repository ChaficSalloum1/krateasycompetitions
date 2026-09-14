import type { SemanticChange } from "./types.js";

const escapePointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

function walk(before: unknown, after: unknown, path: string, changes: SemanticChange[]): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const size = Math.max(before.length, after.length);
    for (let index = 0; index < size; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= before.length) changes.push({ operation: "add", path: childPath, after: after[index] });
      else if (index >= after.length) changes.push({ operation: "remove", path: childPath, before: before[index] });
      else walk(before[index], after[index], childPath, changes);
    }
    return;
  }
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const childPath = `${path}/${escapePointer(key)}`;
      if (!(key in left)) changes.push({ operation: "add", path: childPath, after: right[key] });
      else if (!(key in right)) changes.push({ operation: "remove", path: childPath, before: left[key] });
      else walk(left[key], right[key], childPath, changes);
    }
    return;
  }
  changes.push({ operation: "replace", path: path || "/", before, after });
}

export function semanticDiff(before: unknown, after: unknown): SemanticChange[] {
  const changes: SemanticChange[] = [];
  walk(before, after, "", changes);
  return changes;
}

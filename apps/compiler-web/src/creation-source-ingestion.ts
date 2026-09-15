import { inflateRawSync } from "node:zlib";
import { importEntrantsCsv, type ImportedEntrant } from "@tournament-os/competition-engine";
import { isAlias, parseDocument, visit } from "yaml";
import type { CreationSource } from "./creation-proposal.js";

export interface SourceIngestion {
  readonly status: "ACCEPTED" | "QUARANTINED";
  readonly normalized: unknown;
  readonly entrants: readonly ImportedEntrant[];
  readonly findings: readonly string[];
}

const MAX_TEXT_BYTES = 2_000_000;
const MAX_XLSX_BYTES = 5_000_000;
const MAX_XLSX_EXPANDED_BYTES = 12_000_000;
const MAX_ZIP_ENTRIES = 64;

function quarantine(...findings: string[]): SourceIngestion {
  return { status: "QUARANTINED", normalized: null, entrants: [], findings };
}

function textWithinBudget(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES;
}

function dataFinding(value: unknown): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!; nodes += 1;
    if (nodes > 200_000) return "SOURCE_COMPLEXITY: source contains too many values.";
    if (current.depth > 64) return "SOURCE_COMPLEXITY: source nesting exceeds 64 levels.";
    if (typeof current.value === "string" && current.value.length > 200_000)
      return "SOURCE_COMPLEXITY: one source value is too long.";
    if (typeof current.value === "number" && !Number.isFinite(current.value))
      return "SOURCE_VALUE: non-finite numbers are not accepted.";
    if (Array.isArray(current.value)) {
      if (current.value.length > 100_000) return "SOURCE_COMPLEXITY: source array is too large.";
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) return "SOURCE_VALUE: only plain data objects are accepted.";
      const entries = Object.entries(current.value as Record<string, unknown>);
      if (entries.length > 100_000) return "SOURCE_COMPLEXITY: source object has too many fields.";
      for (const [key, child] of entries) {
        if (key.length > 512) return "SOURCE_COMPLEXITY: source field name is too long.";
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function acceptedData(value: unknown): SourceIngestion {
  const finding = dataFinding(value);
  return finding ? quarantine(finding) : { status: "ACCEPTED", normalized: value, entrants: [], findings: [] };
}

function yamlValue(text: string): SourceIngestion {
  if (!textWithinBudget(text)) return quarantine("SOURCE_TOO_LARGE: YAML exceeds the 2 MB import boundary.");
  let document: ReturnType<typeof parseDocument>;
  try { document = parseDocument(text, { schema: "core", uniqueKeys: true, merge: false }); }
  catch (error) { return quarantine(`YAML_SYNTAX: ${error instanceof Error ? error.message : "YAML could not be decoded."}`); }
  if (document.errors.length) return quarantine(...document.errors.map((error) => `YAML_SYNTAX: ${error.message}`));
  const unsafe: string[] = [];
  visit(document, (_key, node) => {
    if (isAlias(node)) unsafe.push("YAML_ALIAS: aliases are not accepted at the competition boundary.");
    const tagged = node as { anchor?: string; tag?: string };
    if (tagged.anchor) unsafe.push("YAML_ANCHOR: anchors are not accepted at the competition boundary.");
    if (tagged.tag) unsafe.push("YAML_TAG: explicit YAML tags are not accepted at the competition boundary.");
  });
  if (unsafe.length) return quarantine(...[...new Set(unsafe)]);
  try {
    return acceptedData(document.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    return quarantine(`YAML_SYNTAX: ${error instanceof Error ? error.message : "YAML could not be decoded."}`);
  }
}

function csvValue(text: string): SourceIngestion {
  if (!textWithinBudget(text)) return quarantine("SOURCE_TOO_LARGE: CSV exceeds the 2 MB import boundary.");
  const imported = importEntrantsCsv(text);
  if (imported.status === "REJECTED") return quarantine(...imported.findings.map(({ code, row, column, message }) =>
    `${code}${row ? ` row ${row}` : ""}${column ? ` ${column}` : ""}: ${message}`));
  return { status: "ACCEPTED", normalized: { entrants: imported.entrants }, entrants: imported.entrants, findings: [] };
}

function decodeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function attribute(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}=[\"']([^\"']*)[\"']`, "i"))?.[1];
}

function zipEntries(bytes: Buffer): Map<string, Buffer> | string {
  if (bytes.length < 22 || bytes.length > MAX_XLSX_BYTES) return "XLSX_SIZE: workbook must be between 22 bytes and 5 MB.";
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) return "XLSX_ZIP: end-of-directory record is missing.";
  const entryCount = bytes.readUInt16LE(end + 10); const centralSize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  if (entryCount > MAX_ZIP_ENTRIES || cursor + centralSize > end) return "XLSX_ZIP: workbook archive exceeds the safe entry boundary.";
  const result = new Map<string, Buffer>(); let expanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) return "XLSX_ZIP: central directory is malformed.";
    const flags = bytes.readUInt16LE(cursor + 8); const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20); const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28); const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32); const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.startsWith("/") || name.split("/").includes("..") || result.has(name)) return "XLSX_ZIP_PATH: workbook contains an unsafe or duplicate path.";
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || size > MAX_XLSX_EXPANDED_BYTES
      || compressedSize > MAX_XLSX_BYTES || expanded + size > MAX_XLSX_EXPANDED_BYTES)
      return "XLSX_ZIP: workbook uses an encrypted, unsupported or over-expanded entry.";
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) return "XLSX_ZIP: local entry is malformed.";
    const localNameLength = bytes.readUInt16LE(localOffset + 26); const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength; const compressed = bytes.subarray(start, start + compressedSize);
    if (compressed.length !== compressedSize) return "XLSX_ZIP: workbook entry is truncated.";
    let data: Buffer;
    try { data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_XLSX_EXPANDED_BYTES }); }
    catch { return "XLSX_ZIP: workbook entry cannot be decompressed safely."; }
    if (data.length !== size) return "XLSX_ZIP: workbook entry size does not match its directory record.";
    expanded += data.length; result.set(name, data);
  }
  return result;
}

function cellColumn(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ""; let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function cellsAsCsv(sheet: string, sharedStrings: readonly string[]): string | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(sheet) || /<f(?:\s|>)/i.test(sheet)) return null;
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const reference = attribute(cellMatch[1]!, "r"); if (!reference) return null;
      const column = cellColumn(reference); if (column < 0 || column > 64) return null;
      const type = attribute(cellMatch[1]!, "t"); const body = cellMatch[2]!;
      const raw = type === "inlineStr"
        ? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1]!)).join("")
        : decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "");
      const value = type === "s" ? sharedStrings[Number(raw)] : raw;
      if (value === undefined) return null; row[column] = value;
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  return rows.map((row) => row.map((value = "") => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(",")).join("\n");
}

function xlsxValue(base64: string): SourceIngestion {
  let bytes: Buffer;
  try { bytes = Buffer.from(base64, "base64"); } catch { return quarantine("XLSX_BASE64: workbook bytes are invalid."); }
  const entries = zipEntries(bytes); if (typeof entries === "string") return quarantine(entries);
  const unsafe = [...entries.keys()].find((name) => /(?:vbaProject\.bin|externalLinks\/|connections\.xml|embeddings\/|activeX\/)/i.test(name));
  if (unsafe) return quarantine(`XLSX_ACTIVE_CONTENT: ${unsafe} is not accepted.`);
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const relationships = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbook || !relationships || /<!DOCTYPE|<!ENTITY/i.test(workbook + relationships)) return quarantine("XLSX_STRUCTURE: workbook metadata is missing or unsafe.");
  const sheet = [...workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)].find((match) => attribute(match[1]!, "name")?.toLowerCase() === "entrants");
  const relationshipId = sheet ? attribute(sheet[1]!, "r:id") : undefined;
  const relationship = relationshipId ? [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)]
    .find((match) => attribute(match[1]!, "Id") === relationshipId) : undefined;
  const target = relationship ? attribute(relationship[1]!, "Target")?.replaceAll("\\", "/") : undefined;
  if (!target || target.startsWith("/") || target.split("/").includes("..") || !target.startsWith("worksheets/"))
    return quarantine("XLSX_ENTRANTS_SHEET: a safe worksheet named Entrants is required.");
  const sheetXml = entries.get(`xl/${target}`)?.toString("utf8");
  if (!sheetXml) return quarantine("XLSX_ENTRANTS_SHEET: the Entrants worksheet is missing.");
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  if (/<!DOCTYPE|<!ENTITY/i.test(sharedXml)) return quarantine("XLSX_XML: external entities are not accepted.");
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => decodeXml(part[1]!)).join(""));
  if (/<f(?:\s|>)/i.test(sheetXml)) return quarantine("XLSX_FORMULA: formula cells are not accepted; provide values-only entrant data.");
  const csv = cellsAsCsv(sheetXml, sharedStrings);
  if (csv === null) return quarantine("XLSX_SHEET: the Entrants worksheet cannot be represented safely.");
  return csvValue(csv);
}

export function ingestCreationSource(source: CreationSource): SourceIngestion {
  if (source.mode === "quick") return acceptedData(source.value);
  if (source.mode === "json") {
    if (!textWithinBudget(source.text)) return quarantine("SOURCE_TOO_LARGE: JSON exceeds the 2 MB import boundary.");
    try { return acceptedData(JSON.parse(source.text)); }
    catch { return quarantine("JSON_SYNTAX: JSON could not be decoded."); }
  }
  if (source.mode === "yaml") return yamlValue(source.text);
  if (source.mode === "csv") return csvValue(source.text);
  if (source.mode === "xlsx") return xlsxValue(source.base64);
  return { status: "ACCEPTED", normalized: null, entrants: [], findings: [] };
}

export function validBase64Xlsx(value: string): boolean {
  if (!value || value.length > Math.ceil(MAX_XLSX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    && bytes.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "");
}

export const creationSourceTextLimit = MAX_TEXT_BYTES;
export function validCreationSourceText(value: string): boolean { return textWithinBudget(value); }

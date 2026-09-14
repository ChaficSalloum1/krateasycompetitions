import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type { ScheduledContest } from "./types.js";

export interface InteroperabilityFinding {
  readonly code:
    | "CSV_SYNTAX"
    | "CSV_HEADERS"
    | "INVALID_ENTRANT_ID"
    | "DUPLICATE_ENTRANT_ID"
    | "INVALID_DISPLAY_NAME"
    | "INVALID_DIVISION_ID"
    | "INVALID_ROSTER"
    | "DUPLICATE_MEMBER_ID"
    | "INVALID_SEED"
    | "UNSAFE_SPREADSHEET_VALUE"
    | "INVALID_CALENDAR_INPUT";
  readonly row?: number;
  readonly column?: string;
  readonly message: string;
}

export interface ImportedEntrant {
  readonly id: string;
  readonly displayName: string;
  readonly divisionId: string;
  readonly memberIds: readonly string[];
  readonly seed?: number;
}

export interface EntrantCsvImport {
  readonly status: "IMPORTED" | "REJECTED";
  readonly entrants: readonly ImportedEntrant[];
  readonly findings: readonly InteroperabilityFinding[];
  readonly importHash: string;
}

const CSV_HEADERS = ["entrant_id", "display_name", "division_id", "member_ids", "seed"] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORMULA_PREFIX = /^[\t\r ]*[=+@-]/;

function parseCsv(source: string): { rows: string[][]; error?: string } {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = false;
      } else value += character;
      continue;
    }
    if (character === '"') {
      if (value.length > 0) return { rows, error: "A quoted field must begin at the start of a value." };
      quoted = true;
    } else if (character === ",") {
      row.push(value); value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = "";
    } else value += character;
  }
  if (quoted) return { rows, error: "The final quoted field is not closed." };
  row.push(value.replace(/\r$/, ""));
  if (row.some((entry) => entry.length > 0) || rows.length === 0) rows.push(row);
  return { rows };
}

function finding(code: InteroperabilityFinding["code"], message: string, row?: number, column?: string): InteroperabilityFinding {
  return { code, message, ...(row === undefined ? {} : { row }), ...(column === undefined ? {} : { column }) };
}

function unsafeSpreadsheetValue(value: string): boolean { return FORMULA_PREFIX.test(value); }

export function importEntrantsCsv(source: string): Readonly<EntrantCsvImport> {
  const parsed = parseCsv(source.replace(/^\uFEFF/, ""));
  const findings: InteroperabilityFinding[] = [];
  if (parsed.error) findings.push(finding("CSV_SYNTAX", parsed.error));
  const headers = parsed.rows[0] ?? [];
  if (headers.length !== CSV_HEADERS.length || headers.some((header, index) => header !== CSV_HEADERS[index])) {
    findings.push(finding("CSV_HEADERS", `CSV must contain exactly these headers in order: ${CSV_HEADERS.join(",")}.`, 1));
  }
  const entrants: ImportedEntrant[] = [];
  const entrantIds = new Set<string>();
  const memberIds = new Set<string>();
  for (let index = 1; index < parsed.rows.length; index += 1) {
    const values = parsed.rows[index]!;
    const rowNumber = index + 1;
    if (values.length === 1 && values[0] === "") continue;
    if (values.length !== CSV_HEADERS.length) {
      findings.push(finding("CSV_SYNTAX", `Row ${rowNumber} has ${values.length} columns instead of ${CSV_HEADERS.length}.`, rowNumber));
      continue;
    }
    const [id = "", displayName = "", divisionId = "", roster = "", seedValue = ""] = values.map((entry) => entry.trim());
    for (const [column, value] of [["entrant_id", id], ["display_name", displayName], ["division_id", divisionId], ["member_ids", roster], ["seed", seedValue]] as const) {
      if (value && unsafeSpreadsheetValue(value)) findings.push(finding("UNSAFE_SPREADSHEET_VALUE", `${column} begins with a spreadsheet formula marker.`, rowNumber, column));
    }
    if (!SAFE_IDENTIFIER.test(id)) findings.push(finding("INVALID_ENTRANT_ID", "entrant_id must be a stable non-empty identifier.", rowNumber, "entrant_id"));
    if (entrantIds.has(id)) findings.push(finding("DUPLICATE_ENTRANT_ID", `entrant_id ${id} appears more than once.`, rowNumber, "entrant_id"));
    entrantIds.add(id);
    if (!displayName || displayName.length > 160) findings.push(finding("INVALID_DISPLAY_NAME", "display_name must contain 1–160 characters.", rowNumber, "display_name"));
    if (!SAFE_IDENTIFIER.test(divisionId)) findings.push(finding("INVALID_DIVISION_ID", "division_id must be a stable non-empty identifier.", rowNumber, "division_id"));
    const members = roster.split("|").map((entry) => entry.trim());
    if (members.length === 0 || members.some((member) => !SAFE_IDENTIFIER.test(member)) || new Set(members).size !== members.length) {
      findings.push(finding("INVALID_ROSTER", "member_ids must contain unique stable identifiers separated by |.", rowNumber, "member_ids"));
    }
    for (const member of members.filter((entry) => SAFE_IDENTIFIER.test(entry))) {
      if (memberIds.has(member)) findings.push(finding("DUPLICATE_MEMBER_ID", `member_id ${member} belongs to more than one entrant.`, rowNumber, "member_ids"));
      memberIds.add(member);
    }
    const seed = seedValue === "" ? undefined : Number(seedValue);
    if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 1)) findings.push(finding("INVALID_SEED", "seed must be a positive integer when supplied.", rowNumber, "seed"));
    entrants.push({ id, displayName, divisionId, memberIds: members, ...(seed === undefined ? {} : { seed }) });
  }
  const status = findings.length === 0 ? "IMPORTED" as const : "REJECTED" as const;
  const accepted = status === "IMPORTED" ? entrants : [];
  const body = { status, entrants: accepted, findings };
  return deepFreeze({ ...body, importHash: canonicalHash(body) });
}

export interface CalendarExportInput {
  readonly tournamentId: string;
  readonly tournamentName: string;
  readonly publishedAt: string;
  readonly certificationHash: string;
  readonly contests: readonly ScheduledContest[];
}

export interface CalendarExport {
  readonly status: "EXPORTED" | "REJECTED";
  readonly content: string;
  readonly findings: readonly InteroperabilityFinding[];
  readonly exportHash: string;
}

function icalEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function icalTimestamp(value: string): string | undefined {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function exportScheduleCalendar(input: CalendarExportInput): Readonly<CalendarExport> {
  const findings: InteroperabilityFinding[] = [];
  const publishedAt = icalTimestamp(input.publishedAt);
  if (!SAFE_IDENTIFIER.test(input.tournamentId) || !input.tournamentName.trim() || !publishedAt || !/^[a-f0-9]{64}$/.test(input.certificationHash)) {
    findings.push(finding("INVALID_CALENDAR_INPUT", "Calendar identity, publication time, name, and certification hash must be valid."));
  }
  const contests = [...input.contests].sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId));
  for (const contest of contests) {
    const start = icalTimestamp(contest.start); const end = icalTimestamp(contest.end);
    if (!SAFE_IDENTIFIER.test(contest.contestId) || !contest.resourceId.trim() || !start || !end || Date.parse(contest.end) <= Date.parse(contest.start)) {
      findings.push(finding("INVALID_CALENDAR_INPUT", `Contest ${contest.contestId || "<missing>"} cannot be represented safely.`));
    }
  }
  if (findings.length > 0) {
    const body = { status: "REJECTED" as const, content: "", findings };
    return deepFreeze({ ...body, exportHash: canonicalHash(body) });
  }
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TournamentOS//Schedule 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-TOURNAMENTOS-CERTIFICATION-HASH:${input.certificationHash}`];
  for (const contest of contests) {
    lines.push("BEGIN:VEVENT", `UID:${canonicalHash({ tournamentId: input.tournamentId, contestId: contest.contestId })}@tournamentos`,
      `DTSTAMP:${publishedAt}`, `DTSTART:${icalTimestamp(contest.start)!}`, `DTEND:${icalTimestamp(contest.end)!}`,
      `SUMMARY:${icalEscape(`${input.tournamentName} — ${contest.contestId}`)}`, `LOCATION:${icalEscape(contest.resourceId)}`,
      `DESCRIPTION:${icalEscape(`Possible entrants: ${[...contest.possibleEntrantIds].sort().join(", ") || "unresolved"}`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const content = `${lines.join("\r\n")}\r\n`;
  const body = { status: "EXPORTED" as const, content, findings };
  return deepFreeze({ ...body, exportHash: canonicalHash(body) });
}

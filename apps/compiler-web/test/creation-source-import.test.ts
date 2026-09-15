import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { stringify } from "yaml";
import { CompetitionJourney, parseCreationSource } from "../src/competition-journey.js";
import { createCompilerServer } from "../src/server.js";

const fixture = readFileSync(new URL("./fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url), "utf8").trimEnd();
const sourceValue = JSON.parse(fixture) as { pools: Record<string, Record<string, string[]>> };

function idFor(label: string): string {
  return label.toLowerCase().replace(/s$/, "").replace(/[^a-z0-9]+/g, "-") || "division";
}

function entrantCsv(change?: (rows: string[][]) => void): string {
  const rows = [["entrant_id", "display_name", "division_id", "member_ids", "seed"]];
  for (const [divisionLabel, pools] of Object.entries(sourceValue.pools)) {
    const divisionId = idFor(divisionLabel); let entrantIndex = 0;
    for (const entrants of Object.values(pools)) for (const displayName of entrants) {
      entrantIndex += 1;
      const entrantId = `${divisionId}.team.${entrantIndex}`;
      const members = displayName.split(" / ").map((_, index) => `${entrantId}.member.${index + 1}`).join("|");
      rows.push([entrantId, displayName, divisionId, members, String(entrantIndex)]);
    }
  }
  change?.(rows);
  return rows.map((row) => row.map((value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(",")).join("\n");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xlsx(csv: string, formula = false, extraEntries: Array<[string, string]> = []): Buffer {
  const rows = csv.split("\n").map((line) => line.split(","));
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
    if (formula && rowIndex === 1 && columnIndex === 1) return `<c r="${reference}"><f>HYPERLINK(&quot;https://evil.invalid&quot;)</f><v>0</v></c>`;
    return `<c r="${reference}" t="inlineStr"><is><t>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</t></is></c>`;
  }).join("")}</row>`).join("");
  const entries: Array<[string, string]> = [
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>"],
    ["xl/workbook.xml", "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Entrants\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"],
    ["xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>"],
    ["xl/worksheets/sheet1.xml", `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`],
    ...extraEntries,
  ];
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(text); const crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26); local.push(header, nameBytes, data);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes); offset += header.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

test("YAML normalises into the existing St Albans workbench while preserving exact source text and hash", () => {
  const text = stringify(sourceValue, { lineWidth: 0 });
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const draft = journey.create({ mode: "yaml", text }, "organiser.author");
  assert.equal(draft.name, "Encourt Padel & Wellness Club St Albans");
  assert.equal(draft.workbench.sources[0]?.original, text);
  assert.equal(draft.workbench.sources[0]?.sourceHash, createHash("sha256").update(text).digest("hex"));
  assert.equal(draft.workbench.sources[0]?.status, "ACCEPTED");
  assert.equal(draft.workbench.understoodFacts.find(({ id }) => id === "fixtures.total")?.value, 108);
});

test("CSV roster evidence converges field by field and a disagreement blocks compilation", () => {
  const csv = entrantCsv(); const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const roster = journey.create({ mode: "csv", text: csv }, "organiser.author");
  assert.equal(roster.workbench.sources[0]?.status, "ACCEPTED");
  assert.equal(roster.workbench.understoodFacts.find(({ id }) => id === "entrants.total")?.value, 48);
  const anchored = journey.addSource(roster.id, roster.draftVersion, { mode: "json", text: fixture });
  const name = anchored.workbench.understoodFacts.find(({ id }) => id === "entrant.advanced.team.1.display-name");
  assert.equal(name?.value, "Alireza Kakavand / Amir Ghoreishi");
  assert.equal(name?.provenance.length, 2);
  assert.equal(anchored.workbench.conflicts.length, 0);

  const disputedCsv = entrantCsv((rows) => { rows[1]![1] = "Forged Pair"; });
  const disputed = journey.addSource(roster.id, anchored.draftVersion, { mode: "csv", text: disputedCsv });
  assert.ok(disputed.workbench.conflicts.some(({ id }) => id.includes("advanced.team.1.display-name")));
  assert.throws(() => journey.compile(disputed.id, disputed.draftVersion), /journey_not_ready/);
  const restored = journey.removeSource(disputed.id, disputed.draftVersion, disputed.workbench.sources[2]!.id);
  assert.equal(restored.workbench.sources.length, 2);
  assert.deepEqual(restored.workbench.conflicts, []);
  assert.equal(restored.workbench.sources[0]?.sourceHash, roster.workbench.sources[0]?.sourceHash);
});

test("unsafe CSV and XLSX files are quarantined without contributing facts", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const unsafeCsv = entrantCsv((rows) => { rows[1]![1] = "=WEBSERVICE(\"https://evil.invalid\")"; });
  const csvDraft = journey.create({ mode: "csv", text: unsafeCsv });
  assert.equal(csvDraft.workbench.sources[0]?.status, "QUARANTINED");
  assert.ok(csvDraft.workbench.sources[0]?.findings.some((finding) => finding.includes("UNSAFE_SPREADSHEET_VALUE")));
  assert.deepEqual(csvDraft.workbench.understoodFacts, []);

  const bytes = xlsx(entrantCsv(), true);
  const xlsxDraft = journey.create({ mode: "xlsx", fileName: "entrants.xlsx", base64: bytes.toString("base64") });
  assert.equal(xlsxDraft.workbench.sources[0]?.status, "QUARANTINED");
  assert.ok(xlsxDraft.workbench.sources[0]?.findings.some((finding) => finding.includes("XLSX_FORMULA")));
  assert.deepEqual(xlsxDraft.workbench.understoodFacts, []);
});

test("a real XLSX entrant sheet preserves the original bytes and corroborates the canonical roster", () => {
  const bytes = xlsx(entrantCsv()); const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const draft = journey.create({ mode: "json", text: fixture });
  const imported = journey.addSource(draft.id, draft.draftVersion,
    { mode: "xlsx", fileName: "st-albans-entrants.xlsx", base64: bytes.toString("base64") });
  const source = imported.workbench.sources[1]!;
  assert.equal(source.status, "ACCEPTED");
  assert.equal(source.fileName, "st-albans-entrants.xlsx");
  assert.equal(source.sourceHash, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(source.original, { fileName: "st-albans-entrants.xlsx", base64: bytes.toString("base64") });
  assert.equal(imported.workbench.understoodFacts.find(({ id }) => id === "entrant.beginner.team.12.member-ids")?.provenance.length, 2);
  assert.equal(imported.workbench.conflicts.length, 0);
});

test("the API source boundary rejects extra fields, invalid XLSX bytes and oversized text", () => {
  assert.throws(() => parseCreationSource({ mode: "csv", text: entrantCsv(), guardInput: {} }), /invalid_creation_source/);
  assert.throws(() => parseCreationSource({ mode: "xlsx", fileName: "entrants.xlsx", base64: "not base64" }), /invalid_creation_source/);
  assert.throws(() => parseCreationSource({ mode: "yaml", text: "x".repeat(2_000_001) }), /invalid_creation_source/);
});

test("malicious YAML aliases, duplicate roster identities and active XLSX content fail closed", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const yaml = journey.create({ mode: "yaml", text: "event: &event Pilot\ncopy: *event\n" });
  assert.equal(yaml.workbench.sources[0]?.status, "QUARANTINED");
  assert.ok(yaml.workbench.sources[0]?.findings.some((finding) => /YAML_(?:ALIAS|ANCHOR)/.test(finding)));

  const duplicate = journey.create({ mode: "csv", text: entrantCsv((rows) => { rows[2]![0] = rows[1]![0]!; }) });
  assert.equal(duplicate.workbench.sources[0]?.status, "QUARANTINED");
  assert.ok(duplicate.workbench.sources[0]?.findings.some((finding) => finding.includes("DUPLICATE_ENTRANT_ID")));

  const active = xlsx(entrantCsv(), false, [["xl/vbaProject.bin", "not executable here"]]);
  const workbook = journey.create({ mode: "xlsx", fileName: "active.xlsx", base64: active.toString("base64") });
  assert.equal(workbook.workbench.sources[0]?.status, "QUARANTINED");
  assert.ok(workbook.workbench.sources[0]?.findings.some((finding) => finding.includes("XLSX_ACTIVE_CONTENT")));
});

test("multi-source originals, hashes and provenance replay identically after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-import-")); const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => "2026-09-15T10:00:00.000Z" });
    const draft = journey.create({ mode: "yaml", text: stringify(sourceValue, { lineWidth: 0 }) });
    const bytes = xlsx(entrantCsv());
    const imported = journey.addSource(draft.id, draft.draftVersion,
      { mode: "xlsx", fileName: "entrants.xlsx", base64: bytes.toString("base64") });
    assert.deepEqual(new CompetitionJourney({ storagePath }).read(imported.id), imported);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function post(server: ReturnType<typeof createCompilerServer>, url: string, body: unknown) {
  const payload = Buffer.from(JSON.stringify(body)); const request = Readable.from([payload]) as never;
  Object.assign(request, { method: "POST", url, headers: { "content-type": "application/json", "content-length": String(payload.length) } });
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 0;
    server.emit("request", request, { writeHead: (next: number) => { status = next; },
      end: (encoded = "") => resolve({ status, body: JSON.parse(encoded) }) } as never);
  });
}

async function get(server: ReturnType<typeof createCompilerServer>, url: string) {
  const request = Readable.from([]) as never;
  Object.assign(request, { method: "GET", url, headers: {} });
  return new Promise<{ status: number; body: string }>((resolve) => {
    let status = 0;
    server.emit("request", request, { writeHead: (next: number) => { status = next; },
      end: (encoded = "") => resolve({ status, body: String(encoded) }) } as never);
  });
}

test("the connected creator previews and saves imports through the authoritative journey", async () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z" });
  const server = createCompilerServer({ competitionJourney: journey }); const text = stringify(sourceValue, { lineWidth: 0 });
  const preview = await post(server, "/api/competition-source-preview", { mode: "yaml", text });
  assert.equal(preview.status, 200); assert.equal(preview.body.draftCanBeSaved, true);
  assert.equal(preview.body.workbench.understoodFacts.find((fact: { id: string }) => fact.id === "fixtures.total").value, 108);
  const saved = await post(server, "/v1/competition-journey", { source: { mode: "yaml", text } });
  assert.equal(saved.status, 201); assert.equal(saved.body.name, "Encourt Padel & Wellness Club St Albans");
  const draftPage = await get(server, `/competitions/${encodeURIComponent(saved.body.id)}`);
  assert.equal(draftPage.status, 200);
  assert.ok(draftPage.body.includes("Authoritative competition draft"));
  assert.equal(journey.list().length, 1);
  server.close();
});

test("the connected web draft appends a generic roster into the same authoritative workbench", async () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-15T10:00:00.000Z", organizationId: "org.web" });
  const server = createCompilerServer({ competitionJourney: journey });
  const source = { mode: "quick", value: { name: "Harbour Web Open", sport: "padel", participantUnit: "pairs",
    participantCount: 4, resourceCount: 2, resourceLabel: "courts", format: "round_robin", minimumMatches: 3,
    minimumRestMinutes: 10, matchDurationMinutes: 20, startsAt: "2026-10-18T08:00:00.000Z",
    endsAt: "2026-10-18T17:00:00.000Z", timezone: "Europe/London", priority: "fair_recovery",
    scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
    withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order" } };
  const saved = await post(server, "/v1/competition-journey", { source });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.status, "NEEDS_INPUT");
  assert.ok(saved.body.workbench.missingDecisions.some((decision: { id: string }) => decision.id === "entrant-roster"));
  const page = await get(server, `/competitions/${encodeURIComponent(saved.body.id)}`);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes("Add or corroborate entrants"));
  assert.ok(page.body.includes("/sources"));

  const rows = [["entrant_id", "display_name", "division_id", "member_ids", "seed"],
    ...Array.from({ length: 4 }, (_, index) => { const number = index + 1; return [
      `harbour.pair.${number}`, `Harbour Pair ${number}`, "open",
      `harbour.pair.${number}.member.1|harbour.pair.${number}.member.2`, String(number)]; })];
  const rostered = await post(server, `/v1/competition-journey/${encodeURIComponent(saved.body.id)}/sources`, {
    expectedDraftVersion: saved.body.draftVersion, source: { mode: "csv", text: rows.map((row) => row.join(",")).join("\n") },
  });
  assert.equal(rostered.status, 200);
  assert.equal(rostered.body.status, "DRAFT");
  assert.deepEqual(rostered.body.workbench.missingDecisions, []);
  assert.equal(rostered.body.workbench.understoodFacts.find((fact: { id: string }) =>
    fact.id === "entrant.harbour.pair.1.display-name").value, "Harbour Pair 1");
  server.close();
});

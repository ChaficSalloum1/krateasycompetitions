import assert from "node:assert/strict";
import test from "node:test";
import { exportScheduleCalendar, importEntrantsCsv } from "../src/interoperability.js";

test("a canonical entrant CSV imports quoted names, rosters, seeds, and divisions without losing identity", () => {
  const csv = [
    "entrant_id,display_name,division_id,member_ids,seed",
    'pair-01,"Amina, Salma",advanced,member-01|member-02,1',
    "pair-02,Noor and Leen,advanced,member-03|member-04,",
  ].join("\r\n");

  const result = importEntrantsCsv(csv);

  assert.equal(result.status, "IMPORTED");
  assert.deepEqual(result.entrants, [
    { id: "pair-01", displayName: "Amina, Salma", divisionId: "advanced", memberIds: ["member-01", "member-02"], seed: 1 },
    { id: "pair-02", displayName: "Noor and Leen", divisionId: "advanced", memberIds: ["member-03", "member-04"] },
  ]);
  assert.match(result.importHash, /^[a-f0-9]{64}$/);
  assert.equal(importEntrantsCsv(csv).importHash, result.importHash);
});

test("entrant import fails closed for duplicate identities, spreadsheet formulas, and malformed rosters", () => {
  const result = importEntrantsCsv([
    "entrant_id,display_name,division_id,member_ids,seed",
    "pair-01,Safe name,advanced,member-01|member-02,1",
    "pair-01,=HYPERLINK(unsafe),advanced,member-03|,2",
  ].join("\n"));

  assert.equal(result.status, "REJECTED");
  assert.deepEqual(result.entrants, []);
  assert.ok(result.findings.some(({ code }) => code === "DUPLICATE_ENTRANT_ID"));
  assert.ok(result.findings.some(({ code }) => code === "UNSAFE_SPREADSHEET_VALUE"));
  assert.ok(result.findings.some(({ code }) => code === "INVALID_ROSTER"));
});

test("a certified schedule exports as a deterministic UTC calendar without reinterpreting contests", () => {
  const result = exportScheduleCalendar({
    tournamentId: "play-konnect-2026",
    tournamentName: "Play & Konnect",
    publishedAt: "2026-09-05T09:00:00.000Z",
    certificationHash: "c".repeat(64),
    contests: [
      { contestId: "final", resourceId: "Court 1", start: "2026-09-05T16:30:00.000Z", end: "2026-09-05T17:00:00.000Z", possibleEntrantIds: ["pair-01", "pair-02"] },
    ],
  });

  assert.equal(result.status, "EXPORTED");
  assert.match(result.content, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/TournamentOS\/\/Schedule 1\.0\/\/EN\r\n/);
  assert.match(result.content, /DTSTART:20260905T163000Z\r\nDTEND:20260905T170000Z/);
  assert.match(result.content, /SUMMARY:Play & Konnect — final/);
  assert.match(result.content, /LOCATION:Court 1/);
  assert.match(result.content, /X-TOURNAMENTOS-CERTIFICATION-HASH:c{64}/);
  assert.match(result.exportHash, /^[a-f0-9]{64}$/);
});

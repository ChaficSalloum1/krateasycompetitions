import assert from "node:assert/strict";
import test from "node:test";
import { CreatorSession } from "../src/creator/session.js";
import { examples } from "../src/creator/examples.js";
import { createHash } from "../src/creator/browser/crypto.js";
import { inflateRawSync } from "../src/creator/browser/zlib.js";
import { deflateRawSync } from "node:zlib";
import { createHash as nodeHash } from "node:crypto";
test("D: text → question → live structure → invalid rule → undo → review invalidation",()=>{
  const session=new CreatorSession({mode:"language",text:examples["Pools to cups"]});
  assert.equal(session.evaluate().compilation.status,"NEEDS_DECISION");
  session.answer({"divisions.0.comparison":"percentage"});assert.equal(session.evaluate().compilation.status,"PROPOSED");
  assert.equal(session.review(),true);const reviewed=session.reviewedHash;assert.ok(reviewed);
  session.answer({"divisions.0.places":2,"divisions.0.bracketSlots":8});
  assert.equal(session.reviewedHash,null);assert.equal(session.evaluate().compilation.status,"BLOCKED");assert.equal(session.review(),false);
  assert.ok(session.evaluate().compilation.findings.some(f=>f.message.includes("2 entries have no valid destination")));
  session.undo();assert.equal(session.evaluate().compilation.status,"PROPOSED");assert.equal(session.reviewedHash,null);
  const before=JSON.stringify(session.export());session.changeSource({mode:"language",text:examples.Knockout});
  assert.deepEqual(session.answers.values,{});assert.notEqual(JSON.stringify(session.export()),before);
  assert.equal(session.export().authority,"NON_AUTHORITATIVE_DRAFT");
});
test("browser hash implementation is byte-identical to server for unicode and canonical-sized inputs",()=>{
  for(const text of ["", "Krateasy — عربي 🏆", "abc".repeat(3000)])assert.equal(createHash("sha256").update(text).digest("hex"),nodeHash("sha256").update(text).digest("hex"));
});
test("browser XLSX decompression matches bytes and enforces expansion boundary",()=>{
  const value=Buffer.from("source-data".repeat(100));const zip=deflateRawSync(value);
  assert.deepEqual(inflateRawSync(zip,{maxOutputLength:2000}),value);
  assert.throws(()=>inflateRawSync(zip,{maxOutputLength:100}));
});
test("an imported roster retains exact identities and cannot be silently resized",()=>{
  const session=new CreatorSession({mode:"csv",text:"entrant_id,display_name,division_id,member_ids,seed\nA,Pair A,open,p1|p2,1\nB,Pair B,open,p3|p4,2\n"});
  assert.deepEqual(session.evaluate().interpretation.roster.map(e=>e.id),["A","B"]);
  session.answer({"divisions.0.entrants":8});assert.ok(session.evaluate().compilation.findings.some(f=>f.code==="ROSTER_ACCOUNTING"));
});

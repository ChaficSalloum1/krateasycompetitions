import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {CreatorSession} from "../src/creator/session.js";
import {emptyDraft,interpret} from "../src/creator/interpretation.js";
import {RULE_CATALOG,RULE_CATALOG_VERSION} from "../src/creator/rule-catalog.js";
import {examples} from "../src/creator/examples.js";

const source=(text:string)=>({mode:"language" as const,text});
const corpus=JSON.parse(readFileSync(new URL("../../../scenario/creator-intent-corpus/cases.json",import.meta.url),"utf8")) as {id:string;source:string;missing:string[];conflicts:string[];unknown:number}[];
for(const example of corpus)test(`D8 intent corpus: ${example.id}`,()=>{
  const p=interpret(source(example.source));
  assert.deepEqual(p.failures,[]);
  assert.deepEqual(p.decisions.filter(d=>d.ruleId).map(d=>d.path),example.missing);
  assert.deepEqual(p.conflicts.map(c=>c.path),example.conflicts);
  assert.equal(p.unparsed.length,example.unknown);
  assert.equal(new Set(p.decisions.map(d=>d.id)).size,p.decisions.length);
});
test("D8 catalog paths are unique and refer to a supported draft field",()=>{
  const draft=emptyDraft();
  assert.equal(new Set(RULE_CATALOG.map(rule=>rule.id)).size,RULE_CATALOG.length);
  for(const rule of RULE_CATALOG){
    const owner=rule.scope==="competition"?draft:draft.divisions[0]!;
    assert.ok(Object.hasOwn(owner,rule.field),rule.id);
  }
  assert.deepEqual(new Set(RULE_CATALOG.filter(r=>r.scope==="competition").map(r=>r.field)),new Set(Object.keys(draft).filter(key=>key!=="divisions")));
  assert.deepEqual(new Set(RULE_CATALOG.filter(r=>r.scope==="division").map(r=>r.field)),new Set(Object.keys(draft.divisions[0]!).filter(key=>key!=="id")));
});
test("D8 source-named divisions retain a fact rather than appearing as defaults",()=>{
  const p=interpret(source(examples["St Albans structure"]));
  for(const row of p.coverage.filter(c=>c.ruleId==="label")){
    assert.equal(row.status,"SOURCE");
    assert.ok(row.factIds.some(id=>p.facts.some(f=>f.id===id&&f.locator.startsWith("line:"))));
  }
});
test("D8 missing comparison has a rule reason, then the source itself resolves it without a repeated question",()=>{
  const s=new CreatorSession(source(examples["Pools to cups"]));
  const before=s.evaluate().interpretation;
  const item=before.decisions.find(d=>d.path==="divisions.0.comparison");
  assert.equal(item?.ruleId,"comparison");
  assert.match(item!.why,/compares entries from different pools/);
  assert.equal(before.coverage.find(c=>c.path===item!.path)?.status,"MISSING");
  assert.equal(before.ruleCatalogVersion,RULE_CATALOG_VERSION);
  const edited=examples["Pools to cups"]+"\nCompare by win percentage.";
  assert.equal(s.changeSource(source(edited)).status,"COMMITTED");
  const after=s.evaluate().interpretation;
  assert.ok(!after.decisions.some(d=>d.path===item!.path));
  const covered=after.coverage.find(c=>c.path===item!.path)!;
  assert.equal(covered.status,"SOURCE");
  assert.ok(covered.factIds.every(id=>after.facts.some(f=>f.id===id&&f.locator.startsWith("line:"))));
  assert.equal(s.state,"READY_FOR_REVIEW");
});
test("D8 a declared decision is source-bound and changing the source does not reuse it",()=>{
  const s=new CreatorSession(source(examples["Pools to cups"]));
  s.answer({"divisions.0.comparison":"percentage"});
  assert.equal(s.evaluate().interpretation.coverage.find(c=>c.ruleId==="comparison")?.status,"ANSWER");
  s.changeSource(source(examples["Pools to cups"]+"\nA new event note."));
  assert.equal(s.evaluate().interpretation.coverage.find(c=>c.ruleId==="comparison")?.status,"MISSING");
});
test("D8 answers from another catalog version do not silently authorise current semantics",()=>{
  const initial=interpret(source(examples["Pools to cups"]));
  const p=interpret(source(examples["Pools to cups"]),{sourceHash:initial.sourceHash,ruleCatalogVersion:"creator-rule-catalog/older",values:{"divisions.0.comparison":"percentage"}});
  assert.equal(p.draft.divisions[0]!.comparison,null);
  assert.ok(p.decisions.some(d=>d.ruleId==="comparison"));
});
test("D8 top per pool without wildcards needs no cross-pool comparison or bye allocation for a full field",()=>{
  const text=examples["Pools to cups"].replace("top 1 per pool; best 2 runners-up","top 2 per pool; no runners-up");
  const p=interpret(source(text));
  assert.equal(p.draft.divisions[0]!.comparison,null);
  assert.ok(!p.decisions.some(d=>d.path==="divisions.0.comparison"));
  assert.equal(p.coverage.find(c=>c.ruleId==="comparison")?.status,"NOT_APPLICABLE");
  assert.equal(p.coverage.find(c=>c.ruleId==="byePolicy")?.status,"NOT_APPLICABLE");
  assert.deepEqual(p.decisions,[]);
});
test("D8 pure knockout does not ask pool tiebreaks, byes or a cross-pool ranking",()=>{
  const text=examples.Knockout.replace(/; tiebreak:.*?manual\./,".").replace("; byes to highest seeds","");
  const p=interpret(source(text));
  assert.equal(p.coverage.find(c=>c.ruleId==="tiebreak")?.status,"NOT_APPLICABLE");
  assert.equal(p.coverage.find(c=>c.ruleId==="byePolicy")?.status,"NOT_APPLICABLE");
  assert.ok(!p.decisions.some(d=>["tiebreak","byePolicy","comparison"].includes(d.ruleId??"")));
  assert.deepEqual(p.decisions,[]);
});
test("D8 contradictions and unknown constraints remain questions, not silently inferred or certified",()=>{
  const p=interpret(source(examples.Knockout+"\n40-minute matches. Never schedule a pair after lunch."));
  assert.equal(p.coverage.find(c=>c.ruleId==="duration")?.status,"CONFLICT");
  assert.ok(p.decisions.some(d=>d.id==="conflict:duration"));
  assert.ok(p.decisions.some(d=>d.id.startsWith("unparsed-")));
  assert.equal(new Set(p.decisions.map(d=>d.id)).size,p.decisions.length);
});

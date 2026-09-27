import assert from "node:assert/strict";
import test from "node:test";
import { interpret } from "../src/creator/interpretation.js";
import { compileInterpretation,inspectDraft } from "../src/creator/definition.js";
import { examples } from "../src/creator/examples.js";
import { qualifyEntries } from "../../../packages/competition-engine/src/qualification.js";
import { createEntrants } from "../../../packages/competition-engine/src/graph.js";
for(const [name,text] of Object.entries(examples))test(`C: ${name} becomes the same canonical definition type`,()=>{
  const initial=interpret({mode:"language",text});
  const proposed=name==="Pools to cups"?interpret({mode:"language",text},{sourceHash:initial.sourceHash,values:{"divisions.0.comparison":"percentage"}}):initial;
  assert.deepEqual(proposed.decisions,[]);assert.deepEqual(proposed.failures,[]);
  assert.ok(proposed.facts.every(f=>f.sourceHash===proposed.sourceHash&&f.locator));
  const compiled=compileInterpretation(proposed);
  assert.equal(compiled.status,"PROPOSED",JSON.stringify(compiled));assert.ok(compiled.graph);
  assert.ok(compiled.validation.every(f=>f.code==="TSC602"||f.severity==="WARNING"));
  assert.ok(compiled.spec!.assumptions.every(a=>!a.approved));
});
test("undefined best-runners-up comparison is an open decision, never inferred",()=>{
  const p=interpret({mode:"language",text:examples["Pools to cups"]});
  assert.ok(p.decisions.some(d=>d.path==="divisions.0.comparison"));assert.equal(p.draft.divisions[0]!.comparison,null);
});
test("conflicts and unrecognised restrictions stay visible; source changes invalidate answers",()=>{
  const source={mode:"language" as const,text:examples.Knockout+"\n40-minute matches. Never schedule Alex after lunch."};
  const p=interpret(source);assert.equal(p.conflicts[0]?.path,"duration");assert.ok(p.unparsed.some(x=>x.text.includes("Alex")));
  const resolved=interpret(source,{sourceHash:p.sourceHash,values:{duration:35}});assert.equal(resolved.draft.duration,35);
  const changed=interpret({...source,text:source.text+"\n50-minute matches."},{sourceHash:p.sourceHash,values:{duration:35}});
  assert.notEqual(changed.draft.duration,35);assert.ok(changed.decisions.some(d=>d.path==="duration"));
});
test("JSON/YAML share the draft contract and preserve unsupported properties as questions",()=>{
  const draft=interpret({mode:"language",text:examples.Knockout}).draft;
  for(const mode of ["json","yaml"] as const){const p=interpret({mode,text:JSON.stringify({...draft,secretRule:"manual override"})});assert.ok(p.unparsed.some(x=>x.text.includes("secretRule")));assert.equal(p.draft.divisions[0]!.entrants,8);}
});
test("CSV entrants are facts, not invented format or rules",()=>{
  const p=interpret({mode:"csv",text:"entrant_id,display_name,division_id,member_ids,seed\nA,Pair A,open,p1|p2,1\nB,Pair B,open,p3|p4,2\n"});
  assert.deepEqual(p.failures,[]);assert.equal(p.draft.divisions[0]!.entrants,2);assert.equal(p.draft.divisions[0]!.format,null);
});
test("ten qualifiers into eight slots gives the exact missing-destination counterexample",()=>{
  const p=interpret({mode:"language",text:examples["Pools to cups"]});const d=p.draft.divisions[0]!;d.places=2;d.runnersUp=2;d.bracketSlots=8;
  assert.ok(inspectDraft(p.draft).some(f=>f.code==="CARDINALITY_MISMATCH"&&f.message.includes("2 entries")));
});
test("top N in each pool translates to per-position selectors, not a global top-N",()=>{
  const text=examples["Pools to cups"].replace("top 1 per pool; best 2 runners-up","top 2 per pool; no runners-up; compare by win percentage");
  const p=interpret({mode:"language",text});const c=compileInterpretation(p);assert.equal(c.status,"PROPOSED");
  const spec=c.spec!, entries=createEntrants(spec), stage=spec.stages[0]!;
  const rows=entries["division-1"]!.map((entry,i)=>({entrantId:entry.id,poolId:`pool${Math.floor(i/4)}`,rank:i%4+1,played:3,wins:3-i%4,losses:i%4,draws:0,scoreFor:12-i%4,scoreAgainst:i%4,scoreDifference:12-2*(i%4),winningPercentage:(3-i%4)/3,tieResolution:[]}));
  const result=qualifyEntries(spec,{[stage.id]:rows},entries);assert.deepEqual(result.findings,[]);assert.equal(result.byStructure["division-1.main.structure"]!.length,8);
});

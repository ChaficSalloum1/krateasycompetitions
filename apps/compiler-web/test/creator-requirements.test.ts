import assert from "node:assert/strict";
import test from "node:test";
import {CreatorSession} from "../src/creator/session.js";
import {interpret,setField,type Draft} from "../src/creator/interpretation.js";
import {examples} from "../src/creator/examples.js";
import {RULE_CATALOG,dependencyPaths} from "../src/creator/rule-catalog.js";
import {REQUIREMENT_GROUPS} from "../src/creator/requirements.js";

const json=(draft:Draft)=>({mode:"json" as const,text:JSON.stringify(draft)});
const complete=(name:keyof typeof examples)=>interpret({mode:"language",text:examples[name]+(name==="Pools to cups"?"\nCompare by win percentage.":"")}).draft;
const globalRequired=["sport","duration","rest","courts","start","end","timezone","scoring"];
const required:Record<string,string[]>={
  Knockout:[...globalRequired,"divisions.0.entrants","divisions.0.format","divisions.0.protectedSeeds","divisions.0.rematches"],
  "Round robin":[...globalRequired,"tiebreak","divisions.0.entrants","divisions.0.format"],
  "Pools to cups":[...globalRequired,"tiebreak",...['entrants','format','poolSizes','qualification','places','runnersUp','comparison','remainder','cup','secondaryCup','protectedSeeds','byePolicy','rematches'].map(x=>`divisions.0.${x}`)]
};
for(const [name,paths] of Object.entries(required))for(const path of paths)test(`D12 omitted requirement: ${name} / ${path}`,()=>{
  const draft=complete(name as keyof typeof examples);
  const parts=path.split(".");let target:any=draft;for(const key of parts.slice(0,-1))target=target[key];target[parts.at(-1)!]=null;
  const session=new CreatorSession(json(draft)),result=session.evaluate();
  assert.equal(result.requirements.items.find(r=>r.id===path)?.state,"MISSING");
  assert.ok(result.interpretation.decisions.some(q=>q.path===path),"missing requirement must produce an actionable question");
  assert.notEqual(session.state,"READY_FOR_REVIEW");
  assert.equal(session.review(),false);
  session.answer({[path]:path.split('.').reduce<any>((v,k)=>v[k],complete(name as keyof typeof examples))});
  assert.ok(!session.evaluate().interpretation.decisions.some(q=>q.path===path));
  assert.equal(session.evaluate().requirements.items.find(r=>r.id===path)?.state,"KNOWN");
});
test("D12 every draft field has one noun assignment and every dependency is registered",()=>{
  const assigned=REQUIREMENT_GROUPS.flatMap(g=>[...g.fields]);
  assert.equal(new Set(assigned).size,assigned.length);
  assert.deepEqual([...assigned].sort(),RULE_CATALOG.map(r=>r.id).sort());
  const d=complete("Pools to cups");
  const paths=new Set(RULE_CATALOG.map(r=>r.scope==="division"?`divisions.0.${r.field}`:r.field));
  for(const rule of RULE_CATALOG)for(const path of dependencyPaths(rule.id,rule.scope==="division"?`divisions.0.${rule.field}`:rule.field,d))assert.ok(paths.has(path),path);
});
test("D12 conditional questions wait for prerequisite decisions, then activate",()=>{
  const draft=complete("Pools to cups");draft.divisions[0]!.format=null;
  const s=new CreatorSession(json(draft));
  assert.equal(s.evaluate().requirements.items.find(r=>r.id==="divisions.0.poolSizes")?.state,"WAITING");
  s.answer({"divisions.0.format":"knockout"});
  assert.equal(s.evaluate().requirements.items.find(r=>r.id==="divisions.0.poolSizes")?.state,"NOT_APPLICABLE");
  const blank=complete("Pools to cups");blank.divisions[0]!.qualification=null;blank.divisions[0]!.places=null;
  const q=new CreatorSession(json(blank));
  assert.ok(!q.evaluate().interpretation.decisions.some(d=>d.path==="divisions.0.places"));
  q.answer({"divisions.0.qualification":"top_per_pool"});
  assert.ok(q.evaluate().interpretation.decisions.some(d=>d.path==="divisions.0.places"));
});
for(const [path,value] of [["sport","tennis"],["scoring","sets"],["tiebreak","coin_toss"],["divisions.0.format","swiss"],["divisions.0.qualification","arbitrary"],["divisions.0.comparison","unknown"]] as const)test(`D12 unsupported values are not counted as known: ${path}`,()=>{
  const d=complete("Pools to cups");setField(d,path,value);const s=new CreatorSession(json(d));
  assert.equal(s.evaluate().requirements.items.find(r=>r.id===path)?.state,"UNSUPPORTED");
  assert.equal(s.review(),false);
});
test("D12 contradictory statements, invalid capacity and unknown clauses retain specific evidence",()=>{
  const s=new CreatorSession({mode:"language",text:examples["Pools to cups"]+"\nCompare by win percentage. 45-minute matches. All matches must happen on the moon."});
  const r=s.evaluate().requirements;
  assert.equal(r.items.find(i=>i.id==="duration")?.state,"CONFLICT");
  assert.ok(r.items.some(i=>i.state==="UNRESOLVED"&&i.reason.includes("moon")));
  const d=complete("Pools to cups");d.divisions[0]!.bracketSlots=4;
  const bad=new CreatorSession(json(d)).evaluate().requirements.items.find(i=>i.id==="divisions.0.bracketSlots")!;
  assert.equal(bad.state,"INVALID");assert.match(bad.reason,/2 entries have no valid destination/);
});
test("D12 main cup without byes cannot hide missing inherited second-cup bye policy",()=>{
  const d=complete("Pools to cups");d.divisions[0]!.runnersUp=0;d.divisions[0]!.byePolicy=null;
  const s=new CreatorSession(json(d));
  assert.ok(s.evaluate().interpretation.decisions.some(q=>q.path==="divisions.0.byePolicy"));
  s.answer({"divisions.0.secondaryByePolicy":"highest_seeds"});
  assert.ok(!s.evaluate().interpretation.decisions.some(q=>q.path==="divisions.0.byePolicy"));
});
test("D12 review never promotes later assurance; reports are revision-bound and defaults visible",()=>{
  const s=new CreatorSession(json(complete("Pools to cups"))),before=s.evaluate().requirements;
  assert.equal(s.review(),true);
  const r=s.evaluate().requirements;
  assert.equal(r.canPublish,false);assert.notEqual(before.hash,r.hash);
  assert.equal(r.revision,s.revision);
  assert.ok(r.items.filter(i=>i.boundary!=="DRAFT_REVIEW").every(i=>i.state==="NOT_EVALUATED"));
  assert.equal(r.items.find(i=>i.id==="compiler-profile")?.state,"PROPOSED");
  assert.match(r.items.find(i=>i.id==="compiler-profile")!.reason,/snake pool allocation/);
  assert.ok(r.items.some(i=>i.id==="schedule-editing"&&i.state==="NOT_EVALUATED"));
  s.changeSource({mode:"language",text:"Padel pairs."});
  assert.notEqual(s.evaluate().requirements.sourceHash,r.sourceHash);
  assert.equal(s.evaluate().requirements.items.find(i=>i.id==="compiler-profile")?.state,"NOT_EVALUATED");
});

test("D12 invalid prerequisites suppress dependent questions until corrected",()=>{
  const d=complete("Pools to cups");d.divisions[0]!.qualification="unknown";d.divisions[0]!.places=null;
  const s=new CreatorSession(json(d));
  assert.ok(!s.evaluate().interpretation.decisions.some(q=>q.path==="divisions.0.places"));
  assert.equal(s.evaluate().requirements.items.find(i=>i.id==="divisions.0.places")?.state,"WAITING");
  s.answer({"divisions.0.qualification":"top_per_pool"});
  assert.ok(s.evaluate().interpretation.decisions.some(q=>q.path==="divisions.0.places"));
});

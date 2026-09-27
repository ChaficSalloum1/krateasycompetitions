import assert from "node:assert/strict";
import test from "node:test";
import {CreatorSession,type CommandEnvelope} from "../src/creator/session.js";
import {examples} from "../src/creator/examples.js";
const make=()=>new CreatorSession({mode:"language",text:examples["Pools to cups"]});
test("D commands: stale, blocked and malformed commands leave the complete draft unchanged",()=>{
  const s=make(),before=s.export();
  const cases=[
    {id:"review",expectedRevision:1,command:{type:"REVIEW"}},
    {id:"stale",expectedRevision:0,command:{type:"ANSWER",values:{rest:12}}},
    {id:"empty",expectedRevision:1,command:{type:"UNDO"}},
    {id:"badpath",expectedRevision:1,command:{type:"ANSWER",values:{"divisions.0.id":"other"}}},
    {id:"nan",expectedRevision:1,command:{type:"ANSWER",values:{rest:NaN}}},
    {id:"shape",expectedRevision:1,command:{type:"ANSWER",values:{"divisions.0.poolSizes":"four"}}},
    {id:"mixed",expectedRevision:1,command:{type:"ANSWER",values:{rest:12,"__proto__.polluted":"yes"}}},
    {id:"source",expectedRevision:1,command:{type:"CHANGE_SOURCE",source:{mode:"language",text:7}}},
  ];
  const codes=["VALIDATION_BLOCKED","STALE","NOTHING_TO_UNDO","INVALID","INVALID","INVALID","INVALID","INVALID"];
  cases.forEach((command,i)=>{const receipt=s.execute(command as CommandEnvelope);assert.equal(receipt.status,"REJECTED");if(receipt.status==="REJECTED")assert.equal(receipt.code,codes[i]);assert.deepEqual(s.export(),before);});
});
test("D commands: duplicate delivery is idempotent and conflicting reuse is rejected",()=>{
  const s=make();const command:CommandEnvelope={id:"answer",expectedRevision:1,command:{type:"ANSWER",values:{"divisions.0.comparison":"percentage"}}};
  const receipt=s.execute(command);s.answer({rest:12});const before=s.export();
  assert.deepEqual(s.execute(command),receipt);assert.deepEqual(s.export(),before);
  const forged=s.execute({...command,command:{type:"REVIEW"}});assert.equal(forged.status,"REJECTED");if(forged.status==="REJECTED")assert.equal(forged.code,"FORGED_INPUT");assert.deepEqual(s.export(),before);
});
test("D commands: exact revision review, blocked edits, monotonic undo and deterministic replay",()=>{
  const s=make();assert.equal(s.state,"NEEDS_DECISIONS");
  s.answer({"divisions.0.comparison":"percentage"});assert.equal(s.state,"READY_FOR_REVIEW");
  assert.ok(s.review());assert.equal(s.state,"REVIEWED");assert.equal(s.reviewedHash,s.evaluate().interpretation.hash);
  s.answer({"divisions.0.places":2,"divisions.0.bracketSlots":8});assert.equal(s.state,"BLOCKED");assert.equal(s.reviewedHash,null);
  assert.equal(s.review(),false);const rev=s.revision;s.undo();assert.equal(s.revision,rev+1);assert.equal(s.state,"READY_FOR_REVIEW");
  s.review();s.changeSource({mode:"language",text:examples.Knockout});assert.equal(s.reviewedHash,null);assert.deepEqual(s.answers.values,{});
  const replay=new CreatorSession(s.export().initialSource);
  for(const transition of s.transitions){assert.equal(replay.hash,transition.before.hash);assert.equal(replay.execute(transition.envelope).status,"COMMITTED");assert.equal(replay.hash,transition.after.hash);assert.equal(replay.state,transition.after.state);}
  assert.deepEqual(replay.export(),s.export());
});
test("D commands: returned snapshots cannot mutate draft truth or committed evidence",()=>{
  const s=make();s.answer({"divisions.0.comparison":"percentage"});const before=s.export();
  s.answers.values.rest=99;s.history.length=0;s.transitions[0]!.after.hash="forged";
  const exported=s.export();exported.answers.values.rest=77;exported.transitions.length=0;
  assert.deepEqual(s.export(),before);
});
test("D readiness includes graph failures instead of only definition findings",async()=>{
  const {interpret}=await import("../src/creator/interpretation.js");
  const {compileInterpretation}=await import("../src/creator/definition.js");
  const proposal=interpret({mode:"language",text:examples["Round robin"]});
  proposal.roster=Array.from({length:6},(_,i)=>({id:i<2?"duplicate":`entry-${i}`,displayName:`Pair ${i}`,divisionId:"division-1",memberIds:[`p${i}a`,`p${i}b`]}));
  const result=compileInterpretation(proposal);
  assert.equal(result.status,"BLOCKED");assert.ok(result.graph);
  assert.ok(result.validation.some(f=>f.code.startsWith("TSC707")&&f.severity==="ERROR"));
});

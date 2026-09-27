import assert from "node:assert/strict";
import test from "node:test";
import {CreatorSession} from "../src/creator/session.js";
import {examples} from "../src/creator/examples.js";
import type {MembershipEdit} from "../src/creator/membership.js";
function ready(){const s=new CreatorSession({mode:"language",text:examples["Pools to cups"]});s.answer({"divisions.0.comparison":"percentage"});return s;}
function edit(s:CreatorSession):MembershipEdit {const v=s.evaluate().compilation.memberships![0]!;return structuredClone({stageId:v.stageId,basisHash:v.basisHash,definitionRules:v.definitionRules,planAssignments:v.planAssignments});}
test("D1: pool swap preserves identities and exact sizes, then replay reproduces graph",()=>{
 const s=ready(),e=edit(s),a=e.planAssignments[0]!,b=e.planAssignments.find(x=>x.poolId!==a.poolId)!;[a.poolId,b.poolId]=[b.poolId,a.poolId];
 assert.equal(s.setMembership(e).status,"COMMITTED");assert.deepEqual(s.evaluate().compilation.memberships![0]!.pools.map(p=>p.entries.length),[4,4,4,4]);
 assert.deepEqual(new Set(s.evaluate().compilation.memberships![0]!.planAssignments.map(a=>a.entrantId)),new Set(e.planAssignments.map(a=>a.entrantId)));
 const replay=new CreatorSession(s.export().initialSource);for(const t of s.transitions)replay.execute(t.envelope);assert.deepEqual(replay.export(),s.export());
});
test("D1: protected together/separate constraints reject violating swap atomically",()=>{
 const s=ready(),e=edit(s),a=e.planAssignments[0]!,same=e.planAssignments.find(x=>x.entrantId!==a.entrantId&&x.poolId===a.poolId)!,other=e.planAssignments.find(x=>x.poolId!==a.poolId)!;
 e.definitionRules=[{kind:"TOGETHER",entrantIds:[a.entrantId,same.entrantId]},{kind:"SEPARATE",entrantIds:[a.entrantId,other.entrantId]}];assert.equal(s.setMembership(e).status,"COMMITTED");
 const before=s.export();[same.poolId,other.poolId]=[other.poolId,same.poolId];assert.equal(s.setMembership(e).status,"REJECTED");assert.deepEqual(s.export(),before);
});
test("D1: stale membership stays visible and blocks review until explicit clear or undo",()=>{
 const s=ready(),e=edit(s);s.setMembership(e);s.answer({"divisions.0.poolSizes":[5,3,4,4]});assert.equal(s.state,"BLOCKED");assert.ok(s.evaluate().compilation.findings.some(f=>f.code==="MEMBERSHIP_INVALID"));
 s.undo();assert.equal(s.state,"READY_FOR_REVIEW");s.answer({"divisions.0.poolSizes":[5,3,4,4]});s.clearMembership(e.stageId);assert.equal(s.state,"READY_FOR_REVIEW");
});
test("D1: duplicate/foreign entries, malformed rule and forged basis cannot commit",()=>{
 const s=ready(),base=edit(s);for(const change of [(e:MembershipEdit)=>e.planAssignments[0]!.entrantId="foreign",(e:MembershipEdit)=>e.planAssignments[0]!.entrantId=e.planAssignments[1]!.entrantId,(e:MembershipEdit)=>e.basisHash="fake",(e:MembershipEdit)=>e.definitionRules.push({kind:"SEPARATE",entrantIds:["missing","other"]})]){const e=structuredClone(base),before=s.export();change(e);assert.equal(s.setMembership(e).status,"REJECTED");assert.deepEqual(s.export(),before);}
});
test("D1: named imported roster survives pool editing without synthetic identities",()=>{
 const template=ready().evaluate().interpretation.draft;
 const source={mode:"csv" as const,text:"entrant_id,display_name,division_id,member_ids,seed\n"+Array.from({length:16},(_,i)=>`pair-${i},Named pair ${i},open,person-${i}-a|person-${i}-b,${i+1}`).join("\n")};
 const s=new CreatorSession(source);const values:Record<string,any>={};
 for(const [key,value] of Object.entries(template))if(key!=="divisions"&&value!==null)values[key]=value;
 for(const [key,value] of Object.entries(template.divisions[0]!))if(key!=="id"&&value!==null)values[`divisions.0.${key}`]=value;
 assert.equal(s.answer(values).status,"COMMITTED");assert.equal(s.state,"READY_FOR_REVIEW");
 const e=edit(s),a=e.planAssignments[0]!,b=e.planAssignments[4]!;[a.poolId,b.poolId]=[b.poolId,a.poolId];assert.equal(s.setMembership(e).status,"COMMITTED");
 const roster=s.evaluate().interpretation.roster;assert.equal(roster[0]!.displayName,"Named pair 0");assert.deepEqual(roster[0]!.memberIds,["person-0-a","person-0-b"]);assert.ok(s.evaluate().compilation.memberships![0]!.planAssignments.every(a=>a.entrantId.startsWith("pair-")));
});

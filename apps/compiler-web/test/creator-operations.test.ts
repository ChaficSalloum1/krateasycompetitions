import assert from "node:assert/strict";
import test from "node:test";
import {CreatorSession} from "../src/creator/session.js";
import {examples} from "../src/creator/examples.js";
import {individualResources,type OperationsEdit} from "../src/creator/operations.js";
function ready(){return new CreatorSession({mode:"language",text:examples.Knockout});}
function edit(s:CreatorSession):OperationsEdit{return {resources:individualResources(s.evaluate().compilation.spec!),durations:[]};}
test("D4a: individual windows and stage/round durations reach canonical spec with exact replay",()=>{
 const s=ready(),e=edit(s),w=e.resources[0]!.availability[0]!;
 const start=new Date(Date.parse(w.start)+60*60*1000).toISOString(),pause=new Date(Date.parse(w.start)+120*60*1000).toISOString(),resume=new Date(Date.parse(w.start)+150*60*1000).toISOString();
 e.resources[0]!.availability=[{start,end:pause},{start:resume,end:w.end}];
 const node=s.evaluate().compilation.graph!.nodes.find(n=>n.kind==='contest')!;e.durations=[{stageId:node.stageId,round:node.round,contestMinutes:50,turnaroundMinutes:5}];
 assert.equal(s.setOperations(e).status,'COMMITTED');const spec=s.evaluate().compilation.spec!;assert.deepEqual(spec.resources,e.resources);assert.ok(spec.scheduling.durations.some(d=>d.round===node.round&&d.contestMinutes===50));
 const replay=new CreatorSession(s.export().initialSource);for(const t of s.transitions)replay.execute(t.envelope);assert.deepEqual(replay.export(),s.export());
});
test("D4a: bad windows, duplicate courts, nonexistent rounds and invalid durations reject atomically",()=>{
 const s=ready(),base=edit(s);for(const change of [(e:OperationsEdit)=>e.resources[0]!.availability[0]!.start='11:00',(e:OperationsEdit)=>e.resources[0]!.availability.push({...e.resources[0]!.availability[0]!}),(e:OperationsEdit)=>e.resources.push(e.resources[0]!),(e:OperationsEdit)=>e.durations.push({stageId:'missing',contestMinutes:30,turnaroundMinutes:0}),(e:OperationsEdit)=>e.durations.push({stageId:s.evaluate().compilation.spec!.stages[0]!.id,round:'never',contestMinutes:30,turnaroundMinutes:0}),(e:OperationsEdit)=>e.resources[0]!.availability=[]]){const e=structuredClone(base),before=s.export();change(e);assert.equal(s.setOperations(e).status,'REJECTED');assert.deepEqual(s.export(),before);}
});
test("D4a: changed court count preserves overrides and blocks rather than silently discarding",()=>{
 const s=ready();s.setOperations(edit(s));s.answer({courts:3});assert.equal(s.state,'BLOCKED');assert.ok(s.export().operations);s.undo();assert.equal(s.state,'READY_FOR_REVIEW');s.answer({courts:3});s.clearOperations();assert.equal(s.state,'READY_FOR_REVIEW');
});

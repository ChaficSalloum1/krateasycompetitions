import assert from 'node:assert/strict';
import test from 'node:test';
import {CreatorSession} from '../src/creator/session.js';
import {examples} from '../src/creator/examples.js';
import {contestIdentity,type StartLock} from '../src/creator/plan-locks.js';
const ready=()=>new CreatorSession({mode:'language',text:examples.Knockout});
function lock(s:CreatorSession,index=0):StartLock{const {compilation:c,interpretation:p}=s.evaluate(),node=c.graph!.nodes.filter(n=>n.kind==='contest')[index]!;return {contestId:node.id,identityHash:contestIdentity(node,c.graph!,c.spec!,p.roster),start:c.spec!.scheduling.start};}
test('D4b: start lock stays plan-owned, projects a hard scheduler input, invalidates review and replays',()=>{
 const s=ready();s.review();const l=lock(s);assert.equal(s.setStartLock(l).status,'COMMITTED');assert.equal(s.reviewedHash,null);
 assert.deepEqual(s.export().planLocks,[l]);assert.ok(s.evaluate().compilation.spec!.scheduling.constraints.some(c=>c.id===`lock.${l.contestId}`&&c.strength==='HARD'));
 const replay=new CreatorSession(s.export().initialSource);for(const t of s.transitions)replay.execute(t.envelope);assert.deepEqual(replay.export(),s.export());
 s.removeStartLock(l.contestId);assert.equal(s.export().planLocks.length,0);s.undo();assert.deepEqual(s.export().planLocks,[l]);
});
test('D4b: forged identity, malformed time, outside windows and premature final reject atomically',()=>{
 const s=ready(),base=lock(s),before=s.export();const finalNode=s.evaluate().compilation.graph!.nodes.filter(n=>n.kind==='contest').at(-1)!;
 for(const candidate of [{...base,identityHash:'forged'},{...base,start:'11:00'},{...base,start:'2000-01-01T00:00:00Z'},{contestId:finalNode.id,identityHash:contestIdentity(finalNode,s.evaluate().compilation.graph!,s.evaluate().compilation.spec!,s.evaluate().interpretation.roster),start:base.start}]){assert.equal(s.setStartLock(candidate).status,'REJECTED');assert.deepEqual(s.export(),before);}
});
test('D4b: structural edits cannot silently retarget locks; incompatible duration blocks until undo',()=>{
 const s=ready(),l=lock(s);s.setStartLock(l);s.answer({'divisions.0.entrants':16});assert.equal(s.state,'BLOCKED');assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='PLAN_LOCK_INVALID'));assert.deepEqual(s.export().planLocks,[l]);s.undo();assert.equal(s.state,'READY_FOR_REVIEW');
 const end=s.evaluate().compilation.spec!.scheduling.finishBy!;s.removeStartLock(l.contestId);s.setStartLock({...l,start:new Date(Date.parse(end)-30*60_000).toISOString()});s.answer({duration:60});assert.equal(s.state,'BLOCKED');s.undo();assert.equal(s.state,'READY_FOR_REVIEW');
});
test('D4b: overlapping locks beyond court capacity reject without changing the first lock',()=>{
 const s=ready();s.answer({courts:1});const first=lock(s,0);assert.equal(s.setStartLock(first).status,'COMMITTED');const before=s.export();assert.equal(s.setStartLock(lock(s,1)).status,'REJECTED');assert.deepEqual(s.export(),before);
});
test('D4b: same entrant locked before minimum rest is rejected',()=>{
 const s=new CreatorSession({mode:'language',text:examples['Round robin']});const first=lock(s),graph=s.evaluate().compilation.graph!,node=graph.nodes.find(n=>n.id===first.contestId)!;
 const ids=node.slots.flatMap(slot=>slot.type==='entrant'?[slot.entrantId]:[]),other=graph.nodes.find(n=>n.id!==node.id&&n.kind==='contest'&&n.slots.some(slot=>slot.type==='entrant'&&ids.includes(slot.entrantId)))!;
 s.setStartLock(first);const before=s.export();const next={contestId:other.id,identityHash:contestIdentity(other,graph,s.evaluate().compilation.spec!,s.evaluate().interpretation.roster),start:new Date(Date.parse(first.start)+30*60_000).toISOString()};assert.equal(s.setStartLock(next).status,'REJECTED');assert.deepEqual(s.export(),before);
});

test('D4c: court pins are exported, independently checked, undoable and replayable',async()=>{
 const {courtUnits}=await import('../src/creator/plan-locks.js');
 const {solveSchedule,validateSchedule}=await import('../../../packages/competition-engine/src/scheduler.js');
 const s=ready(),unit=courtUnits(s.evaluate().compilation.spec!)[1]!.id,l={...lock(s),resourceUnitId:unit};
 assert.equal(s.setStartLock(l).status,'COMMITTED');
 const {spec,graph}=s.evaluate().compilation;
 assert.ok(spec!.scheduling.constraints.some(c=>c.rule==='locked_match_resource'&&c.value===unit));
 const solution=solveSchedule(spec!,graph!);assert.equal(solution.contests.find(c=>c.contestId===l.contestId)?.resourceId,unit);
 assert.deepEqual(validateSchedule(spec!,graph!,solution).filter(f=>f.severity==='ERROR'),[]);
 const tampered=structuredClone(solution);tampered.contests.find(c=>c.contestId===l.contestId)!.resourceId=courtUnits(spec!)[0]!.id;
 assert.ok(validateSchedule(spec!,graph!,tampered).some(f=>f.code==='TSV410'));
 const replay=ready();for(const t of s.transitions)replay.execute(t.envelope);assert.deepEqual(replay.export(),s.export());
 s.removeStartLock(l.contestId);s.undo();assert.deepEqual(s.export().planLocks,[l]);
});
test('D4c: unknown, closed and double-booked courts reject atomically; different courts work',async()=>{
 const {courtUnits}=await import('../src/creator/plan-locks.js');
 const {individualResources}=await import('../src/creator/operations.js');
 const s=ready(),resources=individualResources(s.evaluate().compilation.spec!);
 resources[0]!.availability[0]!.start=new Date(Date.parse(resources[0]!.availability[0]!.start)+3600000).toISOString();
 assert.equal(s.setOperations({resources,durations:[]}).status,'COMMITTED');
 const courts=courtUnits(s.evaluate().compilation.spec!),base=lock(s),before=s.export();
 for(const resourceUnitId of ['missing','',courts[0]!.id]){assert.equal(s.setStartLock({...base,resourceUnitId}).status,'REJECTED');assert.deepEqual(s.export(),before);}
 assert.equal(s.setStartLock({...base,resourceUnitId:courts[1]!.id}).status,'COMMITTED');
 const pinned=s.export();assert.equal(s.setStartLock({...lock(s,1),resourceUnitId:courts[1]!.id}).status,'REJECTED');assert.deepEqual(s.export(),pinned);
 s.removeStartLock(base.contestId);s.clearOperations();const units=courtUnits(s.evaluate().compilation.spec!);
 assert.equal(s.setStartLock({...lock(s),resourceUnitId:units[0]!.id}).status,'COMMITTED');assert.equal(s.setStartLock({...lock(s,1),resourceUnitId:units[1]!.id}).status,'COMMITTED');
 s.answer({courts:1});assert.equal(s.state,'BLOCKED');assert.equal(s.export().planLocks.length,2);s.undo();assert.equal(s.state,'READY_FOR_REVIEW');
});

test('D4c: scheduler reserves a later contest pin and rejects malformed or contradictory constraints',async()=>{
 const {courtUnits}=await import('../src/creator/plan-locks.js');
 const {solveSchedule,validateSchedule}=await import('../../../packages/competition-engine/src/scheduler.js');
 const s=ready(),l={...lock(s,1),resourceUnitId:courtUnits(s.evaluate().compilation.spec!)[0]!.id};
 assert.equal(s.setStartLock(l).status,'COMMITTED');const {spec,graph}=s.evaluate().compilation;
 const scheduled=solveSchedule(spec!,graph!);assert.equal(scheduled.contests.find(c=>c.contestId===l.contestId)?.resourceId,l.resourceUnitId);
 assert.deepEqual(validateSchedule(spec!,graph!,scheduled).filter(f=>f.severity==='ERROR'),[]);
 const pin=spec!.scheduling.constraints.find(c=>c.rule==='locked_match_resource')!;
 const node=graph!.nodes.find(n=>n.id===l.contestId)!;
 for(const mutate of [
  (copy:typeof spec)=>{copy!.scheduling.constraints.push({...pin});},
  (copy:typeof spec)=>{copy!.scheduling.constraints=copy!.scheduling.constraints.filter(c=>c.rule!=='locked_match_start');},
  (copy:typeof spec)=>{copy!.scheduling.constraints.find(c=>c.rule==='locked_match_resource')!.strength='SOFT';},
  (copy:typeof spec)=>{copy!.scheduling.constraints.push({id:'conflict',rule:'required_resource',strength:'HARD',value:JSON.stringify({stageId:node.stageId,round:node.round,resourceId:courtUnits(spec!)[1]!.id})});}
 ]){const copy=structuredClone(spec);mutate(copy);assert.ok(solveSchedule(copy!,graph!).findings.some(f=>f.code==='TSV412'));assert.ok(validateSchedule(copy!,graph!,scheduled).some(f=>f.code==='TSV412'));}
});


test('D4c: graph CP-SAT adapter rejects unsupported court projections instead of ignoring them',async()=>{
 const {compileGraphSchedulingProblem}=await import('../../../packages/competition-engine/src/scheduling-quality.js');
 const {spec,graph}=ready().evaluate().compilation;
 const copy=structuredClone(spec!);copy.scheduling.constraints.push({id:'courtlock.missing',rule:'locked_match_resource',strength:'HARD',value:'missing'});
 const result=compileGraphSchedulingProblem(copy,graph!);assert.equal(result.status,'REJECTED');assert.equal(result.problem,null);assert.ok(result.findings.some(f=>f.code==='TSQ102'));
});

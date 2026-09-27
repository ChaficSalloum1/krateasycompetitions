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

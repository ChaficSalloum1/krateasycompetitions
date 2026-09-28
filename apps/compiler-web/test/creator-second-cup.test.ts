import assert from 'node:assert/strict';
import test from 'node:test';
import {CreatorSession} from '../src/creator/session.js';
import {examples} from '../src/creator/examples.js';
const ready=()=>{const s=new CreatorSession({mode:'language',text:examples['Pools to cups']});s.answer({'divisions.0.comparison':'percentage'});return s;};

test('D6: second-cup choices reach only its draw policy, with exact replay and reset',()=>{
 const s=ready(),initial=s.evaluate().compilation.spec!;
 assert.equal(initial.drawPolicies.length,2);
 assert.equal(s.answer({'divisions.0.secondaryProtectedSeeds':4,'divisions.0.secondaryRematches':'allow','divisions.0.secondaryBracketSlots':16}).status,'COMMITTED');
 assert.equal(s.state,'READY_FOR_REVIEW');const spec=s.evaluate().compilation.spec!;
 const main=spec.drawPolicies.find(p=>p.id.endsWith('.main.draw'))!,secondary=spec.drawPolicies.find(p=>p.id.endsWith('.secondary.draw'))!;
 assert.equal(main.protectedSeedCount,2);assert.equal(secondary.protectedSeedCount,4);
 assert.ok(main.priorities.some(p=>p.rule==='avoid_opening_round_rematch'));
 assert.ok(!secondary.priorities.some(p=>p.rule==='avoid_opening_round_rematch'));
 assert.equal(s.evaluate().interpretation.draft.divisions[0]!.secondaryBracketSlots,16);
 const replay=new CreatorSession(s.export().initialSource);for(const t of s.transitions)assert.equal(replay.execute(t.envelope).status,'COMMITTED');assert.deepEqual(replay.export(),s.export());
 assert.equal(s.clearSecondaryBracket(0).status,'COMMITTED');assert.equal(s.state,'READY_FOR_REVIEW');
 assert.deepEqual(s.evaluate().compilation.spec!.drawPolicies,initial.drawPolicies);
 s.undo();assert.equal(s.evaluate().compilation.spec!.drawPolicies.find(p=>p.id.endsWith('.secondary.draw'))!.protectedSeedCount,4);
});

test('D6: impossible capacity and orphaned second-cup overrides block review until explicit reset',()=>{
 const s=ready();assert.equal(s.answer({'divisions.0.secondaryBracketSlots':8}).status,'COMMITTED');
 assert.equal(s.state,'BLOCKED');assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='CARDINALITY_MISMATCH'&&f.message.includes('2 entries')));
 assert.equal(s.review(),false);assert.equal(s.clearSecondaryBracket(0).status,'COMMITTED');assert.equal(s.state,'READY_FOR_REVIEW');
 s.answer({'divisions.0.secondaryProtectedSeeds':4});s.answer({'divisions.0.remainder':'eliminated'});
 assert.equal(s.state,'BLOCKED');assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='ORPHAN_POLICY'));
 const before=s.export();assert.equal(s.clearSecondaryBracket(22).status,'REJECTED');assert.deepEqual(s.export(),before);
 assert.equal(s.clearSecondaryBracket(0).status,'COMMITTED');assert.equal(s.state,'READY_FOR_REVIEW');
});

test('D6: seed protection cannot ask for more protected entrants than a cup receives',()=>{
 const s=ready();
 s.answer({'divisions.0.qualification':'best_overall','divisions.0.places':14,'divisions.0.bracketSlots':16,'divisions.0.secondaryProtectedSeeds':4});
 assert.equal(s.state,'BLOCKED');assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='SEED_PROTECTION'&&f.message.includes('second-cup')));
});

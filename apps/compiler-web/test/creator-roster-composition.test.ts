import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {CreatorSession} from '../src/creator/session.js';
import {examples} from '../src/creator/examples.js';
import {canonicalHash} from '@tournament-os/tournament-schema';
import {ingestCreationSource} from '../src/creation-source-ingestion.js';

const planning=JSON.parse(readFileSync(new URL('../../../scenario/play-konnect-reference/source.json',import.meta.url),'utf8')) as {pools:Record<string,Record<string,string[]>>};
const csv='entrant_id,display_name,division_id,member_ids,seed\n'+Object.entries(planning.pools).flatMap(([division,pools])=>Object.entries(pools).flatMap(([pool,names])=>names.map((name,index)=>{
 const id=`${division.toLowerCase()}-${pool}-${index+1}`;
 return `${id},"${name.replaceAll('"','""')}",${division},${id}-person-1|${id}-person-2,${index+1}`;
}))).join('\n');
const rosterSource={mode:'csv' as const,text:csv};
test('D5: downloadable planning roster matches the source-backed review fixture',()=>{
 const fixture=readFileSync(new URL('../../../scenario/play-konnect-reference/studio-review-roster.csv',import.meta.url),'utf8');
 assert.deepEqual(ingestCreationSource({mode:'csv',text:fixture}).entrants,ingestCreationSource(rosterSource).entrants);
});

test('D5: P&K planning roster composes with format across three divisions without invented entrants',()=>{
 const s=new CreatorSession({mode:'language',text:examples['St Albans structure']});
 assert.equal(s.state,'READY_FOR_REVIEW');assert.equal(s.attachRoster(rosterSource).status,'COMMITTED');
 const {interpretation:p,compilation:c}=s.evaluate();assert.equal(s.state,'READY_FOR_REVIEW');assert.equal(c.status,'PROPOSED');
 assert.equal(p.roster.length,48);assert.deepEqual(p.draft.divisions.map(d=>d.entrants),[12,23,13]);
 assert.equal(new Set(p.roster.map(r=>r.id)).size,48);assert.equal(p.facts.filter(f=>f.path.startsWith('roster.')).length,48);
 assert.ok(p.facts.filter(f=>f.path.startsWith('roster.')).every(f=>f.sourceHash===canonicalHash(rosterSource)&&f.locator.startsWith('table:entrant_id=')));
 assert.ok(c.memberships?.every(v=>v.planAssignments.length===p.roster.filter(e=>e.divisionId===v.stageId.split('.')[0]).length));
 assert.equal(s.review(),true);assert.equal(s.state,'REVIEWED');
 const first=c.memberships![0]!,edit={stageId:first.stageId,basisHash:first.basisHash,definitionRules:[],planAssignments:structuredClone(first.planAssignments)};
 const a=edit.planAssignments[0]!,b=edit.planAssignments.find(x=>x.poolId!==a.poolId)!;[a.poolId,b.poolId]=[b.poolId,a.poolId];
 assert.equal(s.setMembership(edit).status,'COMMITTED');assert.equal(s.state,'READY_FOR_REVIEW');
 const replay=new CreatorSession(s.export().initialSource);for(const t of s.transitions)assert.equal(replay.execute(t.envelope).status,'COMMITTED');assert.deepEqual(replay.export(),s.export());
});

test('D5: count change and unknown division block without losing attached source or rules',()=>{
 const s=new CreatorSession({mode:'language',text:examples['St Albans structure']});
 s.attachRoster(rosterSource);s.answer({'divisions.0.entrants':11});assert.equal(s.state,'BLOCKED');
 assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='ROSTER_ACCOUNTING'));assert.equal(s.evaluate().interpretation.roster.length,48);
 s.undo();assert.equal(s.state,'READY_FOR_REVIEW');
 const bad={mode:'csv' as const,text:csv.replace(',Beginners,',',UnknownDivision,')};
 assert.equal(s.attachRoster(bad).status,'COMMITTED');assert.equal(s.state,'BLOCKED');
 assert.ok(s.evaluate().interpretation.failures.some(f=>f.startsWith('ROSTER_DIVISION:')));
 assert.equal(s.rosterSource?.text,bad.text);s.removeRoster();assert.equal(s.state,'READY_FOR_REVIEW');
 s.undo();assert.equal(s.state,'BLOCKED');
});

test('D5: malformed source and forged command reject atomically; changing format does not clear roster',()=>{
 const s=new CreatorSession({mode:'language',text:examples['St Albans structure']}),before=s.export();
 assert.equal(s.attachRoster({mode:'csv',text:'wrong,header\n1,2'}).status,'REJECTED');assert.deepEqual(s.export(),before);
 const envelope={id:'attach-once',expectedRevision:s.revision,command:{type:'ATTACH_ROSTER' as const,source:rosterSource}};
 assert.equal(s.execute(envelope).status,'COMMITTED');const applied=s.export();assert.deepEqual(s.execute(envelope),{status:'COMMITTED',revision:applied.revision,state:applied.state,hash:applied.hash});
 assert.equal(s.execute({...envelope,command:{type:'REMOVE_ROSTER'}}).status,'REJECTED');assert.deepEqual(s.export(),applied);
 s.changeSource({mode:'language',text:examples['St Albans structure'].replace('Advanced: 12 pairs','Advanced: 11 pairs')});
 assert.equal(s.state,'BLOCKED');assert.deepEqual(s.rosterSource,rosterSource);assert.equal(s.review(),false);
 s.undo();assert.equal(s.state,'READY_FOR_REVIEW');
});

test('D5: replacing entrant identities leaves a saved pool assignment stale until cleared',()=>{
 const s=new CreatorSession({mode:'language',text:examples['St Albans structure']});s.attachRoster(rosterSource);
 const view=s.evaluate().compilation.memberships![0]!;
 assert.equal(s.setMembership({stageId:view.stageId,basisHash:view.basisHash,definitionRules:[],planAssignments:view.planAssignments}).status,'COMMITTED');
 const replacement={mode:'csv' as const,text:csv.replace('advanced-1-1,','advanced-replacement,')
   .replace('advanced-1-1-person-1|advanced-1-1-person-2','replacement-person-1|replacement-person-2')};
 assert.equal(s.attachRoster(replacement).status,'COMMITTED');assert.equal(s.state,'BLOCKED');
 assert.ok(s.evaluate().compilation.findings.some(f=>f.code==='MEMBERSHIP_INVALID'));
 assert.equal(s.evaluate().interpretation.roster.length,48);assert.equal(s.review(),false);
 assert.equal(s.clearMembership(view.stageId).status,'COMMITTED');assert.equal(s.state,'READY_FOR_REVIEW');
});

test('D5: attached roster does not resolve an unspecified cross-pool comparison',()=>{
 const s=new CreatorSession({mode:'language',text:examples['Pools to cups']});
 const source={mode:'csv' as const,text:'entrant_id,display_name,division_id,member_ids,seed\n'+Array.from({length:16},(_,i)=>`pair-${i},Pair ${i},Open,p-${i}-a|p-${i}-b,${i+1}`).join('\n')};
 assert.equal(s.attachRoster(source).status,'COMMITTED');assert.equal(s.state,'NEEDS_DECISIONS');
 assert.ok(s.evaluate().interpretation.decisions.some(d=>d.path==='divisions.0.comparison'));
 assert.equal(s.evaluate().interpretation.roster.length,16);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assignSeeds } from "../src/seed-assignment.js";
import { assurePlacement } from "../src/draw-assurance.js";
import { placeConstraintDraw } from "../src/draw-constraints.js";
import { compileTopology } from "../src/topology-compiler.js";
import type { Entrant } from "../src/types.js";

const entries = (n:number, pools:number, unequal=false):Entrant[] => Array.from({length:n},(_,i)=>({id:`E${String(i+1).padStart(2,"0")}`,divisionId:"open",memberIds:[`P${i}`],poolId:`pool${unequal ? Math.min(pools-1,Math.floor(i*pools/(n+1))) : i%pools}`}));
for(const n of [4,6,8,10,12,16]) test(`B property ${n}: pools 2–5, equal/unequal, exact identity, protected tiers/byes and resolvable play-ins`,()=>{
  for(const pools of [2,3,4,5]) for(const unequal of [false,true]) {
    const raw=entries(n,pools,unequal), seeded=assignSeeds(raw,raw.map(e=>e.id),"explicit-order/1");
    assert.equal(seeded.status,"READY"); assert.ok(raw.every(e=>e.seed===undefined));
    const topology=compileTopology({id:"cup",entrantCount:n});
    assert.equal(topology.proof.generatedCompetitiveMatchCount,n-1);
    assert.equal(topology.proof.allInputPortsResolved,true);
    const draw=placeConstraintDraw({structureId:"cup",entrants:seeded.entries,priorMeetings:[],protectedSeedCount:2});
    assert.equal(draw.status,"PLACED");
    const report=assurePlacement({qualifiers:seeded.entries,slots:draw.orderedSlotIds,protectedSeedCount:2,priorMeetings:[],avoidSamePool:true,avoidPriorOpponent:true});
    // Independent pigeonhole lower bound after mandatory high-seed byes.
    const playing=seeded.entries.slice(topology.proof.byeCount);
    const largest=Math.max(...Array.from(new Set(playing.map(e=>e.poolId))).map(pool=>playing.filter(e=>e.poolId===pool).length),0);
    const forced=Math.max(0,largest-playing.length/2);
    assert.equal(report.findings.filter(f=>f.code!=="SAME_POOL_REMATCH").length,0);
    assert.equal(report.findings.length,forced,JSON.stringify({n,pools,unequal,findings:report.findings,forced}));
  }
});
test("seeding cannot add, omit or duplicate a qualifier",()=>{
  const raw=entries(4,2);
  for(const ids of [["E01","E02","E03","alien"],["E01","E02","E03"],["E01","E02","E03","E03"]]) assert.equal(assignSeeds(raw,ids,"order/1").status,"BLOCKED");
});
test("incomplete placement search returns UNKNOWN, never a false infeasibility proof",()=>{
  const raw=entries(10,2).map((e,i)=>({...e,seed:i+1,poolId:"one"}));
  const result=placeConstraintDraw({structureId:"cup",entrants:raw,priorMeetings:[],candidateLimit:1,constraints:{avoid_same_pool_rematch:{strength:"HARD"}}});
  assert.equal(result.status,"UNKNOWN");assert.equal(result.searchComplete,false);assert.deepEqual(result.unavoidableViolations,[]);
});
test("historical P&K stale Tower exclusions cannot duplicate a qualifier or lose another",()=>{
  const source=JSON.parse(readFileSync(new URL("../../../scenario/play-konnect-knockout-regression/source.json",import.meta.url),"utf8"));
  const qualifiers:Entrant[]=source.qualifiers.map((id:string,i:number)=>({id,divisionId:"INT",memberIds:[id],seed:i+1}));
  const corrupt=assurePlacement({qualifiers,slots:source.stalePlacement,protectedSeedCount:2,priorMeetings:[],avoidSamePool:false,avoidPriorOpponent:false});
  assert.equal(corrupt.status,"BLOCKED");
  assert.ok(corrupt.findings.some(f=>f.code==="QUALIFIER_MULTIPLICITY"&&f.entries.includes("A4")));
  assert.ok(corrupt.findings.some(f=>f.code==="QUALIFIER_MULTIPLICITY"&&f.entries.includes("D3")));
  const draw=placeConstraintDraw({structureId:"tower",entrants:qualifiers,priorMeetings:[]});
  assert.equal(assurePlacement({qualifiers,slots:draw.orderedSlotIds,protectedSeedCount:4,priorMeetings:[],avoidSamePool:false,avoidPriorOpponent:false}).status,"READY");
});
test("top-four protection includes top-two opposite halves; previous opponents avoided",()=>{
  const qualifiers=entries(8,4).map((e,i)=>({...e,seed:i+1}));
  const priorMeetings:[[string,string]]=[["E01","E08"]];
  const draw=placeConstraintDraw({structureId:"cup",entrants:qualifiers,priorMeetings,protectedSeedCount:4});
  assert.equal(assurePlacement({qualifiers,slots:draw.orderedSlotIds,protectedSeedCount:4,priorMeetings,avoidSamePool:true,avoidPriorOpponent:true}).status,"READY");
  const forged=["E01","E05","E02","E06","E03","E07","E04","E08"];
  assert.ok(assurePlacement({qualifiers,slots:forged,protectedSeedCount:4,priorMeetings:[],avoidSamePool:false,avoidPriorOpponent:false}).findings.some(f=>f.code==="SEED_PROTECTION"));
});

test("qualification is unseeded and two destinations partition entrants without reselection",async()=>{
  const { qualifyEntries }=await import("../src/qualification.js");
  const { compileDefinition }=await import("@tournament-os/tournament-schema");
  const { playAndKonnectDefinition }=await import("@tournament-os/tournament-schema/example");
  const definition=structuredClone(playAndKonnectDefinition);
  const spec=compileDefinition(definition,{specId:"two-cups",revision:1,schemaVersion:"1.0.0",compilerVersion:"B",rulesetVersions:{competition:"1"},sourcePrompt:"explicit test",createdAt:"2026-09-27T00:00:00Z"});
  const { createEntrants }=await import("../src/graph.js");
  const entrants=createEntrants(spec);
  const standings:Record<string,import("../src/types.js").Standing[]>={};
  for(const division of spec.divisions){
    const stage=spec.stages.find(s=>s.divisionId===division.id&&s.pool)!;
    let i=0;standings[stage.id]=stage.pool!.sizes.flatMap((size,pool)=>Array.from({length:size},(_,rank)=>{
      const entry=entrants[division.id]![i++]!;
      return {entrantId:entry.id,poolId:`${division.id}.${pool}`,played:size-1,wins:size-rank-1,losses:rank,draws:0,scoreFor:100-rank,scoreAgainst:rank,scoreDifference:100-rank*2,winningPercentage:(size-rank-1)/(size-1),tieResolution:[],rank:rank+1};
    }));
  }
  const result=qualifyEntries(spec,standings,entrants);
  assert.deepEqual(result.findings,[]);
  for(const division of spec.divisions){
    const structures=spec.competitionStructures.filter(s=>s.divisionId===division.id);
    const all=structures.flatMap(s=>result.byStructure[s.id]??[]);
    assert.equal(all.length,division.participantCount);assert.equal(new Set(all.map(e=>e.id)).size,all.length);
    assert.ok(all.every(e=>e.seed===undefined));
    for(const structure of structures){const selected=result.byStructure[structure.id]!;assert.equal(assignSeeds(selected,selected.map(e=>e.id),"selector-order/1").status,"READY");}
  }
});

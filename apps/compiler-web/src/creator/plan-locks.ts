import {canonicalHash,type TournamentSpec} from "@tournament-os/tournament-schema";
import type {CompetitionGraph,ContestNode} from "../../../../packages/competition-engine/src/types.js";
import {topologicalNodes,durationFor} from "../../../../packages/competition-engine/src/scheduler.js";
import {deriveContestEntrantsIndependently,deriveQualificationOccupancy} from "../../../../packages/competition-engine/src/independent-entrants.js";
import {instant} from "./operations.js";
import type {Interpretation} from "./interpretation.js";
export interface StartLock {contestId:string;identityHash:string;start:string;resourceUnitId?:string;}
export function courtUnits(spec:TournamentSpec){return spec.resources.filter(r=>r.type==="court").flatMap(r=>Array.from({length:r.quantity},(_,i)=>({id:`${r.id}.${i+1}`,availability:r.availability})));}
const duration=(node:ContestNode,spec:TournamentSpec)=>durationFor(node,spec.scheduling)*60_000;
export function contestIdentity(node:ContestNode,graph:CompetitionGraph,spec:TournamentSpec,roster:Interpretation["roster"]){
 const ids=new Set([node.id]),pending=[node.id];
 while(pending.length){const id=pending.pop()!;for(const edge of graph.edges.filter(e=>e.toContestId===id))if(!ids.has(edge.fromContestId)){ids.add(edge.fromContestId);pending.push(edge.fromContestId);}}
 return canonicalHash({node,ancestry:graph.nodes.filter(n=>ids.has(n.id)).sort((a,b)=>a.id.localeCompare(b.id)),qualification:spec.qualificationPolicies,standings:spec.standingsPolicies,roster:roster.filter(e=>e.divisionId===node.divisionId).map(e=>({id:e.id,memberIds:e.memberIds})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function inspectStartLocks(locks:StartLock[],spec:TournamentSpec,graph:CompetitionGraph,roster:Interpretation["roster"]){
 const ids=new Set<string>(),courts=courtUnits(spec);
 for(const lock of locks){
  const node=graph.nodes.find(n=>n.id===lock.contestId&&n.kind==="contest");
  if(!node||ids.has(lock.contestId)||lock.identityHash!==contestIdentity(node,graph,spec,roster))throw new Error("Start lock is stale or duplicated. Unlock explicitly; contest identity or progression changed.");ids.add(lock.contestId);
  if(!instant(lock.start))throw new Error("Locked start requires a full ISO time with an offset.");
  const start=Date.parse(lock.start),end=start+duration(node,spec);
  if(lock.resourceUnitId!==undefined){
   const court=courts.find(c=>c.id===lock.resourceUnitId);
   if(!court||!court.availability.some(w=>start>=Date.parse(w.start)&&end<=Date.parse(w.end)))throw new Error("Pinned court is missing or the contest does not fit its availability. Unlock explicitly or change the pin.");
  }
  if(start<Date.parse(spec.scheduling.start)||end>Date.parse(spec.scheduling.finishBy!)||!spec.resources.some(r=>r.availability.some(w=>start>=Date.parse(w.start)&&end<=Date.parse(w.end))))throw new Error("Locked contest does not fit a committed court window and event envelope.");
 }
 const intervals=locks.map(l=>({start:Date.parse(l.start),end:Date.parse(l.start)+duration(graph.nodes.find(n=>n.id===l.contestId)!,spec)}));
 const boundaries=[...new Set([...intervals.flatMap(i=>[i.start,i.end]),...spec.resources.flatMap(r=>r.availability.flatMap(w=>[Date.parse(w.start),Date.parse(w.end)]))])].sort((a,b)=>a-b);
 for(let i=0;i<boundaries.length-1;i++){
  const start=boundaries[i]!,end=boundaries[i+1]!,active=intervals.filter(w=>w.start<end&&w.end>start).length;
  const capacity=spec.resources.filter(r=>r.availability.some(w=>Date.parse(w.start)<=start&&Date.parse(w.end)>=end)).reduce((n,r)=>n+r.quantity,0);
  if(active>capacity)throw new Error("Overlapping start locks exceed available court capacity.");
 }
 // This is a necessary dependency bound, not a schedule search or feasibility proof.
 const earliestEnd=new Map<string,number>();
 for(const node of topologicalNodes(graph)){
  const ready=Math.max(Date.parse(spec.scheduling.start),...graph.edges.filter(e=>e.toContestId===node.id).map(e=>earliestEnd.get(e.fromContestId)??Date.parse(spec.scheduling.start)));
  const lock=locks.find(l=>l.contestId===node.id),start=lock?Date.parse(lock.start):ready;
  if(start<ready)throw new Error("Locked contest starts before its dependencies can finish, even without resource contention.");
  earliestEnd.set(node.id,start+(node.kind==="contest"?duration(node,spec):0));
 }
 for(let i=0;i<locks.length;i++)for(let j=i+1;j<locks.length;j++){
  const a=locks[i]!,b=locks[j]!;
  if(a.resourceUnitId!==undefined&&a.resourceUnitId===b.resourceUnitId&&Date.parse(a.start)<Date.parse(b.start)+duration(graph.nodes.find(n=>n.id===b.contestId)!,spec)&&Date.parse(b.start)<Date.parse(a.start)+duration(graph.nodes.find(n=>n.id===a.contestId)!,spec))throw new Error("Pinned contests overlap on the same court.");
 }
 const occupancy=deriveQualificationOccupancy(graph);
 const entrants=deriveContestEntrantsIndependently(graph),rest=Number(spec.scheduling.constraints.find(c=>c.rule==="minimum_rest"&&c.strength==="HARD")?.value??0)*60_000;
 const ordered=[...locks].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
  const a=ordered[i]!,b=ordered[j]!,node=graph.nodes.find(n=>n.id===a.contestId)!;
  const qualifiedCollision=[...(occupancy.byContest.get(a.contestId)??[])].some(([id,origins])=>{const other=occupancy.byContest.get(b.contestId)?.get(id);return other?occupancy.canMeet(origins,other):false;});
  if((qualifiedCollision||[...(entrants.get(a.contestId)??[])].some(id=>entrants.get(b.contestId)?.has(id)))&&Date.parse(b.start)<Date.parse(a.start)+duration(node,spec)+rest)throw new Error("Locked contests violate possible entrant collision or minimum rest.");
 }
}

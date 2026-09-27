import type {TournamentDefinition,TournamentSpec} from "@tournament-os/tournament-schema";
import type {CompetitionGraph} from "../../../../packages/competition-engine/src/types.js";
export interface OperationsEdit {
 resources:TournamentDefinition["resources"];
 durations:TournamentDefinition["scheduling"]["durations"];
}
export const instant=(value:string)=>typeof value==="string" && /T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
export function individualResources(spec:TournamentSpec):OperationsEdit["resources"] {
 return spec.resources.flatMap(r=>r.quantity===1?[structuredClone(r)]:Array.from({length:r.quantity},(_,i)=>({...structuredClone(r),id:`${r.id}.${i+1}`,quantity:1})));
}
export function applyOperations(definition:TournamentDefinition,edit:OperationsEdit,graph:CompetitionGraph){
 const expected=definition.resources.reduce((n,r)=>n+r.quantity,0),ids=new Set<string>();
 if(!Array.isArray(edit.resources)||edit.resources.length!==expected)throw new Error(`Expected ${expected} individual courts; saved resource count must be reconciled explicitly.`);
 for(const r of edit.resources){
  if(typeof r.id!=="string"||!r.id.trim()||ids.has(r.id)||r.quantity!==1||r.type!=="court")throw new Error("Courts need unique IDs, type court and quantity one.");ids.add(r.id);
  if(!Array.isArray(r.availability)||!r.availability.length)throw new Error("Each committed court needs at least one availability window.");
  let previousEnd=-Infinity;
  for(const window of r.availability){
   if(!instant(window.start)||!instant(window.end)||Date.parse(window.start)>=Date.parse(window.end)||Date.parse(window.start)<previousEnd)throw new Error("Court windows must have offset times, positive duration, and be ordered without overlap.");
   if(Date.parse(window.start)<Date.parse(definition.scheduling.start)||Date.parse(window.end)>Date.parse(definition.scheduling.finishBy!))throw new Error("Court window lies outside the event envelope.");previousEnd=Date.parse(window.end);
  }
 }
 const keys=new Set<string>();
 for(const duration of edit.durations){
  const key=JSON.stringify([duration.stageId,duration.round??null]);
  if(keys.has(key)||!definition.stages.some(s=>s.id===duration.stageId)||duration.round!==undefined&&!graph.nodes.some(n=>n.stageId===duration.stageId&&n.round===duration.round))throw new Error("Duration must reference one unique executable stage/round.");keys.add(key);
  if(!Number.isInteger(duration.contestMinutes)||duration.contestMinutes<1||duration.contestMinutes>240||!Number.isInteger(duration.turnaroundMinutes)||duration.turnaroundMinutes<0||duration.turnaroundMinutes>120)throw new Error("Contest duration must be 1–240 minutes and turnaround 0–120 minutes.");
 }
 // Keep base durations for stages without an explicit override; round overrides take precedence in the core scheduler.
 definition.resources=structuredClone(edit.resources);
 definition.scheduling.durations=[...definition.scheduling.durations.filter(d=>!edit.durations.some(e=>e.stageId===d.stageId&&e.round===d.round)),...structuredClone(edit.durations)];
}

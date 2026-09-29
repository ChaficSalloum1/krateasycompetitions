import {buildRequirementReport} from "./requirements.js";
import type {StartLock} from "./plan-locks.js";
import type {OperationsEdit} from "./operations.js";
import type {MembershipEdit} from "./membership.js";
import {readRosterSource,type RosterSource} from "./roster-source.js";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { interpret, getField, type Answers, type Value } from "./interpretation.js";
import { RULE_CATALOG_VERSION } from "./rule-catalog.js";
import { compileInterpretation } from "./definition.js";
import type { CreationSource } from "../creation-proposal.js";

export type DraftState = "NEEDS_DECISIONS" | "BLOCKED" | "READY_FOR_REVIEW" | "REVIEWED";
export type DraftCommand =
  | { type:"CHANGE_SOURCE"; source:CreationSource }
  | { type:"ATTACH_ROSTER"; source:RosterSource }
  | { type:"REMOVE_ROSTER" }
  | { type:"CLEAR_SECONDARY_BRACKET"; divisionIndex:number }
  | { type:"ANSWER"; values:Record<string,Value> }
  | { type:"SET_MEMBERSHIP"; edit:MembershipEdit }
  | { type:"CLEAR_MEMBERSHIP"; stageId:string }
  | { type:"SET_OPERATIONS"; edit:OperationsEdit }
  | { type:"CLEAR_OPERATIONS" }
  | { type:"SET_START_LOCK"; lock:StartLock }
  | { type:"REMOVE_START_LOCK"; contestId:string }
  | { type:"UNDO" }
  | { type:"REVIEW" };
export interface CommandEnvelope { id:string; expectedRevision:number; command:DraftCommand }
export type CommandReceipt = { status:"COMMITTED"; revision:number; state:DraftState; hash:string }
  | { status:"REJECTED"; code:"STALE"|"FORGED_INPUT"|"INVALID"|"NOTHING_TO_UNDO"|"VALIDATION_BLOCKED"; revision:number; message:string };
interface Inputs { source:CreationSource; rosterSource:RosterSource|null; answers:Answers; membership:MembershipEdit[]; operations:OperationsEdit|null; planLocks:StartLock[] }
export interface DraftTransition {
  envelope:CommandEnvelope; before:{revision:number;state:DraftState;hash:string};
  after:{revision:number;state:DraftState;hash:string};
}
const numeric = new Set(["entrants","places","runnersUp","bracketSlots","protectedSeeds","secondaryBracketSlots","secondaryProtectedSeeds","duration","rest","courts"]);
function sourceValid(source:CreationSource):boolean {
  if(!source || typeof source!=="object")return false;
  if(source.mode==="xlsx")return typeof source.fileName==="string" && typeof source.base64==="string" && source.base64.length<=7_000_000;
  if(source.mode==="quick")return source.value!==undefined;
  return ["language","json","yaml","csv"].includes(source.mode) && typeof source.text==="string" && source.text.length<=5_000_000;
}
function evaluate(inputs:Inputs,revision:number){
  const interpretation=interpret(inputs.source,inputs.answers,revision,inputs.rosterSource);
  const compilation=compileInterpretation(interpretation,inputs.membership,inputs.operations,inputs.planLocks);
  return {interpretation,compilation,requirements:buildRequirementReport(interpretation,compilation)};
}
function stateOf(current:ReturnType<typeof evaluate>,reviewedHash:string|null):DraftState {
  if(current.compilation.status==="BLOCKED")return "BLOCKED";
  if(current.compilation.status==="NEEDS_DECISION")return "NEEDS_DECISIONS";
  return reviewedHash===current.interpretation.hash?"REVIEWED":"READY_FOR_REVIEW";
}
/** A local draft aggregate. This is not the server mutation/Guard boundary. */
export class CreatorSession {
  #cached:{revision:number;value:ReturnType<typeof evaluate>}|null=null;
  #inputs:Inputs; #initial:CreationSource; #revision=1; #reviewedHash:string|null=null;
  #history:Inputs[]=[]; #transitions:DraftTransition[]=[];
  #receipts=new Map<string,{fingerprint:string;receipt:CommandReceipt}>(); #sequence=0;
  // Interaction telemetry is deliberately separate from the immutable command ledger.
  events:{event:string;revision:number;detail:string}[]=[];
  constructor(source:CreationSource){
    if(!sourceValid(source))throw new Error("Invalid creation source");
    this.#initial=structuredClone(source);
    this.#inputs={source:structuredClone(source),rosterSource:null,answers:{sourceHash:canonicalHash(source),ruleCatalogVersion:RULE_CATALOG_VERSION,values:{}},membership:[],operations:null,planLocks:[]};
  }
  get source(){return structuredClone(this.#inputs.source);}
  get rosterSource(){return structuredClone(this.#inputs.rosterSource);}
  get answers(){return structuredClone(this.#inputs.answers);}
  get revision(){return this.#revision;}
  get reviewedHash(){return this.#reviewedHash;}
  get history(){return structuredClone(this.#history);}
  get transitions(){return structuredClone(this.#transitions);}
  evaluate(){if(this.#cached?.revision!==this.#revision)this.#cached={revision:this.#revision,value:evaluate(this.#inputs,this.#revision)};return structuredClone(this.#cached.value);}
  get state(){return stateOf(this.evaluate(),this.#reviewedHash);}
  get hash(){return canonicalHash({inputs:this.#inputs,revision:this.#revision,reviewedHash:this.#reviewedHash});}
  execute(envelope:CommandEnvelope):CommandReceipt {
    const reject=(code:Extract<CommandReceipt,{status:"REJECTED"}>["code"],message:string):CommandReceipt=>({status:"REJECTED",code,revision:this.#revision,message});
    let fingerprint:string;
    try { fingerprint=canonicalHash(envelope); } catch {return reject("INVALID","Command must be serializable.");}
    if(!envelope || typeof envelope.id!=="string" || !envelope.id.trim() || envelope.id.length>200 || !Number.isSafeInteger(envelope.expectedRevision))return reject("INVALID","A command ID and integer revision are required.");
    const previous=this.#receipts.get(envelope.id);
    if(previous)return previous.fingerprint===fingerprint?structuredClone(previous.receipt):reject("FORGED_INPUT","Command ID was already used for different content.");
    const remember=(receipt:CommandReceipt)=>{this.#receipts.set(envelope.id,{fingerprint,receipt:structuredClone(receipt)});return receipt;};
    if(envelope.expectedRevision!==this.#revision)return remember(reject("STALE","Reload the current draft before applying this command."));
    try {
      const command=structuredClone(envelope.command),inputs=structuredClone(this.#inputs),history=structuredClone(this.#history);
      if(!command || !["CHANGE_SOURCE","ATTACH_ROSTER","REMOVE_ROSTER","CLEAR_SECONDARY_BRACKET","ANSWER","SET_MEMBERSHIP","CLEAR_MEMBERSHIP","SET_OPERATIONS","CLEAR_OPERATIONS","SET_START_LOCK","REMOVE_START_LOCK","UNDO","REVIEW"].includes(command.type))return remember(reject("INVALID","Unsupported draft command."));
      const before={revision:this.#revision,state:this.state,hash:this.hash};
      if(command.type==="CHANGE_SOURCE"){
        if(!sourceValid(command.source))return remember(reject("INVALID","Invalid source envelope."));
        history.push(structuredClone(inputs));inputs.source=command.source;inputs.answers={sourceHash:canonicalHash(command.source),ruleCatalogVersion:RULE_CATALOG_VERSION,values:{}};
      } else if(command.type==="ATTACH_ROSTER"){
        if(!command.source || !["csv","xlsx"].includes(command.source.mode) || !sourceValid(command.source))return remember(reject("INVALID","Only a valid CSV/XLSX entrant source can be attached."));
        try { readRosterSource(command.source); } catch(error) {return remember(reject("INVALID",error instanceof Error?error.message:"Roster import failed."));}
        history.push(structuredClone(inputs));inputs.rosterSource=command.source;
      } else if(command.type==="REMOVE_ROSTER"){
        if(inputs.rosterSource===null)return remember(reject("INVALID","No roster source is attached."));
        history.push(structuredClone(inputs));inputs.rosterSource=null;
      } else if(command.type==="CLEAR_SECONDARY_BRACKET"){
        if(!Number.isSafeInteger(command.divisionIndex)||command.divisionIndex<0||command.divisionIndex>=this.evaluate().interpretation.draft.divisions.length)return remember(reject("INVALID","Unknown second-cup division."));
        const keys=["secondaryBracketSlots","secondaryProtectedSeeds","secondaryByePolicy","secondaryRematches"].map(field=>`divisions.${command.divisionIndex}.${field}`);
        if(!keys.some(key=>Object.hasOwn(inputs.answers.values,key)))return remember(reject("INVALID","No visual second-cup overrides to clear. Edit the source if its policy is declared there."));
        history.push(structuredClone(inputs));for(const key of keys)delete inputs.answers.values[key];
      } else if(command.type==="ANSWER"){
        if(!command.values || typeof command.values!=="object" || Array.isArray(command.values) || !Object.keys(command.values).length)return remember(reject("INVALID","At least one answer is required."));
        const current=this.evaluate().interpretation;
        for(const [path,value] of Object.entries(command.values)){
          const field=path.split(".").at(-1)!;
          const question=current.unparsed.some(item=>item.id===path);
          const allowed=question?value==="context_only":
            /^(title|sport|duration|rest|courts|start|end|timezone|scoring|tiebreak|divisions\.\d+\.(label|entrants|format|poolSizes|qualification|places|runnersUp|comparison|remainder|cup|secondaryCup|bracketSlots|protectedSeeds|byePolicy|rematches|secondaryBracketSlots|secondaryProtectedSeeds|secondaryByePolicy|secondaryRematches))$/.test(path)
            && getField(current.draft,path)!==undefined
            && (numeric.has(field)?typeof value==="number"&&Number.isFinite(value):field==="poolSizes"?Array.isArray(value)&&value.every(n=>typeof n==="number"&&Number.isFinite(n)):typeof value==="string"&&value.length<=50000);
          if(!allowed)return remember(reject("INVALID",`Unsupported answer field or value: ${path}`));
        }
        history.push(structuredClone(inputs));Object.assign(inputs.answers.values,command.values);
      } else if(command.type==="SET_MEMBERSHIP" || command.type==="CLEAR_MEMBERSHIP"){
        history.push(structuredClone(inputs));
        const stageId=command.type==="SET_MEMBERSHIP"?command.edit.stageId:command.stageId;
        inputs.membership=inputs.membership.filter(e=>e.stageId!==stageId);
        if(command.type==="SET_MEMBERSHIP")inputs.membership.push(command.edit);
      } else if(command.type==="SET_OPERATIONS" || command.type==="CLEAR_OPERATIONS"){
        history.push(structuredClone(inputs));inputs.operations=command.type==="SET_OPERATIONS"?command.edit:null;
      } else if(command.type==="SET_START_LOCK" || command.type==="REMOVE_START_LOCK"){
        history.push(structuredClone(inputs));const id=command.type==="SET_START_LOCK"?command.lock.contestId:command.contestId;
        inputs.planLocks=inputs.planLocks.filter(l=>l.contestId!==id);if(command.type==="SET_START_LOCK")inputs.planLocks.push(command.lock);
      } else if(command.type==="UNDO"){
        const restored=history.pop();if(!restored)return remember(reject("NOTHING_TO_UNDO","No earlier draft inputs are available."));
        inputs.source=restored.source;inputs.rosterSource=restored.rosterSource;inputs.answers=restored.answers;inputs.membership=restored.membership;inputs.operations=restored.operations;inputs.planLocks=restored.planLocks;
      } else if(before.state!=="READY_FOR_REVIEW" && before.state!=="REVIEWED")return remember(reject("VALIDATION_BLOCKED","Resolve questions and findings before reviewing this draft."));
      const revision=this.#revision+1;
      // Derive the whole candidate before publishing any mutation to the aggregate.
      const candidate=evaluate(inputs,revision);
      if((command.type==="SET_MEMBERSHIP" || command.type==="SET_OPERATIONS" || command.type==="SET_START_LOCK") && candidate.compilation.status!=="PROPOSED")return remember(reject("VALIDATION_BLOCKED",candidate.compilation.findings.map(f=>f.message).join(" ")||"Resolve definition decisions first."));
      const reviewedHash=command.type==="REVIEW"?candidate.interpretation.hash:null;
      const after={revision,state:stateOf(candidate,reviewedHash),hash:canonicalHash({inputs,revision,reviewedHash})};
      const transition=structuredClone({envelope,before,after});
      this.#inputs=inputs;this.#revision=revision;this.#reviewedHash=reviewedHash;this.#cached={revision,value:candidate};
      this.#history=history.slice(-50);this.#transitions.push(transition);
      this.events.push({event:"draft_command_committed",revision,detail:`${command.type}: ${before.state} → ${after.state}`});
      return remember({status:"COMMITTED",...after});
    } catch(error){return remember(reject("INVALID",error instanceof Error?error.message:"Draft command could not be evaluated."));}
  }
  private dispatch(command:DraftCommand){
    let id:string;do{id=`local-${++this.#sequence}`;}while(this.#receipts.has(id));
    return this.execute({id,expectedRevision:this.#revision,command});
  }
  changeSource(source:CreationSource){return this.dispatch({type:"CHANGE_SOURCE",source});}
  attachRoster(source:RosterSource){return this.dispatch({type:"ATTACH_ROSTER",source});}
  removeRoster(){return this.dispatch({type:"REMOVE_ROSTER"});}
  clearSecondaryBracket(divisionIndex:number){return this.dispatch({type:"CLEAR_SECONDARY_BRACKET",divisionIndex});}
  answer(values:Record<string,Value>){return this.dispatch({type:"ANSWER",values});}
  setMembership(edit:MembershipEdit){return this.dispatch({type:"SET_MEMBERSHIP",edit});}
  clearMembership(stageId:string){return this.dispatch({type:"CLEAR_MEMBERSHIP",stageId});}
  setOperations(edit:OperationsEdit){return this.dispatch({type:"SET_OPERATIONS",edit});}
  clearOperations(){return this.dispatch({type:"CLEAR_OPERATIONS"});}
  setStartLock(lock:StartLock){return this.dispatch({type:"SET_START_LOCK",lock});}
  removeStartLock(contestId:string){return this.dispatch({type:"REMOVE_START_LOCK",contestId});}
  undo(){return this.dispatch({type:"UNDO"});}
  review(){return this.dispatch({type:"REVIEW"}).status==="COMMITTED";}
  export(){return structuredClone({artifact:"krateasy.creation-review/1.3.0",authority:"NON_AUTHORITATIVE_DRAFT",initialSource:this.#initial,rosterSource:this.#inputs.rosterSource,membership:this.#inputs.membership,operations:this.#inputs.operations,planLocks:this.#inputs.planLocks,source:this.#inputs.source,answers:this.#inputs.answers,revision:this.#revision,state:this.state,hash:this.hash,reviewedHash:this.#reviewedHash,...this.evaluate(),transitions:this.#transitions,events:this.events});}
}

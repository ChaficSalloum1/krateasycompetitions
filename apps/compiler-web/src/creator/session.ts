import { canonicalHash } from "@tournament-os/tournament-schema";
import { interpret,type Answers,type Value } from "./interpretation.js";
import { compileInterpretation } from "./definition.js";
import type { CreationSource } from "../creation-proposal.js";
export class CreatorSession {
  source:CreationSource;answers:Answers;revision=1;reviewedHash:string|null=null;
  history:{source:CreationSource;answers:Answers}[]=[];
  events:{event:string;revision:number;detail:string}[]=[];
  constructor(source:CreationSource){this.source=structuredClone(source);this.answers={sourceHash:canonicalHash(source),values:{}};}
  checkpoint(){this.history.push(structuredClone({source:this.source,answers:this.answers}));if(this.history.length>50)this.history.shift();}
  changeSource(source:CreationSource){this.checkpoint();this.source=structuredClone(source);this.answers={sourceHash:canonicalHash(source),values:{}};this.changed("source_changed","Prior answers invalidated");}
  answer(values:Record<string,Value>){this.checkpoint();Object.assign(this.answers.values,structuredClone(values));this.changed("open_decision_answered",Object.keys(values).join(", "));}
  changed(event:string,detail:string){this.revision++;this.reviewedHash=null;this.events.push({event,revision:this.revision,detail});}
  undo(){const before=this.history.pop();if(!before)return;this.source=before.source;this.answers=before.answers;this.changed("edit_reverted","Restored previous draft inputs");}
  evaluate(){const interpretation=interpret(this.source,this.answers,this.revision);return {interpretation,compilation:compileInterpretation(interpretation)};}
  review(){const current=this.evaluate();if(current.compilation.status!=="PROPOSED")return false;this.reviewedHash=current.interpretation.hash;this.events.push({event:"draft_reviewed",revision:this.revision,detail:"Local review only; not LOCK_DEFINITION"});return true;}
  export(){const current=this.evaluate();return {artifact:"krateasy.creation-review/1.0.0",authority:"NON_AUTHORITATIVE_DRAFT",source:this.source,answers:this.answers,reviewedHash:this.reviewedHash,...current,events:this.events};}
}

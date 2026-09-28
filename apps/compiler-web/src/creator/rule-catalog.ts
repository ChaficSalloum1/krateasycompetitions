import type {Decision,Draft,DivisionDraft,SourceFact,Value} from "./interpretation.js";

export const RULE_CATALOG_VERSION="creator-rule-catalog/1.0.0";
type Kind=Decision["kind"];
type Option={value:Value;label:string};
export interface RuleConcept {
  id:string; noun:string; field:string; scope:"competition"|"division";
  applies:(draft:Draft,division?:DivisionDraft)=>boolean;
  required:(draft:Draft,division?:DivisionDraft)=>boolean;
  question:(draft:Draft,division?:DivisionDraft)=>string;
  why:(draft:Draft,division?:DivisionDraft)=>string;
  kind:Kind; options?:Option[];
}
export interface RuleCoverage {
  ruleId:string; noun:string; path:string; status:"SOURCE"|"ANSWER"|"MISSING"|"CONFLICT"|"NOT_APPLICABLE"|"UNSET_OPTIONAL"|"DEFAULT";
  factIds:string[]; reason:string; invariantCodes:string[];
}
const choice=(pairs:[Value,string][]):Option[]=>pairs.map(([value,label])=>({value,label}));
const always=()=>true;
const global=(id:string,noun:string,field:string,question:string,why:string,kind:Kind,options?:Option[],applies:RuleConcept["applies"]=always,required=true):RuleConcept=>({id,noun,field,scope:"competition",applies,required:()=>required,question:()=>question,why:()=>why,kind,...(options?{options}:{})});
const division=(id:string,noun:string,field:string,question:(d:DivisionDraft)=>string,why:(d:DivisionDraft)=>string,kind:Kind,options?:Option[],applies:(d:DivisionDraft)=>boolean=always,required:(d:DivisionDraft)=>boolean=always):RuleConcept=>({id,noun,field,scope:"division",applies:(_draft,d)=>applies(d!),required:(_draft,d)=>required(d!),question:(_draft,d)=>question(d!),why:(_draft,d)=>why(d!),kind,...(options?{options}:{})});
const pools=(d:DivisionDraft)=>d.format==="pools_knockout";
const bracket=(d:DivisionDraft)=>d.format==="knockout"||pools(d);
const needsComparison=(d:DivisionDraft)=>pools(d)&&(d.qualification==="best_overall"||d.qualification==="winner_priority"||(d.qualification==="top_per_pool"&&Number(d.runnersUp)>0));
const needsByes=(d:DivisionDraft)=>{if(!bracket(d))return false;const count=d.format==="knockout"?d.entrants:d.qualification==="top_per_pool"&&d.poolSizes&&d.places!==null&&d.runnersUp!==null?d.poolSizes.length*d.places+d.runnersUp:d.places;return typeof count==="number"&&count>=2&&(count&(count-1))!==0;};
// References to independently enforced draft/schema findings. The catalog does not perform validation.
const RULE_INVARIANTS:Readonly<Record<string,readonly string[]>>={
  duration:["INVALID_VALUE"],rest:["INVALID_VALUE"],courts:["INVALID_VALUE"],start:["INVALID_TIME","RESOURCE_WINDOW"],end:["INVALID_TIME","RESOURCE_WINDOW"],timezone:["INVALID_TIMEZONE"],scoring:["UNSUPPORTED"],tiebreak:["UNSUPPORTED"],
  entrants:["INVALID_VALUE","ENTRANT_ACCOUNTING","ROSTER_ACCOUNTING"],label:["INVALID_LABEL"],format:["UNSUPPORTED"],poolSizes:["INVALID_POOLS","ENTRANT_ACCOUNTING"],qualification:["UNSUPPORTED","QUALIFICATION_CARDINALITY"],places:["QUALIFICATION_CARDINALITY"],runnersUp:["QUALIFICATION_CARDINALITY"],comparison:["UNSUPPORTED"],remainder:["INVALID_DESTINATION","DESTINATION_CARDINALITY"],cup:["INVALID_LABEL"],secondaryCup:["INVALID_LABEL"],bracketSlots:["CARDINALITY_MISMATCH","INVALID_BRACKET","UNSUPPORTED"],protectedSeeds:["SEED_PROTECTION"],byePolicy:["UNSUPPORTED"],rematches:["UNSUPPORTED"],secondaryBracketSlots:["CARDINALITY_MISMATCH","INVALID_BRACKET","UNSUPPORTED"],secondaryProtectedSeeds:["SEED_PROTECTION"],secondaryByePolicy:["UNSUPPORTED"],secondaryRematches:["UNSUPPORTED"]
};

/** Supported draft nouns and conditional requirements, not a universal sport ontology. */
export const RULE_CATALOG:readonly RuleConcept[]=[
  global("title","competition title","title","What is this competition called?","A draft can use a working name.","text",undefined,always,false),
  global("sport","sport","sport","Which sport is this?","The result adapter must be explicit.","choice",choice([["padel","Padel (pairs)"]])),
  global("duration","contest duration","duration","How many minutes per contest?","Used by the later schedule compiler.","number"),
  global("rest","minimum rest","rest","What is the minimum rest in minutes?","Hard rest cannot be guessed.","number"),
  global("courts","committed courts","courts","How many courts are committed?","A plan may use only committed resources.","number"),
  global("start","availability start","start","When does court availability start?","Include a date and UTC offset, e.g. 2026-10-04T09:00:00+01:00.","text"),
  global("end","availability end","end","When does court availability end?","Include a date and UTC offset.","text"),
  global("timezone","event timezone","timezone","Which event timezone?","For local presentation and scheduling semantics.","text"),
  global("scoring","result semantics","scoring","How is a result decided?","Only registered semantics can become a definition.","choice",choice([["total_games_no_draw","Total games, no draws"]])),
  global("tiebreak","pool tiebreak","tiebreak","How are tied pool records separated?","Pool classification needs an explicit final tie policy.","choice",choice([["wins_difference_for_manual","Wins → game difference → games won → manual decision"]]),draft=>draft.divisions.some(d=>d.format==="pools_knockout"||d.format==="round_robin")),
  division("entrants","entries","entrants",d=>`How many entries in ${d.label}?`,d=>`${d.label} division`,"number"),
  division("label","division name","label",()=>"What is this division called?",()=>"A working division name can be changed later.","text",undefined,always,()=>false),
  division("format","competition format","format",d=>`What format does ${d.label} use?`,d=>`${d.label} division`,"choice",choice([["pools_knockout","Pools → knockout"],["knockout","Single knockout"],["round_robin","Round robin"]])),
  division("poolSizes","pool sizes","poolSizes",d=>`How large are the ${d.label} pools?`,()=>"Use comma-separated sizes, such as 4,4,3.","sizes",undefined,pools),
  division("qualification","qualification","qualification",d=>`Who advances from ${d.label}?`,()=>"Qualification and seed assignment are separate decisions.","choice",choice([["top_per_pool","Top N in every pool"],["winner_priority","Pool winners first, then best runners-up"],["best_overall","Best N across all pools"]]),pools),
  division("places","qualifying places","places",d=>d.qualification==="top_per_pool"?"How many from each pool?":"How many total qualifiers?",d=>`${d.label} division`,"number",undefined,pools),
  division("runnersUp","additional runners-up","runnersUp",()=>"How many additional best runners-up?",()=>"Enter 0 if none.","number",undefined,d=>pools(d)&&d.qualification==="top_per_pool"),
  division("comparison","cross-pool comparison","comparison",()=>"How should different pools be compared?",()=>"This qualification policy compares entries from different pools; choose a governed ranking policy.","choice",choice([["percentage","Win %, then game difference and games won per match"],["raw","Raw wins, game difference, games won"]]),needsComparison),
  division("remainder","remaining-entry destination","remainder",()=>"What happens to everyone else?",()=>"Every entry needs an explicit destination or elimination.","choice",choice([["secondary","A second cup"],["eliminated","Eliminated after pools"]]),pools),
  division("cup","main cup","cup",()=>"What is the main cup called?",d=>`${d.label} division`,"text",undefined,bracket,pools),
  division("secondaryCup","second cup","secondaryCup",()=>"What is the second cup called?",d=>`${d.label} division`,"text",undefined,d=>pools(d)&&d.remainder==="secondary"),
  division("protectedSeeds","seed protection","protectedSeeds",()=>"How many top seeds are protected?",()=>"Choose 2 or 4; protection is hierarchical.","choice",[{value:2,label:"Top 2 in opposite halves"},{value:4,label:"Top 4 in separate quarters"}],bracket),
  division("bracketSlots","main bracket capacity","bracketSlots",()=>"How many bracket slots?",()=>"If unset, the smallest fitting bracket is used.","number",undefined,bracket,()=>false),
  division("byePolicy","bye allocation","byePolicy",()=>"Who receives the byes?",()=>"The field size requires byes, so allocation needs a declared rule.","choice",choice([["highest_seeds","Highest seeds first"]]),needsByes),
  division("rematches","opening rematches","rematches",()=>"How should opening rematches be handled?",()=>"Impossible avoidance remains a finding; no qualifier is replaced.","choice",choice([["avoid","Avoid same-pool and previous opponents where possible"],["allow","Allow rematches"]]),bracket),
  division("secondaryBracketSlots","second-cup capacity","secondaryBracketSlots",()=>"How many second-cup slots?",()=>"If unset, the smallest fitting bracket is used.","number",undefined,d=>d.remainder==="secondary",()=>false),
  division("secondaryProtectedSeeds","second-cup seed protection","secondaryProtectedSeeds",()=>"How many second-cup seeds?",()=>"If unset, the main-cup seed policy is inherited.","choice",undefined,d=>d.remainder==="secondary",()=>false),
  division("secondaryByePolicy","second-cup byes","secondaryByePolicy",()=>"Who receives second-cup byes?",()=>"If unset, the main-cup bye policy is inherited.","choice",undefined,d=>d.remainder==="secondary",()=>false),
  division("secondaryRematches","second-cup rematches","secondaryRematches",()=>"How are second-cup rematches handled?",()=>"If unset, the main-cup rematch policy is inherited.","choice",undefined,d=>d.remainder==="secondary",()=>false)
];

export function evaluateRuleCoverage(draft:Draft,facts:SourceFact[],conflictPaths:Set<string>):{coverage:RuleCoverage[];missing:Decision[]}{
  const coverage:RuleCoverage[]=[],missing:Decision[]=[];
  for(const rule of RULE_CATALOG){
    const indexes=rule.scope==="competition"?[-1]:draft.divisions.map((_,i)=>i);
    for(const index of indexes){
      const division=index<0?undefined:draft.divisions[index]!;
      const path=index<0?rule.field:`divisions.${index}.${rule.field}`;
      const applicable=rule.applies(draft,division),sources=facts.filter(f=>f.path===path),value=index<0?(draft as unknown as Record<string,unknown>)[rule.field]:(division as unknown as Record<string,unknown>)[rule.field];
      const status:RuleCoverage["status"]=!applicable?"NOT_APPLICABLE":conflictPaths.has(path)?"CONFLICT":value===null?(rule.required(draft,division)?"MISSING":"UNSET_OPTIONAL"):sources.some(f=>f.origin==="answer")?"ANSWER":sources.length?"SOURCE":"DEFAULT";
      const reason=applicable?rule.why(draft,division):"Not used by this format or qualification policy.";
      coverage.push({ruleId:rule.id,noun:rule.noun,path,status,factIds:sources.map(f=>f.id),reason,invariantCodes:[...(RULE_INVARIANTS[rule.id]??[])]});
      if(status==="MISSING")missing.push({id:path,path,question:rule.question(draft,division),why:reason,kind:rule.kind,ruleId:rule.id,...(rule.options?{options:rule.options}:{})});
    }
  }
  return {coverage,missing};
}

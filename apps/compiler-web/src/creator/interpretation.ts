import {inspectDraft} from "./definition.js";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { ingestCreationSource } from "../creation-source-ingestion.js";
import type { CreationSource } from "../creation-proposal.js";
import { projectRosterSource, type RosterSource } from "./roster-source.js";
import { evaluateRuleCoverage, RULE_CATALOG_VERSION, type RuleCoverage } from "./rule-catalog.js";

export type Value = string | number | boolean | number[];
export interface DivisionDraft {
  id:string; label:string; entrants:number|null; format:string|null; poolSizes:number[]|null;
  qualification:string|null; places:number|null; runnersUp:number|null; comparison:string|null;
  remainder:string|null; cup:string|null; secondaryCup:string|null; bracketSlots:number|null;
  protectedSeeds:number|null; byePolicy:string|null; rematches:string|null;
  secondaryBracketSlots:number|null; secondaryProtectedSeeds:number|null;
  secondaryByePolicy:string|null; secondaryRematches:string|null;
}
export interface Draft {
  title:string; sport:string|null; duration:number|null; rest:number|null; courts:number|null;
  start:string|null; end:string|null; timezone:string|null; scoring:string|null; tiebreak:string|null;
  divisions:DivisionDraft[];
}
export interface SourceFact { id:string; path:string; value:Value; sourceHash:string; locator:string; quote:string; origin:"source"|"answer"; }
export interface Decision { id:string; path:string; question:string; why:string; kind:"number"|"text"|"choice"|"sizes"; ruleId?:string; options?:{value:Value;label:string}[]; }
export interface Interpretation {
  sourceHash:string; ruleCatalogVersion:string; coverage:RuleCoverage[]; draft:Draft; roster: {id:string;displayName:string;divisionId:string;memberIds:string[];seed?:number}[]; facts:SourceFact[]; decisions:Decision[]; conflicts:{path:string;values:Value[];quotes:string[]}[];
  unparsed:{id:string;text:string}[]; failures:string[]; revision:number; hash:string;
}
export interface Answers { sourceHash:string; ruleCatalogVersion:string; values:Record<string,Value>; }
const division=(label:string,id:string):DivisionDraft=>({id,label,entrants:null,format:null,poolSizes:null,qualification:null,places:null,runnersUp:null,comparison:null,remainder:null,cup:null,secondaryCup:null,bracketSlots:null,protectedSeeds:null,byePolicy:null,rematches:null,secondaryBracketSlots:null,secondaryProtectedSeeds:null,secondaryByePolicy:null,secondaryRematches:null});
export const emptyDraft=():Draft=>({title:"Untitled competition",sport:null,duration:null,rest:null,courts:null,start:null,end:null,timezone:null,scoring:null,tiebreak:null,divisions:[division("Open","division-1")]});
export function getField(draft:Draft,path:string):unknown { return path.split(".").reduce<any>((v,k)=>v?.[k],draft); }
export function setField(draft:Draft,path:string,value:Value):void {
  const parts=path.split(".");let target:any=draft;
  for(const part of parts.slice(0,-1)) { if(part==="__proto__"||part==="constructor"||part==="prototype"||!Object.hasOwn(target,part)) throw new Error("Unknown draft field");target=target[part]; }
  const key=parts.at(-1)!;if(!Object.hasOwn(target,key))throw new Error("Unknown draft field");target[key]=value;
}
const globalFields=new Set(["title","sport","duration","rest","courts","start","end","timezone","scoring","tiebreak"]);
const divisionFields=new Set(Object.keys(division("","")));
export function interpret(source:CreationSource,answers?:Answers,revision=1,rosterSource:RosterSource|null=null):Interpretation {
  const sourceHash=canonicalHash(source),draft=emptyDraft(),roster:Interpretation["roster"]=[],facts:SourceFact[]=[],failures:string[]=[],unparsed:{id:string;text:string}[]=[];
  const claims=new Map<string,SourceFact[]>();
  const claim=(path:string,value:Value,quote:string,locator:string)=>{
    const fact:SourceFact={id:`fact-${facts.length+1}`,path,value,quote,locator,sourceHash,origin:"source"};facts.push(fact);
    claims.set(path,[...(claims.get(path)??[]),fact]);setField(draft,path,value);
  };
  const unknown=(text:string)=>unparsed.push({id:`unparsed-${unparsed.length+1}`,text});
  if(source.mode==="language") {
    if(source.text.length>50000)failures.push("Source is too long for this review interpreter (50,000 characters).");
    else {
      let current=0, named=false;
      for(const [lineIndex,line] of source.text.split(/\n/).entries()) {
        let text=line.trim();if(!text)continue;
        const namedDivision=text.match(/^(?:division\s+)?([A-Za-z][A-Za-z &-]{0,45}):\s*(?=\d+\s+(?:pairs|teams|entries))/i);
        if(namedDivision){if(!named){draft.divisions=[];named=true;}current=draft.divisions.length;draft.divisions.push(division(namedDivision[1]!.trim(),`division-${current+1}`));claim(`divisions.${current}.label`,namedDivision[1]!.trim(),line,`line:${lineIndex+1}`);text=text.slice(namedDivision[0].length);}
        const prefix=`divisions.${current}.`;
        for(const rawClause of text.split(/[;.](?=\s|$)/)) {
          let clause=rawClause.trim();if(!clause)continue;
          const quote=clause, locator=`line:${lineIndex+1}`;let matched=false;
          const take=(pattern:RegExp,fn:(m:RegExpMatchArray)=>void)=>{const m=clause.match(pattern);if(m){fn(m);clause=clause.replace(m[0]," ");matched=true;}};
          const put=(p:string,v:Value)=>claim(p,v,quote,locator);
          take(/^(?:title|name|event)\s*:\s*(.+)$/i,m=>put("title",m[1]!.trim()));
          take(/\bpadel(?:\s+pairs)?\b/i,()=>put("sport","padel"));
          take(/\b(\d+)\s+(?:pairs|teams|entries)\b/i,m=>put(prefix+"entrants",+m[1]!));
          take(/\b(?:single[ -]elimination|knockout)(?!\s+cup)\b/i,()=>put(prefix+"format","knockout"));
          take(/\bround[ -]robin\b/i,()=>put(prefix+"format","round_robin"));
          take(/\b(?:pools?|groups?)\s+(\d+(?:\s*,\s*\d+)+)\b/i,m=>{put(prefix+"poolSizes",m[1]!.split(",").map(Number));put(prefix+"format","pools_knockout");});
          take(/\b(\d+)\s+(?:pools?|groups?)\s+of\s+(\d+)\b/i,m=>{if(+m[1]!>16){unknown(quote);return;}put(prefix+"poolSizes",Array(+m[1]!).fill(+m[2]!));put(prefix+"format","pools_knockout");});
          take(/\btop\s+(\d+)\s+(?:from|per|in)\s+(?:each\s+)?pool\b/i,m=>{put(prefix+"qualification","top_per_pool");put(prefix+"places",+m[1]!);});
          take(/\b(?:best|top)\s+(\d+)\s+(?:overall|across pools)\b/i,m=>{put(prefix+"qualification","best_overall");put(prefix+"places",+m[1]!);});
          take(/\bwinners first(?:\s+then runners[- ]up)?\s+(?:for|to)\s+(\d+)\s+(?:places|qualifiers)\b/i,m=>{put(prefix+"qualification","winner_priority");put(prefix+"places",+m[1]!);});
          take(/\b(?:plus\s+)?(?:the\s+)?best\s+(\d+)\s+runners?[- ]up\b/i,m=>put(prefix+"runnersUp",+m[1]!));
          take(/\bno\s+(?:extra\s+)?runners?[- ]up\b/i,()=>put(prefix+"runnersUp",0));
          take(/\b(?:compare\s+by\s+)?(?:win\s+percentage|per[ -]match\s+normalisation|normalized\s+per\s+match)\b/i,()=>put(prefix+"comparison","percentage"));
          take(/\b(?:compare\s+by\s+)?raw\s+totals\b/i,()=>put(prefix+"comparison","raw"));
          take(/\b(?:qualifiers\s+to|cup\s*:)\s*([A-Za-z][A-Za-z &-]*?)(?:\s+Cup)\b/i,m=>put(prefix+"cup",m[1]!.trim()+" Cup"));
          take(/\b(?:remaining|remainder|everyone else)\s+(?:go\s+)?to\s+([A-Za-z][A-Za-z &-]*?)(?:\s+Cup)\b/i,m=>{put(prefix+"remainder","secondary");put(prefix+"secondaryCup",m[1]!.trim()+" Cup");});
          take(/\b(?:remaining|remainder|others)\s+(?:are\s+)?eliminated\b/i,()=>put(prefix+"remainder","eliminated"));
          take(/\b(\d+)\s+(?:bracket\s+)?slots\b/i,m=>put(prefix+"bracketSlots",+m[1]!));
          take(/\bprotect\s+(?:top\s+)?(\d+)\s+seeds\b/i,m=>put(prefix+"protectedSeeds",+m[1]!));
          take(/\bbyes\s+to\s+(?:highest|top)\s+seeds\b/i,()=>put(prefix+"byePolicy","highest_seeds"));
          take(/\bavoid\s+(?:same[ -]pool\s+and\s+previous[ -]opponent\s+)?rematches\b/i,()=>put(prefix+"rematches","avoid"));
          take(/\ballow\s+rematches\b/i,()=>put(prefix+"rematches","allow"));
          take(/\b(?:matches?\s+last\s+)?(\d+)[ -]minute\s+matches\b/i,m=>put("duration",+m[1]!));
          take(/\b(?:rest\s+(\d+)\s*(?:minutes?|min)|(?:at least\s+)?(\d+)[ -]minutes?\s+rest)\b/i,m=>put("rest",+(m[1]??m[2])!));
          take(/\b(\d+)\s+courts\b/i,m=>put("courts",+m[1]!));
          take(/\bstart\s+(\S+)\b/i,m=>put("start",m[1]!));
          take(/\b(?:end|finish)\s+(\S+)\b/i,m=>put("end",m[1]!));
          take(/\btimezone\s+([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\b/i,m=>put("timezone",m[1]!));
          take(/\bscoring\s*:\s*total\s+games[,]?\s+no\s+draws\b/i,()=>put("scoring","total_games_no_draw"));
          take(/\btiebreak\s*:\s*wins[,]?\s+(?:game|score)\s+difference[,]?\s+(?:games|score)\s+(?:won|for)[,]?\s+manual\b/i,()=>put("tiebreak","wins_difference_for_manual"));
          const residual=clause.replace(/\b(?:we|have|want|a|an|the|with|and|then|please|will|play|in|of|our|tournament|competition|is|be|to)\b/gi,"").replace(/[,:→+\s-]/g,"");
          if(residual || !matched)unknown(quote);
        }
      }
    }
  } else {
    const imported=ingestCreationSource(source);
    if(imported.status!=="ACCEPTED")failures.push(...imported.findings);
    else if(imported.entrants.length){
      draft.divisions=[];
      for(const id of new Set(imported.entrants.map(e=>e.divisionId))){
        const index=draft.divisions.length;draft.divisions.push(division(id,`division-${index+1}`));
        claim(`divisions.${index}.label`,id,`Entrant rows for ${id}`,`table:division_id=${id}`);
        claim(`divisions.${index}.entrants`,imported.entrants.filter(e=>e.divisionId===id).length,`Entrant rows for ${id}`,`table:division_id=${id}`);
        for(const entry of imported.entrants.filter(e=>e.divisionId===id)){
          roster.push({...entry,divisionId:`division-${index+1}`,memberIds:[...entry.memberIds]});
          facts.push({id:`fact-${facts.length+1}`,path:`roster.${entry.id}`,value:JSON.stringify(entry),sourceHash,locator:`table:entrant_id=${entry.id}`,quote:entry.displayName,origin:"source"});
        }
      }
    } else {
      const data=imported.normalized;
      if(!data||typeof data!=="object"||Array.isArray(data))failures.push("Expected a definition draft object.");
      else {
        const object=data as Record<string,unknown>;
        for(const [key,value] of Object.entries(object)){
          if(key==="divisions" && Array.isArray(value) && value.length>0 && value.length<=16){
            draft.divisions=value.map((x,i)=>division(typeof x?.label==="string"?x.label:`Division ${i+1}`,`division-${i+1}`));
            value.forEach((d,i)=>{if(!d||typeof d!=="object"||Array.isArray(d)){failures.push(`Invalid division ${i+1}`);return;}for(const [field,v] of Object.entries(d)){
              if(field==="id")continue;
              if(!divisionFields.has(field)){unknown(`divisions.${i}.${field}: ${JSON.stringify(v)}`);continue;}
              if(v!==null)claim(`divisions.${i}.${field}`,v as Value,JSON.stringify(v),`/divisions/${i}/${field}`);
            }});
          }else if(globalFields.has(key)){if(value!==null)claim(key,value as Value,JSON.stringify(value),`/${key}`);}
          else unknown(`${key}: ${JSON.stringify(value)}`);
        }
      }
    }
  }
  if(rosterSource){
    if(source.mode==="csv"||source.mode==="xlsx")failures.push("ROSTER_SOURCE: Choose a format source before attaching a second roster.");
    else {
      const imported=projectRosterSource(rosterSource,draft.divisions,facts.length+1);
      roster.push(...imported.roster);facts.push(...imported.facts);failures.push(...imported.failures);
    }
  }
  const conflicts=[...claims].filter(([,items])=>new Set(items.map(x=>JSON.stringify(x.value))).size>1).map(([path,items])=>({path,values:items.map(x=>x.value),quotes:items.map(x=>x.quote)}));
  const applied=answers?.sourceHash===sourceHash&&answers.ruleCatalogVersion===RULE_CATALOG_VERSION?answers.values:{};
  for(const [path,value] of Object.entries(applied)){
    if(path.startsWith("unparsed-"))continue;
    try{setField(draft,path,value);facts.push({id:`fact-${facts.length+1}`,path,value,sourceHash,locator:`answer:${path}`,quote:"Explicit organiser decision",origin:"answer"});}catch{failures.push(`Unknown answer field ${path}`);}
  }
  const unresolvedConflicts=new Set(conflicts.filter(conflict=>!Object.hasOwn(applied,conflict.path)).map(conflict=>conflict.path));
  const {coverage,missing:decisions}=evaluateRuleCoverage(draft,facts,unresolvedConflicts,new Set(inspectDraft(draft).map(f=>f.path)));
  for(const conflict of conflicts)if(!Object.hasOwn(applied,conflict.path))decisions.push({id:`conflict:${conflict.path}`,path:conflict.path,question:`Which value is correct for ${conflict.path}?`,why:conflict.quotes.join(" / "),kind:"choice",options:conflict.values.map(value=>({value,label:JSON.stringify(value)}))});
  for(const item of unparsed)if(applied[item.id]!=="context_only")decisions.push({id:item.id,path:item.id,question:"Does this contain a rule we still need to model?",why:item.text,kind:"choice",options:[{value:"context_only",label:"Context only — no competition rule"}]});
  const partial={sourceHash,ruleCatalogVersion:RULE_CATALOG_VERSION,coverage,rosterSourceHash:rosterSource?canonicalHash(rosterSource):null,draft,roster,facts,decisions,conflicts,unparsed,failures,revision};
  return {...partial,hash:canonicalHash(partial)};
}

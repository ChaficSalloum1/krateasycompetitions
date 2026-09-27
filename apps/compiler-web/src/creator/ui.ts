import { CreatorSession } from "./session.js";
import { examples } from "./examples.js";
import { qualifierCount } from "./definition.js";
import { getField,type Value,type Decision,type DivisionDraft } from "./interpretation.js";
import { compileTopology } from "../../../../packages/competition-engine/src/topology-compiler.js";
import type { CreationSource } from "../creation-proposal.js";
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const session=new CreatorSession({mode:"language",text:examples["Pools to cups"]});
let selected:{division:number;section:string}|null=null;
let timer:ReturnType<typeof setTimeout>|undefined;
let message="Start with the example, or replace it with your own competition.";
function flushSource(){if(timer===undefined)return;clearTimeout(timer);timer=undefined;const current=session.source;const mode=current.mode==="xlsx"||current.mode==="quick"?"language":current.mode;session.changeSource({mode,text:$<HTMLTextAreaElement>("source").value} as CreationSource);message="Source updated. Earlier answers were cleared so no stale rule is carried forward.";render();}

const fieldNames:Record<string,string>={entrants:"Entries",poolSizes:"Pool sizes",places:"Qualifying places",runnersUp:"Extra runners-up",comparison:"Cross-pool comparison",remainder:"Remaining entries",bracketSlots:"Bracket slots",protectedSeeds:"Protected seeds",byePolicy:"Bye policy",rematches:"Opening rematches",cup:"Main cup name",secondaryCup:"Second cup name",format:"Format",label:"Division name",duration:"Contest minutes",rest:"Minimum rest (minutes)",courts:"Committed courts",start:"Availability start (ISO + offset)",end:"Availability end (ISO + offset)",timezone:"Event timezone",scoring:"Scoring",tiebreak:"Tiebreak",qualification:"Qualification"};
const choices:Record<string,{value:Value;label:string}[]>={
format:[{value:"pools_knockout",label:"Pools → knockout"},{value:"knockout",label:"Single knockout"},{value:"round_robin",label:"Round robin"}],
qualification:[{value:"top_per_pool",label:"Top N per pool"},{value:"winner_priority",label:"Pool winners first, then best runners-up"},{value:"best_overall",label:"Best N across all pools"}],
comparison:[{value:"percentage",label:"Win %, difference and games won per match"},{value:"raw",label:"Raw wins, difference and games won"}],
remainder:[{value:"secondary",label:"Second cup"},{value:"eliminated",label:"Eliminated after pools"}],
protectedSeeds:[{value:2,label:"Top 2 · opposite halves"},{value:4,label:"Top 4 · separate quarters"}],
byePolicy:[{value:"highest_seeds",label:"Highest seeds first"}],
rematches:[{value:"avoid",label:"Avoid where possible"},{value:"allow",label:"Allow rematches"}],
scoring:[{value:"total_games_no_draw",label:"Total games · no draws"}],
tiebreak:[{value:"wins_difference_for_manual",label:"Wins → difference → games won → manual"}]
};
const numeric=new Set(["entrants","places","runnersUp","bracketSlots","duration","rest","courts","protectedSeeds"]);
function parsed(field:string,value:string):Value {if(field==="poolSizes")return value.split(",").map(v=>Number(v.trim()));if(numeric.has(field))return Number(value);return value;}
function pretty(path:string,value:unknown){const field=path.split(".").at(-1)!;return choices[field]?.find(x=>String(x.value)===String(value))?.label??(Array.isArray(value)?value.join(", "):value??"Not decided");}
function control(path:string,value:unknown){const field=path.split(".").at(-1)!,id=`field-${path.replaceAll(".","-")}`;const options=choices[field];
  return `<label for="${id}">${esc(fieldNames[field]??field)}</label>${options?`<select id="${id}" name="${esc(path)}"><option value="">Choose…</option>${options.map(o=>`<option value="${esc(o.value)}" ${String(value)===String(o.value)?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`:`<input id="${id}" name="${esc(path)}" type="${numeric.has(field)?"number":"text"}" ${numeric.has(field)?'min="0" max="240" step="1"':""} value="${esc(Array.isArray(value)?value.join(", "):value)}" ${field==="poolSizes"?'placeholder="4,4,3"':""}>`}`;
}
function topology(count:number){
  if(!Number.isInteger(count)||count<2||count>64)return '<p class="hint">Bracket appears when the field is defined.</p>';
  const topology=compileTopology({id:"preview",entrantCount:count});
  const rounds=Array.from(new Set(topology.nodes.map(n=>n.round)));
  return `<div class="mini-bracket" aria-label="${count} qualifiers, ${topology.proof.byeCount} byes, ${topology.proof.generatedCompetitiveMatchCount} contests">${rounds.map(round=>{
    const nodes=topology.nodes.filter(n=>n.round===round);return `<div class="bracket-round">${nodes.length>4?`<span>${nodes.length} slots</span>`:nodes.map(n=>`<span>${n.kind==="BYE"?"BYE":round===rounds.at(-1)?"FINAL":"R"+round}</span>`).join("")}</div>`;
  }).join('<span aria-hidden="true">›</span>')}</div><small class="bracket-caption">${topology.proof.byeCount} byes · ${topology.proof.generatedCompetitiveMatchCount} contests<br>Empty topology · qualifiers not assigned</small>`;
}
function node(index:number,section:string,body:string){return `<button class="node ${selected?.division===index&&selected.section===section?"active":""}" data-node="${index}:${section}">${body}</button>`;}
function structure(d:DivisionDraft,index:number){const q=qualifierCount(d),known=d.entrants!==null&&d.format!==null;let body="";
  if(d.format!=="knockout"){
    const sizes=d.format==="round_robin"&&d.entrants?[d.entrants]:Array.isArray(d.poolSizes)?d.poolSizes:[];
    body+=node(index,"pools",`<small>POOL STAGE</small><strong>${sizes.length?`${sizes.length} ${sizes.length===1?"pool":"pools"} · ${sizes.reduce((a,b)=>a+b,0)} places`:"Pool structure needs a decision"}</strong><div class="pool-chips">${sizes.map((size,i)=>`<span class="pool-chip">${String.fromCharCode(65+i)} · ${esc(size)} pairs</span>`).join("")}</div>`);
  }
  if(d.format==="pools_knockout"){
    let rule="Who advances?";if(d.qualification==="top_per_pool")rule=`Top ${d.places??"?"} per pool${d.runnersUp?` + ${d.runnersUp} best runners-up`:""}`;else if(d.qualification==="winner_priority")rule=`Winners first → ${d.places??"?"} places`;else if(d.qualification==="best_overall")rule=`Best ${d.places??"?"} across pools`;
    body+=`<div class="connector"></div>`+node(index,"qualification",`<small>QUALIFICATION</small><strong>${esc(rule)}</strong><small>${d.comparison?esc(pretty("comparison",d.comparison)):"Comparison rule is unresolved"}</small>`)+`<div class="connector"></div><div class="cups"><div class="cup">`+node(index,"bracket",`<small>MAIN DESTINATION</small><strong>${esc(d.cup??"Name the cup")} · ${q||"?"}</strong>${topology(q)}`)+`</div>`;
    if(d.remainder==="secondary")body+=`<div class="cup">`+node(index,"bracket",`<small>REMAINING ENTRIES</small><strong>${esc(d.secondaryCup??"Second cup")} · ${known?d.entrants!-q:"?"}</strong>${topology(known?d.entrants!-q:0)}`)+`</div>`;
    body+="</div>";
  }else if(d.format==="knockout")body+=node(index,"bracket",`<small>SINGLE ELIMINATION</small><strong>${d.entrants??"?"} entries → one winner</strong>${topology(Number(d.entrants))}`);
  else if(d.format===null)body+='<div class="empty">Choose a format to connect the next stage.</div>';
  return `<article class="division"><div class="division-title"><button data-node="${index}:division"><strong>${esc(d.label)}</strong><small>${d.entrants??"?"} pairs · edit</small></button></div>${body}</article>`;
}
function question(d:Decision){return `<article class="question"><h4>${esc(d.question)}</h4><p>${esc(d.why)}</p>${d.kind==="choice"?d.options!.map((o,i)=>`<button data-answer="${esc(d.id)}" data-option="${i}">${esc(o.label)}</button>`).join(""):`<form data-question="${esc(d.id)}"><label for="answer-${esc(d.id)}">Your answer</label><input id="answer-${esc(d.id)}" name="value" type="${d.kind==="number"?"number":"text"}" ${d.kind==="number"?'min="0" max="240" step="1"':""} required><button type="submit">Apply answer</button></form>`}${d.id.startsWith("unparsed-")?'<p>If it is a rule, revise the source or use a supported field. It remains unresolved until then.</p>':""}</article>`;}
function syncSource(){const s=session.source;$<HTMLTextAreaElement>("source").value=s.mode==="xlsx"?`Workbook: ${s.fileName}\nEntrant identities are preserved in the source export.`:s.mode==="quick"?JSON.stringify(s.value,null,2):s.text;$<HTMLTextAreaElement>("source").readOnly=s.mode==="xlsx";}
function render(){
  try{
    const {interpretation:p,compilation:c}=session.evaluate(),d=p.draft;
    const errors=[...p.failures.map(message=>({code:"SOURCE_UNREADABLE",path:"source",message})),...c.findings,...c.validation.filter(f=>f.severity==="ERROR"&&f.code!=="TSC602")];
    const state=errors.length?"BLOCKED":p.decisions.length?"NEEDS DECISIONS":"READY TO REVIEW";
    $("notice").textContent=message;
    $("source-meta").textContent=`${p.facts.length} attributed facts · revision ${session.revision} · source ${p.sourceHash.slice(0,12)}`;
    $("overview").innerHTML=`<div class="overview"><div><strong>${d.divisions.reduce((n,x)=>n+(typeof x.entrants==="number"?x.entrants:0),0)||"—"}</strong><span>entries</span></div><div><strong>${d.divisions.length}</strong><span>divisions</span></div><div><strong>${c.graph?.generatedActualContestCount??"—"}</strong><span>compiled contests</span></div><span class="status ${errors.length?"blocked":p.decisions.length?"needs":""}">${state}</span></div><h3>${esc(d.title)}</h3>`;
    $("structure").innerHTML=d.divisions.map(structure).join("");
    $("rules").innerHTML=`<div class="rules-card"><button data-node="-1:operations"><strong>Operational rules <span aria-hidden="true">↗</span></strong><div class="rule-values"><span>${d.duration??"?"} min / contest</span><span>${d.rest??"?"} min rest</span><span>${d.courts??"?"} courts</span></div></button><p class="hint">${esc(d.timezone??"Timezone undecided")} · shared availability window</p></div>`;
    let inspector='<p class="hint">Select any structure card to edit its rules. Missing decisions appear below.</p>';
    if(selected){
      const i=selected.division,section=selected.section,division=d.divisions[i];
      const fields=section==="operations"?["duration","rest","courts","start","end","timezone","scoring","tiebreak"]:section==="division"?["label","entrants","format"]:section==="pools"?["poolSizes"]:section==="qualification"?["qualification","places","runnersUp","comparison","remainder","cup","secondaryCup"]:["bracketSlots","protectedSeeds","byePolicy","rematches"];
      const prefix=i<0?"":`divisions.${i}.`;
      inspector=`<div class="inspector-title"><h3>${i<0?"Operational rules":esc(division?.label)+" · "+esc(section)}</h3><button id="close-inspector" aria-label="Close rule editor">×</button></div><form id="edit-form" class="edit-form">${fields.map(f=>control(prefix+f,getField(d,prefix+f))).join("")}<p class="hint">Edits are explicit decisions. The original source stays intact. Empty optional fields are left unchanged.</p>${section==="bracket"?'<p class="hint">Bracket slots apply to the main cup. A blank initial value uses the smallest fitting bracket. The second cup derives its capacity from remaining entries.</p>':""}<button class="primary" type="submit">Apply rules</button></form>`;
    }
    $("inspector").innerHTML=inspector;
    $("questions").innerHTML=errors.map(f=>`<div class="finding"><strong>${esc(f.code)}</strong>${esc(f.message)}<br><button data-fix="${esc(f.path)}">Inspect rule</button></div>`).join("")+(p.decisions.length?`<div class="question-count"><h3>Needs your decision</h3><span>${p.decisions.length}</span></div>${p.decisions.map(question).join("")}`:`<div class="complete"><strong>${errors.length?"Resolve the findings before review.":"The structure is ready to review."}</strong><p>Rules are explicit and the supported definition checks pass. This does not certify a draw, schedule or publication.</p><button class="review-btn" id="review" ${errors.length?"disabled":""}>${session.reviewedHash===p.hash?"Reviewed this revision ✓":"Mark this draft reviewed"}</button></div>`);
    const recent=session.events.slice(-4);
    $("changes").innerHTML=recent.length?`<div class="changes"><strong>Recent draft changes</strong><ul>${recent.map(e=>`<li>r${e.revision} · ${esc(e.event.replaceAll("_"," "))}: ${esc(e.detail)}</li>`).join("")}</ul></div>`:"";
    const notes=c.validation.filter(f=>f.code!=="TSC602");
    $("evidence").innerHTML=`<details><summary><span>What Krateasy understood · facts & evidence</span><span>${p.facts.length} facts · r${p.revision}</span></summary><p class="hint">Same core schema, compiler and topology as the engine. This browser runs a non-authoritative draft preview. Server-owned Guard approval and publication are not available here.</p>${notes.map(f=>`<p class="hint">${esc(f.code)} · ${esc(f.message)}</p>`).join("")}<div class="table-scroll"><table class="fact-table"><thead><tr><th>Rule</th><th>Value</th><th>Source</th></tr></thead><tbody>${p.facts.map(f=>`<tr><td>${esc(f.path)}</td><td>${esc(pretty(f.path,f.value))}</td><td>${esc(f.locator)}<br>${esc(f.quote)}</td></tr>`).join("")}</tbody></table></div><details><summary>Canonical proposed definition</summary><pre>${esc(JSON.stringify(c.spec??{status:c.status,openDecisions:p.decisions.length},null,2))}</pre></details><p class="hint">Still outside this review: named pool memberships, separate court windows, plan locks, schedule compilation, production approval and event-day operations.</p></details>`;
    $<HTMLButtonElement>("undo").disabled=!session.history.length;
    document.querySelectorAll<HTMLElement>("[data-node]").forEach(el=>el.onclick=()=>{const [division,section]=el.dataset.node!.split(":");selected={division:Number(division),section:section!};session.events.push({event:"structure_node_opened",revision:session.revision,detail:section!});render();$("inspector").scrollIntoView({block:"nearest",behavior:"smooth"});});
    $("close-inspector")?.addEventListener("click",()=>{selected=null;render();});
    $("edit-form")?.addEventListener("submit",event=>{event.preventDefault();const values:Record<string,Value>={};for(const [path,value] of new FormData(event.currentTarget as HTMLFormElement)){if(String(value).trim())values[path]=parsed(path.split(".").at(-1)!,String(value));}session.answer(values);session.events.push({event:selected?.section==="qualification"?"qualification_changed":"rule_changed",revision:session.revision,detail:Object.keys(values).map(x=>fieldNames[x.split(".").at(-1)!]??x).join(", ")});message="Rules updated. Review the structure and any new findings.";render();});
    document.querySelectorAll<HTMLElement>("[data-answer]").forEach(el=>el.onclick=()=>{const q=p.decisions.find(x=>x.id===el.dataset.answer)!;session.answer({[q.path]:q.options![Number(el.dataset.option)]!.value});message="Decision applied to this source revision.";render();});
    document.querySelectorAll<HTMLFormElement>("[data-question]").forEach(form=>form.onsubmit=event=>{event.preventDefault();const q=p.decisions.find(x=>x.id===form.dataset.question)!;const value=String(new FormData(form).get("value"));session.answer({[q.path]:q.kind==="number"?Number(value):q.kind==="sizes"?value.split(",").map(Number):value});message="Decision applied. The structure has been checked again.";render();});
    document.querySelectorAll<HTMLElement>("[data-fix]").forEach(el=>el.onclick=()=>{const path=el.dataset.fix!;const parts=path.split(".");selected=parts[0]==="divisions"?{division:Number(parts[1]),section:parts[2]==="poolSizes"?"pools":["bracketSlots","protectedSeeds","byePolicy","rematches"].includes(parts[2]!)?"bracket":"qualification"}:{division:-1,section:"operations"};render();});
    $("review")?.addEventListener("click",()=>{flushSource();if(session.review()){message="This draft revision is marked reviewed locally. It is not locked or published.";render();}});
  }catch(error){$("notice").textContent=`Source could not be interpreted safely: ${error instanceof Error?error.message:"invalid input"}. Edit or undo it.`;$("overview").innerHTML='<span class="status blocked">BLOCKED</span>';$("structure").innerHTML="";$("questions").innerHTML="";$("rules").innerHTML="";$("inspector").innerHTML="";$("evidence").innerHTML="";$<HTMLButtonElement>("undo").disabled=!session.history.length;}
}
$("example").innerHTML=Object.keys(examples).map(name=>`<option>${esc(name)}</option>`).join("");
$("example").addEventListener("change",()=>{clearTimeout(timer);timer=undefined;const name=$<HTMLSelectElement>("example").value as keyof typeof examples;session.changeSource({mode:"language",text:examples[name]});selected=null;message=name==="St Albans structure"?"St Albans structural study: source pool counts, explicit example operations. This is not the historical event schedule.":"Example loaded. All rules remain editable.";syncSource();render();});
$("source").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(flushSource,250);});
$("undo").addEventListener("click",()=>{clearTimeout(timer);timer=undefined;session.undo();selected=null;message="Restored the previous draft. Review status has been cleared.";syncSource();render();});
$("export").addEventListener("click",()=>{flushSource();const blob=new Blob([JSON.stringify(session.export(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`krateasy-draft-r${session.revision}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$("file").addEventListener("change",async()=>{const input=$<HTMLInputElement>("file"),file=input.files?.[0];if(!file)return;try{if(file.size>5_000_000)throw new Error("Source exceeds 5 MB.");const extension=file.name.split(".").at(-1)?.toLowerCase();let source:CreationSource;if(extension==="xlsx"){const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));source={mode:"xlsx",fileName:file.name,base64:btoa(binary)};}else{const mode=extension==="json"?"json":extension==="yaml"||extension==="yml"?"yaml":extension==="csv"?"csv":"language";source={mode,text:await file.text()};}clearTimeout(timer);timer=undefined;session.changeSource(source);selected=null;message=`Imported ${file.name}. Missing rules will need your decisions.`;syncSource();render();}catch(error){$("notice").textContent=String(error);}finally{input.value="";}});
syncSource();render();

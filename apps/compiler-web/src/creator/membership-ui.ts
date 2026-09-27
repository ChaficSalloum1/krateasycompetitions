import type {CreatorSession} from "./session.js";
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function renderMembership(session:CreatorSession,host:HTMLElement,onChange:(message:string)=>void){
  const current=session.evaluate(),views=current.compilation.memberships??[],saved=session.export().membership;
  const labels=new Map(current.interpretation.roster.map(e=>[e.id,e.displayName]));
  const label=(id:string)=>labels.get(id)??`Entry ${id.split(".").at(-1)} (placeholder)`;
  host.innerHTML=`<details class="rules-card"><summary>Pool memberships · ${views.length} stages</summary><p class="hint">Assignments are draft plan choices. Together/separate rules belong to the definition. Swaps preserve pool sizes. Narrative entries remain placeholders; imported roster names are shown unchanged.</p>${views.map(v=>`<section><h3>${esc(v.label)}</h3><div class="membership-grid">${v.pools.map((pool,i)=>`<article><strong>Pool ${i+1}</strong><ul>${pool.entries.map(e=>`<li>${esc(label(e.id))}</li>`).join("")}</ul></article>`).join("")}</div><form data-membership="${esc(v.stageId)}"><label>First entry<select name="first">${v.planAssignments.map(a=>`<option value="${esc(a.entrantId)}">${esc(label(a.entrantId))}</option>`).join("")}</select></label><label>Second entry<select name="second">${v.planAssignments.map(a=>`<option value="${esc(a.entrantId)}">${esc(label(a.entrantId))}</option>`).join("")}</select></label><label>Action<select name="action"><option value="swap">Swap pool assignments</option><option value="SEPARATE">Protect: separate pools</option><option value="TOGETHER">Protect: same pool</option></select></label><button type="submit">Apply membership change</button></form><ul>${v.definitionRules.map((r,i)=>`<li>${esc(r.kind)}: ${r.entrantIds.map(label).map(esc).join(" / ")} <button data-remove-rule="${esc(v.stageId)}" data-index="${i}">Remove rule</button></li>`).join("")}</ul></section>`).join("")}${saved.map(v=>`<button data-clear-membership="${esc(v.stageId)}">Clear saved membership · ${esc(v.stageId)}</button>`).join("")}</details>`;
  const report=(r:ReturnType<CreatorSession["setMembership"]>)=>onChange(r.status==="COMMITTED"?"Membership updated; review was cleared.":r.message);
  host.querySelectorAll<HTMLFormElement>("[data-membership]").forEach(form=>form.onsubmit=event=>{
    event.preventDefault();const data=new FormData(form),first=String(data.get("first")),second=String(data.get("second")),action=String(data.get("action"));
    if(first===second){onChange("Choose two different entries.");return;}
    const view=views.find(v=>v.stageId===form.dataset.membership)!;
    const edit={stageId:view.stageId,basisHash:view.basisHash,definitionRules:structuredClone(view.definitionRules),planAssignments:structuredClone(view.planAssignments)};
    if(action==="swap"){const a=edit.planAssignments.find(a=>a.entrantId===first)!,b=edit.planAssignments.find(a=>a.entrantId===second)!;[a.poolId,b.poolId]=[b.poolId,a.poolId];}
    else edit.definitionRules.push({kind:action as "TOGETHER"|"SEPARATE",entrantIds:[first,second]});
    report(session.setMembership(edit));
  });
  host.querySelectorAll<HTMLButtonElement>("[data-clear-membership]").forEach(button=>button.onclick=()=>report(session.clearMembership(button.dataset.clearMembership!)));
  host.querySelectorAll<HTMLButtonElement>("[data-remove-rule]").forEach(button=>button.onclick=()=>{const view=views.find(v=>v.stageId===button.dataset.removeRule)!;report(session.setMembership({...view,definitionRules:view.definitionRules.filter((_,i)=>i!==Number(button.dataset.index))}));});
}

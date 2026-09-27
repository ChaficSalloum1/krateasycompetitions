const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>escape(JSON.stringify(value,null,2));
const labels={SOURCE:'Source',FACTS:'Extracted facts',DEFINITION:'Definition',GRAPH:'Contest graph',CLASSIFICATION:'Classification',QUALIFICATION:'Qualification',SEED:'Seed assignment',TOPOLOGY:'Bracket topology',DRAW:'Draw',SCHEDULE:'Schedule',GUARD:'Guard'};
const descriptions={SOURCE:'The original input, its origin and the limits of its authority. Source claims remain claims until independently checked.',FACTS:'Facts linked to their source. For St Albans, original unanswered questions and explicit fixture decisions are preserved alongside untrusted source assertions.',DEFINITION:'The exact versioned definition consumed by the existing core. Schema and semantic validation run before graph construction.',GRAPH:'The structural contest graph before qualification resolves knockout occupants. Placeholder identities at this boundary are not confirmed qualifiers.',CLASSIFICATION:'Synthetic audit scores feed the existing standings engine. These exercise the pipeline and are never represented as played-event results.',QUALIFICATION:'Independent verification re-derives the selected population from classification and the declared selectors. Seeding cannot change which entrants qualify.',SEED:'An observable projection of the current core’s assignments. Production is still coupled to qualification; separating that implementation is Phase B work.',TOPOLOGY:'The required bracket capacity and bye count, independently inspectable from occupant identities. Round robin has no elimination bracket.',DRAW:'The resolved contest graph is checked against the selected population and independently reconstructed progression and pool pairing requirements.',SCHEDULE:'Every required contest is checked for resource availability, duration, participant collision and dependency constraints. An invalid schedule blocks the pipeline.',GUARD:'The exact artefacts are checked by the core Guard. Earlier boundary failures block this run. This observer does not approve, publish or commit competition state.'};
let catalog,current,selected='SOURCE',request=0;
const jsonBlock=(title,value,open=false)=>`<details ${open?'open':''}><summary>${escape(title)}</summary><pre>${pretty(value)}</pre></details>`;
const cards=items=>`<div class="cards">${items.map(([label,value])=>`<div class="card"><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`).join('')}</div>`;
const table=(heads,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="empty">This format has no output for this sub-stage. The boundary remains visible.</p>';
function summary(boundary){
 const value=boundary.output;if(value===null)return `<p class="empty">${escape(boundary.failure)}. No downstream artefact was generated.</p>`;
 switch(boundary.stage){
 case 'SOURCE':return `<p class="fine">${escape(value.origin)}</p><p class="empty">${escape(value.basis)}</p>`+jsonBlock('Original source',value.original,true);
 case 'FACTS':return cards([['Facts',Array.isArray(value)?value.length:value.facts?.length??0],['Explicit fixture decisions',value.fixtureDecisions?.length??0],['Untrusted source claims',value.untrustedClaims?.length??0]])+(value.fixtureDecisions?table(['Decision','Declared fixture value'],value.fixtureDecisions.map(v=>[v.id,v.value])):'');
 case 'DEFINITION':return cards([['Entries',value.participants.count],['Divisions',value.divisions.length],['Stages',value.stages.length]])+table(['Stage','Format','Entries'],value.stages.map(s=>[s.label,s.primitive,s.expectedEntrants]));
 case 'GRAPH':case 'DRAW':return cards([['Actual contests',value.generatedActualContestCount],['Graph nodes',value.nodes.length],['Dependencies',value.edges.length]])+table(['Contest','Stage','Side 1','Side 2'],value.nodes.map(n=>[n.id,n.stageId,...n.slots.map(s=>s.entrantId??(s.contestId?`${s.type} ${s.contestId}`:'bye'))]));
 case 'CLASSIFICATION':return `<p class="fine">SYNTHETIC RESULTS · reproducible audit inputs</p>`+table(['Stage','Entry','Pool','Rank','Played','Wins','Score difference'],Object.entries(value.standings).flatMap(([stage,rows])=>rows.map(r=>[stage,r.entrantId,r.poolId,r.rank,r.played,r.wins,r.scoreDifference])));
 case 'QUALIFICATION':return table(['Destination','Qualified entry','Rule evidence'],Object.entries(value.byStructure).flatMap(([dest,rows])=>rows.map(r=>[dest,r.id,value.evidence.find(e=>e.entrantId===r.id)?.selector??'Missing'])));
 case 'SEED':return `<p class="fine">${escape(value.implementationNote)}</p>`+table(['Destination','Entry','Seed'],Object.entries(value.assignments).flatMap(([id,rows])=>rows.map(r=>[id,r.entrantId,r.seed])));
 case 'TOPOLOGY':return table(['Stage','Entries','Slots','Byes'],value.stages.map(s=>[s.stageId,s.bracket.entrantCount,s.slots,s.byes]));
 case 'SCHEDULE':{
 const def=current.boundaries.find(b=>b.stage==='DEFINITION')?.output;const zone=def?.scheduling?.timezone??'UTC';
 const time=v=>new Date(v).toLocaleTimeString('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
 return cards([['Assigned contests',value.contests.length],['Solver status',value.audit.status]])+`<p class="fine">${escape(value.audit.solver)} · times shown in ${escape(zone)}. St Albans uses its imported source schedule; this is not proof of generic schedule generation.</p>`+table(['Contest','Resource','Start','End'],value.contests.map(c=>[c.contestId,c.resourceId,time(c.start),time(c.end)]));}
 case 'GUARD':return cards([['Decision',value.status],['Accounted contests',value.accounting?.requiredContestCount??'—'],['Committed changes','0']])+jsonBlock('Independent Guard findings',value.findings??[],true);
 default:return '';
 }
}
function render(){
 if(!current)return;
 $('headline').innerHTML=`<div><h2>${escape(current.title)}</h2><p>${current.firstFailure?`First failure: <strong>${escape(labels[current.firstFailure])}</strong> · downstream work blocked`:'All recorded boundaries passed within the stated audit scope.'}</p></div><span class="badge ${current.status==='BLOCKED'?'blocked':''}">${current.status==='BLOCKED'?'BLOCKED':'AUDIT PASSED'}</span>`;
 $('pipeline').innerHTML=current.boundaries.map((b,i)=>`<button type="button" data-stage="${b.stage}" class="${selected===b.stage?'active':''}" aria-current="${selected===b.stage?'step':'false'}"><span class="number">${String(i+1).padStart(2,'0')}</span>${labels[b.stage]}<i class="${b.status.toLowerCase()}" aria-label="${b.status}"></i></button>`).join('');
 const boundary=current.boundaries.find(b=>b.stage===selected)??current.boundaries[0];
 $('detail').innerHTML=`<div class="detail-top"><div><p class="eyebrow">PIPELINE / ${String(current.boundaries.indexOf(boundary)+1).padStart(2,'0')}</p><h3>${escape(labels[boundary.stage])}</h3></div><span class="badge ${boundary.status.toLowerCase()}">${boundary.status}</span></div><p class="caption">${escape(descriptions[boundary.stage])}</p><div class="meta"><span>Revision <code>${boundary.revision}</code></span><span>Duration <code>${boundary.telemetry.elapsedMs} ms</code></span><span title="${boundary.outputHash}">SHA-256 <code>${boundary.outputHash.slice(0,16)}…</code></span></div>${boundary.findings.filter(f=>f.severity==='ERROR').map(f=>`<div class="finding"><code>${escape(f.code)}</code><p>${escape(f.message)}</p><span class="fine">${escape(f.path)}</span>${f.evidence?jsonBlock('Counterexample',f.evidence,true):''}</div>`).join('')}${summary(boundary)}${jsonBlock('Exact boundary input references',boundary.input)}${jsonBlock('Exact boundary output',boundary.output)}${jsonBlock('Run identity and scope',{version:current.version,scenario:current.scenario,revision:current.revision,sourceHash:current.sourceHash,proofHash:current.proofHash,scope:current.scope})}`;
 $('download').disabled=false;
}
async function run(){
 const token=++request;$('run').disabled=true;$('notice').textContent='Loading exact engine evidence…';
 try{
  const id=$('scenario').value,mutation=$('mutation').value;
  const response=catalog.mode==='live'?await fetch('./api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:id,mutation,expectedRevision:1})}):await fetch(`./runs/${encodeURIComponent(id)}-${mutation}.json`);
  if(!response.ok)throw new Error(`Execution unavailable (${response.status}).`);
  const result=await response.json();if(token!==request)return;current=result;selected=current.firstFailure??'SOURCE';render();$('notice').textContent='';
 }catch(error){if(token===request)$('notice').textContent=error.message;}
 finally{if(token===request)$('run').disabled=false;}
}
$('pipeline').addEventListener('click',event=>{const button=event.target.closest('button[data-stage]');if(button){selected=button.dataset.stage;render();}});
$('run').addEventListener('click',run);
$('download').addEventListener('click',()=>{if(!current)return;const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));link.href=url;link.download=`${current.scenario}-${current.mutation}-evidence.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try{
 const response=await fetch('./catalog.json');if(!response.ok)throw new Error('Scenario catalogue is unavailable.');catalog=await response.json();
 $('scenario').innerHTML=catalog.scenarios.map(s=>`<option value="${escape(s.id)}">${escape(s.title)}</option>`).join('');
 $('mode').textContent=catalog.mode==='live'?'Live core execution':'Recorded core execution';
 $('mode-detail').textContent=catalog.mode==='live'?'Runs the real engine on each request. This local observer performs no authoritative writes.':'Explore reproducible outputs from the real core. This hosted inspector loads recorded runs; it does not execute a compiler in your browser.';
 $('run').innerHTML=catalog.mode==='live'?'Run selected audit <span>↗</span>':'Inspect recorded execution <span>↗</span>';
 await run();
}catch(error){$('notice').textContent=error.message;$('run').disabled=true;}

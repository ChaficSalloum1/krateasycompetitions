import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'output/scenario-audit');
const source=readFileSync(join(root,'app.js'),'utf8');const all=new Map();
const element=id=>{if(!all.has(id))all.set(id,{innerHTML:'',textContent:'',value:id==='scenario'?'simple-knockout':id==='mutation'?'none':'',disabled:false,events:{},addEventListener(type,fn){this.events[type]=fn;}});return all.get(id);};
const document={getElementById:element,createElement:()=>({click(){}})};
const fetch=async url=>({ok:true,json:async()=>JSON.parse(readFileSync(join(root,String(url).replace(/^\.\//,'')),'utf8'))});
await new Function('document','fetch','return (async()=>{'+source+'})()')(document,fetch);
for(const id of ['simple-knockout','six-pair-round-robin','play-konnect-reference'])for(const mutation of ['none','qualification','draw','schedule']){
 element('scenario').value=id;element('mutation').value=mutation;await element('run').events.click();assert.equal(element('notice').textContent,'');
 for(const stage of ['SOURCE','FACTS','DEFINITION','GRAPH','CLASSIFICATION','QUALIFICATION','SEED','TOPOLOGY','DRAW','SCHEDULE','GUARD']){
 element('pipeline').events.click({target:{closest:()=>({dataset:{stage}})}});assert.ok(element('detail').innerHTML.length>50);
 }
}
assert.match(element('mode').textContent,/Recorded/);
console.log('PASS: 132 controller-render views over 12 runs. This does not substitute for a real-browser test.');

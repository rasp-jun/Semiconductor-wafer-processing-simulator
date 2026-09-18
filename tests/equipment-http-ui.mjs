import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';

export async function runEquipmentHTTPUI(root, origin='http://127.0.0.1:8771') {
  const {document:d}=parseHTML(await fs.readFile(root+'/equipment.html','utf8'));
  Object.defineProperty(Object.getPrototypeOf(d.querySelector('select')),'value',{configurable:true,get(){return this.testValue??this.querySelector('option')?.getAttribute('value')??'';},set(v){this.testValue=String(v);}});
  for(const dialog of d.querySelectorAll('dialog')){dialog.showModal=function(){this.setAttribute('open','');};dialog.close=function(){this.removeAttribute('open');};}
  const downloads=[],requests=[];let cookie='',pending=0;
  const sandbox={document:d,console,Blob,localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>0,clearTimeout(){},URL:{createObjectURL(b){downloads.push(b);return'blob:test';},revokeObjectURL(){}},
    async fetch(path,options={}){pending++;try{const r=await fetch(origin+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];requests.push({path,status:r.status});const data=await r.json();return{ok:r.ok,status:r.status,json:async()=>data};}finally{pending--;}}};
  sandbox.window=sandbox;const ctx=vm.createContext(sandbox);
  for(const f of ['equipment-engine.js','equipment-view.js','equipment-app.js','equipment-review-math.js','equipment-review.js'])vm.runInContext(await fs.readFile(root+'/'+f,'utf8'),ctx,{filename:f});
  const el=s=>{const e=d.querySelector(s);assert(e,'Missing '+s);return e;};
  async function settle(){let stable=0;for(let i=0;i<500;i++){await new Promise(r=>setTimeout(r,5));if(pending===0)stable++;else stable=0;if(stable>3)return;}throw Error('HTTP action did not settle');}
  async function click(s){assert(!el(s).disabled,'Disabled '+s);el(s).dispatchEvent(new Event('click',{bubbles:true}));await settle();}
  async function submit(values){for(const[k,v]of Object.entries(values))el('[name="'+k+'"]').value=String(v);el('#equipmentReviewForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();}
  async function login(role){await click('#reviewConnect');await submit({username:'test'+role,password:'ephemeral-equipment-test-1234'});assert.equal(ctx.EquipmentReview.state().user.role,role);}
  await login('engineer');await click('#archiveRun');await submit({title:'HTTP saved run',lot_id:'SIM-HTTP',source_name:'Synthetic fixture',change_reason:'Review recorded recipe'});
  const first=ctx.EquipmentReview.state().selected;assert(first?.id);assert.equal(first.revision,1);assert.equal(first.trace.samples.length,ctx.EquipmentApp.snapshot().trace.samples.length);assert.equal(first.trace_sha256.length,64);assert.equal(first.trace.provenance.kind,'unverified');
  await click('[data-review-action="submit"]');await submit({});assert.equal(ctx.EquipmentReview.state().selected.status,'submitted');
  await click('#reviewLogout');await login('reviewer');await click('[data-open-record="'+first.id+'"]');assert(d.querySelector('[data-review-action="review"]'));
  await click('[data-review-action="review"]');await submit({note:'HTTP reviewer inspected the simulation evidence; no equipment release.'});assert.equal(ctx.EquipmentReview.state().selected.status,'reviewed');assert.equal(ctx.EquipmentReview.state().selected.manufacturing_release,false);
  await click('[data-review-action="report"]');assert((await downloads.at(-1).text()).includes(first.trace_sha256));
  await click('#reviewLogout');await login('engineer');await click('[data-open-record="'+first.id+'"]');await click('[data-review-action="baseline"]');await click('[data-review-action="revise"]');
  el('#recipe-beamVoltageV').value='800';el('#recipe-beamVoltageV').dispatchEvent(new Event('input',{bubbles:true}));ctx.EquipmentApp.startRun();
  await click('#archiveRun');await submit({title:'HTTP revision 2',lot_id:'SIM-HTTP',source_name:'Synthetic fixture',change_reason:'Increase beam voltage for comparison'});
  const second=ctx.EquipmentReview.state().selected;assert.equal(second.revision,2);assert.equal(second.parent_id,first.id);assert.equal(second.baseline_id,first.id);assert.equal(second.trace.recipe.beamVoltageV,800);
  const original=await sandbox.fetch('/api/equipment/runs/'+first.id);assert.equal((await original.json()).trace.recipe.beamVoltageV,700);
  const result={passed:4,checks:['real HTTP login and immutable archive','author submission and independent reviewer decision','stored report provenance','revision and baseline with original evidence preserved'],requests};
  await fs.writeFile(root+'/tests/equipment-http-results.json',JSON.stringify(result,null,2));ctx.EquipmentApp.dispose();return result;
}

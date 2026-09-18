import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';

export async function runEquipmentReviewTests(root) {
  const names=['equipment.html','equipment-engine.js','equipment-view.js','equipment-app.js','equipment-review-math.js','equipment-review.js'];
  const files=Object.fromEntries(await Promise.all(names.map(async n=>[n,await fs.readFile(root+'/'+n,'utf8')])));
  const tests=[],clone=v=>JSON.parse(JSON.stringify(v));
  async function test(name,fn){try{await fn();tests.push({name,status:'passed'});}catch(error){tests.push({name,status:'failed',error:error.stack});}}
  const pure=vm.createContext({}); vm.runInContext(files['equipment-review-math.js'],pure);const M=pure.EquipmentReviewMath;
  function sparse(){return {profileId:'P',modelVersion:'V',units:{pressurePa:'Pa'},recipe:{pressurePa:1},samples:[{t:0,stage:'pump',values:{pressurePa:100}},{t:1,stage:'process',values:{pressurePa:2}},{t:3,stage:'process',values:{}},{t:4,stage:'process',values:{pressurePa:5}},{t:8,stage:'cooldown',values:{pressurePa:0}}],events:[],duration:8,outcome:{status:'completed',reason:'example'}};}
  await test('Comparison uses time weights and reports missing channel coverage, excluding pump and cooldown',()=>{
    const s=M.stageSummary(sparse());assert.equal(s.duration,7);assert.equal(s.channels.pressurePa.seconds,6);assert.equal(s.channels.pressurePa.mean,4);assert.equal(s.channels.pressurePa.coverage,6/7);
  });
  await test('Missing stage and incompatible profile or model cannot produce a numerical pass comparison',()=>{
    const a=sparse(),b=sparse();b.profileId='other';assert(!M.compare(a,b).compatible);b.profileId='P';b.modelVersion='other';assert(!M.compare(a,b).compatible);b.modelVersion='V';assert(!M.compare(a,b,'vent').compatible);
    b.units.pressurePa='Torr';assert(!M.compare(a,b).compatible);
  });
  await test('Comparison derives differences from committed trace recipes and preserves absent channels as unknown',()=>{
    const a=sparse(),b=sparse();a.recipe.pressurePa=2;b.samples.forEach(s=>{s.values={beamVoltageV:100};});b.units={beamVoltageV:'V'};
    const r=M.compare(a,b);assert(r.compatible);assert.equal(r.recipe[0].current,2);assert(r.rows.every(x=>x.delta===null));
  });
  await test('Standalone report escapes untrusted strings and preserves record provenance without executable code',()=>{
    const t=sparse();t.events=[{t:1,level:'alarm',code:'<img src=x>',message:'<script>attack()</script>'}];
    const html=M.report(t,{record:{id:'R1',title:'<b>attack</b>',revision:2,author:'A',created_at:'date',trace_sha256:'digest',status:'reviewed',review_note:'not release'}});
    assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('digest'));assert(html.includes('장비 적합성 검증 전'));assert(html.includes('default-src'));assert(!html.includes('<img'));
  });

  function mount({initialized=true,logged=false,role='engineer',failure=null}={}) {
    const {document:d}=parseHTML(files['equipment.html']);
    Object.defineProperty(Object.getPrototypeOf(d.querySelector('select')),'value',{configurable:true,get(){return this.testValue??this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(v){this.testValue=String(v);}});
    for(const dialog of d.querySelectorAll('dialog')){dialog.showModal=function(){this.setAttribute('open','');};dialog.close=function(){this.removeAttribute('open');};}
    const calls=[],downloads=[],records=[],storage=new Map([['waferflow-fab-v05','untouched']]); let signed=logged,uid=0;
    const user={id:'u-'+role,display_name:'Test '+role,role},csrf='test-csrf';
    const response=(status,value)=>({status,ok:status<400,json:async()=>clone(value)});
    async function fakeFetch(url,opts={}){
      const method=opts.method||'GET',data=opts.body?JSON.parse(opts.body):null;calls.push({url,method,data,headers:opts.headers});
      if(failure){const forced=failure(url,opts);if(forced)return response(forced.status,forced.body);}
      if(url==='/api/status')return response(200,{initialized});
      if(url==='/api/login'){signed=true;return response(200,{user,csrf});}
      if(!signed)return response(401,{error:'로그인이 필요합니다.'});
      if(url==='/api/logout'){signed=false;return response(200,{ok:true});}
      if(url==='/api/me')return response(200,{user,csrf});
      if(url==='/api/equipment/capabilities')return response(200,{max_archive_bytes:1400000});
      if(url==='/api/projects')return response(200,[{id:'P1',name:'Project'}]);
      if(url.startsWith('/api/equipment/runs?'))return response(200,{items:records.map(r=>{const c=clone(r);delete c.trace;return c;}),total:records.length,limit:30,offset:0});
      if(url==='/api/equipment/runs'&&method==='POST'){
        const parent=records.find(r=>r.id===data.base_revision_id);
        const r={...data,id:'R'+(++uid),series_id:parent?.series_id||'R'+uid,revision:parent?parent.revision+1:1,parent_id:parent?.id||null,status:'draft',lock_version:1,created_by:user.id,author:user.display_name,created_at:'2026-09-18T00:00:00Z',trace_sha256:'server-content-digest',summary:{declared_outcome:data.trace.outcome.status,duration:data.trace.duration,alarm_count:0},manufacturing_release:false,equipment_validation:'not_validated'};
        records.unshift(r);return response(201,r);
      }
      const match=url.match(/^\/api\/equipment\/runs\/(R\d+)(\/transition)?$/);
      if(match){const r=records.find(r=>r.id===match[1]);if(!r)return response(404,{error:'Missing'});if(match[2]){r.status=data.action==='submit'?'submitted':data.action==='review'?'reviewed':'rejected';r.lock_version++;r.review_note=data.note;r.reviewer=user.display_name;}return response(200,r);}
      throw Error('Unexpected request '+method+' '+url);
    }
    const context={document:d,console,Blob,URL:{createObjectURL(b){downloads.push(b);return'blob:test';},revokeObjectURL(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>0,clearTimeout(){},fetch:fakeFetch};context.window=context;
    const c=vm.createContext(context);names.slice(1).forEach(n=>vm.runInContext(files[n],c,{filename:n}));
    const el=s=>{const x=d.querySelector(s);assert(x,'Missing '+s);return x;};
    const click=s=>{const x=el(s);assert(!x.disabled,s+' disabled');x.dispatchEvent(new Event('click',{bubbles:true}));};
    const input=(s,v)=>{el(s).value=String(v);el(s).dispatchEvent(new Event('input',{bubbles:true}));};
    async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,0));}
    async function submit(values){for(const [k,v]of Object.entries(values))el('#equipmentReviewForm [name="'+k+'"]').value=String(v);el('#equipmentReviewForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();}
    return{d,c,calls,records,downloads,storage,user,el,click,input,settle,submit,app:c.EquipmentApp,review:c.EquipmentReview};
  }
  async function connect(ui){ui.click('#reviewConnect');await ui.settle();if(ui.d.querySelector('#equipmentReviewForm[data-action="login"]'))await ui.submit({username:'engineer',password:'test-only-password'});}
  async function save(ui,title='Trial'){ui.click('#archiveRun');await ui.submit({title,lot_id:'SIM',source_name:'Synthetic',change_reason:'Try new recipe'});assert(ui.records.length,'record not saved');return ui.records[0];}

  await test('Review layer is offline until explicit connection; local baseline survives draft edits',()=>{
    const ui=mount();assert.equal(ui.calls.length,0);ui.click('#pinBaseline');const before=ui.review.state().baseline.trace.recipe.beamVoltageV;
    ui.input('#recipe-beamVoltageV',800);assert.equal(ui.review.state().baseline.trace.recipe.beamVoltageV,before);assert(ui.el('#reviewComparison').textContent.includes('동일 조건'));
    ui.app.startRun();assert(ui.el('#reviewComparison').textContent.includes('700 → 800'));assert.equal(ui.storage.get('waferflow-fab-v05'),'untouched');
  });
  await test('Uninitialized server offers account setup without creating default users',async()=>{
    const ui=mount({initialized:false});await connect(ui);assert(ui.el('#reviewModalBody').textContent.includes('첫 관리자'));assert.equal(ui.calls.filter(c=>c.method==='POST').length,0);
  });
  await test('Account login loads projects and performs writes with CSRF and provenance',async()=>{
    const ui=mount();await connect(ui);assert.equal(ui.review.state().user.role,'engineer');const r=await save(ui);
    const call=ui.calls.find(c=>c.url==='/api/equipment/runs'&&c.method==='POST');assert.equal(call.headers['X-CSRF-Token'],'test-csrf');assert.equal(call.data.trace.schema,'waferflow-equipment-trace-v1');assert.equal(call.data.trace.recipe.beamVoltageV,700);assert(ui.el('#archiveDetail').textContent.includes('server-content-digest'));assert.equal(r.revision,1);
  });
  await test('Archiving freezes the calculated trace at modal open and does not archive unexecuted recipe drafts',async()=>{
    const ui=mount({logged:true});await connect(ui);ui.input('#recipe-beamVoltageV',820);ui.click('#archiveRun');
    ui.app.startRun();await ui.submit({title:'Captured',lot_id:'SIM',source_name:'Synthetic',change_reason:'Captured snapshot'});
    assert.equal(ui.records[0].trace.recipe.beamVoltageV,700);assert.equal(ui.app.snapshot().trace.recipe.beamVoltageV,820);
  });
  await test('New revision loads recorded conditions while retaining original evidence and parent linkage',async()=>{
    const ui=mount({logged:true});await connect(ui);const r=await save(ui);const original=JSON.stringify(r.trace);
    ui.click('[data-review-action="revise"]');await ui.settle();ui.input('#recipe-beamVoltageV',810);ui.app.startRun();const newer=await save(ui,'Revised');
    assert.equal(newer.base_revision_id,r.id);assert.equal(newer.revision,2);assert.equal(newer.trace.recipe.beamVoltageV,810);assert.equal(JSON.stringify(r.trace),original);
  });
  await test('Author submission fixes status and reviewer UI keeps archive editing disabled',async()=>{
    const ui=mount({logged:true});await connect(ui);await save(ui);ui.click('[data-review-action="submit"]');await ui.settle();await ui.submit({});assert.equal(ui.records[0].status,'submitted');assert(!ui.d.querySelector('[data-review-action="review"]'));
    const reviewer=mount({logged:true,role:'reviewer'});await connect(reviewer);assert(reviewer.el('#archiveRun').disabled);assert(reviewer.el('#createReviewProject').hidden);
  });
  await test('Server baseline and saved-record report use archived conditions rather than current edited draft',async()=>{
    const ui=mount({logged:true});await connect(ui);const r=await save(ui);ui.click('[data-review-action="baseline"]');await ui.settle();
    ui.input('#recipe-beamVoltageV',820);ui.app.startRun();ui.click('[data-review-action="report"]');await ui.settle();const html=await ui.downloads.at(-1).text();
    assert(html.includes('server-content-digest'));assert(html.includes('>700<'));assert(!html.includes('>820<'));assert.equal(ui.review.state().baseline.id,r.id);
  });
  await test('Stale save conflicts remain visible without silently creating or overwriting records',async()=>{
    const ui=mount({logged:true,failure:(url,opts)=>url==='/api/equipment/runs'&&opts.method==='POST'?{status:409,body:{error:'최신 버전으로 다시 작성하세요.'}}:null});await connect(ui);ui.click('#archiveRun');await ui.submit({title:'T',lot_id:'L',source_name:'S',change_reason:'C'});
    assert.equal(ui.records.length,0);assert(ui.el('#reviewModal').hasAttribute('open'));assert(ui.el('#reviewFormError').textContent.includes('최신 버전'));
  });
  await test('Logout removes server record controls and baseline without modifying Fab browser storage',async()=>{
    const ui=mount({logged:true});await connect(ui);await save(ui);ui.click('[data-review-action="baseline"]');await ui.settle();ui.click('#reviewLogout');await ui.settle();
    assert.equal(ui.review.state().user,null);assert.equal(ui.review.state().baseline,null);assert(ui.el('#archiveArea').hidden);assert.equal(ui.el('#archiveDetail').innerHTML,'');assert.equal(ui.storage.get('waferflow-fab-v05'),'untouched');
  });
  await test('Current standalone report explicitly has no server approval and includes original whole trace',async()=>{
    const ui=mount();ui.app.seek(1);ui.input('#recipe-beamVoltageV',999);ui.click('#currentReport');const html=await ui.downloads[0].text();assert(html.includes('서버 보관·동료 검토 상태가 연결되지'));assert(html.includes('>700<'));assert(!html.includes('>999<'));assert(html.includes('전체 기록 기준'));
  });
  const result={passed:tests.filter(t=>t.status==='passed').length,tests};await fs.writeFile(root+'/tests/equipment-review-results.json',JSON.stringify(result,null,2));
  const failures=tests.filter(t=>t.status==='failed');if(failures.length)throw Error(failures.map(x=>x.name+'\n'+x.error).join('\n\n'));return result;
}

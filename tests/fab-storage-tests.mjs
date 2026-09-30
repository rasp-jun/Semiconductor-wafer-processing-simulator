import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';

export async function runFabStorageTests(root){
  const tests=[],test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const files=Object.fromEntries(await Promise.all(['cmos-lab.html','fab-engine.js','fab-view.js','fab-guide.js','fab-observe.js','fab-app.js'].map(async name=>[name,await fs.readFile(root+'/'+name,'utf8')])));
  const engine=vm.createContext({});vm.runInContext(files['fab-engine.js'],engine);
  const E=engine.FabEngine,key='waferflow-fab-'+E.VERSION,legacy='waferflow-fab-v05',backup=key+'-recovery';
  const sample=()=>({schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,active:'SAVED',wafers:[{id:'SAVED',title:'보관할 실험',records:E.execute(E.createWafer('SAVED')).wafer.records}]});
  function mount(storage=new Map(),{blocked=false,failWrite=false,locks={request:(_name,_options,write)=>write()}}={}){
    const {document:d}=parseHTML(files['cmos-lab.html']),downloads=[],events=new Map();
    const select=Object.getPrototypeOf(d.querySelector('select'));Object.defineProperty(select,'value',{get(){return this.testValue??this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(v){this.testValue=String(v);},configurable:true});
    for(const input of d.querySelectorAll('input[type=checkbox]'))input.checked=input.hasAttribute('checked');
    for(const dialog of d.querySelectorAll('dialog')){dialog.close=()=>dialog.removeAttribute('open');dialog.showModal=()=>dialog.setAttribute('open','');}
    const sandbox={document:d,console,Blob,URL:{createObjectURL(b){downloads.push(b);return 'blob:test';},revokeObjectURL(){}},localStorage:{getItem(k){if(blocked)throw Error('denied');return storage.get(k)??null;},setItem(k,v){if(blocked||failWrite)throw Error('quota');storage.set(k,v);}},setTimeout(){return 0;},clearTimeout(){},requestAnimationFrame(){return 0;},cancelAnimationFrame(){},performance:{now:()=>0},addEventListener(name,fn){events.set(name,fn);}};
    let windowAdapter; sandbox.CmosWindowUI={mount(adapter){windowAdapter=adapter;}};
    sandbox.navigator={locks};sandbox.window=sandbox;const context=vm.createContext(sandbox);
    for(const name of ['fab-engine.js','fab-view.js','fab-guide.js','fab-observe.js','fab-app.js'])vm.runInContext(files[name],context);
    return {d,app:context.FabApp,storage,downloads,events,windowAdapter,click(selector){d.querySelector(selector).dispatchEvent(new Event('click',{bubbles:true}));}};
  }
  await test('Same-version legacy records migrate without changing the original slot',()=>{
    const raw=JSON.stringify(sample()),storage=new Map([[legacy,raw]]),ui=mount(storage);
    assert.equal(ui.app.snapshot().active,'SAVED');assert.equal(ui.app.snapshot().wafers[0].records.length,1);
    ui.app.select(0);assert.equal(storage.get(legacy),raw);assert.equal(JSON.parse(storage.get(key)).active,'SAVED');
  });
  await test('Incompatible model records remain byte-for-byte downloadable after new work and reload',async()=>{
    const data=sample();data.modelVersion='previous-model';const raw=JSON.stringify(data,null,2),storage=new Map([[legacy,raw]]),ui=mount(storage);
    assert.equal(ui.app.snapshot().wafers[0].records.length,0);assert(!ui.d.querySelector('#storageRecovery').hidden);
    ui.app.select(1);assert.equal(storage.get(legacy),raw);assert.equal(storage.get(backup),raw);
    ui.click('#downloadRecovery');assert.equal(await ui.downloads.at(-1).text(),raw);
    const reloaded=mount(storage);assert.equal(reloaded.app.snapshot().selected,1);reloaded.click('#downloadRecovery');assert.equal(await reloaded.downloads.at(-1).text(),raw);
  });
  await test('Malformed current data is archived before a replacement can be saved',async()=>{
    const raw='{broken original <script>data</script>',storage=new Map([[key,raw]]),ui=mount(storage);
    assert.equal(storage.get(key),raw);assert.equal(storage.get(backup),raw);ui.app.select(2);
    assert.equal(JSON.parse(storage.get(key)).selected,2);ui.click('#downloadRecovery');assert.equal(await ui.downloads.at(-1).text(),raw);
    assert.equal(ui.d.querySelector('#storageRecovery script'),null);
  });
  await test('A second damaged original never overwrites an earlier recovery copy',()=>{
    const storage=new Map([[key,'second damaged original'],[backup,'first damaged original']]),ui=mount(storage);
    ui.app.select(1);assert.equal(storage.get(key),'second damaged original');assert.equal(storage.get(backup),'first damaged original');
    assert(ui.d.querySelector('#saveStatus').classList.contains('error'));
  });
  await test('Archival failure preserves damaged data and leaves new work exportable',async()=>{
    const storage=new Map([[key,'unreadable']]),ui=mount(storage,{failWrite:true});ui.app.select(1);
    assert.equal(storage.get(key),'unreadable');ui.click('#exportButton');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).selected,1);
  });
  await test('Denied browser storage still permits simulation and JSON export',async()=>{
    const ui=mount(new Map(),{blocked:true});ui.app.select(1);ui.click('#exportButton');
    assert.equal(JSON.parse(await ui.downloads.at(-1).text()).selected,1);assert(ui.d.querySelector('#saveStatus').classList.contains('error'));
  });
  await test('A competing tab save cannot be overwritten even before its storage event arrives',()=>{
    const storage=new Map(),ui=mount(storage);ui.app.select(0);const other=JSON.stringify(sample());storage.set(key,other);ui.app.select(1);
    assert.equal(storage.get(key),other);assert(ui.d.querySelector('#storageRecoveryMessage').textContent.includes('다른 탭'));
    ui.app.select(2);assert.equal(storage.get(key),other);
  });
  await test('A storage conflict pauses playback and keeps the competing original downloadable',async()=>{
    const storage=new Map(),ui=mount(storage);ui.click('#runButton');const other=JSON.stringify(sample());storage.set(key,other);
    ui.events.get('storage')({key});assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');
    ui.click('#downloadRecovery');assert.equal(await ui.downloads.at(-1).text(),other);assert.equal(storage.get(key),other);
  });
  await test('Unrelated storage events do not block normal saves',()=>{
    const ui=mount();ui.events.get('storage')({key:'another-app'});ui.app.select(1);assert.equal(JSON.parse(ui.storage.get(key)).selected,1);
  });
  await test('Unsaved experiments request navigation protection while saved idle work does not',()=>{
    let prevented=false;const event=()=>({preventDefault(){prevented=true;}}),ui=mount(new Map(),{failWrite:true});
    ui.app.select(1);ui.events.get('beforeunload')(event());assert(prevented);
    prevented=false;const clean=mount();clean.app.select(1);clean.events.get('beforeunload')(event());assert(!prevented);
  });
  await test('Queued competing saves execute under one exclusive lock and preserve the first writer',()=>{
    const pending=[],locks={request(name,options,write){assert.equal(options.mode,'exclusive');assert.equal(name,key+'-write');pending.push(write);return Promise.resolve();}},storage=new Map();
    const left=mount(storage,{locks}),right=mount(storage,{locks});left.app.select(1);right.app.select(2);
    assert.equal(storage.get(key),undefined);pending.shift()();const original=storage.get(key);pending.shift()();
    assert.equal(storage.get(key),original);assert.equal(JSON.parse(original).selected,1);assert(right.d.querySelector('#storageRecoveryMessage').textContent.includes('다른 탭'));
  });
  await test('Queued saves retain navigation protection until the latest snapshot is stored',()=>{
    const pending=[],locks={request(_name,_options,write){pending.push(write);return Promise.resolve();}},ui=mount(new Map(),{locks});
    ui.app.select(1);ui.app.select(2);pending.shift()();let prevented=false;ui.events.get('beforeunload')({preventDefault(){prevented=true;}});assert(prevented);
    pending.shift()();prevented=false;ui.events.get('beforeunload')({preventDefault(){prevented=true;}});assert(!prevented);assert.equal(JSON.parse(ui.storage.get(key)).selected,2);
  });
  await test('Contexts without exclusive storage locks preserve existing data and support manual exports',async()=>{
    const raw=JSON.stringify(sample()),storage=new Map([[key,raw]]),ui=mount(storage,{locks:null});ui.app.select(1);
    assert.equal(storage.get(key),raw);assert(ui.d.querySelector('#storageRecoveryMessage').textContent.includes('저장 잠금'));
    ui.click('#exportButton');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).selected,1);
  });
  await test('Malformed import rows fail atomically with user-facing validation',()=>{
    const ui=mount(),before=JSON.stringify(ui.app.snapshot().wafers);
    for(const change of [data=>data.wafers=[null],data=>data.wafers[0].records=[null],data=>data.wafers[0].overrides=[],data=>data.wafers[0].overrides={OP001:[]},data=>data.wafers[0].conditions=[],data=>data.wafers[0].records[0].fault=false]){
      const data=sample();change(data);assert.throws(()=>ui.app.importData(data),/웨이퍼|공정|레시피/);assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);
    }
  });
  await test('A full manual JSON export resolves the leave warning only until the next edit and never for an active run',async()=>{
    const ui=mount(new Map(),{failWrite:true}),protectedLeave=()=>{let prevented=false;ui.events.get('beforeunload')({preventDefault(){prevented=true;}});return prevented;};
    ui.app.select(1);assert(protectedLeave());ui.click('#reportButton');assert(protectedLeave());
    ui.click('#exportButton');assert(!protectedLeave());assert.equal(JSON.parse(await ui.downloads.at(-1).text()).selected,1);assert(ui.d.querySelector('#saveStatus').textContent.includes('다운로드 요청'));
    ui.app.select(0);assert(protectedLeave());ui.click('#exportButton');assert(!protectedLeave());
    ui.click('#runButton');ui.click('#exportButton');assert(protectedLeave());
  });
  await test('Imported execution dates require a real calendar date and explicit timezone without coercing numbers',()=>{
    const ui=mount(),before=JSON.stringify(ui.app.snapshot().wafers);
    for(const time of [0,2026,null,'0','2026-09-24T12:00:00','2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-09-24T24:00:01Z','2026-09-24T24:00:00.001Z','2026-09-24T12:00:00+00:60']){
      const data=sample();data.wafers[0].records[0].time=time;
      assert.throws(()=>ui.app.importData(data),/실행 시각/);assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);
    }
  });
  await test('Offset timestamps stay verbatim in history and reports identify the original timezone',async()=>{
    const ui=mount(),data=sample(),time='2024-02-29T23:45:12.123+09:30';data.wafers[0].records[0].time=time;ui.app.importData(data);
    assert.equal(ui.app.snapshot().wafers.find(w=>w.id==='SAVED').records[0].time,time);
    ui.click('#reportButton');const report=await ui.downloads.at(-1).text();
    assert(report.includes('실행 시각 (원본 시간대)'));assert(report.includes(time));
    const midnight=sample();midnight.wafers[0].records[0].time='2026-09-24T24:00:00Z';ui.app.importData(midnight);
    assert.equal(ui.app.snapshot().wafers.at(-1).records[0].time,'2026-09-24T24:00:00Z');
  });
  await test('A process-window branch preserves its complete source and retains future drafts across reload',()=>{
    let wafer=E.createWafer('SAVED');while(wafer.cursor<4)wafer=E.execute(wafer).wafer;
    const data=sample(),late=E.route[4];data.wafers[0]={...data.wafers[0],note:'원본 메모',records:wafer.records,overrides:{[late.id]:E.recipeFor(late)},conditions:{[late.id]:'uniformity'}};
    const ui=mount(new Map([[key,JSON.stringify(data)]]));ui.app.select(1);
    const source=JSON.stringify(ui.app.snapshot().wafers[0]),captured=ui.windowAdapter.capture(),recipe={...captured.config.baseRecipe};
    const field=Object.keys(recipe)[0];recipe[field]=E.tools[E.route[1].tool].fields[field].max;
    assert.equal(captured.token.mode,'branch');ui.windowAdapter.apply(recipe,'uniformity',captured.token);
    const state=ui.app.snapshot(),branch=state.wafers.at(-1);
    assert.equal(state.wafers.length,2);assert.equal(state.active,branch.id);assert.equal(state.selected,1);assert.equal(JSON.stringify(state.wafers[0]),source);
    assert.equal(JSON.stringify(branch.records),JSON.stringify(data.wafers[0].records.slice(0,1)));assert.equal(branch.parent.id,'SAVED');assert.equal(branch.parent.from,1);
    assert.equal(JSON.stringify(branch.overrides[E.route[1].id]),JSON.stringify(recipe));assert.equal(branch.conditions[E.route[1].id],'uniformity');assert.equal(branch.note,'원본 메모');
    assert.equal(JSON.stringify(branch.overrides[late.id]),JSON.stringify(data.wafers[0].overrides[late.id]));assert.equal(branch.conditions[late.id],'uniformity');
    assert.equal(JSON.stringify(branch.overrides[E.route[2].id]),JSON.stringify(data.wafers[0].records[2].recipe));
    const restored=mount(ui.storage).app.snapshot();assert.equal(JSON.stringify(restored.wafers),JSON.stringify(state.wafers));assert.equal(restored.active,branch.id);
  });
  await test('Stale process-window captures reject raw draft, metadata and operation changes without writes',()=>{
    const data=sample(),ui=mount(new Map([[key,JSON.stringify(data)]]));ui.app.select(0);
    const captured=ui.windowAdapter.capture(),input=ui.d.querySelector('[data-field]'),raw=input.value;
    input.value='';let before=JSON.stringify(ui.app.snapshot().wafers);
    assert.throws(()=>ui.windowAdapter.apply(captured.config.baseRecipe,'none',captured.token),/변경/);assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);
    input.value=raw;ui.d.querySelector('#experimentNameInput').value='새 실험 이름';ui.d.querySelector('#experimentNoteInput').value='';ui.d.querySelector('#experimentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    before=JSON.stringify(ui.app.snapshot().wafers);assert.throws(()=>ui.windowAdapter.apply(captured.config.baseRecipe,'none',captured.token),/변경/);assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);
    ui.app.select(1);assert.throws(()=>ui.windowAdapter.apply(captured.config.baseRecipe,'none',captured.token),/변경/);
  });
  await test('Full wafer capacity rejects a process-window branch before changing any history or draft',()=>{
    const data=sample();data.wafers=Array.from({length:25},(_,i)=>({...data.wafers[0],id:i?'EXTRA'+i:'SAVED'}));
    const ui=mount(new Map([[key,JSON.stringify(data)]]));ui.app.select(0);const captured=ui.windowAdapter.capture(),before=JSON.stringify(ui.app.snapshot().wafers),stored=ui.storage.get(key);
    assert.throws(()=>ui.windowAdapter.apply(captured.config.baseRecipe,'none',captured.token),/25개/);
    assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);assert.equal(ui.app.snapshot().active,'SAVED');assert.equal(ui.storage.get(key),stored);
  });
  return {passed:tests.length,failed:0,tests};
}

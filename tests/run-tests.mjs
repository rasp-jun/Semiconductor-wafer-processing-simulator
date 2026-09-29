import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Blob } from 'node:buffer';
import { parseHTML, Event } from './linkedom.worker.mjs';

// DOM behavior tests only: this does not render CSS or replace browser visual QA.
export async function runTests(rootPath) {
  const tests=[];
  const test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const files=Object.fromEntries(await Promise.all(['index.html','engine.js','visuals.js','app.js'].map(async f=>[f,await fs.readFile(`${rootPath}/${f==='index.html'?'photo-lab.html':f}`,'utf8')])));
  const modelContext=vm.createContext({});vm.runInContext(files['engine.js'],modelContext);const E=modelContext.WaferEngine;
  await test('Same recipe and seed reproduce every die exactly',()=>assert.equal(JSON.stringify(E.simulate(E.defaults)),JSON.stringify(E.simulate(E.defaults))));
  await test('All missions are solvable and improve over their baseline',()=>{for(const m of E.missions){const base=E.simulate(m.defaults,m.id),good=E.simulate(E.defaults,m.id);assert(good.passed);assert(good.yield>base.yield+10);}});
  await test('Oxidation increases with time and temperature',()=>{const b=E.simulate(E.defaults);assert(E.simulate({...E.defaults,temperature:1050}).oxide>b.oxide);assert(E.simulate({...E.defaults,oxidationTime:60}).oxide>b.oxide);});
  await test('Spin speed changes PR thickness and etching balances residue with damage',()=>{assert(E.simulate({...E.defaults,rpm:4000}).pr<E.simulate(E.defaults).pr);const short=E.simulate({...E.defaults,etchTime:30}),good=E.simulate(E.defaults),long=E.simulate({...E.defaults,etchTime:150});assert(short.yield<good.yield);assert(long.yield<good.yield);assert(short.dies.some(d=>d.residue>20));});
  await test('Every control influences the model',()=>{for(const [key,f] of Object.entries(E.fields)){const a=E.simulate(E.defaults),b=E.simulate({...E.defaults,[key]:f.max});assert.notEqual(JSON.stringify(a.dies)+a.cost+a.pr,JSON.stringify(b.dies)+b.cost+b.pr,key);}});
  await test('Parameter bounds and invalid input produce finite, consistent results',()=>{for(const value of [NaN,Infinity,-99999,99999]){const p=Object.fromEntries(Object.keys(E.fields).map(k=>[k,value]));const r=E.simulate(p);assert(Number.isFinite(r.yield));assert(r.yield>=0&&r.yield<=100);assert.equal(r.bad+r.good,r.total);assert.equal(r.histogram.counts.reduce((a,b)=>a+b,0),r.total);assert.equal(r.distribution.reduce((a,b)=>a+b.count,0),r.bad);}});
  await test('Statistical outputs contain actual recomputed samples',()=>{const a=E.monteCarlo(E.defaults,'residue');assert.equal(a.samples.length,30);assert(a.interval[0]<=a.mean&&a.mean<=a.interval[1]);assert(a.sd>0);const sweep=E.sweep(E.defaults,'residue','dose');assert.equal(sweep.length,9);for(const p of sweep)assert.equal(p.yield,E.simulate({...E.defaults,dose:p.value},'residue').yield);});

  let stored=new Map(),downloads=[],timers=[],frames=new Map(),frameId=0;
  function mount(environment={}){
    const {document}=parseHTML(files['index.html']);
    let clock=0;const listeners={};
    for(const d of document.querySelectorAll('dialog')){d.showModal=function(){this.setAttribute('open','')};d.close=function(){this.removeAttribute('open')};}
    for(const input of document.querySelectorAll('input')){input.setCustomValidity=function(text){this.testValidity=text};input.reportValidity=()=>true;}
    // linkedom intentionally has no writable HTMLSelectElement.value implementation.
    for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{get(){return this.testValue||this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||''},set(v){this.testValue=v},configurable:true});
    const storage=environment.storage||stored;
    const sandbox={document,console,crypto:{randomUUID},Blob,URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test'},revokeObjectURL(){}},localStorage:{getItem:environment.readStorage||(k=>storage.get(k)??null),setItem:environment.writeStorage||((k,v)=>storage.set(k,v))},navigator:environment.noLocks?{}:{locks:{request:environment.lockRequest||((_name,_options,write)=>write())}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId},cancelAnimationFrame:id=>frames.delete(id),performance:{now:()=>clock},addEventListener(name,fn){(listeners[name]||=[]).push(fn);}};
    sandbox.window=sandbox;const ctx=vm.createContext(sandbox);for(const f of ['engine.js','visuals.js','app.js'])vm.runInContext(files[f],ctx,{filename:f});
    const click=selector=>{const element=document.querySelector(selector);assert(element,selector);element.dispatchEvent(new Event('click',{bubbles:true}));};
    const input=(selector,value)=>{const el=document.querySelector(selector);el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));};
    const completeRun=async()=>{const task=timers.find(t=>t.ms===650);assert(task);timers=timers.filter(t=>t!==task);task.fn();await Promise.resolve();await Promise.resolve();};
    const advance=ms=>{clock+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(clock));};
    const hidden=value=>{Object.defineProperty(document,'hidden',{value,configurable:true});document.dispatchEvent(new Event('visibilitychange'));};
    return {document,ctx,click,input,completeRun,advance,hidden,now:()=>clock,emit:(name,event={})=>(listeners[name]||[]).forEach(fn=>fn(event))};
  }
  await test('Invalid optional saved metadata cannot crash restoration or replace valid process conditions',()=>{
    const original=stored,raw=JSON.stringify({missionId:'residue',params:E.defaults,lastResult:{missionId:'residue',params:E.defaults,label:{}},history:[{id:'META_RUN',missionId:'residue',params:E.defaults,time:42,label:{text:'bad'},hypothesis:[]}],recipes:[{id:'META_RECIPE',missionId:'residue',params:E.defaults,time:{iso:'bad'},name:{text:'bad'}}]});
    stored=new Map([['waferflow-v2',raw]]);const ui=mount();assert.equal(JSON.stringify(ui.ctx.WaferAppBridge.snapshot().params),JSON.stringify(E.defaults));assert.equal(ui.document.querySelector('#runLabel').textContent,'저장된 실행');ui.click('[data-page="notebook"]');assert.equal(ui.document.querySelectorAll('.report-card').length,1);assert.equal(ui.document.querySelectorAll('.saved-recipe').length,1);assert(ui.document.querySelector('#reportCards').textContent.includes('복원한 실험'));assert(!ui.document.querySelector('#page-notebook').textContent.includes('[object Object]'));assert.equal(stored.get('waferflow-v2'),raw,'Opening the page must preserve the original stored payload');stored=original;
  });
  const photoKey='waferflow-v2',photoSaved=()=>({version:2,missionId:'residue',params:{...E.defaults},hypothesis:'기존 가설',history:[{id:'SAVED_RUN',label:'RUN 001',time:'2026-09-24T00:00:00.000Z',missionId:'residue',params:{...E.defaults},hypothesis:'실행 가설',modelVersion:E.version}],recipes:[{id:'SAVED_RECIPE',name:'보관한 조건',time:'2026-09-24T00:00:00.000Z',missionId:'residue',params:{...E.defaults}}],lastResult:{missionId:'residue',params:{...E.defaults},label:'RUN 001'}});
  const unloadBlocked=ui=>{let prevented=false;ui.emit('beforeunload',{preventDefault(){prevented=true;}});return prevented;};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const choosePhotoFile=(ui,file)=>{const input=ui.document.querySelector('#importPhotoFile');Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));};
  const recordFile=data=>({name:'lesson.json',size:1000,text:async()=>JSON.stringify(data)});
  await test('Photo JSON import previews without mutation, backs up current records and restores draft separately from the last run',async()=>{
    const before=photoSaved(),raw=JSON.stringify(before),storage=new Map([[photoKey,raw]]),ui=mount({storage});
    const incoming={...photoSaved(),schema:'waferflow-photo-records-v1',modelVersion:E.version,params:{...E.defaults,dose:120},hypothesis:'가져온 미실행 조건'};
    incoming.history.push({...incoming.history[0],id:'OTHER_MISSION',missionId:'focus',hypothesis:'다른 미션의 기록'});
    choosePhotoFile(ui,recordFile(incoming));await settle();assert(ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));assert.equal(storage.get(photoKey),raw);assert.equal(ui.document.querySelector('#hypothesis').value,before.hypothesis);
    ui.click('#confirmPhotoImport');const backup=JSON.parse(await downloads.at(-1).text());assert.deepEqual(backup.history,before.history);assert.equal(backup.hypothesis,before.hypothesis);
    const restored=JSON.parse(storage.get(photoKey));assert.deepEqual(restored.history,incoming.history);assert.deepEqual(restored.recipes,incoming.recipes);assert.deepEqual(restored.params,incoming.params);assert.deepEqual(restored.lastResult,incoming.lastResult);assert.equal(restored.hypothesis,incoming.hypothesis);
    assert(ui.document.querySelector('#draftStatus').textContent.includes('변경됨'));assert.equal(ui.document.querySelector('#yieldValue').textContent,E.simulate(incoming.lastResult.params,incoming.missionId).yield.toFixed(1));assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));
    const again=mount({storage});assert.equal(again.document.querySelector('#hypothesis').value,incoming.hypothesis);assert.equal(JSON.stringify(again.ctx.WaferAppBridge.snapshot().params),JSON.stringify(incoming.params));
  });
  await test('Cancelling a photo file leaves all current records unchanged and does not download a backup',async()=>{
    const raw=JSON.stringify(photoSaved()),storage=new Map([[photoKey,raw]]),ui=mount({storage}),count=downloads.length;
    choosePhotoFile(ui,recordFile(photoSaved()));await settle();ui.click('#cancelPhotoImport');ui.click('#confirmPhotoImport');assert.equal(storage.get(photoKey),raw);assert.equal(downloads.length,count);assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));
  });
  await test('Malformed, incompatible and ambiguous photo imports are rejected atomically',async()=>{
    const corrupt=[{}, {...photoSaved(),version:99}, {...photoSaved(),schema:'wrong'}, {...photoSaved(),modelVersion:'future'}, {...photoSaved(),params:{...E.defaults,dose:Infinity}}, {...photoSaved(),hypothesis:'x'.repeat(501)}, {...photoSaved(),history:[{...photoSaved().history[0],label:{bad:true}}]}, {...photoSaved(),recipes:Array(51).fill(photoSaved().recipes[0])}, {...photoSaved(),lastResult:{...photoSaved().lastResult,missionId:'focus'}}, {...photoSaved(),history:[...photoSaved().history,...photoSaved().history]}, {...photoSaved(),history:[{...photoSaved().history[0],id:'baseline'}]}];
    const files=[...corrupt.map(recordFile),{name:'broken.json',size:10,text:async()=>'{broken'},{name:'too-large.json',size:2097153,text:async()=>{throw Error('Oversized files must not be read');}}];
    for(const file of files){const raw=JSON.stringify(photoSaved()),storage=new Map([[photoKey,raw]]),ui=mount({storage});choosePhotoFile(ui,file);await settle();assert.equal(storage.get(photoKey),raw);assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));assert(ui.document.querySelector('#toast').textContent.includes('불러오지 못했습니다'));}
  });
  await test('New file selection and edits cancel late photo reads and stale confirmation',async()=>{
    const storage=new Map(),ui=mount({storage});let resolveOld;
    choosePhotoFile(ui,{name:'old.json',size:1,text:()=>new Promise(resolve=>resolveOld=resolve)});
    const current={...photoSaved(),hypothesis:'최신 선택'};choosePhotoFile(ui,recordFile(current));await settle();resolveOld(JSON.stringify({...photoSaved(),hypothesis:'늦은 선택'}));await settle();ui.click('#confirmPhotoImport');assert.equal(JSON.parse(storage.get(photoKey)).hypothesis,'최신 선택');
    let resolveEdited;choosePhotoFile(ui,{name:'late.json',size:1,text:()=>new Promise(resolve=>resolveEdited=resolve)});ui.input('#hypothesis','읽기 도중 편집');resolveEdited(JSON.stringify(photoSaved()));await settle();assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));assert.equal(JSON.parse(storage.get(photoKey)).hypothesis,'읽기 도중 편집');
    choosePhotoFile(ui,recordFile(photoSaved()));await settle();ui.input('#hypothesis','확인 전에 변경');ui.click('#confirmPhotoImport');assert.equal(JSON.parse(storage.get(photoKey)).hypothesis,'확인 전에 변경');assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));
  });
  await test('Photo import cannot replace a run in progress, including a run started during a file read',async()=>{
    const ui=mount({storage:new Map()});let resolveRead;choosePhotoFile(ui,{name:'delayed.json',size:1,text:()=>new Promise(resolve=>resolveRead=resolve)});ui.click('#runSimulation');resolveRead(JSON.stringify(photoSaved()));await settle();assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));assert(ui.document.querySelector('#runSimulation').disabled);await ui.completeRun();assert.equal(ui.document.querySelector('#runLabel').textContent,'RUN 001');
  });
  await test('Late photo reads cannot overlay a recipe naming dialog or reopen after another dialog task',async()=>{
    for(const closeBeforeRead of [false,true]){
      const ui=mount({storage:new Map()});let resolveRead;
      choosePhotoFile(ui,{name:'delayed.json',size:1,text:()=>new Promise(resolve=>resolveRead=resolve)});
      ui.click('#saveRecipe');ui.input('#recipeName','기존 조건을 위한 이름');if(closeBeforeRead)ui.click('#saveDialog .close-dialog');
      resolveRead(JSON.stringify({...photoSaved(),params:{...E.defaults,dose:140}}));await settle();
      assert(!ui.document.querySelector('#importPhotoDialog').hasAttribute('open'));assert.equal(ui.document.querySelector('#saveDialog').hasAttribute('open'),!closeBeforeRead);assert.equal(ui.document.querySelector('#recipeName').value,'기존 조건을 위한 이름');
    }
  });
  await test('Recipe naming stores the conditions captured when the dialog opened',()=>{
    const storage=new Map(),ui=mount({storage});ui.ctx.WaferAppBridge.loadRecipe({scenario:'residue',params:E.defaults});ui.click('#saveRecipe');ui.input('#recipeName','처음 열었을 때의 조건');
    ui.ctx.WaferAppBridge.loadRecipe({scenario:'focus',params:{...E.defaults,dose:140}});
    ui.document.querySelector('#saveForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    const saved=JSON.parse(storage.get(photoKey));assert.equal(saved.recipes[0].missionId,'residue');assert.deepEqual(saved.recipes[0].params,JSON.parse(JSON.stringify(E.defaults)));assert.equal(saved.params.dose,140);assert.equal(saved.missionId,'focus');
  });
  await test('Photo import supports valid legacy files while retaining protected originals on storage failure',async()=>{
    for(const options of [{storage:new Map([[photoKey,'{original broken']])},{storage:new Map(),noLocks:true}]){
      const ui=mount(options),incoming=photoSaved();delete incoming.version;incoming.hypothesis='복원한 과거 파일';choosePhotoFile(ui,recordFile(incoming));await settle();ui.click('#confirmPhotoImport');assert.equal(ui.document.querySelector('#hypothesis').value,incoming.hypothesis);assert(unloadBlocked(ui));
      assert.equal(options.storage.get(photoKey),options.noLocks?undefined:'{original broken');ui.click('#exportPhotoState');assert.equal(JSON.parse(await downloads.at(-1).text()).hypothesis,incoming.hypothesis);assert(!unloadBlocked(ui));
    }
  });
  await test('Damaged and incompatible photo records remain exact downloadable originals after edits',async()=>{
    for(const raw of ['', '{broken <script>original</script>', 'null', '[]', JSON.stringify({...photoSaved(),version:3}), JSON.stringify({...photoSaved(),schema:'unknown'}), JSON.stringify({...photoSaved(),modelVersion:'future-model'})]){
      const storage=new Map([[photoKey,raw]]),ui=mount({storage});
      ui.input('#hypothesis','이 원본과 별도로 보관할 실험');assert.equal(storage.get(photoKey),raw);assert(unloadBlocked(ui));
      ui.click('#downloadPhotoOriginal');assert.equal(await downloads.at(-1).text(),raw);
      assert(!ui.document.querySelector('#photoStorageStatus script'));
      ui.click('#exportPhotoState');const data=JSON.parse(await downloads.at(-1).text());assert.equal(data.hypothesis,'이 원본과 별도로 보관할 실험');assert.equal(data.modelVersion,E.version);assert.equal(data.schema,'waferflow-photo-records-v1');assert(!unloadBlocked(ui));assert.equal(storage.get(photoKey),raw);
    }
  });
  await test('Valid legacy records restore all missions and remain unchanged until an intentional save',async()=>{
    for(const hasVersion of [true,false]){
      const saved=photoSaved();if(!hasVersion)delete saved.version;
      saved.history.push({...saved.history[0],id:'OTHER_RUN',missionId:'focus',label:'RUN 002'});
      const raw=JSON.stringify(saved),storage=new Map([[photoKey,raw]]),ui=mount({storage});
      assert.equal(storage.get(photoKey),raw);assert(ui.document.querySelector('#downloadPhotoOriginal').hidden);assert.equal(ui.document.querySelector('#hypothesis').value,saved.hypothesis);
      ui.input('#hypothesis','현재 가설');assert(!unloadBlocked(ui));ui.click('#exportPhotoState');
      const data=JSON.parse(await downloads.at(-1).text());assert.deepEqual(data.history,saved.history);assert.deepEqual(data.recipes,saved.recipes);assert.deepEqual(data.lastResult,saved.lastResult);assert.deepEqual(data.params,saved.params);assert.equal(data.hypothesis,'현재 가설');assert.equal(JSON.parse(storage.get(photoKey)).hypothesis,'현재 가설');
    }
  });
  await test('Partially readable records retain valid rows while protecting malformed metadata and model versions',async()=>{
    const saved=photoSaved();saved.recipes[0].name={bad:'name'};saved.history.push({...saved.history[0],id:'INCOMPATIBLE',modelVersion:'different-model'});const raw=JSON.stringify(saved),storage=new Map([[photoKey,raw]]),ui=mount({storage});
    ui.click('[data-page="notebook"]');assert.equal(ui.document.querySelectorAll('.report-card').length,1);assert.equal(ui.document.querySelectorAll('.saved-recipe').length,1);
    ui.input('#hypothesis','유효한 기록과 함께 새 가설');assert.equal(storage.get(photoKey),raw);ui.click('#downloadPhotoOriginal');assert.equal(await downloads.at(-1).text(),raw);
  });
  await test('Concurrent photo tabs compare and write within one exclusive lock without losing either draft',async()=>{
    const raw=JSON.stringify(photoSaved()),storage=new Map([[photoKey,raw]]),queue=[],lockRequest=(name,options,write)=>new Promise(resolve=>queue.push({name,options,run:()=>resolve(write())})),a=mount({storage,lockRequest}),b=mount({storage,lockRequest});
    a.input('#hypothesis','first draft');a.input('#hypothesis','latest first tab');b.input('#hypothesis','second tab evidence');assert.equal(queue.length,3);assert.equal(storage.get(photoKey),raw);
    assert(queue.every(q=>q.name===photoKey+'-write'&&q.options.mode==='exclusive'));
    queue.shift().run();assert.equal(storage.get(photoKey),raw,'Superseded pending edits must not be written');queue.shift().run();await Promise.resolve();const first=storage.get(photoKey);assert.equal(JSON.parse(first).hypothesis,'latest first tab');queue.shift().run();await Promise.resolve();
    assert.equal(storage.get(photoKey),first);assert(b.document.querySelector('#photoStorageMessage').textContent.includes('다른 탭'));assert(unloadBlocked(b));
    b.click('#downloadPhotoOriginal');assert.equal(await downloads.at(-1).text(),first);b.click('#exportPhotoState');assert.equal(JSON.parse(await downloads.at(-1).text()).hypothesis,'second tab evidence');assert(!unloadBlocked(b));
  });
  await test('Photo quota failures stay visible, preserve data and support export or a later successful save',async()=>{
    const raw=JSON.stringify(photoSaved()),storage=new Map([[photoKey,raw]]);let fail=true;const ui=mount({storage,writeStorage(k,v){if(fail)throw Error('quota');storage.set(k,v);}});
    ui.input('#hypothesis','저장 실패 중 편집');assert.equal(storage.get(photoKey),raw);assert(unloadBlocked(ui));ui.click('#hintButton');ui.click('[data-page="notebook"]');assert(ui.document.querySelector('#photoStorageMessage').textContent.includes('저장하지 못했습니다'));assert(!ui.document.querySelector('#photoStorageStatus').closest('[hidden]'));
    ui.click('#exportPhotoState');assert.equal(JSON.parse(await downloads.at(-1).text()).hypothesis,'저장 실패 중 편집');assert(!unloadBlocked(ui));ui.input('#hypothesis','내려받은 뒤 수정');assert(unloadBlocked(ui));
    fail=false;ui.input('#hypothesis','저장 복구');assert.equal(JSON.parse(storage.get(photoKey)).hypothesis,'저장 복구');assert(!unloadBlocked(ui));assert(!ui.document.querySelector('#photoStorageStatus').classList.contains('error'));
  });
  await test('Unavailable storage or locks never causes unsafe photo autosaves and keeps the server handoff usable',async()=>{
    for(const environment of [{noLocks:true},{readStorage(){throw Error('denied');}}]){
      const raw=JSON.stringify(photoSaved()),storage=new Map([[photoKey,raw]]),ui=mount({storage,...environment});
      ui.ctx.WaferAppBridge.loadRecipe({params:{...E.defaults,dose:120},scenario:'focus',reason:'서버 검토 조건'});assert.equal(storage.get(photoKey),raw);assert(ui.document.querySelector('#photoStorageMessage').textContent.includes('자동 저장을 중지'));assert(unloadBlocked(ui));
      ui.click('#exportPhotoState');const data=JSON.parse(await downloads.at(-1).text());assert.equal(data.params.dose,120);assert.equal(data.missionId,'focus');assert.equal(data.hypothesis,'서버 검토 조건');
    }
  });
  await test('Storage clearing and rejected locks retain photo changes and show persistent recovery guidance',async()=>{
    const storage=new Map([[photoKey,JSON.stringify(photoSaved())]]),ui=mount({storage});ui.emit('storage',{key:'unrelated'});assert(!ui.document.querySelector('#photoStorageMessage').textContent.includes('다른 탭'));
    storage.clear();ui.emit('storage',{key:null});ui.input('#hypothesis','삭제 후 현재 화면 보존');assert.equal(storage.has(photoKey),false);assert(ui.document.querySelector('#photoStorageMessage').textContent.includes('다른 탭'));assert(ui.document.querySelector('#downloadPhotoOriginal').hidden);
    const denied=mount({storage:new Map(),lockRequest:()=>Promise.reject(Error('denied lock'))});denied.input('#hypothesis','잠금 거부 후 가설');await new Promise(resolve=>setImmediate(resolve));assert(denied.document.querySelector('#photoStorageMessage').textContent.includes('저장하지 못했습니다'));assert(unloadBlocked(denied));
  });
  let app=mount(),d=app.document;
  await test('Initial UI renders exposure, all 8 stages, 3 views and baseline',()=>{assert.equal(d.querySelectorAll('[data-stage]').length,8);assert.equal(d.querySelectorAll('[data-view]').length,3);assert(d.querySelector('#visualization svg'));assert(d.querySelector('#stageName').textContent.includes('노광'));assert.equal(d.querySelector('#yieldValue').textContent,'39.0');});
  await test('Exposure retains PR; development removes exposed regions',()=>{app.click('[data-view="section"]');assert(d.querySelector('#visualization').textContent.includes('아직 제거되지 않음'));app.click('[data-stage="5"]');assert(d.querySelector('#visualization').textContent.includes('현상 부족'));app.click('[data-view="scene"]');});
  await test('Recipe preview updates while executed KPI stays unchanged',()=>{app.click('[data-stage="3"]');app.input('#param-dose',100);assert(d.querySelector('#draftStatus').textContent.includes('변경됨'));assert.equal(d.querySelector('#yieldValue').textContent,'39.0');app.click('[data-stage="5"]');app.input('#param-developTime',60);});
  await test('Run snapshots values, hypothesis and computed result',async()=>{app.input('#hypothesis','노광량과 현상 시간을 기준으로 복원하여 잔사를 줄인다.');app.click('#runSimulation');assert(d.querySelector('#runSimulation').disabled);await app.completeRun();assert(!d.querySelector('#runSimulation').disabled);assert.equal(d.querySelector('#yieldValue').textContent,'97.5');assert(d.querySelector('#historyBody').textContent.includes('RUN 001'));assert(d.querySelector('#goalTitle').textContent.includes('목표 달성'));});
  await test('Map click reveals matching die measurement, A/B SVG IDs are unique',()=>{app.click('[data-view="map"]');app.click('[data-die="0"]');assert(d.querySelector('#dieInspector').textContent.includes('식각'));app.click('#compareToggle');const ids=[...d.querySelectorAll('#visualization [id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);assert.equal(d.querySelectorAll('#visualization svg').length,2);});
  await test('Recipe saves and notebook escapes user strings',()=>{app.click('#saveRecipe');app.input('#recipeName','<img src=x onerror=alert(1)>');d.querySelector('#saveForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));app.click('[data-page="notebook"]');assert(d.querySelector('#savedRecipes').textContent.includes('<img'));assert.equal(d.querySelectorAll('#savedRecipes img').length,0);assert(d.querySelector('#reportCards').textContent.includes('잔사를 줄인다'));});
  await test('CSV and HTML export contain results with escaped notes',async()=>{app.click('#exportAll');assert(downloads.length>0);const csv=await downloads.at(-1).text();assert(csv.includes('97.5'));assert(csv.includes('bakeTemp'));app.click('[data-page="lab"]');app.click('#exportReport');const html=await downloads.at(-1).text();assert(html.includes('97.5'));assert(html.includes('교육용 합성 모델'));});
  await test('Analysis computes 9 sweep rows and 30 seed samples',async()=>{app.click('[data-page="analytics"]');assert.equal(d.querySelectorAll('[data-sweep]').length,9);assert(d.querySelector('#analysisOutput').textContent.includes('30회'));app.click('#exportStats');const data=JSON.parse(await downloads.at(-1).text());assert.equal(data.repeat.samples.length,30);assert.equal(data.sweep.length,9);});
  await test('Sweep applies its snapshot to the correct stage',()=>{app.click('[data-sweep="4"]');assert.equal(d.querySelector('#param-dose').value,'110');assert(d.querySelector('#draftStatus').textContent.includes('변경됨'));});
  await test('Mission switching isolates records and restore returns exact recipe',()=>{app.click('[data-page="missions"]');app.click('[data-mission="edge"]');assert(!d.querySelector('#historyBody').textContent.includes('RUN 001'));assert.equal(d.querySelector('#yieldValue').textContent,'56.8');app.click('[data-page="notebook"]');app.click('#reportCards [data-restore]');assert.equal(d.querySelector('#yieldValue').textContent,'97.5');});
  await test('Reload restores local recipe, experiment and saved library',()=>{app=mount();d=app.document;assert.equal(d.querySelector('#yieldValue').textContent,'97.5');app.click('[data-page="notebook"]');assert.equal(d.querySelectorAll('.saved-recipe').length,1);assert.equal(d.querySelectorAll('.report-card').length,1);});
  await test('Unexecuted edits stay previews after reload',()=>{app.click('[data-page="lab"]');app.click('[data-stage="3"]');app.input('#param-dose',145);app=mount();d=app.document;assert.equal(d.querySelector('#param-dose').value,'145');assert.equal(d.querySelector('#yieldValue').textContent,'97.5');assert(d.querySelector('#draftStatus').textContent.includes('변경됨'));});
  await test('Playback advances through all stages and stops',()=>{app.click('[data-page="lab"]');app.click('#playProcess');for(const t of [0,2700,5300,7900,10500,13100,15700,18300,20900]){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(t));}assert.equal(d.querySelector('#stageFraction').textContent,'8 / 8');assert(d.querySelector('#playbackDescription').textContent.includes('완료'));assert.equal(d.querySelector('#playProcess').getAttribute('aria-label'),'공정 순서 재생');});
  await test('Process sequence resumes from its paused stage without accumulating paused wall time',()=>{app.click('#playProcess');app.advance(5800);assert.equal(d.querySelector('#stageFraction').textContent,'3 / 8');app.click('#playProcess');const paused=d.querySelector('#visualization').innerHTML;assert.equal(frames.size,0);app.advance(60000);assert.equal(d.querySelector('#visualization').innerHTML,paused);app.click('#playProcess');app.advance(100);assert.equal(d.querySelector('#stageFraction').textContent,'3 / 8');assert(d.querySelector('#playbackDescription').textContent.includes('27%'));app.click('[data-stage="0"]');assert.equal(frames.size,0);});
  await test('Hiding or caching the photo page pauses sequence playback until explicit resume',()=>{app.click('#playProcess');app.advance(3000);app.hidden(true);const stage=d.querySelector('#stageFraction').textContent;app.advance(90000);app.hidden(false);app.advance(200);assert.equal(d.querySelector('#stageFraction').textContent,stage);assert.equal(frames.size,0);assert(d.querySelector('#playbackDescription').textContent.includes('일시정지'));app.click('#playProcess');app.advance(100);assert.equal(d.querySelector('#stageFraction').textContent,stage);app.emit('pagehide');assert.equal(frames.size,0);app.advance(90000);app.emit('pageshow',{persisted:true});assert.equal(frames.size,0);app.click('#playProcess');app.advance(100);assert.equal(d.querySelector('#stageFraction').textContent,stage);app.click('[data-stage="0"]');});
  await test('Research links and all source references render',()=>{app.click('[data-page="research"]');assert(d.querySelector('#researchContent').textContent.includes('비공개 IP'));assert(d.querySelectorAll('#researchContent a').length>=10);});
  // Exercise the real Three.js scene graph and timeline with only WebGL/Canvas rendering stubbed.
  // These assertions do not validate GPU rendering, lighting, typography or visual appearance.
  let machineClock=app.now();
  const createOriginal=d.createElement.bind(d);
  d.createElement=(tag)=>{const el=createOriginal(tag);if(tag==='canvas'){
    const gradient={addColorStop(){}};
    const context={fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},fill(){},stroke(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient};
    el.getContext=()=>context;el.setPointerCapture=()=>{};el.getBoundingClientRect=()=>({left:0,top:0,width:1400,height:570});
  }return el;};
  const viewport=d.querySelector('#machineViewport');Object.defineProperty(viewport,'clientWidth',{value:1400});Object.defineProperty(viewport,'clientHeight',{value:570});
  app.ctx.ResizeObserver=class{constructor(fn){this.fn=fn}observe(){this.fn()}disconnect(){}};
  app.ctx.AbortController=class{constructor(){this.signal={aborted:false}}abort(){this.signal.aborted=true}};
  app.ctx.IntersectionObserver=class{constructor(fn){this.fn=fn}observe(){this.fn([{isIntersecting:true}])}disconnect(){}};
  vm.runInContext(await fs.readFile(`${rootPath}/vendor/three.js`,'utf8'),app.ctx,{filename:'three.js'});
  class RendererStub{constructor(){this.domElement=d.createElement('canvas');this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>4}}setPixelRatio(){}setClearColor(){}setSize(){}render(scene,camera){scene.updateMatrixWorld();camera.updateMatrixWorld()}dispose(){}}
  app.ctx.THREE.WebGLRenderer=RendererStub;
  vm.runInContext(await fs.readFile(`${rootPath}/equipment-detail.js`,'utf8'),app.ctx,{filename:'equipment-detail.js'});
  vm.runInContext(await fs.readFile(`${rootPath}/machine.js`,'utf8'),app.ctx,{filename:'machine.js'});
  const machine=app.ctx.WaferMachine;
  const advance=count=>{for(let i=0;i<count;i++){machineClock+=100;const cbs=[...frames.values()];frames.clear();cbs.forEach(fn=>fn(machineClock));}};
  await test('Equipment scene contains eight real 3D stations and one workpiece',()=>{assert(machine);assert.equal(machine.stations.length,8);assert.equal(d.querySelectorAll('.station-label').length,8);assert(machine.wafer.isGroup);let meshCount=0;machine.scene.traverse(o=>{if(o.isMesh){meshCount++;assert(o.geometry.attributes.position.count>0);}});assert(meshCount>250);});
  await test('3D transfer moves a single wafer from load port onto the first module',()=>{app.click('[data-page="lab"]');app.click('#machineOverview');app.click('#machineReset');advance(1);assert.equal(machine.getState().position[0],-10);assert.equal(d.querySelector('#machinePhase').textContent,'반입 대기');app.click('#machinePlay');assert.equal(d.querySelector('#machinePhase').textContent,'로봇 이송 중');advance(45);const s=machine.getState();assert.equal(s.active,0);assert.equal(s.phase,'PROCESS');assert(Math.abs(s.position[0]+6)<.01);assert(Math.abs(s.position[2]+3)<.01);});
  await test('Equipment pause freezes wafer position and spin',()=>{app.click('#machinePlay');assert.equal(d.querySelector('#machinePhase').textContent,'일시정지 · 웨이퍼 가공 중');const before=JSON.stringify(machine.getState().position),spin=machine.wafer.rotation.y,time=machine.getState().elapsed;advance(15);assert.equal(JSON.stringify(machine.getState().position),before);assert.equal(machine.wafer.rotation.y,spin);assert.equal(machine.getState().elapsed,time);});
  await test('Photo page visibility pauses the 3D machine and restoration requires explicit resume',()=>{app.click('#machinePlay');advance(3);const before=machine.getState().elapsed;app.hidden(true);assert(!machine.getState().playing);advance(15);app.hidden(false);advance(3);assert.equal(machine.getState().elapsed,before);assert(!machine.getState().playing);app.click('#machinePlay');advance(2);assert(machine.getState().elapsed>before);machine.pause();});
  await test('Manual stage selection controls both real scene and detail view',()=>{app.click('[data-stage="1"]');advance(1);assert.equal(machine.getState().active,1);assert.equal(d.querySelector('#stageName').textContent,'감광액 도포');assert(!machine.getState().playing);assert.equal(d.querySelector('#machinePhase').textContent,'장비 관찰 · 재생 대기');});
  await test('Cutaway and camera controls change actual scene properties',()=>{const initial=machine.stations[0].shellMat.opacity;app.click('#machineCutaway');assert.notEqual(machine.stations[0].shellMat.opacity,initial);assert(machine.stations[0].shell.children[0].castShadow);app.click('[data-camera="close"]');advance(12);assert(d.querySelector('#machineViewLabel').textContent.includes('내부 확대'));app.click('#machineCutaway');assert(!machine.stations[0].shell.children[0].castShadow);});
  await test('Equipment tab isolates only the selected machine',()=>{app.click('[data-equipment="5"]');advance(1);assert.equal(machine.getState().displayMode,'detail');assert.equal(machine.stations.filter(s=>s.group.visible).length,1);assert(machine.stations[5].group.visible);assert.equal(d.querySelector('#machineEquipmentTitle').textContent,'현상기');});
  await test('A single equipment run stops locally and Next opens the next device',()=>{app.click('#machinePlay');advance(120);assert.equal(machine.getState().active,5);assert(!machine.getState().playing);assert.equal(d.querySelector('#machinePhase').textContent,'이 장비의 가공 완료');app.click('#machineNext');advance(1);assert.equal(machine.getState().active,6);assert.equal(d.querySelector('#machineEquipmentTitle').textContent,'플라즈마 식각기');});
  await test('Complete 3D cycle visits every processing module and finishes',()=>{app.click('#machineOverview');app.click('#machineReset');app.click('#machinePlay');const seen=new Set();for(let i=0;i<910;i++){advance(1);seen.add(machine.getState().active);}assert.equal(seen.size,8);assert.equal(machine.getState().active,7);assert(!machine.getState().playing);assert.equal(machine.getState().elapsed,88);assert.equal(d.querySelector('#machinePhase').textContent,'전체 가공 완료');});
  await test('Scene transforms and model geometry remain finite after a full cycle',()=>{machine.scene.traverse(o=>{for(const value of [...o.position.toArray(),...o.rotation.toArray().slice(0,3),...o.scale.toArray()])assert(Number.isFinite(value));if(o.geometry?.attributes.position)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});});
  await test('Every equipment exposes three working component explanations',()=>{for(let i=0;i<8;i++){app.click('[data-equipment="'+i+'"]');advance(2);assert.equal(d.querySelectorAll('[data-component]').length,3);app.click('[data-component="2"]');assert.equal(machine.getState().componentIndex,2);assert.equal(d.querySelector('#componentName').textContent,machine.stations[i].components[2].name);assert(d.querySelector('#componentDescription').textContent.length>10);for(const line of d.querySelectorAll('[data-leader]'))for(const a of ['x1','y1','x2','y2'])assert(Number.isFinite(Number(line.getAttribute(a))));}});
  await test('Component visibility preference survives equipment switching',()=>{app.click('#machineAnnotationsToggle');assert(d.querySelector('#machineAnnotations').hidden);app.click('[data-equipment="1"]');assert(d.querySelector('#machineComponentInfo').hidden);app.click('#machineAnnotationsToggle');assert(!d.querySelector('#machineAnnotations').hidden);assert(!d.querySelector('#machineComponentInfo').hidden);});
  await test('Scrubbing rewinds actual wafer motion and resumes from the chosen position',()=>{app.input('#machineScrubber','100');advance(2);assert.equal(machine.getState().phase,'TRANSFER');assert(!machine.getState().playing);assert(machine.robot.visible);const t=machine.getState().elapsed;advance(5);assert.equal(machine.getState().elapsed,t);app.click('#machinePlay');advance(2);assert(machine.getState().elapsed>t);app.input('#machineScrubber','700');advance(2);assert.equal(machine.getState().phase,'PROCESS');assert(!machine.robot.visible);assert(!machine.getState().playing);assert(Math.abs(machine.getState().elapsed-18.7)<1e-6);});
  await test('Phase shortcuts update process state and preserve completed material through inspection',()=>{app.click('[data-phase-position="0.96"]');advance(2);assert.equal(machine.getState().phase,'INSPECT');assert.equal(d.querySelector('#machinePhase').textContent,'일시정지 · 가공 확인');assert(d.querySelector('[data-phase-position="0.96"]').classList.contains('active'));app.click('[data-phase-position="0"]');advance(2);assert.equal(machine.getState().phase,'TRANSFER');assert.equal(machine.getState().phaseProgress,0);assert.equal(d.querySelector('#machinePhase').textContent,'일시정지 · 로봇 이송 중');});
  await test('Global scrubbing selects the matching stage and handles both timeline boundaries',()=>{app.click('#machineOverview');machine.seek(.7);advance(2);assert.equal(machine.getState().active,5);assert.equal(d.querySelector('#stageName').textContent,E.stages[5].name);machine.seek(1);advance(2);assert.equal(machine.getState().elapsed,88);assert.equal(machine.getState().phase,'INSPECT');machine.seek(0);advance(2);assert.equal(machine.getState().active,0);assert.equal(machine.getState().phase,'TRANSFER');assert.equal(machine.getState().position[0],-10);const before=machine.getState().elapsed;machine.seek(NaN);assert.equal(machine.getState().elapsed,before);});
  await test('Wafer surface stays above each support and transfer lands without a height jump',()=>{const tops=[1.8,1.8,1.78,1.82,1.78,1.8,1.81,1.8];for(let i=0;i<8;i++){machine.selectStage(i);machine.seek(.29999);advance(1);const before=machine.wafer.position.y;machine.seek(.3);advance(1);assert(machine.wafer.position.y-.013>=tops[i],JSON.stringify({index:i,height:machine.wafer.position.y,support:tops[i],state:machine.getState()}));assert(Math.abs(before-machine.wafer.position.y)<.001);}});
  await test('Detail top camera remains centered on the selected machine',()=>{machine.selectStage(5);app.click('[data-camera="top"]');advance(120);const p=machine.stations[5].point;assert(Math.abs(machine.camera.position.x-p.x)<.05);assert(Math.abs(machine.camera.position.z-p.z)<1);assert(machine.camera.position.y>p.y+6);assert(d.querySelector('#machineViewLabel').textContent.includes('현상기'));});
  await test('Hardware materials, reflection texture and rounded normals are finite',()=>{assert(machine.scene.environment?.isDataTexture);assert([...machine.scene.environment.image.data].every(Number.isFinite));machine.scene.traverse(o=>{if(o.geometry?.attributes.normal)assert([...o.geometry.attributes.normal.array].every(Number.isFinite));});});
  await test('Server recipe handoff applies its parameters and scenario to the visual lab',()=>{app.ctx.WaferAppBridge.loadRecipe({params:{...E.defaults,dose:120},scenario:'focus',reason:'Server revision evidence'});advance(2);assert.equal(d.querySelector('#param-dose').value,'120');assert.equal(app.ctx.WaferAppBridge.snapshot().missionId,'focus');assert.equal(machine.getState().active,3);assert.equal(d.querySelector('#hypothesis').value,'Server revision evidence');assert.throws(()=>app.ctx.WaferAppBridge.loadRecipe({params:{},scenario:'invalid'}));});
  machine.dispose();
  const output={date:new Date().toISOString(),engine:E.version,passed:tests.length,scope:'Model + DOM + real Three.js geometry/timeline with renderer stub. No browser/GPU rendering or screenshot assertion.',tests};
  await fs.writeFile(`${rootPath}/tests/results.json`,JSON.stringify(output,null,2));
  return output;
}

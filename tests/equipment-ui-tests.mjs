import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {parseHTML, Event} from './linkedom.worker.mjs';

// DOM/behavior tests use the real engine and SVG view. They do not verify browser layout.
export async function runEquipmentUITests(root) {
  const names = ['equipment.html', 'equipment-engine.js', 'equipment-view.js', 'equipment-app.js'];
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await fs.readFile(root + '/' + name, 'utf8')])));
  const tests = [], active = [], fabKey = 'waferflow-fab-v05';
  const fabEvidence = JSON.stringify({modelVersion:'do-not-modify',wafers:[{id:'EXISTING',records:[{stepId:'OP001'}]}]});
  const clone = value => JSON.parse(JSON.stringify(value));
  async function test(name, fn) {
    try { await fn(); tests.push({name,status:'passed'}); }
    catch (error) { tests.push({name,status:'failed',error:error.stack || String(error)}); }
    finally { while (active.length) active.pop().app.dispose(); }
  }
  function mount(storage = new Map([[fabKey, fabEvidence]])) {
    const {document:d} = parseHTML(files['equipment.html']);
    const frames = new Map(), downloads = [];
    let clock = 0, fid = 0;
    // LinkeDOM does not implement mutable select.value or HTMLDialogElement.showModal.
    Object.defineProperty(Object.getPrototypeOf(d.querySelector('select')), 'value', {
      configurable:true,
      get() { return this.testValue ?? this.querySelector('option[selected]')?.getAttribute('value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; },
      set(value) { this.testValue = String(value); }
    });
    for (const dialog of d.querySelectorAll('dialog')) {
      dialog.showModal = function() { this.setAttribute('open',''); };
      dialog.close = function() { this.removeAttribute('open'); };
    }
    const context = {
      document:d, console, Blob,
      URL:{createObjectURL(blob) {downloads.push(blob); return 'blob:equipment-test-' + downloads.length;},revokeObjectURL(){}},
      localStorage:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,String(value))},
      requestAnimationFrame:fn => {frames.set(++fid,fn); return fid;}, cancelAnimationFrame:id => frames.delete(id),
      setTimeout:() => 0, clearTimeout(){}, performance:{now:() => clock},
      fetch() {throw new Error('Equipment UI must operate without a network request.');}
    };
    context.window = context;
    const c = vm.createContext(context);
    for (const name of names.slice(1)) vm.runInContext(files[name],c,{filename:name});
    function element(selector) {const el = d.querySelector(selector); assert(el,'Missing element: ' + selector); return el;}
    function click(selector) {const el = element(selector); assert(!el.disabled,selector + ' is disabled'); el.dispatchEvent(new Event('click',{bubbles:true,cancelable:true}));}
    function input(selector,value) {const el = element(selector); el.value = String(value); el.dispatchEvent(new Event('input',{bubbles:true}));}
    function change(selector,value) {const el = element(selector); el.value = String(value); el.dispatchEvent(new Event('change',{bubbles:true}));}
    function advance(count,ms=100) {for(let i=0;i<count;i++){clock+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(clock));}}
    function hidden(value) {Object.defineProperty(d,'hidden',{value,configurable:true});d.dispatchEvent(new Event('visibilitychange'));}
    const result = {d,c,el:element,click,input,change,advance,hidden,storage,downloads,frames,app:c.EquipmentApp,E:c.EquipmentEngine};
    assert(result.app,'EquipmentApp did not initialize'); active.push(result); return result;
  }
  function partial(ui) {
    const trace = clone(ui.app.snapshot().trace);
    trace.units = {pressurePa:'Pa',beamVoltageV:'V'};
    trace.samples = [
      {t:0,stage:'process',values:{pressurePa:10,beamVoltageV:100},digital:{beam:true}},
      {t:1,stage:'process',values:{beamVoltageV:200}},
      {t:2,stage:'process',values:{pressurePa:5,beamVoltageV:150}}
    ];
    trace.duration=2;trace.events=[];delete trace.recipe;delete trace.fault;return trace;
  }

  await test('Initial screen mounts the real SVG chamber, seven editable conditions, six channels and seven stages',()=>{
    const ui=mount();
    assert.equal(ui.d.querySelectorAll('#recipeForm input').length,7);
    assert.equal(ui.d.querySelectorAll('#equipmentViewport svg').length,1);
    assert.equal(ui.d.querySelectorAll('#equipmentViewport [data-part]').length,6);
    assert.equal(ui.d.querySelectorAll('#readouts .readout').length,6);
    assert.equal(ui.d.querySelectorAll('#stageStrip [data-stage]').length,7);
    assert.equal(ui.el('#runState').textContent,'READY');
    assert(!ui.el('#runButton').disabled);
    assert.equal(ui.app.snapshot().trace.provenance.kind,'synthetic');
  });
  await test('Valid recipe edits remain drafts until run and preserve existing calculated sensor evidence',()=>{
    const ui=mount(), before=JSON.stringify(ui.app.snapshot().trace);
    ui.input('#recipe-beamVoltageV',800);
    assert.equal(ui.el('#recipe-beamVoltageV').getAttribute('aria-invalid'),'false');
    assert.equal(ui.el('#recipeMode').textContent,'DRAFT CHANGED');
    assert.equal(JSON.stringify(ui.app.snapshot().trace),before);
    ui.click('#runButton');
    assert.equal(ui.app.snapshot().trace.recipe.beamVoltageV,800);
    assert.notEqual(JSON.stringify(ui.app.snapshot().trace),before);
  });
  await test('Out-of-range and blank numeric inputs prevent execution and identify the invalid field',()=>{
    const ui=mount(), before=JSON.stringify(ui.app.snapshot().trace);
    for (const value of ['99999','']) {
      ui.input('#recipe-beamVoltageV',value);
      assert.equal(ui.el('#recipe-beamVoltageV').getAttribute('aria-invalid'),'true');
      assert(ui.el('#error-beamVoltageV').textContent.length>0);
      assert(ui.el('#runButton').disabled);
      ui.app.startRun();assert.equal(JSON.stringify(ui.app.snapshot().trace),before);
    }
    ui.input('#recipe-beamVoltageV',700);
    assert.equal(ui.el('#recipe-beamVoltageV').getAttribute('aria-invalid'),'false');
    assert(!ui.el('#runButton').disabled);
  });
  await test('Starting an operation advances virtual time and locks recipe, defaults and fault controls',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(5);
    assert(ui.app.snapshot().time>0);assert(ui.app.snapshot().playing);assert(ui.app.snapshot().activeRun);
    for (const el of ui.d.querySelectorAll('#recipeForm input, #defaultsButton, #faultSelect')) assert(el.disabled);
    assert(ui.el('#runButton').disabled);assert(!ui.el('#stopButton').disabled);
    assert.equal(ui.el('#runState').textContent,'RUNNING');
  });
  await test('Pause holds time and resume continues the same immutable calculated trace',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(5);ui.click('#playButton');
    const paused=ui.app.snapshot();ui.advance(20);
    assert.equal(ui.app.snapshot().time,paused.time);assert(!ui.app.snapshot().playing);
    assert(ui.el('#recipe-beamVoltageV').disabled);
    ui.click('#playButton');ui.advance(3);
    assert(ui.app.snapshot().time>paused.time);
    assert.equal(JSON.stringify(ui.app.snapshot().trace),JSON.stringify(paused.trace));
  });
  await test('Stopping truncates future records, disables the beam and preserves the transfer position',()=>{
    const ui=mount();ui.click('#runButton');
    const full=ui.app.snapshot().trace, process=full.samples.find(s=>s.stage==='process'&&s.digital.shutter);
    assert(process);ui.app.seek(process.t+1.12);ui.click('#stopButton');
    const stopped=ui.app.snapshot();
    assert.equal(stopped.trace.outcome.status,'aborted');assert(!stopped.activeRun);assert(!stopped.playing);
    assert(stopped.trace.duration<full.duration);assert.equal(stopped.trace.duration,stopped.time);
    assert(stopped.trace.samples.every(s=>s.t<=stopped.time));
    assert(stopped.trace.events.every(e=>e.t<=stopped.time));
    assert.equal(stopped.trace.events.at(-1).code,'USER_STOP');
    for(const key of ['beam','shutter'])assert.equal(stopped.trace.samples.at(-1).digital[key],false);
    assert.equal(stopped.trace.samples.at(-1).digital.robot,0);
    assert.equal(ui.E.validateTrace(stopped.trace).duration,stopped.time);
    assert(!ui.el('#recipe-beamVoltageV').disabled);
    ui.click('#runButton');ui.app.seek(1.13);
    const arm=ui.el('#equipmentViewport [data-node="arm"]').getAttribute('d');
    ui.click('#stopButton');
    assert.equal(ui.el('#equipmentViewport [data-node="arm"]').getAttribute('d'),arm);
    assert(ui.app.snapshot().trace.samples.at(-1).digital.robot>0);
  });
  await test('Immediate stop still exports two strictly ordered valid samples',()=>{
    const ui=mount();ui.click('#runButton');ui.click('#stopButton');const trace=ui.app.snapshot().trace;
    assert.equal(trace.samples.length,2);assert(trace.samples[1].t>trace.samples[0].t);
    assert.equal(ui.E.validateTrace(trace).outcome.status,'aborted');
  });
  await test('Stage and event navigation seek exact timestamps, update active stages and pause playback',()=>{
    const ui=mount();ui.click('#playButton');ui.click('#stageStrip [data-stage="process"]');
    let snap=ui.app.snapshot();assert(!snap.playing);assert.equal(snap.time,snap.trace.samples.find(s=>s.stage==='process').t);
    assert.equal(ui.el('#stageStrip [data-stage="process"]').getAttribute('aria-current'),'step');
    const idx=snap.trace.events.findIndex(e=>e.code==='STAGE_COOLDOWN');assert(idx>=0);
    ui.click('[data-event="'+idx+'"]');snap=ui.app.snapshot();assert.equal(snap.time,snap.trace.events[idx].t);
    ui.input('#scrubber',3.5);assert.equal(ui.app.snapshot().time,3.5);
  });
  await test('Part selection and keyboard activation explain the mechanism without moving playback time',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(6);const time=ui.app.snapshot().time;
    ui.click('#equipmentViewport [data-part="source"]');
    assert(ui.el('#partTitle').textContent.includes('이온 소스'));assert.equal(ui.app.snapshot().time,time);
    assert(ui.app.snapshot().playing);assert(ui.d.querySelector('.equipment-cutaway'));
    const event=new Event('keydown',{bubbles:true,cancelable:true});event.key='Enter';
    ui.el('#equipmentViewport [data-part="cooling"]').dispatchEvent(event);
    assert(ui.el('#partTitle').textContent.includes('냉각'));assert.equal(ui.app.snapshot().time,time);
  });
  await test('Wafer handoff follows seated status throughout load, return, unload and final removal',()=>{
    const ui=mount(), trace=ui.app.snapshot().trace;
    const cases=[
      {row:trace.samples.find(s=>s.stage==='load'&&!s.digital.wafer&&s.digital.robot>.3),stage:false,robot:true},
      {row:trace.samples.find(s=>s.stage==='load'&&s.digital.wafer&&s.digital.robot<.8),stage:true,robot:false},
      {row:trace.samples.find(s=>s.stage==='unload'&&s.digital.wafer&&s.digital.robot>.3),stage:true,robot:false},
      {row:trace.samples.find(s=>s.stage==='unload'&&!s.digital.wafer&&s.digital.robot>.3),stage:false,robot:true},
      {row:trace.samples.at(-1),stage:false,robot:false}
    ];
    for(const item of cases){
      assert(item.row);ui.app.seek(item.row.t);
      assert.equal(ui.el('#equipmentViewport [data-node="stage-wafer"]').getAttribute('opacity'),item.stage?'1':'0','Stage wafer at '+item.row.t);
      assert.equal(ui.el('#equipmentViewport [data-node="transfer-wafer"]').getAttribute('opacity'),item.robot?'1':'0','Transfer wafer at '+item.row.t);
    }
  });
  await test('Source dialog pauses operation and closing the dialog requires explicit resume',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(4);ui.click('#sourceButton');
    const time=ui.app.snapshot().time;assert(ui.el('#sourceDialog').hasAttribute('open'));assert(!ui.app.snapshot().playing);
    ui.advance(5);assert.equal(ui.app.snapshot().time,time);ui.click('#closeSource');
    assert(!ui.el('#sourceDialog').hasAttribute('open'));assert(!ui.app.snapshot().playing);
    ui.click('#playButton');ui.advance(2);assert(ui.app.snapshot().time>time);
  });
  await test('Hidden-page transition pauses playback and showing it again does not resume automatically',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(5);ui.hidden(true);const time=ui.app.snapshot().time;
    ui.advance(10);ui.hidden(false);ui.advance(5);
    assert.equal(ui.app.snapshot().time,time);assert(!ui.app.snapshot().playing);
    assert(ui.el('#feedback').textContent.includes('숨겨져'));ui.click('#playButton');ui.advance(2);assert(ui.app.snapshot().time>time);
  });
  await test('JSON export/import preserves units, samples, recipe and version but labels imported provenance unverified',async()=>{
    const ui=mount();ui.input('#recipe-beamVoltageV',800);ui.click('#runButton');ui.advance(3);ui.click('#exportButton');
    const data=JSON.parse(await ui.downloads.at(-1).text()), before=ui.app.snapshot();
    assert.equal(data.playback.t,before.time);assert(data.exportedAt);assert(data.scope.includes('no manufacturing'));
    ui.app.importData(data);const restored=ui.app.snapshot();
    for(const key of ['modelVersion','profileId','duration'])assert.equal(restored.trace[key],data[key]);
    for(const key of ['units','samples','events','recipe','outcome'])assert.equal(JSON.stringify(restored.trace[key]),JSON.stringify(data[key]));
    assert.equal(restored.trace.provenance.kind,'unverified');assert(restored.imported);
    assert(ui.el('#dataBadge').textContent.includes('미검증'));assert(ui.el('#runButton').disabled);assert(ui.el('#recipe-beamVoltageV').disabled);
    assert(ui.el('#faultSelect').disabled);assert.equal(ui.el('#faultSelect').value,'imported-info');
    assert.equal(ui.el('#importedFaultOption').textContent,'파일 표기: '+data.fault);
    ui.click('#exportButton');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).provenance.kind,'unverified');
  });
  await test('A recovered alarm in an imported log remains history without forcing current playback into alarm-stop',()=>{
    const ui=mount(), data=partial(ui);
    data.events=[
      {t:0,level:'alarm',code:'PRESSURE_ALARM',message:'과거 압력 알람'},
      {t:1,level:'info',code:'RECOVERED',message:'파일에 기록된 복구 이벤트'}
    ];
    data.outcome={status:'completed',reason:'파일에서 선언한 정상 종료'};
    ui.app.importData(data);ui.app.seek(1.25);ui.click('#playButton');
    assert.equal(ui.el('#runState').textContent,'LOG PLAYBACK');
    assert(!ui.el('#runState').classList.contains('aborted'));assert(!ui.el('#outcome').classList.contains('alarm'));
    assert(ui.el('#eventList').textContent.includes('과거 압력 알람'));assert(ui.el('#eventList').textContent.includes('복구 이벤트'));
    assert(!ui.el('#outcome').textContent.includes('과거 압력 알람'));
    ui.app.seek(data.duration);assert.equal(ui.el('#runState').textContent,'LOG END');
    assert.equal(ui.el('#outcome').textContent,'파일 결과: '+data.outcome.reason);
  });
  await test('Seeking an active simulated run to its last sample releases recipe editing without modifying the trace',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(4);const before=ui.app.snapshot().trace;
    assert(ui.el('#recipe-pressurePa').disabled);assert(ui.app.snapshot().activeRun);
    ui.input('#scrubber',before.duration);
    assert(!ui.app.snapshot().activeRun);assert(!ui.app.snapshot().playing);
    assert.equal(ui.el('#runState').textContent,'COMPLETE');assert(ui.el('#stopButton').disabled);
    for(const el of ui.d.querySelectorAll('#recipeForm input, #defaultsButton, #faultSelect'))assert(!el.disabled);
    assert(!ui.el('#runButton').disabled);assert.equal(JSON.stringify(ui.app.snapshot().trace),JSON.stringify(before));
    ui.input('#recipe-pressurePa',.4);assert.equal(ui.el('#recipeMode').textContent,'DRAFT CHANGED');
    assert.equal(JSON.stringify(ui.app.snapshot().trace),JSON.stringify(before));
  });
  await test('Partial logs show unknown digital states and never invent an open-shutter beam or robot movement',()=>{
    const ui=mount();ui.app.importData(partial(ui));
    assert.equal(ui.el('#digital-shutter b').textContent,'미상');
    assert.equal(ui.el('#equipmentViewport [data-node="beam"]').getAttribute('opacity'),'0');
    assert(ui.el('#equipmentViewport [data-node="transfer-status"]').textContent.includes('UNKNOWN'));
    assert.equal(ui.el('#equipmentViewport [data-signal-coverage]').getAttribute('data-signal-coverage'),'partial');
    assert.equal(ui.el('#recipe-beamVoltageV').value,'');
    ui.app.seek(.5);assert.equal(ui.el('#value-pressurePa').textContent,'10.0');
    assert(ui.el('#stageDescription').textContent.includes('0.00 s'));
    ui.app.seek(1);assert.equal(ui.el('#value-pressurePa').textContent,'—');
  });
  await test('Missing sensor values make chart gaps and hide the cursor dot without NaN coordinates',()=>{
    const ui=mount();ui.app.importData(partial(ui));ui.app.seek(1);
    assert.equal(ui.el('#chartDot').getAttribute('visibility'),'hidden');
    assert(!/NaN|Infinity/.test(ui.el('#traceChart').innerHTML));
    const actual=ui.d.querySelectorAll('#traceChart path')[1].getAttribute('d');assert.equal((actual.match(/M/g)||[]).length,2);
    ui.change('#channelSelect','beamVoltageV');assert.equal(ui.el('#chartDot').getAttribute('visibility'),'visible');
    assert(ui.el('#channelValue').textContent.includes('200'));assert(!/NaN|Infinity/.test(ui.el('#traceChart').innerHTML));
  });
  await test('Malformed imports are atomic and preserve the previous trace, playback and visible chart',()=>{
    const ui=mount();ui.click('#runButton');ui.advance(4);
    const before=JSON.stringify(ui.app.snapshot()), chart=ui.el('#traceChart').innerHTML;
    const bad=clone(ui.app.snapshot().trace);bad.samples[1].t=bad.samples[0].t;
    assert.throws(()=>ui.app.importData(bad));assert.equal(JSON.stringify(ui.app.snapshot()),before);assert.equal(ui.el('#traceChart').innerHTML,chart);
    const badBit=clone(ui.app.snapshot().trace);badBit.samples[0].digital.beam='true';
    assert.throws(()=>ui.app.importData(badBit));assert.equal(JSON.stringify(ui.app.snapshot()),before);
  });
  await test('Unknown or missing channel units are rejected without changing the selected log',()=>{
    const ui=mount(), before=JSON.stringify(ui.app.snapshot().trace);
    const wrong=clone(ui.app.snapshot().trace);wrong.units.pressurePa='UNKNOWN';
    assert.throws(()=>ui.app.importData(wrong),/단위/);
    const missing=clone(ui.app.snapshot().trace);delete missing.units.pressurePa;
    assert.throws(()=>ui.app.importData(missing),/단위/);
    assert.equal(JSON.stringify(ui.app.snapshot().trace),before);
  });
  await test('Imported event markup remains literal text in both event list and outcome display',()=>{
    const ui=mount(), data=partial(ui), payload='<img src=x onerror="window.injected=true"><script>bad()</script>';
    data.events=[{t:0,level:'alarm',code:'<svg onload=bad()>',message:payload}];
    data.outcome.reason=payload;
    ui.app.importData(data);
    assert(!ui.el('#eventList').querySelector('img,script,svg'));
    assert(ui.el('#eventList').textContent.includes(payload));ui.app.seek(data.duration);assert.equal(ui.el('#outcome').textContent,'파일 결과: '+payload);
    assert(!ui.el('#outcome').querySelector('img,script'));assert.equal(ui.c.injected,undefined);
  });
  await test('Equipment drafts persist separately, restore on reload and survive a log import round trip',()=>{
    const storage=new Map([[fabKey,fabEvidence]]), ui=mount(storage);
    ui.input('#recipe-beamVoltageV',830);ui.change('#faultSelect','cooling');
    assert.equal(storage.get(fabKey),fabEvidence);assert(storage.has('waferflow-equipment-draft-v1'));
    const reloaded=mount(storage);assert.equal(reloaded.el('#recipe-beamVoltageV').value,'830');assert.equal(reloaded.el('#faultSelect').value,'cooling');
    const imported=clone(reloaded.app.snapshot().trace);imported.recipe.beamVoltageV=910;
    reloaded.app.importData(imported);assert.equal(reloaded.el('#recipe-beamVoltageV').value,'910');assert(reloaded.el('#recipe-beamVoltageV').disabled);
    reloaded.click('#returnSimulation');
    assert(!reloaded.app.snapshot().imported);assert.equal(reloaded.el('#recipe-beamVoltageV').value,'830');assert(!reloaded.el('#runButton').disabled);
    reloaded.click('#defaultsButton');assert.equal(reloaded.el('#recipe-beamVoltageV').value,String(reloaded.E.PROFILE.fields.beamVoltageV.default));
    assert.equal(reloaded.el('#faultSelect').value,'none');assert.equal(storage.get(fabKey),fabEvidence);
  });
  await test('Completion releases editing and all fault scenarios remain visibly aborted with beam stopped',()=>{
    const ui=mount();ui.change('#speedSelect','16');ui.click('#runButton');ui.advance(150,250);
    let snap=ui.app.snapshot();assert.equal(snap.time,snap.trace.duration);assert(!snap.playing);assert(!snap.activeRun);
    assert.equal(ui.el('#runState').textContent,'COMPLETE');assert(!ui.el('#recipe-pressurePa').disabled);
    for(const fault of ['vacuum','cooling','beam']) {
      ui.change('#faultSelect',fault);ui.click('#runButton');const trace=ui.app.snapshot().trace;
      assert.equal(trace.outcome.status,'aborted');ui.app.seek(trace.duration);
      assert.equal(ui.el('#runState').textContent,'ALARM / STOP');assert.equal(ui.el('#equipmentViewport [data-node="beam"]').getAttribute('opacity'),'0');
      assert(!ui.app.snapshot().activeRun);
    }
  });
  await test('Disposing the equipment workspace removes its animation callback and SVG view',()=>{
    const ui=mount();assert(ui.frames.size>0);ui.app.dispose();ui.app.dispose();
    assert.equal(ui.frames.size,0);assert.equal(ui.d.querySelectorAll('#equipmentViewport svg').length,0);
  });

  const result={passed:tests.filter(t=>t.status==='passed').length,tests};
  await fs.writeFile(root+'/tests/equipment-ui-results.json',JSON.stringify(result,null,2)+'\n');
  const failures=tests.filter(t=>t.status==='failed');
  if(failures.length)throw new Error(failures.map(t=>t.name+'\n'+t.error).join('\n\n'));
  return result;
}

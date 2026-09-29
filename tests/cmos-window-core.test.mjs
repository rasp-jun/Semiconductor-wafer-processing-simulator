import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto,createHash} from 'node:crypto';

export async function runCmosWindowTests(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
  let storageTouches=0,appTouches=0,executions=0,yields=0;
  const c=vm.createContext({crypto:webcrypto,TextEncoder,setTimeout(callback,delay){yields++;return setTimeout(callback,delay);}});c.window=c;
  Object.defineProperty(c,'localStorage',{get(){storageTouches++;throw Error('No storage writes');}});
  Object.defineProperty(c,'FabApp',{get(){appTouches++;throw Error('No live application state');}});
  vm.runInContext(fs.readFileSync(path.join(root,'fab-engine.js'),'utf8'),c);
  const E=c.FabEngine,execute=E.execute;E.execute=(...args)=>{executions++;return execute(...args);};
  vm.runInContext(fs.readFileSync(path.join(root,'cmos-window-core.js'),'utf8'),c);
  const W=c.CmosWindowCore,tests=[],configs=new Map(),results=new Map(),clone=v=>JSON.parse(JSON.stringify(v));
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canon(value[k])).join(',')+'}';
  const test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const definitions=JSON.stringify({route:E.route,tools:E.tools,materials:E.materials});
  const flat=(summary,index)=>({oxideMean:summary.films.SiO2.mean,polyMean:summary.films.Poly.mean,topography:summary.topography,gateCD:index>=E.route.find(s=>s.name==='폴리 게이트 패턴 식각').index?summary.gateCD:null,surfaceMax:summary.surfaceMax});
  await test('Three immutable presets reference real process fields and five documented nm metrics',()=>{
    assert.equal(W.presets.length,3);assert(Object.isFrozen(W.presets));assert(Object.isFrozen(W.metrics));assert.equal(W.metrics.length,5);
    for(const p of W.presets){assert(Object.isFrozen(p));assert(Object.isFrozen(p.x));const d=W.describe(p.stepId);assert(d.fields.some(f=>f.id===p.x.field));assert(d.fields.some(f=>f.id===p.y.field));assert.notEqual(p.x.field,p.y.field);assert(W.metrics.some(m=>m.id===p.metric));assert(d.fields.every(f=>f.step>0));}
    assert(W.metrics.every(m=>m.unit==='nm'&&m.description));
  });
  for(const preset of W.presets)await test(preset.id+' executes 25 independent branches from the exact same input',async()=>{
    const prepUpdates=[],config=await W.preparePreset(preset.id,{onProgress:e=>prepUpdates.push({...e})});configs.set(preset.id,config);
    const before=JSON.stringify(config),updates=[],result=await W.run(config,{onProgress:e=>updates.push({...e})});results.set(preset.id,result);
    assert.equal(JSON.stringify(config),before);assert.equal(result.rows.length,25);assert.equal(result.modelVersion,E.VERSION);assert.equal(result.input.records.length,E.route.find(s=>s.id===result.stepId).index);
    assert.equal(result.input.waferId,config.input.waferId);assert.equal(JSON.stringify(result.input.records),JSON.stringify(config.input.records));
    assert.equal(new Set(result.rows.map(r=>r.x+':'+r.y)).size,25);assert.equal(JSON.stringify(result.metricDefinitions),JSON.stringify(W.metrics));
    const input=E.replay(config.input.waferId,config.input.records),step=E.route[input.cursor],inputBefore=JSON.stringify(input);
    const baseline=execute(input,config.baseRecipe,config.fault);assert.equal(canon(result.baseline.metrics),canon(flat(baseline.metrics,step.index)));assert.equal(canon(result.baseline.warnings),canon(baseline.warnings));assert.equal(result.baseline.seconds,baseline.seconds);
    for(const row of result.rows){
      assert.equal(row.x,result.x.values[row.ix]);assert.equal(row.y,result.y.values[row.iy]);
      for(const key of Object.keys(config.baseRecipe))assert.equal(row.recipe[key],key===config.x.field?row.x:key===config.y.field?row.y:config.baseRecipe[key]);
      const direct=execute(input,row.recipe,config.fault);assert.equal(canon(row.metrics),canon(flat(direct.metrics,step.index)));assert.equal(canon(row.warnings),canon(direct.warnings));assert.equal(row.seconds,direct.seconds);
    }
    assert.equal(JSON.stringify(input),inputBefore);assert.equal(prepUpdates[0].completed,0);assert.equal(prepUpdates.at(-1).completed,prepUpdates.at(-1).total);
    assert.equal(updates[0].completed,0);assert.equal(updates.at(-1).completed,updates.at(-1).total);for(let i=1;i<updates.length;i++)assert.equal(updates[i].completed,updates[i-1].completed+1);
  });
  await test('Both axes produce distinct physical outcomes; completed prefix cannot accumulate across rows',()=>{
    const oxide=results.get('oxidation'),cmp=results.get('cmp'),gate=results.get('gate-etch');
    assert(oxide.rows[4].metrics.oxideMean>oxide.rows[0].metrics.oxideMean);assert(oxide.rows[20].metrics.oxideMean>oxide.rows[0].metrics.oxideMean);
    assert(cmp.rows[0].metrics.topography>cmp.rows[4].metrics.topography);assert(cmp.rows[0].metrics.topography>cmp.rows[20].metrics.topography);
    assert(gate.rows.some(r=>r.metrics.polyMean!==gate.rows[0].metrics.polyMean));assert.equal(oxide.baseline.metrics.gateCD,null);assert(gate.baseline.metrics.gateCD!==null);
  });
  await test('3 × 3 configuration yields nine actual distinct conditions',async()=>{
    const config=clone(configs.get('oxidation'));config.x.count=3;config.y.count=3;const result=await W.run(config);assert.equal(result.rows.length,9);assert.equal(result.x.values.length,3);assert.equal(result.y.values.length,3);
  });
  await test('Axis quantization uses legal field steps and reports the actual numbers',async()=>{
    const config=clone(configs.get('oxidation'));config.x.min=2.23;config.x.max=6.27;const result=await W.run(config);assert.equal(result.x.values[0],2.2);assert.equal(result.x.values.at(-1),6.3);
    for(const value of result.x.values)assert(Math.abs((value-.2)/.1-Math.round((value-.2)/.1))<1e-9);
    let input=E.createWafer('GRID-OFFSET');for(let i=0;i<5;i++)input=execute(input).wafer;const step=E.route[input.cursor];
    const doseResult=await W.run({input:{waferId:input.id,title:'offset',records:input.records},stepId:step.id,baseRecipe:clone(step.recipe),fault:'none',x:{field:'dose',min:1.1e12,max:5.1e12,count:3},y:{field:'energy',min:60,max:180,count:3}});
    assert.deepEqual(clone(doseResult.x.values),[1e12,3e12,5e12]);
  });
  const invalidCases=[
    ['blank minimum',v=>v.x.min=''],['numeric text',v=>v.x.max='6.2'],['nonfinite maximum',v=>v.x.max=Infinity],['reversed range',v=>v.x.min=v.x.max+1],['equal endpoints',v=>v.x.max=v.x.min],['lower than tool limit',v=>v.x.min=0],['higher than tool limit',v=>v.y.max=1200],['too many levels',v=>v.x.count=1000],['mixed grid sizes',v=>v.x.count=3],['duplicate snapped levels',v=>{v.x.min=2.21;v.x.max=2.24;}],['same axes',v=>v.y=clone(v.x)],['unknown field',v=>v.x.field='missing'],['wrong current step',v=>v.stepId='OP001'],['missing recipe key',v=>delete v.baseRecipe.time],['extra recipe key',v=>v.baseRecipe.inject=1],['null recipe value',v=>v.baseRecipe.time=null],['invalid fault',v=>v.fault='foo'],['missing records',v=>v.input.records.pop()],['invalid wafer id',v=>v.input.waferId='<script>'],['numeric title',v=>v.input.title=12]
  ];
  for(const [name,mutate] of invalidCases)await test('Rejects '+name+' before engine execution',async()=>{const config=clone(configs.get('oxidation'));mutate(config);const before=executions;await assert.rejects(W.run(config));assert.equal(executions,before);});
  await test('Tampered completed-prefix metrics and timestamps cannot masquerade as valid input',async()=>{
    const config=clone(configs.get('oxidation'));config.input.records[0].metrics.particles=-100;await assert.rejects(W.run(config),/재계산/);
    const badDate=clone(configs.get('oxidation'));badDate.input.records[0].time='2026-02-30T00:00:00.000Z';const before=executions;await assert.rejects(W.run(badDate),/날짜/);assert.equal(executions,before);
  });
  await test('Strict JSON validation never invokes getters, accepts sparse arrays or permits prototype keys',async()=>{
    const withGetter=clone(configs.get('oxidation'));let touched=0;Object.defineProperty(withGetter.x,'min',{enumerable:true,get(){touched++;return 1;}});await assert.rejects(W.run(withGetter));assert.equal(touched,0);
    const sparse=clone(configs.get('oxidation'));delete sparse.input.records[2];await assert.rejects(W.run(sparse));
    const unsafe=clone(configs.get('oxidation'));unsafe.input=JSON.parse('{"__proto__":{},"waferId":"W01","title":"","records":[]}');await assert.rejects(W.run(unsafe));
  });
  await test('Pre-cancelled preparation and calculation perform no engine work',async()=>{
    const controller=new AbortController();controller.abort();const before=executions;await assert.rejects(W.preparePreset('cmp',{signal:controller.signal}),{name:'AbortError'});await assert.rejects(W.run(configs.get('cmp'),{signal:controller.signal}),{name:'AbortError'});assert.equal(executions,before);
  });
  await test('Scheduled cancellation interrupts a prefix within four operations',async()=>{
    for(const action of ['prepare','run']){const controller=new AbortController(),before=executions,options={signal:controller.signal,onProgress({completed}){if(completed===1)setTimeout(()=>controller.abort(),0);}};await assert.rejects(action==='prepare'?W.preparePreset('cmp',options):W.run(configs.get('cmp'),options),{name:'AbortError'});assert(executions-before<=4);assert(executions>before);}
  });
  await test('Cancellation during sampling cannot return or export a partial grid',async()=>{
    const controller=new AbortController();let calculating=0;await assert.rejects(W.run(configs.get('oxidation'),{signal:controller.signal,onProgress({phase}){if(phase==='calculate'&&++calculating===3)controller.abort();}}),{name:'AbortError'});assert.equal(calculating,3);
    const endController=new AbortController();await assert.rejects(W.run(configs.get('oxidation'),{signal:endController.signal,onProgress({completed,total}){if(completed===total)endController.abort();}}),{name:'AbortError'});
  });
  await test('Targets are inclusive counts, with separate unavailable values and no inferred yield',()=>{
    const result=results.get('oxidation'),value=result.rows[12].metrics.oxideMean,a=W.assess(result,{metric:'oxideMean',min:value,max:value});assert(a.inside>=1);assert.equal(a.total,25);assert.equal(a.inside+a.outside+a.unavailable,25);assert.equal(a.rows[12].status,'inside');
    const unavailable=W.assess(result,{metric:'gateCD',min:0,max:5000});assert.equal(unavailable.unavailable,25);assert.equal(unavailable.inside,0);assert.equal(unavailable.baseline,'unavailable');
    for(const criteria of [{metric:'fake',min:0,max:1},{metric:'oxideMean',min:'',max:10},{metric:'oxideMean',min:10,max:1},{metric:'oxideMean',min:NaN,max:1}])assert.throws(()=>W.assess(result,criteria));
  });
  await test('JSON package retains full provenance, criteria and review notes, then independently replays all samples',async()=>{
    const result=results.get('gate-etch'),criteria={metric:'polyMean',min:10,max:50},settings={criteria,title:'검토 01',note:'동일한 입력 조건\n후속 검토 필요'},pkg=await W.pack(result,settings),before=executions;
    assert.match(pkg.integrity.digest,/^[a-f0-9]{64}$/);const restored=await W.unpack(JSON.stringify(pkg));assert.equal(canon(restored.result),canon(result));assert.equal(canon(restored.criteria),canon(criteria));assert.equal(restored.title,settings.title);assert.equal(restored.note,settings.note);assert.deepEqual(clone(restored.checks),{checksum:true,model:true,replay:true});assert.equal(executions-before,result.input.records.length+26);assert(W.toHTML(restored.result,restored.criteria).includes('STRATUM'));
  });
  await test('Checksum changes and recomputed-checksum fabricated outputs are both rejected',async()=>{
    const pkg=await W.pack(results.get('oxidation'));pkg.payload.result.rows[0].metrics.oxideMean+=1;await assert.rejects(W.unpack(pkg),/체크섬/);
    pkg.integrity.digest=createHash('sha256').update(canon(pkg.payload)).digest('hex');await assert.rejects(W.unpack(pkg),/재계산/);
    const axes=await W.pack(results.get('oxidation'));axes.payload.result.x.values[0]=3.14;axes.integrity.digest=createHash('sha256').update(canon(axes.payload)).digest('hex');await assert.rejects(W.unpack(axes),/재계산/);
  });
  await test('Import rejects unsupported models, overlarge input, malformed JSON and cancellation',async()=>{
    const pkg=await W.pack(results.get('oxidation'));pkg.payload.result.modelVersion='old';pkg.integrity.digest=createHash('sha256').update(canon(pkg.payload)).digest('hex');await assert.rejects(W.unpack(pkg),/모델/);
    await assert.rejects(W.unpack(' '.repeat(2000001)),/2 MB/);await assert.rejects(W.unpack('{broken'),/JSON/);
    const controller=new AbortController();controller.abort();await assert.rejects(W.unpack(await W.pack(results.get('cmp')),{signal:controller.signal}),{name:'AbortError'});
  });
  await test('CSV prevents formula injection and preserves exact recipes, units and all 26 outputs',()=>{
    const result=results.get('gate-etch'),csv=W.toCSV(result,{metric:'polyMean',min:0,max:100},{title:'=HYPERLINK("bad")',note:'\t+SUM(1,1)\nreview'});
    assert(csv.startsWith('\uFEFF'));assert(csv.includes('"\'=HYPERLINK(""bad"")"'));assert(csv.includes('"\'\t+SUM'));assert(csv.includes('바이어스 파워 (W)'));assert(csv.includes('R25'));assert(csv.includes('최소값 포함'));assert.equal((csv.match(/"R\d\d"/g)||[]).length,25);
  });
  await test('Standalone report escapes all review text and exposes metric limits, actual values and warning details',()=>{
    const report=W.toHTML(results.get('gate-etch'),{metric:'polyMean',min:0,max:100},{title:'<img src=x onerror=1>',note:'<script>alert(1)</script>'});
    assert(!report.includes('<script>'));assert(!report.includes('<img src=x'));assert(report.includes('&lt;script&gt;'));assert(report.includes('목표 범위 안'));assert(report.includes('4,800 nm'));assert(report.includes('@media print'));assert(report.includes('aria-label="계산 결과 표"'));assert(report.includes('R25'));assert(report.includes('SHA-256'));assert(report.includes('실제 계산값'));
  });
  await test('Untrusted or subsequently changed results cannot be assessed or exported',async()=>{
    const result=results.get('oxidation');assert.throws(()=>W.toCSV(clone(result)),/먼저 계산/);const changed=await W.run(configs.get('oxidation'));changed.rows[0].recipe.time=89;assert.throws(()=>W.toHTML(changed));await assert.rejects(W.pack(changed));assert.throws(()=>W.assess(changed,{metric:'oxideMean',min:0,max:100}));
  });
  await test('Unknown presets, bad progress callbacks and invalid review metadata are rejected',async()=>{
    await assert.rejects(W.preparePreset('missing'));await assert.rejects(W.preparePreset('cmp',{onProgress:1}));await assert.rejects(W.run(configs.get('cmp'),{onProgress:'bad'}));
    await assert.rejects(W.pack(results.get('cmp'),{title:null}));await assert.rejects(W.pack(results.get('cmp'),{note:'x'.repeat(3001)}));assert.throws(()=>W.toHTML(results.get('cmp'),null,{title:1}));
  });
  await test('No engine definitions, live state or browser storage are mutated',()=>{assert.equal(JSON.stringify({route:E.route,tools:E.tools,materials:E.materials}),definitions);assert.equal(storageTouches,0);assert.equal(appTouches,0);assert(yields>0);});
  return {passed:tests.length,failed:0,tests};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runCmosWindowTests().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});

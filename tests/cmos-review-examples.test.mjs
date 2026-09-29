import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function runCmosReviewExamplesTests(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
  let storageTouches=0,appTouches=0,executions=0,timerYields=0;
  const c=vm.createContext({setTimeout(callback,delay){timerYields++;return setTimeout(callback,delay);}});c.window=c;
  Object.defineProperty(c,'localStorage',{get(){storageTouches++;throw new Error('Examples must not access storage');}});
  Object.defineProperty(c,'FabApp',{get(){appTouches++;throw new Error('Examples must not access application state');}});
  vm.runInContext(fs.readFileSync(path.join(root,'fab-engine.js'),'utf8'),c);
  const E=c.FabEngine,execute=E.execute;E.execute=(...args)=>{executions++;return execute(...args);};
  vm.runInContext(fs.readFileSync(path.join(root,'cmos-review-examples.js'),'utf8'),c);
  const X=c.CmosReviewExamples,tests=[],results=new Map();
  const test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const engineBefore=JSON.stringify({route:E.route,tools:E.tools,materials:E.materials});
  await test('Three immutable examples resolve actual route fields and valid alternate recipes',()=>{
    assert.equal(X.list.length,3);assert.equal(new Set(X.list.map(x=>x.id)).size,3);assert(Object.isFrozen(X.list));
    for(const x of X.list){assert(Object.isFrozen(x));const step=E.route.find(s=>s.id===x.stepId),field=E.tools[step.tool].fields[x.parameter];assert(field);assert.equal(x.before,step.recipe[x.parameter]);assert.equal(x.unit,field.unit);assert.notEqual(x.before,x.after);assert.equal(E.recipeFor(step,{[x.parameter]:x.after})[x.parameter],x.after);}
  });
  for(const example of X.list)await test(example.id+' changes only its final recipe and produces replayable differences',async()=>{
    const updates=[],data=await X.run(example.id,{onProgress:event=>updates.push({...event})});results.set(example.id,data);
    assert.equal(data.schema,'waferflow-fab-comparison-v1');assert.equal(data.modelVersion,E.VERSION);assert.equal(data.stepId,example.stepId);
    assert.equal(data.reference.records.length,data.completedOperations);assert.equal(data.current.records.length,data.completedOperations);assert.equal(data.profile.length,E.NX);assert.equal(data.differences.length,1);
    assert.equal(JSON.stringify(data.reference.records.slice(0,-1)),JSON.stringify(data.current.records.slice(0,-1)),'Common executed prefix must retain exact timestamps and values');
    const left=data.reference.records.at(-1),right=data.current.records.at(-1);
    for(const key of Object.keys(left.recipe))assert.equal(right.recipe[key],key===example.parameter?example.after:left.recipe[key]);
    assert.equal(left.fault,right.fault);assert.equal(left.recipe[example.parameter],example.before);
    const a=E.replay(data.reference.waferId,data.reference.records),b=E.replay(data.current.waferId,data.current.records);
    assert.equal(JSON.stringify(E.summarize(a)),JSON.stringify(data.reference.metrics));assert.equal(JSON.stringify(E.summarize(b)),JSON.stringify(data.current.metrics));
    assert.notEqual(JSON.stringify(data.reference.metrics),JSON.stringify(data.current.metrics));
    assert(data.profile.some(p=>Math.abs(p.reference_nm-p.current_nm)>0.01));
    for(let i=0;i<E.NX;i++){assert.equal(data.profile[i].reference_nm,E.height(a.columns[i]));assert.equal(data.profile[i].current_nm,E.height(b.columns[i]));}
    for(const record of [...a.records,...b.records])assert(Number.isFinite(Date.parse(record.time)));
    assert.equal(updates[0].completed,0);assert.equal(updates.at(-1).completed,updates.at(-1).total);
    for(let i=1;i<updates.length;i++){assert.equal(updates[i].total,updates[0].total);assert.equal(updates[i].completed,updates[i-1].completed+1);}
  });
  await test('Chosen comparisons visibly distinguish oxide growth, poly residue and planarization',()=>{
    const oxide=results.get('oxidation-time'),gate=results.get('gate-etch-time'),cmp=results.get('cmp-time');
    assert(oxide.current.metrics.films.SiO2.mean>oxide.reference.metrics.films.SiO2.mean);
    assert(gate.current.metrics.films.Poly.mean>gate.reference.metrics.films.Poly.mean);
    assert(gate.current.metrics.gateCD>gate.reference.metrics.gateCD);
    assert(cmp.current.metrics.topography>cmp.reference.metrics.topography);
  });
  await test('Pre-aborted and unknown examples cannot start engine work',async()=>{
    const before=executions,controller=new AbortController();controller.abort();
    await assert.rejects(X.run('cmp-time',{signal:controller.signal}),{name:'AbortError'});
    await assert.rejects(X.run('missing'),/지원하지 않는/);assert.equal(executions,before);
  });
  await test('A scheduled cancellation interrupts calculation after no more than six operations',async()=>{
    const controller=new AbortController(),before=executions;
    await assert.rejects(X.run('cmp-time',{signal:controller.signal,onProgress({completed}){if(completed===1)setTimeout(()=>controller.abort(),0);}}),{name:'AbortError'});
    assert(executions-before<=6);assert(executions-before>0);
  });
  await test('Cancellation requested by the progress callback never returns a completed result',async()=>{
    const controller=new AbortController();
    await assert.rejects(X.run('oxidation-time',{signal:controller.signal,onProgress({completed,total}){if(completed===total)controller.abort();}}),{name:'AbortError'});
  });
  await test('Returned records and metrics cannot contaminate subsequent examples',async()=>{
    const first=results.get('oxidation-time'),expected=JSON.stringify(first.current.metrics);first.current.records[0].recipe.time=600;first.current.metrics.topography=-999;first.profile[0].current_nm=-999;
    const again=await X.run('oxidation-time');assert.equal(JSON.stringify(again.current.metrics),expected);assert.notEqual(again.current.records[0].recipe.time,600);assert.notEqual(again.profile[0].current_nm,-999);
  });
  await test('Examples leave engine definitions, application state and local storage untouched',()=>{
    assert.equal(JSON.stringify({route:E.route,tools:E.tools,materials:E.materials}),engineBefore);assert.equal(storageTouches,0);assert.equal(appTouches,0);assert(timerYields>0);
  });
  return {passed:tests.length,failed:0,tests};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runCmosReviewExamplesTests().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});

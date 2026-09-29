import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function runFabDepositionTests(root){
  const context=vm.createContext({});
  vm.runInContext(await fs.readFile(root+'/fab-engine.js','utf8'),context);
  const E=context.FabEngine,tests=[];
  async function test(name,fn){try{await fn();tests.push({name,status:'passed'});}catch(error){tests.push({name,status:'failed',error:error.stack});}}
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let before=E.createWafer('DEPOSITION-BASELINE');
  while(E.route[before.cursor].op!=='spacerDeposit')before=E.execute(before).wafer;
  const step=E.route[before.cursor],original=JSON.stringify(before);
  const film=(wafer,i)=>wafer.columns[i].filter(layer=>layer.material==='SiN').reduce((sum,layer)=>sum+layer.nm,0);
  // Captured from the pre-interpolation wf-fab-0.6.0 engine. These protect
  // completed geometry and history compatibility, not intermediate rendering.
  const cases=[
    {name:'normal',recipe:{},fault:'none',hash:'739d738a67621379a1cef3d60806c5a2ae7d42b7809527b857e74c875d986ef2'},
    {name:'normal',recipe:{},fault:'uniformity',hash:'98a5d62880d7bf4931ab5476c2d3bfc0101f3b7aa44fae026afd8497d1a6063c'},
    {name:'minimum',recipe:{time:10,temperature:200,flow:50},fault:'none',hash:'116aa1b5dfe9981755767cf3db851a552df8ba00238e701661ec8ca5bce51273'},
    {name:'minimum',recipe:{time:10,temperature:200,flow:50},fault:'uniformity',hash:'3ef638701e114e3c334206d7e5328f4bfaf3cccda78ec40526411a751a454213'},
    {name:'maximum',recipe:{time:900,temperature:500,flow:150},fault:'none',hash:'84faa0aa4968e0747a655ce160dc8e9abedce5c77903073d6e7530229ca42e7b'},
    {name:'maximum',recipe:{time:900,temperature:500,flow:150},fault:'uniformity',hash:'33fec940c98d647930ffa00bb7254ab9ae07901b84446b3cc02f6771db024862'}
  ];
  const run=(item,f)=>E.process(before,step,item.recipe,f,item.fault).wafer;
  await test('Zero-progress spacer deposition preserves all materials and the unexecuted cursor',()=>{
    for(const item of cases){const zero=run(item,0);assert.equal(JSON.stringify(zero.columns),JSON.stringify(before.columns));assert.equal(zero.cursor,before.cursor);assert.equal(zero.virtualSeconds,before.virtualSeconds);}
    assert.equal(JSON.stringify(before),original);
  });
  await test('Infinitesimal spacer progress cannot instantly fill a full neighboring column',()=>{
    const f=1e-9;
    for(const item of cases){const tiny=run(item,f),full=run(item,1);
      for(let i=0;i<E.NX;i++)assert(film(tiny,i)-film(before,i)<=(film(full,i)-film(before,i))*f+1e-7,item.name+' '+item.fault+' column '+i);
      assert.equal(tiny.cursor,before.cursor);
    }
  });
  await test('Every spacer column grows continuously between its original and completed geometry',()=>{
    for(const item of cases){const full=run(item,1);let previous=before;
      for(const f of [.001,.01,.1,.25,.5,.75,.9,1]){const current=run(item,f);
        for(let i=0;i<E.NX;i++){
          const base=film(before,i),expected=base+(film(full,i)-base)*f;
          assert(Math.abs(film(current,i)-expected)<1e-7,item.name+' '+item.fault+' column '+i+' fraction '+f);
          assert(film(current,i)>=film(previous,i)-1e-10);
          assert.equal(JSON.stringify(current.columns[i].filter(layer=>layer.material!=='SiN')),JSON.stringify(before.columns[i].filter(layer=>layer.material!=='SiN')));
        }
        previous=current;
      }
    }
    assert.equal(JSON.stringify(before),original);
  });
  await test('Crossing the old 30 nm reach boundary does not add a sudden spacer-height block',()=>{
    const left=run(cases[0],2/3-1e-8),middle=run(cases[0],2/3),right=run(cases[0],2/3+1e-8),full=run(cases[0],1);
    for(let i=0;i<E.NX;i++){
      const limit=(film(full,i)-film(before,i))*2e-8+1e-7;
      assert(film(right,i)-film(left,i)<=limit,'column '+i+' changed discontinuously');
      assert(Math.abs(film(middle,i)-(film(left,i)+film(right,i))/2)<1e-7);
    }
  });
  await test('Completed default, minimum and maximum recipes match the prior engine under both uniformity conditions',()=>{
    for(const item of cases)assert.equal(digest(run(item,1).columns),item.hash,item.name+' '+item.fault);
    assert.equal(E.VERSION,'wf-fab-0.6.0');
  });
  await test('The 117-step reference result and its historical-record replay remain unchanged with zero warnings',()=>{
    let wafer=E.createWafer('DEPOSITION-BASELINE');
    for(const step of E.route){const result=E.execute(wafer);assert.equal(result.warnings.length,0,step.id);wafer=result.wafer;}
    const state={version:wafer.version,cursor:wafer.cursor,columns:wafer.columns,dopants:wafer.dopants,virtualSeconds:wafer.virtualSeconds,particles:wafer.particles};
    assert.equal(digest(state),'a99b597e2ffe02db7afb9dfdba8ff8b8ad65da1971776d2b58fce5b12d185bad');
    for(const record of wafer.records)record.time='2026-09-24T00:00:00.000Z';
    assert.equal(JSON.stringify(E.replay(wafer.id,wafer.records)),JSON.stringify(wafer));
  });
  const result={passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,tests};
  await fs.writeFile(root+'/tests/fab-deposition-results.json',JSON.stringify(result,null,2));
  return result;
}

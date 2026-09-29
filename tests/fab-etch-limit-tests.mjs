import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function runFabEtchLimitTests(root){
  const context=vm.createContext({});vm.runInContext(await fs.readFile(root+'/fab-engine.js','utf8'),context);
  const E=context.FabEngine,tests=[],code='ETCH_DEPTH_LIMIT';
  async function test(name,fn){try{await fn();tests.push({name,status:'passed'});}catch(error){tests.push({name,status:'failed',error:error.stack});}}
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let before=E.createWafer('ETCH-LIMIT-BASELINE');while(E.route[before.cursor].id!=='OP022')before=E.execute(before).wafer;
  const step=E.route[before.cursor],original=JSON.stringify(before),notice=result=>result.warnings.find(w=>w.code===code);
  const newlyEmpty=(input,output)=>input.columns.filter((column,i)=>column.some(layer=>layer.material==='Si'&&layer.nm>0)&&!output.columns[i].some(layer=>layer.material==='Si'&&layer.nm>0)).length;
  function checkNotice(result,count){
    const warning=notice(result);assert(warning,'Expected a notice for '+count+' newly exhausted columns');assert.equal(warning.category,'model-limit');
    assert(warning.message.includes(count+'/'+E.NX+'개 위치'));assert(warning.message.includes('600 nm'));assert(warning.message.includes('물리적 식각 정지'));
  }
  await test('Trench etching reports locally exhausted silicon even when the mean-loss warning is absent',()=>{
    for(const [time,count] of [[75,0],[145,0],[147,6],[150,64],[300,64],[900,64]]){
      const result=E.execute(before,{time});assert.equal(newlyEmpty(before,result.wafer),count);
      if(count)checkNotice(result,count);else assert(!notice(result));
      assert(!result.warnings.some(w=>w.code==='SUBSTRATE_LOSS'));
    }
    assert.equal(JSON.stringify(before),original);
  });
  await test('Depth notices begin at actual silicon exhaustion and respect zero and partial progress',()=>{
    const rate=4*(1+.015*(1-.33)),limit=before.columns[0].find(layer=>layer.material==='Si').nm/rate;
    const left=E.process(before,step,{time:limit-1e-4}),right=E.process(before,step,{time:limit+1e-4});
    assert(left.wafer.columns[0].some(layer=>layer.material==='Si'&&layer.nm>0));assert(!notice(left));checkNotice(right,2);
    const zero=E.process(before,step,{time:300},0);assert(!notice(zero));assert.equal(JSON.stringify(zero.wafer.columns),JSON.stringify(before.columns));
    const early=E.process(before,step,{time:300},(limit-1e-4)/300),late=E.process(before,step,{time:300},(limit+1e-4)/300);
    assert(!notice(early));checkNotice(late,2);assert.equal(late.wafer.cursor,before.cursor);
  });
  await test('Columns already without silicon are not counted as new depth-limit events',()=>{
    const input=E.copy(before);input.columns[0]=[];input.columns[E.NX-1]=[];
    assert(!notice(E.process(input,step,{time:75})));const result=E.process(input,step,{time:147});checkNotice(result,4);assert.equal(newlyEmpty(input,result.wafer),4);
    const empty=E.copy(before);for(const column of empty.columns)for(let i=column.length-1;i>=0;i--)if(column[i].material==='Si')column.splice(i,1);
    assert(!notice(E.process(empty,step,{time:900})));assert(!notice(E.process(input,step,{time:900},0)));
  });
  await test('The existing mean substrate-loss warning remains distinct from the model-depth notice',()=>{
    const bare=E.copy(before);bare.columns=Array.from({length:E.NX},()=>[{material:'Si',nm:E.BASE}]);
    const partial=E.process(bare,step,{time:100}),exhausted=E.process(bare,step,{time:300});
    for(const result of [partial,exhausted]){const warning=result.warnings.find(w=>w.code==='SUBSTRATE_LOSS');assert(warning);assert.equal(warning.category,'process-result');assert.equal(warning.message,'실리콘 제거량이 큰 조건입니다. 표적 막과 시간을 확인하세요.');}
    assert(!notice(partial));checkNotice(exhausted,E.NX);
  });
  await test('Notice-only changes preserve pre-change etch geometry and measured metrics at all tested times',()=>{
    // Captured before ETCH_DEPTH_LIMIT was introduced, using identical input history.
    const cases=[
      [75,'5fa136872cb6fe418faf3ac45afe87136f889f9ba9f83027bacac5468950e001','15fdb3a6fc31abc69cf43e1707839b6376349b4dc54f835d6ee98743dda443bd'],
      [145,'57ef1ec74b61da1799488aac090bba58805496364fd66b8264c7344b69fa04c2','2d91b8f88e6ea392a83ef81b89009654bddcaa2a2903625f1ce82ac5cd1207c4'],
      [147,'43ad50d1e7ae31ecb5aa5f2ddb38ac472d259252544a01d7d053c2ad6c1971be','bfe66407fd14f8290cf47ca94e714081dbcf4739694e6dcfbe551b4fd55a8f2b'],
      [150,'ba7450352bb79268c1052a3176f3997c91010e59d967953fdd7a6b934bf7da37','b0ddfb7fc36ed45821ec3f0c163dfcd5780b44ba46ad664839272a2002ab0fff'],
      [300,'d11452a42275b3e7b4065e206272d330ebe94effc3c0bb5b9849d4a5cdb45712','aa6243649c1b2dedaad8953a34a036d11a2e76bc3dbc95d95235a6da89399dc7'],
      [900,'5301efe8fa4ecf16e6cde2f02719e0c40faa55f803de326834a71c264784fcd1','6f96a8583278f18ca6bbd1048b071706efd457f178083c56ccad8e2fe437e256']
    ];
    for(const [time,geometry,metrics] of cases){const result=E.execute(before,{time});assert.equal(digest(result.wafer.columns),geometry);assert.equal(digest(result.metrics),metrics);}
  });
  await test('Older compatible records replay unchanged calculations while receiving the new explanatory notice',()=>{
    let wafer=E.createWafer('ETCH-LIMIT-BASELINE');for(const operation of E.route)wafer=E.execute(wafer,operation.id==='OP022'?{time:300}:{}).wafer;
    const records=E.copy(wafer.records);for(const record of records){record.warnings=record.warnings.filter(w=>w.code!==code);record.time='2026-09-24T00:00:00.000Z';}
    const replayed=E.replay(wafer.id,records);
    assert.equal(E.VERSION,'wf-fab-0.6.0');assert.equal(JSON.stringify(replayed.columns),JSON.stringify(wafer.columns));assert.equal(JSON.stringify(replayed.dopants),JSON.stringify(wafer.dopants));assert.equal(replayed.virtualSeconds,wafer.virtualSeconds);
    assert.equal(records[21].warnings.length,0);checkNotice({warnings:replayed.records[21].warnings},64);
    assert.equal(replayed.records.filter(record=>record.warnings.some(w=>w.code===code)).length,1);
    assert(replayed.records.every(record=>record.time==='2026-09-24T00:00:00.000Z'));
  });
  await test('The default 117-operation route remains free of warnings with finite nonnegative material thicknesses',()=>{
    let wafer=E.createWafer();for(const operation of E.route){const result=E.execute(wafer);assert.equal(result.warnings.length,0,operation.id);wafer=result.wafer;for(const column of wafer.columns)for(const layer of column)assert(Number.isFinite(layer.nm)&&layer.nm>=0);}
    assert.equal(wafer.cursor,117);
  });
  const result={passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,tests};
  await fs.writeFile(root+'/tests/fab-etch-limit-results.json',JSON.stringify(result,null,2));return result;
}

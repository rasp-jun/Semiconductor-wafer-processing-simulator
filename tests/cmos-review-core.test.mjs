import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function runCmosReviewTests(root){
  const ctx=vm.createContext({crypto:webcrypto,TextEncoder});
  for(const file of ['fab-engine.js','cmos-review-core.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  const E=ctx.FabEngine,R=ctx.CmosReview,tests=[];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  const rehash=pack=>{pack.integrity.digest=createHash('sha256').update(canonical(pack.payload)).digest('hex');return pack;};
  const test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const stamp='2026-09-28T00:00:00.000Z';
  function fixture(count=18,change=(recipe,index)=>index===0?{...recipe,time:120}:recipe){
    let a=E.createWafer('W01'),b=E.createWafer('W02');
    for(let i=0;i<count;i++){
      const step=E.route[i];
      a=E.execute(a).wafer;b=E.execute(b,change(copy(step.recipe),i)).wafer;
      a.records[i].time=stamp;b.records[i].time=stamp;
    }
    const differences=[];
    for(let i=0;i<count;i++)for(const [key,field]of Object.entries(E.tools[E.route[i].tool].fields))if(a.records[i].recipe[key]!==b.records[i].recipe[key])differences.push({stepId:E.route[i].id,name:E.route[i].name,field:key,label:field.label,unit:field.unit,reference:a.records[i].recipe[key],current:b.records[i].recipe[key]});
    return copy({schema:'waferflow-fab-comparison-v1',modelVersion:E.VERSION,generatedAt:stamp,completedOperations:count,stepId:count?E.route[count-1].id:null,reference:{waferId:a.id,title:'기준 조건',note:'기준 메모',records:a.records,metrics:E.summarize(a)},current:{waferId:b.id,title:'처리 시간 변경',note:'변경 메모',records:b.records,metrics:E.summarize(b)},profile:a.columns.map((column,i)=>({x_nm:(i+.5)*E.WIDTH/E.NX,reference_nm:E.height(column),current_nm:E.height(b.columns[i])})),differences,notice:'Same completed operation, same uncalibrated geometric model. Draft recipes are excluded. Not measurement data or statistical inference.'});
  }
  const source=fixture(),original=JSON.stringify(source);
  let good;
  await test('Creates a SHA-256 package and replays both complete histories without mutation',async()=>{
    good=await R.create(source,{title:'검토 01',note:'반복 가능한 조건 비교'});
    assert.equal(good.schema,'waferflow-cmos-review-v1');assert.equal(good.integrity.algorithm,'SHA-256');
    assert.equal(good.integrity.digest,createHash('sha256').update(canonical(good.payload)).digest('hex'));
    const loaded=copy(good),before=JSON.stringify(loaded),result=await R.verify(loaded);
    assert.deepEqual(copy(result.checks),{checksum:true,model:true,replay:true});
    assert.equal(JSON.stringify(result.comparison),original);assert.equal(JSON.stringify(source),original);assert.equal(JSON.stringify(loaded),before);
    assert.notEqual(result.package,loaded);assert.notEqual(result.package.payload.comparison,loaded.payload.comparison);
    result.comparison.current.title='UI-only copy';assert.notEqual(result.package.payload.comparison.current.title,'UI-only copy');
  });
  await test('Canonical checksum accepts JSON property reordering and survives serialization',async()=>{
    const reorder=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(reorder):Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)]));
    const result=await R.verify(reorder(copy(good)));assert.equal(result.package.integrity.digest,good.integrity.digest);
  });
  await test('Zero-operation comparison has two empty histories and a flat 160-point profile',async()=>{
    const pack=await R.create(fixture(0)),result=await R.verify(copy(pack));
    assert.equal(result.comparison.completedOperations,0);assert.equal(result.comparison.stepId,null);assert.equal(result.comparison.profile.length,160);assert.equal(result.comparison.profile.every(p=>p.reference_nm===0&&p.current_nm===0),true);
    assert.match(R.reportHTML(result.package),/입고 상태/);
  });
  await test('Identical executed inputs retain a zero-difference comparison',async()=>{
    const pack=await R.create(fixture(3,recipe=>recipe)),result=await R.verify(copy(pack));
    assert.equal(result.comparison.differences.length,0);assert.equal(result.comparison.profile.every(p=>p.reference_nm===p.current_nm),true);
    assert.match(R.reportHTML(result.package),/실행 조건이 동일합니다/);
  });
  await test('Checksum rejects metadata changes as well as result corruption',async()=>{
    for(const modify of [p=>p.payload.note+='changed',p=>p.payload.comparison.profile[0].current_nm++,p=>p.payload.createdAt='2026-09-29T00:00:00Z']){
      const pack=copy(good);modify(pack);await assert.rejects(R.verify(pack),/체크섬/);
    }
  });
  await test('Rehashed fabricated summaries, profiles, differences, warnings and per-step metrics still fail replay',async()=>{
    for(const modify of [c=>c.current.metrics.topography++,c=>c.reference.metrics.films.Si.mean++,c=>c.profile[0].current_nm++,c=>c.profile.pop(),c=>c.differences=[],c=>c.current.records[0].metrics.particles++,c=>c.current.records[0].warnings.push({code:'FAKE',message:'invented'}),c=>c.current.records[0].seconds++]){
      const pack=copy(good);modify(pack.payload.comparison);await assert.rejects(R.verify(rehash(pack)),/재계산/);
    }
  });
  await test('Changed completed recipe cannot be hidden by retaining the old calculated results',async()=>{
    const pack=copy(good);pack.payload.comparison.current.records[0].recipe.time=600;
    await assert.rejects(R.verify(rehash(pack)),/재계산/);
  });
  await test('Wrong package, nested comparison and record model versions fail independently',async()=>{
    for(const modify of [p=>p.schema='unknown',p=>p.payload.modelVersion='old',p=>p.payload.comparison.modelVersion='old',p=>p.payload.comparison.current.records[0].modelVersion='old']){
      const pack=copy(good);modify(pack);await assert.rejects(R.verify(rehash(pack)));
    }
  });
  await test('Same checkpoint requires exact ordered histories and distinct valid wafer identities',async()=>{
    for(const modify of [c=>c.current.records.pop(),c=>c.current.records.reverse(),c=>c.completedOperations--,c=>c.stepId='FAKE',c=>c.reference.waferId=c.current.waferId,c=>c.reference.waferId='invalid id',c=>c.current.records[0].index=1,c=>c.current.records[0].tool='etch',c=>c.current.records[0].name='fake']){
      const c=copy(source);modify(c);await assert.rejects(R.create(c));
    }
  });
  await test('Recipe bounds, missing fields and unknown fields never silently normalize',async()=>{
    for(const modify of [r=>r.time=601,r=>r.time=9,r=>r.time='90',r=>r.time=null,r=>delete r.time,r=>r.unknown=1]){
      const c=copy(source);modify(c.current.records[0].recipe);await assert.rejects(R.create(c));
    }
  });
  await test('Unknown fields in outer objects cannot masquerade as provenance or approvals',async()=>{
    for(const modify of [p=>p.signature='fake',p=>p.payload.approved=true,p=>p.integrity.author='someone',p=>p.payload.comparison.current.approved=true,p=>p.payload.comparison.current.records[0].approved=true]){
      const pack=copy(good);modify(pack);await assert.rejects(R.verify(rehash(pack)));
    }
  });
  await test('NaN, infinity, undefined and non-JSON values fail before serialization can erase them',async()=>{
    for(const invalid of [NaN,Infinity,-Infinity,undefined,1n,()=>1,new Date()]){
      const c=copy(source);c.current.records[0].recipe.time=invalid;await assert.rejects(R.create(c));
    }
  });
  await test('Invalid and absent dates are rejected instead of normalized by Date.parse',async()=>{
    for(const date of ['2026-02-29T00:00:00Z','2024-02-30T00:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-09-28T24:01:00Z','2026-09-28T00:00:00','2026-09-28T00:00:00+24:00','today',null]){
      const c=copy(source);c.current.records[0].time=date;await assert.rejects(R.create(c));
    }
    for(const key of ['createdAt','comparison']){
      const pack=copy(good);if(key==='createdAt')pack.payload.createdAt='2026-02-30T00:00:00Z';else pack.payload.comparison.generatedAt='bad';
      await assert.rejects(R.verify(rehash(pack)));
    }
  });
  await test('Valid leap-day, time-zone and midnight timestamps preserve their original text',async()=>{
    for(const date of ['2024-02-29T23:59:59.123+09:00','2026-09-28T24:00:00Z','2026-09-28T00:00:00.123456789Z']){
      const c=fixture(1);c.current.records[0].time=date;const pack=await R.create(c);assert.equal(pack.payload.comparison.current.records[0].time,date);
    }
  });
  await test('Titles and notes keep exact bounded strings, reject overflow and reject null options',async()=>{
    for(const options of [{title:'x'.repeat(101)},{note:'x'.repeat(3001)},{title:null},{note:1},{extra:'field'},null])await assert.rejects(R.create(source,options));
    for(const modify of [c=>c.reference.title='x'.repeat(61),c=>c.current.note='x'.repeat(2001),c=>c.current.note=null]){const c=copy(source);modify(c);await assert.rejects(R.create(c));}
    const pack=await R.create(fixture(0),{title:'x'.repeat(100),note:'x'.repeat(3000)});assert.equal(pack.payload.title.length,100);assert.equal(pack.payload.note.length,3000);
  });
  await test('Prototype keys, getters, sparse arrays, custom objects and cycles cannot enter package data',async()=>{
    for(const key of ['__proto__','constructor','prototype']){
      const c=copy(source);Object.defineProperty(c.current.records[0].recipe,key,{value:{polluted:true},enumerable:true});await assert.rejects(R.create(c));
    }
    const getter=copy(source);let touched=false;Object.defineProperty(getter.current,'note',{enumerable:true,get(){touched=true;return 'hidden';}});await assert.rejects(R.create(getter));assert.equal(touched,false);
    const prototypeGetter=copy(source),proto=Object.create(null);Object.defineProperty(proto,'constructor',{get(){touched=true;return Object;}});Object.setPrototypeOf(prototypeGetter.current,proto);await assert.rejects(R.create(prototypeGetter));assert.equal(touched,false);
    const sparse=copy(source);delete sparse.profile[0];await assert.rejects(R.create(sparse));
    const custom=copy(source);custom.current.metrics=Object.create({secret:1});await assert.rejects(R.create(custom));
    const cyclic=copy(source);cyclic.current.note=cyclic;await assert.rejects(R.create(cyclic));assert.equal({}.polluted,undefined);
  });
  await test('Malformed checksum and unsupported algorithms cannot bypass verification',async()=>{
    for(const modify of [p=>p.integrity.algorithm='MD5',p=>p.integrity.digest='a'.repeat(63),p=>p.integrity.digest='Z'.repeat(64),p=>p.integrity.digest=1]){
      const pack=copy(good);modify(pack);await assert.rejects(R.verify(pack));
    }
  });
  await test('Queued hash operation uses a captured snapshot and ignores later caller mutations',async()=>{
    const c=copy(source),pending=R.create(c);c.reference.title='changed during await';c.current.records[0].recipe.time=600;
    const pack=await pending;assert.equal(pack.payload.comparison.reference.title,source.reference.title);await R.verify(copy(pack));
    const input=copy(good),pendingVerify=R.verify(input);input.payload.comparison.current.records[0].recipe.time=600;
    const result=await pendingVerify;assert.equal(result.comparison.current.records[0].recipe.time,120);
  });
  await test('Warning timeline retains engine-generated explanations and escaping in every user string',async()=>{
    const c=fixture(4,(recipe,index)=>index===3?{...recipe,focus:.8}:recipe);
    c.reference.title='<img src=x onerror=alert(1)>';c.current.note='</p><script>bad()</script>&"\'';
    const pack=await R.create(c,{title:'<script>title</script>',note:'<iframe src="x">memo</iframe>'}),html=R.reportHTML(pack);
    assert(!html.includes('<script>'));assert(!html.includes('<iframe'));assert(!html.includes('<img'));assert(html.includes('&lt;script&gt;title&lt;/script&gt;'));assert(html.includes('&lt;iframe'));assert(html.includes('DEFOCUS'));assert(html.includes('초점 오프셋'));assert(html.includes(pack.integrity.digest));
    assert(!/\b(?:src|href)=["']https?:/i.test(html));assert(html.includes("default-src 'none'"));assert(html.includes('작성자, 출처 또는 기록 시각의 진위를 인증하지 않습니다'));assert(html.includes('현재 − 기준'));
  });
  await test('Reports reject unverified copies and packages modified after verification',async()=>{
    assert.throws(()=>R.reportHTML(copy(good)),/검증/);
    const result=await R.verify(copy(good));assert.match(R.reportHTML(result.package),/EXPERIMENT REVIEW/);
    result.package.payload.note='changed';assert.throws(()=>R.reportHTML(result.package),/검증/);
  });
  await test('HTML condition tables retain every executed digit instead of rounding away differences',async()=>{
    const c=fixture(6,(recipe,index)=>index===0?{...recipe,time:90.0000001}:index===5?{...recipe,dose:20000000000001}:recipe);
    const pack=await R.create(c),html=R.reportHTML(pack);
    assert.equal(pack.payload.comparison.current.records[0].recipe.time,90.0000001);
    assert(html.split('90.0000001').length>=3,'Precise time must appear in both comparison and completed history');
    assert(html.split('20000000000001').length>=3,'Precise dose must appear in both comparison and completed history');
  });
  await test('A caller can rehash edited notes; checksum intentionally does not claim authorship',async()=>{
    const pack=copy(good);pack.payload.note='Edited outside this application';const result=await R.verify(rehash(pack));
    assert.equal(result.package.payload.note,pack.payload.note);assert.match(R.reportHTML(result.package),/수정 파일도 입력과 결과가 일치하면/);
  });
  await test('Missing secure-context cryptography yields an actionable error',async()=>{
    const noCrypto=vm.createContext({TextEncoder});for(const file of ['fab-engine.js','cmos-review-core.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),noCrypto);
    await assert.rejects(noCrypto.CmosReview.create(fixture(0)),/HTTPS 또는 localhost/);
  });
  await test('Full 117-operation histories replay and retain the final profile and report appendix',async()=>{
    const c=fixture(117,recipe=>recipe),pack=await R.create(c),result=await R.verify(copy(pack));
    assert.equal(result.comparison.completedOperations,117);assert.equal(result.comparison.current.records.length,117);assert.equal(result.comparison.profile.length,160);
    const html=R.reportHTML(result.package);assert(html.includes(E.route.at(-1).name));assert(html.includes('기록 부록 · 기준'));assert(html.includes('기록 부록 · 현재'));assert(html.includes('각 폴리층이 20 nm를 초과'));assert(html.includes('4,800 nm'));
  });
  return {passed:tests.length,failed:0,tests};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCmosReviewTests(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
}

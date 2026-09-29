import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';

export async function runFabTests(root){
  const tests=[],test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const files=Object.fromEntries(await Promise.all(['cmos-lab.html','fab-engine.js','fab-app.js','fab-guide.js','fab-observe.js','fab-view.js','equipment-detail.js','vendor/three.js'].map(async f=>[f,await fs.readFile(root+'/'+f,'utf8')])));
  const ctx=vm.createContext({});vm.runInContext(files['fab-engine.js'],ctx);const E=ctx.FabEngine;
  let w=E.createWafer(),snapshots=[w];
  await test('117 ordered operations cover all 18 equipment types and 8 modules',()=>{assert.equal(E.route.length,117);assert.equal(new Set(E.route.map(s=>s.tool)).size,18);assert.equal(E.modules.length,8);E.route.forEach((s,i)=>assert.equal(s.index,i));});
  await test('Full reference CMOS route completes with nonnegative finite material and no warnings',()=>{for(const s of E.route){const result=E.execute(w);w=result.wafer;snapshots.push(w);assert.equal(w.cursor,s.index+1);assert.equal(result.warnings.length,0,s.name);for(const c of w.columns)for(const l of c)assert(Number.isFinite(l.nm)&&l.nm>=0,s.name);}assert.equal(E.summarize(w).films.PR.max,0);assert(E.summarize(w).films.W.max>100);assert(E.summarize(w).films.Al.max>400);assert.equal(w.dopants.length,6);});
  await test('Replay exactly reconstructs geometry, dopants, elapsed time and original timestamps',()=>{const restored=E.replay(w.id,w.records);assert.equal(JSON.stringify(restored),JSON.stringify(w));});
  await test('Cached adjacent states reproduce all 117 reference states and preserve original records',()=>{
    const cache=E.createReplayCache(),original=JSON.stringify(w.records);
    for(let count=0;count<=E.route.length;count++)assert.equal(JSON.stringify(cache.at(w.id,w.records,count)),JSON.stringify(snapshots[count]));
    assert.equal(JSON.stringify(w.records),original);
    assert.equal(cache.at(w.id,w.records,100),cache.at(w.id,w.records,100));
    for(const count of [3,91,10,116,0])assert.equal(JSON.stringify(cache.at(w.id,w.records,count)),JSON.stringify(snapshots[count]));
  });
  await test('Replay cache isolates replacement histories and IDs and rejects invalid records and ranges',()=>{
    const cache=E.createReplayCache(2),records=w.records;
    const original=cache.at('same',records,2),changed=E.copy(records);changed[1].recipe.rpm=4000;
    assert.notEqual(JSON.stringify(cache.at('same',changed,2).columns),JSON.stringify(original.columns));
    assert.equal(cache.at('other',records,2).id,'other');
    const broken=E.copy(records);broken[1].modelVersion='old';assert.throws(()=>cache.at('same',broken,2));
    const reordered=E.copy(records);reordered[1].stepId=records[0].stepId;assert.throws(()=>cache.at('same',reordered,2));
    for(const count of [-1,.5,NaN,118])assert.throws(()=>cache.at('same',records,count));
    assert.throws(()=>E.createReplayCache(0));const held=cache.at('same',records,2);cache.clear();assert.notEqual(cache.at('same',records,2),held);
  });
  await test('Processing does not mutate its input or prior history',()=>{const before=JSON.stringify(snapshots[31]);E.execute(snapshots[31],{time:2500});assert.equal(JSON.stringify(snapshots[31]),before);});
  await test('Thermal oxide growth consumes 0.44 nm Si per nm oxide',()=>{const i=E.route.findIndex(s=>s.tool==='oxidation'),before=E.summarize(snapshots[i]),after=E.summarize(snapshots[i+1]);assert(Math.abs((before.films.Si.mean-after.films.Si.mean)-.44*(after.films.SiO2.mean-before.films.SiO2.mean))<.002);});
  await test('Partial process at zero does not deposit spacer material',()=>{const i=E.route.findIndex(s=>s.op==='spacerDeposit');const result=E.process(snapshots[i],E.route[i],{},0);assert.equal(JSON.stringify(result.wafer.columns),JSON.stringify(snapshots[i].columns));assert.equal(result.wafer.cursor,i);});
  await test('PR remains after exposure and open regions clear only after development',()=>{const i=E.route.findIndex(s=>s.op==='expose');assert.equal(E.summarize(snapshots[i]).films.PR.mean,E.summarize(snapshots[i+1]).films.PR.mean);assert(E.summarize(snapshots[i+2]).films.PR.mean<E.summarize(snapshots[i+1]).films.PR.mean*.7);});
  await test('Underexposure propagates into PR residue and lower implant transmission',()=>{const i=E.route.findIndex(s=>s.op==='expose');let bad=E.execute(snapshots[i],{},'dose').wafer;const dev=E.execute(bad);assert(dev.warnings.some(a=>a.code==='PR_RESIDUE'));bad=E.execute(dev.wafer).wafer;assert(bad.dopants[0].transmission[120]<snapshots[i+3].dopants[0].transmission[120]);});
  await test('Etch respects the patterned mask and retains two finite-width gates',()=>{const i=E.route.findIndex(s=>s.name==='폴리 게이트 패턴 식각'),after=snapshots[i+1];assert(after.columns[40].some(l=>l.material==='Poly'));assert(!after.columns[60].some(l=>l.material==='Poly'&&l.nm>20));assert(E.summarize(after).gateCD>300&&E.summarize(after).gateCD<500);});
  await test('STI CMP reduces topography and preserves SiN stop layer',()=>{const i=E.route.findIndex(s=>s.stop==='SiN');assert(E.summarize(snapshots[i+1]).topography<E.summarize(snapshots[i]).topography);assert(E.summarize(snapshots[i+1]).films.SiN.mean>0);});
  await test('Vacuum interlock rejects processing without mutating wafer',()=>{const i=E.route.findIndex(s=>s.tool==='implant'),before=JSON.stringify(snapshots[i]);assert.throws(()=>E.execute(snapshots[i],{},'vacuum'),/INTERLOCK/);assert.equal(before,JSON.stringify(snapshots[i]));});
  await test('Out-of-order operation, invalid numbers, sample counts and unknown faults are rejected',()=>{assert.throws(()=>E.process(snapshots[0],E.route[3]));assert.throws(()=>E.execute(snapshots[0],{time:NaN}));assert.throws(()=>E.process(snapshots[0],E.route[0],{},NaN));assert.throws(()=>E.execute(snapshots[0],{},'unknown'));const s=E.route.find(s=>s.tool==='metrology');assert.throws(()=>E.recipeFor(s,{samples:5.5}));});
  await test('Implant dose and tilt affect the depth profile; anneal activates stored dopants',()=>{const i=E.route.findIndex(s=>s.tool==='implant'),a=E.execute(snapshots[i],{dose:1e13,tilt:0}).wafer,b=E.execute(snapshots[i],{dose:2e13,tilt:15}).wafer;assert.equal(b.dopants[0].dose,a.dopants[0].dose*2);assert(b.dopants[0].rp<a.dopants[0].rp);assert.equal(a.dopants[0].activation,0);assert(snapshots[15].dopants[0].activation>0);});
  await test('Metrology returns exactly the selected number of actual geometric sample sites',()=>{const s=E.route.find(s=>s.tool==='metrology'),r=E.execute(snapshots[s.index],{samples:9});assert.equal(r.wafer.lastMeasurement.sites.length,9);for(const site of r.wafer.lastMeasurement.sites)assert(Math.abs(site.surface_nm-E.height(r.wafer.columns[site.index]))<.001);});
  await test('Incomplete strip causes the next coating interlock',()=>{const i=E.route.findIndex(s=>s.op==='strip'),bad=E.execute(snapshots[i],{time:20,power:100});assert(bad.warnings.length);assert.throws(()=>E.execute(bad.wafer),/RESIST RESIDUE/);});
  await test('Partial silicidation retains unreacted Ni above NiSi and wet strip removes it',()=>{const i=E.route.findIndex(s=>s.op==='silicide'),partial=E.execute(snapshots[i],{time:5,temperature:400}).wafer;assert(E.summarize(partial).films.Ni.max>0);const full=E.execute(partial).wafer;assert.equal(E.summarize(full).films.Ni.max,0);assert(E.summarize(full).films.NiSi.mean>0);});
  await test('NiSi consumes 1.84 nm silicon and forms 2.22 nm silicide per nm of reacted nickel',()=>{
    const i=E.route.findIndex(s=>s.op==='silicide'),before=snapshots[i],after=snapshots[i+1];
    const thickness=(c,materials)=>c.filter(l=>materials.includes(l.material)).reduce((sum,l)=>sum+l.nm,0);
    let reactedColumns=0,blockedColumns=0;
    before.columns.forEach((c,j)=>{
      const nickel=thickness(c,['Ni'])-thickness(after.columns[j],['Ni']);
      if(nickel>1e-7){
        reactedColumns++;
        assert(Math.abs(thickness(c,['Si','Poly'])-thickness(after.columns[j],['Si','Poly'])-nickel*1.84)<1e-9);
        assert(Math.abs(thickness(after.columns[j],['NiSi'])-thickness(c,['NiSi'])-nickel*2.22)<1e-9);
        assert(Math.abs(E.height(after.columns[j])-E.height(c)-nickel*(2.22-1.84-1))<1e-9);
      }else{blockedColumns++;assert.equal(JSON.stringify(after.columns[j]),JSON.stringify(c));}
    });
    assert(reactedColumns>0);assert(blockedColumns>0);
  });
  await test('Silicidation stops when poly is exhausted and preserves excess nickel above the silicide',()=>{
    const i=E.route.findIndex(s=>s.op==='silicide'),thin=E.copy(snapshots[i]);
    thin.columns[0]=[{material:'Si',nm:600},{material:'SiO2',nm:10},{material:'Poly',nm:5},{material:'Ni',nm:10}];
    const after=E.execute(thin).wafer.columns[0];
    assert.equal(after.map(l=>l.material).join(','),'Si,SiO2,NiSi,Ni');
    assert.equal(after[0].nm,600);assert.equal(after[1].nm,10);
    assert(Math.abs(after[2].nm-5*2.22/1.84)<1e-10);
    assert(Math.abs(after[3].nm-(10-5/1.84))<1e-10);
  });
  await test('Oxidation, trench etch and silicidation retain dopant positions in the remaining silicon',()=>{
    for(const name of ['패드 산화막 성장','실리콘 트렌치 식각','NiSi 자기정렬 반응']){
      const i=E.route.findIndex(s=>s.name===name),before=snapshots[i],after=snapshots[i+1];
      let checked=0;
      before.columns.forEach((c,j)=>{
        const oldSi=c.find(l=>l.material==='Si')?.nm||0,newSi=after.columns[j].find(l=>l.material==='Si')?.nm||0,consumed=oldSi-newSi;
        if(consumed>1e-6&&newSi>50){const expected=E.dopingAt(before,j,50+consumed),actual=E.dopingAt(after,j,50);assert(Math.abs(actual-expected)/Math.max(1,Math.abs(expected))<1e-10,name+' column '+j);checked++;}
      });
      assert(checked>0,name);
      assert.equal(JSON.stringify(after.dopants.map(d=>d.surface)),JSON.stringify(before.dopants.map(d=>d.surface)));
    }
  });
  await test('Dopant sampling rejects invalid coordinates and excludes space outside silicon',()=>{
    assert.throws(()=>E.dopingAt(w,-1,50));assert.throws(()=>E.dopingAt(w,1.5,50));assert.throws(()=>E.dopingAt(w,0,NaN));
    assert.equal(E.dopingAt(w,0,-1),0);assert.equal(E.dopingAt(w,0,601),0);
    const empty=E.copy(w);empty.columns[0]=[{material:'SiO2',nm:20}];assert.equal(E.dopingAt(empty,0,5),0);
  });
  await test('Tungsten fill uses its own 430 C reference temperature and retains temperature sensitivity',()=>{
    for(const step of E.route.filter(s=>s.material==='W')){
      assert.equal(step.recipe.temperature,430);
      const before=snapshots[step.index],normal=E.execute(before).wafer,hotter=E.execute(before,{temperature:460}).wafer;
      const added=(after,j)=>after.columns[j].filter(l=>l.material==='W').reduce((sum,l)=>sum+l.nm,0)-before.columns[j].filter(l=>l.material==='W').reduce((sum,l)=>sum+l.nm,0);
      assert(Math.abs(added(normal,80)-step.rate*step.recipe.time)<step.rate*step.recipe.time*.01);
      assert(Math.abs(added(hotter,80)/added(normal,80)-Math.exp(30/180))<1e-10);
    }
    const metal=E.route.findIndex(s=>s.material==='Al');
    assert(E.route.slice(metal).every(s=>!('temperature' in s.recipe)||s.recipe.temperature<=450));
  });
  await test('Previous model histories are rejected instead of silently recomputed with new material ratios',()=>{
    const records=E.copy(w.records);records[0].modelVersion='wf-fab-0.5.0';assert.throws(()=>E.replay('legacy',records),/모델 버전/);
  });
  await test('Hot silicidation produces a model-limit notice without declaring a defect or changing the geometry',()=>{
    const step=E.route.find(s=>s.op==='silicide'),input=snapshots[step.index],normal=E.execute(input);
    for(const temperature of [600,1100]){
      const result=E.execute(input,{temperature}),notice=result.warnings.find(w=>w.code==='SILICIDE_MODEL_LIMIT');
      assert.equal(notice?.category,'model-limit');assert(notice.message.includes('표시 기준'));assert(notice.message.includes('불량 여부를 판정할 수 없습니다'));
      assert.equal(result.wafer.cursor,input.cursor+1);assert.equal(JSON.stringify(result.wafer.columns),JSON.stringify(normal.wafer.columns));
      assert.equal(result.wafer.records.at(-1).warnings[0].category,'model-limit');
      assert.equal(JSON.stringify(E.replay(result.wafer.id,result.wafer.records)),JSON.stringify(result.wafer));
    }
    for(const temperature of [450,599])assert(!E.execute(input,{temperature}).warnings.some(w=>w.code==='SILICIDE_MODEL_LIMIT'));
    assert(!E.process(input,step,{temperature:1100},0).warnings.some(w=>w.category==='model-limit'));
    const anneal=E.route.find(s=>s.op==='anneal');assert(!E.execute(snapshots[anneal.index],{temperature:1100}).warnings.some(w=>w.code==='SILICIDE_MODEL_LIMIT'));
  });
  await test('Shallow implant notice exposes the Gaussian surface tail while preserving the specified dose',()=>{
    const step=E.route.find(s=>s.species==='As'),input=snapshots[step.index],result=E.execute(input,{energy:5,dose:1e13,tilt:0}),notice=result.warnings.find(w=>w.code==='IMPLANT_SURFACE_TAIL');
    assert.equal(notice?.category,'model-limit');assert(notice.message.includes('실제 이온 손실을 예측한 값이 아니며'));
    const wafer=E.copy(result.wafer);wafer.dopants=wafer.dopants.slice(-1);const implant=wafer.dopants[0];implant.activation=1;
    assert.equal(implant.dose,1e13);assert.equal(implant.rp,4);assert.equal(implant.sigma,7);assert.equal(result.wafer.cursor,input.cursor+1);
    let integral=0;const dx=.02,column=25;
    for(let depth=dx/2;depth<600;depth+=dx)integral+=(E.dopingAt(wafer,column,depth)+1e15)*dx*1e-7;
    const retained=integral/(implant.dose*implant.transmission[column]);
    assert(retained>.715&&retained<.718,'The notice must not silently renormalize the Gaussian');
    assert(!E.execute(input).warnings.some(w=>w.code==='IMPLANT_SURFACE_TAIL'));
    assert(!E.process(input,step,{energy:5},0).warnings.some(w=>w.category==='model-limit'));
  });
  await test('Surface-tail notice follows the standardized profile boundary, not an arbitrary energy cutoff',()=>{
    const step=E.route.find(s=>s.species==='As'),input=snapshots[step.index];
    assert(E.execute(input,{energy:11,tilt:0}).warnings.some(w=>w.code==='IMPLANT_SURFACE_TAIL'));
    assert(!E.execute(input,{energy:12,tilt:0}).warnings.some(w=>w.code==='IMPLANT_SURFACE_TAIL'));
    const boron=E.route.find(s=>s.species==='B');assert(!E.execute(snapshots[boron.index],{energy:5,tilt:0}).warnings.some(w=>w.code==='IMPLANT_SURFACE_TAIL'));
    const strip=E.route.find(s=>s.op==='strip'),residue=E.execute(snapshots[strip.index],{time:20,power:100});
    assert.equal(residue.warnings.find(w=>w.code==='STRIP_INCOMPLETE')?.category,'process-result');
  });
  await test('Anneal broadening reports the same Gaussian surface limit without renormalizing implanted dose',()=>{
    const step=E.route.find(s=>s.id==='OP066'),input=snapshots[step.index],before=JSON.stringify(input),result=E.execute(input,{temperature:1000,time:60});
    const notice=result.warnings.find(w=>w.code==='IMPLANT_SURFACE_TAIL');assert.equal(notice?.category,'model-limit');assert(notice.message.includes('열처리로 넓어진'));assert(notice.message.includes('실제 이온 손실을 예측한 값이 아니며'));
    const index=input.dopants.findIndex(d=>d.species==='As'&&d.role==='extension'),old=input.dopants[index],profile=result.wafer.dopants[index];
    assert.equal(old.sigma,7);assert.equal(profile.sigma,11);assert.equal(profile.dose,old.dose);assert.equal(profile.rp,old.rp);
    assert.equal(JSON.stringify(profile.transmission),JSON.stringify(old.transmission));assert.equal(JSON.stringify(profile.surface),JSON.stringify(old.surface));
    assert.equal(JSON.stringify(result.wafer.columns),JSON.stringify(input.columns));assert.equal(JSON.stringify(input),before);
    const isolated=E.copy(result.wafer);isolated.dopants=[{...isolated.dopants[index],activation:1}];
    let integral=0;const dx=.02,column=25;
    for(let depth=dx/2;depth<600;depth+=dx)integral+=(E.dopingAt(isolated,column,depth)+1e15)*dx*1e-7;
    const retained=integral/(profile.dose*profile.transmission[column]);assert(retained>.8604&&retained<.8607,'Anneal must not turn the notice into a dose correction');
    assert.equal(JSON.stringify(E.replay(result.wafer.id,result.wafer.records)),JSON.stringify(result.wafer));
  });
  await test('Anneal surface-tail notices follow the diffusion boundary and exclude zero progress',()=>{
    const step=E.route.find(s=>s.id==='OP066'),input=snapshots[step.index],hasNotice=result=>result.warnings.some(w=>w.code==='IMPLANT_SURFACE_TAIL');
    for(const time of [20,31])assert(!hasNotice(E.process(input,step,{temperature:1000,time})),String(time));
    for(const time of [32,60,180])assert(hasNotice(E.process(input,step,{temperature:1000,time})),String(time));
    assert(hasNotice(E.process(input,step,{temperature:1100,time:180})));
    const zero=E.process(input,step,{temperature:1100,time:180},0);assert(!hasNotice(zero));assert.equal(JSON.stringify(zero.wafer.dopants),JSON.stringify(input.dopants));
    assert(!hasNotice(E.process(input,step,{temperature:1000,time:60},.5)));
    assert(hasNotice(E.process(input,step,{temperature:1000,time:60},.6)));
  });

  const storage=new Map(),downloads=[];let clock=0,frames=new Map(),fid=0;
  function mount(localStore=storage,scheduled=frames){const {document:d}=parseHTML(files['cmos-lab.html']);
    const fileInput=d.querySelector('#importFile'),listen=fileInput.addEventListener.bind(fileInput);fileInput.addEventListener=(type,listener,...options)=>{if(type==='change')fileInput.testChange=listener;listen(type,listener,...options);};
    const selectProto=Object.getPrototypeOf(d.querySelector('select'));Object.defineProperty(selectProto,'value',{get(){return this.testValue??this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??''},set(v){this.testValue=String(v)},configurable:true});
    for(const input of d.querySelectorAll('input[type="checkbox"]'))input.checked=input.hasAttribute('checked');
    for(const dialog of d.querySelectorAll('dialog')){dialog.showModal=function(){this.setAttribute('open','')};dialog.close=function(){this.removeAttribute('open')};}
    const events=new Map();
    const sandbox={document:d,console,Blob,URL:{createObjectURL(b){downloads.push(b);return 'blob:test'},revokeObjectURL(){}},localStorage:{getItem:k=>localStore.get(k)??null,setItem:(k,v)=>localStore.set(k,v)},setTimeout:(fn,ms)=>{if(ms===0)return setTimeout(fn,0);return 0;},clearTimeout(){},requestAnimationFrame:fn=>{scheduled.set(++fid,fn);return fid},cancelAnimationFrame:id=>scheduled.delete(id),performance:{now:()=>clock},addEventListener(name,fn){events.set(name,fn);},devicePixelRatio:1};sandbox.window=sandbox;
    sandbox.navigator={locks:{request:(_name,_options,write)=>write()}};
    const c=vm.createContext(sandbox);vm.runInContext(files['fab-engine.js'],c);vm.runInContext(files['fab-view.js'],c);vm.runInContext(files['fab-guide.js'],c);vm.runInContext(files['fab-observe.js'],c);vm.runInContext(files['fab-app.js'],c);
    const click=s=>{const el=d.querySelector(s);assert(el,s);assert(!el.disabled,s+' disabled');el.dispatchEvent(new Event('click',{bubbles:true}));};
    const input=(s,value)=>{const el=d.querySelector(s);el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));};
    const advance=n=>{for(let i=0;i<n;i++){clock+=100;const queue=[...scheduled.values()];scheduled.clear();queue.forEach(fn=>fn(clock));}};
    return {d,c,click,input,advance,events,app:c.FabApp};
  }
  let ui=mount();
  await test('Fab UI renders equipment, material section and all 117 routes without WebGL',()=>{assert.equal(ui.d.querySelectorAll('[data-step]').length,117);assert(ui.d.querySelector('#crossSection svg'));assert.equal(ui.d.querySelector('#operationName').textContent,'입고 웨이퍼 세정');assert(ui.d.querySelector('.webgl-fallback'));});
  await test('Route filters combine status with search and jump-to-current restores the full route',()=>{
    const data={schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,active:'FILTER',wafers:[{id:'FILTER',records:w.records.slice(0,5)}]};
    data.wafers[0].records[3]=E.copy(data.wafers[0].records[3]);data.wafers[0].records[3].fault='dose';
    const lab=mount(new Map([['waferflow-fab-'+E.VERSION,JSON.stringify(data)]]),new Map());
    const filter=value=>{lab.d.querySelector('#routeFilter').value=value;lab.d.querySelector('#routeFilter').dispatchEvent(new Event('change'));};
    filter('done');assert.equal(lab.d.querySelectorAll('[data-step]').length,5);
    lab.input('#routeSearch','PR');assert(lab.d.querySelectorAll('[data-step]').length<5);
    lab.input('#routeSearch','');filter('pending');assert.equal(lab.d.querySelectorAll('[data-step]').length,112);
    filter('warnings');assert(lab.d.querySelectorAll('[data-step]').length>0);
    lab.click('#jumpCurrent');assert.equal(lab.d.querySelector('#routeFilter').value,'all');assert.equal(lab.d.querySelectorAll('[data-step]').length,117);assert.equal(lab.app.snapshot().selected,5);
    lab.input('#routeSearch','no-such-process');assert(lab.d.querySelector('.route-no-results'));
  });
  await test('Previous and next browsing respect route boundaries and lock during a run',()=>{
    const lab=mount(new Map(),new Map());assert(lab.d.querySelector('#previousOperation').disabled);
    lab.click('#nextOperation');assert.equal(lab.app.snapshot().selected,1);lab.click('#previousOperation');assert.equal(lab.app.snapshot().selected,0);
    lab.app.select(116);assert(lab.d.querySelector('#nextOperation').disabled);lab.app.select(0);lab.click('#runButton');
    assert(lab.d.querySelector('#previousOperation').disabled);assert(lab.d.querySelector('#nextOperation').disabled);
    lab.click('#cancelRunButton');assert(!lab.d.querySelector('#nextOperation').disabled);
  });
  await test('Studio focus view changes only presentation and preserves recipe drafts and committed history',()=>{
    const lab=mount(new Map(),new Map());lab.input('#recipe-time',123);const snapshot=()=>{const s=lab.app.snapshot();delete s.exportedAt;return JSON.stringify(s);};const before=snapshot();
    lab.click('#focusStage');assert(lab.d.body.classList.contains('stage-focused'));assert.equal(lab.d.querySelector('#focusStage').getAttribute('aria-pressed'),'true');
    assert.equal(lab.d.querySelector('#recipe-time').value,'123');assert.equal(snapshot(),before);
    lab.click('#focusStage');assert(!lab.d.body.classList.contains('stage-focused'));assert.equal(snapshot(),before);
  });
  const settleFile=()=>new Promise(resolve=>setImmediate(resolve));
  const fileRecords=id=>JSON.stringify({schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,wafers:[{id,records:[]}]});
  // Invoke the actual listener with a persistent native-style target; LinkeDOM clears event targets after dispatch.
  const chooseFile=(lab,text)=>{const input=lab.d.querySelector('#importFile');Object.defineProperty(input,'files',{value:[{size:1024,text}],configurable:true});input.testChange({target:input});};
  await test('Only the latest selected CMOS file may merge records and activate its wafer',async()=>{
    const lab=mount(new Map(),new Map());let release;
    chooseFile(lab,()=>new Promise(resolve=>release=resolve));chooseFile(lab,async()=>fileRecords('LATEST'));await settleFile();
    assert.equal(lab.app.snapshot().active,'LATEST');release(fileRecords('OBSOLETE'));await settleFile();
    assert.equal(lab.app.snapshot().active,'LATEST');assert.deepEqual(Array.from(lab.app.snapshot().wafers,w=>w.id),['W01','LATEST']);
  });
  await test('CMOS file reads preserve edits, new previews and runs started while waiting',async()=>{
    for(const action of [lab=>lab.input('#recipe-time',120),lab=>lab.click('#previewButton'),lab=>lab.click('#runButton')]){
      const lab=mount(new Map(),new Map());let release;chooseFile(lab,()=>new Promise(resolve=>release=resolve));action(lab);
      const before=JSON.stringify(lab.app.snapshot().wafers);release(fileRecords('LATE'));await settleFile();assert.equal(lab.app.snapshot().active,'W01');assert.equal(JSON.stringify(lab.app.snapshot().wafers),before);
    }
  });
  await test('Late CMOS imports cannot redirect the experiment name form to a different wafer',async()=>{
    const lab=mount(new Map(),new Map());let release;chooseFile(lab,()=>new Promise(resolve=>release=resolve));lab.click('#editExperiment');lab.input('#experimentNameInput','원래 웨이퍼의 실험');
    release(fileRecords('OTHER'));await settleFile();assert(lab.d.querySelector('#experimentDialog').hasAttribute('open'));assert.equal(lab.app.snapshot().active,'W01');
    lab.d.querySelector('#experimentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));const data=lab.app.snapshot();assert.equal(data.wafers.length,1);assert.equal(data.wafers[0].title,'원래 웨이퍼의 실험');
  });
  await test('Invalid CMOS draft values still cancel a pending file import',async()=>{
    for(const value of ['',99999]){const lab=mount(new Map(),new Map());let release;chooseFile(lab,()=>new Promise(resolve=>release=resolve));lab.input('#recipe-time',value);
      release(fileRecords('OTHER'));await settleFile();assert.equal(lab.app.snapshot().active,'W01');assert.equal(lab.d.querySelector('#recipe-time').value,String(value));assert(lab.d.querySelector('#runFeedback').textContent);
    }
  });
  await test('Uncalculated CMOS sweep bounds cancel a pending file import',async()=>{
    const lab=mount(new Map(),new Map());lab.click('#tab-sweep');let release;chooseFile(lab,()=>new Promise(resolve=>release=resolve));lab.input('#sweepLow',100);lab.input('#sweepHigh',140);
    release(fileRecords('OTHER'));await settleFile();assert.equal(lab.app.snapshot().active,'W01');assert.equal(lab.d.querySelector('#sweepLow').value,'100');assert.equal(lab.d.querySelector('#sweepHigh').value,'140');
  });
  await test('An obsolete CMOS file error cannot replace a newer successful import message',async()=>{
    const lab=mount(new Map(),new Map());let reject;chooseFile(lab,()=>new Promise((_resolve,fail)=>reject=fail));chooseFile(lab,async()=>fileRecords('LATEST'));await settleFile();const message=lab.d.querySelector('#toast').textContent;
    reject(Error('obsolete file failed'));await settleFile();assert.equal(lab.d.querySelector('#toast').textContent,message);assert.equal(lab.app.snapshot().active,'LATEST');
  });
  await test('Observation mode pauses at exact handling landmarks even at high playback speed',()=>{ui.d.querySelector('#observeStops').checked=true;ui.d.querySelector('#speedSelect').value='8';ui.click('#runButton');ui.advance(2);assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');assert(Math.abs(parseFloat(ui.d.querySelector('#phaseProgress').style.width)-2)<1e-8);const stopped=ui.d.querySelector('#motionAction').textContent;ui.advance(80);assert.equal(ui.d.querySelector('#motionAction').textContent,stopped);assert.equal(ui.app.snapshot().wafers[0].records.length,0);ui.click('#stepMotionButton');ui.advance(4);assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');assert(Math.abs(parseFloat(ui.d.querySelector('#phaseProgress').style.width)-8)<1e-8);ui.input('#recipe-time',120);assert(ui.d.querySelector('#stepMotionButton').disabled);ui.input('#recipe-time',90);assert(!ui.d.querySelector('#stepMotionButton').disabled);ui.click('#cancelRunButton');ui.d.querySelector('#observeStops').checked=false;ui.d.querySelector('#speedSelect').value='1';});
  await test('Stepping a wet cycle preserves records until completion and chemical time freezes during rinse',()=>{ui.d.querySelector('#speedSelect').value='8';ui.d.querySelector('#observeStops').checked=true;ui.d.querySelector('#autoRun').checked=true;ui.click('#runButton');let steps=0,rinseTime=null;while(ui.app.snapshot().wafers[0].records.length===0&&steps<30){ui.advance(100);if(ui.app.snapshot().wafers[0].records.length)break;assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');const text=ui.d.querySelector('#motionAction').textContent;if(text.includes('린스조')||text.includes('남은 약액')){const time=ui.d.querySelector('#virtualTime').textContent;if(rinseTime)assert.equal(time,rinseTime);rinseTime=time;}ui.click('#stepMotionButton');steps++;}assert(rinseTime?.includes('1.5 min'));assert.equal(ui.app.snapshot().wafers[0].records.length,1);ui.advance(100);assert.equal(ui.app.snapshot().wafers[0].records.length,1);assert.equal(ui.d.querySelector('#runState').textContent,'기록 완료');ui.d.querySelector('#observeStops').checked=false;ui.d.querySelector('#autoRun').checked=false;ui.d.querySelector('#speedSelect').value='1';frames.clear();storage.clear();ui=mount();});
  await test('Playback checkpoints are ordered, bounded and share phase timing with reaction progress',()=>{for(const family of new Set(Object.values(E.tools).map(t=>t.family))){const v=ui.c.FabViewport,stops=v.observationStops(family),duration=v.playback(family,0).seconds;assert(stops.every((t,i)=>t>0&&t<=duration&&(!i||t>stops[i-1])));assert.equal(stops.at(-1),duration);for(const t of stops){const p=v.playback(family,t);assert(p.progress>=0&&p.progress<=1);assert(Number.isFinite(v.reactionProgress(family,p.phase,p.progress)));}assert.equal(v.reactionProgress(family,'load',1),0);assert.equal(v.reactionProgress(family,'unload',0),1);}assert.equal(ui.c.FabViewport.reactionProgress('wet','process',.55),1);assert.equal(ui.c.FabViewport.reactionProgress('wet','process',.95),1);});
  await test('Model information pauses processing and closing it does not silently resume',()=>{ui.click('#runButton');ui.advance(15);const progress=ui.d.querySelector('#phaseProgress').style.width;ui.click('#aboutButton');assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');assert.equal(ui.d.querySelector('#viewContext').textContent,'현재 공정 일시정지');ui.advance(100);assert.equal(ui.d.querySelector('#phaseProgress').style.width,progress);ui.click('#closeInfo');ui.advance(100);assert.equal(ui.d.querySelector('#phaseProgress').style.width,progress);assert.equal(ui.app.snapshot().wafers[0].records.length,0);ui.click('#cancelRunButton');});
  await test('Page-cache departure pauses CMOS playback until an explicit resume without committing hidden progress',()=>{
    ui.click('#runButton');ui.advance(15);const progress=ui.d.querySelector('#phaseProgress').style.width,records=JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records));
    ui.events.get('pagehide')({persisted:true});ui.advance(100);
    assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');assert.equal(ui.d.querySelector('#phaseProgress').style.width,progress);assert.equal(JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records)),records);
    ui.click('#runButton');ui.advance(2);assert.notEqual(ui.d.querySelector('#phaseProgress').style.width,progress);ui.click('#cancelRunButton');
  });
  await test('Scanning observation stops show all four aligned, contacting and released positions',()=>{const v=ui.c.FabViewport;for(const family of ['scanner','metrology','probe']){const stops=v.observationStops(family).map(t=>v.playback(family,t)).filter(p=>p.phase==='process'&&p.progress>1e-9);const poses=stops.map(p=>v.stageMotion(p.progress));assert.equal(poses.length,12);for(let i=0;i<4;i++){const [aligned,contact,released]=poses.slice(i*3,i*3+3);assert.equal(aligned.site,i+1);assert.equal(aligned.action,'settle');assert.equal(contact.action,'hold');assert.equal(released.action,'ready');assert.equal(aligned.contact,0);assert(contact.contact>.999999);assert.equal(released.contact,0);assert.equal(aligned.x,contact.x);assert.equal(contact.x,released.x);assert.equal(aligned.z,released.z);}}assert.equal(v.stageMotion(.95).action,'return');assert.equal(v.stageMotion(1).action,'home');});
  await test('Process play/pause commits exactly once and preserves executed conditions',()=>{ui.input('#recipe-time',120);ui.click('#runButton');ui.advance(15);ui.click('#runButton');ui.advance(80);assert.equal(ui.app.snapshot().wafers[0].records.length,0);ui.click('#runButton');ui.advance(240);assert.equal(ui.app.snapshot().wafers[0].records.length,1);assert.equal(ui.app.snapshot().wafers[0].records[0].recipe.time,120);ui.advance(80);assert.equal(ui.app.snapshot().wafers[0].records.length,1);});
  await test('Completed operation stays editable, before/after can be inspected, fork preserves original',()=>{assert(!ui.d.querySelector('#recipe-time').disabled);ui.click('#beforeButton');assert.equal(ui.d.querySelector('#beforeButton').getAttribute('aria-pressed'),'true');ui.click('#forkButton');const state=ui.app.snapshot();assert.equal(state.wafers.length,2);assert.equal(state.wafers[0].records.length,1);assert.equal(state.wafers[1].records.length,0);assert.equal(state.wafers[1].parent.id,'W01');assert(!ui.d.querySelector('#recipe-time').disabled);});
  await test('Jump-to-process executes actual upstream operations and opens matching tool',async()=>{const i=E.route.findIndex(s=>s.name==='폴리 게이트 패턴 식각');ui.app.select(i);assert(ui.d.querySelector('#runButton').disabled);await ui.app.advance();const s=ui.app.snapshot();assert.equal(s.wafers.find(w=>w.id===s.active).records.length,i);assert.equal(ui.d.querySelector('#toolTitle').textContent,E.tools.etch.english);assert(!ui.d.querySelector('#runButton').disabled);});
  await test('Recipe range errors are visible and interlocks preserve committed history',()=>{ui.input('#recipe-time',99999);assert(ui.d.querySelector('#runFeedback').textContent.includes('범위'));const count=ui.app.snapshot().wafers[1].records.length;ui.click('#runButton');assert.equal(ui.app.snapshot().wafers[1].records.length,count);ui.input('#recipe-time',75);ui.d.querySelector('#faultSelect').value='vacuum';ui.d.querySelector('#faultSelect').dispatchEvent(new Event('change',{bubbles:true}));ui.click('#runButton');assert.equal(ui.app.snapshot().wafers[1].records.length,count);assert(ui.d.querySelector('#runFeedback').textContent.includes('VACUUM'));});
  await test('JSON export contains replayable records and import merges without overwriting',async()=>{ui.click('#exportButton');const data=JSON.parse(await downloads.at(-1).text());assert.equal(data.schema,'waferflow-fab-history-v1');ui.app.importData(data);assert.equal(ui.app.snapshot().wafers.length,4);assert.equal(new Set(ui.app.snapshot().wafers.map(w=>w.id)).size,4);});
  await test('Import rejects forged history order and invalid parameters atomically',()=>{const before=JSON.stringify(ui.app.snapshot().wafers),bad=ui.app.snapshot();bad.wafers[0].records[0].stepId='OP999';assert.throws(()=>ui.app.importData(bad));assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);const invalid=ui.app.snapshot();invalid.wafers[0].records[0].recipe={};assert.throws(()=>ui.app.importData(invalid));});
  await test('CSV export contains actual records and recipe provenance',async()=>{ui.click('#csvButton');const csv=await downloads.at(-1).text();assert(csv.includes('topography_nm'));assert(csv.includes(E.VERSION));assert(csv.includes('OP001'));assert(csv.includes('120'));});
  await test('Reload reconstructs saved wafer history and equipment selection',()=>{const saved=ui.app.snapshot();frames.clear();ui=mount();assert.equal(JSON.stringify(ui.app.snapshot().wafers),JSON.stringify(saved.wafers));assert.equal(ui.app.snapshot().active,saved.active);});
  await test('Comparison aligns results at a common completed operation',()=>{ui.click('[data-tab="compare"]');assert(ui.d.querySelector('#comparePanel').textContent.includes('동일 공정 시점'));assert(ui.d.querySelector('#comparePanel table'));});
  await test('History selection displays recorded conditions in an editable draft; info dialog works',()=>{ui.click('[data-tab="history"]');ui.click('[data-history="0"]');assert.equal(ui.d.querySelector('#recipe-time').value,'120');assert(!ui.d.querySelector('#recipe-time').disabled);ui.click('#aboutButton');assert(ui.d.querySelector('#infoDialog').hasAttribute('open'));ui.click('#closeInfo');assert(!ui.d.querySelector('#infoDialog').hasAttribute('open'));});
  await test('Full-route import displays sampled measurement rows from the final process',()=>{const payload={schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,wafers:[{id:'FULL',records:w.records}]};ui.app.importData(payload);assert.equal(ui.d.querySelectorAll('.measurement-details tbody tr').length,49);assert(ui.d.querySelector('.measurement-details summary').textContent.includes('표본 표준편차'));});
  await test('Continuous execution advances operations and stops at the completed route',async()=>{ui.click('#newWafer');ui.app.select(E.route.length-2);await ui.app.advance();ui.d.querySelector('#autoRun').checked=true;ui.d.querySelector('#speedSelect').value='8';ui.click('#runButton');ui.advance(40);const s=ui.app.snapshot();assert.equal(s.wafers.find(w=>w.id===s.active).records.length,117);assert.equal(ui.d.querySelector('#runState').textContent,'기록 완료');});
  await test('Equipment descriptions cover all tools, current process, parameters and sources without changing records',()=>{const records=JSON.stringify(ui.app.snapshot().wafers);for(const tool of Object.keys(E.tools)){const step=E.route.find(s=>s.tool===tool);ui.app.select(step.index);ui.click('#equipmentHelpButton');const dialog=ui.d.querySelector('#equipmentDialog');assert(dialog.hasAttribute('open'));assert.equal(ui.d.querySelector('#equipmentDialogTitle').textContent,E.tools[tool].name);assert(ui.d.querySelector('#equipmentDialogBody').textContent.includes(step.name));assert.equal(ui.d.querySelectorAll('.guide-steps li').length,3);assert.equal(ui.d.querySelectorAll('.guide-parts article').length,3);assert.equal(ui.d.querySelectorAll('.guide-parameters>div').length,Object.keys(E.tools[tool].fields).length);assert(ui.d.querySelector('.guide-references a').href.startsWith('https://'));assert(!ui.d.querySelector('#equipmentDialogBody').textContent.includes('undefined'));ui.click('#equipmentDialogDone');assert(!dialog.hasAttribute('open'));}assert.equal(JSON.stringify(ui.app.snapshot().wafers),records);});
  await test('Reading equipment help pauses an active process until explicit resume',()=>{ui.click('#newWafer');ui.d.querySelector('#autoRun').checked=false;ui.d.querySelector('#speedSelect').value='1';ui.input('#recipe-time',135);ui.click('#runButton');ui.advance(12);ui.click('#equipmentHelpButton');assert(ui.d.querySelector('#equipmentDialogBody').textContent.includes('135'));assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');assert(ui.d.querySelector('#equipmentDialogStatus').textContent.includes('일시 정지'));ui.advance(80);ui.click('#closeEquipmentDialog');ui.advance(80);let state=ui.app.snapshot();assert.equal(state.wafers.find(w=>w.id===state.active).records.length,0);ui.click('#runButton');ui.advance(230);state=ui.app.snapshot();assert.equal(state.wafers.find(w=>w.id===state.active).records.length,1);});
  await test('Editing a completed recipe preserves original evidence and runs a new branch with the changed value',()=>{const original=ui.app.snapshot(),source=original.wafers.find(w=>w.id===original.active),records=JSON.stringify(source.records),input=ui.d.querySelector('#recipe-time');ui.input('#recipe-time','');assert(!input.disabled);ui.input('#recipe-time',240);assert.equal(ui.d.querySelector('#recipe-time'),input);assert.equal(ui.d.querySelector('#recipe-time').value,'240');assert(ui.d.querySelector('#runButton').textContent.includes('새 실험'));assert.equal(JSON.stringify(ui.app.snapshot().wafers.find(w=>w.id===source.id).records),records);ui.click('#runButton');ui.advance(240);const result=ui.app.snapshot(),branch=result.wafers.find(w=>w.id===result.active);assert.notEqual(branch.id,source.id);assert.equal(branch.parent.id,source.id);assert.equal(ui.d.querySelector('#compareSelect').value,source.id);assert.equal(branch.records[0].recipe.time,240);assert.equal(JSON.stringify(result.wafers.find(w=>w.id===source.id).records),records);});
  await test('Completed recipe edits restore their original values or survive a reload without overwriting evidence',()=>{ui.input('#recipe-time',200);ui.click('#restoreRecordButton');assert.equal(ui.d.querySelector('#recipe-time').value,'240');ui.input('#recipe-time',260);const saved=ui.app.snapshot();frames.clear();ui=mount();assert.equal(ui.d.querySelector('#recipe-time').value,'260');assert(!ui.d.querySelector('#recipe-time').disabled);assert.equal(ui.app.snapshot().wafers.find(w=>w.id===saved.active).records[0].recipe.time,240);});
  await test('Paused recipe edits restart from the committed wafer and commit only the new settings',()=>{ui.click('#newWafer');ui.click('#runButton');ui.advance(35);assert(ui.d.querySelector('#recipe-time').disabled);ui.click('#runButton');assert(!ui.d.querySelector('#recipe-time').disabled);ui.input('#recipe-time','');ui.click('#runButton');assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');ui.input('#recipe-time',210);assert(ui.d.querySelector('#runButton').textContent.includes('다시 시작'));ui.click('#runButton');ui.advance(240);const s=ui.app.snapshot(),wafer=s.wafers.find(w=>w.id===s.active);assert.equal(wafer.records.length,1);assert.equal(wafer.records[0].recipe.time,210);assert.equal(wafer.records[0].seconds,210);});
  await test('Preview computes new conditions without advancing or overwriting the wafer and clears when edited',()=>{const original=ui.app.snapshot(),records=JSON.stringify(original.wafers.map(w=>w.records));ui.app.select(1);ui.input('#recipe-rpm',4000);ui.click('#previewButton');assert(ui.d.querySelector('#sectionStatus').textContent.includes('미리 계산'));assert(ui.d.querySelector('#viewContext').textContent.includes('미리 계산 결과'));assert(ui.d.querySelector('#materialLegend').textContent.includes('PR'));assert(!ui.d.querySelector('#beforeButton').disabled);assert.equal(JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records)),records);ui.click('#beforeButton');assert(!ui.d.querySelector('#materialLegend').textContent.includes('PR'));ui.input('#recipe-rpm',3500);assert(!ui.d.querySelector('#sectionStatus').textContent.includes('미리 계산'));assert(!ui.d.querySelector('.preview-result-note'));});
  await test('Condition sweep recomputes independent recipes from one input wafer and exports its provenance',async()=>{ui.click('[data-tab="sweep"]');const before=JSON.stringify(ui.app.snapshot().wafers);ui.d.querySelector('#sweepLow').value='2000';ui.d.querySelector('#sweepHigh').value='4000';ui.click('#sweepRun');assert.equal(ui.d.querySelectorAll('[data-sweep-row]').length,5);ui.click('#exportSweep');const output=JSON.parse(await downloads.at(-1).text());assert.equal(output.schema,'waferflow-fab-sweep-v1');assert.equal(output.stepId,'OP002');assert.equal(output.field,'rpm');assert.equal(output.inputHistory.length,1);const input=E.replay(output.waferId,output.inputHistory);for(const row of output.rows){const result=E.process(input,E.route[1],row.recipe,1,output.fault);assert.equal(row.measure.value,result.metrics.films.PR.mean);}assert(output.rows[0].measure.value>output.rows.at(-1).measure.value);assert.equal(JSON.stringify(ui.app.snapshot().wafers),before);ui.click('[data-sweep-row="4"]');assert.equal(ui.d.querySelector('#recipe-rpm').value,'4000');assert(ui.d.querySelector('#sweepPanel').textContent.includes('OP002'));});
  await test('Sweep rejects reversed bounds and future-process preview is unavailable until upstream execution',()=>{ui.d.querySelector('#sweepLow').value='4500';ui.d.querySelector('#sweepHigh').value='2000';ui.click('#sweepRun');assert(ui.d.querySelector('#sweepHint').textContent.includes('시작값'));ui.app.select(10);assert(ui.d.querySelector('#previewButton').disabled);assert(ui.d.querySelector('#sweepRun').disabled);});
  await test('Sweep respects both the requested interval and supported parameter spacing',async()=>{ui.app.select(1);ui.click('[data-tab="sweep"]');ui.d.querySelector('#sweepLow').value='2050';ui.d.querySelector('#sweepHigh').value='4090';ui.click('#sweepRun');ui.click('#exportSweep');const output=JSON.parse(await downloads.at(-1).text());assert.equal(output.rows.length,5);for(const row of output.rows){assert(row.value>=2050&&row.value<=4090);assert.equal(row.value%100,0);}ui.d.querySelector('#sweepLow').value='2001';ui.d.querySelector('#sweepHigh').value='2099';ui.click('#sweepRun');assert.equal(ui.d.querySelectorAll('[data-sweep-row]').length,0);assert(ui.d.querySelector('#sweepHint').textContent.includes('입력 간격'));});
  await test('Cancelling an unfinished operation preserves committed history and editable draft while stopping auto-run',()=>{ui.app.select(1);ui.input('#recipe-rpm',3800);const original=JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records));ui.d.querySelector('#autoRun').checked=true;ui.click('#runButton');ui.advance(35);assert(!ui.d.querySelector('#cancelRunButton').hidden);ui.click('#cancelRunButton');ui.advance(80);assert.equal(JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records)),original);assert.equal(ui.d.querySelector('#recipe-rpm').value,'3800');assert(!ui.d.querySelector('#recipe-rpm').disabled);assert(!ui.d.querySelector('#autoRun').checked);assert(ui.d.querySelector('#cancelRunButton').hidden);ui.app.select(2);assert(ui.d.querySelector('#operationName').textContent.includes('소프트베이크'));});

  await test('Branch comparison aligns a chosen stage, traces executed recipe differences and exports reproducible profiles',async()=>{
    const start=E.execute(E.createWafer()).wafer,left=E.execute(start,{rpm:2000}).wafer,right=E.execute(start,{rpm:4000}).wafer;
    ui.app.importData({schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,wafers:[{id:'COMPARE_A',records:left.records},{id:'COMPARE_B',records:right.records}]});
    ui.click('[data-tab="compare"]');ui.d.querySelector('#compareSelect').value='COMPARE_B';ui.d.querySelector('#compareSelect').dispatchEvent(new Event('change',{bubbles:true}));
    assert.equal(ui.d.querySelectorAll('.comparison-differences tbody tr').length,1);assert(!ui.d.querySelector('.compare-chart').outerHTML.includes('NaN'));
    ui.app.select(1);ui.input('#recipe-rpm',4500);ui.click('#exportComparison');const output=JSON.parse(await downloads.at(-1).text());
    assert.equal(output.schema,'waferflow-fab-comparison-v1');assert.equal(output.completedOperations,2);assert.equal(output.differences.length,1);assert.equal(output.differences[0].current,2000);assert.equal(output.differences[0].reference,4000);
    const a=E.replay(output.reference.waferId,output.reference.records),b=E.replay(output.current.waferId,output.current.records);
    assert.equal(output.profile.length,E.NX);output.profile.forEach((p,i)=>{assert.equal(p.reference_nm,E.height(a.columns[i]));assert.equal(p.current_nm,E.height(b.columns[i]));});
    ui.d.querySelector('#compareOperation').value='1';ui.d.querySelector('#compareOperation').dispatchEvent(new Event('change',{bubbles:true}));ui.click('#exportComparison');const earlier=JSON.parse(await downloads.at(-1).text());
    assert.equal(earlier.completedOperations,1);assert.equal(earlier.differences.length,0);assert.equal(earlier.reference.records.length,1);assert(earlier.profile.every(p=>p.current_nm===p.reference_nm));
  });

  await test('Bulk upstream calculation can stop at a saved checkpoint and resume from committed progress',async()=>{
    ui.click('#newWafer');ui.app.select(40);const promise=ui.app.advance();assert(!ui.d.querySelector('#cancelRunButton').hidden);ui.click('#cancelRunButton');await promise;
    let data=ui.app.snapshot(),wafer=data.wafers.find(w=>w.id===data.active);assert(wafer.records.length>0&&wafer.records.length<40);assert.equal(data.selected,wafer.records.length);assert(ui.d.querySelector('#runFeedback').textContent.includes('중단'));
    const recorded=JSON.stringify(wafer.records);ui.app.select(40);await ui.app.advance();data=ui.app.snapshot();wafer=data.wafers.find(w=>w.id===data.active);assert.equal(wafer.records.length,40);assert.equal(JSON.stringify(wafer.records.slice(0,JSON.parse(recorded).length)),recorded);
  });
  await test('Hiding the page pauses a running operation until explicitly resumed',()=>{
    ui.d.querySelector('#speedSelect').value='1';ui.click('#runButton');ui.advance(20);Object.defineProperty(ui.d,'hidden',{value:true,configurable:true});ui.d.dispatchEvent(new Event('visibilitychange'));assert.equal(ui.d.querySelector('#runState').textContent,'일시정지');
    Object.defineProperty(ui.d,'hidden',{value:false,configurable:true});ui.d.dispatchEvent(new Event('visibilitychange'));ui.advance(90);let data=ui.app.snapshot();assert.equal(data.wafers.find(w=>w.id===data.active).records.length,40);ui.click('#runButton');ui.advance(240);data=ui.app.snapshot();assert.equal(data.wafers.find(w=>w.id===data.active).records.length,41);
  });

  await test('Experiment notes survive reload and export without altering results or injecting markup',async()=>{
    const before=JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records));ui.click('#editExperiment');assert(ui.d.querySelector('#experimentDialog').hasAttribute('open'));
    ui.input('#experimentNameInput','<img src=x onerror=alert(1)> 비교');ui.input('#experimentNoteInput','=SUM(1,2)\n관찰: 원본 조건 유지');ui.d.querySelector('#experimentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    assert(!ui.d.querySelector('#experimentDialog').hasAttribute('open'));assert(!ui.d.querySelector('#experimentTitle img'));assert(ui.d.querySelector('#experimentTitle').textContent.includes('<img'));
    let data=ui.app.snapshot(),wafer=data.wafers.find(w=>w.id===data.active);assert.equal(wafer.note,'=SUM(1,2)\n관찰: 원본 조건 유지');assert.equal(JSON.stringify(data.wafers.map(w=>w.records)),before);
    ui.click('#csvButton');const csv=await downloads.at(-1).text();assert(csv.includes('experiment_title'));assert(csv.includes("'=SUM(1,2)"));frames.clear();ui=mount();data=ui.app.snapshot();assert.equal(data.wafers.find(w=>w.id===data.active).note,wafer.note);
    const invalid=ui.app.snapshot();invalid.wafers[0].title={html:'<b>bad</b>'};const original=JSON.stringify(ui.app.snapshot().wafers);assert.throws(()=>ui.app.importData(invalid));assert.equal(JSON.stringify(ui.app.snapshot().wafers),original);
    const imported=JSON.parse(JSON.stringify(wafer));imported.id='CSV_GUARD';imported.note=' \t=1+1\n관찰: 원본 조건 유지';ui.app.importData({schema:'waferflow-fab-history-v1',modelVersion:E.VERSION,wafers:[imported]});ui.click('#csvButton');assert((await downloads.at(-1).text()).includes("' \t=1+1"));
  });

  await test('Invalid recipe fields identify their own error and corrections preserve committed records',()=>{
    ui.app.select(1);const before=JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records));ui.input('#recipe-rpm','');assert.equal(ui.d.querySelector('#recipe-rpm').getAttribute('aria-invalid'),'true');assert(!ui.d.querySelector('#recipe-error-rpm').hidden);assert(ui.d.querySelector('#recipe-error-rpm').textContent.includes('입력'));
    ui.input('#recipe-rpm',99999);assert.equal(ui.d.querySelector('#recipe-rpm').getAttribute('aria-invalid'),'true');assert(ui.d.querySelector('#recipe-error-rpm').textContent.includes('범위'));
    ui.input('#recipe-rpm',3000);assert.equal(ui.d.querySelector('#recipe-rpm').getAttribute('aria-invalid'),'false');assert(ui.d.querySelector('#recipe-error-rpm').hidden);assert.equal(JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records)),before);
  });

  await test('Result tabs support keyboard navigation and route search can return to the actual next operation',()=>{
    ui.click('[data-tab="metrics"]');const key=new Event('keydown',{bubbles:true,cancelable:true});key.key='End';ui.d.querySelector('#tab-metrics').dispatchEvent(key);
    assert.equal(ui.d.querySelector('#tab-compare').getAttribute('aria-selected'),'true');assert(!ui.d.querySelector('#comparePanel').hidden);assert(ui.d.querySelector('#metricsPanel').hidden);assert.equal(ui.d.querySelector('#comparePanel').getAttribute('aria-labelledby'),'tab-compare');
    ui.input('#routeSearch','NO_MATCH_999');assert(ui.d.querySelector('.route-no-results'));ui.click('#jumpCurrent');const data=ui.app.snapshot();assert.equal(data.selected,data.wafers.find(w=>w.id===data.active).records.length);assert.equal(ui.d.querySelector('#routeSearch').value,'');assert.equal(ui.d.querySelectorAll('[data-step]').length,117);
  });

  await test('Standalone report includes the complete committed experiment, escaped notes and units while excluding draft values',async()=>{
    const snapshot=ui.app.snapshot(),wafer=snapshot.wafers.find(w=>w.id===snapshot.active);ui.app.select(1);ui.input('#recipe-rpm',4300);ui.click('#previewButton');ui.click('#reportButton');const html=await downloads.at(-1).text(),report=parseHTML(html).document;
    assert.equal(report.querySelectorAll('.history tbody tr').length,wafer.records.length);assert.equal(report.querySelectorAll('script,img,iframe').length,0);assert(report.querySelector('h1').textContent.includes('<img'));assert(report.querySelector('.memo').textContent.includes('관찰: 원본 조건 유지'));
    assert(report.querySelector('.history').textContent.includes('rpm'));assert(!report.querySelector('.history').textContent.includes('4,300'));assert(!html.includes('NaN'));assert(report.querySelector('footer').textContent.includes('JSON'));
    assert.equal(JSON.stringify(ui.app.snapshot().wafers.map(w=>w.records)),JSON.stringify(snapshot.wafers.map(w=>w.records)));
  });

  await test('Per-operation changes use committed before/after data for every reference operation',()=>{
    ui.d.querySelector('#waferSelect').value='FULL';ui.d.querySelector('#waferSelect').dispatchEvent(new Event('change',{bubbles:true}));
    for(const step of E.route){ui.app.select(step.index);const values=['before','after','delta'].map(k=>Number(ui.d.querySelector(`[data-change="${k}"]`).dataset.value));assert(values.every(Number.isFinite),step.id);assert(Math.abs(values[1]-values[0]-values[2])<1e-6,step.id);assert(ui.d.querySelector('.process-change-heading').textContent.includes('완료 기록'));}
    ui.app.select(0);assert.equal(Number(ui.d.querySelector('[data-change="before"]').dataset.value),100);assert(Number(ui.d.querySelector('[data-change="after"]').dataset.value)<10);const completed=ui.d.querySelector('[data-change="after"]').dataset.value;ui.input('#recipe-time',10);assert.equal(ui.d.querySelector('[data-change="after"]').dataset.value,completed);ui.click('#previewButton');assert(ui.d.querySelector('.process-change-heading').textContent.includes('예상 결과'));assert(Number(ui.d.querySelector('[data-change="after"]').dataset.value)>Number(completed));ui.click('#beforeButton');assert.equal(Number(ui.d.querySelector('[data-change="before"]').dataset.value),100);assert.equal(ui.app.snapshot().wafers.find(w=>w.id==='FULL').records.length,117);
    for(const step of E.route.filter(s=>s.op==='implant')){ui.app.select(step.index);assert.equal(Number(ui.d.querySelector('[data-change="before"]').dataset.value),0);const d=snapshots[step.index+1].dopants.at(-1),expected=d.dose*d.transmission.reduce((a,b)=>a+b,0)/E.NX;assert(Math.abs(Number(ui.d.querySelector('[data-change="after"]').dataset.value)-expected)<1);}
  });
  await test('Expanded measurement rows remain open when inspecting another cross-section position',()=>{ui.app.select(E.route.length-1);const details=ui.d.querySelector('.measurement-details');details.setAttribute('open','');const key=new Event('keydown',{bubbles:true,cancelable:true});key.key='ArrowRight';ui.d.querySelector('#crossSection').dispatchEvent(key);assert(ui.d.querySelector('.measurement-details').hasAttribute('open'));ui.app.select(0);assert(!ui.d.querySelector('.measurement-details'));});
  await test('Sweep keeps its calculation conditions visible and marks changed drafts without changing results',async()=>{ui.app.select(1);ui.click('[data-tab="sweep"]');ui.d.querySelector('#sweepLow').value='2000';ui.d.querySelector('#sweepHigh').value='4000';ui.click('#sweepRun');assert(!ui.d.querySelector('#sweepDraftNotice').classList.contains('stale'));assert(ui.d.querySelector('#sweepResults').textContent.includes('계산 당시 고정 조건'));ui.click('#exportSweep');const original=await downloads.at(-1).text();ui.input('#recipe-time',50);assert(ui.d.querySelector('#sweepDraftNotice').classList.contains('stale'));ui.click('#exportSweep');assert.equal(await downloads.at(-1).text(),original);ui.click('#sweepRun');assert(!ui.d.querySelector('#sweepDraftNotice').classList.contains('stale'));assert(ui.d.querySelector('#sweepResults').textContent.includes('50 s'));});

  // Real Three.js geometries with only the renderer/canvas drawing stubbed: no GPU/visual claims.
  const d=ui.d,c=ui.c,create=d.createElement.bind(d);d.createElement=tag=>{const el=create(tag);if(tag==='canvas'){const gradient={addColorStop(){}};el.getContext=()=>({fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},fill(){},stroke(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient});el.setPointerCapture=()=>{};}return el;};
  c.ResizeObserver=class{constructor(fn){this.fn=fn}observe(){this.fn()}disconnect(){}};
  c.AbortController=class{constructor(){this.signal={aborted:false}}abort(){this.signal.aborted=true}};
  vm.runInContext(files['vendor/three.js'],c);class Renderer{constructor(){this.domElement=d.createElement('canvas');this.shadowMap={}}setPixelRatio(){}setClearColor(){}setSize(){}render(){}dispose(){}}c.THREE.WebGLRenderer=Renderer;
  vm.runInContext(files['equipment-detail.js'],c);vm.runInContext(files['fab-view.js'],c);
  const host=d.querySelector('#fabViewport');Object.defineProperty(host,'clientWidth',{value:1100});Object.defineProperty(host,'clientHeight',{value:500});const inspections=[],contextLosses=[],viewport=c.FabViewport.mount(host,{onInspect:step=>inspections.push(step.id),onContextLoss:()=>contextLosses.push('lost')});
  await test('All 18 equipment scenes mount and contain finite geometry and transforms',()=>{for(const tool of Object.keys(E.tools)){const s=E.route.find(s=>s.tool===tool);viewport.select(s);viewport.update({wafer:snapshots[s.index],running:true,phase:'process',progress:.5});ui.advance(2);assert.equal(viewport.parts().length,3);viewport.scene.traverse(o=>{assert([o.position.x,o.position.y,o.position.z].every(Number.isFinite));if(o.geometry?.attributes.position)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});}});
  await test('Implant and CMP use vertical and face-down wafer orientations',()=>{viewport.select(E.route.find(s=>s.tool==='implant'));viewport.update({wafer:w,running:false,phase:'process',progress:.5});ui.advance(2);assert(new c.THREE.Vector3(0,1,0).applyEuler(viewport.wafer.rotation).x<-.999);viewport.select(E.route.find(s=>s.tool==='cmp'));viewport.update({wafer:w,running:false,phase:'process',progress:.5});ui.advance(2);assert(new c.THREE.Vector3(0,1,0).applyEuler(viewport.wafer.rotation).y<-.999);});
  await test('Real equipment raycast opens help; rotation drags and empty floor clicks do not',()=>{viewport.select(E.route.find(s=>s.tool==='cmp'));viewport.update({wafer:w,running:false,phase:'process',progress:.5});ui.advance(80);viewport.scene.updateMatrixWorld(true);viewport.viewCamera.updateMatrixWorld(true);const canvas=viewport.renderer.domElement;canvas.getBoundingClientRect=()=>({left:0,top:0,width:1100,height:500});const point=new c.THREE.Vector3(0,.8,1.68).project(viewport.viewCamera),x=(point.x+1)*550,y=(1-point.y)*250;const emit=(name,props)=>{const event=new Event(name,{bubbles:true});Object.assign(event,{pointerId:1,button:0,isPrimary:true},props);canvas.dispatchEvent(event);};const tap=(px,py)=>{emit('pointerdown',{clientX:px,clientY:py});emit('pointerup',{clientX:px,clientY:py});};tap(x,y);assert.equal(inspections.length,1);emit('pointerdown',{clientX:x,clientY:y});emit('pointermove',{clientX:x+60,clientY:y});emit('pointermove',{clientX:x,clientY:y});emit('pointerup',{clientX:x,clientY:y});assert.equal(inspections.length,1);tap(1099,1);assert.equal(inspections.length,1);emit('pointerdown',{clientX:x,clientY:y});emit('pointercancel',{});emit('pointerup',{clientX:x,clientY:y});assert.equal(inspections.length,1);emit('keydown',{key:'Enter',repeat:false});assert.equal(inspections.length,2);emit('keydown',{key:'Enter',repeat:true});assert.equal(inspections.length,2);});
  await test('Handling curves join continuously and pause freezes moving equipment',()=>{const curves=c.FabViewport.motion;for(const [a,b] of [['idle','load'],['load','condition'],['condition','process'],['process','unload'],['unload','idle']]){const end=curves(a,a==='idle'?0:1),start=curves(b,0);for(const k of ['travel','rise','lower','orientation','closed','nozzle','processing'])assert(Math.abs(end[k]-start[k])<1e-9,a+' to '+b+' '+k);}for(const p of [0,.01,.5,.99,1])for(const value of Object.values(curves('load',p)))assert(Number.isFinite(value)&&value>=0&&value<=1);viewport.select(E.route.find(s=>s.tool==='coat'));viewport.update({wafer:w,running:true,phase:'process',progress:.4,speed:1});ui.advance(3);viewport.update({wafer:w,running:false,phase:'process',progress:.4,speed:1});ui.advance(1);const position=viewport.wafer.position.clone(),rotation=viewport.wafer.rotation.clone();ui.advance(20);assert.equal(viewport.wafer.position.distanceTo(position),0);assert.equal(viewport.wafer.rotation.y,rotation.y);});
  await test('Wafer transport has smooth departure/arrival and returns to the same load port',()=>{viewport.select(E.route.find(s=>s.tool==='implant'));const pose=(phase,p)=>{viewport.update({wafer:w,running:false,phase,progress:p});ui.advance(1);return viewport.wafer.position.clone();};const home=pose('idle',0),early=pose('load',.001),start=pose('load',0);assert(home.distanceTo(start)<1e-9);assert(early.distanceTo(start)<.0001);const seated=pose('load',1),nearly=pose('load',.999);assert(seated.distanceTo(nearly)<.0001);assert(seated.distanceTo(pose('condition',0))<1e-9);assert(seated.distanceTo(pose('unload',0))<1e-9);assert(home.distanceTo(pose('unload',1))<1e-9);});
  await test('Exposure and probe stage hold still during contact and move only between sites',()=>{const sample=c.FabViewport.stageMotion;for(let i=0;i<4;i++){const a=sample(i*.225+.225*.55),b=sample(i*.225+.225*.72);assert.equal(a.x,b.x);assert.equal(a.z,b.z);assert(a.contact>.99&&b.contact>.99);const moving=sample(i*.225+.225*.15);assert.equal(moving.contact,0);}const end=sample(1);assert(Math.abs(end.x)<1e-12);assert(Math.abs(end.z)<1e-12);assert.equal(end.contact,0);});
  await test('Reopening the same equipment preserves geometry and camera instead of rebuilding it',()=>{const step=E.route.find(s=>s.tool==='scanner');viewport.select(step);const children=[...viewport.scene.children];viewport.camera('top');ui.advance(60);const position=viewport.viewCamera.position.clone();viewport.select(step);ui.advance(1);assert(children.every((o,i)=>o===viewport.scene.children[i]));assert(viewport.viewCamera.position.distanceTo(position)<.01);});
  await test('Equipment camera and cutaway modes can switch without corrupting scene',()=>{for(const mode of ['equipment','top','wafer',0,1,2]){viewport.camera(mode);viewport.cutaway(false);ui.advance(3);viewport.cutaway(true);}assert(viewport.scene.environment.isDataTexture);});
  await test('CMP wafer rotates with the carrier, freezes on pause and handles context loss without dropping the scene',()=>{
    viewport.select(E.route.find(s=>s.tool==='cmp'));viewport.update({wafer:w,running:true,phase:'process',progress:.5,speed:1});ui.advance(2);const initial=viewport.wafer.rotation.y;ui.advance(3);assert.notEqual(viewport.wafer.rotation.y,initial);
    viewport.update({wafer:w,running:false,phase:'process',progress:.5,speed:1});ui.advance(1);const stopped=viewport.wafer.rotation.y;ui.advance(5);assert.equal(viewport.wafer.rotation.y,stopped);
    const canvas=viewport.renderer.domElement;canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert.equal(contextLosses.length,1);assert(host.querySelector('.webgl-recovery'));viewport.update({wafer:w,running:true,phase:'process',progress:.5,speed:1});ui.advance(5);assert.equal(viewport.wafer.rotation.y,stopped);
    canvas.dispatchEvent(new Event('webglcontextrestored'));assert(!host.querySelector('.webgl-recovery'));ui.advance(3);assert.notEqual(viewport.wafer.rotation.y,stopped);
  });
  const pose=(tool,phase,progress)=>{viewport.select(E.route.find(s=>s.tool===tool));viewport.update({wafer:w,running:false,phase,progress});ui.advance(1);viewport.scene.updateMatrixWorld(true);return viewport.wafer.position.clone();};
  await test('All equipment uses one occupied FOUP slot with matching wafer diameter and no duplicate',()=>{for(const tool of Object.keys(E.tools)){pose(tool,'idle',0);const f=viewport.scene.getObjectByName('foup'),stored=[];f.traverse(o=>{if(o.name.startsWith('stored-wafer-'))stored.push(o);});assert.equal(stored.length,9);assert(!f.getObjectByName('stored-wafer-5'));const local=f.worldToLocal(viewport.wafer.getWorldPosition(new c.THREE.Vector3()));assert(Math.abs(local.y-2.05)<1e-9);assert(Math.abs(local.x)+Math.abs(local.z)<1e-9);assert(stored.every(o=>o.geometry.parameters.radiusTop===.75));const start=viewport.wafer.position.clone();pose(tool,'load',.28);assert.equal(viewport.wafer.position.x,start.x);assert(viewport.wafer.position.z>start.z);}});
  await test('Wafer and robot poses are continuous at every phase handoff for all tools',()=>{for(const tool of Object.keys(E.tools))for(const[a,b]of [['idle','load'],['load','condition'],['condition','process'],['process','unload'],['unload','idle']]){const end=pose(tool,a,a==='idle'?0:1),arm=viewport.scene.getObjectByName('transfer-gripper').position.clone();const start=pose(tool,b,0);assert(end.distanceTo(start)<1e-8,tool+' wafer '+a+' '+b);assert(arm.distanceTo(viewport.scene.getObjectByName('transfer-gripper').position)<1e-8,tool+' robot '+a+' '+b);}});
  await test('Covers wait for robot withdrawal and open before retrieval',()=>{for(const tool of ['bake','rtp','etch','ald','implant']){pose(tool,'condition',.5);const lid=viewport.scene.getObjectByName('thermal-cover'),gate=viewport.scene.getObjectByName('chamber-gate');if(lid)assert.equal(lid.position.y,2.75);if(gate)assert.equal(gate.position.y,.55);const doorNow=viewport.scene.getObjectByName('implant-transfer-door');if(doorNow)assert.equal(doorNow.position.x,-.85);pose(tool,'unload',.1);if(lid)assert.equal(lid.position.y,2.75);if(gate)assert.equal(gate.position.y,.55);}});
  await test('RTP lamps travel with their supported cover instead of staying behind',()=>{pose('rtp','condition',0);const cover=viewport.scene.getObjectByName('thermal-cover'),lamp=viewport.scene.getObjectByName('rtp-lamp'),before=lamp.getWorldPosition(new c.THREE.Vector3()).y;assert.equal(lamp.parent,cover);pose('rtp','condition',1);assert(Math.abs(before-lamp.getWorldPosition(new c.THREE.Vector3()).y-.66)<1e-9);assert.equal(viewport.scene.getObjectsByProperty('name','cover-lift-rod').length,2);});
  await test('Furnace boat, wet carrier and CMP head keep their wafer attached during the work stroke',()=>{for(const[tool,name,stroke]of [['oxidation','furnace-boat',1.7],['cmp','cmp-carrier-lift',-.5]]){const start=pose(tool,'condition',0),carrier=viewport.scene.getObjectByName(name),offset=start.y-carrier.position.y;for(const p of [.3,.6,.8,1]){const wafer=pose(tool,'condition',p);assert(Math.abs(wafer.y-carrier.position.y-offset)<1e-9);}assert(Math.abs(viewport.wafer.position.y-start.y-stroke)<1e-9);assert(start.distanceTo(pose(tool,'unload',.1))<1e-9);}});
  await test('Dispense streams stop before spin nozzles leave the wafer',()=>{for(const tool of ['coat','developer']){pose(tool,'process',.8);const streams=[];viewport.scene.traverse(o=>{if(o.geometry?.type==='CylinderGeometry'&&o.geometry.parameters.radiusTop===.018)streams.push(o);});assert.equal(streams.length,1);assert.equal(streams[0].visible,false);}});
  await test('Robot shoulder and elbow links stay outside equipment throughout every transfer',()=>{for(const tool of Object.keys(E.tools))for(const phase of ['load','condition','unload']){let previous=null;for(let i=0;i<=100;i++){pose(tool,phase,i/100);for(const name of ['robot-upper-arm','robot-forearm','robot-slide-housing']){const object=viewport.scene.getObjectByName(name),bounds=new c.THREE.Box3().setFromObject(object);assert(bounds.min.z>3.1,tool+' '+phase+' '+i+' '+name+' enters equipment');}const elbow=viewport.scene.getObjectByName('robot-elbow').position.clone();if(previous)assert(elbow.distanceTo(previous)<1.1,tool+' elbow jumps '+phase+' '+i);previous=elbow;}}});
  await test('Wafer clears the FOUP before translating sideways or tilting',()=>{for(const tool of Object.keys(E.tools)){const home=pose(tool,'idle',0);for(let i=10;i<=40;i++){pose(tool,'load',i/100);assert.equal(viewport.wafer.position.x,home.x);assert(Math.abs(viewport.wafer.rotation.x)+Math.abs(viewport.wafer.rotation.z)<1e-10);}pose(tool,'load',.44);assert(viewport.wafer.position.z>=3.49);}});
  await test('Lift pins lower only after the fork clears and raise before retrieval',()=>{for(const tool of ['coat','bake','scanner','etch','metrology','probe']){const loaded=pose(tool,'load',1);assert(viewport.scene.getObjectByName('wafer-lift-pins'));const early=pose(tool,'condition',.39);assert.equal(early.y,loaded.y);assert(viewport.scene.getObjectByName('transfer-gripper').position.z>3.4);const seated=pose(tool,'process',.5);assert(Math.abs(loaded.y-seated.y-.22)<1e-9);const ready=pose(tool,'unload',.1);assert(Math.abs(ready.y-loaded.y)<1e-9);}});
  await test('Wet handling stays horizontal until the carrier clamps and the robot withdraws',()=>{for(const tool of ['clean','wetetch']){for(let i=0;i<=100;i++){pose(tool,'load',i/100);assert(Math.abs(viewport.wafer.rotation.x)<1e-9);assert(Math.abs(viewport.scene.getObjectByName('transfer-gripper').rotation.x)<1e-9);}pose(tool,'condition',.12);const jaws=viewport.scene.getObjectsByProperty('name','wet-edge-clamp');assert.equal(jaws.length,3);assert(jaws.every(j=>Math.abs(j.position.x-.75)<1e-9));pose(tool,'condition',.44);assert(Math.abs(viewport.wafer.rotation.x)<1e-9);assert(viewport.scene.getObjectByName('transfer-gripper').position.z>3.4);pose(tool,'condition',.6);assert(viewport.wafer.rotation.x<-.1);assert(jaws.every(j=>Math.abs(j.position.x-.75)<1e-9));}});
  await test('Wet carrier keeps the wafer secured during tilt, immersion, rinse and return',()=>{for(const tool of ['clean','wetetch'])for(const phase of ['condition','process','unload'])for(let i=0;i<=100;i++){const p=i/100;if(phase==='unload'&&p>.55)continue;pose(tool,phase,p);const cradle=viewport.scene.getObjectByName('wet-tilt-cradle'),center=cradle.getWorldPosition(new c.THREE.Vector3());assert(center.distanceTo(viewport.wafer.position)<1e-8,phase+' center');assert(cradle.getWorldQuaternion(new c.THREE.Quaternion()).angleTo(viewport.wafer.quaternion)<1e-7,phase+' tilt');}pose('clean','process',.3);assert(viewport.wafer.position.y-.75>1.29);assert(viewport.wafer.position.y+.75<2.915);pose('clean','process',.72);assert.equal(viewport.wafer.position.y,4);pose('clean','process',.95);assert(Math.abs(viewport.wafer.position.x-.93)<1e-8);pose('clean','unload',.5);assert(Math.abs(viewport.wafer.rotation.x)<1e-9);pose('clean','unload',.52);assert(viewport.scene.getObjectByName('transfer-gripper').position.distanceTo(viewport.wafer.position)<1e-8);});
  await test('Edge grippers close before CMP or implant tilt and release only at handoff',()=>{for(const tool of ['cmp','implant']){for(const p of [.44,.5,.6,.8,1]){pose(tool,'load',p);const jaws=viewport.scene.getObjectsByProperty('name','robot-edge-clamp');assert(jaws.every(j=>Math.abs(j.position.z)<1e-9));}pose(tool,'condition',0);const seat=viewport.scene.getObjectByName('transfer-gripper').position.clone();pose(tool,'condition',.1);assert(viewport.scene.getObjectByName('transfer-gripper').position.distanceTo(seat)<1e-8);assert(viewport.scene.getObjectsByProperty('name','robot-edge-clamp').every(j=>j.position.z>1.2));}});
  await test('Disposing the viewport releases every remaining geometry, texture and input listener exactly once',()=>{
    const resources=new Set(),disposed=[];viewport.scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){resources.add(m);for(const value of Object.values(m))if(value?.isTexture)resources.add(value);}});resources.add(viewport.scene.environment);resources.forEach(r=>r.addEventListener('dispose',()=>disposed.push(r)));
    const canvas=viewport.renderer.domElement,count=inspections.length;viewport.dispose();viewport.dispose();assert.equal(disposed.length,resources.size);assert.equal(new Set(disposed).size,resources.size);assert.equal(canvas.parentNode,null);const key=new Event('keydown');key.key='Enter';canvas.dispatchEvent(key);assert.equal(inspections.length,count);
  });
  const result={date:new Date().toISOString(),model:E.VERSION,passed:tests.length,scope:'Deterministic process model, DOM behavior and real Three.js scene geometry using a renderer stub. Browser layout and GPU appearance were not tested.',tests};await fs.writeFile(root+'/tests/fab-results.json',JSON.stringify(result,null,2));return result;
}

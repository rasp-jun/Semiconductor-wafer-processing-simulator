import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
export function runFabObserveTests(root){const c=vm.createContext({});c.window=c;for(const f of ['fab-engine.js','fab-view.js','fab-observe.js'])vm.runInContext(fs.readFileSync(root+'/'+f,'utf8'),c);const E=c.FabEngine,O=c.FabObserve,tests=[],test=(name,fn)=>{fn();tests.push({name,status:'passed'});};
 test('Observation at 100 percent matches full processing without committing records',()=>{let before=E.createWafer();for(const step of E.route.slice(0,18)){const original=JSON.stringify(before),snapshot=O.inspect(before,step,step.recipe,'none',100),full=E.execute(before,step.recipe);assert.equal(JSON.stringify(E.summarize(snapshot.wafer)),JSON.stringify(full.metrics));assert.equal(snapshot.wafer.records.length,0);assert.equal(JSON.stringify(before),original);before=full.wafer;}});
 test('Rewinding reuses the original wafer and cannot accumulate processing',()=>{const step=E.route[0],before=E.createWafer(),full=O.inspect(before,step,step.recipe,'none',100),start=O.inspect(before,step,step.recipe,'none',0),again=O.inspect(before,step,step.recipe,'none',100);assert.equal(JSON.stringify(start.wafer),JSON.stringify(before));assert.equal(JSON.stringify(full.wafer),JSON.stringify(again.wafer));assert.throws(()=>O.inspect(before,step,step.recipe,'none',NaN));assert.throws(()=>O.inspect(before,step,step.recipe,'none',101));});
 test('Equal-height material replacement is still a material change',()=>{const a=E.createWafer(),b=E.copy(a);b.columns[0]=[{material:'Si',nm:590},{material:'SiO2',nm:10}];const d=O.changes(a,b);assert.equal(d[0].kind,'mixed');assert.equal(d[0].added,10);assert.equal(d[0].removed,10);assert.equal(d[1].kind,'same');});
 test('Split layers of the same material are summed before comparison',()=>{const a=E.createWafer(),b=E.copy(a);b.columns[0]=[{material:'Si',nm:300},{material:'Si',nm:300}];assert.equal(O.changes(a,b)[0].kind,'same');});
 test('Poly observation distinguishes absent, thin and above-threshold layers without altering the model',()=>{
  const wafer=E.createWafer();assert.equal(O.polyObservation(wafer).thinSites,0);
  wafer.columns[0].push({material:'Poly',nm:.001});wafer.columns[1].push({material:'Poly',nm:20});wafer.columns[2].push({material:'Poly',nm:20.001});
  const original=JSON.stringify(wafer),observation=O.polyObservation(wafer);assert.equal(observation.thinSites,2);assert.equal(observation.maxThinNm,20);assert.equal(E.summarize(wafer).gateCD,30);
  assert.equal(JSON.stringify(wafer),original);wafer.columns[3].push({material:'Poly',nm:12},{material:'SiO2',nm:1},{material:'Poly',nm:12});assert.equal(O.polyObservation(wafer).thinSites,3);assert.equal(O.polyObservation(wafer).maxThinNm,24);
 });
 test('Oxidation reveals both silicon consumption and oxide growth',()=>{let w=E.createWafer();const step=E.route.find(s=>s.tool==='oxidation');while(w.cursor<step.index)w=E.execute(w).wafer;const after=O.inspect(w,step,step.recipe,'none',100).wafer,d=O.changes(w,after);assert.ok(d.some(x=>x.kind==='mixed'));assert.ok(d.some(x=>x.materials.some(m=>m.material==='Si'&&m.delta<0)));});
 test('Thickness profile includes absent locations and sums repeated layers',()=>{const a=E.createWafer(),b=E.copy(a);b.columns[0].push({material:'SiO2',nm:4},{material:'SiO2',nm:6});const p=O.profile(a,b,'SiO2');assert.equal(p.points[0].after,10);assert.equal(p.after.count,E.NX);assert.equal(p.after.mean,10/E.NX);assert.equal(p.before.mean,0);assert.equal(p.after.min,0);assert.equal(p.after.max,10);});
 test('Occupied-only statistics handle absent film without fabricated zero mean',()=>{const a=E.createWafer(),b=E.copy(a);b.columns[0].push({material:'SiO2',nm:10});const p=O.profile(a,b,'SiO2',true);assert.equal(p.before.count,0);assert.equal(p.before.mean,null);assert.equal(p.after.count,1);assert.equal(p.after.mean,10);assert.equal(p.after.sd,0);assert.equal(p.points.length,E.NX);assert.throws(()=>O.profile(a,b,'constructor'));});
 test('Thickness statistics do not change wafer history or geometry',()=>{const a=E.createWafer(),original=JSON.stringify(a);O.profile(a,a,'Si');assert.equal(JSON.stringify(a),original);const p=O.profile(a,a,'Si');assert.equal(p.after.sd,0);assert.ok(p.points.every(x=>x.delta===0));assert.equal(p.points[0].xNm,15);assert.equal(p.points.at(-1).xNm,4785);});
 const snapshots=[E.createWafer()];while(snapshots.at(-1).cursor<70)snapshots.push(E.execute(snapshots.at(-1)).wafer);
 test('Doping colors preserve opposite body and source/drain polarity at both gate edges',()=>{
  const wafer=snapshots[66],bands=O.dopingBands(wafer);
  for(const index of [32,33,40,47,48,112,113,120,127,128]){
   const silicon=wafer.columns[index].find(l=>l.material==='Si'),z=silicon.nm-E.BASE-15,net=E.dopingAt(wafer,index,15),band=bands.find(b=>b.start<=index&&index<b.end&&b.topNm>=z&&b.bottomNm<=z);
   assert(band,'Missing visible dopant at column '+index);assert.equal(band.type,net>0?'n':'p','Wrong polarity at column '+index);
  }
  assert(E.dopingAt(wafer,32,15)>0&&E.dopingAt(wafer,33,15)<0);assert(E.dopingAt(wafer,112,15)<0&&E.dopingAt(wafer,113,15)>0);
 });
 test('Doping bands stay inside each local silicon surface after silicidation and clip the bottom cell',()=>{
  const wafer=snapshots[70],original=JSON.stringify(wafer),bands=O.dopingBands(wafer);
  for(const band of bands){assert(band.topNm>band.bottomNm);assert(band.bottomNm>=-E.BASE-1e-9);for(let i=band.start;i<band.end;i++)assert(band.topNm<=wafer.columns[i].find(l=>l.material==='Si').nm-E.BASE+1e-9,'Overlay above Si at column '+i);}
  const surface=wafer.columns[18].find(l=>l.material==='Si').nm-E.BASE;
  assert.equal(Math.max(...bands.filter(b=>b.start<=18&&18<b.end).map(b=>b.topNm)),surface);
  assert.equal(JSON.stringify(wafer),original);
 });
 test('Adjacent equal dopant cells share geometry without extending across missing silicon',()=>{
  const wafer=E.copy(snapshots[66]);wafer.columns=Array.from({length:E.NX},()=>E.copy(wafer.columns[32]));wafer.dopants.forEach(d=>{d.surface=d.surface.map(()=>d.surface[32]);d.transmission=d.transmission.map(()=>d.transmission[32]);});
  const bands=O.dopingBands(wafer);assert(bands.length>0&&bands.length<=20);assert(bands.every(b=>b.start===0&&b.end===E.NX));
  wafer.columns[80]=[];assert(O.dopingBands(wafer).every(b=>b.end<=80||b.start>80));
 });
 return {passed:tests.length,failed:0,tests};}

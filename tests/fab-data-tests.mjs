import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';
export async function runFabDataTests(root){
 const c=vm.createContext({});for(const f of ['fab-engine.js','fab-data-core.js'])vm.runInContext(await fs.readFile(root+'/'+f,'utf8'),c);const D=c.FabData,E=c.FabEngine,tests=[];const test=(name,fn)=>{fn();tests.push({name,status:'passed'});};const clean=E.route[0],mapping={temperature:'BathTemperature'};
 test('Kelvin conversion and actual interval weighting drive the same model as explicit inputs',()=>{const p=D.example();p.samples=[{t:0,quality:'good',values:{BathTemperature:323.15}},{t:30,quality:'good',values:{BathTemperature:333.15}},{t:90,quality:'good',values:{BathTemperature:333.15}}];const r=D.simulate(p,clean,mapping,{maxGap:60});assert(Math.abs(r.reduction.recipe.temperature-(50*30+60*60)/90)<1e-10);assert.equal(r.reduction.recipe.time,90);assert.equal(r.result.metrics.particles,E.execute(E.createWafer(),r.reduction.recipe).metrics.particles);assert.equal(r.sourceVerified,false);assert.equal(r.sourceClaim,'synthetic');assert.equal(JSON.stringify(r.packet),JSON.stringify(p));});
 test('Irregular sampling clips both edges of the requested processing interval',()=>{const p=D.example();p.processStart=2;p.processEnd=12;p.samples=[{t:0,quality:'good',values:{BathTemperature:323.15}},{t:5,quality:'good',values:{BathTemperature:333.15}},{t:15,quality:'good',values:{BathTemperature:343.15}}];const r=D.aggregate(p,clean,mapping,10);assert.equal(r.recipe.time,10);assert(Math.abs(r.recipe.temperature-57)<1e-9);});
 test('Quality loss, missing tags, gaps, duplicate timestamps, mixed tools and aborts fail closed',()=>{for(const change of [p=>p.samples[2].quality='bad',p=>p.samples[2].values={},p=>p.samples[2].t=p.samples[1].t,p=>p.status='aborted',p=>p.tool='bake',p=>p.processEnd=100]){const p=D.example();change(p);assert.throws(()=>D.aggregate(p,clean,mapping));}assert.throws(()=>D.aggregate(D.example(),clean,mapping,1));});
 test('Missing mappings and incompatible absolute-to-relative flow units cannot use defaults',()=>{assert.throws(()=>D.aggregate(D.example(),clean,{}));assert.throws(()=>D.convert(100,'sccm','%'));assert.throws(()=>D.convert(1,'Pa','W'));assert(Math.abs(D.convert(133.32236842105263,'Pa','mTorr')-1000)<1e-8);assert.equal(D.convert(60,'s','min'),1);});
 test('All supported tools require complete explicitly mapped inputs and retain model units',()=>{for(const tool of Object.keys(E.tools)){const step=E.route.find(s=>s.tool===tool),p=D.example(),map={};p.tool=tool;p.channels={};for(const [key,f] of Object.entries(E.tools[tool].fields)){if(key==='time')continue;p.channels[key]={unit:f.unit};map[key]=key;}if(!Object.keys(p.channels).length)p.channels.Unused={unit:'s'};const seconds=E.duration(step,step.recipe);p.processEnd=seconds;p.samples=Array.from({length:Math.ceil(seconds/5)+1},(_,i)=>({t:Math.min(seconds,i*5),quality:'good',values:Object.fromEntries(Object.keys(p.channels).map(k=>[k,step.recipe[k]??1]))}));const r=D.aggregate(p,step,map,5);for(const [k,v] of Object.entries(step.recipe))assert(Math.abs(r.recipe[k]-v)<Math.max(1,Math.abs(v))*1e-9,tool+' '+k);}});
 test('Nonlinear models are marked as representative-condition approximations, not dynamic integration',()=>{const r=D.simulate(D.example(),clean,mapping);assert(r.notice.includes('적분하지 않습니다'));assert.equal(r.inputOrigin,'reference-silicon-substrate');assert.equal(r.result.records.length,1);});
 test('Later operations require explicit upstream provenance and reject incomplete histories',()=>{const step=E.route[1],p=D.example();p.tool='coat';p.processEnd=30;p.channels={RPM:{unit:'rpm'}};p.samples=Array.from({length:7},(_,i)=>({t:i*5,quality:'good',values:{RPM:3000}}));assert.throws(()=>D.simulate(p,step,{rpm:'RPM'}));const r=D.simulate(p,step,{rpm:'RPM'},{allowReference:true});assert.equal(r.inputOrigin,'reference-simulated-upstream');assert.equal(r.inputRecords.length,1);assert.throws(()=>D.simulate(p,step,{rpm:'RPM'},{history:{records:[]}}));const replay=D.simulate(p,step,{rpm:'RPM'},{history:{records:r.inputRecords}});assert.equal(replay.result.metrics.films.PR.mean,r.result.metrics.films.PR.mean);});
 test('CSV preserves metadata and rejects unit changes, mixed runs, repeated tags and blank numbers',()=>{const header='equipment_id,chamber_id,run_id,lot_id,wafer_id,tool,started_at,process_start_s,process_end_s,t_s,quality,tag,value,unit,source,status';const row=t=>`EQ,C,R,L,W,clean,2026-09-21T00:00:00Z,0,10,${t},good,T,333.15,K,equipment-export,completed`;const csv=[header,row(0),row(5),row(10)].join('\n');assert.equal(D.parseCSV(csv).samples.length,3);assert.throws(()=>D.parseCSV(csv.replace('333.15,K','333.15,C')));assert.throws(()=>D.parseCSV(csv.replace('EQ,C,R','EQ,C,OTHER')));assert.throws(()=>D.parseCSV(csv+'\n'+row(10)));assert.throws(()=>D.parseCSV(csv.replace('333.15,K',',K')));});
 test('Cumulative dose requires an endpoint and rejects resets instead of averaging dose',()=>{const step=E.route.find(s=>s.tool==='scanner'),p=D.example();p.tool='scanner';p.processEnd=20;p.channels={D:{unit:'mJ/cm2'},F:{unit:'um'}};p.samples=Array.from({length:5},(_,i)=>({t:i*5,quality:'good',values:{D:i*30,F:0}}));const r=D.aggregate(p,step,{dose:'D',focus:'F'});assert.equal(r.recipe.dose,120);assert.equal(r.stats.dose.method,'end-value');p.samples[3].values.D=20;assert.throws(()=>D.aggregate(p,step,{dose:'D',focus:'F'}));});
 test('Invalid calendar dates, timezone-free times and overflowing unit conversions are rejected',()=>{for(const startedAt of ['2026-02-31T00:00:00Z','2026-09-21T00:00:00','2026-09-21T00:00:00+25:00']){const p=D.example();p.startedAt=startedAt;assert.throws(()=>D.validate(p));}assert.throws(()=>D.convert(1e308,'kPa','mTorr'));assert.throws(()=>D.convert(1,'constructor','constructor'));const p=D.example();p.sourceVerified=true;assert.throws(()=>D.validate(p));});
 test('Single-sample excursions cannot hide inside an acceptable average',()=>{const p=D.example();p.samples[2].values.BathTemperature=400;assert.throws(()=>D.aggregate(p,clean,mapping));});
 test('Kelvin conversion at a model boundary tolerates floating point rounding but not a real excursion',()=>{
  const step=E.route.find(s=>s.tool==='lpcvd'),p=D.example();p.tool='lpcvd';p.processEnd=10;p.channels={T:{unit:'K'},F:{unit:'%'}};p.samples=[0,2.3,5.1,10].map(t=>({t,quality:'good',values:{T:1123.15,F:100}}));
  const reduced=D.aggregate(p,step,{temperature:'T',flow:'F'});assert.equal(reduced.recipe.temperature,850);assert.equal(reduced.stats.temperature.max,850);
  p.samples[1].values.T=1123.150001;assert.throws(()=>D.aggregate(p,step,{temperature:'T',flow:'F'}),/범위/);
 });
 test('Unit conversion preserves numeric zero and never turns missing or string values into measurements',()=>{
  assert.equal(D.convert(0,'nm','um'),0);assert.equal(D.convert(0,'C','K'),273.15);
  for(const value of [null,undefined,'',false,true,'0','300',NaN])assert.throws(()=>D.convert(value,'nm','um'),/숫자/);
 });
 const {document:d}=parseHTML(await fs.readFile(root+'/fab-data.html','utf8'));
 const select=Object.getPrototypeOf(d.querySelector('select'));Object.defineProperty(select,'value',{get(){return this.testValue??this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(v){this.testValue=String(v);},configurable:true});
 let serverPacket;
 const sandbox={document:d,console,Blob,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},setTimeout(){return 0;},fetch:async()=>({ok:true,json:async()=>({id:'TEST',packet:JSON.parse(JSON.stringify(serverPacket)),sha256:'synthetic-test-only'})})};sandbox.window=sandbox;
 const ui=vm.createContext(sandbox);for(const name of ['fab-engine.js','fab-data-core.js','fab-data-app.js'])vm.runInContext(await fs.readFile(root+'/'+name,'utf8'),ui);
 const click=selector=>d.querySelector(selector).dispatchEvent(new Event('click',{bubbles:true}));
 const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert(predicate(),'Data UI did not finish the operation');};
 async function calculate(packet){
  serverPacket=packet;d.querySelector('#serverRunId').value='TEST';click('#serverLoad');await settle(()=>!!d.querySelector('[data-map="temperature"]'));
  d.querySelector('[data-map="temperature"]').value='TEMP';d.querySelector('#maxGap').value='5';click('#simulateButton');await settle(()=>!d.querySelector('#exportResult').disabled||d.querySelector('#dataStatus').classList.contains('error'));assert(!d.querySelector('#exportResult').disabled,d.querySelector('#dataStatus').textContent);
 }
 const trace=D.example();trace.processStart=10;trace.processEnd=20;trace.channels={TEMP:{unit:'C'},AUX:{unit:'C'}};trace.samples=[0,5,10,15,20,25,30].map(t=>({t,quality:t===25?'uncertain':'good',values:t===5?{AUX:0}:{TEMP:t===0?0:60}}));
 await calculate(trace);
 test('The data chart breaks at missing and uncertain samples outside the used interval',()=>{
  const path=d.querySelector('#traceChart path[data-series]').getAttribute('d');assert.equal((path.match(/M/g)||[]).length,3);
  assert.equal(d.querySelectorAll('#traceChart circle[data-quality="uncertain"]').length,1);assert(d.querySelector('#traceChart').textContent.includes('누락 1개 · 불량/불확실 1개'));
  assert(d.querySelector('#traceChart circle[data-quality="good"] title').textContent.includes('0 s · 0 °C'));
  assert(d.querySelector('#mappingSummary').textContent.includes('60'));assert(d.querySelector('#metricResults').textContent.includes('모델 예측 지표'));
 });
 const extremes=E.copy(trace);extremes.samples[0].values.TEMP=-1e308;extremes.samples[6].values.TEMP=1e308;
 await calculate(extremes);
 test('Finite out-of-interval sensor extremes cannot overflow chart coordinates',()=>{
  const svg=d.querySelector('#traceChart svg').outerHTML;assert(!/NaN|Infinity/.test(svg));
  for(const circle of d.querySelectorAll('#traceChart circle')){assert(Number.isFinite(Number(circle.getAttribute('cx'))));assert(Number.isFinite(Number(circle.getAttribute('cy'))));}
  assert(!d.querySelector('#exportResult').disabled);
 });
 return{passed:tests.length,tests};
}

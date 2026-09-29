import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {Blob} from 'node:buffer';
import {parseHTML,Event} from './linkedom.worker.mjs';

export async function runFabDataAsyncTests(root){
  const names=['fab-data.html','fab-engine.js','fab-data-core.js','fab-data-app.js'];
  const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await fs.readFile(root+'/'+name,'utf8')])));
  const tests=[];
  async function test(name,fn){try{await fn();tests.push({name,status:'passed'});}catch(error){tests.push({name,status:'failed',error:error.stack});}}
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  async function settle(predicate){for(let i=0;i<100;i++){if(predicate())return;await flush();}assert(predicate(),'The current request did not settle');}
  function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
  function mount(options={}){
    const {document:d}=parseHTML(files['fab-data.html']),downloads=[];
    Object.defineProperty(Object.getPrototypeOf(d.querySelector('select')),'value',{configurable:true,get(){return this.testValue??this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(value){this.testValue=String(value);}});
    for(const input of d.querySelectorAll('input[type="checkbox"]'))input.checked=input.hasAttribute('checked');
    // Browsers retain Event.target after an await; LinkeDOM clears its dispatch target.
    for(const selector of ['#dataFile','#historyFile']){const input=d.querySelector(selector),listen=input.addEventListener.bind(input);input.addEventListener=(type,fn)=>listen(type,event=>fn(type==='change'?{target:input}:event));}
    const c={document:d,console,Blob,TextEncoder,TextDecoder,Uint8Array,crypto:options.crypto||webcrypto,
      URL:{createObjectURL(blob){downloads.push(blob);return 'blob:async-data';},revokeObjectURL(){}},setTimeout(){return 0;},
      fetch:options.fetch||(()=>{throw Error('Unexpected network request');})};c.window=c;vm.createContext(c);
    for(const name of names.slice(1))vm.runInContext(files[name],c,{filename:name});
    const el=selector=>{const found=d.querySelector(selector);assert(found,selector);return found;};
    const click=selector=>{assert(!el(selector).disabled,selector+' is disabled');el(selector).dispatchEvent(new Event('click',{bubbles:true}));};
    const input=(selector,value)=>{el(selector).value=String(value);el(selector).dispatchEvent(new Event('input',{bubbles:true}));};
    return {d,c,el,click,input,downloads,E:c.FabEngine,D:c.FabData};
  }
  function beginFile(ui,selector,read,name='test.json'){
    const input=ui.el(selector);Object.defineProperty(input,'files',{configurable:true,value:[{name,size:100,arrayBuffer:()=>read.promise,text:()=>read.promise}]});
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function mapExample(ui){ui.el('[data-map="temperature"]').value='BathTemperature';ui.el('#maxGap').value='10';}
  async function calculate(ui){mapExample(ui);ui.click('#simulateButton');await settle(()=>!ui.el('#exportResult').disabled);}
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).buffer;
  const currentStatus=ui=>({text:ui.el('#dataStatus').textContent,error:ui.el('#dataStatus').classList.contains('error')});

  await test('A rejected obsolete data file cannot replace the latest completed result status or clear a newer selection',async()=>{
    const ui=mount(),old=deferred();beginFile(ui,'#dataFile',old);ui.click('#demoButton');await calculate(ui);
    ui.click('#exportResult');const originalExport=await ui.downloads.at(-1).text();
    const expected=currentStatus(ui),result=ui.el('#results').innerHTML;ui.el('#dataFile').value='newer-selection.json';old.reject(Error('obsolete file failure'));await flush();
    assert.deepEqual(currentStatus(ui),expected);assert.equal(ui.el('#results').innerHTML,result);assert(!ui.el('#exportResult').disabled);assert.equal(ui.el('#dataFile').value,'newer-selection.json');
    ui.click('#exportResult');assert.equal(await ui.downloads.at(-1).text(),originalExport);
  });
  await test('A rejected obsolete history file cannot override a newer history and completed calculation',async()=>{
    const ui=mount(),old=deferred(),latest=deferred();ui.click('#demoButton');beginFile(ui,'#historyFile',old);beginFile(ui,'#historyFile',latest);
    latest.resolve(JSON.stringify({schema:'waferflow-fab-history-v1',modelVersion:ui.E.VERSION,wafers:[{id:'LATEST',records:[]}]}));
    await settle(()=>!ui.el('#historyWafer').disabled);await calculate(ui);const expected=currentStatus(ui),historyInfo=ui.el('#historyInfo').textContent;
    ui.el('#historyFile').value='latest-selection.json';old.reject(Error('obsolete history failure'));await flush();
    assert.deepEqual(currentStatus(ui),expected);assert.equal(ui.el('#historyInfo').textContent,historyInfo);assert(ui.el('#historyWafer').textContent.includes('LATEST'));assert.equal(ui.el('#historyFile').value,'latest-selection.json');
  });
  await test('An obsolete server failure cannot overwrite a newer file result',async()=>{
    const server=deferred(),ui=mount({fetch:()=>server.promise});ui.el('#serverRunId').value='OLD';ui.click('#serverLoad');
    const file=deferred();beginFile(ui,'#dataFile',file);file.resolve(bytes(ui.D.example()));await settle(()=>!!ui.d.querySelector('[data-map="temperature"]'));await calculate(ui);
    const expected=currentStatus(ui);server.reject(Error('obsolete server failure'));await flush();assert.deepEqual(currentStatus(ui),expected);assert(!ui.el('#exportResult').disabled);
  });
  function controlledHashes(){const first=deferred(),second=deferred();let calls=0;return {first,second,crypto:{subtle:{digest(){calls++;return calls===1?first.promise:calls===2?second.promise:Promise.resolve(new Uint8Array(32).buffer);}}}};}
  for(const outcome of ['success','failure'])await test('An obsolete calculation '+outcome+' cannot unlock or relabel a newer calculation',async()=>{
    const hashes=controlledHashes(),ui=mount({crypto:hashes.crypto});ui.click('#demoButton');mapExample(ui);ui.click('#simulateButton');
    ui.click('#demoButton');mapExample(ui);ui.click('#simulateButton');assert(ui.el('#simulateButton').disabled);const expected=currentStatus(ui);
    if(outcome==='success')hashes.first.resolve(new Uint8Array(32).buffer);else hashes.first.reject(Error('obsolete digest failure'));await flush();
    assert(ui.el('#simulateButton').disabled,'The newer hash operation still owns the disabled button');assert.deepEqual(currentStatus(ui),expected);
    hashes.second.resolve(new Uint8Array(32).buffer);await settle(()=>!ui.el('#exportResult').disabled);assert(!ui.el('#simulateButton').disabled);
  });
  await test('Input edits cancel a pending calculation and allow a new calculation without waiting for its old hash',async()=>{
    const hash=deferred(),ui=mount({crypto:{subtle:{digest:()=>hash.promise}}});ui.click('#demoButton');mapExample(ui);ui.click('#simulateButton');
    ui.input('#maxGap','15');assert(!ui.el('#simulateButton').disabled);assert(ui.el('#results').hidden);assert(ui.el('#exportResult').disabled);
    const expected=currentStatus(ui);hash.reject(Error('hash from previous inputs'));await flush();assert.deepEqual(currentStatus(ui),expected);assert(!ui.el('#simulateButton').disabled);
  });
  await test('Clearing history invalidates a pending history read without a late error or stale selection reset',async()=>{
    const ui=mount(),read=deferred();beginFile(ui,'#historyFile',read);ui.click('#clearHistory');const expected=currentStatus(ui),info=ui.el('#historyInfo').textContent;
    ui.el('#historyFile').value='unrelated-new-selection.json';read.reject(Error('cleared history failure'));await flush();
    assert.deepEqual(currentStatus(ui),expected);assert.equal(ui.el('#historyInfo').textContent,info);assert.equal(ui.el('#historyFile').value,'unrelated-new-selection.json');assert(ui.el('#historyWafer').disabled);
  });
  await test('Current file, history, server and calculation failures still explain the error and release owned controls',async()=>{
    for(const selector of ['#dataFile','#historyFile']){
      const ui=mount(),read=deferred();beginFile(ui,selector,read);read.reject(Error('current read failure'));await flush();assert.equal(ui.el('#dataStatus').textContent,'current read failure');assert(ui.el('#dataStatus').classList.contains('error'));
    }
    const ui=mount({fetch:async()=>({ok:false})});ui.el('#serverRunId').value='CURRENT';ui.click('#serverLoad');await flush();assert(ui.el('#dataStatus').classList.contains('error'));
    ui.click('#demoButton');ui.el('[data-map="temperature"]').value='';ui.click('#simulateButton');await flush();assert(ui.el('#dataStatus').classList.contains('error'));assert(!ui.el('#simulateButton').disabled);assert(ui.el('#exportResult').disabled);
    const invalid=deferred();beginFile(ui,'#historyFile',invalid);invalid.resolve(JSON.stringify({schema:'wrong'}));await flush();assert(ui.el('#dataStatus').textContent.includes('현재 모델의 CMOS 기록'));
    const hash=deferred(),hashUI=mount({crypto:{subtle:{digest:()=>hash.promise}}});hashUI.click('#demoButton');mapExample(hashUI);hashUI.click('#simulateButton');hash.reject(Error('current hash failure'));await flush();assert.equal(hashUI.el('#dataStatus').textContent,'current hash failure');assert(!hashUI.el('#simulateButton').disabled);assert(hashUI.el('#exportResult').disabled);
  });
  const historyPacket=ui=>({schema:'waferflow-fab-history-v1',modelVersion:ui.E.VERSION,wafers:[{id:'IMPORTED',records:[]}]});
  await test('Late history success cannot invalidate a newer completed calculation or its downloadable original',async()=>{
    const ui=mount(),read=deferred();ui.click('#demoButton');beginFile(ui,'#historyFile',read);ui.click('#demoButton');await calculate(ui);
    const status=currentStatus(ui);ui.click('#exportResult');const exported=await ui.downloads.at(-1).text();
    read.resolve(JSON.stringify(historyPacket(ui)));await flush();
    assert(!ui.el('#results').hidden,'Late history hid the completed result');assert(!ui.el('#exportResult').disabled);assert.deepEqual(currentStatus(ui),status);
    assert(ui.el('#historyWafer').disabled);assert(ui.el('#historyInfo').textContent.includes('계산'));
    ui.click('#exportResult');assert.equal(await ui.downloads.at(-1).text(),exported);
  });
  await test('Late history success cannot cancel a newer calculation that is still hashing its original',async()=>{
    const hash=deferred(),read=deferred(),ui=mount({crypto:{subtle:{digest:()=>hash.promise}}});ui.click('#demoButton');beginFile(ui,'#historyFile',read);mapExample(ui);ui.click('#simulateButton');
    read.resolve(JSON.stringify(historyPacket(ui)));await flush();assert(ui.el('#simulateButton').disabled);assert(ui.el('#historyWafer').disabled);
    hash.resolve(new Uint8Array(32).buffer);await settle(()=>!ui.el('#exportResult').disabled);ui.click('#exportResult');const result=JSON.parse(await ui.downloads.at(-1).text());assert.equal(result.inputOrigin,'reference-silicon-substrate');
  });
  await test('Independent history and telemetry reads can still combine before the user starts calculation',async()=>{
    const ui=mount(),history=deferred(),data=deferred();beginFile(ui,'#historyFile',history);beginFile(ui,'#dataFile',data);data.resolve(bytes(ui.D.example()));await settle(()=>!!ui.d.querySelector('[data-map="temperature"]'));
    history.resolve(JSON.stringify(historyPacket(ui)));await settle(()=>!ui.el('#historyWafer').disabled);await calculate(ui);ui.click('#exportResult');const result=JSON.parse(await ui.downloads.at(-1).text());assert.equal(result.inputOrigin,'provided-simulation-history');
  });
  for(const source of ['file','server'])await test('Late '+source+' success cannot replace a newly selected packet and completed result',async()=>{
    const read=deferred(),ui=mount({fetch:()=>read.promise});if(source==='file')beginFile(ui,'#dataFile',read);else{ui.el('#serverRunId').value='OLD';ui.click('#serverLoad');}
    ui.click('#demoButton');await calculate(ui);const status=currentStatus(ui);ui.click('#exportResult');const exported=await ui.downloads.at(-1).text(),old=ui.D.example();old.runId='OLD';
    if(source==='file')read.resolve(bytes(old));else read.resolve({ok:true,json:async()=>({id:'OLD',packet:old,sha256:'unused-old-source'})});
    await flush();await flush();assert(!ui.el('#exportResult').disabled);assert.deepEqual(currentStatus(ui),status);ui.click('#exportResult');assert.equal(await ui.downloads.at(-1).text(),exported);
  });
  const result={passed:tests.filter(t=>t.status==='passed').length,tests};
  await fs.writeFile(root+'/tests/fab-data-async-results.json',JSON.stringify(result,null,2)+'\n');
  const failures=tests.filter(t=>t.status==='failed');if(failures.length)throw Error(failures.map(t=>t.name+'\n'+t.error).join('\n\n'));return result;
}

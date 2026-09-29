import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';
import http from 'node:http';
import {parseHTML, Event} from './linkedom.worker.mjs';

// Real HTTP API + DOM integration. Deliberately no CSS/GPU claims.
export async function runReviewUITests(root, origin='http://127.0.0.1:8767') {
  if(origin!=='http://127.0.0.1:8767')throw new Error('Only the dedicated local UI-test server is allowed');
  const tests=[],timers=new Set(),downloads=[],experimentBodies=[];
  let cookie='',pausedResponse=null;
  const request=async(path,options={})=>{
    if(options.method==='POST'&&path.endsWith('/experiments'))experimentBodies.push(options.body);
    const response=await new Promise((resolve,reject)=>{const req=http.request(origin+path,{method:options.method||'GET',signal:options.signal,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}},res=>{let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:name=>{const value=res.headers[name.toLowerCase()];return Array.isArray(value)?value[0]:value;}},json:async()=>JSON.parse(data)}));});req.on('error',reject);if(options.body)req.write(options.body);req.end();});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];if(pausedResponse?.path===path){const gate=pausedResponse;pausedResponse=null;gate.arrived=true;await gate.promise;}return response;
  };
  const {window,document:d}=parseHTML(await fs.readFile(root+'/workbench.html','utf8'));
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(v){for(const o of this.querySelectorAll('option')){if(o.value===String(v))o.setAttribute('selected','');else o.removeAttribute('selected');}}});
  d.querySelectorAll('dialog').forEach(el=>{el.showModal=()=>el.setAttribute('open','');el.close=()=>el.removeAttribute('open');});
  d.querySelector('#authForm').reset=()=>d.querySelectorAll('#authForm input').forEach(el=>el.value='');
  const safeTimeout=(fn,delay)=>{const id=setTimeout(()=>{timers.delete(id);fn();},delay);timers.add(id);return id;};
  const clear=id=>{clearTimeout(id);timers.delete(id);};
  class FormDataShim{constructor(form){this.items=[...form.querySelectorAll('input[name],select[name],textarea[name]')].map(el=>[el.name,el.value]);}*[Symbol.iterator](){yield* this.items;}}
  const store=new Map();
  const ctx=vm.createContext({window,document:d,console,fetch:request,FormData:FormDataShim,AbortController,Blob,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,btoa,atob,URL:{createObjectURL:b=>{downloads.push(b);return 'blob:test'},revokeObjectURL(){}},setTimeout:safeTimeout,clearTimeout:clear,sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
  // Browser window is the global object for exported application hooks.
  vm.runInContext(await fs.readFile(root+'/review.js','utf8'),ctx,{filename:'review.js'});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label='UI condition')=>{for(let i=0;i<400;i++){if(fn())return;await sleep(15);}throw new Error('Timed out: '+label+' | '+(d.querySelector('#dialogError')?.textContent||d.querySelector('#authError')?.textContent||d.querySelector('#reviewToast')?.textContent));};
  const click=selector=>{const el=d.querySelector(selector);assert(el,'Missing '+selector);el.dispatchEvent(new Event('click',{bubbles:true}));};
  const input=(selector,value)=>{const el=d.querySelector(selector);assert(el,'Missing '+selector);el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));};
  const submit=id=>d.querySelector(id).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  const field=(name,value)=>input('#workspaceForm [name="'+name+'"]',value);
  const dialogClosed=()=>!d.querySelector('#reviewDialog').hasAttribute('open');
  const test=async(name,fn)=>{await fn();tests.push({name,status:'passed'});};
  const password='ui-test-only-password-123';
  try{
    await test('Bootstrap/login renders a real authenticated workspace',async()=>{await wait(()=>!d.querySelector('#authForm').hidden,'auth form');input('#authForm [name="username"]','ui-admin');input('#authForm [name="password"]',password);if(!d.querySelector('#displayNameLabel').hidden)input('#authForm [name="display_name"]','테스트 관리자');submit('#authForm');await wait(()=>!d.querySelector('#reviewShell').hidden&&window.WaferReview.getState().user,'login');await wait(()=>!d.querySelector('#reviewContent').textContent.includes('불러오는 중'));assert.equal(d.querySelector('#userRole').textContent,'관리자');});
    await test('Project and revision forms persist server records and escape user text',async()=>{click('#newProject');field('name','UI 검증 '+Date.now());field('description','레시피 검토 통합 검증');submit('#workspaceForm');await wait(dialogClosed,'project save');await wait(()=>!!d.querySelector('[data-action="recipe"]'),'recipe action');click('[data-action="recipe"]');field('name','PR <img src=x> 검토');field('change_reason','<script>literal note</script> 노광 조건 검토');submit('#workspaceForm');await wait(dialogClosed,'recipe save');await wait(()=>!!d.querySelector('[data-action="simulate"]'),'revision panel');assert(d.querySelector('.revision-title h2').textContent.includes('<img'));assert.equal(d.querySelectorAll('#reviewContent img, #reviewContent script').length,0);assert(d.querySelector('a[href^="photo-lab.html?revision="]'));});
    await test('Simulation form computes through the API and displays frozen evidence',async()=>{click('[data-action="simulate"]');field('lot_id','SIM-UI-001');submit('#workspaceForm');await wait(dialogClosed,'simulation save');await wait(()=>d.querySelectorAll('[data-experiment]').length===1,'simulation evidence');click('[data-experiment]');await wait(()=>d.querySelector('#reviewDialog').hasAttribute('open'),'evidence detail');assert(d.querySelector('#reviewDialogBody').textContent.includes('97.5%'));assert(d.querySelector('#reviewDialogBody').textContent.includes('SHA-256'));click('[data-close-dialog]');});
    await test('Synthetic CSV example remains labelled synthetic and charts imported values',async()=>{click('[data-action="import"]');click('[data-action="csv-demo"]');assert.equal(d.querySelector('[name="kind"]').value,'demo');submit('#workspaceForm');await wait(dialogClosed,'CSV save');await wait(()=>d.querySelectorAll('[data-experiment]').length===2,'CSV evidence');const button=[...d.querySelectorAll('[data-experiment]')].find(e=>e.textContent.includes('합성 CSV'));button.dispatchEvent(new Event('click',{bubbles:true}));await wait(()=>!!d.querySelector('.measurement-chart polyline'),'measurement detail');assert.equal(d.querySelectorAll('.measurement-chart polyline').length,1);assert(d.querySelector('#reviewDialogBody').textContent.includes('12'));click('[data-close-dialog]');assert.equal(d.querySelectorAll('.summary-card')[3].querySelector('strong').textContent,'0');});
    await test('Malformed CSV stays in the form with a useful server validation error',async()=>{click('[data-action="import"]');click('[data-action="csv-demo"]');field('csv','wafer,site,cd,depth\nW1,S1,500,100');submit('#workspaceForm');await wait(()=>d.querySelector('#dialogError').textContent.includes('헤더'),'CSV error');assert(!dialogClosed());click('[data-close-dialog]');});
    const pendingCSV=name=>{let resolve,reject;const file={name,size:20,arrayBuffer:()=>new Promise((yes,no)=>{resolve=text=>yes(new TextEncoder().encode(text).buffer);reject=no;})},input=d.querySelector('#csvFile');input.files=[file];input.dispatchEvent(new Event('change',{bubbles:true}));return {resolve,reject};};
    await test('A delayed CSV from a closed dialog cannot replace a new form',async()=>{
      click('[data-action="import"]');const old=pendingCSV('old.csv');click('[data-close-dialog]');click('[data-action="import"]');field('csv','new manual contents');field('source_name','new source');old.resolve('old file contents');await sleep(30);
      assert.equal(d.querySelector('[name="csv"]').value,'new manual contents');assert.equal(d.querySelector('[name="source_name"]').value,'new source');click('[data-close-dialog]');
    });
    await test('Selecting a newer CSV supersedes the older read without mixing content and source name',async()=>{
      click('[data-action="import"]');const old=pendingCSV('first.csv'),latest=pendingCSV('second.csv');latest.resolve('second contents');await sleep(30);old.resolve('first contents');await sleep(30);
      assert.equal(d.querySelector('[name="csv"]').value,'second contents');assert.equal(d.querySelector('[name="source_name"]').value,'second.csv');assert(!d.querySelector('#workspaceForm [type="submit"]').disabled);click('[data-close-dialog]');
    });
    await test('Manual CSV edits made during a file read remain intact',async()=>{
      click('[data-action="import"]');const pending=pendingCSV('slow.csv');field('csv','edited while reading');pending.resolve('old file contents');await sleep(30);
      assert.equal(d.querySelector('[name="csv"]').value,'edited while reading');assert(d.querySelector('#dialogError').textContent.includes('편집'));assert(!d.querySelector('#workspaceForm [type="submit"]').disabled);click('[data-close-dialog]');
    });
    const originalCSV='\ufeffwafer_id,site_id,cd_nm,etch_depth_nm\r\n" W1 ",S1,5.00e2,0.000\r\n',originalBytes=new TextEncoder().encode(originalCSV);
    async function chooseOriginal(){
      const file={name:'원본-<source>.csv',size:originalBytes.length,arrayBuffer:async()=>originalBytes.slice().buffer},input=d.querySelector('#csvFile');input.files=[file];input.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>d.querySelector('#workspaceForm').dataset.csvReading==='false','original CSV bytes');
      assert.equal(d.querySelector('[name="csv"]').value,originalCSV.slice(1).replace(/\r\n/g,'\n'));
    }
    await test('A selected CSV exports its exact BOM and CRLF bytes with server-verified separate text provenance',async()=>{
      click('[data-action="import"]');click('[data-action="csv-demo"]');field('name','Exact original file');await chooseOriginal();submit('#workspaceForm');await wait(dialogClosed,'original bytes save');
      await wait(()=>[...d.querySelectorAll('[data-experiment]')].some(e=>e.textContent.includes('Exact original file')),'original evidence');
      [...d.querySelectorAll('[data-experiment]')].find(e=>e.textContent.includes('Exact original file')).dispatchEvent(new Event('click',{bubbles:true}));
      await wait(()=>!!d.querySelector('[data-download-source]'),'source download');assert(d.querySelector('#reviewDialogBody').textContent.includes('원본 파일 바이트 보존'));
      click('[data-download-source]');assert.deepEqual(new Uint8Array(await downloads.at(-1).arrayBuffer()),originalBytes);
      click('[data-download-evidence]');const packet=JSON.parse(await downloads.at(-1).text());assert.equal(packet.result.source_archive.hash_scope,'original-file-bytes');assert.equal(packet.result.file_sha256_scope,'submitted-csv-text-utf8');assert.notEqual(packet.result.file_sha256,packet.result.source_archive.sha256);click('[data-close-dialog]');
    });
    await test('Editing an uploaded CSV preserves submitted text and never attaches stale original file bytes',async()=>{
      click('[data-action="import"]');click('[data-action="csv-demo"]');field('name','Edited CSV text');await chooseOriginal();const text=d.querySelector('[name="csv"]').value.replace('5.00e2','501');field('csv',text);submit('#workspaceForm');await wait(dialogClosed,'edited text save');
      await wait(()=>[...d.querySelectorAll('[data-experiment]')].some(e=>e.textContent.includes('Edited CSV text')));[...d.querySelectorAll('[data-experiment]')].find(e=>e.textContent.includes('Edited CSV text')).dispatchEvent(new Event('click',{bubbles:true}));
      await wait(()=>!!d.querySelector('[data-download-source]'));assert(d.querySelector('#reviewDialogBody').textContent.includes('제출 CSV 텍스트 보존'));click('[data-download-source]');assert.equal(await downloads.at(-1).text(),text);
      click('[data-download-evidence]');const packet=JSON.parse(await downloads.at(-1).text());assert.equal(packet.result.source_archive.kind,'submitted-text');assert(!packet.result.source_archive.bytes_base64);assert.equal(packet.result.rows[0].cd_nm,501);click('[data-close-dialog]');
    });
    for(const size of [900000,1000000])await test('A '+size+' byte pasted CSV survives real HTTP within the unchanged request limit',async()=>{
      const row='wafer_id,site_id,cd_nm,etch_depth_nm\nW1,S1,500,0\n',text=row+'\n'.repeat(size-Buffer.byteLength(row)),name='Submitted '+size+' bytes';
      click('[data-action="import"]');click('[data-action="csv-demo"]');field('name',name);field('csv',text);submit('#workspaceForm');await wait(dialogClosed,'large submitted CSV save');
      const wire=experimentBodies.at(-1),payload=JSON.parse(wire);assert(Buffer.byteLength(wire)<1500000);assert(!('csv' in payload));assert(!('original_csv' in payload));assert.equal(Buffer.from(payload.csv_utf8_base64,'base64').toString('utf8'),text);
      await wait(()=>[...d.querySelectorAll('[data-experiment]')].some(e=>e.textContent.includes(name)));[...d.querySelectorAll('[data-experiment]')].find(e=>e.textContent.includes(name)).dispatchEvent(new Event('click',{bubbles:true}));
      await wait(()=>!!d.querySelector('[data-download-source]'));click('[data-download-evidence]');const packet=JSON.parse(await downloads.at(-1).text());assert.equal(packet.result.count,1);assert.equal(packet.result.source_archive.kind,'submitted-text');assert.equal(packet.result.source_archive.text,text);assert.equal(packet.result.file_sha256_scope,'submitted-csv-text-utf8');assert.equal(packet.result.file_sha256,createHash('sha256').update(text).digest('hex'));assert.equal(packet.result.source_archive.sha256,packet.result.file_sha256);click('[data-download-source]');assert.deepEqual(Buffer.from(await downloads.at(-1).arrayBuffer()),Buffer.from(text));click('[data-close-dialog]');
    });
    await test('A delayed evidence response cannot replace a newly opened unsaved form',async()=>{
      const id=d.querySelector('[data-experiment]').dataset.experiment;let release;const gate={path:'/api/experiments/'+id,arrived:false,promise:new Promise(resolve=>release=resolve)};pausedResponse=gate;
      click('[data-experiment]');await wait(()=>gate.arrived,'delayed evidence before new form');click('[data-action="import"]');field('csv','new unsaved draft');field('source_name','new source');
      release();await sleep(30);assert.equal(d.querySelector('[name="csv"]')?.value,'new unsaved draft');assert.equal(d.querySelector('[name="source_name"]')?.value,'new source');click('[data-close-dialog]');
    });
    for(const outcome of ['success','failure'])await test('Pending CSV save '+outcome+' locks the captured form and cannot close or relabel a replacement draft',async()=>{
      click('[data-action="import"]');click('[data-action="csv-demo"]');field('name','Saved before replacement form');if(outcome==='failure')field('csv','invalid header');
      const form=d.querySelector('#workspaceForm'),id=form.querySelector('[name="revision_id"]').value;let release;
      const gate={path:'/api/revisions/'+id+'/experiments',arrived:false,promise:new Promise(resolve=>release=resolve)};pausedResponse=gate;submit('#workspaceForm');await wait(()=>gate.arrived,'delayed CSV save');
      assert([...form.querySelectorAll('input,textarea,select')].every(el=>el.disabled));assert(form.querySelector('[type="submit"]').disabled);
      let fileRead=false;const file=form.querySelector('#csvFile');file.files=[{name:'ignored-during-save.csv',size:2,arrayBuffer:async()=>{fileRead=true;return new ArrayBuffer(0);}}];file.dispatchEvent(new Event('change',{bubbles:true}));submit('#workspaceForm');await sleep(15);assert(!fileRead);assert(form.querySelector('[type="submit"]').disabled);
      click('[data-close-dialog]');click('[data-action="import"]');field('csv','new unsaved CSV '+outcome);field('source_name','new source '+outcome);release();await wait(()=>form.dataset.csvSaving==='false');await sleep(20);
      assert(!dialogClosed());assert.equal(d.querySelector('[name="csv"]').value,'new unsaved CSV '+outcome);assert.equal(d.querySelector('[name="source_name"]').value,'new source '+outcome);assert.equal(d.querySelector('#dialogError').textContent,'');assert(!d.querySelector('#csvFile').disabled);assert(!d.querySelector('#workspaceForm [type="submit"]').disabled);
      assert(d.querySelector('#reviewToast').textContent.includes(outcome==='success'?'이전 CSV 저장 요청이 완료되었습니다':'이전 CSV 저장 요청:'));
      click('[data-close-dialog]');click('#refreshButton');await wait(()=>d.querySelectorAll('[data-experiment]').length===7,'only the successful captured request was saved');
    });
    await test('Submitting for review freezes author actions and preserves evidence',async()=>{click('[data-transition="submit"]');submit('#workspaceForm');await wait(dialogClosed,'submit for review');await wait(()=>!!d.querySelector('.revision-title .submitted'),'submitted state');assert(!d.querySelector('[data-action="simulate"]'));assert(!d.querySelector('[data-transition="approve"]'));assert.equal(d.querySelectorAll('[data-experiment]').length,7);});
    const reviewer='reviewer'+Date.now();
    await test('Administrator creates a reviewer through the team form',async()=>{click('[data-tab="team"]');await wait(()=>!!d.querySelector('[data-action="user"]'));click('[data-action="user"]');field('display_name','동료 검토자');field('username',reviewer);field('role','reviewer');field('password',password);submit('#workspaceForm');await wait(dialogClosed);await wait(()=>d.querySelector('#reviewContent').textContent.includes(reviewer));});
    await test('Peer logs in, sees pending evidence and approves with a recorded opinion',async()=>{click('#logoutButton');await wait(()=>!d.querySelector('#authScreen').hidden);input('#authForm [name="username"]',reviewer);input('#authForm [name="password"]',password);submit('#authForm');await wait(()=>window.WaferReview.getState().user?.role==='reviewer');await wait(()=>!!d.querySelector('[data-transition="approve"]'));assert(!d.querySelector('[data-action="revise"]'));click('[data-transition="approve"]');field('note','근거 확인 <b>의견 원문</b>');submit('#workspaceForm');await wait(dialogClosed);await wait(()=>!!d.querySelector('.revision-title .approved'));assert(d.querySelector('.review-note').textContent.includes('<b>의견 원문</b>'));assert.equal(d.querySelectorAll('.review-note b').length,0);});
    await test('Evidence filter distinguishes measured records from generated samples',async()=>{click('[data-tab="experiments"]');input('#experimentFilter','measurement');d.querySelector('#experimentFilter').dispatchEvent(new Event('change',{bubbles:true}));assert([...d.querySelectorAll('[data-kind]')].every(r=>r.hidden));input('#experimentFilter','all');d.querySelector('#experimentFilter').dispatchEvent(new Event('change',{bubbles:true}));assert([...d.querySelectorAll('[data-kind]')].every(r=>!r.hidden));});
    await test('Project export downloads original evidence plus review history',async()=>{const before=downloads.length;click('#exportProject');await wait(()=>downloads.length>before);const result=JSON.parse(await downloads.at(-1).text());assert.equal(result.experiments.length,7);assert.equal(result.revisions[0].status,'approved');assert(result.audit.some(a=>a.action==='revision.approve'));assert(result.experiments.every(e=>e.digest.length===64));const source=result.experiments.find(e=>e.name==='Exact original file').result.source_archive;assert.deepEqual(Buffer.from(source.bytes_base64,'base64'),Buffer.from(originalBytes));for(const size of [900000,1000000])assert.equal(Buffer.byteLength(result.experiments.find(e=>e.name==='Submitted '+size+' bytes').result.source_archive.text),size);});
    await test('Account controls remain available independently of the sidebar layout',async()=>{click('#accountMenu');assert(d.querySelector('[data-action="logout"]'));assert(d.querySelector('[name="current_password"]'));click('[data-close-dialog]');});
    await test('An evidence response that arrives after logout cannot reopen private data',async()=>{
      const id=d.querySelector('[data-experiment]').dataset.experiment;let release;const gate={path:'/api/experiments/'+id,arrived:false,promise:new Promise(resolve=>release=resolve)};pausedResponse=gate;
      click('[data-experiment]');await wait(()=>gate.arrived,'delayed evidence response');click('#logoutButton');await wait(()=>!window.WaferReview.getState().user&&!d.querySelector('#authScreen').hidden,'logout');
      release();await sleep(30);assert(dialogClosed(),'Logged-out evidence dialog reopened');assert.equal(window.WaferReview.getState().user,null);assert(d.querySelector('#reviewShell').hidden);
    });
    const csvTransport=experimentBodies.map(wire=>({wire,payload:JSON.parse(wire)})).filter(x=>x.payload.name.startsWith('Submitted ')).map(({wire,payload})=>({csvUtf8Bytes:Buffer.from(payload.csv_utf8_base64,'base64').length,httpJsonBytes:Buffer.byteLength(wire),requestLimitBytes:1500000}));
    const output={date:new Date().toISOString(),passed:tests.length,scope:'Real local HTTP service + linkedom forms/events. No browser layout or GPU rendering.',csvTransport,tests};
    await fs.writeFile(root+'/tests/review-ui-results.json',JSON.stringify(output,null,2));return output;
  }finally{timers.forEach(clearTimeout);}
}

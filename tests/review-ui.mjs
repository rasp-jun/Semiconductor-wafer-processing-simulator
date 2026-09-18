import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Blob} from 'node:buffer';
import http from 'node:http';
import {parseHTML, Event} from './linkedom.worker.mjs';

// Real HTTP API + DOM integration. Deliberately no CSS/GPU claims.
export async function runReviewUITests(root, origin='http://127.0.0.1:8767') {
  if(origin!=='http://127.0.0.1:8767')throw new Error('Only the dedicated local UI-test server is allowed');
  const tests=[],timers=new Set(),downloads=[];
  let cookie='';
  const request=async(path,options={})=>{
    const response=await new Promise((resolve,reject)=>{const req=http.request(origin+path,{method:options.method||'GET',signal:options.signal,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}},res=>{let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:name=>{const value=res.headers[name.toLowerCase()];return Array.isArray(value)?value[0]:value;}},json:async()=>JSON.parse(data)}));});req.on('error',reject);if(options.body)req.write(options.body);req.end();});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return response;
  };
  const {window,document:d}=parseHTML(await fs.readFile(root+'/workbench.html','utf8'));
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(v){for(const o of this.querySelectorAll('option')){if(o.value===String(v))o.setAttribute('selected','');else o.removeAttribute('selected');}}});
  d.querySelectorAll('dialog').forEach(el=>{el.showModal=()=>el.setAttribute('open','');el.close=()=>el.removeAttribute('open');});
  d.querySelector('#authForm').reset=()=>d.querySelectorAll('#authForm input').forEach(el=>el.value='');
  const safeTimeout=(fn,delay)=>{const id=setTimeout(()=>{timers.delete(id);fn();},delay);timers.add(id);return id;};
  const clear=id=>{clearTimeout(id);timers.delete(id);};
  class FormDataShim{constructor(form){this.items=[...form.querySelectorAll('input[name],select[name],textarea[name]')].map(el=>[el.name,el.value]);}*[Symbol.iterator](){yield* this.items;}}
  const store=new Map();
  const ctx=vm.createContext({window,document:d,console,fetch:request,FormData:FormDataShim,AbortController,Blob,URL:{createObjectURL:b=>{downloads.push(b);return 'blob:test'},revokeObjectURL(){}},setTimeout:safeTimeout,clearTimeout:clear,sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
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
    await test('Submitting for review freezes author actions and preserves evidence',async()=>{click('[data-transition="submit"]');submit('#workspaceForm');await wait(dialogClosed,'submit for review');await wait(()=>!!d.querySelector('.revision-title .submitted'),'submitted state');assert(!d.querySelector('[data-action="simulate"]'));assert(!d.querySelector('[data-transition="approve"]'));assert.equal(d.querySelectorAll('[data-experiment]').length,2);});
    const reviewer='reviewer'+Date.now();
    await test('Administrator creates a reviewer through the team form',async()=>{click('[data-tab="team"]');await wait(()=>!!d.querySelector('[data-action="user"]'));click('[data-action="user"]');field('display_name','동료 검토자');field('username',reviewer);field('role','reviewer');field('password',password);submit('#workspaceForm');await wait(dialogClosed);await wait(()=>d.querySelector('#reviewContent').textContent.includes(reviewer));});
    await test('Peer logs in, sees pending evidence and approves with a recorded opinion',async()=>{click('#logoutButton');await wait(()=>!d.querySelector('#authScreen').hidden);input('#authForm [name="username"]',reviewer);input('#authForm [name="password"]',password);submit('#authForm');await wait(()=>window.WaferReview.getState().user?.role==='reviewer');await wait(()=>!!d.querySelector('[data-transition="approve"]'));assert(!d.querySelector('[data-action="revise"]'));click('[data-transition="approve"]');field('note','근거 확인 <b>의견 원문</b>');submit('#workspaceForm');await wait(dialogClosed);await wait(()=>!!d.querySelector('.revision-title .approved'));assert(d.querySelector('.review-note').textContent.includes('<b>의견 원문</b>'));assert.equal(d.querySelectorAll('.review-note b').length,0);});
    await test('Evidence filter distinguishes measured records from generated samples',async()=>{click('[data-tab="experiments"]');input('#experimentFilter','measurement');d.querySelector('#experimentFilter').dispatchEvent(new Event('change',{bubbles:true}));assert([...d.querySelectorAll('[data-kind]')].every(r=>r.hidden));input('#experimentFilter','all');d.querySelector('#experimentFilter').dispatchEvent(new Event('change',{bubbles:true}));assert([...d.querySelectorAll('[data-kind]')].every(r=>!r.hidden));});
    await test('Project export downloads original evidence plus review history',async()=>{click('#exportProject');await wait(()=>downloads.length>0);const result=JSON.parse(await downloads.at(-1).text());assert.equal(result.experiments.length,2);assert.equal(result.revisions[0].status,'approved');assert(result.audit.some(a=>a.action==='revision.approve'));assert(result.experiments.every(e=>e.digest.length===64));});
    await test('Account controls remain available independently of the sidebar layout',async()=>{click('#accountMenu');assert(d.querySelector('[data-action="logout"]'));assert(d.querySelector('[name="current_password"]'));click('[data-close-dialog]');});
    const output={date:new Date().toISOString(),passed:tests.length,scope:'Real local HTTP service + linkedom forms/events. No browser layout or GPU rendering.',tests};
    await fs.writeFile(root+'/tests/review-ui-results.json',JSON.stringify(output,null,2));return output;
  }finally{timers.forEach(clearTimeout);}
}

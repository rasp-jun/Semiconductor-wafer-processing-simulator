import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from './linkedom.worker.mjs';

export async function runMemoryFabSceneTests(root){
  const {document:d}=parseHTML('<html><body><div id="host"></div></body></html>'),frames=new Map(),rendered=[];let fid=0,clock=0,disposes=0;
  const create=d.createElement.bind(d);d.createElement=tag=>{const el=create(tag);if(tag==='canvas'){const gradient={addColorStop(){}};el.getContext=()=>({fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},fill(){},stroke(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient});el.setPointerCapture=()=>{};}return el;};
  const ctx={document:d,console,devicePixelRatio:1,performance:{now:()=>clock},AbortController:class{constructor(){this.signal={aborted:false}}abort(){this.signal.aborted=true}},ResizeObserver:class{constructor(fn){this.fn=fn}observe(){this.fn()}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++fid,fn);return fid;},cancelAnimationFrame:id=>frames.delete(id)};ctx.window=ctx;const c=vm.createContext(ctx);
  for(const f of ['vendor/three.js','equipment-detail.js','fab-engine.js','fab-view.js','memory-fab-engine.js','memory-fab-view.js']){if(f==='fab-view.js'){c.THREE.WebGLRenderer=class{constructor(){this.domElement=d.createElement('canvas');this.shadowMap={}}setPixelRatio(){}setClearColor(){}setSize(){}render(scene){rendered.push(scene)}dispose(){disposes++}};}vm.runInContext(await fs.readFile(root+'/'+f,'utf8'),c,{filename:f});}
  const host=d.querySelector('#host');Object.defineProperties(host,{clientWidth:{value:850},clientHeight:{value:370}});
  const advance=()=>{clock+=100;const list=[...frames.values()];frames.clear();list.forEach(fn=>fn(clock));};
  const tests=[];for(const[type,tool]of Object.entries(c.MemoryFab.tools)){
    const viewport=c.MemoryFabView.mount(host,type);assert.equal(viewport.is3D,!!tool.view);
    for(const p of [0,.15,.22,.3,.34,.5,.82,.95,1]){viewport.update(p,true);advance();}
    if(viewport.is3D){const scene=rendered.at(-1);assert(scene);scene.traverse(o=>{assert([o.position.x,o.position.y,o.position.z,o.rotation.x,o.rotation.y,o.rotation.z].every(Number.isFinite));if(o.geometry?.attributes.position)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});viewport.camera('top');advance();}
    else {assert(host.querySelector('svg'));assert(!/NaN|undefined|Infinity/.test(host.innerHTML));}
    viewport.dispose();assert.equal(host.innerHTML,'');assert.equal(frames.size,0);tests.push({name:type+' equipment adapter, phases and resource cleanup',status:'passed'});
  }
  assert.equal(disposes,Object.values(c.MemoryFab.tools).filter(t=>t.view).length);
  return {passed:tests.length,scope:'Real Three.js scene and geometry with renderer/canvas stubs. No browser/GPU visual verification.',tests};
}

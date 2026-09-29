import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML,Event} from './linkedom.worker.mjs';

// Actual Three.js transforms; GPU drawing is stubbed and checked separately.
export async function runFabMotionTests(root){
  const tests=[],test=(name,fn)=>{fn();tests.push({name,status:'passed'});};
  const {document}=parseHTML('<div id="viewport"></div>'),create=document.createElement.bind(document);
  document.createElement=tag=>{const element=create(tag);if(tag==='canvas'){
    const gradient={addColorStop(){}};
    element.getContext=()=>({fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},fill(){},stroke(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient});
    element.setPointerCapture=()=>{};
  }return element;};
  let now=0,id=0;const frames=new Map(),resizers=[],motionPreference={matches:false};
  const sandbox={document,console,AbortController,devicePixelRatio:1,matchMedia:()=>motionPreference,performance:{now:()=>now},requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){this.fn=fn;resizers.push(fn);}observe(){this.fn();}disconnect(){}}};
  sandbox.window=sandbox;const context=vm.createContext(sandbox);
  for(const file of ['fab-engine.js','vendor/three.js','equipment-detail.js'])vm.runInContext(await fs.readFile(root+'/'+file,'utf8'),context);
  context.THREE.WebGLRenderer=class{constructor(){this.domElement=document.createElement('canvas');this.shadowMap={};this.draws=0;}setPixelRatio(){}setClearColor(){}setSize(){}render(){this.draws++;}dispose(){}};
  vm.runInContext(await fs.readFile(root+'/fab-view.js','utf8'),context);
  const E=context.FabEngine,V=context.FabViewport,host=document.getElementById('viewport');let width=1100;
  Object.defineProperties(host,{clientWidth:{get:()=>width},clientHeight:{value:500}});
  const viewport=V.mount(host),wafer=E.createWafer();
  const advance=(count=1,ms=16)=>{for(let i=0;i<count;i++){now+=ms;const queue=[...frames.values()];frames.clear();queue.forEach(fn=>fn(now));}};
  const show=(tool,percent,{running=false,speed=1}={})=>{const step=E.route.find(step=>step.tool===tool),family=E.tools[tool].family,elapsed=V.playback(family,0).seconds*percent/100,timeline=V.playback(family,elapsed);viewport.select(step);viewport.update({wafer,running,speed,elapsed,phase:timeline.phase,progress:timeline.progress,recipe:step.recipe});advance();return viewport.wafer.rotation.y;};

  test('Rotation accelerates and decelerates smoothly without reversing',()=>{
    const f=V.rotationProgress,epsilon=1e-4;assert.equal(f(0),0);assert.equal(f(1),1);
    assert(f(epsilon)/epsilon<1e-7);assert((1-f(1-epsilon))/epsilon<1e-7);
    for(let i=1;i<=1000;i++)assert(f(i/1000)>=f((i-1)/1000));
    for(const boundary of [.12,.85]){const left=(f(boundary)-f(boundary-epsilon))/epsilon,right=(f(boundary+epsilon)-f(boundary))/epsilon;assert(Math.abs(left-right)<1e-6);}
  });
  test('Spin and CMP scrubbing restores exactly the same wafer orientation',()=>{
    for(const tool of ['coat','developer','cmp']){const at65=show(tool,65);show(tool,100);show(tool,0);assert.equal(show(tool,65),at65,tool);advance(180);assert.equal(viewport.wafer.rotation.y,at65);}
  });
  test('Authoritative simulation time produces the same rotation at every render cadence and speed',()=>{
    for(const tool of ['coat','cmp']){const angle=show(tool,64,{running:true,speed:1});advance(50,8);assert.equal(viewport.wafer.rotation.y,angle);show(tool,64,{running:true,speed:8});advance(8,100);assert.equal(viewport.wafer.rotation.y,angle);}
  });
  test('Higher spindle and carrier RPM produce more visible revolutions at the same progress',()=>{
    for(const [family,low,high] of [['spin',1000,5000],['cmp',30,120]]){const a=V.processPose(family,7.8,{rpm:low}),b=V.processPose(family,7.8,{rpm:high});assert(b[family==='spin'?'spin':'head']>a[family==='spin'?'spin':'head']);}
  });
  test('Rotating tools finish aligned before robot pickup and begin the next run without a visual jump',()=>{
    for(const tool of ['coat','developer','cmp']){show(tool,72);const finished=viewport.wafer.quaternion.clone();show(tool,71.999);assert(finished.angleTo(viewport.wafer.quaternion)<1e-6);show(tool,100);const returned=viewport.wafer.quaternion.clone();show(tool,0);assert(returned.angleTo(viewport.wafer.quaternion)<1e-7,tool);}
  });
  test('Process particles rewind with the simulation clock and survive tool switching reproducibly',()=>{
    const particles=()=>{const samples=[];viewport.scene.traverse(o=>{if(o.geometry?.type==='SphereGeometry'&&o.geometry.parameters.radius===.012)samples.push([...o.position.toArray(),...o.scale.toArray()]);});return JSON.stringify(samples);};
    show('etch',64);const expected=particles();assert(JSON.parse(expected).length===45);show('etch',69);assert.notEqual(particles(),expected);show('cmp',65);show('etch',64);assert.equal(particles(),expected);
  });
  test('Paused settled scenes stop drawing and redraw for changed poses, cutaway, resize and camera input',()=>{
    show('bake',65);advance(180);let draws=viewport.renderer.draws;advance(180);assert.equal(viewport.renderer.draws,draws);
    show('bake',70);assert(viewport.renderer.draws>draws);draws=viewport.renderer.draws;viewport.cutaway(false);advance();assert(viewport.renderer.draws>draws);
    draws=viewport.renderer.draws;width=800;resizers.forEach(fn=>fn());advance();assert(viewport.renderer.draws>draws);
    draws=viewport.renderer.draws;const key=new Event('keydown',{cancelable:true});key.key='ArrowLeft';viewport.renderer.domElement.dispatchEvent(key);advance();assert(viewport.renderer.draws>draws);
  });
  test('Context restoration draws a paused scene again without changing its simulated pose',()=>{
    show('cmp',65);advance(180);const angle=viewport.wafer.rotation.y,canvas=viewport.renderer.domElement,draws=viewport.renderer.draws;
    canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));advance(30);assert.equal(viewport.renderer.draws,draws);
    canvas.dispatchEvent(new Event('webglcontextrestored'));advance();assert.equal(viewport.renderer.draws,draws+1);assert.equal(viewport.wafer.rotation.y,angle);
  });
  test('Live reduced-motion preferences end camera travel immediately and restore normal transitions when disabled',()=>{
    show('bake',65);advance(180);viewport.camera('top');advance();const moving=viewport.viewCamera.position.clone();advance(3);assert(viewport.viewCamera.position.distanceTo(moving)>.01);
    motionPreference.matches=true;advance();const stopped=viewport.viewCamera.position.clone();advance(30);assert(viewport.viewCamera.position.distanceTo(stopped)<1e-9);
    viewport.camera('wafer');advance();const selected=viewport.viewCamera.position.clone();assert(selected.distanceTo(stopped)>1);advance(30);assert(viewport.viewCamera.position.distanceTo(selected)<1e-9);
    motionPreference.matches=false;viewport.camera('equipment');advance();const resumed=viewport.viewCamera.position.clone();advance(5);assert(viewport.viewCamera.position.distanceTo(resumed)>.01);
  });
  test('Reduced camera motion keeps explicit process playback and paused process poses intact',()=>{
    motionPreference.matches=true;const start=show('coat',60,{running:true});const later=show('coat',65,{running:true});assert.notEqual(later,start);
    const paused=show('coat',65,{running:false});advance(60);assert.equal(viewport.wafer.rotation.y,paused);assert.equal(wafer.records.length,0);motionPreference.matches=false;
  });
  viewport.dispose();return {passed:tests.length,failed:0,tests};
}

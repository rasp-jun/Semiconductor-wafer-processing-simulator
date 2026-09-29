/* Original procedural equipment geometries. Functional parts are simplified for observation. */
(function(root){
  'use strict';
  const T=root.THREE,E=root.FabEngine;
  const smooth=x=>{x=Math.max(0,Math.min(1,x));return Math.max(0,Math.min(1,x*x*x*(x*(x*6-15)+10)));};
  // Shared phase curves keep loading, conditioning, processing and unloading continuous.
  function motion(phase,progress){
    const p=Math.max(0,Math.min(1,progress||0));
    const transfer=phase==='load'?p:phase==='unload'?Math.max(0,1-Math.max(0,(p-.35)/.6)):phase==='idle'?0:1;
    const travel=smooth((transfer-.18)/.64),rise=smooth(transfer/.18),lower=smooth((transfer-.82)/.18);
    const processing=phase==='process'?smooth(p/.12)*(1-smooth((p-.85)/.15)):0;
    const closed=phase==='condition'?smooth((p-.55)/.45):phase==='process'?1:phase==='unload'?1-smooth(p/.1):0;
    const nozzle=phase==='condition'?smooth((p-.55)/.45):phase==='process'?1-smooth((p-.62)/.2):0;
    return {transfer,travel,rise,lower,processing,closed,nozzle,orientation:smooth((transfer-.44)/.18)};
  }
  // Wet transfer is owned by the clamped tilting carrier, never a bare fork.
  function wetMotion(phase,progress){
    const p=Math.max(0,Math.min(1,progress||0));
    if(phase==='condition')return {tilt:smooth((p-.45)/.25),dip:smooth((p-.75)/.25),x:0,clamp:smooth(p/.12),transfer:1};
    if(phase==='process')return {tilt:1,dip:p<.55?1:p<.65?1-smooth((p-.55)/.1):p<.8?0:smooth((p-.8)/.1),x:1.86*smooth((p-.67)/.11),clamp:1,transfer:1};
    if(phase==='unload')return {tilt:1-smooth((p-.3)/.1),dip:1-smooth(p/.12),x:1.86*(1-smooth((p-.23)/.06)),clamp:1-smooth((p-.52)/.03),transfer:Math.max(0,1-Math.max(0,(p-.55)/.4))};
    return {tilt:0,dip:0,x:0,clamp:0,transfer:phase==='load'?p:0};
  }
  function playback(family,elapsed){
    const seconds=family==='wet'?20:12,bounds=family==='wet'?[0,.2,.4,.6,1]:[0,.3,.52,.72,1],total=Math.max(0,Math.min(1,elapsed/seconds));
    let i=0;while(i<3&&total>=bounds[i+1])i++;
    return {seconds,bounds,total,phase:['load','condition','process','unload'][i],progress:Math.max(0,Math.min(1,(total-bounds[i])/(bounds[i+1]-bounds[i])))};
  }
  function reactionProgress(family,phase,progress){return phase==='process'?Math.min(1,Math.max(0,progress)/(family==='wet'?.55:1)):phase==='unload'?1:0;}
  // Integrate the same acceleration envelope used for process effects. A pose
  // depends on simulation time, so seeking and slow frames cannot change it.
  function rotationProgress(progress){
    const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
    const integral=t=>t*t*t*t*(t*t-3*t+2.5);
    const area=p<.12?.12*integral(p/.12):p<=.85?p-.06:.79+(p-.85)-.15*integral((p-.85)/.15);
    return Math.max(0,Math.min(1,area/.865));
  }
  function processPose(family,elapsed,recipe={}){
    const timeline=playback(family,elapsed),p=timeline.phase==='process'?timeline.progress:timeline.phase==='unload'?1:0;
    const duration=(timeline.bounds[3]-timeline.bounds[2])*timeline.seconds;
    const spinFactor=Math.min(1.7,Math.max(.4,(recipe.rpm||3000)/3000)),headFactor=Math.min(2,Math.max(.5,(recipe.rpm||60)/60));
    // Finish at an indexed angle before transfer. These are visible teaching
    // rotations, not a claim to reproduce the recipe RPM at wall-clock speed.
    const spinTurns=Math.max(1,Math.round(duration*.865*6*spinFactor/(2*Math.PI)));
    const headTurns=Math.max(1,Math.round(duration*.865*6*headFactor/(2*Math.PI)));
    const rotation=rotationProgress(p);
    return {clock:duration*p,spin:2*Math.PI*spinTurns*rotation,head:2*Math.PI*headTurns*rotation,platen:-2*Math.PI*Math.max(1,Math.round(headTurns*.7))*rotation};
  }
  function observationStops(family){
    const {seconds,bounds}=playback(family,0),edge=['cmp','implant'].includes(family);
    const phases=family==='wet'?[[.1,.4,.62,.84,1],[.12,.4,.7,1],[.55,.65,.8,1],[.12,.22,.4,.52,.55,.91,1]]:[[.1,.4,...(edge?[.44]:[]),.62,.84,1],[...(edge?[.1]:[]),.4,.55,1],[.5,1],[.1,.35,...(edge?[.42]:[]),edge?.906:.89,1]];
    if(['scanner','metrology','probe'].includes(family))phases[2]=[...Array.from({length:4},(_,i)=>[.35,.6,.985].map(local=>(i+local)*.225)).flat(),1];
    return phases.flatMap((points,i)=>points.map(p=>(bounds[i]+(bounds[i+1]-bounds[i])*p)*seconds));
  }
  function stageMotion(progress){
    const p=Math.max(0,Math.min(1,progress||0)),sites=[[-.22,-.16],[.22,-.16],[.22,.16],[-.22,.16]];
    if(p>=.9){const t=1-smooth((p-.9)/.1);return {x:sites[3][0]*t,z:sites[3][1]*t,contact:0,site:4,action:p===1?'home':'return'};}
    const index=Math.min(3,Math.floor(p/.225)),local=(p-index*.225)/.225,from=index?sites[index-1]:[0,0],to=sites[index],travel=smooth(local/.32);
    return {x:from[0]+(to[0]-from[0])*travel,z:from[1]+(to[1]-from[1])*travel,contact:smooth((local-.38)/.12)*(1-smooth((local-.85)/.12)),site:index+1,action:local<.32?'move':local<.38?'settle':local<.5?'engage':local<.85?'hold':local<.97?'release':'ready'};
  }
  function mount(host,{onInspect=()=>{},onContextLoss=()=>{},presentation='default'}={}){
    const motionPreference=root.matchMedia?.('(prefers-reduced-motion: reduce)'),consoleScene=presentation==='console',sceneColor=consoleScene?0x161b21:0x19251f;
    let renderer;try{if(!T)throw Error('WebGL unavailable');renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch{host.innerHTML='<div class="webgl-fallback">3D 장비 표시에는 WebGL이 필요합니다.<br>공정 계산·단면·기록은 계속 사용할 수 있습니다.</div>';return {select(){},update(){},camera(){},cutaway(){},parts:()=>[]};}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.setClearColor(sceneColor);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;host.prepend(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','공정별 3D 장비. 클릭 또는 Enter로 장비 설명, 드래그로 회전, 휠로 확대.');renderer.domElement.setAttribute('aria-haspopup','dialog');renderer.domElement.setAttribute('aria-controls','equipmentDialog');
    let disposed=false,contextLost=false,dirty=true;const listeners=[],recovery=document.createElement('div');recovery.className='webgl-recovery';recovery.setAttribute('role','status');recovery.textContent='3D 연결을 복구하고 있습니다. 완료 기록과 단면 계산은 유지됩니다.';
    function listen(type,handler,options){renderer.domElement.addEventListener(type,handler,options);listeners.push(()=>renderer.domElement.removeEventListener(type,handler,options));}
    listen('webglcontextlost',event=>{event.preventDefault();contextLost=true;host.append(recovery);onContextLoss();});
    listen('webglcontextrestored',()=>{contextLost=false;renderer.setClearColor(sceneColor);dirty=true;recovery.remove();});
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.1,100),target=new T.Vector3(0,2,0),desiredTarget=target.clone();
    scene.fog=new T.Fog(sceneColor,24,55);if(root.WaferHardware?.environment){scene.environment=root.WaferHardware.environment(T);scene.environmentIntensity=.8;}
    scene.add(new T.HemisphereLight(0xe5f3ff,0x3b4848,1.1));const key=new T.DirectionalLight(0xffeedf,2.9);key.position.set(-5,11,8);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7});key.shadow.normalBias=.02;scene.add(key);const fill=new T.DirectionalLight(0x9bceff,1.2);fill.position.set(6,7,-7);scene.add(fill);
    const mat={white:new T.MeshPhysicalMaterial({color:0xc9d6d9,metalness:.35,roughness:.29,clearcoat:.3}),steel:new T.MeshStandardMaterial({color:0xaebfc9,metalness:.93,roughness:.22}),dark:new T.MeshStandardMaterial({color:0x253e4d,metalness:.6,roughness:.32}),black:new T.MeshStandardMaterial({color:0x102129,roughness:.5,metalness:.3}),green:new T.MeshStandardMaterial({color:0xa9c794,roughness:.35,metalness:.35}),ceramic:new T.MeshPhysicalMaterial({color:0xe5e1d7,roughness:.24,clearcoat:.25}),glass:new T.MeshPhysicalMaterial({color:0x86b5c9,transparent:true,opacity:.15,depthWrite:false,roughness:.12,side:T.DoubleSide}),amber:new T.MeshBasicMaterial({color:0xe8a25b,transparent:true,opacity:.12,depthWrite:false}),purple:new T.MeshBasicMaterial({color:0xb88bff,transparent:true,opacity:.22,depthWrite:false,blending:T.AdditiveBlending}),cyan:new T.MeshBasicMaterial({color:0x81dae7,transparent:true,opacity:.35,depthWrite:false,blending:T.AdditiveBlending})};
    if(consoleScene){for(const [key,color] of Object.entries({white:0xe0e4dc,steel:0xa8b7ba,dark:0x23383d,black:0x162626,green:0x709d89,ceramic:0xe9e0ca}))mat[key].color.set(color);}
    const boxGeo=root.WaferHardware?.roundedGeometry(T)||new T.BoxGeometry(1,1,1),plainBox=new T.BoxGeometry(1,1,1);
    function mesh(parent,geometry,material,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=!material.transparent;m.receiveShadow=true;parent.add(m);return m;}
    function box(g,x,y,z,w,h,d,m=mat.white){const s=mesh(g,Math.min(w,h,d)>.13?boxGeo:plainBox,m,x,y,z);s.scale.set(w,h,d);return s;}
    function cyl(g,x,y,z,r,h,m=mat.steel){return mesh(g,new T.CylinderGeometry(r,r,h,48),m,x,y,z);}
    function ring(g,x,y,z,r,t=.025,m=mat.steel){const o=mesh(g,new T.TorusGeometry(r,t,8,64),m,x,y,z);o.rotation.x=Math.PI/2;return o;}
    function pipe(g,points,r=.035,m=mat.steel){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return mesh(g,new T.TubeGeometry(curve,40,r,8,false),m);}
    function bolts(g,r,y,count=12){for(let i=0;i<count;i++){const a=i/count*Math.PI*2;const b=cyl(g,Math.cos(a)*r,y,Math.sin(a)*r,.035,.035);}}
    function decal(g,title,subtitle,x,y,z,w=1.8){const c=document.createElement('canvas');c.width=512;c.height=144;const ctx=c.getContext('2d');ctx.fillStyle='#17313e';ctx.fillRect(0,0,512,144);ctx.fillStyle='#a8d8bc';ctx.fillRect(20,23,5,95);ctx.fillStyle='#dbe8ec';ctx.font='bold 31px sans-serif';ctx.fillText(title,42,62);ctx.font='17px monospace';ctx.fillStyle='#96b6c3';ctx.fillText(subtitle,43,101);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const o=mesh(g,new T.PlaneGeometry(w,w*144/512),new T.MeshBasicMaterial({map:tex}),x,y,z);o.castShadow=false;return o;}
    const floor=box(scene,0,-.18,0,consoleScene?34:24,.2,consoleScene?30:20,new T.MeshStandardMaterial({color:consoleScene?0x252e39:0x293b2e,metalness:.22,roughness:.64}));
    const grid=new T.GridHelper(consoleScene?32:24,consoleScene?64:48,consoleScene?0x738497:0x61765a,consoleScene?0x414e5d:0x3a503b);grid.position.y=-.072;grid.material.transparent=true;grid.material.opacity=.23;scene.add(grid);
    let equipment=new T.Group();scene.add(equipment);let shell=[],effects=[],parts=[],animated={},currentStep=null,frameState=null,cut=true,activePoint=new T.Vector3(0,1.74,0),waferOrientation=new T.Euler(),clock=0;
    function cabinet(g,w=3.6,h=1.4,d=2.6){box(g,0,h/2,0,w,h,d);box(g,0,h+.04,0,w+.08,.1,d+.08,mat.steel);for(const x of [-w*.25,w*.25]){box(g,x,h*.49,d/2+.013,w*.44,h*.83,.025,mat.white);box(g,x+.1,h*.57,d/2+.038,.036,.29,.028,mat.dark);for(let i=0;i<5;i++)box(g,x,h*.2+i*.06,d/2+.04,w*.3,.023,.014,mat.dark);}for(const x of [-w*.4,w*.4])for(const z of [-d*.38,d*.38])cyl(g,x,.02,z,.12,.1,mat.black);}
    function cover(g,x,y,z,w,h,d){const m=mat.white.clone();m.transparent=true;m.opacity=cut?.07:1;m.depthWrite=!cut;const o=box(g,x,y,z,w,h,d,m);o.castShadow=!cut;shell.push(o);return o;}
    function effect(g,shape,m,x,y,z){const o=mesh(g,shape,m.clone(),x,y,z);o.castShadow=false;effects.push(o);return o;}
    const slotY=2.05,waferRadius=.75;
    function foup(g,x=-3.1,z=1.1){
      const f=new T.Group();f.name='foup';f.position.set(x,0,z);g.add(f);cabinet(f,2,1.1,2.05);
      box(f,0,1.16,0,1.94,.1,1.98,mat.steel);
      for(const side of [-1,1])box(f,side*.94,1.98,0,.055,1.56,1.85,mat.glass);
      box(f,0,1.98,-.92,1.9,1.56,.05,mat.glass);box(f,0,2.79,0,1.94,.07,1.9,mat.glass);
      for(let i=0;i<10;i++){
        const y=1.35+i*.14;
        for(const side of [-1,1]){const ledge=box(f,side*.78,y-.028,0,.14,.026,1.02,mat.ceramic);ledge.name='foup-slot-'+i;}
        // Slot 5 belongs to the actual moving wafer. Never duplicate that wafer.
        if(i!==5){const stored=cyl(f,0,y,0,waferRadius,.03,mat.dark);stored.name='stored-wafer-'+i;}
      }
      decal(f,'LOAD PORT','SLOT 06 / ACTIVE WAFER',0,.8,1.04,1.7);
    }
    function chamber(g,mode){cabinet(g);cyl(g,0,1.53,0,1.14,.15,mat.dark);cyl(g,0,1.7,0,.85,.14,mat.steel);ring(g,0,1.6,0,1.17,.045);bolts(g,1.08,1.65,16);cyl(g,0,2.98,0,1.12,.18);ring(g,0,2.86,0,1.08,.045);bolts(g,1.02,3.09,16);const wall=mesh(g,new T.CylinderGeometry(1.08,1.08,1.14,64,1,true,Math.PI*.28,Math.PI*1.44),mat.glass,0,2.25,0);shell.push(wall);cyl(g,0,2.77,0,.89,.08,mode==='pvd'?mat.ceramic:mat.dark);for(let i=0;i<6;i++)ring(g,0,2.718,0,.14+i*.13,.006,mat.steel);pipe(g,[[0,3.15,0],[0,3.36,-.6],[1.35,3.36,-.83],[1.35,1.5,-.83]],.05);pipe(g,[[.94,1.85,0],[1.5,1.85,0],[1.65,1.45,-.7]],.11);box(g,1.65,1.6,-.73,.4,.44,.48,mat.dark);const glow=effect(g,new T.SphereGeometry(.85,32,16),mode==='pvd'?mat.cyan:mat.purple,0,2.27,0);glow.scale.y=.44;animated.plasma=glow;const dots=new T.Group();g.add(dots);for(let i=0;i<45;i++){const a=i*2.399,r=Math.sqrt((i+.5)/45)*.77;const dot=mesh(dots,new T.SphereGeometry(.012,5,4),mode==='pvd'?mat.green:mat.cyan,Math.cos(a)*r,2.4,Math.sin(a)*r);dot.userData.phase=i/45;dot.castShadow=false;}animated.particles=dots;const gate=new T.Group();gate.name='chamber-gate';g.add(gate);box(gate,0,1.99,1.1,1.78,.38,.08,mat.steel);for(const x of [-.94,.94])box(g,x,2.26,1.1,.08,1.06,.12,mat.dark);animated.gate=gate;activePoint.set(0,1.79,0);parts=[['상부 전극 / 타깃',[0,2.86,0]],['정전 척',[0,1.66,0]],['진공 배기 라인',[1.45,1.8,-.3]]];}
    // Static Blender hardware and original animated mechanisms share one coordinate system.
    const precisionAssets=new Map(),precisionLoads=new Map();
    const operationDisplay=consoleScene?root.CmosOperationView?.create(T,host):null;
    let staticHardware=[],detailedHardware=null,hardwareTool=null,liveMechanisms=null,processMechanisms=null;
    // The exterior has a load-port-aligned handler and a local observation lens;
    // the full front-aisle teaching robot stays in the explicit internal view.
    function applyProcessVisibility(){
      if(!consoleScene)return;
      const active=!!frameState&&frameState.phase!=='idle';
      if(processMechanisms){
        processMechanisms.visible=cut||['clean','wetetch','lpcvd','developer','bake','scanner','metrology','probe'].includes(hardwareTool);
        if(processMechanisms.userData.shadowView!==cut){processMechanisms.traverse(o=>{if(o.isMesh){o.userData.internalCastShadow??=o.castShadow;o.castShadow=cut&&o.userData.internalCastShadow;}});processMechanisms.userData.shadowView=cut;}
      }
      wafer.visible=cut;
      if(exteriorWafer)exteriorWafer.visible=!cut&&active;
      if(exteriorHandler)exteriorHandler.visible=!cut&&active&&exteriorHandler.userData.engaged;
    }
    function assetStatus(status){host.dataset.assetStatus=status;host.dispatchEvent(new CustomEvent('equipmentasset',{detail:{status,tool:hardwareTool}}));}
    function applyEnvelope(){
      if(!consoleScene)return;
      detailedHardware?.traverse(o=>{if(o.userData.equipmentRole==='exterior')o.visible=!cut;});
      if(liveMechanisms)liveMechanisms.visible=cut;
      if(typeof wafer!=='undefined')applyProcessVisibility();
      if(typeof transfer!=='undefined')transfer.visible=cut;
      operationDisplay?.update(hardwareTool,frameState,cut);
      host.dataset.equipmentView=cut?'mechanism':'exterior';dirty=true;
    }
    const assetAbort=typeof AbortController==='function'?new AbortController():null;
    function attachPrecisionAsset(tool){
      if(disposed||tool!==hardwareTool||!precisionAssets.has(tool)||!staticHardware.length||detailedHardware)return;
      const model=new T.ObjectLoader().parse(precisionAssets.get(tool));
      model.traverse(object=>{if(!object.isMesh)return;object.castShadow=!object.material.transparent;object.receiveShadow=true;
        // Transparent surfaces must not mask later surfaces in the material-grouped mesh.
        if(object.material.transparent){object.material.depthWrite=false;object.material.forceSinglePass=true;}
        if(object.userData.cutawayShell){object.material.transparent=true;object.material.opacity=cut?.07:1;object.material.depthWrite=!cut;object.castShadow=!cut;shell.push(object);}
      });
      liveMechanisms=new T.Group();liveMechanisms.name='axis-live-mechanisms';
      [...equipment.children].forEach(object=>liveMechanisms.add(object));equipment.add(liveMechanisms);
      processMechanisms=new T.Group();processMechanisms.name='axis-process-mechanisms';
      const movingRoots=new Set();
      for(const object of [...effects,...Object.values(animated).flat()]){
        if(!object?.isObject3D)continue;
        let top=object;while(top.parent&&top.parent!==liveMechanisms)top=top.parent;
        if(top.parent===liveMechanisms)movingRoots.add(top);
      }
      movingRoots.forEach(object=>processMechanisms.add(object));equipment.add(processMechanisms);
      detailedHardware=model;equipment.add(model);staticHardware.forEach(object=>object.visible=false);
      if(operationDisplay)equipment.add(operationDisplay.attach(tool,model));
      host.dataset.precisionModel='blender';host.dataset.precisionTool=tool;applyEnvelope();setCamera(cameraMode);assetStatus('ready');dirty=true;
    }
    function requestPrecisionAsset(tool){
      if(precisionAssets.has(tool)){attachPrecisionAsset(tool);return;}
      if(precisionLoads.has(tool)||!root.fetch)return;
      assetStatus('loading');
      const stem=tool==='etch'?'icp-chamber':'equipment-'+tool;
      const pending=Promise.all(['json','bin'].map(extension=>root.fetch('assets/cmos/'+stem+'.'+extension+'?v=axis3',{signal:assetAbort?.signal}).then(response=>{if(!response.ok)throw Error('Equipment asset unavailable');return extension==='json'?response.json():response.arrayBuffer();}))).then(async([data,buffer])=>{
        if(disposed)return;
        if(data.metadata?.bufferFormat!=='waferflow-three-buffer-v1')throw Error('Unknown equipment buffer format');
        if(data.metadata.bufferByteLength!==buffer.byteLength)throw Error('Mismatched equipment asset length');
        if(root.crypto?.subtle){const digest=await root.crypto.subtle.digest('SHA-256',buffer),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==data.metadata.bufferSha256)throw Error('Mismatched equipment asset checksum');}
        if(disposed)return;
        for(const geometry of data.geometries){for(const attribute of [...Object.values(geometry.data.attributes),geometry.data.index]){
          const ArrayType=attribute.type==='Float32Array'?Float32Array:attribute.type==='Uint32Array'?Uint32Array:null;
          const {byteOffset,length}=attribute.array;
          if(!ArrayType||!Number.isInteger(byteOffset)||byteOffset<0||byteOffset%4||!Number.isInteger(length)||length<0||byteOffset+length*4>buffer.byteLength)throw Error('Invalid equipment geometry buffer');
          attribute.array=new ArrayType(buffer,byteOffset,length);
        }}
        precisionAssets.set(tool,data);
        // Retain a small CPU cache; GPU resources are disposed by build() on each tool change.
        if(precisionAssets.size>4)precisionAssets.delete(precisionAssets.keys().next().value);
        attachPrecisionAsset(tool);
      }).catch(()=>{if(!disposed&&hardwareTool===tool){host.dataset.precisionModel='procedural';assetStatus('fallback');}}).finally(()=>precisionLoads.delete(tool));
      precisionLoads.set(tool,pending);
    }
    function collectStaticHardware(){
      const moving=new Set(effects);
      for(const value of Object.values(animated)){if(Array.isArray(value))value.forEach(object=>moving.add(object));else if(value?.isObject3D)moving.add(value);}
      const items=[];
      function visit(object){if(moving.has(object))return;if(object.isMesh)items.push(object);for(const child of object.children)visit(child);}
      for(const child of equipment.children)visit(child);
      return items;
    }
    function build(step){
      dirty=true;
      if(currentStep?.tool===step.tool){currentStep=step;paintKey='';return;}
      operationDisplay?.reset();
      processMechanisms=null;
      const geometries=new Set(),ownedMats=new Set();equipment.traverse(o=>{if(o.geometry&&o.geometry!==boxGeo&&o.geometry!==plainBox)geometries.add(o.geometry);if(o.material&&!Object.values(mat).includes(o.material))ownedMats.add(o.material);});scene.remove(equipment);geometries.forEach(g=>g.dispose());ownedMats.forEach(m=>{m.map?.dispose();m.dispose();});equipment=new T.Group();scene.add(equipment);shell=[];effects=[];parts=[];animated={};staticHardware=[];detailedHardware=null;liveMechanisms=null;hardwareTool=step.tool;host.dataset.precisionModel='procedural';delete host.dataset.precisionTool;waferOrientation.set(0,0,0);activePoint.set(0,1.8,0);const g=equipment,family=E.tools[step.tool].family;
      if(family==='furnace'){
        cabinet(g,3.2,1.1,2.6);
        for(const x of [-1.4,1.4]){box(g,x,3.45,-.8,.15,4.65,.18,mat.steel);cover(g,x,4.26,0,.14,2.95,2.5);}
        box(g,0,5.77,0,3.1,.2,2.6);cyl(g,0,4.25,0,1.12,2.8,mat.glass);
        for(let i=0;i<19;i++)ring(g,0,2.93+i*.145,0,1.15,.026,i%5===0?mat.green:mat.steel);
        ring(g,0,2.86,0,1.18,.055);cyl(g,0,5.68,0,1.2,.15);
        const boat=new T.Group();boat.name='furnace-boat';g.add(boat);
        cyl(boat,0,1.25,0,1.12,.15,mat.ceramic);
        for(const x of [-.84,.84])box(boat,x,2.04,-.15,.055,1.63,.07,mat.ceramic);
        for(let i=0;i<11;i++){
          const y=1.45+i*.12;
          for(const x of [-.75,.75])box(boat,x,y-.026,0,.15,.024,.42,mat.ceramic);
          if(i!==5){const other=cyl(boat,0,y,0,waferRadius,.03,mat.dark);other.name='boat-wafer-'+i;}
        }
        box(boat,0,1.19,-.88,2.65,.12,.3,mat.steel);
        animated.boat=boat;activePoint.set(0,2.05,0);
        const glow=effect(g,new T.CylinderGeometry(1.06,1.06,2.7,48,1,true),mat.amber,0,4.25,0);animated.heat=glow;
        pipe(g,[[-1.12,5.48,-.4],[-1.6,5.48,-.7],[-1.65,1.2,-.8]],.05);
        parts=[['석영 반응관',[0,4.3,0]],['승강 웨이퍼 보트',[0,2.3,0]],['다중 가열 존',[1.1,4.2,0]]];
      }else if(family==='spin'){
        cabinet(g,3.5,1.45,2.8);cyl(g,0,1.6,0,1.12,.2,mat.dark);mesh(g,new T.CylinderGeometry(1.17,.83,.37,64,1,true),mat.ceramic,0,1.76,0);for(const r of [1.04,1.13,1.22])ring(g,0,1.94,0,r,.028);cyl(g,0,1.8,0,.47,.13,mat.dark);const nozzle=new T.Group();nozzle.position.set(.98,0,-.64);g.add(nozzle);pipe(nozzle,[[0,1.5,0],[0,2.7,0],[-.98,2.7,.64]],.05);cyl(nozzle,-.98,2.58,.64,.06,.2,mat.ceramic);animated.nozzle=nozzle;animated.stream=effect(g,new T.CylinderGeometry(.018,.018,.58,10),step.tool==='coat'?new T.MeshBasicMaterial({color:0xdb91b4,transparent:true,opacity:.8}):mat.cyan,0,2.17,0);for(const x of [-1.62,1.62])box(g,x,2.28,-1.28,.06,1.65,.06,mat.steel);cover(g,0,3.1,0,3.45,.08,2.7);box(g,0,2.3,-1.33,3.4,1.6,.06,mat.dark);pipe(g,[[1,1.6,.6],[1.42,1.4,.9],[1.42,.7,1]],.065,mat.dark);activePoint.set(0,1.88,0);parts=[['처리액 디스펜스 노즐',[0,2.5,0]],['진공 스핀 척',[0,1.78,0]],['스플래시 컵 / 배액',[1,1.8,.7]]];
      }else if(family==='scanner'){
        cabinet(g,4.4,1.45,3.3);for(const x of [-1.65,1.65])box(g,x,2.6,-.65,.3,2.25,.35);box(g,0,3.73,-.5,3.65,.3,.85);cyl(g,0,3.37,0,.56,.8,mat.white);for(let i=0;i<6;i++)ring(g,0,3.03+i*.12,0,.58,.035);cyl(g,0,2.83,0,.35,.2,mat.dark);box(g,0,4.4,0,1.65,.05,1.65,mat.glass);for(const x of [-.9,.9])box(g,x,4.12,-.7,.1,.55,.1,mat.steel);for(const x of [-.9,.9])box(g,x,4.4,0,.12,.13,1.9,mat.steel);for(const z of [-.9,.9])box(g,0,4.4,z,1.75,.13,.12,mat.steel);for(let i=0;i<8;i++)box(g,-.7+i*.2,4.436,0,.07,.006,1.4,mat.dark);const stage=new T.Group();g.add(stage);box(stage,0,1.65,0,2.2,.15,1.9,mat.dark);cyl(stage,0,1.78,0,.84,.12);animated.stage=stage;for(const z of [-1,1])box(g,0,1.57,z,3.1,.1,.12,mat.steel);animated.beam=effect(g,new T.CylinderGeometry(.34,.83,.9,48,1,true),mat.purple,0,2.27,0);activePoint.set(0,1.855,0);parts=[['투영 광학계',[0,3.25,0]],['레티클 / 포토마스크',[.5,4.4,.4]],['정렬 웨이퍼 스테이지',[0,1.7,.8]]];
      }else if(['etch','pvd','cluster'].includes(family)){
        chamber(g,family==='pvd'?'pvd':'etch');if(step.tool==='ald'){animated.plasma.material.color.set(0x88c5bc);animated.plasma.material.opacity=.045;}if(family==='cluster'){for(const x of [-2.05,2.05]){const aux=new T.Group();aux.position.set(x,0,-.8);g.add(aux);cyl(aux,0,.8,0,.77,1.5,mat.dark);cyl(aux,0,1.75,0,.76,.36);ring(aux,0,1.95,0,.73,.045);pipe(g,[[x*.62,1.75,-.35],[x,1.75,-.8]],.22,mat.steel);}parts[0]=['가스 분배판 / 반응 구역',[0,2.75,0]];}
      }else if(family==='implant'){
        cabinet(g,5.6,1.35,2.55);box(g,-2.05,2.4,0,.9,1.45,1.1,mat.dark);cyl(g,-2.05,3.2,0,.2,.3,mat.ceramic);pipe(g,[[-1.6,2.35,0],[-.8,2.35,0],[0,2.35,-.65],[.8,2.35,-.65],[1.5,2.35,0]],.22);for(const x of [-1.35,-.85]){const ringObj=ring(g,x,2.35,0,.3,.045);ringObj.rotation.set(0,Math.PI/2,0);}box(g,.05,2.35,-.65,.9,.9,.9,mat.green);const chamberMesh=mesh(g,new T.CylinderGeometry(.97,.97,.65,48,1,true,Math.PI*.34,Math.PI*1.32),mat.glass,1.62,2.35,0);chamberMesh.rotation.z=Math.PI/2;const back=cyl(g,2.02,2.35,0,.97,.13);back.rotation.z=Math.PI/2;const front=ring(g,1.25,2.35,0,1,.055);front.rotation.set(0,Math.PI/2,0);animated.beam=effect(g,new T.TubeGeometry(new T.CatmullRomCurve3([[-1.65,2.35,0],[-.8,2.35,0],[0,2.35,-.65],[.8,2.35,-.65],[1.5,2.35,0]].map(p=>new T.Vector3(...p))),48,.055,8,false),mat.cyan,0,0,0);activePoint.set(1.6,2.35,0);waferOrientation.z=Math.PI/2;const chuck=cyl(g,1.72,2.35,0,.72,.2,mat.dark);chuck.rotation.z=Math.PI/2;chuck.name='implant-chuck';const door=new T.Group();door.name='implant-transfer-door';g.add(door);box(door,1.62,2.35,1.02,.68,1.65,.045,mat.glass);animated.implantDoor=door;for(const x of [.35,2.1])box(g,x,2.31,1.08,.07,1.86,.08,mat.dark);box(g,1.2,3.26,1.08,1.82,.09,.12,mat.steel);const shaft=cyl(g,1.9,2.35,0,.16,.24,mat.steel);shaft.rotation.z=Math.PI/2;parts=[['이온 소스',[-2,2.65,0]],['질량 분석 자석',[0,2.4,-.65]],['틸트 / 스캔 엔드스테이션',[1.6,2.35,0]]];
      }else if(family==='cmp'){
        cabinet(g,4.5,1.2,3.3);const platen=new T.Group();g.add(platen);animated.platen=platen;
        cyl(platen,0,1.32,0,1.48,.15,mat.dark);cyl(platen,0,1.414,0,1.42,.028,mat.ceramic);
        for(let r=.15;r<1.4;r+=.12)ring(platen,0,1.435,0,r,.004,mat.dark);
        for(let i=0;i<12;i++){const a=i*Math.PI/6,line=box(platen,Math.cos(a)*.77,1.435,Math.sin(a)*.77,1.22,.003,.008,mat.dark);line.rotation.y=-a;}
        box(g,1.56,2.32,-.72,.25,2.2,.27);box(g,.75,3.48,-.5,1.9,.18,.24,mat.steel);box(g,.35,3.48,-.2,.25,.18,.95,mat.steel);
        const lift=new T.Group();lift.name='cmp-carrier-lift';g.add(lift);animated.headLift=lift;
        const head=new T.Group();head.position.set(.35,0,.1);lift.add(head);animated.head=head;
        const housing=cyl(head,0,2.39,0,.82,.79,mat.glass);shell.push(housing);
        cyl(head,0,2.005,0,.72,.05,mat.dark);animated.retainingRing=ring(head,0,1.99,0,.82,.04,mat.steel);
        cyl(head,0,2.92,0,.13,.3,mat.steel);
        const piston=cyl(g,.35,3.16,.1,.09,.62,mat.steel);piston.name='cmp-piston';animated.headPiston=piston;
        pipe(g,[[-1.65,1.26,-.4],[-1.65,2.25,-.4],[-.55,2.25,-.15]],.04);
        animated.stream=effect(g,new T.CylinderGeometry(.017,.017,.8,10),mat.cyan,-.55,1.83,-.15);
        activePoint.set(.35,1.965,.1);waferOrientation.z=Math.PI;
        parts=[['회전 플래튼 / 연마 패드',[0,1.4,.9]],['승강 캐리어 헤드',[.35,2.39,.1]],['슬러리 노즐',[-.55,2.25,-.15]]];
      }else if(family==='hotplate'||family==='rtp'){
        cabinet(g,3.35,1.45,2.6);cyl(g,0,1.61,0,1,.18,mat.dark);cyl(g,0,1.77,0,.88,.12,mat.ceramic);
        // Cover, support crosshead, heater and exhaust sleeve form one driven assembly.
        for(const x of [-1.25,1.25]){box(g,x,2.5,-.64,.13,2.08,.17,mat.dark);cyl(g,x,2.54,-.49,.045,2.02,mat.steel);}
        box(g,0,3.57,-.57,2.7,.16,.34,mat.white);
        const lid=new T.Group();lid.name='thermal-cover';lid.position.y=2.75;g.add(lid);animated.lid=lid;
        cyl(lid,0,0,0,1.04,.15,mat.white);ring(lid,0,-.105,0,1,.04,mat.steel);
        box(lid,0,.12,-.5,2.64,.15,.26,mat.steel);
        for(const x of [-1.25,1.25])box(lid,x,.12,-.57,.23,.28,.26,mat.steel);
        animated.lidPistons=[-1.1,1.1].map(x=>{const rod=cyl(g,x,3.22,-.5,.04,.6,mat.steel);rod.name='cover-lift-rod';return rod;});
        pipe(g,[[0,3.69,-.8],[0,3.69,-1.2],[1.42,3.69,-1.2],[1.42,1.5,-1.2]],.055);
        animated.exhaustSleeve=cyl(g,0,3.22,-.8,.055,.76,mat.steel);
        if(family==='rtp'){
          const windowPane=cyl(lid,0,-.18,0,.84,.025,mat.glass);windowPane.name='rtp-window';
          for(let i=-3;i<=3;i++){const lamp=effect(lid,new T.CylinderGeometry(.04,.04,1.65,12),mat.amber,i*.23,-.12,0);lamp.rotation.x=Math.PI/2;lamp.name='rtp-lamp';for(const z of [-.79,.79])box(lid,i*.23,-.12,z,.1,.1,.08,mat.ceramic);}
          parts=[['커버 일체형 램프 배열',[0,2.63,0]],['석영 윈도',[0,2.57,0]],['온도 계측 위치',[.92,1.8,.1]]];
        }else parts=[['히팅 플레이트',[0,1.78,0]],['가이드 레일 / 승강 커버',[0,2.75,0]],['온도 제어부',[.85,1.7,.4]]];
        activePoint.set(0,1.845,0);
      }else if(family==='wet'){
        cabinet(g,4.1,1.1,2.8);
        for(const x of [-.93,.93]){box(g,x,1.24,0,1.82,.1,2.1,mat.ceramic);for(const sx of [-1,1])box(g,x+sx*.87,2.16,0,.06,1.84,2.05,mat.glass);for(const z of [-1,1])box(g,x,2.16,z,1.74,1.84,.055,mat.glass);box(g,x,2.09,0,1.68,1.65,1.94,new T.MeshPhysicalMaterial({color:0x66b7c3,transparent:true,opacity:.16,depthWrite:false,roughness:.15}));}
        box(g,0,5.25,-.93,3.95,.16,.23,mat.steel);for(const x of [-1.88,1.88])box(g,x,3.16,-.93,.14,4.05,.16);
        const carrier=new T.Group();carrier.name='wet-carrier';carrier.position.set(-.93,4,0);g.add(carrier);animated.wetCarrier=carrier;
        box(carrier,0,.91,-.85,1.65,.1,.12,mat.steel);
        for(const x of [-.79,.79]){box(carrier,x,.45,-.85,.075,.92,.09,mat.steel);box(carrier,x,0,-.4,.075,.09,.88,mat.steel);const axle=cyl(carrier,x,0,0,.07,.08,mat.steel);axle.rotation.z=Math.PI/2;}
        const cradle=new T.Group();cradle.name='wet-tilt-cradle';carrier.add(cradle);animated.wetCradle=cradle;
        ring(cradle,0,-.1,0,.79,.018,mat.ceramic);
        animated.wetClamps=[];
        for(const a of [0,Math.PI,Math.PI*1.5]){const support=new T.Group();support.rotation.y=-a;cradle.add(support);box(support,.72,-.07,0,.14,.11,.1,mat.ceramic);const jaw=box(support,.84,.025,0,.12,.055,.09,mat.green);jaw.name='wet-edge-clamp';animated.wetClamps.push(jaw);}
        const drive=box(carrier,-.77,0,0,.1,.18,.18,mat.dark);drive.name='wet-tilt-drive';
        animated.wetRod=cyl(g,-.93,5.08,-.85,.04,.35,mat.steel);
        pipe(g,[[1.85,5.25,-.85],[1.85,4.25,.35],[.93,4.25,.35],[.93,3.8,.35]],.035);animated.dryJets=[];for(const y of [3.8,4.2]){const jet=effect(g,new T.CylinderGeometry(.04,.08,.45,12),mat.cyan,.93,y,.24);jet.rotation.x=Math.PI/2;jet.name='wet-drying-air';animated.dryJets.push(jet);}
        activePoint.set(-.93,4,0);
        parts=[['약액 처리조',[-.93,2.15,.7]],['초순수 린스조',[.93,2.15,.7]],['회전 지그와 가장자리 클램프',[-.93,4,0]]];
      }else{
        cabinet(g,3.55,1.45,2.75);const inspectStage=new T.Group();g.add(inspectStage);animated.stage=inspectStage;box(inspectStage,0,1.59,0,2.5,.15,2.15,mat.dark);cyl(inspectStage,0,1.78,0,.86,.16,mat.steel);box(g,0,2.9,-.93,.28,2.8,.3,mat.white);box(g,0,4.22,-.4,2.3,.24,1.05);const optic=cyl(g,0,3.62,0,.4,.85,mat.dark);cyl(g,0,3.12,0,.24,.16,mat.ceramic);animated.beam=effect(g,new T.CylinderGeometry(.017,.035,1.21,16),mat.cyan,0,2.5,0);if(family==='probe'){const probeAssembly=new T.Group();g.add(probeAssembly);animated.probes=probeAssembly;for(const x of [-.45,.45])for(const z of [-.3,.3])pipe(probeAssembly,[[x*2,2.8,z*2],[x,2.15,z],[x*.7,1.891,z*.7]],.018,mat.steel);ring(probeAssembly,0,2.8,0,.95,.05,mat.steel);}activePoint.set(0,1.875,0);parts=[[family==='probe'?'프로브 카드':'광학 계측 헤드',[0,3.2,0]],['웨이퍼 스테이지',[0,1.8,0]],['XY 정렬 레일',[.9,1.55,.6]]];
      }
      if(!['furnace','wet','implant','cmp'].includes(family)){
        const pins=new T.Group();pins.name='wafer-lift-pins';g.add(pins);animated.liftPins=pins;
        for(const [x,z] of [[-.52,-.2],[.52,-.2],[0,.52]])cyl(pins,x,activePoint.y-.115,z,.025,.2,mat.ceramic);
      }
      if(consoleScene)staticHardware=collectStaticHardware();
      foup(g,family==='implant'?-4.15:-3.1,1.1);const equipmentPlaque=decal(g,step.tool.toUpperCase(),E.tools[step.tool].english.slice(0,30),0,.84,(family==='scanner'?1.67:family==='cmp'?1.68:1.43),2.3);cyl(g,1.45,2.29,-1.2,.035,2.22,mat.steel);cyl(g,1.45,3.5,-1.2,.055,.22,mat.dark);cyl(g,1.45,3.66,-1.2,.06,.12,new T.MeshStandardMaterial({color:0xaacd89,emissive:0x75a65c,emissiveIntensity:.65}));
      if(consoleScene){staticHardware.push(equipmentPlaque);requestPrecisionAsset(step.tool);}
      currentStep=step;applyEnvelope();setCamera('equipment');paintKey='';host.classList.remove('equipment-ready');requestAnimationFrame(()=>host.classList.add('equipment-ready'));
    }
    const transfer=new T.Group();transfer.name='transfer-robot';scene.add(transfer);
    // Rail-mounted SCARA: elbows stay in the front aisle. Only the linear
    // insertion slide and thin fork enter a process module.
    const armLength=1.25,baseZ=4.6;let baseX=-2.1;
    const rail=box(transfer,-1.4,.18,baseZ,8.5,.24,.48,mat.dark);rail.name='robot-travel-rail';
    for(const z of [baseZ-.15,baseZ+.15])box(transfer,-1.4,.32,z,8.5,.035,.045,mat.steel);
    const pedestal=cyl(transfer,baseX,.72,baseZ,.24,.78,mat.dark);
    const transferBase=cyl(transfer,baseX,.6,baseZ,.16,1.2,mat.steel),linkA=box(transfer,0,0,0,armLength,.09,.14,mat.steel),linkB=box(transfer,0,0,0,armLength,.075,.12,mat.ceramic),jointA=cyl(transfer,0,0,0,.13,.1,mat.steel),jointB=cyl(transfer,0,0,0,.11,.1,mat.steel);
    const gripper=new T.Group();gripper.name='transfer-gripper';transfer.add(gripper);
    linkA.name='robot-upper-arm';linkB.name='robot-forearm';jointB.name='robot-elbow';
    const slide=box(transfer,0,0,0,.08,.02,1,mat.steel);slide.name='robot-insertion-slide';
    const wristHousing=box(transfer,0,0,0,.24,.18,.38,mat.dark);wristHousing.name='robot-slide-housing';
    const fingers=[-1,1].map(side=>{const finger=box(gripper,side*.28,-.026,.245,.08,.018,1.49,mat.ceramic);finger.userData.side=side;return finger;});
    const forkBridge=box(gripper,0,-.03,.93,.7,.025,.1,mat.ceramic);cyl(gripper,0,-.04,1.02,.095,.035,mat.steel);
    const edgeJaws=[-1,1].map(side=>{const jaw=box(gripper,side*.84,0,1.25,.1,.08,.12,mat.green);jaw.name='robot-edge-clamp';jaw.userData.side=side;const rail=box(gripper,side*.84,-.065,1.09,.055,.045,.32,mat.steel);return {jaw,rail,side};});
    function poseTransfer(point,orientation=new T.Euler(),grip=0){
      gripper.position.copy(point);gripper.rotation.copy(orientation);
      const edgeTool=['cmp','implant'].includes(E.tools[currentStep.tool].family),edgeGrip=edgeTool?Math.max(grip,Math.min(1,Math.abs(orientation.z)/(Math.PI/2))):0;
      for(const {jaw,rail,side} of edgeJaws){jaw.visible=rail.visible=edgeTool;const z=1.25*(1-grip),x=side*(.84-.09*grip);jaw.position.set(x,0,z);rail.position.set(x,-.065,(z+.93)/2);rail.scale.z=Math.max(.05,Math.abs(z-.93));}
      for(const finger of fingers){finger.position.x=finger.userData.side*(.28+.455*edgeGrip);finger.scale.x=.08-.055*edgeGrip;}
      forkBridge.scale.x=.7+.85*edgeGrip;
      const forkWrist=new T.Vector3(0,-.04,1.02).applyEuler(orientation).add(point);
      const wrist=new T.Vector3(forkWrist.x,forkWrist.y,Math.max(3.35,forkWrist.z));
      baseX=wrist.x-.9;
      const dx=.9,dz=wrist.z-baseZ,d=Math.hypot(dx,dz),angle=Math.atan2(dz,dx)+Math.acos(d/(2*armLength)),ex=baseX+armLength*Math.cos(angle),ez=baseZ+armLength*Math.sin(angle),a2=Math.atan2(wrist.z-ez,wrist.x-ex),h=wrist.y;
      pedestal.position.x=baseX;transferBase.position.x=baseX;
      slide.position.copy(forkWrist).lerp(wrist,.5);slide.scale.z=Math.max(.01,wrist.z-forkWrist.z);wristHousing.position.copy(wrist);
      transferBase.scale.y=Math.max(.2,h/1.2);transferBase.position.y=h/2;
      linkA.position.set((baseX+ex)/2,h,(baseZ+ez)/2);linkA.rotation.y=-angle;
      linkB.position.set((ex+wrist.x)/2,h+.04,(ez+wrist.z)/2);linkB.rotation.y=-a2;
      jointA.position.set(baseX,h,baseZ);jointB.position.set(ex,h+.04,ez);
    }
    const wafer=new T.Group();scene.add(wafer);const silicon=new T.MeshPhysicalMaterial({color:0x5c7591,metalness:.9,roughness:.2,iridescence:.85,clearcoat:1});wafer.name='active-wafer';cyl(wafer,0,0,0,waferRadius,.03,silicon);const waferCanvas=document.createElement('canvas');waferCanvas.width=768;waferCanvas.height=768;const waferTexture=new T.CanvasTexture(waferCanvas);waferTexture.colorSpace=T.SRGBColorSpace;const surface=mesh(wafer,new T.CircleGeometry(.749,96),new T.MeshStandardMaterial({map:waferTexture,metalness:.7,roughness:.28,side:T.DoubleSide}),0,.016,0);surface.rotation.x=-Math.PI/2;let paintKey='';
    // A second view of the same wafer geometry/materials keeps the process face readable
    // under lids, inside baths and when CMP holds the process face downward.
    let waferDetailScene=null,waferDetail=null,waferDetailCamera=null,waferDetailFrame=null,waferLocator=null;
    let exteriorWafer=null,exteriorHandler=null,exteriorArm=null,exteriorObservation=null,exteriorAssembly=null,exteriorSupport=null;
    if(consoleScene){
      const edge=ring(wafer,0,.005,0,waferRadius,.009,new T.MeshBasicMaterial({color:0xefb76b}));edge.name='active-wafer-edge';edge.castShadow=false;
      exteriorWafer=wafer.clone();exteriorWafer.name='exterior-active-wafer';exteriorWafer.scale.setScalar(.56);exteriorWafer.visible=false;
      exteriorWafer.traverse(o=>{if(o.isMesh){o.material=o.material.clone();if(o.material.emissive){o.material.emissive.set(0x94abc3);o.material.emissiveIntensity=.24;}if(o.material.map){o.material.metalness=.3;o.material.roughness=.4;}if(o.name==='active-wafer-edge')o.geometry=new T.TorusGeometry(waferRadius,.025,8,96);}});
      exteriorObservation=new T.Scene();exteriorObservation.name='exterior-wafer-observation';exteriorObservation.environment=scene.environment;scene.add(exteriorObservation);
      exteriorAssembly=new T.Group();exteriorObservation.add(exteriorAssembly);exteriorAssembly.add(exteriorWafer);
      exteriorObservation.add(new T.HemisphereLight(0xf0f8ff,0x516778,1.2));const trackingLamp=new T.DirectionalLight(0xffffff,1.6);trackingLamp.position.set(-3,7,6);exteriorObservation.add(trackingLamp);
      if(operationDisplay)exteriorObservation.add(operationDisplay.backdrop());
      operationDisplay?.inspectGeometry(exteriorWafer).forEach(m=>m.dispose());
      exteriorHandler=new T.Group();exteriorHandler.name='exterior-transfer-robot';exteriorHandler.visible=false;exteriorAssembly.add(exteriorHandler);
      const fork=new T.Group();fork.name='exterior-wafer-fork';fork.scale.setScalar(.56);exteriorHandler.add(fork);
      for(const side of [-1,1])box(fork,side*.27,-.04,.24,.075,.025,1.42,mat.ceramic);
      box(fork,0,-.045,.92,.65,.075,.11,mat.steel);cyl(fork,0,-.09,1.01,.12,.1,mat.dark);
      const post=cyl(exteriorHandler,0,.5,0,.11,1,mat.steel),upper=box(exteriorHandler,0,0,0,1,.09,.13,mat.steel),fore=box(exteriorHandler,0,0,0,1,.085,.12,mat.dark);
      const elbow=cyl(exteriorHandler,0,0,0,.105,.12,mat.steel),wrist=cyl(exteriorHandler,0,0,0,.09,.1,mat.steel);
      exteriorArm={fork,post,upper,fore,elbow,wrist};operationDisplay?.inspectGeometry(exteriorHandler);exteriorHandler.traverse(o=>{if(o.isMesh)o.castShadow=false;});
      exteriorSupport=new T.Group();exteriorSupport.name='exterior-process-support';exteriorAssembly.add(exteriorSupport);
      ring(exteriorSupport,0,-.055,0,.443,.018,mat.ceramic);
      for(const a of [0,Math.PI*2/3,Math.PI*4/3]){const clip=box(exteriorSupport,Math.cos(a)*.435,-.035,Math.sin(a)*.435,.13,.08,.06,mat.steel);clip.rotation.y=-a;}
      operationDisplay?.inspectGeometry(exteriorSupport);exteriorSupport.traverse(o=>{if(o.isMesh)o.castShadow=false;});
      waferDetailScene=new T.Scene();waferDetailScene.background=new T.Color(0x1a2532);waferDetailScene.environment=scene.environment;
      waferDetailScene.add(new T.HemisphereLight(0xffffff,0x5e7391,2.4));
      const lamp=new T.DirectionalLight(0xffffff,2.2);lamp.position.set(-2,4,3);waferDetailScene.add(lamp);
      waferDetail=wafer.clone();waferDetail.visible=true;waferDetailScene.add(waferDetail);
      waferDetailCamera=new T.PerspectiveCamera(36,1,.1,20);waferDetailCamera.position.set(0,2.8,1.35);waferDetailCamera.lookAt(0,0,0);
      waferDetailFrame=document.createElement('div');waferDetailFrame.className='wafer-detail-frame';waferDetailFrame.hidden=true;
      waferDetailFrame.innerHTML='<strong>현재 웨이퍼</strong><span>가공면 확대 · 재료색 표시</span>';waferDetailFrame.setAttribute('aria-hidden','true');host.append(waferDetailFrame);
      waferLocator=document.createElement('div');waferLocator.className='wafer-location';waferLocator.textContent='웨이퍼';waferLocator.hidden=true;waferLocator.setAttribute('aria-hidden','true');host.append(waferLocator);
    }
    function observationLayout(){
      const width=host.clientWidth,height=host.clientHeight,observing=!!(consoleScene&&frameState&&currentStep&&(cut||frameState.phase!=='idle')),compact=width<600;
      const exterior=!!(operationDisplay&&!cut&&observing),rail=exterior?82:0,mainTop=exterior?40:0;
      const mainHeight=Math.max(120,height-(observing&&compact?124:0)-rail-mainTop),mainWidth=width-(exterior&&!compact?184:0),size=Math.min(compact?112:156,Math.floor(width*.32));
      return {width,height,observing,compact,exterior,mainWidth,mainHeight,mainTop,precision:!!detailedHardware,detail:observing?{size,left:width-size-12,top:compact?mainTop+mainHeight+rail+6:46}:null};
    }
    function renderScene(){
      if(!consoleScene){renderer.render(scene,camera);return;}
      const layout=observationLayout(),{width,height,mainWidth,mainHeight,mainTop,observing,compact,detail,exterior}=layout;if(!width||!height)return;
      operationDisplay?.update(currentStep?.tool,frameState,cut);host.dataset.operationActive=String(exterior);
      camera.updateMatrixWorld(true);
      operationDisplay?.focus(renderer,camera,layout,exteriorWafer,exterior);
      renderer.setViewport(0,height-mainTop-mainHeight,mainWidth,mainHeight);renderer.setScissorTest(false);if(exteriorObservation)exteriorObservation.visible=false;renderer.render(scene,camera);
      if(exterior&&exteriorObservation){
        const autoClear=renderer.autoClear,shadows=renderer.shadowMap.enabled;
        try{exteriorAssembly.scale.setScalar(1.6);exteriorAssembly.position.copy(exteriorWafer.position).multiplyScalar(-.6);exteriorObservation.visible=true;renderer.autoClear=false;renderer.shadowMap.enabled=false;renderer.clearDepth();renderer.render(exteriorObservation,camera);}
        finally{exteriorObservation.visible=false;renderer.autoClear=autoClear;renderer.shadowMap.enabled=shadows;}
      }
      waferDetailFrame.hidden=waferLocator.hidden=!observing;
      if(!observing)return;
      // Geometry is shared, while this view always faces the process side. Rotation and
      // material texture come from the actual current observation, including paused seeks.
      waferDetail.position.set(0,0,0);waferDetail.rotation.set(0,wafer.rotation.y,0);
      const {size,left,top}=detail;waferDetailFrame.dataset.compact=String(compact);
      Object.assign(waferDetailFrame.style,{left:left+'px',top:top+'px',width:size+'px',height:size+'px'});
      const point=wafer.position.clone().project(camera),inView=point.z>-1&&point.z<1&&Math.abs(point.x)<.92&&Math.abs(point.y)<.9;
      waferLocator.hidden=!cut||!wafer.visible||!inView;
      if(inView){waferLocator.style.left=((point.x+1)*mainWidth/2)+'px';waferLocator.style.top=(mainTop+(1-point.y)*mainHeight/2)+'px';}
      const shadows=renderer.shadowMap.enabled;
      try{
        renderer.shadowMap.enabled=false;renderer.setScissor(left,height-top-size,size,size);renderer.setViewport(left,height-top-size,size,size);renderer.setScissorTest(true);
        renderer.render(waferDetailScene,waferDetailCamera);
      }finally{
        renderer.shadowMap.enabled=shadows;renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);
      }
      if(exterior)operationDisplay.render(renderer,camera,layout,currentStep.tool,frameState);
    }
    function paint(w){const samples=Array.from({length:16},(_,i)=>{const column=Math.floor(i/16*E.NX);return topColor(w.columns[column],w.latent?.[column]||0);});const signature=w.cursor+'-'+w.mask+'-'+samples.join('');if(signature===paintKey)return;paintKey=signature;const ctx=waferCanvas.getContext('2d');const grad=ctx.createLinearGradient(0,0,768,768);grad.addColorStop(0,'#405872');grad.addColorStop(.45,'#a4b7c5');grad.addColorStop(1,'#384f78');ctx.fillStyle=grad;ctx.fillRect(0,0,768,768);for(let y=0;y<768;y+=96)for(let x=0;x<768;x+=96){for(let i=0;i<16;i++){ctx.fillStyle=samples[i];ctx.fillRect(x+4+i*5.5,y+5,5.5,86);}ctx.strokeStyle='#cfe5e344';ctx.lineWidth=.7;ctx.strokeRect(x+3,y+4,89,88);}ctx.strokeStyle='#d5e4e7';ctx.lineWidth=2;ctx.beginPath();ctx.arc(384,384,376,0,Math.PI*2);ctx.stroke();waferTexture.needsUpdate=true;}
    function topColor(column,latent=0){const layer=column.at(-1),under=column.at(-2),mix=(a,b,t)=>{const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return '#'+[16,8,0].map(shift=>Math.round(((x>>shift)&255)*(1-t)+((y>>shift)&255)*t).toString(16).padStart(2,'0')).join('');};let color=E.materials[layer?.material]?.color||'#708798';if(under)color=mix(E.materials[under.material].color,color,Math.min(1,layer.nm/80));if(layer?.material==='PR'&&latent>0)color=mix(color,'#d9ef9f',Math.min(.55,latent/180));return color;}
    let desiredDistance=11,distance=11,maximumDistance=25,azimuth=.4,desiredAzimuth=.4,elevation=.5,desiredElevation=.5,cameraMode='equipment',drag=null,last=performance.now(),raf;
    function fitEquipment(includeTransfer){
      scene.updateMatrixWorld(true);
      const bounds=new T.Box3(),local=new T.Box3(),meshes=[],reserved=[];
      const collect=object=>{
        if(!object.visible)return;
        if(object.geometry){object.geometry.computeBoundingBox();local.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);bounds.union(local);meshes.push(object);}
        object.children.forEach(collect);
      };
      collect(equipment);
      if(includeTransfer){
        collect(transfer);
        // Reserve the full handling envelope so a later robot pose cannot leave the view.
        reserved.push(new T.Vector3(-4.15,3.05,3.5),new T.Vector3(activePoint.x,activePoint.y+.8,3.5),new T.Vector3(activePoint.x,activePoint.y+.8,activePoint.z));
        reserved.forEach(point=>bounds.expandByPoint(point));
      }
      if(bounds.isEmpty())return;
      bounds.getCenter(desiredTarget);
      const sinA=Math.sin(desiredAzimuth),cosA=Math.cos(desiredAzimuth),sinE=Math.sin(desiredElevation),cosE=Math.cos(desiredElevation);
      const right=new T.Vector3(cosA,0,-sinA),up=new T.Vector3(-sinE*sinA,cosE,-sinE*cosA),out=new T.Vector3(cosE*sinA,sinE,cosE*cosA);
      const tanY=Math.tan(camera.fov*Math.PI/360)*.88,tanX=tanY*camera.aspect;
      desiredDistance=0;
      const point=new T.Vector3(),fit=p=>{p.sub(desiredTarget);desiredDistance=Math.max(desiredDistance,p.dot(out)+Math.max(Math.abs(p.dot(right))/tanX,Math.abs(p.dot(up))/tanY));};
      for(const mesh of meshes){const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i++)fit(point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld));}
      reserved.forEach(p=>fit(point.copy(p)));
      desiredDistance=Math.max(4,desiredDistance);
    }
    function setCamera(mode){
      if(consoleScene&&!cut&&(mode==='wafer'||typeof mode==='number'))mode='equipment';
      cameraMode=mode;const family=currentStep?E.tools[currentStep.tool].family:'';
      desiredTarget.set(-.45,family==='furnace'?2.8:family==='wet'?2.4:2,1.4);
      desiredDistance=Math.max(family==='implant'?13:family==='furnace'?14:family==='wet'?14:13.5,8/Math.max(.6,camera.aspect));desiredAzimuth=.4;desiredElevation=.5;
      if(mode==='chamber'){
        desiredTarget.set(0,family==='furnace'?3.3:family==='wet'?2.8:2.3,0);
        desiredDistance=(family==='furnace'?10.5:family==='wet'?9.5:family==='scanner'?8.5:7.6)/Math.min(1,camera.aspect);desiredAzimuth=.5;desiredElevation=.45;
      }
      if(consoleScene&&!cut&&detailedHardware){const angle=root.CmosEquipmentCatalog?.[currentStep.tool]?.view;desiredAzimuth=angle?.[0]??.62;desiredElevation=angle?.[1]??.36;}
      if(mode==='top'){desiredElevation=1.48;desiredAzimuth=0;}
      if(mode==='wafer'){desiredTarget.copy(wafer.position);desiredDistance=4.5/Math.min(1,camera.aspect);desiredAzimuth=.24;desiredElevation=.83;}
      if(consoleScene&&cut&&family==='implant'&&mode!=='top')desiredAzimuth=-.65;
      if(consoleScene&&currentStep&&(['equipment','top'].includes(mode)||!cut&&mode==='chamber'))fitEquipment(cut||!detailedHardware);
      if(typeof mode==='number'&&parts[mode]){desiredTarget.set(...parts[mode][1]);desiredDistance=5/Math.min(1,camera.aspect);desiredElevation=.4;}
      // Portrait layouts can need more than the old 25-unit zoom limit just to fit
      // an enclosure. Keep wheel-out monotonic from the fitted starting distance.
      maximumDistance=consoleScene?Math.max(25,desiredDistance*1.8):25;
      const far=Math.max(100,maximumDistance+30);if(camera.far!==far){camera.far=far;camera.updateProjectionMatrix();}
    }
    let lastWidth=0,lastHeight=0;
    const resize=()=>{if(disposed)return;const {width:w,height:h,mainWidth,mainHeight}=observationLayout();if(!w||!h||w===lastWidth&&h===lastHeight&&Math.abs(camera.aspect-mainWidth/mainHeight)<1e-8)return;lastWidth=w;lastHeight=h;renderer.setSize(w,h,false);camera.aspect=mainWidth/mainHeight;camera.updateProjectionMatrix();if(consoleScene&&currentStep)setCamera(cameraMode);dirty=true;};const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
    const raycaster=new T.Raycaster(),pointer=new T.Vector2();
    function inspectAt(e){
      const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height||e.clientX<rect.left||e.clientX>rect.left+rect.width||e.clientY<rect.top||e.clientY>rect.top+rect.height)return;
      const {width,height,mainWidth,mainHeight,mainTop,detail}=observationLayout(),x=(e.clientX-rect.left)*width/rect.width,y=(e.clientY-rect.top)*height/rect.height;
      let objects=[equipment,wafer],inspectCamera=camera,inspectScene=scene;
      if(detail&&x>=detail.left&&x<=detail.left+detail.size&&y>=detail.top&&y<=detail.top+detail.size){
        pointer.set((x-detail.left)/detail.size*2-1,1-(y-detail.top)/detail.size*2);objects=[waferDetail];inspectCamera=waferDetailCamera;inspectScene=waferDetailScene;
      }else{
        if(y<mainTop||y>mainTop+mainHeight||x>mainWidth)return;
        pointer.set(x/mainWidth*2-1,1-(y-mainTop)/mainHeight*2);
      }
      // Ray tests use the same split viewport as rendering, including its inset.
      inspectScene.updateMatrixWorld(true);inspectCamera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,inspectCamera);
      const hit=raycaster.intersectObjects(objects,true).some(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}return h.object.material?.opacity!==0;});if(hit&&currentStep)onInspect(currentStep);
    }
    listen('pointerdown',e=>{if(e.button!==0||e.isPrimary===false)return;drag={x:e.clientX,y:e.clientY,a:desiredAzimuth,e:desiredElevation,id:e.pointerId,moved:false};renderer.domElement.setPointerCapture(e.pointerId);});
    listen('pointermove',e=>{if(drag&&e.pointerId===drag.id){drag.moved||=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6;if(drag.moved){desiredAzimuth=drag.a-(e.clientX-drag.x)*.007;desiredElevation=T.MathUtils.clamp(drag.e+(e.clientY-drag.y)*.006,.12,1.5);}}});
    listen('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const click=!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<=6;drag=null;if(renderer.domElement.hasPointerCapture?.(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);if(click)inspectAt(e);});listen('pointercancel',()=>drag=null);listen('lostpointercapture',()=>drag=null);
    listen('wheel',e=>{e.preventDefault();desiredDistance=T.MathUtils.clamp(desiredDistance*Math.exp(e.deltaY*.001),2.8,maximumDistance);},{passive:false});listen('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat&&currentStep)onInspect(currentStep);return;}if(e.key==='ArrowLeft')desiredAzimuth-=.12;else if(e.key==='ArrowRight')desiredAzimuth+=.12;else if(e.key==='ArrowUp')desiredElevation=Math.min(1.5,desiredElevation+.1);else if(e.key==='ArrowDown')desiredElevation=Math.max(.12,desiredElevation-.1);else return;e.preventDefault();});
    let spin=0,headSpin=0;
    function interpolatePath(progress,points){
      const t=T.MathUtils.clamp(progress,0,1);for(let i=1;i<points.length;i++){if(t<=points[i][0])return new T.Vector3(...points[i-1][1]).lerp(new T.Vector3(...points[i][1]),smooth((t-points[i-1][0])/(points[i][0]-points[i-1][0])));}
      return new T.Vector3(...points.at(-1)[1]);
    }
    function handlingPosition(m){
      const family=E.tools[currentStep.tool].family,startX=family==='implant'?-4.15:-3.1,approachY=activePoint.y+(family==='furnace'?.025:['cmp','wet','implant'].includes(family)?0:family==='spin'?.3:.26),seat=activePoint.clone();
      if(animated.liftPins)seat.y+=.22;
      return interpolatePath(m.transfer,[[0,[startX,slotY,1.1]],[.1,[startX,slotY,1.1]],[.16,[startX,slotY+.025,1.1]],[.4,[startX,slotY+.025,3.5]],[.62,[activePoint.x,approachY,3.5]],[.84,[activePoint.x,approachY,activePoint.z]],[1,seat.toArray()]]);
    }
    function robotAccess(from,to,p){return interpolatePath(p,[[0,from.toArray()],[.3,[from.x,from.y,3.5]],[.7,[to.x,to.y,3.5]],[1,to.toArray()]]);}
    function exteriorTransport(m,state){
      if(!exteriorWafer||!root.CmosOperationView?.profiles[hardwareTool])return;
      const [portX,portZ]=root.CmosOperationView.profiles[hardwareTool].port;
      const home=new T.Vector3(portX,2.03,portZ+.47),seat=handlingPosition({...m,transfer:1});
      const route=t=>interpolatePath(t,[[0,home.toArray()],[.12,home.toArray()],[.34,[portX,2.03,portZ-.1]],[.58,[portX,seat.y+.15,portZ-.65]],[.84,[seat.x,seat.y+.15,seat.z+.85]],[1,seat.toArray()]]);
      exteriorWafer.position.copy(m.transfer===1?wafer.position:route(m.transfer));exteriorWafer.rotation.copy(wafer.rotation);
      exteriorSupport.position.copy(exteriorWafer.position);exteriorSupport.rotation.copy(exteriorWafer.rotation);exteriorSupport.visible=m.transfer===1&&state.phase!=='load';
      const p=state.progress||0,phase=state.phase,point=exteriorWafer.position.clone(),family=E.tools[hardwareTool].family;
      const release=family==='wet'?.4:.55,pickup=family==='wet'?.52:.35;
      exteriorHandler.userData.engaged=phase==='load'||phase==='condition'&&p<release||phase==='unload';
      if(phase==='condition')point.lerp(route(.58),smooth(p/release));
      if(phase==='unload'&&p<pickup)point.copy(route(.58)).lerp(seat,smooth(Math.max(0,p-.1)/(pickup-.1)));
      const {fork,post,upper,fore,elbow,wrist}=exteriorArm;
      fork.position.copy(point);fork.rotation.copy(exteriorWafer.rotation);
      const turn=phase==='condition'?1-smooth(p/release):phase==='unload'&&p<pickup?smooth(Math.max(0,p-.1)/(pickup-.1)):1;
      fork.rotation.set(fork.rotation.x*turn,fork.rotation.y*turn,fork.rotation.z*turn);
      const tip=new T.Vector3(0,-.09,1.01).multiplyScalar(.56).applyEuler(fork.rotation).add(point);
      const base=new T.Vector3((portX+seat.x)/2,tip.y,Math.min(portZ-.65,seat.z+1.2));
      const dx=tip.x-base.x,dz=tip.z-base.z,d=Math.hypot(dx,dz),reach=Math.max(Math.hypot(home.x-base.x,home.z-base.z),Math.hypot(seat.x-base.x,seat.z-base.z))+1.5;
      const length=Math.max(1.25,reach*.56),angle=Math.atan2(dz,dx)+Math.acos(Math.min(1,d/(2*length)));
      const joint=new T.Vector3(base.x+length*Math.cos(angle),tip.y,base.z+length*Math.sin(angle));
      for(const [beam,a,b] of [[upper,base,joint],[fore,joint,tip]]){beam.position.copy(a).lerp(b,.5);beam.scale.x=a.distanceTo(b);beam.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);}
      post.position.set(base.x,tip.y/2,base.z);post.scale.y=Math.max(.1,tip.y);elbow.position.copy(joint);wrist.position.copy(tip);
    }
    function tick(now){
      if(disposed)return;raf=requestAnimationFrame(tick);const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;if(document.hidden||contextLost)return;if(consoleScene)resize();
      if(frameState&&currentStep&&(dirty||frameState.running)){
        const state=frameState,family=E.tools[currentStep.tool].family,m=motion(state.phase,state.progress),wet=family==='wet'?wetMotion(state.phase,state.progress):null,rate=state.running?dt*(state.speed||1):0,recipe=state.recipe||currentStep.recipe,scan=stageMotion(state.phase==='process'?state.progress:0),timedPose=Number.isFinite(state.elapsed)?processPose(family,state.elapsed,recipe):null;
        if(timedPose){clock=timedPose.clock;spin=timedPose.spin;headSpin=timedPose.head;}
        else{clock+=rate;spin+=rate*6*Math.min(1.7,Math.max(.4,(recipe.rpm||3000)/3000))*m.processing;headSpin+=rate*2*Math.min(2,Math.max(.5,(recipe.rpm||60)/60))*m.processing;}
        if(wet)m.transfer=wet.transfer;
        const edgeTool=['cmp','implant'].includes(family);if(edgeTool&&state.phase==='unload')m.transfer=Math.max(0,1-Math.max(0,(state.progress-.42)/.54));
        if(edgeTool)m.orientation=smooth((m.transfer-.44)/.18);
        effects.forEach(e=>{e.userData.baseOpacity??=e.material.opacity;let envelope=e===animated.stream&&family==='spin'?m.processing*(1-smooth(((state.progress||0)-.45)/.12)):m.processing;if(e===animated.beam&&animated.stage)envelope*=scan.contact;e.visible=envelope>.001;e.material.opacity=e.userData.baseOpacity*envelope;});
        if(wet)for(const jet of animated.dryJets){jet.visible=state.phase==='unload'&&state.progress>=.14&&state.progress<=.22;jet.material.opacity=.2;}
        if(animated.particles){animated.particles.visible=m.processing>.01;animated.particles.children.forEach(p=>{const travel=(clock*.5+p.userData.phase)%1;p.position.y=2.7-travel*.83;p.scale.setScalar(Math.sqrt(Math.max(0,Math.sin(Math.PI*travel))));});}
        if(animated.nozzle)animated.nozzle.rotation.y=-.9*(1-m.nozzle);
        if(animated.lid){
          const y=2.75-.66*m.closed;animated.lid.position.y=y;
          for(const piston of animated.lidPistons){const bottom=y+.2; piston.position.y=(3.51+bottom)/2;piston.scale.y=(3.51-bottom)/.6;}
          const bottom=y+.08;animated.exhaustSleeve.position.y=(3.69+bottom)/2;animated.exhaustSleeve.scale.y=(3.69-bottom)/.76;
        }
        if(animated.gate)animated.gate.position.y=.55*(1-m.closed);
        if(animated.implantDoor)animated.implantDoor.position.x=-.85*(1-m.closed);
        if(animated.boat)animated.boat.position.y=1.7*m.closed;
        if(wet){animated.wetCarrier.position.set(-.93+wet.x,4-1.9*wet.dip,0);animated.wetCradle.rotation.x=-Math.PI/2*wet.tilt;animated.wetClamps.forEach(jaw=>jaw.position.x=.84-.09*wet.clamp);const bottom=animated.wetCarrier.position.y+.96;animated.wetRod.position.set(animated.wetCarrier.position.x,(5.25+bottom)/2,-.85);animated.wetRod.scale.y=(5.25-bottom)/.35;}
        if(animated.headLift){animated.headLift.position.y=-.5*m.closed;const bottom=3.07-.5*m.closed;animated.headPiston.position.y=(3.48+bottom)/2;animated.headPiston.scale.y=(3.48-bottom)/.62;}
        if(animated.retainingRing)animated.retainingRing.position.y=1.99+.16*(1-m.closed);
        if(animated.stage){animated.stage.position.x=scan.x;animated.stage.position.z=scan.z;}
        if(animated.probes)animated.probes.position.y=.45*(1-scan.contact);
        const pinLift=state.phase==='condition'?1-smooth((state.progress-.4)/.15):state.phase==='process'?0:state.phase==='unload'?smooth(state.progress/.1):1;
        if(animated.liftPins)animated.liftPins.position.y=.22*pinLift;
        if(animated.platen)animated.platen.rotation.y=timedPose?timedPose.platen:-headSpin*.7;
        if(animated.head)animated.head.rotation.y=headSpin;
        wafer.position.copy(handlingPosition(m));if(animated.boat)wafer.position.y+=animated.boat.position.y;if(animated.headLift)wafer.position.y+=animated.headLift.position.y;wafer.rotation.set(waferOrientation.x*m.orientation,waferOrientation.y*m.orientation,waferOrientation.z*m.orientation);
        if(wet&&m.transfer===1){wafer.position.x+=wet.x;wafer.position.y-=1.9*wet.dip;wafer.rotation.x=-Math.PI/2*wet.tilt;}
        if(animated.liftPins&&['condition','process','unload'].includes(state.phase)&&m.transfer===1)wafer.position.y-=.22*(1-pinLift);
        if(E.tools[currentStep.tool].family==='spin')wafer.rotation.y=spin;
        if(E.tools[currentStep.tool].family==='cmp')wafer.rotation.y=headSpin;
        if(animated.stage){wafer.position.x+=animated.stage.position.x;wafer.position.z+=animated.stage.position.z;}
        const home=handlingPosition(motion('idle',0)),handoff=activePoint.clone(),parked=new T.Vector3(home.x,slotY-.15,3.5),neutral=new T.Euler(),p=state.progress||0;
        if(animated.liftPins)handoff.y+=.22;
        const homeRetreat=q=>interpolatePath(q,[[0,home.toArray()],[.8,[home.x,home.y,3.5]],[1,parked.toArray()]]);
        let armPoint=parked,armRotation=neutral;
        if(state.phase==='load'){
          if(p<.1)armPoint=homeRetreat(1-p/.1);
          else{armPoint=wafer.position.clone();armRotation=new T.Euler(waferOrientation.x*m.orientation,waferOrientation.y*m.orientation,waferOrientation.z*m.orientation);}
        }
        if(state.phase==='condition'&&p<.55){armPoint=robotAccess(handoff,parked,p/.55);const release=1-smooth((p/.55-.4)/.25);armRotation=new T.Euler(waferOrientation.x*release,0,waferOrientation.z*release);}
        if(state.phase==='unload'){
          if(p<.1)armPoint=parked;
          else if(p<.35){armPoint=robotAccess(parked,handoff,(p-.1)/.25);const engage=smooth(((p-.1)/.25-.4)/.25);armRotation=new T.Euler(waferOrientation.x*engage,0,waferOrientation.z*engage);}
          else if(p<.89){armPoint=wafer.position.clone();armRotation=new T.Euler(waferOrientation.x*m.orientation,0,waferOrientation.z*m.orientation);}
          else armPoint=homeRetreat((p-.89)/.11);
        }
        if(wet){
          armRotation=neutral;
          if(state.phase==='condition')armPoint=p<.12?handoff:robotAccess(handoff,parked,Math.min(1,(p-.12)/.28));
          if(state.phase==='unload')armPoint=p<.3?parked:p<.52?robotAccess(parked,handoff,(p-.3)/.22):p<.55?handoff:p<.91?wafer.position.clone():homeRetreat((p-.91)/.09);
        }
        let grip=0;
        if(edgeTool){
          grip=state.phase==='load'?smooth((m.transfer-.4)/.04):state.phase==='condition'?1-smooth(p/.1):state.phase==='unload'?p<.35?0:p<.42?smooth((p-.35)/.07):smooth((m.transfer-.4)/.04):0;
          if(state.phase==='condition'){const q=Math.max(0,(p-.1)/.45);armPoint=p<.1?handoff:robotAccess(handoff,parked,q);const r=1-smooth((q-.4)/.25);armRotation=new T.Euler(waferOrientation.x*r,0,waferOrientation.z*r);}
          if(state.phase==='unload'&&p>=.35){armPoint=p<.42?handoff:p<.906?wafer.position.clone():homeRetreat((p-.906)/.094);armRotation=p<.42?waferOrientation.clone():p<.906?new T.Euler(waferOrientation.x*m.orientation,0,waferOrientation.z*m.orientation):neutral;}
        }
        poseTransfer(armPoint,armRotation,grip);paint(state.wafer);exteriorTransport(m,state);applyProcessVisibility();
      }
      if(cameraMode==='wafer')desiredTarget.copy(wafer.position);
      const cameraMoving=target.distanceToSquared(desiredTarget)>1e-10||Math.abs(distance-desiredDistance)>1e-5||Math.abs(azimuth-desiredAzimuth)>1e-5||Math.abs(elevation-desiredElevation)>1e-5;
      if(!dirty&&!frameState?.running&&!cameraMoving)return;
      // Read the live preference per frame, including a change during camera travel.
      const alpha=motionPreference?.matches?1:1-Math.exp(-dt*8);target.lerp(desiredTarget,alpha);distance=T.MathUtils.lerp(distance,desiredDistance,alpha);azimuth=T.MathUtils.lerp(azimuth,desiredAzimuth,alpha);elevation=T.MathUtils.lerp(elevation,desiredElevation,alpha);camera.position.set(target.x+distance*Math.cos(elevation)*Math.sin(azimuth),target.y+distance*Math.sin(elevation),target.z+distance*Math.cos(elevation)*Math.cos(azimuth));camera.lookAt(target);renderScene();dirty=false;
    }
    resize();raf=requestAnimationFrame(tick);
    return {select:build,update(s){frameState=s;dirty=true;},camera:setCamera,parts:()=>parts.map(([name,position])=>({name,position})),cutaway(value){cut=value;dirty=true;shell.forEach(o=>{if(o.material===mat.glass)return;o.material.opacity=cut?.07:1;o.material.depthWrite=!cut;o.castShadow=!cut;});applyEnvelope();if(consoleScene)setCamera(cameraMode);},retryAssets(){if(currentStep)requestPrecisionAsset(currentStep.tool);},capture(){return new Promise((resolve,reject)=>{if(contextLost||disposed){reject(Error('3D 화면을 사용할 수 없습니다.'));return;}renderScene();renderer.domElement.toBlob(blob=>blob?resolve(blob):reject(Error('화면 저장에 실패했습니다.')),'image/png');});},scene,wafer,renderer,viewCamera:camera,dispose(){
      if(disposed)return;disposed=true;assetAbort?.abort();cancelAnimationFrame(raf);resizeObserver.disconnect();listeners.forEach(remove=>remove());recovery.remove();waferDetailFrame?.remove();waferLocator?.remove();waferDetailScene?.clear();operationDisplay?.dispose();
      const geometries=new Set(),materials=new Set(),textures=new Set();
      scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])if(material)materials.add(material);object.shadow?.dispose?.();});
      for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      if(scene.environment?.isTexture)textures.add(scene.environment);geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());textures.forEach(item=>item.dispose());scene.clear();renderer.dispose();renderer.domElement.remove();
    }};
  }
  root.FabViewport={mount,motion,stageMotion,wetMotion,playback,reactionProgress,observationStops,rotationProgress,processPose};
})(window);

/* WaferFlow equipment cell: original procedural models; no vendor CAD or control recipes. */
(function () {
  'use strict';
  const host=document.querySelector('#machineViewport');
  if(!host)return;
  const T=window.THREE;
  const $=s=>document.querySelector(s);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const smooth=t=>t*t*(3-2*t);
  const stationPositions=[[-6,-3],[-2,-3],[2,-3],[6,-3],[6,3],[2,3],[-2,3],[-6,3]];
  const stationNames=['OXIDATION','SPIN COATER','SOFT BAKE','UV EXPOSURE','POST BAKE','DEVELOPER','PLASMA ETCH','PR STRIP'];
  const equipmentNames=['열산화로','스핀 코터','소프트베이크 핫플레이트','마스크 노광기','PEB 핫플레이트','현상기','플라즈마 식각기','PR 스트리퍼'];
  const equipmentInfo=[
    ['고온 반응로에서 산소와 실리콘을 반응시킵니다.','실리콘 표면 → 산화막 성장','가열 구역 · 반응 분위기 · 웨이퍼'],
    ['회전 척 위에 PR을 공급하고 원심력으로 펼칩니다.','산화막 위 → 균일한 감광막','PR 공급 노즐 · 스핀 척 · 배액 컵'],
    ['도포된 PR의 용매를 줄이고 막을 안정화합니다.','젖은 감광막 → 베이크된 감광막','히팅 플레이트 · 리프트 핀 · 커버'],
    ['마스크 패턴을 통과한 빛으로 PR의 상태를 바꿉니다.','양성 PR → 노광 영역에 잠상 형성','UV 광학계 · 포토마스크 · 웨이퍼 척'],
    ['예제 레시피에 맞춰 노광 후 PR을 가열합니다.','노광된 PR → 열처리된 패턴','온도 제어 플레이트 · 열처리 커버'],
    ['현상액이 빛을 받은 양성 PR 영역을 제거합니다.','잠상 → 실제 패턴 개구','현상액 노즐 · 회전 척 · 배액 컵'],
    ['플라즈마로 노출된 산화막에 패턴을 전사합니다.','PR 개구 → 산화막 식각','상부 전극 · 반응 공간 · RF 척'],
    ['패턴 전사가 끝난 웨이퍼에서 남은 PR을 제거합니다.','잔여 PR → 산화막 패턴 노출','제거액 노즐 · 처리 컵 · 웨이퍼 척']
  ];
  let renderer;
  try { if(!T)throw new Error('Three.js unavailable');renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}); }
  catch(error){host.innerHTML='<div class="machine-fallback"><strong>3D 장비실을 열려면 WebGL이 필요합니다.</strong><p>하드웨어 가속을 지원하는 최신 브라우저에서 열어주세요. 아래 공정 장면과 단면 시뮬레이터는 계속 사용할 수 있습니다.</p></div>';document.querySelectorAll('[data-machine-action],#machineSpeed').forEach(b=>b.disabled=true);console.warn('WaferFlow 3D:',error.message);return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setClearColor(0x111d25);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D 포토 공정 장비실. 마우스 드래그로 회전, 휠로 확대. 장비 이름 버튼으로 시점 선택.');host.prepend(renderer.domElement);
  const scene=new T.Scene();scene.fog=new T.Fog(0x111d25,35,80);
  const camera=new T.PerspectiveCamera(40,1,.1,150);
  const target=new T.Vector3(0,1.1,0),desiredTarget=target.clone();
  let azimuth=.62,elevation=.76,distance=27,desiredDistance=27,desiredAzimuth=.62,desiredElevation=.76;
  scene.add(new T.HemisphereLight(0xdceeff,0x3a454e,.85));
  const key=new T.DirectionalLight(0xffefd9,2.8);key.position.set(-7,17,10);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-16;key.shadow.camera.right=16;key.shadow.camera.top=13;key.shadow.camera.bottom=-13;key.shadow.normalBias=.03;key.shadow.bias=-.0002;scene.add(key);
  const fill=new T.DirectionalLight(0x97d8ff,1.1);fill.position.set(9,9,-10);scene.add(fill);
  const rim=new T.DirectionalLight(0xd8f7b4,.7);rim.position.set(0,6,8);scene.add(rim);
  const materials={
    white:new T.MeshPhysicalMaterial({color:0xc9d1d2,metalness:.27,roughness:.3,clearcoat:.24,clearcoatRoughness:.3}),
    dark:new T.MeshStandardMaterial({color:0x263e4a,metalness:.52,roughness:.32}),
    trim:new T.MeshStandardMaterial({color:0x638293,metalness:.72,roughness:.23}),
    steel:new T.MeshStandardMaterial({color:0x91a7b0,metalness:.9,roughness:.25}),
    black:new T.MeshStandardMaterial({color:0x111d25,metalness:.3,roughness:.34}),
    lime:new T.MeshStandardMaterial({color:0xb6d683,emissive:0x88b04d,emissiveIntensity:.23,metalness:.25,roughness:.3}),
    glass:new T.MeshPhysicalMaterial({color:0x79a9bd,metalness:0,roughness:.12,transparent:true,opacity:.18,depthWrite:false,side:T.DoubleSide}),
    amber:new T.MeshPhysicalMaterial({color:0xd8a35e,transparent:true,opacity:.32,roughness:.24,depthWrite:false,side:T.DoubleSide}),
    purple:new T.MeshStandardMaterial({color:0xaf79d8,emissive:0xa56ae2,emissiveIntensity:2,transparent:true,opacity:.25,depthWrite:false}),
  };
  const boxGeo=new T.BoxGeometry(1,1,1),roundedBoxGeo=window.WaferHardware?.roundedGeometry(T)||boxGeo;
  function mesh(geometry,material,parent,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=!material.transparent;m.receiveShadow=true;parent.add(m);return m;}
  function box(parent,x,y,z,w,h,d,mat){const m=mesh(Math.min(w,h,d)>.12?roundedBoxGeo:boxGeo,mat,parent,x,y,z);m.scale.set(w,h,d);return m;}
  function cylinder(parent,x,y,z,r,h,mat,segments=48){return mesh(new T.CylinderGeometry(r,r,h,segments),mat,parent,x,y,z);}
  function ring(parent,x,y,z,r,t,mat){const m=mesh(new T.TorusGeometry(r,t,10,64),mat,parent,x,y,z);m.rotation.x=Math.PI/2;return m;}
  function pipe(parent,a,b,r,mat){const av=new T.Vector3(...a),bv=new T.Vector3(...b);const m=mesh(new T.CylinderGeometry(r,r,av.distanceTo(bv),16),mat,parent);m.position.copy(av).add(bv).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),bv.sub(av).normalize());return m;}
  function labelTexture(text,small='WAFERFLOW / PROCESS MODULE'){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#1d303c';ctx.fillRect(0,0,512,128);ctx.fillStyle='#c5e695';ctx.fillRect(20,24,5,73);ctx.font='bold 33px sans-serif';ctx.fillText(text,43,58);ctx.fillStyle='#90adb9';ctx.font='16px monospace';ctx.fillText(small,44,88);const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;return tex;
  }
  function plaque(parent,x,y,z,text,w=1.65){const mat=new T.MeshBasicMaterial({map:labelTexture(text)});const m=mesh(new T.PlaneGeometry(w,w/4),mat,parent,x,y,z);m.castShadow=false;return m;}
  const floor=box(scene,0,-.22,0,27,.32,17,new T.MeshStandardMaterial({color:0x243742,roughness:.68,metalness:.2}));floor.receiveShadow=true;
  const grid=new T.GridHelper(26,52,0x54727c,0x344b56);grid.position.y=-.048;grid.material.transparent=true;grid.material.opacity=.27;scene.add(grid);
  // Cleanroom baseboard and guard rails; the open roof keeps the process observable.
  box(scene,0,.13,-7.15,25,.35,.18,materials.trim);box(scene,-12.4,.13,0,.18,.35,14.3,materials.trim);box(scene,12.4,.13,0,.18,.35,14.3,materials.trim);
  for(const z of [-.68,.68]){box(scene,0,.18,z,19.5,.18,.13,materials.steel);box(scene,0,.07,z,19.8,.08,.26,materials.black);}
  for(let x=-9;x<10;x+=.55)box(scene,x,.04,0,.07,.05,1.5,materials.dark);
  const roomScenery=scene.children.filter(o=>o!==floor&&!o.isLight);
  // A visible FOUP with cassette slots and parked wafers.
  const foup=new T.Group();foup.position.set(-10,0,0);scene.add(foup);
  box(foup,0,.47,0,2.45,.85,2.25,materials.white);box(foup,0,1.01,0,2.25,.18,2.1,materials.steel);
  box(foup,-.86,1.96,0,.1,1.85,1.8,materials.amber);box(foup,.86,1.96,0,.1,1.85,1.8,materials.amber);box(foup,0,2.9,0,1.8,.1,1.8,materials.amber);box(foup,0,1.96,-.87,1.8,1.8,.08,materials.amber);
  const parkedWaferMat=new T.MeshPhysicalMaterial({color:0x335972,metalness:.85,roughness:.2,iridescence:1,iridescenceIOR:1.3});
  for(let i=0;i<9;i++){cylinder(foup,0,1.35+i*.14,0,.65,.025,parkedWaferMat,64);box(foup,0,1.32+i*.14,-.66,1.55,.025,.12,materials.dark);}
  plaque(foup,0,.63,1.14,'LOAD PORT',1.9);
  // Eight independently modeled stations arranged around a transfer lane.
  const stations=[],pickable=[];
  stationPositions.forEach(([x,z],index)=>{
    const group=new T.Group();group.position.set(x,0,z);scene.add(group);
    const front=z<0?1:-1;
    const deck=box(group,0,.78,0,3.05,1.45,2.45,materials.white);deck.userData.station=index;pickable.push(deck);
    box(group,0,1.52,0,3.18,.14,2.57,materials.steel);
    for(const sx of [-1,1]){
      box(group,sx*.75,.77,front*1.24,1.36,1.18,.025,materials.white);
      box(group,sx*.16,.9,front*1.28,.045,.34,.05,materials.trim);
      for(let i=0;i<5;i++)box(group,sx*.77,.38+i*.065,front*1.27,.94,.023,.018,materials.dark);
      cylinder(group,sx*1.18,.04,.8,.12,.18,materials.black,16);
    }
    const shell=new T.Group();group.add(shell);
    const shellMat=materials.white.clone();shellMat.transparent=true;shellMat.opacity=.08;shellMat.depthWrite=false;
    box(shell,-1.5,2.42,0,.065,1.72,2.38,shellMat);box(shell,1.5,2.42,0,.065,1.72,2.38,shellMat);box(shell,0,3.3,0,3.07,.08,2.43,shellMat);
    box(group,0,2.38,-front*1.16,3.03,1.6,.10,materials.dark);
    const windowMat=materials.glass.clone();windowMat.opacity=.04;
    const windowMesh=box(shell,0,2.5,front*1.18,2.9,1.45,.025,windowMat);
    box(group,-1.38,2.42,-front*.99,.1,1.73,.12,materials.trim);box(group,1.38,2.42,-front*.99,.1,1.73,.12,materials.trim);
    const nameplate=plaque(group,0,1.05,front*1.265,stationNames[index],2.1);if(front<0)nameplate.rotation.y=Math.PI;
    const lampMat=new T.MeshStandardMaterial({color:0x5f8770,emissive:0x5a9957,emissiveIntensity:.25});
    cylinder(group,1.31,3.51,-front*.92,.065,.26,materials.dark,16);const lamp=cylinder(group,1.31,3.69,-front*.92,.067,.11,lampMat,16);
    const monitor=box(group,-1.17,2.58,-front*1.04,.42,.44,.04,materials.black);const screenMat=new T.MeshBasicMaterial({color:0x72bf9c});box(group,-1.17,2.6,-front*.998,.32,.28,.012,screenMat);
    const processGroup=new T.Group();group.add(processGroup);const station={group,shell,shellMat,windowMesh,windowMat,lamp,lampMat,processGroup,front,index,point:new T.Vector3(x,[1.82,1.82,1.8,1.84,1.8,1.82,1.83,1.82][index],z)};
    if([1,5,7].includes(index)){
      cylinder(processGroup,0,1.66,0,1,.2,materials.dark);ring(processGroup,0,1.82,0,1,.055,materials.steel);cylinder(processGroup,0,1.74,0,.42,.12,materials.black);
      cylinder(processGroup,0,1.645,0,.82,.04,materials.trim);
      const nozzle=new T.Group();nozzle.position.set(.9,0,-.5);processGroup.add(nozzle);
      pipe(nozzle,[0,1.6,0],[0,2.5,0],.075,materials.steel);pipe(nozzle,[0,2.5,0],[-.9,2.5,.5],.06,materials.steel);cylinder(nozzle,-.9,2.37,.5,.055,.24,materials.white,16);
      station.nozzle=nozzle;
      const streamMat=new T.MeshBasicMaterial({color:index===1?0xd99aca:0x83d8ec,transparent:true,opacity:.72,depthWrite:false});station.stream=cylinder(processGroup,0,2.045,0,index===1?.014:.028,.43,streamMat,10);station.stream.visible=false;
      const drops=new T.Group();processGroup.add(drops);for(let i=0;i<30;i++){const drop=mesh(new T.SphereGeometry(.015,6,5),streamMat,drops);drop.userData={phase:i/30,angle:i*2.4};}station.drops=drops;drops.visible=false;
    } else if([2,4].includes(index)){
      cylinder(processGroup,0,1.65,0,.86,.14,materials.dark);cylinder(processGroup,0,1.74,0,.73,.08,materials.steel);
      const heatMat=new T.MeshBasicMaterial({color:0xf29b56,transparent:true,opacity:0});station.heatRing=ring(processGroup,0,1.77,0,.78,.035,heatMat);
      station.lid=new T.Group();station.lid.position.y=2.64;processGroup.add(station.lid);cylinder(station.lid,0,0,0,.87,.11,materials.trim);cylinder(station.lid,0,.13,0,.09,.25,materials.dark);pipe(processGroup,[0,1.6,-.95],[0,3,-.95],.055,materials.steel);pipe(station.lid,[0,.11,0],[0,.11,-.95],.055,materials.steel);
    } else if(index===3){
      box(processGroup,0,1.65,0,1.72,.2,1.6,materials.dark);cylinder(processGroup,0,1.78,0,.59,.08,materials.trim);
      for(const x of [-.93,.93])pipe(processGroup,[x,1.6,-.53],[x,3.23,-.53],.07,materials.steel);
      cylinder(processGroup,0,3.01,0,.46,.48,materials.white);cylinder(processGroup,0,2.74,0,.28,.12,materials.dark);cylinder(processGroup,0,2.66,0,.27,.035,new T.MeshBasicMaterial({color:0xbfdcfe}));
      const mask=box(processGroup,0,2.16,0,1.14,.035,1.14,materials.glass);station.mask=mask;
      for(let i=0;i<6;i++)box(processGroup,-.45+i*.18,2.187,0,.085,.008,1.05,materials.dark);
      const beamMat=new T.MeshBasicMaterial({color:0x8b9fff,transparent:true,opacity:.17,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending});station.beam=mesh(new T.CylinderGeometry(.25,.66,.88,48,1,true),beamMat,processGroup,0,2.23,0);station.beam.visible=false;
      const glowMat=new T.MeshBasicMaterial({color:0xc0b6ff,transparent:true,opacity:.14,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending});station.lightDisc=mesh(new T.CircleGeometry(.59,64),glowMat,processGroup,0,1.861,0);station.lightDisc.rotation.x=-Math.PI/2;station.lightDisc.visible=false;
    } else if(index===6){
      cylinder(processGroup,0,1.69,0,.83,.2,materials.dark);cylinder(processGroup,0,1.78,0,.61,.06,materials.steel);ring(processGroup,0,1.82,0,.83,.055,materials.trim);cylinder(processGroup,0,2.7,0,.87,.16,materials.white);ring(processGroup,0,2.59,0,.77,.04,materials.steel);
      station.chamber=mesh(new T.CylinderGeometry(.84,.84,.77,64,1,true),materials.glass,processGroup,0,2.22,0);
      station.plasma=mesh(new T.SphereGeometry(.74,32,16),materials.purple.clone(),processGroup,0,2.12,0);station.plasma.scale.y=.38;station.plasma.visible=false;
      const particles=new T.Group();processGroup.add(particles);for(let i=0;i<35;i++){const dot=mesh(new T.SphereGeometry(.015,5,4),new T.MeshBasicMaterial({color:i%2?0xcbaaed:0x91aee8}),particles);dot.userData={phase:i/35,x:Math.sin(i*3.7)*.61,z:Math.cos(i*4.1)*.61};}station.particles=particles;particles.visible=false;
    } else {
      cylinder(processGroup,0,1.7,0,.76,.2,materials.dark);ring(processGroup,0,1.82,0,.83,.06,materials.steel);
      station.furnace=mesh(new T.CylinderGeometry(.89,.89,1.13,64,1,true),materials.amber,processGroup,0,2.27,0);
      station.heatRing=ring(processGroup,0,1.79,0,.73,.055,new T.MeshBasicMaterial({color:0xf4a15e,transparent:true,opacity:0}));
      cylinder(processGroup,0,2.86,0,.94,.11,materials.white);
    }
    stations.push(station);
  });
  const hardware=window.WaferHardware?.enhance({T,stations,materials,box,cylinder,ring,pipe,mesh});
  if(hardware){scene.environment=hardware.environment;scene.environmentIntensity=.75;}
  scene.add(key.target);
  // Robot end effector remains aligned with the wafer during transfer.
  const robot=new T.Group();scene.add(robot);
  box(robot,0,.39,0,1.1,.55,1.08,materials.dark);cylinder(robot,0,.8,0,.39,.4,materials.white);cylinder(robot,0,1.23,0,.22,.48,materials.steel);cylinder(robot,0,1.48,0,.36,.11,materials.dark);
  const armA=box(robot,0,1.54,0,1,.11,.25,materials.white),armB=box(robot,0,1.57,0,1,.09,.2,materials.white);
  const elbowJoint=cylinder(robot,0,1.58,0,.16,.15,materials.steel,24);
  const hand=new T.Group();robot.add(hand);box(hand,0,0,0,.22,.025,.69,materials.steel);box(hand,-.2,0,-.12,.05,.02,.51,materials.steel);box(hand,.2,0,-.12,.05,.02,.51,materials.steel);
  plaque(robot,0,.49,.55,'TRANSFER',.85);
  // A single actual workpiece travels through the entire cell.
  const wafer=new T.Group();scene.add(wafer);
  const waferMaterial=new T.MeshPhysicalMaterial({color:0x647f97,metalness:.88,roughness:.18,clearcoat:1,clearcoatRoughness:.12,iridescence:.8,iridescenceIOR:1.3});
  cylinder(wafer,0,0,0,.58,.026,waferMaterial,96);
  const waferCanvas=document.createElement('canvas');waferCanvas.width=1024;waferCanvas.height=1024;
  const waferTexture=new T.CanvasTexture(waferCanvas);waferTexture.colorSpace=T.SRGBColorSpace;waferTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const topMaterial=new T.MeshStandardMaterial({map:waferTexture,metalness:.65,roughness:.28,side:T.DoubleSide});
  const waferSurface=mesh(new T.CircleGeometry(.579,96),topMaterial,wafer,0,.014,0);waferSurface.rotation.x=-Math.PI/2;
  const notch=mesh(new T.SphereGeometry(.017,10,8),materials.black,wafer,0,.014,.58);notch.scale.y=.4;
  const selectionMat=new T.MeshBasicMaterial({color:0xb9de82,transparent:true,opacity:.45,depthWrite:false});const selectionRing=ring(scene,0,1.56,0,1.13,.012,selectionMat);
  const labelLayer=$('#machineLabels');
  stations.forEach((station,i)=>{const b=document.createElement('button');b.className='station-label';b.dataset.station=String(i);b.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span>${WaferEngine.stages[i].name}`;b.addEventListener('click',()=>selectStage(i));labelLayer.append(b);station.label=b;});
  let active=window.WaferAppBridge?.snapshot().stageIndex??3,playing=false,elapsed=0,speed=1,cutaway=true,follow=false,finished=false,started=false,displayMode='detail',lastTime=performance.now(),visible=true,renderCounter=0;
  let phase='PROCESS',phaseProgress=1,textureKey='',drag=null,dragged=false,zoomMode='overview';
  let annotations=true,componentIndex=0,annotationKey='',statusKey='';
  const componentLayer=$('#machineAnnotations');
  const waferPosition=new T.Vector3(),lastWaferPosition=new T.Vector3();
  $('#equipmentNav').innerHTML=equipmentNames.map((name,i)=>`<button class="equipment-tab" data-equipment="${i}" aria-pressed="${i===active}"><span>${String(i+1).padStart(2,'0')} / ${WaferEngine.stages[i].short}</span><strong>${WaferEngine.stages[i].name}</strong><small>${name}</small></button>`).join('');
  document.querySelectorAll('[data-equipment]').forEach(b=>b.addEventListener('click',()=>selectStage(Number(b.dataset.equipment))));
  function state(){return window.WaferAppBridge?.snapshot()||{params:WaferEngine.defaults,result:WaferEngine.simulate(WaferEngine.defaults),stageIndex:active};}
  function paintWafer(stage,progress,output){
    const key=stage+'-'+Math.floor(progress*24)+'-'+Math.round(output.residue)+'-'+Math.round(output.cd);if(key===textureKey)return;textureKey=key;
    const ctx=waferCanvas.getContext('2d'),pr=['#442d69','#9b568b','#313d77'],oxide=['#295478','#7682aa','#2e6580'],silicon=['#334a5b','#90a3ad','#465d70'];
    const mix=(a,b,t)=>{const c=[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t));return 'rgb('+c.join(',')+')';};
    const colors=stage===0?silicon.map((c,i)=>mix(c,oxide[i],progress)):stage===1?oxide:stage===7?pr.map((c,i)=>mix(c,oxide[i],progress)):pr;
    const grad=ctx.createLinearGradient(0,0,1024,1024);colors.forEach((c,i)=>grad.addColorStop(i*.5,c));ctx.fillStyle=grad;ctx.fillRect(0,0,1024,1024);
    if(stage===1){const prGradient=ctx.createRadialGradient(512,512,10,512,512,600);prGradient.addColorStop(0,'#a3679d');prGradient.addColorStop(1,'#3f315d');ctx.fillStyle=prGradient;ctx.beginPath();ctx.arc(512,512,Math.min(750,progress*1100),0,Math.PI*2);ctx.fill();}
    if(stage>=3){
      for(let y=40;y<1020;y+=82)for(let x=40;x<1020;x+=82){
        ctx.strokeStyle=stage>=5?'#82c8bb66':'#e5bbda33';ctx.lineWidth=1.5;ctx.strokeRect(x,y,70,70);
        for(let k=0;k<4;k++){
          const latent=stage===3?progress:1;
          ctx.fillStyle=stage<5?'rgba(184,166,210,'+latent*.43+')':stage===5?'rgba(103,192,179,'+progress+')':stage===6?mix('#67c0b3','#243b51',progress):'#243b51';
          ctx.fillRect(x+9+k*14,y+12,5+Math.min(5,output.cd/150),45);
          ctx.fillStyle=stage>=5?'rgba(127,175,180,'+(stage===5?progress:.8)+')':'rgba(184,166,210,'+latent*.3+')';ctx.fillRect(x+7,y+8,53,4);
        }
        if(stage===5&&output.residue>15&&((x+y)/82)%3<1){ctx.fillStyle='rgba(174,117,147,'+progress*.55+')';ctx.fillRect(x+10,y+16,46,39);}
      }
    }
    ctx.strokeStyle='#c6d9dccc';ctx.lineWidth=3;ctx.beginPath();ctx.arc(512,512,501,0,Math.PI*2);ctx.stroke();waferTexture.needsUpdate=true;
  }
  function getPhase(t){if(t<.30)return {phase:'TRANSFER',fraction:t/.30};if(t<.91)return{phase:'PROCESS',fraction:(t-.30)/.61};return{phase:'INSPECT',fraction:(t-.91)/.09};}
  function positionFor(index,phase,fraction){
    const to=stations[index].point;
    if(phase!=='TRANSFER')return to.clone();
    const from=displayMode==='detail'?new T.Vector3(to.x,1.88,to.z+stations[index].front*2.05):index===0?new T.Vector3(-10,1.85,0):stations[index-1].point;
    // Retract from the chamber, travel on the rail, then insert above the chuck.
    const t=smooth(fraction),lift=.2*Math.sin(Math.PI*fraction),height=T.MathUtils.lerp(from.y,to.y,t)+lift;
    if(displayMode==='detail')return new T.Vector3(to.x,height,T.MathUtils.lerp(from.z,to.z,t));
    if(t<.27)return new T.Vector3(from.x,height,T.MathUtils.lerp(from.z,0,t/.27));
    if(t<.73)return new T.Vector3(T.MathUtils.lerp(from.x,to.x,(t-.27)/.46),height,0);
    return new T.Vector3(to.x,height,T.MathUtils.lerp(0,to.z,(t-.73)/.27));
  }
  function pointArm(a,b,arm){arm.position.copy(a).add(b).multiplyScalar(.5);arm.scale.x=a.distanceTo(b);arm.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);}
  function updateRobot(pos,moving){
    robot.position.x=pos.x;
    const end=new T.Vector3(0,moving?pos.y-.055:1.65,moving?pos.z:.53);
    const start=new T.Vector3(0,1.55,0),mid=new T.Vector3(Math.sqrt(Math.max(.1,1.65**2-(end.z/2)**2)),(end.y+start.y)/2,end.z/2);
    pointArm(start,mid,armA);pointArm(mid,end,armB);elbowJoint.position.copy(mid);hand.position.copy(end);hand.rotation.y=end.z<0?0:Math.PI;
  }
  function updateProcess(index,phase,progress,seconds){
    const snapshot=state(),p=snapshot.params,output=snapshot.result;
    const on=phase==='PROCESS',moving=phase==='TRANSFER';
    waferPosition.copy(positionFor(index,phase,progress));wafer.position.copy(waferPosition);
    wafer.rotation.y=on&&[1,5,7].includes(index)?seconds*(index===1?p.rpm/400:2):0;
    const materialStage=phase==='TRANSFER'?Math.max(0,index-1):index;
    paintWafer(materialStage,phase==='TRANSFER'?(index===0?0:1):phase==='INSPECT'?1:progress,output);
    robot.visible=displayMode==='overview'||moving;
    updateRobot(waferPosition,moving);selectionRing.position.set(stations[index].point.x,1.58,stations[index].point.z);
    stations.forEach((s,i)=>{
      const activeHere=i===index;
      s.lampMat.color.setHex(activeHere?0xbddb88:0x5f8770);s.lampMat.emissiveIntensity=activeHere?1.1:.12;
      s.label.classList.toggle('active',activeHere);
      if(s.stream)s.stream.visible=activeHere&&on&&progress>.08&&progress<.58;
      if(s.nozzle){const swing=activeHere&&on?smooth(clamp(progress/.08,0,1))*(1-smooth(clamp((progress-.6)/.16,0,1))):0;s.nozzle.rotation.y=-.9*(1-swing);}
      if(s.drops){s.drops.visible=activeHere&&on;s.drops.children.forEach(d=>{const t=(seconds*.6+d.userData.phase)%1;const radius=.45+t*.77;d.position.set(Math.cos(d.userData.angle+seconds*2)*radius,1.75-t*.2,Math.sin(d.userData.angle+seconds*2)*radius);});}
      if(s.heatRing){s.heatRing.material.opacity=activeHere&&on?.7+Math.sin(seconds*2)*.15:.03;}
      if(s.lid){const close=activeHere&&on?smooth(clamp(progress/.12,0,1))*(1-smooth(clamp((progress-.88)/.12,0,1))):0;s.lid.position.y=2.8-close*.72;}
      if(s.beam){s.beam.visible=activeHere&&on;s.beam.material.opacity=.1+p.dose/1200+Math.sin(seconds*4)*.025;s.lightDisc.visible=activeHere&&on;}
      if(s.plasma){s.plasma.visible=activeHere&&on;s.plasma.material.opacity=.12+p.power/1600+Math.sin(seconds*8)*.03;s.particles.visible=activeHere&&on;s.particles.children.forEach(dot=>{dot.position.set(dot.userData.x,2.55-((seconds*.7+dot.userData.phase)%1)*.7,dot.userData.z);});}
    });
    return snapshot;
  }
  function setMode(mode){displayMode=mode;const detail=mode==='detail',station=stations[active];key.target.position.set(detail?station.point.x:0,detail?1.5:0,detail?station.point.z:0);key.position.set(detail?station.point.x-5:-7,detail?11:17,detail?station.point.z+station.front*7:10);Object.assign(key.shadow.camera,{left:detail?-5:-16,right:detail?5:16,top:detail?5:13,bottom:detail?-5:-13});key.shadow.camera.updateProjectionMatrix();roomScenery.forEach(o=>o.visible=mode==='overview');stations.forEach((s,i)=>s.group.visible=mode==='overview'||i===active);foup.visible=mode==='overview';robot.visible=true;selectionRing.visible=mode==='overview';$('#machineEquipmentCard').hidden=mode!=='detail';$('#machineOverview').classList.toggle('selected',mode==='overview');$('#machineNext').hidden=mode!=='detail';$('#machineNext').disabled=active===7;$('#machineOverview').textContent=mode==='overview'?'◫ 현재 장비로':'▦ 전체 장비실';if(mode==='detail')focusStation(active,true);else setCamera('overview');updateStatus();}
  function selectStage(index){pause();active=clamp(index,0,7);elapsed=active*11+5.5;phase='PROCESS';phaseProgress=(.5-.3)/.61;componentIndex=0;finished=false;started=false;window.WaferAppBridge?.selectStage(active);setMode('detail');updateStatus();}
  function focusStation(index,automatic=false){
    const pos=stations[index].point;desiredTarget.set(pos.x,1.85,pos.z);desiredDistance=Math.max(7.3,4.7/Math.max(.5,camera.aspect));desiredElevation=.59;desiredAzimuth=stationPositions[index][1]<0?.26:2.9;zoomMode='close';
    $('#machineViewLabel').textContent=`${equipmentNames[index]} · 내부 확대`;
    document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera==='close'));
  }
  function pause(){playing=false;$('#machinePlay').innerHTML=`▶ <span>${displayMode==='detail'?'이 장비 가동':'전체 공정 재생'}</span>`;$('#machinePlay').setAttribute('aria-pressed','false');}
  function toggle(){if(playing){pause();return;}if(finished||!started){if(displayMode==='overview')active=0;elapsed=active*11;finished=false;}started=true;playing=true;$('#machinePlay').innerHTML='Ⅱ <span>일시정지</span>';$('#machinePlay').setAttribute('aria-pressed','true');window.WaferAppBridge?.selectStage(active);if(follow||displayMode==='detail')focusStation(active,true);}
  function reset(){pause();if(displayMode==='overview')active=0;elapsed=active*11;phase='TRANSFER';phaseProgress=0;finished=false;started=false;window.WaferAppBridge?.selectStage(active);updateStatus();}
  function seek(fraction){
    if(!Number.isFinite(fraction))return;
    pause();const f=clamp(fraction,0,1);elapsed=displayMode==='detail'?active*11+f*11:f*88;
    if(displayMode==='overview'){active=Math.min(7,Math.floor(elapsed/11));window.WaferAppBridge?.selectStage(active);}
    const local=(elapsed-active*11)/11,info=getPhase(local);phase=info.phase;phaseProgress=clamp(info.fraction,0,1);finished=f===1;started=true;
    updateProcess(active,phase,phaseProgress,elapsed);updateStatus();
  }
  function inspectComponent(index){
    const parts=stations[active].components||[];componentIndex=clamp(index,0,Math.max(0,parts.length-1));const part=parts[componentIndex];if(!part)return;
    $('#componentNumber').textContent=String(componentIndex+1).padStart(2,'0');$('#componentName').textContent=part.name;$('#componentDescription').textContent=part.description;
    componentLayer.querySelectorAll('[data-component]').forEach(b=>{const selected=Number(b.dataset.component)===componentIndex;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  }
  function renderComponents(){
    const key=active+'-'+displayMode+'-'+annotations;if(key===annotationKey)return;annotationKey=key;
    componentLayer.hidden=!annotations||displayMode!=='detail';$('#machineComponentInfo').hidden=componentLayer.hidden;$('#machineReadout').hidden=displayMode!=='detail';
    const parts=stations[active].components||[];
    componentLayer.innerHTML='<svg class="annotation-connectors" aria-hidden="true">'+parts.map((_,i)=>'<line data-leader="'+i+'"/><circle data-anchor="'+i+'" r="4"/>').join('')+'</svg>'+parts.map((p,i)=>'<button class="component-label" data-component="'+i+'" aria-label="'+p.name+' 설명" aria-pressed="false"><b>'+String(i+1).padStart(2,'0')+'</b><span>'+p.name+'</span></button>').join('');
    componentLayer.querySelectorAll('[data-component]').forEach(b=>b.addEventListener('click',()=>inspectComponent(Number(b.dataset.component))));inspectComponent(componentIndex);
  }
  function positionComponents(){
    if(componentLayer.hidden)return;const w=host.clientWidth,h=host.clientHeight,s=stations[active],mobile=w<650;
    const offsets=mobile?[[-56,-48],[68,16],[-69,60]]:[[-182,-54],[90,15],[-156,83]];
    (s.components||[]).forEach((part,i)=>{
      const p=new T.Vector3(...part.position);if(s.lid&&i===1)p.y=s.lid.position.y;
      if(s.dispenseTip&&i===0)s.dispenseTip.getWorldPosition(p);else p.applyMatrix4(s.group.matrixWorld);p.project(camera);
      const b=componentLayer.querySelector('[data-component="'+i+'"]'),line=componentLayer.querySelector('[data-leader="'+i+'"]'),dot=componentLayer.querySelector('[data-anchor="'+i+'"]');
      const x=(p.x+1)*w/2,y=(-p.y+1)*h/2,outside=p.z>1||p.z<-1||x<0||x>w||y<0||y>h;b.hidden=outside;line.style.display=dot.style.display=outside?'none':'';if(outside)return;
      const labelWidth=b.offsetWidth||(window.innerWidth<=700?40:165);const bx=clamp(x+offsets[i][0],14,w-labelWidth-14),by=clamp(y+offsets[i][1],150,h-(mobile?160:90));b.style.transform='translate('+bx+'px,'+by+'px)';
      line.setAttribute('x1',x);line.setAttribute('y1',y);line.setAttribute('x2',bx+16);line.setAttribute('y2',by+17);dot.setAttribute('cx',x);dot.setAttribute('cy',y);
    });
  }
  function updateStatus(){
    const stage=WaferEngine.stages[active];
    const local=clamp((elapsed-active*11)/11,0,1),overall=displayMode==='detail'?local:elapsed/88;
    $('#machineScrubber').value=String(Math.round(overall*1000));$('#machineScrubber').setAttribute('aria-valuetext',equipmentNames[active]+' '+Math.round(local*100)+'%');
    const phaseIndex=local<.2?0:local<.3?1:local<.91?2:3;document.querySelectorAll('[data-phase-position]').forEach((b,i)=>{b.classList.toggle('active',i===phaseIndex);b.setAttribute('aria-pressed',String(i===phaseIndex));});renderComponents();const word=phase==='TRANSFER'?'로봇 이송 중':phase==='INSPECT'?'가공 확인':playing?'웨이퍼 가공 중':'장비 관찰';
    $('#machineStageName').textContent=equipmentNames[active];$('#machinePhase').textContent=finished?(displayMode==='detail'?'이 장비의 가공 완료':'전체 가공 완료'):word;$('#machineProgress').style.width=`${finished?100:displayMode==='detail'?(elapsed-active*11)/11*100:elapsed/88*100}%`;$('#machineStepCount').textContent=`${String(active+1).padStart(2,'0')} / 08`;
    $('#machineTime').textContent=`${Math.floor(displayMode==='detail'?elapsed-active*11:elapsed).toString().padStart(2,'0')} / ${displayMode==='detail'?11:88} s`;
    $('#machineEquipmentTitle').textContent=equipmentNames[active];$('#machineEquipmentDescription').textContent=equipmentInfo[active][0];$('#machineMaterialChange').textContent=equipmentInfo[active][1];$('#machineComponents').textContent=equipmentInfo[active][2];$('#machineNext').disabled=active===7;
    document.querySelectorAll('[data-equipment]').forEach(b=>{const selected=Number(b.dataset.equipment)===active;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    if(!playing)$('#machinePlay').innerHTML=`▶ <span>${displayMode==='detail'?'이 장비 가동':'전체 공정 재생'}</span>`;
    const p=state().params;const processInfo=[`${p.temperature} °C · ${p.oxidationTime} min`,`${p.rpm.toLocaleString()} rpm · PR 공급`,`${p.bakeTemp} °C · ${p.bakeTime} s`,`${p.dose} mJ/cm² · ${p.focus} µm`,`${p.pebTemp} °C · 60 s`,`${p.developTime} s · Developer`,`${p.power} W · ${p.pressure} mTorr`, 'PR 제거 · 패턴 검사'];
    $('#machineTelemetry').textContent=phase==='TRANSFER'?'TRANSFER ROBOT · SINGLE WAFER':processInfo[active];
    const readouts=[[p.temperature+' °C','산화 온도 설정'],[p.rpm.toLocaleString()+' rpm','스핀 속도 설정'],[p.bakeTemp+' °C','베이크 온도 설정'],[p.dose+' mJ/cm²','노광량 설정'],[p.pebTemp+' °C','PEB 온도 설정'],[p.developTime+' s','현상 시간 설정'],[p.power+' W','RF 파워 설정'],[Math.round((phase==='INSPECT'?1:phase==='TRANSFER'?0:phaseProgress)*100)+' %','제거 장면 진행률']];
    $('#machineReadoutValue').textContent=readouts[active][0];$('#machineReadoutLabel').textContent=readouts[active][1];
    const status=active+'-'+displayMode+'-'+playing+'-'+phase+'-'+finished;
    if(status!==statusKey){statusKey=status;host.dataset.phase=phase.toLowerCase();host.dataset.playing=String(playing);}

  }
  function setCamera(mode){
    zoomMode=mode;if(mode==='close'){focusStation(active,true);return;}
    if(displayMode==='detail'){
      const pos=stations[active].point;desiredTarget.set(pos.x,mode==='top'?1.6:1.85,pos.z);desiredDistance=Math.max(mode==='top'?7.5:8.3,4.7/Math.max(.5,camera.aspect));desiredAzimuth=stations[active].front>0?0:Math.PI;desiredElevation=mode==='top'?1.49:.59;
      $('#machineViewLabel').textContent=equipmentNames[active]+(mode==='top'?' · 탑뷰':' · 기본 시점');
    }else{desiredTarget.set(-.2,1.05,0);desiredDistance=Math.max(mode==='top'?28:27,33/Math.max(.5,camera.aspect));desiredAzimuth=mode==='top'?0:.62;desiredElevation=mode==='top'?1.49:.76;$('#machineViewLabel').textContent=mode==='top'?'탑뷰 · 장비 배치':'전체 장비실';}
    document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera===mode));
  }
  function toggleCutaway(){cutaway=!cutaway;stations.forEach(s=>{s.shellMat.opacity=cutaway?.08:1;s.shellMat.depthWrite=!cutaway;s.windowMat.opacity=cutaway?.04:.35;s.shell.traverse(o=>{if(o.isMesh)o.castShadow=!cutaway&&o.material===s.shellMat;});});$('#machineCutaway').setAttribute('aria-pressed',String(cutaway));$('#machineCutaway').classList.toggle('selected',cutaway);}
  const raycaster=new T.Raycaster(),pointer=new T.Vector2();
  renderer.domElement.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,az:desiredAzimuth,el:desiredElevation};dragged=false;renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)dragged=true;desiredAzimuth=drag.az-dx*.007;desiredElevation=clamp(drag.el+dy*.006,.2,1.5);});
  renderer.domElement.addEventListener('pointerup',e=>{drag=null;if(dragged)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(pickable.filter(m=>m.parent.visible))[0];if(hit)selectStage(hit.object.userData.station);});
  renderer.domElement.addEventListener('pointercancel',()=>{drag=null;});
  renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();desiredDistance=clamp(desiredDistance*Math.exp(e.deltaY*.001),4,65);},{passive:false});
  renderer.domElement.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')desiredAzimuth-=.15;else if(e.key==='ArrowRight')desiredAzimuth+=.15;else if(e.key==='ArrowUp')desiredElevation=clamp(desiredElevation+.1,.2,1.5);else if(e.key==='ArrowDown')desiredElevation=clamp(desiredElevation-.1,.2,1.5);else if(e.key==='+'||e.key==='=')desiredDistance=clamp(desiredDistance-1,4,39);else if(e.key==='-')desiredDistance=clamp(desiredDistance+1,4,39);else return;e.preventDefault();});
  $('#machinePlay').addEventListener('click',toggle);$('#machineReset').addEventListener('click',reset);
  $('#machineOverview').addEventListener('click',()=>{pause();started=false;finished=false;setMode(displayMode==='detail'?'overview':'detail');});
  $('#machineNext').addEventListener('click',()=>{if(active<7)selectStage(active+1);});
  $('#machineScrubber').addEventListener('input',e=>seek(Number(e.target.value)/1000));
  document.querySelectorAll('[data-phase-position]').forEach(b=>b.addEventListener('click',()=>{const fraction=Number(b.dataset.phasePosition);seek(displayMode==='detail'?fraction:(active+fraction)/8);}));
  $('#machineAnnotationsToggle').addEventListener('click',()=>{annotations=!annotations;$('#machineAnnotationsToggle').setAttribute('aria-pressed',String(annotations));$('#machineAnnotationsToggle').classList.toggle('selected',annotations);renderComponents();});
  $('#machineSpeed').addEventListener('change',e=>{speed=Number(e.target.value);});
  $('#machineCutaway').addEventListener('click',toggleCutaway);
  document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));
  $('#machineFollow').addEventListener('click',()=>{follow=!follow;$('#machineFollow').setAttribute('aria-pressed',String(follow));$('#machineFollow').classList.toggle('selected',follow);if(follow)focusStation(active,true);});
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(w<1||h<1)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(zoomMode==='close')focusStation(active,true);else setCamera(zoomMode);};
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);resize();
  const visibilityObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{threshold:0});visibilityObserver.observe(host);
  function labels(){const w=host.clientWidth,h=host.clientHeight;stations.forEach(s=>{const pos=new T.Vector3(s.group.position.x,3.9,s.group.position.z);pos.project(camera);s.label.style.transform=`translate(-50%,-50%) translate(${(pos.x+1)*w/2}px,${(-pos.y+1)*h/2}px)`;s.label.hidden=displayMode==='detail'||pos.z>1||Math.abs(pos.x)>1.04||Math.abs(pos.y)>1.04;});}
  let raf;
  function tick(now){raf=requestAnimationFrame(tick);const dt=Math.min((now-lastTime)/1000,.1);lastTime=now;if(document.hidden)return;
    if(!playing){const index=state().stageIndex;if(index!==active){active=index;phase='PROCESS';phaseProgress=(.5-.3)/.61;elapsed=index*11+5.5;componentIndex=0;started=false;finished=false;setMode('detail');updateStatus();}}
    if(playing){const end=displayMode==='detail'?(active+1)*11:88;elapsed=Math.min(end,elapsed+dt*speed);const next=displayMode==='detail'?active:Math.min(7,Math.floor(elapsed/11));if(next!==active){active=next;window.WaferAppBridge?.selectStage(active);if(follow)focusStation(active,true);}const phaseInfo=getPhase((elapsed%11)/11);phase=phaseInfo.phase;phaseProgress=phaseInfo.fraction;if(elapsed>=end){phase='INSPECT';phaseProgress=1;finished=true;pause();}updateStatus();}
    if(!visible)return;
    updateProcess(active,phase,phaseProgress,elapsed);
    target.lerp(desiredTarget,.085);distance=T.MathUtils.lerp(distance,desiredDistance,.08);azimuth=T.MathUtils.lerp(azimuth,desiredAzimuth,.08);elevation=T.MathUtils.lerp(elevation,desiredElevation,.08);
    camera.position.set(target.x+distance*Math.cos(elevation)*Math.sin(azimuth),target.y+distance*Math.sin(elevation),target.z+distance*Math.cos(elevation)*Math.cos(azimuth));camera.lookAt(target);renderer.render(scene,camera);if(++renderCounter%2===0){labels();positionComponents();}if(!playing&&renderCounter%15===0)updateStatus();
  }
  elapsed=active*11+5.5;phaseProgress=(.5-.3)/.61;setMode('detail');target.copy(desiredTarget);distance=desiredDistance;azimuth=desiredAzimuth;elevation=desiredElevation;updateProcess(active,phase,phaseProgress,elapsed);updateStatus();raf=requestAnimationFrame(tick);
  window.WaferMachine={toggle,pause,selectStage,reset,seek,inspectComponent,focusStation,scene,camera,renderer,stations,wafer,robot,getState:()=>({active,playing,elapsed,phase,phaseProgress,cutaway,follow,displayMode,annotations,componentIndex,position:wafer.position.toArray()}),dispose(){cancelAnimationFrame(raf);resizeObserver.disconnect();visibilityObserver.disconnect();const geometries=new Set(),mats=new Set(),textures=new Set();if(scene.environment)textures.add(scene.environment);scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{mats.add(m);Object.values(m).forEach(v=>{if(v?.isTexture)textures.add(v);});});});geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();}};
})();

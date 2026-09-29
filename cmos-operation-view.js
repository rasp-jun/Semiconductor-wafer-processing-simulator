/* Exterior operation display. Positions refer to our authored AXIS enclosures,
   not vendor dimensions. Location markers and the transport strip are diagrams;
   the surface monitor uses the actual simulated wafer. No independent clock. */
(function(root){
  'use strict';
  const profiles={
    clean:{port:[-2.2,2.45],zone:[0,3.2,1.48],name:'습식 처리조',prepare:'이송 지그 고정 · 처리액 준비',process:'약액 세정 · 초순수 린스'},
    wetetch:{port:[-3,2.5],zone:[0,3.2,1.40],name:'약액 작업대',prepare:'클램프 고정 · 약액 침지',process:'선택 식각 · 잔류 약액 세정'},
    oxidation:{port:[-2.45,1.28],zone:[0,4.45,1.4],name:'수직 산화 반응관',prepare:'보트 상승 · 반응관 준비',process:'산화 분위기에서 열처리'},
    lpcvd:{port:[-1.2,2.17],zone:[0,4.38,1.2],name:'저압 수직 반응관',prepare:'보트 상승 · 압력 안정화',process:'반응 가스 공급 · 박막 성장'},
    coat:{port:[-2.35,1.4],zone:[0,2.62,1.58],name:'스핀 코팅 모듈',prepare:'척 안착 · 디스펜서 접근',process:'감광액 공급 · 회전 도포'},
    developer:{port:[-3.23,.65],zone:[.45,3.2,1.4],name:'현상 · 린스 모듈',prepare:'척 안착 · 약액 공급 준비',process:'감광막 현상 · 세정'},
    bake:{port:[-2.53,1.87],zone:[0,2.35,1.4],name:'열처리 플레이트',prepare:'플레이트 안착 · 덮개 닫힘',process:'설정 조건으로 가열'},
    scanner:{port:[-2.14,2.67],zone:[0,3.3,1.3],name:'투영 노광 스테이지',prepare:'웨이퍼 정렬 · 광학계 준비',process:'스테이지 이동 · 순차 노광'},
    etch:{port:[-.8,2.25],zone:[2.65,3.7,-.75],name:'ICP 공정 챔버',prepare:'게이트 닫힘 · 압력 안정화',process:'ICP 플라즈마 식각'},
    strip:{port:[-2.12,1.84],zone:[1.15,4.0,-.58],name:'원격 플라즈마 모듈',prepare:'게이트 닫힘 · 처리 준비',process:'라디칼 공급 · 감광막 제거'},
    pecvd:{port:[-.78,2.67],zone:[.95,3.4,.73],name:'플라즈마 증착 모듈',prepare:'압력 안정화 · 가스 준비',process:'플라즈마 반응 · 절연막 증착'},
    ald:{port:[-1.03,2.25],zone:[0,3.5,0],name:'원자층 증착 반응부',prepare:'챔버 준비 · 공급부 안정화',process:'전구체 공급 · 퍼지 반복'},
    implant:{port:[2.6,2.06],zone:[1.74,3.3,0],name:'이온 주입 엔드 스테이션',prepare:'웨이퍼 기울임 · 빔라인 준비',process:'이온 빔으로 도펀트 주입'},
    rtp:{port:[-1.67,2.3],zone:[0,3.55,0],name:'복사 가열 램프',prepare:'덮개 닫힘 · 가열 준비',process:'램프 가열 · 열처리 유지'},
    cmp:{port:[-2.56,2.58],zone:[0,2.3,1.13],name:'연마 캐리어 · 플래튼',prepare:'캐리어 하강 · 패드 접촉',process:'회전 연마 · 표면 평탄화'},
    pvd:{port:[-.76,2.45],zone:[2.57,3.4,-.1],name:'금속 타깃 챔버',prepare:'게이트 닫힘 · 진공 준비',process:'타깃 스퍼터링 · 금속 증착'},
    metrology:{port:[-2.54,1.59],zone:[0,3.2,1.43],name:'광학 측정 스테이지',prepare:'웨이퍼 정렬 · 광학계 준비',process:'스테이지 이동 · 광학 측정'},
    probe:{port:[-2.48,1.43],zone:[0,3.6,1.35],name:'프로브 카드 · 척',prepare:'웨이퍼 정렬 · 접촉 준비',process:'프로브 접촉 · 전기적 검사'}
  };
  const phases=['load','condition','process','unload'],labels=['반입','준비','처리','반출'];
  function sample(tool,state){
    const profile=profiles[tool],index=phases.indexOf(state?.phase),progress=Math.max(0,Math.min(1,state?.progress||0));
    if(!profile||index<0)return null;
    const atPort=index===0||index===3;
    return {tool,index,phase:phases[index],progress,paused:!state.running,elapsed:state.elapsed||0,
      label:labels[index],zone:atPort?'로드포트 / FOUP':profile.name,
      anchor:atPort?[profile.port[0],2.55,profile.port[1]+.47]:profile.zone,
      action:index===0?'FOUP에서 공정 모듈로 웨이퍼 반입':index===1?profile.prepare:index===2?profile.process:'처리 웨이퍼를 원래 슬롯으로 회수'};
  }
  function create(T,host){
    const inspection={axisInspection:{value:0},axisLens:{value:new T.Vector4()}};
    // The dedicated observation pass shares the main camera and follows the
    // wafer's real exterior pose. Clip its contents to the circular lens.
    function inspectGeometry(object){
      const copies=new Map();
      object.traverse(o=>{if(!o.isMesh)return;const source=o.material;
        if(!copies.has(source)){
          const m=source.clone();
          m.transparent=true;
          m.onBeforeCompile=shader=>{
            Object.assign(shader.uniforms,inspection);
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float axisInspection;\nuniform vec4 axisLens;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(axisInspection > 0.5 && distance(gl_FragCoord.xy,axisLens.xy)>axisLens.z) discard;');
          };
          m.customProgramCacheKey=()=> 'axis-wafer-observation-v2';
          copies.set(source,m);
        }
        o.material=copies.get(source);
      });
      return [...copies.keys()];
    }
    function backdrop(){
      const m=new T.ShaderMaterial({uniforms:inspection,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
        vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader:'uniform vec4 axisLens;void main(){float d=distance(gl_FragCoord.xy,axisLens.xy)/axisLens.z;if(d>1.0)discard;gl_FragColor=vec4(mix(vec3(0.10,0.16,0.20),vec3(0.055,0.08,0.11),d),0.85-0.4*smoothstep(0.55,1.0,d));}'});
      const mesh=new T.Mesh(new T.PlaneGeometry(2,2),m);mesh.frustumCulled=false;mesh.renderOrder=-100;return mesh;
    }
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),texture=new T.CanvasTexture(canvas);
    texture.colorSpace=T.SRGBColorSpace;texture.minFilter=T.LinearFilter;texture.generateMipmaps=false;
    const geometry=new T.PlaneGeometry(2,2),material=new T.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
    const overlay=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,2);camera.position.z=1;overlay.add(new T.Mesh(geometry,material));
    const summary=document.createElement('p');summary.className='equipment-operation-status';summary.hidden=true;summary.setAttribute('role','status');summary.setAttribute('aria-live','off');host.append(summary);
    let indicators=[],screens=[],group=null;
    function attach(tool,model){
      indicators=[];screens=[];group=new T.Group();group.name='axis-exterior-operation';group.userData.equipmentRole='exterior';
      const profile=profiles[tool];if(!profile)return group;
      // Status lamps sit on the existing docking shelf's front edge. They do not
      // move the sealed pod or put the internal robot through the outer housing.
      const [x,z]=profile.port,accent=root.CmosEquipmentCatalog?.[tool]?.accent||'#9bd8c8';
      const barGeometry=new T.BoxGeometry(.086,.038,.012);
      for(let i=0;i<10;i++){
        const lamp=new T.Mesh(barGeometry,new T.MeshStandardMaterial({color:0x253b44,emissive:accent,emissiveIntensity:0,roughness:.28}));
        lamp.position.set(x+(i-4.5)*.101,1.57,z+1.002);lamp.name='load-port-status-'+i;group.add(lamp);indicators.push(lamp);
      }
      model.traverse(o=>{if(o.isMesh&&o.userData.equipmentRole==='exterior'&&o.material.name==='HMI display')screens.push(o.material);});
      return group;
    }
    function update(tool,state,internal){
      const s=sample(tool,state);if(group)group.visible=!internal;
      const intensity=s?(s.paused?.38:.65+.2*Math.sin(s.elapsed*3)):0;
      indicators.forEach((lamp,i)=>{const filled=s&&(s.index===0?i/10<s.progress:s.index===3?i/10<1-s.progress:true);lamp.material.emissiveIntensity=filled?intensity:0;});
      screens.forEach(m=>{m.emissive.set('#81c3da');m.emissiveIntensity=s?.16:0;});
      summary.hidden=internal||!s;
      if(s&&!internal){const text=`장비 외관 · ${s.paused?'일시정지':'실행 중'} · ${s.label} ${Math.round(s.progress*100)}% · ${s.zone} · ${s.action}. 관찰 렌즈가 본 화면의 이동 중인 웨이퍼를 따라갑니다. 가공면 확대창은 현재 웨이퍼 표면입니다.`;if(summary.textContent!==text)summary.textContent=text;summary.dataset.phase=s.phase;summary.dataset.zone=s.zone;summary.dataset.progress=String(s.progress);}
    }
    function focus(renderer,viewCamera,layout,wafer,active){
      inspection.axisInspection.value=active?1:0;
      host.dataset.waferTracking=String(active);
      if(!active)return;
      const p=wafer.position.clone().project(viewCamera),{width,height,mainWidth,mainHeight,mainTop}=layout;
      const x=(p.x+1)*mainWidth/2,y=mainTop+(1-p.y)*mainHeight/2;
      const depth=-wafer.position.clone().applyMatrix4(viewCamera.matrixWorldInverse).z;
      const radius=Math.max(20,Math.min(48,Math.max(34,mainHeight*1.3/(2*depth*Math.tan(viewCamera.fov*Math.PI/360))),x-5,mainWidth-x-5,y-mainTop-5,mainTop+mainHeight-y-5));
      const ratio=renderer.getPixelRatio();inspection.axisLens.value.set(x*ratio,(height-y)*ratio,radius*ratio,depth);
      layout.lens={x,y,radius};
    }
    function render(renderer,viewCamera,layout,tool,state){
      const s=sample(tool,state);if(!s)return;
      const {width,height,mainWidth,mainHeight,mainTop}=layout,ratio=Math.min(root.devicePixelRatio||1,1.75),w=Math.round(width*ratio),h=Math.round(height*ratio);
      // WebGL2 texture storage is immutable after upload. Reallocate on a real
      // size change, otherwise portrait resizing leaves tiled/stale HUD pixels.
      if(canvas.width!==w||canvas.height!==h){texture.dispose();canvas.width=w;canvas.height=h;}
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      const accent=root.CmosEquipmentCatalog?.[tool]?.accent||'#9bd8c8',compact=width<600;
      const text=(value,x,y,color='#dbe5ed',font='11px system-ui',align='left')=>{ctx.font=font;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);};
      const line=(x,y,xx,yy,color)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();};
      const circle=(x,y,r,color)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();};
      ctx.fillStyle=s.paused?'#efb76b':accent;ctx.fillRect(21,20,5,5);
      text(s.paused?'HOLD / 일시정지':'LIVE / 공정 실행 중',34,25,'#ebf0f4','600 10px system-ui');
      text('웨이퍼 이동 · 자동 관찰',mainWidth-16,25,'#8299ac',compact?'8px system-ui':'9px system-ui','right');
      // A camera-projected locator, explicitly schematic. It remains readable
      // through a closed enclosure without rendering a fake wafer outside it.
      const point=new T.Vector3(...s.anchor).project(viewCamera),px=layout.lens?.x??(point.x+1)*mainWidth/2,py=layout.lens?.y??mainTop+(1-point.y)*mainHeight/2;
      if(layout.precision&&point.z>-1&&point.z<1&&px>15&&px<mainWidth-15&&py>mainTop+14&&py<mainTop+mainHeight-20){
        const radius=layout.lens?.radius||12;circle(px,py,radius+2,'#efb76baa');
        const label=s.index===0||s.index===3?'반송 / 웨이퍼 ×1.6':'처리 / 웨이퍼 ×1.6',boxW=Math.min(mainWidth-32,Math.max(108,ctx.measureText(label).width+20));
        const lx=Math.max(16,Math.min(mainWidth-boxW-8,px+radius+12)),ly=Math.max(59,py-radius-14);
        line(px+radius*.7,py-radius*.7,lx+8,ly+6,accent);ctx.fillStyle='#14212bed';ctx.fillRect(lx,ly-12,boxW,23);
        text(label,lx+8,ly+3,accent,'10px system-ui');
      }
      // A narrow operation strip reserves its own space below the whole machine.
      // Each phase retains its real duration; seeking and pause update this same state.
      const top=mainTop+mainHeight+3,left=16,right=width-16,cell=(right-left)/4;
      ctx.fillStyle='#101922f2';ctx.fillRect(0,mainTop+mainHeight,width,82);line(left,top,right,top,'#536776');
      for(let i=0;i<4;i++){
        const x=left+i*cell,active=i===s.index,done=i<s.index;
        if(active){ctx.fillStyle=accent+'16';ctx.fillRect(x,top+1,cell,51);}
        text(String(i+1).padStart(2,'0'),x+4,top+17,active?accent:'#647b8e','9px monospace');
        text(labels[i],x+25,top+17,active?'#f2f5f7':done?'#bbcbd5':'#7c919f','600 11px system-ui');
        const y=top+33,a=x+5,b=x+cell-10,f=done?1:active?s.progress:0;
        line(a,y,b,y,'#354854');if(f)line(a,y,a+(b-a)*f,y,accent);
        if(active){const wx=a+(b-a)*f;ctx.fillStyle='#12212a';ctx.beginPath();ctx.arc(wx,y,5,0,Math.PI*2);ctx.fill();circle(wx,y,5,accent);line(wx-2,y-3,wx-2,y+3,accent);line(wx+2,y-3,wx+2,y+3,accent);}
        text(active?Math.round(s.progress*100)+'%':done?'완료':'대기',x+4,top+48,active?accent:'#7c919f','9px monospace');
      }
      text(s.action,left+4,top+68,'#a9bfce',compact?'10px system-ui':'11px system-ui');
      texture.needsUpdate=true;
      const autoClear=renderer.autoClear,shadows=renderer.shadowMap.enabled;
      try{renderer.autoClear=false;renderer.shadowMap.enabled=false;renderer.setViewport(0,0,width,height);renderer.setScissorTest(false);renderer.render(overlay,camera);}
      finally{renderer.autoClear=autoClear;renderer.shadowMap.enabled=shadows;}
    }
    return {attach,update,render,focus,inspectGeometry,backdrop,reset(){indicators=[];screens=[];group=null;summary.hidden=true;inspection.axisInspection.value=0;},dispose(){summary.remove();geometry.dispose();material.dispose();texture.dispose();overlay.clear();}};
  }
  root.CmosOperationView={profiles,sample,create};
})(window);

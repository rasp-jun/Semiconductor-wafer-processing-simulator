/* Original mechanical details, studio reflection map and component explanations. */
(function(root){
  'use strict';
  function environment(T){
    const w=256,h=128,pixels=new Float32Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=x/w,v=y/h,i=(y*w+x)*4;
      const top=Math.max(0,1-v*1.8),base=.055+top*.23;
      const softbox=(cx,cy,sx,sy,power)=>power*Math.exp(-Math.pow((u-cx)/sx,8)-Math.pow((v-cy)/sy,8));
      const warm=softbox(.24,.28,.10,.07,4.8),cool=softbox(.74,.31,.12,.055,3.4),strip=softbox(.51,.43,.014,.24,2.4);
      pixels[i]=base+warm+cool*.72+strip*.83;pixels[i+1]=base*1.07+warm*.94+cool*.9+strip;pixels[i+2]=base*1.16+warm*.8+cool+strip*1.06;pixels[i+3]=1;
    }
    const texture=new T.DataTexture(pixels,w,h,T.RGBAFormat,T.FloatType);texture.mapping=T.EquirectangularReflectionMapping;texture.colorSpace=T.LinearSRGBColorSpace;texture.needsUpdate=true;return texture;
  }
  function roundedGeometry(T){
    const g=new T.BoxGeometry(1,1,1,4,4,4),p=g.attributes.position,n=g.attributes.normal,r=.065,inner=.5-r;
    const v=new T.Vector3(),center=new T.Vector3(),normal=new T.Vector3();
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);center.set(T.MathUtils.clamp(v.x,-inner,inner),T.MathUtils.clamp(v.y,-inner,inner),T.MathUtils.clamp(v.z,-inner,inner));normal.copy(v).sub(center).normalize();v.copy(center).addScaledVector(normal,r);p.setXYZ(i,v.x,v.y,v.z);n.setXYZ(i,normal.x,normal.y,normal.z);}
    return g;
  }
  function enhance({T,stations,materials,box,cylinder,ring,pipe,mesh}){
    const ceramic=new T.MeshPhysicalMaterial({color:0xdce0dc,roughness:.27,metalness:.12,clearcoat:.4});
    const nickel=new T.MeshStandardMaterial({color:0xc3cbd0,metalness:.94,roughness:.19});
    const brass=new T.MeshStandardMaterial({color:0x9f8358,metalness:.86,roughness:.26});
    const gasket=new T.MeshStandardMaterial({color:0x15262d,metalness:.05,roughness:.72});
    const blue=new T.MeshStandardMaterial({color:0x54758d,metalness:.45,roughness:.3});
    const red=new T.MeshStandardMaterial({color:0xb65247,metalness:.22,roughness:.31});
    const boltGeo=new T.CylinderGeometry(.035,.035,.038,6),screwMat=nickel;
    function bolts(parent,r,y,count=12){for(let i=0;i<count;i++){const a=i/count*Math.PI*2;mesh(boltGeo,screwMat,parent,Math.cos(a)*r,y,Math.sin(a)*r);}}
    function tube(parent,points,r=.035,material=nickel){const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return mesh(new T.TubeGeometry(path,32,r,8,false),material,parent);}
    function decal(parent,text,x,y,z,w,h,rotate=false){const c=document.createElement('canvas');c.width=384;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#1b2a31';ctx.fillRect(0,0,384,128);ctx.fillStyle='#aac599';ctx.font='bold 26px sans-serif';ctx.fillText(text,20,48);ctx.fillStyle='#7897a4';ctx.font='17px monospace';ctx.fillText('WAFERFLOW  /  ENGINEERING',20,87);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const m=mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture}),parent,x,y,z);if(rotate)m.rotation.y=Math.PI;m.castShadow=false;return m;}
    const components=[
      [['석영 반응관','고온 반응 분위기를 유지하며 웨이퍼를 둘러싸는 석영관입니다.',[0,2.4,0]],['다중 가열 존','상·중·하부 가열 구역을 개념적으로 표현했습니다.',[.79,2.13,0]],['가스 공급 라인','산소가 반응 구역으로 유입되는 공급 경로입니다.',[-.95,2.77,-.4]]],
      [['PR 디스펜스 노즐','웨이퍼 중심에 감광액을 정량 공급하는 위치입니다.',[0,2.32,0]],['진공 스핀 척','웨이퍼를 지지하고 회전시켜 감광액을 얇게 펼칩니다.',[0,1.78,0]],['스플래시 컵','회전에 의해 퍼진 감광액과 배액을 받는 영역입니다.',[.92,1.86,.2]]],
      [['히팅 플레이트','PR 내부 용매를 줄이기 위한 가열 면입니다.',[0,1.77,0]],['열처리 커버','가공 중 열처리 공간을 덮는 커버입니다.',[0,2.48,0]],['리프트 핀','가공 면과 이송 높이 사이에서 웨이퍼를 받칩니다.',[.41,1.75,.3]]],
      [['UV 광학 헤드','광원을 웨이퍼 방향으로 전달하는 개념 광학계입니다.',[0,2.86,0]],['포토마스크 홀더','차광 패턴과 투명 개구를 가진 마스크를 지지합니다.',[.45,2.21,.25]],['정렬 스테이지','웨이퍼를 지지하고 마스크에 대한 위치를 맞춥니다.',[.67,1.7,.48]]],
      [['PEB 플레이트','선택한 레시피의 노광 후 열처리를 수행합니다.',[0,1.77,0]],['리프트 커버','가열 면 위를 덮는 이동식 커버입니다.',[0,2.48,0]],['온도 센서','열처리 설정과 연관된 센서 위치의 개념 표시입니다.',[-.67,1.71,.45]]],
      [['현상액 공급부','양성 PR에서 노광된 영역을 제거하는 현상액 공급부입니다.',[0,2.32,0]],['웨이퍼 척','현상과 린스 중 웨이퍼를 지지합니다.',[0,1.77,0]],['린스·배액 경로','처리액을 회수하는 컵과 배액 경로입니다.',[.8,1.72,.45]]],
      [['가스 분배 전극','반응 가스와 플라즈마 구역을 형성하는 상부 구조입니다.',[0,2.75,0]],['플라즈마 반응 공간','이온과 반응종이 노출된 산화막에 작용하는 공간입니다.',[.51,2.24,.25]],['진공 배기 라인','챔버에서 가스를 배출하는 배기 경로입니다.',[1.02,1.85,-.3]]],
      [['PR 제거액 노즐','패턴 전사 후 남은 감광막을 제거하는 용액 공급부입니다.',[0,2.32,0]],['처리 웨이퍼','PR이 사라지고 산화막 패턴이 드러나는 영역입니다.',[0,1.78,0]],['분리 배액 컵','처리액을 수집하는 개념 배액 구조입니다.',[-.86,1.78,.3]]]
    ];
    stations.forEach((s,index)=>{
      const g=s.processGroup,front=s.front;s.components=components[index].map(([name,description,position])=>({name,description,position}));
      s.accents=new T.Group();s.group.add(s.accents);
      // Panel seams, ceramic insulators, flush fasteners and utility lines.
      for(const x of [-1.46,1.46])for(const y of [.24,1.3]){const screw=mesh(new T.CylinderGeometry(.025,.025,.013,8),nickel,s.accents,x,y,front*1.275);screw.rotation.x=Math.PI/2;}
      for(const x of [-1.28,1.28])for(const z of [-.98,.98]){cylinder(s.accents,x,.02,z,.14,.12,gasket,20);cylinder(s.accents,x,.095,z,.11,.04,nickel,20);}
      box(s.accents,0,1.415,front*1.258,2.87,.014,.018,materials.lime);
      const stop=cylinder(s.accents,1.23,1.11,front*1.295,.067,.055,red,24);stop.rotation.x=Math.PI/2;
      const yellow=new T.MeshStandardMaterial({color:0xc6a452,metalness:.15,roughness:.5});const stopBase=cylinder(s.accents,1.23,1.11,front*1.272,.1,.018,yellow,24);stopBase.rotation.x=Math.PI/2;
      for(let i=0;i<3;i++)pipe(s.accents,[-1.1+i*.17,1.62,-front*.97],[-1.1+i*.17,2.84,-front*.97],.018,i===1?blue:nickel);
      decal(s.accents,'WF-'+String(index+1).padStart(2,'0'),-.85,.17,front*1.28,.73,.22,front<0);
      if([1,5,7].includes(index)){
        for(const r of [.86,.93,1.03])ring(g,0,1.8,0,r,.017,nickel);
        const bowl=mesh(new T.CylinderGeometry(.99,.72,.22,64,1,true),ceramic,g,0,1.68,0);bowl.receiveShadow=true;
        ring(g,0,1.805,0,.68,.008,gasket);bolts(g,1.1,1.61,12);
        for(let i=0;i<3;i++){const a=i*Math.PI*2/3;cylinder(g,Math.cos(a)*.31,1.76,Math.sin(a)*.31,.035,.04,ceramic,12);}
        tube(g,[[.97,1.65,0],[1.13,1.43,.25],[1.24,1.22,.52],[1.24,.95,.65]],.048,materials.dark);
        tube(g,[[1.07,2.83,-.72],[.92,2.75,-.55],[.92,2.55,-.5]],.024,index===1?brass:blue);
        for(let i=0;i<4;i++)cylinder(s.nozzle,0,1.81+i*.17,0,.096,.045,nickel,24);
        const tip=cylinder(s.nozzle,-.9,2.26,.5,.04,.08,index===1?ceramic:nickel,16);s.dispenseTip=tip;
        if(index===5||index===7){const rinse=new T.Group();g.add(rinse);tube(rinse,[[-1.04,1.63,-.1],[-1.04,2.28,-.1],[-.62,2.36,.12]],.04,nickel);cylinder(rinse,-.62,2.3,.12,.065,.13,ceramic,16);s.rinse=rinse;}
      }else if(index===2||index===4){
        for(let i=0;i<3;i++){const a=i*Math.PI*2/3;cylinder(g,Math.cos(a)*.46,1.77,Math.sin(a)*.46,.017,.12,ceramic,12);}
        for(const r of [.54,.65,.72])ring(g,0,1.785,0,r,.006,nickel);
        bolts(s.lid,.72,.075,10);ring(s.lid,0,-.055,0,.81,.025,gasket);
        box(g,-.9,1.7,.67,.23,.16,.3,blue);tube(g,[[-.89,1.7,.57],[-.89,1.69,.15],[-.66,1.71,-.14]],.02,nickel);
        cylinder(s.lid,0,.27,0,.13,.035,materials.white,24);
      }else if(index===3){
        for(const [y,r] of [[2.74,.33],[2.83,.49],[3.03,.49],[3.19,.48]])ring(g,0,y,0,r,.025,nickel);
        for(let i=0;i<12;i++){const a=i/12*Math.PI*2;box(g,Math.cos(a)*.464,3.02,Math.sin(a)*.464,.032,.31,.032,materials.dark);}
        const reticle=new T.Group();reticle.position.y=2.18;g.add(reticle);s.reticle=reticle;
        for(const x of [-.64,.64])box(reticle,x,0,0,.105,.11,1.38,nickel);for(const z of [-.64,.64])box(reticle,0,0,z,1.18,.11,.105,nickel);
        for(const x of [-.6,.6])for(const z of [-.6,.6])cylinder(reticle,x,.065,z,.035,.025,brass,8);
        for(const x of [-.83,.83]){box(g,x,2.35,.71,.23,.2,.35,materials.dark);const lens=cylinder(g,x,2.32,.91,.062,.08,blue,24);lens.rotation.x=Math.PI/2;}
        for(const z of [-.76,.76]){box(g,0,1.63,z,1.94,.1,.085,nickel);for(let i=0;i<15;i++)box(g,-.8+i*.112,1.69,z,.035,.028,.071,materials.dark);}
        box(g,0,3.29,-.25,1.33,.16,1.03,materials.white);tube(g,[[.57,3.27,-.7],[1.1,3.11,-.8],[1.15,2.12,-.85]],.034,materials.dark);
      }else if(index===6){
        ring(g,0,2.68,0,.91,.055,nickel);ring(g,0,1.81,0,.9,.045,nickel);bolts(g,.88,2.83,16);bolts(g,.89,1.83,12);
        cylinder(g,0,2.87,0,.31,.2,ceramic);cylinder(g,0,3.02,0,.16,.14,brass,24);
        tube(g,[[0,3.13,0],[0,3.26,-.46],[.82,3.28,-.78],[1.13,2.68,-.9]],.053,nickel);
        tube(g,[[.72,1.92,0],[1.12,1.92,0],[1.2,1.75,-.33],[1.2,1.28,-.75]],.12,nickel);
        const flange=cylinder(g,1.02,1.92,0,.19,.1,nickel,32);flange.rotation.z=Math.PI/2;
        box(g,1.15,1.75,-.52,.36,.5,.42,materials.dark);box(g,1.36,1.78,-.48,.14,.19,.27,blue);
        for(let i=0;i<9;i++)ring(g,1.2,1.29+i*.038,-.75,.13,.014,materials.dark);
        cylinder(g,-.87,2.17,-.39,.13,.2,nickel,24);box(g,-.87,2.34,-.39,.26,.16,.24,blue);
      }else{
        for(let i=0;i<12;i++)ring(g,0,1.92+i*.068,0,.96,.018,i%4===0?brass:nickel);
        bolts(g,.91,2.94,12);bolts(g,.8,1.83,10);
        tube(g,[[-.67,2.81,-.24],[-1.09,2.81,-.34],[-1.17,2.42,-.76],[-1.17,1.6,-.85]],.045,nickel);
        box(g,-1.17,2.11,-.81,.22,.42,.18,brass);cylinder(g,-1.17,2.42,-.81,.07,.12,blue,16);
        for(let i=0;i<3;i++)box(g,.97,1.96+i*.26,-.24,.16,.13,.23,ceramic);
      }
    });
    return {environment:environment(T)};
  }
  root.WaferHardware={enhance,roundedGeometry,environment};
})(window);

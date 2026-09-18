/* Synthetic lot-level integration model. No OEM/foundry recipes, no manufacturing release. */
(function(root){
  'use strict';
  const VERSION='wf-memory-fab-0.1.0';
  const field=(label,unit,min,max,value)=>({label,unit,min,max,default:value});
  const tools={
    clean:{name:'습식 세정',en:'WET CLEAN',bay:'prep',view:'clean',prefix:'CLN',role:'세정·린스·건조로 잔사와 표면 오염을 낮춥니다.',watch:'케미컬 온도 · 처리 시간 · 파티클',fields:{temperature:field('용액 온도','°C',20,90,60),time:field('세정 시간','s',20,200,90)}},
    furnace:{name:'산화·열처리',en:'THERMAL',bay:'prep',view:'oxidation',prefix:'THM',role:'절연막 성장 또는 도펀트 활성화 등 열 공정을 담당합니다. 실제로는 목적에 따라 장비와 조건이 다릅니다.',watch:'온도 균일도 · 유지 시간 · 열 이력',fields:{temperature:field('처리 온도','°C',600,1100,900),time:field('유지 시간','s',10,180,60)}},
    implant:{name:'이온주입',en:'IMPLANT',bay:'prep',view:'implant',prefix:'IMP',role:'이온을 주입해 소자의 도핑 영역을 만듭니다.',watch:'도즈 · 에너지 · 빔 안정성',fields:{dose:field('도즈','cm⁻²',1e12,1e15,1e13),energy:field('주입 에너지','keV',5,200,80)}},
    coat:{name:'코터 트랙',en:'COATER',bay:'pattern',view:'coat',prefix:'COT',role:'감광막을 코팅하고 다음 노광 단계의 입력 상태를 만듭니다.',watch:'PR 두께 · 회전 속도 · 균일도',fields:{rpm:field('회전 속도','rpm',1500,4500,3000),time:field('회전 시간','s',10,90,30)}},
    scanner:{name:'투영 노광',en:'LITHOGRAPHY',bay:'pattern',view:'scanner',prefix:'LIT',role:'마스크 패턴을 감광막에 전사합니다. 이 모형은 EUV·DUV의 광학 해석이나 특정 스캐너를 재현하지 않습니다.',watch:'Dose · Focus · Overlay',fields:{dose:field('노광량','mJ/cm²',15,60,30),focus:field('초점 오프셋','nm',-100,100,0)}},
    develop:{name:'현상 트랙',en:'DEVELOPER',bay:'pattern',view:'developer',prefix:'DEV',role:'노광된 감광막을 현상해 식각 마스크 개구를 형성합니다.',watch:'현상 시간 · 잔사 · CD',fields:{time:field('현상 시간','s',30,100,60),temperature:field('현상 온도','°C',18,28,23)}},
    etch:{name:'플라즈마 식각',en:'PLASMA ETCH',bay:'etch',view:'etch',prefix:'RIE',role:'패턴을 재료층으로 전달합니다. 앞선 노광 CD와 막 상태가 식각 결과에 영향을 줍니다.',watch:'RF · 압력 · Endpoint · CD',fields:{power:field('RF 파워','W',300,900,600),pressure:field('압력','mTorr',10,40,20),time:field('식각 시간','s',40,90,60)}},
    har:{name:'고종횡비 식각',en:'HAR ETCH',bay:'etch',view:'etch',prefix:'HAR',role:'DRAM 커패시터·NAND 채널홀·TSV의 깊은 구조를 다룹니다. 실제 재료별 장비·케미스트리는 서로 다릅니다.',watch:'깊이 · 균일도 · Profile · 잔사',fields:{power:field('RF 파워','W',600,1400,1000),pressure:field('압력','mTorr',8,35,15),time:field('처리 시간','s',90,180,120)}},
    cvd:{name:'CVD 증착',en:'CVD',bay:'film',view:'pecvd',prefix:'CVD',role:'절연막·몰드·적층막을 증착합니다. NAND 적층은 반복 모듈을 축약해 표현합니다.',watch:'막 두께 · 온도 · 유량 · 응력',fields:{temperature:field('온도','°C',300,500,400),flow:field('기준 가스 유량','sccm',70,130,100)}},
    ald:{name:'ALD 증착',en:'ALD',bay:'film',view:'ald',prefix:'ALD',role:'순차 표면 반응으로 고종횡비 구조의 유전체·장벽막을 만듭니다.',watch:'Cycle · 온도 · 피복성',fields:{cycles:field('반응 사이클','cycles',60,150,100),temperature:field('온도','°C',200,350,250)}},
    pvd:{name:'PVD 금속막',en:'PVD',bay:'metal',view:'pvd',prefix:'PVD',role:'금속 전극·시드층을 증착하여 후속 배선 및 충진에 연결합니다.',watch:'타깃 파워 · 막 두께 · 시드 연속성',fields:{power:field('타깃 파워','W',1000,2200,1500),time:field('증착 시간','s',30,100,60)}},
    plate:{name:'전해 도금',en:'ELECTROPLATING',bay:'metal',view:null,prefix:'ECP',role:'배선 또는 TSV의 금속 충진을 담당합니다. 이전 식각·라이너·시드 상태를 함께 검토해야 합니다.',watch:'전류 밀도 · 충진 · Void',fields:{current:field('전류 밀도','mA/cm²',5,20,10),time:field('도금 시간','s',90,180,120)}},
    cmp:{name:'CMP 평탄화',en:'CMP',bay:'planar',view:'cmp',prefix:'CMP',role:'과잉 재료를 제거해 다음 노광·접합에 필요한 평탄도를 만듭니다.',watch:'잔여 단차 · Dishing · 연마 균일도',fields:{pressure:field('헤드 압력','psi',1.5,4.5,3),rpm:field('플래튼 회전','rpm',40,90,60),time:field('연마 시간','s',40,100,60)}},
    metro:{name:'막·CD 계측',en:'METROLOGY',bay:'measure',view:'metrology',prefix:'MET',role:'상류 공정의 치수·막 상태를 확인하고 후속 진행 여부를 검토합니다. 화면 임계값은 합성 예제 규칙입니다.',watch:'CD · 막 두께 · 식각 깊이 · 단차',fields:{sites:field('표본 지점','sites',9,49,25)}},
    inspect:{name:'결함 검사',en:'INSPECTION',bay:'measure',view:'metrology',prefix:'INS',role:'공정 이력과 공간 패턴을 함께 관찰합니다. 이 시연은 결함 분류 AI나 실측 검사 이미지를 포함하지 않습니다.',watch:'공간 분포 · 공정 전후 변화',fields:{sites:field('표본 지점','sites',9,49,25)}},
    probe:{name:'웨이퍼 테스트',en:'WAFER TEST',bay:'measure',view:'probe',prefix:'WAT',role:'웨이퍼 단계에서 전기적 시험을 수행하는 역할입니다. 현재는 구조 지표 점검을 대신 표시하며 전기 수율을 계산하지 않습니다.',watch:'검사 이력 · 구조 지표 · Lot 판정',fields:{sites:field('예제 확인 지점','sites',9,49,25)}},
    grind:{name:'박막화·TSV 노출',en:'THINNING',bay:'package',view:null,prefix:'GRD',role:'후면 연삭·박막화와 TSV 노출 모듈을 축약해 표시합니다. 앞선 구조와 응력이 후속 적층 검토로 이어집니다.',watch:'두께 · TTV · 휨 · 노출 상태',fields:{thickness:field('목표 두께','µm',40,80,60),feed:field('이송 속도','µm/s',1,5,3)}},
    dice:{name:'다이 분리',en:'DICING',bay:'package',view:null,prefix:'DIC',role:'웨이퍼를 다이로 분리합니다. 실제 개별 다이 분기·수량 변환은 이 LOT 추적 모형에서 생략합니다.',watch:'절단 속도 · 치핑 · 다이 추적',fields:{speed:field('절단 이송','mm/s',10,40,25)}},
    bond:{name:'다이 적층·정렬',en:'DIE STACKING',bay:'package',view:null,prefix:'BND',role:'다이를 정렬하고 적층합니다. 정렬·휨·범프 상태를 다음 접합·봉지 모듈과 연결합니다.',watch:'정렬 오차 · 휨 · 접합 조건',fields:{offset:field('정렬 오프셋','µm',-3,3,0),force:field('접합 힘','N',20,80,50)}},
    mold:{name:'리플로·봉지',en:'REFLOW / MOLD',bay:'package',view:null,prefix:'MUF',role:'접합과 보호재 충진·경화를 기능 모듈로 표현합니다. SK하이닉스 MR-MUF의 장비·레시피·재료 모델을 복제하지 않습니다.',watch:'열 이력 · 휨 · 보호재 상태',fields:{temperature:field('예제 피크 온도','°C',220,280,250),time:field('유지 시간','s',30,90,60)}},
    final:{name:'최종 검사',en:'FINAL TEST',bay:'package',view:'probe',prefix:'FIN',role:'후공정 결과와 이전 이력을 연결합니다. 실제 전기 특성·신뢰성 시험과 출하 판정을 대신하지 않습니다.',watch:'계측 이력 · 패키지 구조 · 재검토',fields:{sites:field('검토 표본','sites',9,49,25)}}
  };
  const bays=[{id:'prep',name:'세정 · 열처리',sub:'SURFACE / THERMAL'},{id:'pattern',name:'패터닝',sub:'LITHOGRAPHY'},{id:'etch',name:'식각',sub:'PATTERN TRANSFER'},{id:'film',name:'박막',sub:'FILM FORMATION'},{id:'metal',name:'금속 · 충진',sub:'METALLIZATION'},{id:'planar',name:'평탄화',sub:'PLANARIZATION'},{id:'measure',name:'계측 · 검사',sub:'METROLOGY / TEST'},{id:'package',name:'박막화 · 적층',sub:'ADVANCED PACKAGING'}];
  const modules={prep:'표면 준비',feol:'소자 형성',cap:'DRAM 커패시터',stack:'NAND 적층·채널',tsv:'TSV 연결',beol:'배선 형성',test:'웨이퍼 검사',package:'박막화·적층',final:'패키지 검토'};
  const step=(id,name,tool,module,minutes,extra={})=>({id,name,tool,module,minutes,...extra});
  function pattern(prefix,name,module){return[step(prefix+'C',name+' PR 코팅','coat',module,2),step(prefix+'L',name+' 노광','scanner',module,3),step(prefix+'D',name+' 현상','develop',module,2)];}
  const front=[step('P01','입고 세정','clean','prep',3),step('P02','절연막·웰 준비','furnace','prep',5),step('F01','도핑 영역 형성','implant','feol',4),step('F02','활성화 열처리','furnace','feol',4),step('F03','소자 박막 형성','cvd','feol',4,{film:80}),...pattern('FG','소자 패턴','feol'),step('F04','소자 패턴 식각','etch','feol',4,{depth:120}),step('F05','식각 후 세정','clean','feol',3),step('F06','소자 CD 검토','metro','feol',2,{gate:true})];
  const cap=[step('C01','커패시터 몰드 형성','cvd','cap',6,{film:4200}),...pattern('CC','커패시터 홀','cap'),step('C02','커패시터 홀 식각','har','cap',7,{depth:4200}),step('C03','커패시터 세정','clean','cap',3),step('C04','커패시터 깊이 계측','metro','cap',3,{gate:true}),step('C05','유전체 ALD','ald','cap',5,{film:8}),step('C06','전극 금속막','pvd','cap',3,{film:50}),step('C07','셀 상부 평탄화','cmp','cap',4),step('C08','셀 모듈 검사','inspect','cap',2,{gate:true})];
  const stack=[step('N01','NAND 적층막 반복 모듈','cvd','stack',12,{film:6500}),...pattern('NC','채널 홀','stack'),step('N02','채널 홀 고종횡비 식각','har','stack',9,{depth:6500}),step('N03','채널 세정','clean','stack',3),step('N04','채널 프로파일 검토','metro','stack',3,{gate:true}),step('N05','메모리막 ALD 모듈','ald','stack',6,{film:12}),step('N06','채널막 형성','cvd','stack',5,{film:60}),step('N07','슬릿·게이트 치환 모듈','etch','stack',5,{depth:300}),step('N08','치환 후 세정','clean','stack',3),step('N09','게이트 금속막','pvd','stack',4,{film:40}),step('N10','적층 모듈 평탄화','cmp','stack',4),step('N11','NAND 구조 검사','inspect','stack',3,{gate:true})];
  const tsv=[...pattern('TV','TSV 개구','tsv'),step('T01','TSV 깊은 홀 식각','har','tsv',8,{depth:30000}),step('T02','TSV 라이너·장벽막','ald','tsv',5,{film:80}),step('T03','TSV 시드층','pvd','tsv',3,{film:100}),step('T04','TSV 구리 충진','plate','tsv',6),step('T05','TSV CMP','cmp','tsv',5),step('T06','TSV 연결 모듈 검토','metro','tsv',3,{gate:true})];
  const beol=[step('B01','배선 절연막','cvd','beol',4,{film:400}),...pattern('BL','배선 개구','beol'),step('B02','배선 패턴 식각','etch','beol',4,{depth:400}),step('B03','금속 시드층','pvd','beol',3,{film:80}),step('B04','배선 충진 모듈','plate','beol',5),step('B05','배선 CMP','cmp','beol',4),step('B06','배선 인라인 검사','inspect','beol',3,{gate:true}),step('W01','웨이퍼 구조·시험 검토','probe','test',4,{gate:true})];
  const pack=[step('K01','후면 박막화·TSV 노출','grind','package',6),step('K02','박막화 후 휨 검토','metro','package',3,{gate:true}),step('K03','다이 분리 모듈','dice','package',4),step('K04','다이 정렬·적층 모듈','bond','package',8),step('K05','리플로·보호재 봉지 모듈','mold','package',6),step('K06','패키지 연결·구조 검토','final','final',4,{gate:true})];
  const products={dram:{name:'DRAM',description:'소자 → 커패시터 → 배선 → 웨이퍼 검사',route:[...front,...cap,...beol]},nand:{name:'3D NAND',description:'소자 → 적층막·채널 → 배선 → 웨이퍼 검사',route:[...front,...stack,...beol]},hbm:{name:'HBM 연계',description:'DRAM → TSV 모듈 → 배선 → 박막화·적층',route:[...front,...cap,...tsv,...beol,...pack]}};
  const scenarios={normal:{name:'기준 운전',description:'장비 편차가 없는 동일 입력 기준 사례',tool:null},etch:{name:'HAR 챔버 깊이 편차',description:'HAR-01의 식각 응답을 18% 높이는 합성 이상',tool:'HAR-01'},cmp:{name:'CMP 제거율 저하',description:'CMP-01의 제거 응답을 45% 낮추는 합성 이상',tool:'CMP-01'},bond:{name:'적층 정렬 편차',description:'BND-01에 정렬 오차 2.4 µm를 추가하는 합성 이상',tool:'BND-01'},down:{name:'노광 장비 가용성 저하',description:'LIT-01을 전 구간에서 사용할 수 없는 경우',tool:'LIT-01'}};
  const defaultLots=[['D-101','dram'],['H-201','hbm'],['N-301','nand'],['H-202','hbm'],['D-102','dram'],['N-302','nand'],['H-203','hbm'],['H-204','hbm']].map(([id,product],i)=>({id,product,release:i*2,wafers:25}));
  // HAR materials/structures and NAND multilayers need distinct qualified resources.
  // This is an illustrative eligibility matrix, never an actual factory tool inventory.
  const chambers=Object.entries(tools).flatMap(([type,t])=>Array.from({length:type==='har'?6:type==='cvd'?4:2},(_,i)=>{const n=i+1,qualified=type==='har'?(n<=2?['cap']:n<=4?['stack']:['tsv']):type==='cvd'?(n<=2?['feol','cap','beol']:['stack']):null;return{id:t.prefix+'-0'+n,type,bay:t.bay,qualified,qualification:qualified?qualified.map(id=>modules[id]).join(' · '):'예제 경로 내 공용'};}));
  const clone=x=>JSON.parse(JSON.stringify(x)),noise=s=>{let h=2166136261;for(const c of s){h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}return (h%10001)/10000-.5;};
  function validate(options={}){
    if(!options||typeof options!=='object'||Array.isArray(options))throw Error('설정 객체가 필요합니다.');
    const scenario=options.scenario??'etch';if(!Object.hasOwn(scenarios,scenario))throw Error('지원하지 않는 시나리오입니다.');
    const excluded=options.excluded??[];if(!Array.isArray(excluded)||excluded.some(id=>!chambers.some(c=>c.id===id)))throw Error('제외할 챔버를 확인하세요.');
    const overrides=options.overrides??{};if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw Error('레시피 변경 형식이 잘못되었습니다.');
    const normalized={};for(const[type,values]of Object.entries(overrides)){if(!Object.hasOwn(tools,type)||!values||typeof values!=='object'||Array.isArray(values))throw Error('지원하지 않는 장비 조건입니다.');normalized[type]={};for(const[key,value]of Object.entries(values)){const f=Object.hasOwn(tools[type].fields,key)?tools[type].fields[key]:null;if(!f||typeof value!=='number'||!Number.isFinite(value)||value<f.min||value>f.max||(['sites','cycles'].includes(key)&&!Number.isInteger(value)))throw Error((f?.label||key)+' 입력 범위를 확인하세요.');normalized[type][key]=value;}}
    const lots=options.lots??defaultLots;if(!Array.isArray(lots)||!lots.length||lots.length>40)throw Error('LOT은 1–40개여야 합니다.');
    const ids=new Set();const normalizedLots=lots.map(l=>{if(!l||typeof l.id!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(l.id)||ids.has(l.id)||!Object.hasOwn(products,l.product)||!Number.isFinite(l.release)||l.release<0||l.release>200||!Number.isInteger(l.wafers)||l.wafers<1||l.wafers>25)throw Error('LOT ID·제품·투입 시간을 확인하세요.');ids.add(l.id);return{id:l.id,product:l.product,release:l.release,wafers:l.wafers};});
    if(options.holdAtGate!==undefined&&typeof options.holdAtGate!=='boolean')throw Error('계측 보류 설정을 확인하세요.');
    return {scenario,excluded:[...new Set(excluded)],overrides:normalized,lots:normalizedLots,holdAtGate:options.holdAtGate??true};
  }
  function recipe(type,overrides={}){return {...Object.fromEntries(Object.entries(tools[type].fields).map(([k,f])=>[k,f.default])),...(overrides[type]||{})};}
  // Shared deterministic response terms; no synthetic LOT noise or injected faults.
  // Validation of these terms does not validate scheduling or the full process model.
  const RESPONSE_VERSION='wf-response-0.1.0';
  function referenceResponse(kind,p){
    if(kind==='har')return p.target_nm*(p.power_w/1000)**.25*(p.time_s/120)*(15/p.pressure_mtorr)**.08;
    if(kind==='cvd')return p.target_nm*p.flow_sccm/100*Math.sqrt(p.temperature_c/400);
    if(kind==='cmp')return Math.max(1,p.before_nm*(1-p.pressure_psi/3*p.rpm/60*p.time_s/60)+2);
    throw Error('지원하지 않는 응답 모델입니다.');
  }
  function initial(){return{cd_nm:52,etch_depth_nm:0,film_nm:0,film_error_pct:0,etch_error_pct:0,topography_nm:2,overlay_nm:1,warp_um:2,alignment_um:.2,fill_pct:100,particles:2,issues:[]};}
  function process(input,op,p,chamber,scenario,lotId){
    const out=clone(input),n=noise(lotId+':'+op.id)*.006,causes=[];let anomaly=null;
    const issue=(metric,value,limit,reason)=>{const item={metric,value,limit,reason,originStep:op.id,originName:op.name,chamber};out.issues.push(item);causes.push(item);};
    if(op.tool==='clean')out.particles=Math.max(.1,out.particles*.3*90/p.time*Math.sqrt(60/p.temperature));
    if(op.tool==='furnace'){out.warp_um+=Math.abs(p.temperature-900)/180*p.time/60;out.thermal_index=(out.thermal_index||0)+p.time/60*(p.temperature/900)**2;}
    if(op.tool==='implant'){out.particles+=.2;out.implant_dose_cm2=p.dose;out.implant_range_nm=p.energy*.9;}
    if(op.tool==='coat'){out.pr_nm=600*Math.sqrt(3000/p.rpm)*(30/p.time)**.08;out.film_nm=out.pr_nm;}
    if(op.tool==='scanner'){out.cd_nm=52+(p.dose-30)*.25+Math.abs(p.focus)*.055+((out.pr_nm??600)-600)*.008+n*30;out.overlay_nm=1+Math.abs(p.focus)*.05;if(out.overlay_nm>4)issue('overlay_nm',out.overlay_nm,4,'초점 오프셋과 연계한 예제 정렬 편차');}
    if(op.tool==='develop')out.cd_nm+=(p.time-60)*.06+(p.temperature-23)*.08;
    if(['etch','har'].includes(op.tool)){
      const d=tools[op.tool].fields,ratio=(p.power/d.power.default)**.25*(p.time/d.time.default)*(d.pressure.default/p.pressure)**.08;
      const fault=op.tool==='har'&&chamber==='HAR-01'&&scenario==='etch'?1.18:1;
      const reference=op.tool==='har'?referenceResponse('har',{target_nm:op.depth||200,power_w:p.power,time_s:p.time,pressure_mtorr:p.pressure}):(op.depth||200)*ratio;
      out.etch_depth_nm=reference*fault*(1+n);out.etch_error_pct=(out.etch_depth_nm/(op.depth||200)-1)*100;
      out.topography_nm+=2;out.particles+=1;if(fault!==1)anomaly='식각 응답 +18% 주입';
      if(Math.abs(out.etch_error_pct)>8)issue('etch_error_pct',out.etch_error_pct,8,'상류 패턴 입력 이후 식각 깊이의 예제 목표 편차');
      if(Math.abs(out.cd_nm-52)>4)issue('cd_error_nm',out.cd_nm-52,4,'앞선 노광·현상 CD 편차가 식각 패턴으로 전달');
    }
    if(['cvd','ald','pvd'].includes(op.tool)){
      const factor=op.tool==='cvd'?p.flow/100*Math.sqrt(p.temperature/400):op.tool==='ald'?p.cycles/100*(p.temperature/250)**.15: p.power/1500*p.time/60;
      out.film_nm=(op.tool==='cvd'?referenceResponse('cvd',{target_nm:op.film||100,flow_sccm:p.flow,temperature_c:p.temperature}):(op.film||100)*factor)*(1+n);out.film_error_pct=(factor*(1+n)-1)*100;
      out.topography_nm+=3;out.warp_um+=Math.abs(factor-1)*5;
      if(Math.abs(out.film_error_pct)>10)issue('film_error_pct',out.film_error_pct,10,'막 두께 편차가 후속 식각·평탄화 입력으로 전달');
    }
    if(op.tool==='plate'){out.fill_pct=Math.min(100,100*p.current/10*p.time/120)-Math.abs(out.etch_error_pct)*.25;if(out.fill_pct<94)issue('fill_pct',out.fill_pct,94,'상류 홀 깊이와 도금 조건에 따른 합성 충진 지표');}
    if(op.tool==='cmp'){
      const response=p.pressure/3*p.rpm/60*p.time/60*(scenario==='cmp'&&chamber==='CMP-01'?0.55:1);
      out.topography_nm=scenario==='cmp'&&chamber==='CMP-01'?Math.max(1,out.topography_nm*(1-response)+2):referenceResponse('cmp',{before_nm:out.topography_nm,pressure_psi:p.pressure,rpm:p.rpm,time_s:p.time});if(response<.7&&scenario==='cmp')anomaly='CMP 제거 응답 저하';
      if(out.topography_nm>5)issue('topography_nm',out.topography_nm,5,'잔여 단차가 후속 노광·접합 입력에 남음');
    }
    if(op.tool==='grind'){out.warp_um+=60/p.thickness+p.feed*.2;if(out.warp_um>8)issue('warp_um',out.warp_um,8,'박막화 전 응력과 목표 두께에 따른 합성 휨');}
    if(op.tool==='dice')out.particles+=p.speed/25;
    if(op.tool==='bond'){out.alignment_um=Math.abs(p.offset)+.2+out.warp_um*.06+Math.abs(p.force-50)*.01+(scenario==='bond'&&chamber==='BND-01'?2.4:0);if(scenario==='bond'&&chamber==='BND-01')anomaly='정렬 오차 +2.4 µm 주입';if(out.alignment_um>1.5)issue('alignment_um',out.alignment_um,1.5,'상류 박막화 상태와 적층 정렬 편차');}
    if(op.tool==='mold')out.warp_um+=Math.abs(p.temperature-250)/20;
    if(p.sites)out.measurement_sites=p.sites;
    const gateFailed=!!op.gate&&out.issues.length>0;
    return {state:out,causes,anomaly,gateFailed};
  }
  function run(raw={}){
    const options=validate(raw),fleet=chambers.map(c=>({...c,available:0,busy:0,queueMinutes:0,records:[],excluded:options.excluded.includes(c.id)||(options.scenario==='down'&&c.id==='LIT-01')}));
    const lots=options.lots.map(l=>({...l,cursor:0,ready:l.release,state:initial(),records:[],status:'pending'}));
    const records=[],events=[];let sequence=0;
    while(lots.some(l=>l.status==='pending')){
      const lot=lots.filter(l=>l.status==='pending').sort((a,b)=>a.ready-b.ready||a.id.localeCompare(b.id))[0];
      const route=products[lot.product].route,op=route[lot.cursor],machines=fleet.filter(c=>c.type===op.tool&&!c.excluded&&(!c.qualified||c.qualified.includes(op.module))).sort((a,b)=>Math.max(a.available,lot.ready)-Math.max(b.available,lot.ready)||a.id.localeCompare(b.id));
      if(!machines.length){lot.status='blocked';lot.finishedAt=lot.ready;events.push({t:lot.ready,kind:'blocked',lotId:lot.id,stepId:op.id,message:tools[op.tool].name+' 사용 가능한 챔버 없음'});continue;}
      const machine=machines[0],p=recipe(op.tool,options.overrides),start=Math.max(lot.ready,machine.available),wait=start-lot.ready;
      const defaults=tools[op.tool].fields,scale=p.time&&defaults.time?p.time/defaults.time.default:op.tool==='ald'?p.cycles/100:1;
      const duration=op.minutes*scale,end=start+duration;
      const result=process(lot.state,op,p,machine.id,options.scenario,lot.id);
      const record={id:'EV'+String(++sequence).padStart(4,'0'),lotId:lot.id,product:lot.product,operation:lot.cursor,stepId:op.id,name:op.name,module:op.module,tool:op.tool,chamber:machine.id,ready:lot.ready,start,end,duration,wait,recipe:p,before:clone(lot.state),after:clone(result.state),causes:result.causes,anomaly:result.anomaly,gate:!!op.gate,gateFailed:result.gateFailed};
      machine.available=end;machine.busy+=duration;machine.queueMinutes+=wait;machine.records.push(record.id);records.push(record);lot.records.push(record.id);lot.state=result.state;lot.cursor++;lot.ready=end+1;
      if(result.anomaly)events.push({t:end,kind:'anomaly',lotId:lot.id,chamber:machine.id,recordId:record.id,message:result.anomaly});
      if(result.gateFailed&&options.holdAtGate){lot.status='held';events.push({t:end,kind:'hold',lotId:lot.id,chamber:machine.id,recordId:record.id,message:op.name+'에서 상류 편차 확인 · 후속 모듈 보류'});}
      else if(lot.cursor===route.length)lot.status='completed';
      if(lot.status!=='pending')lot.finishedAt=end;
    }
    const duration=Math.max(0,...records.map(r=>r.end),...lots.map(l=>l.finishedAt??l.release)),completed=lots.filter(l=>l.status==='completed'),held=lots.filter(l=>l.status==='held'),blocked=lots.filter(l=>l.status==='blocked');
    const bottleneck=[...fleet].sort((a,b)=>b.queueMinutes-a.queueMinutes||b.busy-a.busy)[0];
    const summary={lots:lots.length,wafers:lots.reduce((s,l)=>s+l.wafers,0),completed:completed.length,held:held.length,blocked:blocked.length,flagged:lots.filter(l=>l.state.issues.length).length,duration,totalWait:records.reduce((s,r)=>s+r.wait,0),meanWait:records.length?records.reduce((s,r)=>s+r.wait,0)/lots.length:0,bottleneck:bottleneck?.id||null};
    return {schema:'waferflow-memory-fab-run-v1',version:VERSION,provenance:'synthetic-reference-model',options,fleet,lots,records,events:events.sort((a,b)=>a.t-b.t),duration,summary};
  }
  function snapshot(result,time){
    if(!Number.isFinite(time))throw Error('재생 시각이 올바르지 않습니다.');const t=Math.max(0,Math.min(result.duration,time));
    const lots=result.lots.map(l=>{const rows=result.records.filter(r=>r.lotId===l.id),last=rows.filter(r=>r.end<=t).at(-1),active=rows.find(r=>r.start<=t&&r.end>t),next=rows.find(r=>r.end>t);let status=t<l.release?'planned':active?'processing':next||t<l.finishedAt?'waiting':l.status;
      return {...l,status,active:active?.id||null,next:next?.id||null,current:active||next||last||null,state:clone(last?.after||initial()),completedOps:rows.filter(r=>r.end<=t).length};});
    const fleet=result.fleet.map(c=>{const active=result.records.find(r=>r.chamber===c.id&&r.start<=t&&r.end>t),queue=result.records.filter(r=>r.chamber===c.id&&r.ready<=t&&r.start>t),busy=result.records.filter(r=>r.chamber===c.id&&r.start<t).reduce((s,r)=>s+Math.max(0,Math.min(t,r.end)-r.start),0);return{...c,active:active||null,queue:queue.map(r=>r.lotId),utilization:t?busy/t:0,status:c.excluded?'excluded':active?'running':'idle'};});
    return {time:t,lots,fleet,events:result.events.filter(e=>e.t<=t),summary:{planned:lots.filter(l=>l.status==='planned').length,processing:lots.filter(l=>l.status==='processing').length,waiting:lots.filter(l=>l.status==='waiting').length,completed:lots.filter(l=>l.status==='completed').length,held:lots.filter(l=>l.status==='held').length,blocked:lots.filter(l=>l.status==='blocked').length}};
  }
  function impact(result,chamber,time=result.duration){
    const exposed=result.records.filter(r=>r.chamber===chamber&&r.end<=time);
    return [...new Set(exposed.map(r=>r.lotId))].map(id=>{const lot=result.lots.find(l=>l.id===id),records=exposed.filter(r=>r.lotId===id),first=records[0],done=result.records.filter(r=>r.lotId===id&&r.end<=time),last=done.at(-1),causes=done.flatMap(r=>r.causes).filter(c=>c.chamber===chamber);return{lotId:id,product:lot.product,records,causes,downstream:done.filter(r=>r.operation>first.operation).map(r=>({stepId:r.stepId,name:r.name,chamber:r.chamber,gateFailed:r.gateFailed})),held:lot.status==='held'&&last?.gateFailed===true,plannedRemaining:products[lot.product].route.length-done.length};});
  }
  function exportPlan(result){return {schema:'waferflow-memory-fab-plan-v1',version:VERSION,provenance:'synthetic-reference-model',notice:'자체 생성 LOT·장비·레시피·규칙. SK하이닉스의 장비 목록·공정 순서·운전 로그가 아님.',options:clone(result.options)};}
  function importPlan(data){if(!data||data.schema!=='waferflow-memory-fab-plan-v1'||data.version!==VERSION||!data.options||typeof data.options!=='object')throw Error('지원하는 팹 계획 파일과 모델 버전을 확인하세요.');return run(data.options);}
  function freeze(o){Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(o);}
  root.MemoryFab=Object.freeze({VERSION,RESPONSE_VERSION,referenceResponse,tools:freeze(tools),bays:freeze(bays),products:freeze(products),modules:freeze(modules),scenarios:freeze(scenarios),chambers:freeze(chambers),defaultLots:freeze(defaultLots),run,snapshot,impact,recipe,validate,exportPlan,importPlan});
})(typeof window==='undefined'?globalThis:window);

/* Independent planar-CMOS process demonstrator. Geometric / analytical surrogate, not TCAD. */
(function(root){
  'use strict';
  const VERSION='wf-fab-0.5.0',NX=160,WIDTH=4800,BASE=600;
  const materials={Si:{name:'실리콘',color:'#687b92'},SiO2:{name:'산화막',color:'#62b8ab'},SiN:{name:'질화막',color:'#b9a566'},Poly:{name:'폴리실리콘',color:'#b886b1'},PR:{name:'감광막',color:'#db946f'},Ni:{name:'니켈',color:'#9daebd'},NiSi:{name:'실리사이드',color:'#acbb88'},TiN:{name:'장벽막',color:'#91a4b1'},W:{name:'텅스텐',color:'#cbd4df'},Al:{name:'알루미늄',color:'#c4d7ee'}};
  const field=(label,unit,min,max,step=1)=>({label,unit,min,max,step});
  const tools={
    clean:{name:'습식 세정 벤치',english:'WET CLEAN BENCH',family:'wet',fields:{time:field('처리 시간','s',10,600),temperature:field('용액 온도','°C',20,90)},defaults:{time:90,temperature:60},principle:'액체의 화학 반응과 린스로 표면 오염을 제거합니다.'},
    oxidation:{name:'열산화로',english:'OXIDATION FURNACE',family:'furnace',fields:{time:field('산화 시간','min',.2,90,.1),temperature:field('공정 온도','°C',800,1100)},defaults:{time:4.2,temperature:1000},principle:'실리콘을 소비하면서 SiO₂를 성장시킵니다. 기존 산화막 두께를 이어서 계산합니다.'},
    lpcvd:{name:'LPCVD 반응로',english:'LOW PRESSURE CVD',family:'furnace',fields:{time:field('증착 시간','s',10,3000),temperature:field('공정 온도','°C',400,850),flow:field('상대 가스 유량','%',50,150)},defaults:{time:1000,temperature:620,flow:100},principle:'저압 반응 분위기에서 표면 반응으로 박막을 형성합니다.'},
    pecvd:{name:'PECVD 클러스터',english:'PLASMA ENHANCED CVD',family:'cluster',fields:{time:field('증착 시간','s',10,900),temperature:field('척 온도','°C',200,500),flow:field('상대 가스 유량','%',50,150)},defaults:{time:300,temperature:350,flow:100},principle:'가스 분배판과 플라즈마를 이용하여 절연막을 증착합니다.'},
    coat:{name:'코팅 트랙',english:'RESIST COATER',family:'spin',fields:{rpm:field('스핀 속도','rpm',1500,5000,100),time:field('회전 시간','s',10,90)},defaults:{rpm:3000,time:30},principle:'진공 척 위의 웨이퍼에 감광액을 공급하고 회전시켜 막을 만듭니다.'},
    bake:{name:'트랙 핫플레이트',english:'SOFT BAKE',family:'hotplate',fields:{temperature:field('베이크 온도','°C',80,130),time:field('베이크 시간','s',20,150)},defaults:{temperature:100,time:60},principle:'감광막의 용매를 줄입니다. 이 예제는 비화학증폭 양성 PR을 가정하여 별도 PEB를 생략합니다.'},
    scanner:{name:'DUV 스테퍼',english:'MASK / PROJECTION EXPOSURE',family:'scanner',fields:{dose:field('노광량','mJ/cm²',60,180),focus:field('초점 오프셋','µm',-1,1,.05)},defaults:{dose:120,focus:0},principle:'마스크의 광학상을 PR에 전사합니다. 현재 마스크와 초점·노광량으로 잠상 분포를 계산합니다.'},
    developer:{name:'현상 트랙',english:'POSITIVE RESIST DEVELOPER',family:'spin',fields:{time:field('현상 시간','s',20,120)},defaults:{time:65},principle:'양성 PR의 노광된 영역을 제거하여 다음 식각·주입 단계의 개구를 만듭니다.'},
    etch:{name:'ICP-RIE 식각기',english:'INDUCTIVELY COUPLED PLASMA',family:'etch',fields:{time:field('식각 시간','s',5,900),power:field('바이어스 파워','W',50,500),pressure:field('챔버 압력','mTorr',5,80)},defaults:{time:60,power:200,pressure:20},principle:'반응종과 방향성 이온으로 노출된 물질을 제거합니다. PR 소모와 재료별 선택비를 함께 반영합니다.'},
    strip:{name:'플라즈마 애셔',english:'OXYGEN PLASMA ASHER',family:'etch',fields:{time:field('애싱 시간','s',20,240),power:field('소스 파워','W',100,600)},defaults:{time:120,power:300},principle:'산소 플라즈마로 유기 감광막을 제거합니다. 남은 PR은 다음 공정의 차단막으로 작용합니다.'},
    wetetch:{name:'선택 습식 식각기',english:'SELECTIVE WET ETCH',family:'wet',fields:{time:field('처리 시간','s',5,600),temperature:field('용액 온도','°C',20,180)},defaults:{time:100,temperature:80},principle:'표적 재료에 대한 선택적 용해를 표현합니다. 용액 종류별 반응 속도는 예제 계수입니다.'},
    implant:{name:'이온주입기',english:'BEAMLINE ION IMPLANTER',family:'implant',fields:{dose:field('주입 도즈','cm⁻²',1e12,5e15,1e12),energy:field('주입 에너지','keV',5,250),tilt:field('틸트 각도','°',0,15)},defaults:{dose:1e13,energy:120,tilt:7},principle:'질량 분석·가속된 이온을 주입합니다. PR·게이트의 차폐와 깊이 방향 가우시안 분포를 계산합니다.'},
    rtp:{name:'급속 열처리기',english:'RAPID THERMAL PROCESSOR',family:'rtp',fields:{temperature:field('피크 온도','°C',350,1100),time:field('유지 시간','s',1,180)},defaults:{temperature:1000,time:20},principle:'램프로 가열하여 도펀트를 활성화하고 손상을 회복합니다. 실리사이드 단계에서는 표면 반응을 계산합니다.'},
    cmp:{name:'CMP 연마기',english:'CHEMICAL MECHANICAL PLANARIZATION',family:'cmp',fields:{time:field('연마 시간','s',10,600),pressure:field('헤드 압력','psi',1,6,.1),rpm:field('플래튼 회전','rpm',30,120)},defaults:{time:180,pressure:3,rpm:60},principle:'패드·슬러리·회전 헤드로 높은 부분을 제거합니다. 압력×상대 속도에 비례하는 축약 제거 모델입니다.'},
    pvd:{name:'PVD 스퍼터링기',english:'MAGNETRON SPUTTER DEPOSITION',family:'pvd',fields:{time:field('증착 시간','s',5,600),power:field('타깃 파워','W',300,3000)},defaults:{time:100,power:1500},principle:'플라즈마 이온이 타깃을 때려 방출한 원자를 웨이퍼에 증착합니다.'},
    ald:{name:'ALD 반응기',english:'ATOMIC LAYER DEPOSITION',family:'cluster',fields:{cycles:field('반응 사이클','cycles',10,500),temperature:field('척 온도','°C',150,400)},defaults:{cycles:100,temperature:250},principle:'전구체 A → 퍼지 → 전구체 B → 퍼지의 사이클로 얇은 장벽막을 성장시킵니다.'},
    metrology:{name:'광학 박막 · CD 계측기',english:'IN-LINE PROCESS METROLOGY',family:'metrology',fields:{samples:field('샘플링 지점','sites',5,49)},defaults:{samples:25},principle:'현재 계산된 단면에서 막 두께·높이·패턴 폭을 샘플링합니다. 실측 장비 데이터가 아닙니다.'},
    probe:{name:'웨이퍼 프로버',english:'WAFER SORT / PROCESS CHECK',family:'probe',fields:{samples:field('확인 다이','dies',9,81)},defaults:{samples:49},principle:'프로브 접촉 동작과 공정 구조 체크를 표현합니다. 트랜지스터 I–V나 실제 전기 수율은 계산하지 않습니다.'}
  };
  const modules=[{id:'well',name:'웰 형성',tag:'FEOL / WELL'},{id:'sti',name:'소자 분리',tag:'FEOL / STI'},{id:'gate',name:'게이트 형성',tag:'FEOL / GATE'},{id:'junction',name:'접합 · 실리사이드',tag:'FEOL / S-D'},{id:'contact',name:'콘택트',tag:'MOL / CONTACT'},{id:'m1',name:'금속 1층',tag:'BEOL / M1'},{id:'m2',name:'비아 · 금속 2층',tag:'BEOL / M2'},{id:'finish',name:'보호막 · 검사',tag:'FINISH / SORT'}];
  const route=[];
  function add(module,tool,name,op,extra={}){const step={id:'OP'+String(route.length+1).padStart(3,'0'),index:route.length,module,tool,name,op,...extra};step.recipe={...tools[tool].defaults,...extra.recipe};route.push(step);return step;}
  function photo(module,mask,label){add(module,'coat',label+' · PR 도포','coat',{mask});add(module,'bake',label+' · 소프트베이크','bake',{mask});add(module,'scanner',label+' · 정렬 / 노광','expose',{mask});add(module,'developer',label+' · 현상','develop',{mask});}
  const strip=(module)=>add(module,'strip','감광막 애싱','strip');
  add('well','clean','입고 웨이퍼 세정','clean');
  photo('well','nwell','N-WELL');add('well','implant','N-well 인 주입','implant',{species:'P',role:'well',recipe:{dose:2e13,energy:180}});strip('well');
  photo('well','pwell','P-WELL');add('well','implant','P-well 붕소 주입','implant',{species:'B',role:'well',recipe:{dose:1e13,energy:120}});strip('well');
  add('well','rtp','웰 활성화 열처리','anneal',{recipe:{temperature:1050,time:90}});
  add('sti','oxidation','패드 산화막 성장','oxidize',{recipe:{time:8,temperature:1000}});
  add('sti','lpcvd','SiN 하드마스크 증착','deposit',{material:'SiN',rate:.1,recipe:{time:1000}});
  photo('sti','isolation','ACTIVE');add('sti','etch','STI 하드마스크 개구','etch',{targets:['SiN','SiO2'],rate:3,recipe:{time:50}});
  add('sti','etch','실리콘 트렌치 식각','etch',{targets:['Si'],rate:4,recipe:{time:75}});strip('sti');
  add('sti','oxidation','트렌치 라이너 산화','oxidize',{recipe:{time:2,temperature:950}});
  add('sti','pecvd','STI 산화막 갭필','deposit',{material:'SiO2',rate:2,recipe:{time:350},gapfill:true});
  add('sti','cmp','STI 평탄화 · SiN 정지막','cmp',{plane:116,stop:'SiN',rate:4,recipe:{time:180}});
  add('sti','wetetch','질화막 하드마스크 제거','wetetch',{targets:['SiN'],rate:1.5,recipe:{time:90,temperature:160}});
  add('sti','wetetch','패드 산화막 제거 · STI 리세스','wetetch',{targets:['SiO2'],rate:.5,recipe:{time:200,temperature:25}});
  add('sti','clean','게이트 전 표면 세정','clean');add('sti','metrology','STI 단차 계측','measure');
  add('gate','oxidation','게이트 산화막 성장','oxidize',{recipe:{time:4.2,temperature:1000}});
  add('gate','lpcvd','폴리실리콘 게이트 증착','deposit',{material:'Poly',rate:.2,recipe:{time:1000}});
  photo('gate','gate','POLY');add('gate','etch','폴리 게이트 패턴 식각','etch',{targets:['Poly'],rate:3,recipe:{time:75}});strip('gate');add('gate','metrology','게이트 CD 확인','measure');
  photo('junction','nactive','N-LDD');add('junction','implant','NMOS 확장 접합 주입','implant',{species:'As',role:'extension',recipe:{dose:5e13,energy:15}});strip('junction');
  photo('junction','pactive','P-LDD');add('junction','implant','PMOS 확장 접합 주입','implant',{species:'B',role:'extension',recipe:{dose:3e13,energy:8}});strip('junction');
  add('junction','pecvd','스페이서 질화막 증착','spacerDeposit',{material:'SiN',rate:1,recipe:{time:45}});
  add('junction','etch','이방성 스페이서 에치백','etch',{targets:['SiN'],rate:1,recipe:{time:48}});
  photo('junction','nactive','N+ S/D');add('junction','implant','NMOS 소스 / 드레인 주입','implant',{species:'As',role:'sd',recipe:{dose:2e15,energy:40}});strip('junction');
  photo('junction','pactive','P+ S/D');add('junction','implant','PMOS 소스 / 드레인 주입','implant',{species:'B',role:'sd',recipe:{dose:1e15,energy:15}});strip('junction');
  add('junction','rtp','접합 활성화 · 손상 회복','anneal',{recipe:{temperature:1000,time:20}});
  add('junction','wetetch','실리사이드 전 산화막 제거','wetetch',{targets:['SiO2'],rate:.5,recipe:{time:25,temperature:25}});
  add('junction','pvd','니켈 박막 증착','deposit',{material:'Ni',rate:.5,recipe:{time:30}});
  add('junction','rtp','NiSi 자기정렬 반응','silicide',{recipe:{temperature:450,time:30}});
  add('junction','wetetch','미반응 니켈 선택 제거','wetetch',{targets:['Ni'],rate:1,recipe:{time:30,temperature:60}});
  add('contact','pecvd','층간 절연막 ILD 증착','deposit',{material:'SiO2',rate:2,recipe:{time:400},gapfill:true});
  add('contact','cmp','ILD 평탄화','cmp',{plane:550,rate:4,recipe:{time:140}});
  photo('contact','contact','CONTACT');add('contact','etch','콘택트 홀 식각','etch',{targets:['SiO2'],rate:5,recipe:{time:125}});strip('contact');
  add('contact','ald','콘택트 TiN 장벽막','deposit',{material:'TiN',gpc:.1});
  add('contact','lpcvd','텅스텐 콘택트 충전','deposit',{material:'W',rate:1,recipe:{time:800,temperature:620},gapfill:true});
  add('contact','cmp','텅스텐 플러그 CMP','cmp',{plane:550,rate:5,recipe:{time:175}});add('contact','metrology','콘택트 충전 확인','measure');
  add('m1','pvd','Al 배선막 증착 · M1','deposit',{material:'Al',rate:5,recipe:{time:100}});
  photo('m1','metal1','METAL 1');add('m1','etch','M1 배선 패턴 식각','etch',{targets:['Al'],rate:5,recipe:{time:110}});strip('m1');add('m1','clean','금속 식각 후 세정','clean');
  add('m2','pecvd','금속층 사이 절연막','deposit',{material:'SiO2',rate:2,recipe:{time:450},gapfill:true});
  add('m2','cmp','IMD 평탄화','cmp',{plane:1350,rate:4,recipe:{time:160}});
  photo('m2','via','VIA 1');add('m2','etch','층간 비아 식각','etch',{targets:['SiO2'],rate:5,recipe:{time:100}});strip('m2');
  add('m2','ald','비아 TiN 장벽막','deposit',{material:'TiN',gpc:.1});add('m2','lpcvd','텅스텐 비아 충전','deposit',{material:'W',rate:1,recipe:{time:600},gapfill:true});add('m2','cmp','비아 플러그 CMP','cmp',{plane:1350,rate:5,recipe:{time:140}});
  add('m2','pvd','Al 배선막 증착 · M2','deposit',{material:'Al',rate:5,recipe:{time:100}});photo('m2','metal2','METAL 2');add('m2','etch','M2 배선 패턴 식각','etch',{targets:['Al'],rate:5,recipe:{time:110}});strip('m2');
  add('finish','pecvd','SiN 패시베이션 증착','deposit',{material:'SiN',rate:2,recipe:{time:250}});photo('finish','pad','PAD OPEN');add('finish','etch','패드 개구 식각','etch',{targets:['SiN'],rate:5,recipe:{time:110}});strip('finish');
  add('finish','metrology','최종 단면 · 막 계측','measure');add('finish','probe','웨이퍼 소트 · 구조 체크','probe');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),round=(v,n=3)=>Number(v.toFixed(n));
  const sum=c=>c.reduce((s,l)=>s+l.nm,0),top=c=>c.at(-1),height=c=>sum(c)-BASE;
  const copy=value=>JSON.parse(JSON.stringify(value));
  function createWafer(id='W01'){return {version:VERSION,id,cursor:0,columns:Array.from({length:NX},()=>[{material:'Si',nm:BASE}]),dopants:[],particles:100,prBaked:false,latent:null,mask:null,virtualSeconds:0,records:[],alarms:[]};}
  function maskOpen(mask,x){const near=(c,w)=>Math.abs(x-c)<w/2;const n=x>.1&&x<.4,p=x>.6&&x<.9;switch(mask){case'nwell':return x>.5;case'pwell':return x<.5;case'isolation':return !(n||p);case'gate':return !(near(.25,.08333)||near(.75,.08333));case'nactive':return n;case'pactive':return p;case'contact':return [.16,.25,.34,.66,.75,.84].some(c=>near(c,.04));case'metal1':return !([.16,.25,.34,.66,.75,.84].some(c=>near(c,.045)));case'via':return [.16,.34,.66,.84].some(c=>near(c,.032));case'metal2':return !(near(.25,.30)||near(.75,.30));case'pad':return near(.25,.16)||near(.75,.16);default:return false;}}
  function addFilm(column,material,nm){if(nm<=1e-7)return;if(top(column)?.material===material)top(column).nm+=nm;else column.push({material,nm});}
  function remove(column,nm,allowed=null,selectivity=100){let budget=nm,removed=0;while(budget>1e-7&&column.length){const layer=top(column),factor=!allowed||allowed.includes(layer.material)?1:selectivity;const amount=Math.min(layer.nm,budget/factor);layer.nm-=amount;removed+=amount;budget-=amount*factor;if(layer.nm<1e-6)column.pop();else break;}return removed;}
  function recipeFor(step,overrides={}){const result={};for(const [k,f] of Object.entries(tools[step.tool].fields)){const value=overrides[k]??step.recipe[k];if(typeof value!=='number'||!Number.isFinite(value)||value<f.min||value>f.max||(['cycles','samples'].includes(k)&&!Number.isInteger(value)))throw new Error(f.label+' 범위: '+f.min+'–'+f.max+' '+f.unit);result[k]=value;}return result;}
  function duration(step,p){if(step.tool==='oxidation')return p.time*60;if(step.tool==='scanner')return 20;if(step.tool==='ald')return p.cycles*4;if(['metrology','probe'].includes(step.tool))return p.samples*2;return p.time||60;}
  function interlocks(wafer,step,recipe,fault='none'){
    if(wafer.version!==VERSION)throw new Error('지원하지 않는 웨이퍼 모델 버전입니다.');
    if(!['none','dose','uniformity','vacuum'].includes(fault))throw new Error('지원하지 않는 이상 조건입니다.');
    if(step.index!==wafer.cursor)throw new Error('이 웨이퍼의 다음 공정은 '+(route[wafer.cursor]?.name||'완료 상태')+'입니다.');
    if(fault==='vacuum'&&['etch','strip','implant','pvd','ald','lpcvd','pecvd'].includes(step.tool))throw new Error('VACUUM INTERLOCK · 진공 도달 실패. 웨이퍼 상태를 유지하고 공정을 보류했습니다.');
    const hasPR=wafer.columns.some(c=>c.some(l=>l.material==='PR'&&l.nm>1));
    if(['bake','expose','develop'].includes(step.op)&&!hasPR)throw new Error('RESIST MISSING · 감광막을 먼저 도포해야 합니다.');
    if(step.op==='expose'&&!wafer.prBaked)throw new Error('BAKE INCOMPLETE · 소프트베이크가 완료되지 않았습니다.');
    if(step.op==='develop'&&!wafer.latent)throw new Error('EXPOSURE MISSING · 노광 잠상이 없습니다.');
    if(step.op==='coat'&&hasPR)throw new Error('RESIST RESIDUE · 이전 감광막이 남아 있어 재도포를 보류합니다. 해당 PR 제거 단계부터 조건을 수정해 재실행하세요.');
    recipeFor(step,recipe);
  }
  function summarize(w){const heights=w.columns.map(height),films={};for(const material of Object.keys(materials)){const vals=w.columns.map(c=>c.filter(l=>l.material===material).reduce((a,l)=>a+l.nm,0));films[material]={mean:round(vals.reduce((a,b)=>a+b,0)/NX),max:round(Math.max(...vals))};}const gateIndices=w.columns.map((c,i)=>c.some(l=>l.material==='Poly'&&l.nm>20)?i:-1).filter(i=>i>=0);let gateCount=0;for(let i=0;i<gateIndices.length;i++)if(!i||gateIndices[i]>gateIndices[i-1]+1)gateCount++;return {surfaceMax:round(Math.max(...heights)),surfaceMin:round(Math.min(...heights)),topography:round(Math.max(...heights)-Math.min(...heights)),particles:round(w.particles,2),gateCD:gateCount?round(gateIndices.length*WIDTH/NX/gateCount,1):null,films,implants:w.dopants.length,activation:w.dopants.length?round(w.dopants.reduce((s,d)=>s+d.activation,0)/w.dopants.length*100,1):0};}
  function process(wafer,step,overrides={},fraction=1,fault='none'){
    if(!Number.isFinite(fraction))throw new Error('공정 진행률이 유효하지 않습니다.');
    const p=recipeFor(step,overrides),f=clamp(fraction,0,1);interlocks(wafer,step,p,fault);const w=copy({...wafer,records:[]});const before=summarize(wafer),dt=duration(step,p)*f;
    const variation=i=>1+(fault==='uniformity'?.22:.015)*((i/(NX-1)-.5)**2*4-.33);
    switch(step.op){
      case'clean':w.particles*=Math.exp(-p.time*f*(.02+(p.temperature-20)*.00025));break;
      case'oxidize':w.columns.forEach((c,i)=>{let layer=top(c);if(!layer||!['Si','SiO2'].includes(layer.material))return;const existing=layer.material==='SiO2'?layer.nm:0;if(layer.material==='SiO2'&&c.at(-2)?.material!=='Si')return;const a=120,b=240*Math.exp((p.temperature-1000)/95),grown=(Math.sqrt((2*existing+a)**2+4*b*p.time*f)-a)/2-existing;const silicon=c[layer.material==='Si'?c.length-1:c.length-2];const amount=Math.min(grown*variation(i),silicon.nm/.44);silicon.nm-=amount*.44;addFilm(c,'SiO2',amount);});break;
      case'deposit':case'spacerDeposit':{
        let thickness=step.gpc?p.cycles*step.gpc:step.rate*(p.time||1);if(step.tool==='lpcvd'||step.tool==='pecvd')thickness*=Math.exp((p.temperature-(step.tool==='lpcvd'?620:350))/180)*Math.sqrt(p.flow/100);if(step.tool==='pvd')thickness*=p.power/1500;if(step.tool==='ald')thickness*=Math.exp(-Math.max(0,Math.abs(p.temperature-250)-50)/150);thickness*=f;
        const oldHeights=w.columns.map(height);w.columns.forEach((c,i)=>{let amount=thickness*variation(i);if(step.op==='spacerDeposit'&&f>0){const reach=Math.ceil(thickness/(WIDTH/NX));const neighbor=Math.max(...oldHeights.slice(Math.max(0,i-reach),Math.min(NX,i+reach+1)));amount+=Math.max(0,neighbor-oldHeights[i])*.9;}addFilm(c,step.material,amount);});w.particles+=.8*f;break;}
      case'coat':{const thickness=600*Math.sqrt(3000/p.rpm)*Math.min(1,p.time/25)*f;w.columns.forEach((c,i)=>addFilm(c,'PR',thickness*variation(i)));w.mask=step.mask;w.latent=null;w.prBaked=false;break;}
      case'bake':if(f===1)w.prBaked=true;w.bakeFactor=clamp(1-Math.abs(p.temperature-100)/80-Math.abs(p.time-60)/250,.4,1);break;
      case'expose':{const sigma=(55*Math.sqrt(1+(p.focus/.35)**2))/(WIDTH/NX);const effectiveDose=p.dose*(fault==='dose'?.55:1)*f;w.latent=w.columns.map((_,i)=>{let light=0,total=0;for(let j=-Math.ceil(sigma*3);j<=Math.ceil(sigma*3);j++){const weight=Math.exp(-j*j/(2*sigma*sigma));light+=weight*(maskOpen(step.mask,clamp((i+j+.5)/NX,0,1))?1:0);total+=weight;}return effectiveDose*light/total*(w.bakeFactor||1);});break;}
      case'develop':w.columns.forEach((c,i)=>{if(top(c)?.material==='PR'){const response=(w.latent[i]/65)**6;const speed=.002+16*response/(1+response);remove(c,Math.min(top(c).nm,speed*p.time*f),['PR']);}});break;
      case'etch':{const rate=step.rate*(p.power/200)**.7*(20/p.pressure)**.12;w.columns.forEach((c,i)=>{let remaining=p.time*f;if(top(c)?.material==='PR'){const prRate=rate/8,used=Math.min(remaining,top(c).nm/prRate);remove(c,prRate*used,['PR']);remaining-=used;}if(remaining>0)remove(c,rate*remaining*variation(i),step.targets,150);});break;}
      case'strip':w.columns.forEach(c=>{if(top(c)?.material==='PR')remove(c,Math.min(top(c).nm,9*p.time*f*p.power/300),['PR']);});if(f===1){w.prBaked=false;w.latent=null;}break;
      case'wetetch':w.columns.forEach(c=>{if(top(c)&&step.targets.includes(top(c).material))remove(c,Math.min(top(c).nm,step.rate*p.time*f*Math.exp((p.temperature-step.recipe.temperature)/100)),step.targets);});break;
      case'implant':{const rp=p.energy*(step.species==='B'?2.8:step.species==='P'?1.7:.8)*Math.cos(p.tilt*Math.PI/180),sigma=Math.max(7,rp*.32),dose=p.dose*f;const transmission=w.columns.map(c=>{const barrier=c.filter(l=>l.material!=='Si').reduce((s,l)=>s+l.nm*(l.material==='SiO2'?.3:1),0);return Math.exp(-barrier/Math.max(10,rp*.22));});if(f>0)w.dopants.push({species:step.species,role:step.role,dose,rp,sigma,activation:0,transmission,tilt:p.tilt});break;}
      case'anneal':w.dopants.forEach(d=>{const k=.13*Math.exp((p.temperature-1000)/85);d.activation=1-(1-d.activation)*Math.exp(-k*p.time*f);const diffusion=.6*Math.exp((p.temperature-1000)/75);d.sigma=Math.sqrt(d.sigma*d.sigma+2*diffusion*p.time*f);});break;
      case'silicide':w.columns.forEach(c=>{const ni=top(c),si=c.at(-2);if(ni?.material==='Ni'&&['Si','Poly'].includes(si?.material)){const reacted=Math.min(ni.nm*clamp((p.temperature-300)/150,0,1)*Math.min(1,p.time/30)*f,si.nm/.8),remaining=ni.nm-reacted;c.pop();si.nm-=reacted*.8;addFilm(c,'NiSi',reacted*1.8);addFilm(c,'Ni',remaining);}});break;
      case'cmp':{const removal=step.rate*p.pressure/3*p.rpm/60*p.time*f;const stopHeight=c=>{const index=step.stop?c.findIndex(l=>l.material===step.stop):-1;return index<0?null:sum(c.slice(0,index+1))-BASE;};const stops=w.columns.map(stopHeight).filter(v=>v!==null);const plane=stops.length?stops.reduce((a,b)=>a+b,0)/stops.length:step.plane;w.columns.forEach(c=>remove(c,Math.min(removal,Math.max(0,height(c)-(stopHeight(c)??plane)))));break;}
      case'measure':case'probe':{const sites=Array.from({length:p.samples},(_,j)=>{const index=Math.round(j/(p.samples-1)*(NX-1)),c=w.columns[index];return {index,x_nm:(index+.5)*WIDTH/NX,surface_nm:round(height(c)),top_material:top(c)?.material||null,top_thickness_nm:round(top(c)?.nm||0)};});w.lastMeasurement={stepId:step.id,samples:p.samples,source:'geometric-model-sampling',sites,summary:summarize(w)};break;}
    }
    const metrics=summarize(w),warnings=[];
    if(step.op==='develop'){const centers=[];let start=-1;for(let i=0;i<=NX;i++){const open=i<NX&&maskOpen(step.mask,(i+.5)/NX);if(open&&start<0)start=i;if(!open&&start>=0){centers.push(Math.floor((start+i-1)/2));start=-1;}}const blocked=centers.filter(i=>top(w.columns[i])?.material==='PR'&&top(w.columns[i]).nm>5).length;if(blocked)warnings.push({code:'PR_RESIDUE',message:'마스크 개구 '+centers.length+'곳 중 '+blocked+'곳의 중심에 PR이 남았습니다. 노광·현상 조건을 확인하세요.'});}
    if(step.op==='strip'&&metrics.films.PR.max>1)warnings.push({code:'STRIP_INCOMPLETE',message:'감광막이 남았습니다. 다음 도포 전에 제거 조건을 확인하세요.'});
    if(step.op==='cmp'&&metrics.topography>50)warnings.push({code:'PLANARITY',message:'연마 후 표면 단차가 50 nm를 넘습니다. 연마 시간·압력을 검토하세요.'});
    if(step.op==='etch'&&metrics.films.Si.mean<before.films.Si.mean-350)warnings.push({code:'SUBSTRATE_LOSS',message:'실리콘 제거량이 큰 조건입니다. 표적 막과 시간을 확인하세요.'});
    if(step.tool==='scanner'&&Math.abs(p.focus)>.5)warnings.push({code:'DEFOCUS',message:'큰 초점 오프셋으로 광학상이 흐려지는 조건입니다.'});
    w.virtualSeconds+=dt;if(f===1)w.cursor=wafer.cursor+1;
    return {wafer:w,recipe:p,metrics,warnings,seconds:duration(step,p),before};
  }
  function execute(wafer,overrides={},fault='none'){
    const step=route[wafer.cursor];if(!step)throw new Error('이 웨이퍼의 공정이 모두 완료되었습니다.');const result=process(wafer,step,overrides,1,fault);
    const record={stepId:step.id,index:step.index,tool:step.tool,name:step.name,recipe:result.recipe,fault,metrics:result.metrics,warnings:result.warnings,seconds:result.seconds,modelVersion:VERSION,time:new Date().toISOString()};result.wafer.records=[...wafer.records,record];return result;
  }
  function replay(id,records,count=records.length){let w=createWafer(id);for(const record of records.slice(0,count)){const step=route[w.cursor];if(record.modelVersion!==VERSION||record.stepId!==step?.id)throw new Error('공정 기록의 모델 버전 또는 순서가 일치하지 않습니다.');const result=execute(w,record.recipe,record.fault||'none');w=result.wafer;w.records[w.records.length-1].time=record.time;}return w;}
  function dopingAt(w,column,depth){let n=-1e15;for(const d of w.dopants){const peak=d.dose/(Math.sqrt(2*Math.PI)*d.sigma*1e-7);const value=peak*Math.exp(-.5*((depth-d.rp)/d.sigma)**2)*d.transmission[column]*d.activation;n+=(d.species==='B'?-1:1)*value;}return n;}
  root.FabEngine={VERSION,NX,WIDTH,BASE,materials,tools,modules,route,createWafer,maskOpen,recipeFor,duration,interlocks,summarize,process,execute,replay,dopingAt,height,copy};
})(typeof window!=='undefined'?window:globalThis);

/* Independent two-factor experiments over one reproducible CMOS input state. */
(function(root){
  'use strict';
  const E=root.FabEngine;
  if(!E)throw new Error('FabEngine must be loaded before process-window experiments.');
  const RESULT='stratum-cmos-window-result-v1',PACKAGE='stratum-cmos-window-package-v1',SCREEN_PACKAGE='stratum-cmos-window-package-v2';
  const NOTICE='동일한 완료 이력에서 두 실행 조건만 바꾼 독립 계산입니다. 보정되지 않은 기하·축약 모델이며 실측 데이터, 통계적 수율 또는 양산 승인 근거가 아닙니다.';
  const faults=['none','dose','uniformity','vacuum'],trusted=new WeakMap();
  const fail=message=>{throw new Error(message);};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const metrics=Object.freeze([
    {id:'oxideMean',label:'산화막 평균 두께',unit:'nm',description:'대표 단면 160개 위치의 SiO₂ 총 두께 평균'},
    {id:'polyMean',label:'폴리 평균 두께',unit:'nm',description:'대표 단면 160개 위치의 Poly 총 두께 평균'},
    {id:'topography',label:'표면 단차',unit:'nm',description:'대표 단면의 최대 높이와 최소 높이 차이'},
    {id:'gateCD',label:'폴리 게이트 평균 폭',unit:'nm',description:'게이트 식각 이후 두께 20 nm 초과 Poly 위치를 30 nm 격자로 묶은 평균 폭. 연속 잔막은 4,800 nm로 표시될 수 있음'},
    {id:'surfaceMax',label:'표면 최대 높이',unit:'nm',description:'입고 Si 표면을 0 nm로 둔 대표 단면 최대 높이'}
  ].map(Object.freeze));
  const presetDefinitions=[
    {id:'oxidation',title:'게이트 산화 공정창',description:'산화 시간과 온도를 함께 바꾸어 산화막 성장을 비교합니다.',name:'게이트 산화막 성장',metric:'oxideMean',x:{field:'time',min:2.2,max:6.2,count:5},y:{field:'temperature',min:950,max:1050,count:5}},
    {id:'gate-etch',title:'게이트 식각 공정창',description:'식각 시간과 바이어스 파워가 폴리 잔막과 패턴 폭에 미치는 영향을 비교합니다.',name:'폴리 게이트 패턴 식각',metric:'polyMean',x:{field:'time',min:45,max:105,count:5},y:{field:'power',min:100,max:300,count:5}},
    {id:'cmp',title:'ILD 평탄화 공정창',description:'연마 시간과 헤드 압력을 바꾸어 표면 단차와 절연막 두께를 비교합니다.',name:'ILD 평탄화',metric:'topography',x:{field:'time',min:70,max:210,count:5},y:{field:'pressure',min:2,max:4,count:5}}
  ];
  const presets=Object.freeze(presetDefinitions.map(p=>Object.freeze({id:p.id,title:p.title,description:p.description,stepId:E.route.find(s=>s.name===p.name).id,metric:p.metric,x:Object.freeze({...p.x}),y:Object.freeze({...p.y})})));
  const gateIndex=E.route.find(s=>s.name==='폴리 게이트 패턴 식각').index;
  function copy(input){
    let nodes=0,characters=0;const seen=new Set();
    function visit(value,depth){
      if(++nodes>150000||depth>20)fail('공정창 데이터의 구조가 너무 크거나 깊습니다.');
      if(value===null||typeof value==='boolean')return value;
      if(typeof value==='number'){if(!Number.isFinite(value))fail('유한한 숫자만 사용할 수 있습니다.');return value;}
      if(typeof value==='string'){characters+=value.length;if(value.length>12000||characters>1500000)fail('공정창 데이터의 텍스트가 너무 깁니다.');return value;}
      if(typeof value!=='object')fail('공정창 데이터에는 JSON 값만 사용할 수 있습니다.');
      if(seen.has(value))fail('순환 참조는 사용할 수 없습니다.');
      const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
      if(!array&&proto!==null){const ctor=Object.getOwnPropertyDescriptor(proto,'constructor');if(Object.getPrototypeOf(proto)!==null||!ctor||!Object.hasOwn(ctor,'value')||typeof ctor.value!=='function'||Object.getOwnPropertyDescriptor(ctor.value,'name')?.value!=='Object')fail('일반 JSON 객체가 필요합니다.');}
      const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
      if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))fail('허용하지 않는 JSON 속성입니다.');
      if(array&&(value.length>1000||keys.length!==value.length+1))fail('배열의 형식 또는 길이가 올바르지 않습니다.');
      if(!array&&keys.length>100)fail('객체의 속성이 너무 많습니다.');
      seen.add(value);const result=array?[]:{};
      for(const key of keys){if(array&&key==='length')continue;const d=descriptors[key];if(!d.enumerable||!Object.hasOwn(d,'value')||(array&&!/^(0|[1-9]\d*)$/.test(key)))fail('JSON 값 속성만 사용할 수 있습니다.');result[key]=visit(d.value,depth+1);}
      seen.delete(value);return result;
    }
    return visit(input,0);
  }
  function shape(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail(label+'의 필수 항목 또는 형식이 올바르지 않습니다.');}
  function textValue(value,max,label){if(typeof value!=='string'||value.length>max)fail(label+'은 '+max+'자 이하의 문자열이어야 합니다.');}
  function finite(value,label){if(typeof value!=='number'||!Number.isFinite(value))fail(label+'은 유한한 숫자여야 합니다.');}
  function timestamp(value){
    if(typeof value!=='string')fail('유효한 ISO 날짜가 필요합니다.');
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if(!m)fail('유효한 ISO 날짜와 시간대가 필요합니다.');
    const year=+m[1],month=+m[2],day=+m[3],days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    if(month<1||month>12||day<1||day>days[month-1]||+m[4]>23||+m[5]>59||+m[6]>59||+(m[9]||0)>23||+(m[10]||0)>59||!Number.isFinite(Date.parse(value)))fail('공정 기록의 날짜가 유효하지 않습니다.');
  }
  function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
  function same(actual,expected,label){if(canonical(actual)!==canonical(expected))fail(label+'이 재계산 결과와 일치하지 않습니다.');}
  function remember(result){trusted.set(result,canonical(result));return result;}
  function ensureTrusted(result){if(!result||!trusted.has(result)||trusted.get(result)!==canonical(copy(result)))fail('결과를 먼저 계산하거나 패키지를 다시 검증하세요.');}
  function getStep(id){if(typeof id!=='string')fail('공정 ID가 올바르지 않습니다.');const step=E.route.find(s=>s.id===id);if(!step)fail('지원하지 않는 공정 ID입니다.');return step;}
  function recipe(step,value){shape(value,Object.keys(E.tools[step.tool].fields),'전체 실행 레시피');for(const v of Object.values(value))finite(v,'레시피 값');return E.recipeFor(step,value);}
  function describe(stepId){const step=getStep(stepId);return {stepId:step.id,name:step.name,tool:step.tool,fields:Object.entries(E.tools[step.tool].fields).map(([id,f])=>({id,...f})),baseRecipe:copy(step.recipe)};}
  function axis(step,value){
    shape(value,['field','min','max','count'],'변수 범위');const field=E.tools[step.tool].fields[value.field];
    if(typeof value.field!=='string'||!Object.hasOwn(E.tools[step.tool].fields,value.field))fail('선택한 장비에 없는 변수입니다.');
    finite(value.min,'최소값');finite(value.max,'최대값');
    if(value.min<field.min||value.max>field.max||value.min>=value.max)fail(field.label+' 범위는 '+field.min+'–'+field.max+' '+field.unit+' 안에서 최소값 < 최대값이어야 합니다.');
    if(value.count!==3&&value.count!==5)fail('각 변수는 3개 또는 5개 수준으로 계산하세요.');
    const values=Array.from({length:value.count},(_,i)=>{
      const raw=value.min+(value.max-value.min)*i/(value.count-1);
      // Quantize from the field minimum, never from zero (e.g. implant dose).
      const ticks=Math.max(0,Math.min(Math.floor((field.max-field.min)/field.step+1e-9),Math.round((raw-field.min)/field.step)));
      return Number((field.min+ticks*field.step).toPrecision(14));
    });
    if(new Set(values).size!==value.count)fail(field.label+' 범위를 넓히거나 수준 수를 줄이세요. 장비 입력 간격에 맞춘 서로 다른 값이 부족합니다.');
    return {...value,label:field.label,unit:field.unit,values};
  }
  function config(input){
    const c=copy(input);shape(c,['input','stepId','baseRecipe','fault','x','y'],'공정창 설정');
    shape(c.input,['waferId','title','records'],'공통 입력');
    if(typeof c.input.waferId!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(c.input.waferId))fail('입력 웨이퍼 ID가 올바르지 않습니다.');
    textValue(c.input.title,100,'입력 실험 이름');const step=getStep(c.stepId);
    if(!Array.isArray(c.input.records)||c.input.records.length!==step.index)fail('선택 공정 직전까지의 연속 완료 기록이 필요합니다.');
    c.baseRecipe=recipe(step,c.baseRecipe);if(!faults.includes(c.fault))fail('지원하지 않는 이상 조건입니다.');
    c.x=axis(step,c.x);c.y=axis(step,c.y);
    if(c.x.field===c.y.field)fail('서로 다른 두 변수를 선택하세요.');
    if(c.x.count!==c.y.count)fail('두 변수의 수준 수를 같게 설정하세요 (3×3 또는 5×5).');
    for(let i=0;i<c.input.records.length;i++){
      const r=c.input.records[i],s=E.route[i];shape(r,['stepId','index','tool','name','recipe','fault','metrics','warnings','seconds','modelVersion','time'],'완료 공정 기록');
      if(r.stepId!==s.id||r.index!==i||r.tool!==s.tool||r.name!==s.name||r.modelVersion!==E.VERSION)fail('완료 기록의 순서·공정·모델 버전이 일치하지 않습니다.');
      recipe(s,r.recipe);if(!faults.includes(r.fault))fail('완료 기록에 알 수 없는 이상 조건이 있습니다.');timestamp(r.time);
    }
    return c;
  }
  function abort(signal){if(signal?.aborted){const error=new Error('공정창 계산을 취소했습니다.');error.name='AbortError';throw error;}}
  const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
  function options(settings){if(settings?.onProgress!==undefined&&typeof settings.onProgress!=='function')fail('진행률 콜백은 함수여야 합니다.');return settings||{};}
  function progress(settings,event){abort(settings.signal);settings.onProgress?.(event);abort(settings.signal);}
  async function preparePreset(id,settings={}){
    settings=options(settings);abort(settings.signal);const preset=presets.find(p=>p.id===id);if(!preset)fail('지원하지 않는 공정창 예제입니다.');
    const step=getStep(preset.stepId);let wafer=E.createWafer('WINDOW-INPUT');
    progress(settings,{phase:'prepare',completed:0,total:step.index});await yieldTask();abort(settings.signal);
    while(wafer.cursor<step.index){wafer=E.execute(wafer).wafer;progress(settings,{phase:'prepare',completed:wafer.cursor,total:step.index});if(wafer.cursor%4===0){await yieldTask();abort(settings.signal);}}
    return {input:{waferId:wafer.id,title:preset.title+' · 공통 입력',records:copy(wafer.records)},stepId:step.id,baseRecipe:copy(step.recipe),fault:'none',x:copy(preset.x),y:copy(preset.y)};
  }
  function flat(summary,step){return {oxideMean:summary.films.SiO2.mean,polyMean:summary.films.Poly.mean,topography:summary.topography,gateCD:step.index>=gateIndex?summary.gateCD:null,surfaceMax:summary.surfaceMax};}
  function sample(wafer,step,parameters,fault){const result=E.execute(E.copy(wafer),parameters,fault);return {recipe:copy(result.recipe),metrics:flat(result.metrics,step),warnings:copy(result.warnings),seconds:result.seconds};}
  async function run(input,settings={}){
    settings=options(settings);abort(settings.signal);const c=config(input),step=getStep(c.stepId),total=c.input.records.length+1+c.x.values.length*c.y.values.length;let completed=0;
    progress(settings,{phase:'replay',completed,total});await yieldTask();abort(settings.signal);
    let wafer=E.createWafer(c.input.waferId);
    for(const record of c.input.records){
      wafer=E.execute(wafer,record.recipe,record.fault).wafer;wafer.records.at(-1).time=record.time;same(record,wafer.records.at(-1),'완료 기록');
      progress(settings,{phase:'replay',completed:++completed,total});if(completed%4===0){await yieldTask();abort(settings.signal);}
    }
    const baseline=sample(wafer,step,c.baseRecipe,c.fault);progress(settings,{phase:'calculate',completed:++completed,total});await yieldTask();abort(settings.signal);
    const rows=[];
    for(let iy=0;iy<c.y.values.length;iy++)for(let ix=0;ix<c.x.values.length;ix++){
      const x=c.x.values[ix],y=c.y.values[iy],parameters={...c.baseRecipe,[c.x.field]:x,[c.y.field]:y};
      rows.push({id:'R'+String(rows.length+1).padStart(2,'0'),ix,iy,x,y,...sample(wafer,step,parameters,c.fault)});
      progress(settings,{phase:'calculate',completed:++completed,total});await yieldTask();abort(settings.signal);
    }
    return remember({schema:RESULT,modelVersion:E.VERSION,generatedAt:new Date().toISOString(),input:c.input,stepId:step.id,stepName:step.name,tool:step.tool,baseRecipe:c.baseRecipe,fault:c.fault,x:c.x,y:c.y,metricDefinitions:copy(metrics),baseline,rows,notice:NOTICE});
  }
  function criteriaValue(value){
    const c=copy(value);shape(c,['metric','min','max'],'목표 범위');if(!metrics.some(m=>m.id===c.metric))fail('지원하지 않는 결과 지표입니다.');finite(c.min,'목표 최소값');finite(c.max,'목표 최대값');if(c.min>c.max)fail('목표 최소값은 최대값 이하여야 합니다.');return c;
  }
  function assess(result,criteria){
    ensureTrusted(result);const c=criteriaValue(criteria),status=value=>value===null?'unavailable':value>=c.min&&value<=c.max?'inside':'outside';
    const rows=result.rows.map(row=>({id:row.id,value:row.metrics[c.metric],status:status(row.metrics[c.metric])}));
    return {...c,total:rows.length,inside:rows.filter(r=>r.status==='inside').length,outside:rows.filter(r=>r.status==='outside').length,unavailable:rows.filter(r=>r.status==='unavailable').length,baseline:status(result.baseline.metrics[c.metric]),rows};
  }
  function compareRows(result,referenceId,selectedId){
    ensureTrusted(result);
    const find=id=>{if(typeof id!=='string')fail('비교할 조건 ID를 선택하세요.');const row=result.rows.find(r=>r.id===id);if(!row)fail('계산 결과에 없는 조건입니다.');return row;};
    const reference=find(referenceId),selected=find(selectedId);
    const difference=(left,right)=>Number.isFinite(left)&&Number.isFinite(right)?right-left:null;
    return {referenceId,selectedId,
      recipe:Object.entries(E.tools[result.tool].fields).map(([id,f])=>({id,label:f.label,unit:f.unit,reference:reference.recipe[id],selected:selected.recipe[id],delta:difference(reference.recipe[id],selected.recipe[id])})),
      metrics:metrics.map(m=>({...m,reference:reference.metrics[m.id],selected:selected.metrics[m.id],delta:difference(reference.metrics[m.id],selected.metrics[m.id])})),
      seconds:{reference:reference.seconds,selected:selected.seconds,delta:difference(reference.seconds,selected.seconds)},
      warnings:{reference:copy(reference.warnings),selected:copy(selected.warnings)}};
  }
  function screeningValue(value){
    const s=copy(value);shape(s,['limits','excludeWarnings','sort'],'후보 선택 기준');
    if(!Array.isArray(s.limits)||s.limits.length<1||s.limits.length>metrics.length)fail('목표 지표를 1개 이상, 최대 5개 선택하세요.');
    s.limits=s.limits.map(criteriaValue);
    if(new Set(s.limits.map(c=>c.metric)).size!==s.limits.length)fail('같은 목표 지표를 중복으로 선택할 수 없습니다.');
    if(typeof s.excludeWarnings!=='boolean')fail('경고 제외 여부를 선택하세요.');
    shape(s.sort,['metric','direction'],'후보 정렬');
    if(!['seconds',...metrics.map(m=>m.id)].includes(s.sort.metric)||!['asc','desc'].includes(s.sort.direction))fail('지원하지 않는 후보 정렬 기준입니다.');
    return s;
  }
  function screen(result,settings){
    ensureTrusted(result);const s=screeningValue(settings);
    const sortDefinition=s.sort.metric==='seconds'?{label:'모델 처리 시간',unit:'s'}:metrics.find(m=>m.id===s.sort.metric);
    const rows=result.rows.map(row=>{
      const checks=s.limits.map(c=>{const value=row.metrics[c.metric],definition=metrics.find(m=>m.id===c.metric);return {...c,label:definition.label,unit:definition.unit,value,status:value===null?'unavailable':value>=c.min&&value<=c.max?'inside':'outside'};});
      const unavailable=checks.filter(c=>c.status==='unavailable'),outside=checks.filter(c=>c.status==='outside');
      const status=unavailable.length?'unavailable':outside.length?'outside':s.excludeWarnings&&row.warnings.length?'warnings':'candidate';
      const reasons=checks.filter(c=>c.status!=='inside').map(c=>c.label+(c.status==='unavailable'?': 계산값 없음':': '+c.value+' '+c.unit+' (목표 '+c.min+'–'+c.max+')'));
      if(s.excludeWarnings&&row.warnings.length)reasons.push('모델 경고 '+row.warnings.length+'개 제외');
      return {id:row.id,status,reason:reasons.join(' / ')||'모든 목표 범위 충족',checks,warningCount:row.warnings.length,sortValue:s.sort.metric==='seconds'?row.seconds:row.metrics[s.sort.metric]};
    });
    // Missing sort values are always last. Equal values keep original condition
    // order, including descending sorts; this is an ordering, not a quality score.
    const candidates=rows.filter(r=>r.status==='candidate').sort((a,b)=>{
      if(a.sortValue===null)return b.sortValue===null?0:1;
      if(b.sortValue===null)return -1;
      return (s.sort.direction==='asc'?1:-1)*(a.sortValue-b.sortValue);
    }).map((r,i)=>({id:r.id,rank:i+1,sortValue:r.sortValue,warningCount:r.warningCount}));
    return {settings:s,total:rows.length,count:candidates.length,
      excluded:{outside:rows.filter(r=>r.status==='outside').length,unavailable:rows.filter(r=>r.status==='unavailable').length,warnings:rows.filter(r=>r.status==='warnings').length},
      sortLabel:sortDefinition.label,sortUnit:sortDefinition.unit,candidates,rows};
  }
  function metadata(value={}){const m=copy(value);if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['title','note'].includes(k)))fail('검토 제목과 메모 형식이 올바르지 않습니다.');const title=Object.hasOwn(m,'title')?m.title:'',note=Object.hasOwn(m,'note')?m.note:'';textValue(title,100,'검토 제목');textValue(note,3000,'검토 메모');return {title,note};}
  async function digest(payload){if(!root.crypto?.subtle||!root.TextEncoder)fail('SHA-256 검증에는 HTTPS 또는 localhost 연결이 필요합니다.');const bytes=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(canonical(payload)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
  async function pack(result,settings={}){
    ensureTrusted(result);const s=copy(settings);if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['criteria','title','note','screening'].includes(k)))fail('검토 패키지 설정이 올바르지 않습니다.');
    const criteria=s.criteria===undefined||s.criteria===null?null:criteriaValue(s.criteria),m=metadata({title:Object.hasOwn(s,'title')?s.title:'',note:Object.hasOwn(s,'note')?s.note:''}),payload={result:copy(result),criteria,...m};
    if(s.screening!==undefined&&s.screening!==null)payload.screening=screeningValue(s.screening);
    return {schema:payload.screening?SCREEN_PACKAGE:PACKAGE,payload,integrity:{algorithm:'SHA-256',digest:await digest(payload)}};
  }
  async function unpack(input,settings={}){
    settings=options(settings);abort(settings.signal);
    if(typeof input==='string'){if(input.length>2000000)fail('공정창 파일은 2 MB 이하여야 합니다.');try{input=JSON.parse(input);}catch{fail('유효한 JSON 공정창 파일이 아닙니다.');}}
    const p=copy(input);shape(p,['schema','payload','integrity'],'공정창 패키지');if(![PACKAGE,SCREEN_PACKAGE].includes(p.schema))fail('지원하지 않는 공정창 패키지 형식입니다.');shape(p.payload,['result','criteria','title','note',...(p.schema===SCREEN_PACKAGE?['screening']:[])],'검토 내용');
    shape(p.integrity,['algorithm','digest'],'파일 체크섬');if(p.integrity.algorithm!=='SHA-256'||typeof p.integrity.digest!=='string'||!/^[0-9a-f]{64}$/.test(p.integrity.digest))fail('SHA-256 체크섬 형식이 올바르지 않습니다.');
    if(await digest(p.payload)!==p.integrity.digest)fail('파일 체크섬이 일치하지 않습니다.');abort(settings.signal);
    const r=p.payload.result;shape(r,['schema','modelVersion','generatedAt','input','stepId','stepName','tool','baseRecipe','fault','x','y','metricDefinitions','baseline','rows','notice'],'공정창 결과');
    if(r.schema!==RESULT||r.modelVersion!==E.VERSION)fail('현재 시뮬레이터와 모델 버전이 다릅니다.');timestamp(r.generatedAt);
    const {title,note}=metadata({title:p.payload.title,note:p.payload.note}),criteria=p.payload.criteria===null?null:criteriaValue(p.payload.criteria),screening=p.schema===SCREEN_PACKAGE?screeningValue(p.payload.screening):null;
    for(const a of [r.x,r.y])shape(a,['field','min','max','count','label','unit','values'],'결과 변수');
    if(!Array.isArray(r.rows)||r.rows.length>25)fail('공정창은 최대 25개 조건만 지원합니다.');
    const a=value=>({field:value.field,min:value.min,max:value.max,count:value.count});
    const result=await run({input:r.input,stepId:r.stepId,baseRecipe:r.baseRecipe,fault:r.fault,x:a(r.x),y:a(r.y)},settings);
    result.generatedAt=r.generatedAt;same(r,result,'공정창 입력·기준·전체 조건 결과');remember(result);
    return {result,criteria,title,note,screening,checks:{checksum:true,model:true,replay:true}};
  }
  const amount=value=>value===null?'—':String(value);
  const statusLabel={inside:'목표 범위 안',outside:'목표 범위 밖',unavailable:'해당 지표 없음'};
  function csvCell(value){let s=String(value??'');if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function toCSV(result,criteria=null,meta={},screening=null){
    ensureTrusted(result);const {title,note}=metadata(meta),assessment=criteria===null?null:assess(result,criteria),fieldEntries=Object.entries(E.tools[result.tool].fields);
    const screened=screening===null?null:screen(result,screening);
    const lines=[['STRATUM','CMOS PROCESS WINDOW'],['검토 제목',title],['검토 메모',note],['모델',result.modelVersion],['생성 시각',result.generatedAt],['공정',result.stepId,result.stepName],['공통 입력',result.input.waferId,result.input.title,result.input.records.length+'개 완료 기록'],['이상 조건',result.fault],['적용 범위',result.notice]];
    if(assessment)lines.push(['목표 지표',metrics.find(m=>m.id===assessment.metric).label,'nm','최소값 포함',assessment.min,'최대값 포함',assessment.max]);
    if(screened){
      for(const c of screened.settings.limits)lines.push(['후보 목표',metrics.find(m=>m.id===c.metric).label,'nm',c.min,c.max]);
      lines.push(['후보 경고 제외',screened.settings.excludeWarnings?'예':'아니오'],['후보 정렬',screened.sortLabel,screened.settings.sort.direction==='asc'?'작은 값부터':'큰 값부터','동률은 조건 번호 순'],['후보 수',screened.count,screened.total]);
    }
    lines.push(['조건',result.x.label+' ('+result.x.unit+')',result.y.label+' ('+result.y.unit+')',...fieldEntries.map(([,f])=>f.label+' ('+f.unit+')'),...metrics.map(m=>m.label+' ('+m.unit+')'),'처리 시간 (s)','경고','목표 범위']);
    for(const [index,row] of [result.baseline,...result.rows].entries())lines.push([index===0?'기준':row.id,row.recipe[result.x.field],row.recipe[result.y.field],...fieldEntries.map(([k])=>row.recipe[k]),...metrics.map(m=>row.metrics[m.id]===null?'해당 지표 없음':row.metrics[m.id]),row.seconds,row.warnings.map(w=>w.code+': '+w.message).join(' | '),assessment?statusLabel[index===0?assessment.baseline:assessment.rows[index-1].status]:'미설정']);
    if(screened){
      const header=lines.length-result.rows.length-2;lines[header].push('후보 선택','정렬 순서','후보 판정 근거');
      lines[header+1].push('실행 기준 조건','','후보 목록에서 제외');
      screened.rows.forEach((r,i)=>lines[header+2+i].push(r.status==='candidate'?'후보':'제외',screened.candidates.find(c=>c.id===r.id)?.rank??'',r.reason));
    }
    return '\uFEFF'+lines.map(line=>line.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  function toHTML(result,criteria=null,meta={},screening=null){
    ensureTrusted(result);const {title,note}=metadata(meta),assessment=criteria===null?null:assess(result,criteria),metric=assessment?metrics.find(m=>m.id===assessment.metric):null;
    const pairs=parameters=>Object.entries(parameters).map(([key,value])=>esc(E.tools[result.tool].fields[key].label)+' '+esc(value)+' '+esc(E.tools[result.tool].fields[key].unit)).join(' · ');
    const all=[result.baseline,...result.rows],screened=screening===null?null:screen(result,screening);
    const screeningReport=screened?`<section aria-label="후보 조건 검토"><h2>여러 목표로 고른 후보 조건</h2><div class="criteria"><b>후보 ${screened.count} / ${screened.total}개 조합</b><p>${screened.settings.limits.map(c=>esc(metrics.find(m=>m.id===c.metric).label)+': '+esc(c.min)+'–'+esc(c.max)+' nm').join('<br>')}<br>모든 범위를 동시에 충족하며 양 끝값을 포함합니다. 경고 조건 제외: ${screened.settings.excludeWarnings?'예':'아니오'}<br>정렬: ${esc(screened.sortLabel)} · ${screened.settings.sort.direction==='asc'?'작은 값부터':'큰 값부터'}, 동률은 조건 번호 순, 계산값 없음은 마지막</p></div><p class="scope">계산한 조합에서 고른 후보입니다. 최적 조건이나 실제 공정 적합성 판정이 아닙니다. 범위 밖 ${screened.excluded.outside} · 지표 없음 ${screened.excluded.unavailable} · 범위를 만족하나 경고로 제외 ${screened.excluded.warnings}개. 실행 기준 조건은 후보 수에 포함하지 않습니다.</p><div class="table-wrap" role="region" aria-label="후보 조건 목록" tabindex="0"><table><thead><tr><th>순서</th><th>조건</th><th>${esc(result.x.label)} (${esc(result.x.unit)})</th><th>${esc(result.y.label)} (${esc(result.y.unit)})</th><th>${esc(screened.sortLabel)} (${esc(screened.sortUnit)})</th><th>경고 수</th></tr></thead><tbody>${screened.candidates.map(c=>{const row=result.rows.find(r=>r.id===c.id);return '<tr><td>'+c.rank+'</td><td>'+esc(c.id)+'</td><td>'+esc(row.x)+'</td><td>'+esc(row.y)+'</td><td>'+esc(amount(c.sortValue))+'</td><td>'+c.warningCount+'</td></tr>';}).join('')||'<tr><td colspan="6">목표를 모두 만족하는 후보가 없습니다.</td></tr>'}</tbody></table></div><h2>모든 조합의 후보 판정 근거</h2><div class="table-wrap" role="region" aria-label="후보 판정 근거" tabindex="0"><table><thead><tr><th>조건</th><th>판정</th><th>근거</th></tr></thead><tbody>${screened.rows.map(r=>'<tr><td>'+esc(r.id)+'</td><td>'+(r.status==='candidate'?'후보':'제외')+'</td><td>'+esc(r.reason)+'</td></tr>').join('')}</tbody></table></div></section>`:'';
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title||result.stepName+' · 공정창 검토')} · STRATUM</title><style>
    :root{font-family:Arial,"Malgun Gothic",sans-serif;color:#203049;background:#e9eceb;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:32px auto;padding:48px;background:#fff}header{border-top:5px solid #203049;padding-top:20px;border-bottom:1px solid #a8b1bd;padding-bottom:24px}.brand{font-size:12px;letter-spacing:2px;font-weight:700;color:#375cf6}h1{font-size:36px;letter-spacing:-1.3px;line-height:1.25;margin:24px 0 16px;overflow-wrap:anywhere}h2{font-size:21px;letter-spacing:-.5px;margin:30px 0 14px}p,dd{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:24px}dt{font-size:11px;color:#52647b}dd{margin:5px 0 0}.note{white-space:pre-wrap;border-left:3px solid #375cf6;padding:12px 18px;background:#f2f5fa}.scope{color:#52647b;font-size:12px;line-height:1.8}.table-wrap{overflow:auto;outline-offset:4px}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}th{text-align:left;background:#f0f3f8;color:#41546d;font-weight:600}th,td{padding:10px;border-bottom:1px solid #dbe1e9;vertical-align:top;line-height:1.6}td{overflow-wrap:anywhere}.results{min-width:850px}.results td:not(:first-child){text-align:right}.results th{white-space:nowrap}.baseline{background:#eff3ff}.warning{border-left:3px solid #a26d1b;padding:10px 15px;margin:12px 0;background:#f9f5eb}.warning p{margin:5px 0;font-size:12px}.warning b{font-size:12px}.metric-note{margin:8px 0;color:#52647b}.criteria{padding:16px 20px;background:#edf4ef;border-left:3px solid #367052}.criteria b{font-size:16px}.recipe-table{min-width:700px}footer{margin-top:36px;padding-top:16px;border-top:2px solid #203049;color:#52647b;font-size:11px}@media(max-width:640px){main{margin:0;padding:24px 16px}h1{font-size:29px}.meta{grid-template-columns:1fr}p,dd{font-size:14px}.scope{font-size:13px}}@page{size:A4 landscape;margin:14mm}@media print{body,main{background:#fff}main{padding:0;margin:0;max-width:none}h1{font-size:29px}.table-wrap{overflow:visible}.results,.recipe-table{min-width:0}table{font-size:10px}th,td{padding:7px}thead{display:table-header-group}tr,.warning{break-inside:avoid}h2{break-after:avoid}.baseline,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><main><header><div class="brand">STRATUM / PROCESS WINDOW</div><h1>${esc(title||result.stepName+' · 공정창 검토')}</h1><p>${esc(result.stepId)} · ${esc(result.stepName)} / ${esc(E.tools[result.tool].name)}</p><dl class="meta"><div><dt>공통 입력</dt><dd>${esc(result.input.waferId)} · ${esc(result.input.title)}<br>${result.input.records.length}개 완료 기록</dd></div><div><dt>독립 계산</dt><dd>${result.x.values.length} × ${result.y.values.length} = ${result.rows.length}개 조건 + 기준 조건 1개<br>이상 조건: ${esc(result.fault)}</dd></div><div><dt>모델 / 생성 시각</dt><dd>${esc(result.modelVersion)}<br>${esc(result.generatedAt)}</dd></div></dl></header>
    ${note?'<p class="note">'+esc(note)+'</p>':''}<p class="scope">${esc(result.notice)}</p><h2>변수 범위와 기준 레시피</h2><p><b>X / ${esc(result.x.label)}</b> · 실제 계산값 ${result.x.values.map(esc).join(', ')} ${esc(result.x.unit)}<br><b>Y / ${esc(result.y.label)}</b> · 실제 계산값 ${result.y.values.map(esc).join(', ')} ${esc(result.y.unit)}</p><p>기준: ${pairs(result.baseRecipe)}</p><p class="scope">변수값은 장비 입력 간격에 맞추어 반올림했습니다. 모든 조건은 같은 공통 입력에서 독립적으로 실행하며 나머지 레시피와 이상 조건을 유지합니다. 범위 사이를 보간하거나 최적점을 추정하지 않습니다.</p>
    ${assessment?`<div class="criteria"><b>${esc(metric.label)} · ${esc(assessment.min)}–${esc(assessment.max)} ${esc(metric.unit)}</b><p>사용자가 설정한 범위이며 양 끝값을 포함합니다. ${assessment.total}개 조건 중 목표 범위 안 ${assessment.inside}개 · 밖 ${assessment.outside}개 · 해당 지표 없음 ${assessment.unavailable}개.<br>기준 조건: ${statusLabel[assessment.baseline]}. 조건 수는 수율 또는 확률이 아닙니다.</p></div>`:'<p class="scope">사용자 목표 범위가 설정되지 않았습니다.</p>'}
    ${screeningReport}
    <h2>전체 조건의 계산 결과</h2><div class="table-wrap" role="region" aria-label="계산 결과 표" tabindex="0"><table class="results"><thead><tr><th>조건</th><th>X (${esc(result.x.unit)})</th><th>Y (${esc(result.y.unit)})</th>${metrics.map(m=>'<th>'+esc(m.label)+'<br>'+esc(m.unit)+'</th>').join('')}<th>시간 s</th><th>경고</th><th>목표 범위</th></tr></thead><tbody>${all.map((row,i)=>`<tr${i===0?' class="baseline"':''}><td>${i===0?'기준':esc(row.id)}</td><td>${esc(row.recipe[result.x.field])}</td><td>${esc(row.recipe[result.y.field])}</td>${metrics.map(m=>'<td>'+esc(amount(row.metrics[m.id]))+'</td>').join('')}<td>${esc(row.seconds)}</td><td>${row.warnings.length}</td><td>${assessment?statusLabel[i===0?assessment.baseline:assessment.rows[i-1].status]:'미설정'}</td></tr>`).join('')}</tbody></table></div>
    ${metrics.map(m=>'<p class="scope metric-note">'+esc(m.label)+': '+esc(m.description)+'</p>').join('')}<h2>조건별 전체 레시피</h2><div class="table-wrap" role="region" aria-label="실행 레시피 표" tabindex="0"><table class="recipe-table"><thead><tr><th>조건</th><th>실행 레시피</th></tr></thead><tbody>${all.map((row,i)=>'<tr><td>'+(i===0?'기준':esc(row.id))+'</td><td>'+pairs(row.recipe)+'</td></tr>').join('')}</tbody></table></div>
    <h2>공정 경고</h2>${all.some(row=>row.warnings.length)?all.flatMap((row,i)=>row.warnings.map(w=>'<article class="warning"><b>'+(i===0?'기준':esc(row.id))+' / '+esc(w.code)+'</b><p>'+esc(w.message)+'</p></article>')).join(''):'<p class="scope">이 조건에서 모델이 반환한 경고가 없습니다. 실제 공정의 적합성 판정은 아닙니다.</p>'}<h2>검토 범위와 재현</h2><p class="scope">대표 단면 4.8 µm의 160개 위치를 계산합니다. 실측 계측 맵이나 제조사 장비의 검증된 내부 설계·운전 조건을 나타내지 않습니다. JSON 패키지는 공통 완료 이력, 전체 레시피, 기준·모든 조건의 결과, 목표 범위와 검토 메모를 포함합니다. 같은 모델 버전에서 SHA-256 체크섬과 전체 재계산을 확인할 수 있습니다. 체크섬은 작성자·출처를 인증하지 않습니다. 이 HTML은 보고서 사본이며 자체적으로 검증을 실행하지 않습니다.</p><footer>STRATUM · CMOS PROCESS WINDOW / ${esc(result.modelVersion)} / ${esc(result.stepId)}</footer></main></body></html>`;
  }
  root.CmosWindowCore=Object.freeze({presets,metrics,describe,preparePreset,run,assess,compareRows,screen,toCSV,toHTML,pack,unpack});
})(typeof window!=='undefined'?window:globalThis);

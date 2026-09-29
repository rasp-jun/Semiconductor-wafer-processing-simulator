/* Portable CMOS experiment review. Checks reproducibility, not source authenticity. */
(function(root){
  'use strict';
  const E=root.FabEngine;
  const SCHEMA='waferflow-cmos-review-v1',COMPARISON='waferflow-fab-comparison-v1';
  const NOTICE='Same completed operation, same uncalibrated geometric model. Draft recipes are excluded. Not measurement data or statistical inference.';
  const trusted=new WeakMap(),faults=['none','dose','uniformity','vacuum'];
  const fail=message=>{throw new Error(message);};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Copy only finite JSON data. Never invoke a getter or inherit an input property.
  // Explicit limits also bound work before an imported file reaches the simulator.
  function jsonCopy(input){
    let nodes=0,characters=0;
    const seen=new Set();
    function copy(value,depth){
      if(++nodes>150000||depth>20)fail('검토 파일의 구조가 너무 크거나 깊습니다.');
      if(value===null||typeof value==='boolean')return value;
      if(typeof value==='number'){if(!Number.isFinite(value))fail('검토 파일에 유한하지 않은 숫자가 있습니다.');return value;}
      if(typeof value==='string'){characters+=value.length;if(value.length>12000||characters>1500000)fail('검토 파일의 텍스트가 너무 깁니다.');return value;}
      if(typeof value!=='object')fail('검토 파일에는 JSON 값만 사용할 수 있습니다.');
      if(seen.has(value))fail('검토 파일에 순환 참조가 있습니다.');
      const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
      if(!array&&proto!==null){
        const constructor=Object.getOwnPropertyDescriptor(proto,'constructor');
        if(Object.getPrototypeOf(proto)!==null||!constructor||!Object.hasOwn(constructor,'value')||typeof constructor.value!=='function'||Object.getOwnPropertyDescriptor(constructor.value,'name')?.value!=='Object')fail('검토 파일의 객체 형식이 올바르지 않습니다.');
      }
      const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
      if(keys.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)))fail('검토 파일에 허용하지 않는 속성이 있습니다.');
      if(array&&(value.length>2000||keys.length!==value.length+1))fail('검토 파일의 배열 형식이나 길이가 올바르지 않습니다.');
      if(!array&&keys.length>100)fail('검토 파일의 객체가 너무 큽니다.');
      seen.add(value);
      const result=array?[]:{};
      for(const key of keys){
        if(array&&key==='length')continue;
        const descriptor=descriptors[key];
        if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||(array&&!/^(0|[1-9]\d*)$/.test(key)))fail('검토 파일에 JSON이 아닌 속성이 있습니다.');
        result[key]=copy(descriptor.value,depth+1);
      }
      seen.delete(value);return result;
    }
    return copy(input,0);
  }
  function shape(value,keys,label){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(label+'의 필수 항목 또는 형식이 올바르지 않습니다.');
  }
  function string(value,max,label){if(typeof value!=='string'||value.length>max)fail(label+'은 '+max+'자 이하의 문자열이어야 합니다.');}
  function timestamp(value,label){
    if(typeof value!=='string')fail(label+'에 날짜와 시간대가 필요합니다.');
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if(!match)fail(label+'에 유효한 ISO 날짜와 시간대가 필요합니다.');
    const [,yr,mo,day,hr,min,sec,fraction,,offsetHr='0',offsetMin='0']=match;
    const year=Number(yr),month=Number(mo),hour=Number(hr),leap=year%4===0&&(year%100!==0||year%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(month<1||month>12||Number(day)<1||Number(day)>days[month-1]||hour>24||Number(min)>59||Number(sec)>59||Number(offsetHr)>23||Number(offsetMin)>59||(hour===24&&(Number(min)!==0||Number(sec)!==0||Number(fraction||0)!==0))||!Number.isFinite(Date.parse(value)))fail(label+'의 날짜가 유효하지 않습니다.');
  }
  function canonical(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  }
  function identical(actual,expected,label){if(canonical(actual)!==canonical(expected))fail(label+'이 완료 기록의 재계산 결과와 일치하지 않습니다.');}
  async function digest(payload){
    if(!root.crypto?.subtle||!root.TextEncoder)fail('SHA-256 검증에는 HTTPS 또는 localhost 연결이 필요합니다.');
    const buffer=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(canonical(payload)));
    return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function recordShape(record,index){
    const step=E.route[index];
    shape(record,['stepId','index','tool','name','recipe','fault','metrics','warnings','seconds','modelVersion','time'],'공정 기록');
    if(record.stepId!==step.id||record.index!==index||record.tool!==step.tool||record.name!==step.name||record.modelVersion!==E.VERSION)fail('공정 기록의 순서·장비·이름·모델 버전이 일치하지 않습니다.');
    if(!faults.includes(record.fault))fail('알 수 없는 이상 조건입니다.');
    shape(record.recipe,Object.keys(E.tools[step.tool].fields),'완료 레시피');
    E.recipeFor(step,record.recipe);
    timestamp(record.time,'공정 실행 시각');
    if(typeof record.seconds!=='number'||record.seconds<0)fail('공정 시간이 올바르지 않습니다.');
    if(!Array.isArray(record.warnings)||record.warnings.length>100)fail('공정 경고 목록이 올바르지 않습니다.');
    for(const warning of record.warnings){
      shape(warning,Object.hasOwn(warning||{},'category')?['code','message','category']:['code','message'],'공정 경고');
      string(warning.code,100,'경고 코드');string(warning.message,2000,'경고 설명');
      if(Object.hasOwn(warning,'category')&&!['model-limit','process-result'].includes(warning.category))fail('알 수 없는 경고 분류입니다.');
    }
  }
  function reconstruct(side,count){
    shape(side,['waferId','title','note','records','metrics'],'비교 웨이퍼');
    if(typeof side.waferId!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(side.waferId))fail('웨이퍼 ID가 올바르지 않습니다.');
    string(side.title,60,'실험 이름');string(side.note,2000,'실험 메모');
    if(!Array.isArray(side.records)||side.records.length!==count)fail('두 웨이퍼의 완료 공정 수와 비교 시점이 일치해야 합니다.');
    side.records.forEach(recordShape);
    const wafer=E.replay(side.waferId,side.records);
    identical(side.records,wafer.records,side.waferId+'의 공정별 결과·경고');
    const metrics=E.summarize(wafer);identical(side.metrics,metrics,side.waferId+'의 구조 지표');
    return wafer;
  }
  function replayComparison(data){
    shape(data,['schema','modelVersion','generatedAt','completedOperations','stepId','reference','current','profile','differences','notice'],'비교 결과');
    if(data.schema!==COMPARISON||data.modelVersion!==E.VERSION)fail('지원하지 않는 비교 형식 또는 모델 버전입니다.');
    timestamp(data.generatedAt,'비교 생성 시각');
    const count=data.completedOperations;
    if(!Number.isInteger(count)||count<0||count>E.route.length||data.stepId!==(count?E.route[count-1].id:null))fail('비교 공정 시점이 올바르지 않습니다.');
    const left=reconstruct(data.reference,count),right=reconstruct(data.current,count);
    if(data.reference.waferId===data.current.waferId)fail('서로 다른 웨이퍼를 비교해야 합니다.');
    const differences=[];
    for(let i=0;i<count;i++){
      const a=left.records[i],b=right.records[i],step=E.route[i];
      for(const [key,field] of Object.entries(E.tools[step.tool].fields))if(a.recipe[key]!==b.recipe[key])differences.push({stepId:step.id,name:step.name,field:key,label:field.label,unit:field.unit,reference:a.recipe[key],current:b.recipe[key]});
      if(a.fault!==b.fault)differences.push({stepId:step.id,name:step.name,field:'fault',label:'이상 조건',unit:'',reference:a.fault,current:b.fault});
    }
    const profile=left.columns.map((column,i)=>({x_nm:(i+.5)*E.WIDTH/E.NX,reference_nm:E.height(column),current_nm:E.height(right.columns[i])}));
    identical(data.profile,profile,'160개 위치의 표면 높이');
    identical(data.differences,differences,'실행 조건 차이');
    if(data.notice!==NOTICE)fail('비교 모델의 적용 범위 설명이 일치하지 않습니다.');
    return {...data,reference:{...data.reference,records:left.records,metrics:E.summarize(left)},current:{...data.current,records:right.records,metrics:E.summarize(right)},profile,differences};
  }
  function remember(pack){trusted.set(pack,canonical(pack));return pack;}
  async function create(input,options={}){
    const settings=jsonCopy(options);
    if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(key=>!['title','note'].includes(key)))fail('검토 제목과 메모 형식이 올바르지 않습니다.');
    const title=Object.hasOwn(settings,'title')?settings.title:'',note=Object.hasOwn(settings,'note')?settings.note:'';
    string(title,100,'검토 제목');string(note,3000,'검토 메모');
    const comparison=replayComparison(jsonCopy(input));
    const payload={modelVersion:E.VERSION,createdAt:new Date().toISOString(),title,note,comparison};
    return remember({schema:SCHEMA,payload,integrity:{algorithm:'SHA-256',digest:await digest(payload)}});
  }
  async function verify(input){
    const pack=jsonCopy(input);
    shape(pack,['schema','payload','integrity'],'검토 패키지');
    if(pack.schema!==SCHEMA)fail('지원하지 않는 검토 패키지 형식입니다.');
    shape(pack.payload,['modelVersion','createdAt','title','note','comparison'],'검토 내용');
    if(pack.payload.modelVersion!==E.VERSION)fail('현재 시뮬레이터와 검토 패키지의 모델 버전이 다릅니다.');
    timestamp(pack.payload.createdAt,'검토 패키지 생성 시각');
    string(pack.payload.title,100,'검토 제목');string(pack.payload.note,3000,'검토 메모');
    shape(pack.integrity,['algorithm','digest'],'파일 체크섬');
    if(pack.integrity.algorithm!=='SHA-256'||typeof pack.integrity.digest!=='string'||!/^[0-9a-f]{64}$/.test(pack.integrity.digest))fail('SHA-256 체크섬 형식이 올바르지 않습니다.');
    if(await digest(pack.payload)!==pack.integrity.digest)fail('파일 체크섬이 일치하지 않습니다. 검토 내용을 다시 내보내세요.');
    const comparison=replayComparison(pack.payload.comparison);
    remember(pack);
    return {package:pack,comparison:jsonCopy(comparison),checks:{checksum:true,model:true,replay:true}};
  }

  function amount(value){
    if(value===null)return '—';
    if(typeof value!=='number')return esc(value);
    return Math.abs(value)>=1e6||(Math.abs(value)>0&&Math.abs(value)<.001)?value.toExponential(3):value.toLocaleString('en-US',{maximumFractionDigits:3});
  }
  // A condition table must retain every executed digit: rounding could hide a
  // real recipe difference even when the JSON package itself remains exact.
  const conditionValue=value=>esc(String(value));
  function plot(comparison){
    const points=comparison.profile,values=points.flatMap(p=>[p.reference_nm,p.current_nm]);
    const low=Math.min(...values),high=Math.max(...values),padding=Math.max(10,(high-low)*.12),min=low-padding,max=high+padding;
    const x=value=>58+value/E.WIDTH*684,y=value=>28+(max-value)/(max-min)*184;
    const path=key=>points.map((p,i)=>(i?'L':'M')+x(p.x_nm).toFixed(3)+','+y(p[key]).toFixed(3)).join(' ');
    return `<svg viewBox="0 0 780 252" role="img" aria-label="기준과 현재 웨이퍼의 표면 높이 비교"><title>단면 4.8 µm · 160개 계산 위치 · 표면 높이 nm</title>${[0,.25,.5,.75,1].map(t=>{const value=min+(max-min)*t;return `<path d="M58 ${y(value)}H742" stroke="#deded7"/><text x="49" y="${y(value)+4}" text-anchor="end">${amount(value)}</text>`;}).join('')}<text x="12" y="15">nm</text><path d="${path('reference_nm')}" fill="none" stroke="#667584" stroke-width="2.5" stroke-dasharray="6 4"/><path d="${path('current_nm')}" fill="none" stroke="#b15b2c" stroke-width="2.5"/>${[0,1.2,2.4,3.6,4.8].map(value=>`<text x="${x(value*1000)}" y="238" text-anchor="middle">${value}</text>`).join('')}<text x="760" y="238">µm</text></svg>`;
  }
  function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>'<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
  function row(values){return '<tr>'+values.map(value=>'<td>'+value+'</td>').join('')+'</tr>';}
  function history(side,label){
    return `<section class="history"><div class="section-heading"><span>기록 부록 · ${label}</span><h2>${esc(side.waferId)} · ${esc(side.title||'이름 없는 실험')}</h2></div>${side.records.length?table(['공정 / 실행 시각','완료 레시피','처리 시간','단차 / 경고'],side.records.map(record=>row([
      `<b>${esc(record.stepId)} · ${esc(record.name)}</b><small class="timestamp">${esc(record.time)}</small>`,
      Object.entries(record.recipe).map(([key,value])=>esc(E.tools[record.tool].fields[key].label)+' '+conditionValue(value)+' '+esc(E.tools[record.tool].fields[key].unit)).join('<br>')+`<small>이상 조건: ${esc(record.fault)}</small>`,
      amount(record.seconds)+' s',amount(record.metrics.topography)+' nm<small>'+esc(record.warnings.map(w=>w.code).join(', ')||'경고 없음')+'</small>'
    ]))):'<p class="quiet">입고 상태 · 완료된 공정 기록이 없습니다.</p>'}</section>`;
  }
  function reportHTML(pack){
    if(!pack||!trusted.has(pack)||trusted.get(pack)!==canonical(jsonCopy(pack)))fail('보고서 생성 전에 검토 패키지를 생성하거나 다시 검증하세요.');
    const p=pack.payload,c=p.comparison,a=c.reference,b=c.current,count=c.completedOperations;
    const gateReady=count>E.route.find(step=>step.name==='폴리 게이트 패턴 식각').index;
    const metrics=[['표면 최대 높이',a.metrics.surfaceMax,b.metrics.surfaceMax,'nm'],['표면 최소 높이',a.metrics.surfaceMin,b.metrics.surfaceMin,'nm'],['표면 최대–최소 단차',a.metrics.topography,b.metrics.topography,'nm'],['폴리 게이트 평균 폭',gateReady?a.metrics.gateCD:null,gateReady?b.metrics.gateCD:null,'nm'],['주입 이력 평균 활성 비율',a.metrics.activation,b.metrics.activation,'%'],['주입 이력 수',a.metrics.implants,b.metrics.implants,'회'],['잔여 오염 지표',a.metrics.particles,b.metrics.particles,'모델 단위'],...Object.keys(E.materials).flatMap(key=>[[key+' 평균 두께',a.metrics.films[key].mean,b.metrics.films[key].mean,'nm'],[key+' 최대 두께',a.metrics.films[key].max,b.metrics.films[key].max,'nm']])];
    const warnings=[...a.records.flatMap(record=>record.warnings.map(warning=>({waferId:a.waferId,record,warning}))),...b.records.flatMap(record=>record.warnings.map(warning=>({waferId:b.waferId,record,warning})))];
    const title=p.title||'CMOS 공정 실험 비교';
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)} · STRATUM</title><style>
      :root{color-scheme:light;font-family:Arial,"Malgun Gothic",sans-serif;color:#273038;background:#e7e7e0}*{box-sizing:border-box}body{margin:0}main{max-width:1040px;margin:36px auto;background:#fcfcf7;padding:54px 60px;box-shadow:0 12px 60px #2222}p{line-height:1.7}h1,h2,p{margin-top:0}h1{font-size:42px;letter-spacing:-1.7px;line-height:1.2;overflow-wrap:anywhere;margin:24px 0 18px}h2{font-size:22px;line-height:1.35;letter-spacing:-.6px}header{border-top:5px solid #273038;border-bottom:1px solid #273038;padding:18px 0 30px}.wordmark{display:flex;justify-content:space-between;font-size:12px;letter-spacing:2px;font-weight:700}.edition{color:#9c4d23}.subtitle,.quiet{color:#61696d;font-size:13px}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0 0}.meta dt{font-size:11px;color:#6b7276;margin-bottom:7px}.meta dd{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.verification{border-left:3px solid #b15b2c;padding:12px 18px;background:#f0eee6;margin:28px 0;font-size:13px;line-height:1.65}.verification b{display:block;margin-bottom:4px}.note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}.experiment{border-top:2px solid #667584;padding-top:13px;min-width:0}.experiment.current{border-color:#b15b2c}.experiment .kicker{font-size:11px;letter-spacing:1px;color:#68747c}.experiment h2{font-size:20px;margin:10px 0 8px;overflow-wrap:anywhere}.experiment p{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;color:#626a6d}.section-heading{margin-top:38px;border-bottom:1px solid #bec1bb;margin-bottom:16px}.section-heading>span{display:block;font-size:10px;letter-spacing:1.6px;color:#8b4929;margin-bottom:9px}.section-heading h2{margin-bottom:14px}.plot{margin:0;border:1px solid #d4d7d0;padding:15px 15px 4px;break-inside:avoid}.plot svg{display:block;width:100%;height:auto}.plot text{font-size:10px;fill:#636b6f}.legend{display:flex;gap:24px;flex-wrap:wrap;font-size:12px;margin-bottom:8px}.legend span:before{content:"";display:inline-block;width:24px;border-top:2px dashed #667584;margin:0 8px 3px 0}.legend span:last-child:before{border-top:2px solid #b15b2c}figcaption{font-size:11px;color:#687076;margin:8px 0 14px;line-height:1.6}.table-wrap{width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums;text-align:left}th{font-size:11px;font-weight:600;background:#eeeee7;color:#505d64;padding:11px 10px;border-bottom:1px solid #c6cbc6}td{padding:10px;vertical-align:top;border-bottom:1px solid #e0e2d9;line-height:1.5;overflow-wrap:anywhere}tr{break-inside:avoid}td:first-child{min-width:130px}small{display:block;font-size:10px;color:#69747a;margin-top:5px}.timestamp{font-family:monospace;overflow-wrap:anywhere}.metric-table td:not(:first-child){text-align:right}.metric-table th:not(:first-child){text-align:right}.warning{border-left:2px solid #b15b2c;padding:10px 15px;margin:10px 0;background:#f4f0e7;break-inside:avoid}.warning b{font-size:12px}.warning p{font-size:12px;margin:5px 0 0}.digest{font:11px/1.7 monospace;overflow-wrap:anywhere;color:#53606a;background:#eeeee8;padding:12px}.scope{font-size:12px;color:#53616a;line-height:1.8}.history table{font-size:10px;table-layout:fixed}.history th:first-child{width:31%}.history th:nth-child(2){width:34%}.history th:nth-child(3){width:12%}.history small{font-size:9px}.history td:first-child{min-width:0}.history .section-heading{break-after:avoid}footer{border-top:2px solid #273038;margin-top:38px;padding-top:15px;display:flex;justify-content:space-between;gap:20px;font-size:10px;color:#69737a}@page{size:A4;margin:15mm}@media print{body,main{background:#fff}main{max-width:none;margin:0;padding:0;box-shadow:none}h1{font-size:30px}.wordmark{font-size:10px}.section-heading{break-after:avoid}.pair{break-inside:avoid}.table-wrap{overflow:visible}thead{display:table-header-group}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.history{break-before:page}.plot{padding:8px}.scope{break-inside:avoid}}@media(max-width:640px){main{margin:0;padding:28px 20px}h1{font-size:32px}.meta{grid-template-columns:1fr}.pair{grid-template-columns:1fr;gap:18px}.wordmark{font-size:10px;letter-spacing:1px}.history table{min-width:680px}}
      </style></head><body><main>
      <header><div class="wordmark"><span>STRATUM / CMOS</span><span class="edition">EXPERIMENT REVIEW</span></div><h1>${esc(title)}</h1><p class="subtitle">완료된 공정 이력으로 두 실험을 재구성한 비교 보고서</p><dl class="meta"><div><dt>공통 비교 시점</dt><dd>${count?esc(c.stepId)+' · '+esc(E.route[count-1].name):'입고 상태'}<br>${count} / ${E.route.length}개 완료</dd></div><div><dt>모델 버전</dt><dd>${esc(p.modelVersion)}<br>160개 위치 · 대표 단면 4.8 µm</dd></div><div><dt>패키지 생성 시각</dt><dd>${esc(p.createdAt)}<br>비교: ${esc(c.generatedAt)}</dd></div></dl></header>
      <div class="verification"><b>파일 체크섬 일치 · 모델 버전 일치 · 두 실험 재계산 일치</b>완료된 레시피로 공정별 결과와 경고, 최종 지표, 160개 위치의 표면 높이를 다시 계산했습니다. 미실행 초안은 포함되지 않습니다.</div>
      ${p.note?`<p class="note">${esc(p.note)}</p>`:''}
      <div class="pair">${[[a,'기준 실험','reference'],[b,'현재 실험','current']].map(([side,label,cls])=>`<section class="experiment ${cls}"><span class="kicker">${label} / ${esc(side.waferId)}</span><h2>${esc(side.title||'이름 없는 실험')}</h2><p>${esc(side.note||'실험 메모 없음')}</p><small>${side.records.length}개 완료 기록 · 처리 시간 합계 ${amount(side.records.reduce((sum,record)=>sum+record.seconds,0))} s</small></section>`).join('')}</div>
      <section><div class="section-heading"><span>01 / SURFACE PROFILE</span><h2>같은 공정 시점의 표면</h2></div><figure class="plot"><div class="legend"><span>기준 ${esc(a.waferId)}</span><span>현재 ${esc(b.waferId)}</span></div>${plot(c)}<figcaption>입고 Si 표면을 높이 0 nm로 표시합니다. 선은 30 nm 간격의 계산 위치를 연결합니다. 실제 웨이퍼 전체의 계측 맵이 아닙니다.</figcaption></figure></section>
      <section><div class="section-heading"><span>02 / EXECUTED CONDITIONS</span><h2>실행 조건 차이 · ${c.differences.length}개 항목</h2></div>${c.differences.length?table(['공정','변수','기준 '+a.waferId,'현재 '+b.waferId],c.differences.map(d=>row([esc(d.stepId)+' · '+esc(d.name),esc(d.label),conditionValue(d.reference)+' '+esc(d.unit),conditionValue(d.current)+' '+esc(d.unit)]))):'<p class="quiet">이 비교 시점까지 완료된 실행 조건이 동일합니다.</p>'}</section>
      <section class="metric-table"><div class="section-heading"><span>03 / CALCULATED STRUCTURE</span><h2>구조 지표와 재료 두께</h2></div>${table(['지표','기준 '+a.waferId,'현재 '+b.waferId,'현재 − 기준'],metrics.map(([label,left,right,unit])=>row([esc(label),amount(left)+' '+esc(unit),amount(right)+' '+esc(unit),amount(left!==null&&right!==null?right-left:null)+' '+esc(unit)])))}<p class="quiet">${!gateReady?'폴리 게이트 패턴 식각 완료 전에는 게이트 폭을 표시하지 않습니다.':'폴리 평균 폭은 각 폴리층이 20 nm를 초과하는 위치를 30 nm 격자로 묶은 평균 폭입니다. 연속 잔막이 있으면 대표 단면 전체인 4,800 nm가 표시될 수 있습니다.'}</p></section>
      <section><div class="section-heading"><span>04 / PROCESS FINDINGS</span><h2>공정 경고 이력 · ${warnings.length}건</h2></div>${warnings.length?warnings.map(({waferId,record,warning})=>`<article class="warning"><b>${esc(waferId)} / ${esc(record.stepId)} · ${esc(record.name)} / ${esc(warning.code)}</b><p>${esc(warning.message)}</p><small>${esc(record.time)}${warning.category?' · '+esc(warning.category):''}</small></article>`).join(''):'<p class="quiet">포함된 완료 기록에서 모델이 반환한 경고가 없습니다. 실제 공정의 적합성 판정은 아닙니다.</p>'}</section>
      <section class="scope"><div class="section-heading"><span>05 / REPRODUCIBILITY & SCOPE</span><h2>재현 범위와 파일 확인</h2></div><p>SHA-256은 정렬된 JSON 키로 직렬화한 payload의 체크섬입니다. 파일 내용의 변경·손상을 확인하며 작성자, 출처 또는 기록 시각의 진위를 인증하지 않습니다. 체크섬을 다시 계산한 수정 파일도 입력과 결과가 일치하면 검증을 통과할 수 있습니다.</p><p class="digest">SHA-256 · ${esc(pack.integrity.digest)}</p><p>이 보고서는 보정되지 않은 기하·축약 공정 모델의 결과입니다. 실측 데이터, 통계적 신뢰구간, TCAD 해석 또는 양산 승인 근거가 아닙니다. 주입 활성 비율·오염 지표 등은 모델 정의에 따르며 전기 특성이나 실제 수율을 예측하지 않습니다. 제조사 장비의 내부 설계 및 운전 조건을 검증한 자료가 아닙니다.</p><p>재검토하려면 함께 내보낸 JSON 패키지를 같은 모델 버전의 STRATUM에서 검증하세요. 이 HTML은 보고서 사본이며 독립적으로 계산이나 파일 검증을 수행하지 않습니다.</p></section>
      ${history(a,'기준')}${history(b,'현재')}<footer><span>STRATUM · CMOS EXPERIMENT REVIEW</span><span>${esc(p.modelVersion)} / ${esc(c.stepId||'INCOMING')}</span></footer></main></body></html>`;
  }
  root.CmosReview=Object.freeze({create,verify,reportHTML});
})(typeof window!=='undefined'?window:globalThis);

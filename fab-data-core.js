/* Read-only, explicit telemetry-to-recipe reduction. Never a hardware controller. */
(function(root){
'use strict';
const E=root.FabEngine,SCHEMA='waferflow-fab-telemetry-v1',VERSION='wf-data-1.0.0';
const fail=m=>{throw Error(m);},obj=x=>x&&typeof x==='object'&&!Array.isArray(x),num=(x,label)=>{if(typeof x!=='number'||!Number.isFinite(x))fail(label+': 유한한 숫자가 필요합니다.');return x;};
function validate(p){
 if(!obj(p)||p.schema!==SCHEMA)fail('지원하지 않는 장비 데이터 형식입니다.');
 if(Object.keys(p).some(k=>!['schema','equipmentId','chamberId','runId','lotId','waferId','tool','startedAt','processStart','processEnd','status','source','channels','samples'].includes(k)))fail('공통 형식에 정의되지 않은 필드가 있습니다.');
 for(const k of ['equipmentId','chamberId','runId','lotId','waferId','tool'])if(typeof p[k]!=='string'||!p[k].trim()||p[k]!==p[k].trim()||p[k].length>100||/[\x00-\x1f]/.test(p[k]))fail(k+': 1–100자 식별자가 필요합니다.');
 if(!Object.hasOwn(E.tools,p.tool))fail('지원하지 않는 장비 모델입니다.');
 if(typeof p.startedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(p.startedAt)||!Number.isFinite(Date.parse(p.startedAt)))fail('startedAt에 시간대가 포함된 ISO 시각이 필요합니다.');
 const [year,month,day]=p.startedAt.slice(0,10).split('-').map(Number);if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())fail('유효하지 않은 시작 날짜입니다.');
 if(!['completed','aborted'].includes(p.status)||!['equipment-export','synthetic'].includes(p.source))fail('status 또는 source를 확인하세요.');
 num(p.processStart,'처리 시작');num(p.processEnd,'처리 종료');if(p.processStart<0||p.processEnd<=p.processStart||p.processEnd>86400)fail('처리 구간은 0–86400초 안의 양수 구간이어야 합니다.');
 if(!obj(p.channels)||Object.keys(p.channels).length<1||Object.keys(p.channels).length>32)fail('채널은 1–32개가 필요합니다.');
 for(const [tag,c] of Object.entries(p.channels))if(!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(tag)||['__proto__','constructor','prototype'].includes(tag)||!obj(c)||Object.keys(c).some(k=>k!=='unit')||typeof c.unit!=='string'||!c.unit||c.unit.length>24)fail('채널명 또는 단위를 확인하세요.');
 if(!Array.isArray(p.samples)||p.samples.length<2||p.samples.length>5000)fail('샘플은 2–5000개가 필요합니다.');
 let prev=-1;
 for(const [i,s] of p.samples.entries()){
  if(!obj(s)||Object.keys(s).some(k=>!['t','quality','values'].includes(k)))fail('샘플 객체의 형식을 확인하세요.');num(s.t,'샘플 시각');if(s.t<0||s.t>86400||s.t<=prev)fail('샘플 시각은 중복 없이 증가해야 합니다.');prev=s.t;
  if(!['good','bad','uncertain'].includes(s.quality)||!obj(s.values))fail('샘플 품질과 값을 확인하세요.');
  if(!Object.keys(s.values).length)fail('빈 샘플입니다.');for(const [tag,v] of Object.entries(s.values)){if(!Object.hasOwn(p.channels,tag))fail('미등록 채널: '+tag);num(v,'샘플 '+i+' / '+tag);}
 }
 if(p.samples[0].t>p.processStart||p.samples.at(-1).t<p.processEnd)fail('샘플이 처리 시작과 종료를 모두 포함해야 합니다.');
 return JSON.parse(JSON.stringify(p));
}
const units={s:['time',1,0],min:['time',60,0],ms:['time',.001,0],'°C':['temperature',1,0],C:['temperature',1,0],K:['temperature',1,-273.15],Pa:['pressure',1,0],kPa:['pressure',1000,0],Torr:['pressure',133.32236842105263,0],mTorr:['pressure',.13332236842105263,0],psi:['pressure',6894.757293168,0],W:['power',1,0],kW:['power',1000,0],rpm:['rotation',1,0],'%':['relative',1,0],keV:['energy',1,0],eV:['energy',.001,0],'°':['angle',1,0],deg:['angle',1,0],'µm':['length',1,0],um:['length',1,0],nm:['length',.001,0],'mJ/cm²':['exposure',1,0],'mJ/cm2':['exposure',1,0],'cm⁻²':['dose',1,0],'1/cm2':['dose',1,0],cycles:['cycles',1,0],sites:['sites',1,0],dies:['dies',1,0]};
function convert(v,from,to){num(v,'환산값');const a=units[from],b=units[to];if(!Object.hasOwn(units,from)||!Object.hasOwn(units,to)||a[0]!==b[0])fail('변환할 수 없는 단위: '+from+' → '+to);const converted=(v*a[1]+a[2]-b[2])/b[1];if(!Number.isFinite(converted))fail('변환 결과가 유한한 숫자가 아닙니다.');return converted;}
function snapBoundary(value,field){const tolerance=4*Number.EPSILON*Math.max(1,Math.abs(value),Math.abs(field.min),Math.abs(field.max));if(value<field.min&&field.min-value<=tolerance)return field.min;if(value>field.max&&value-field.max<=tolerance)return field.max;return value;}
function aggregate(packet,step,mapping,maxGap=5){
 const p=validate(packet);if(p.status!=='completed')fail('중단된 장비 운전은 완료 공정으로 계산할 수 없습니다.');if(step?.tool!==p.tool)fail('선택 공정과 장비 모델이 다릅니다.');
 if(!obj(mapping))fail('태그 매핑이 필요합니다.');num(maxGap,'최대 간격');if(maxGap<=0||maxGap>60)fail('최대 샘플 간격은 0초 초과, 60초 이하여야 합니다.');
 const fields=E.tools[p.tool].fields,recipe={},stats={},used=new Set();
 for(const [key,f] of Object.entries(fields)){
  if(key==='time'){recipe[key]=convert(p.processEnd-p.processStart,'s',f.unit);continue;}
  const tag=mapping[key];if(typeof tag!=='string'||!Object.hasOwn(p.channels,tag))fail(f.label+': 센서 태그를 지정하세요.');if(used.has(tag))fail('같은 태그를 서로 다른 변수에 중복 매핑할 수 없습니다.');used.add(tag);
  const cumulative=['dose','cycles','samples'].includes(key);let area=0,min=Infinity,max=-Infinity,last=null,previous=-Infinity;
  for(let i=0;i<p.samples.length;i++){
   const s=p.samples[i],next=p.samples[i+1],overlap=next?Math.max(0,Math.min(next.t,p.processEnd)-Math.max(s.t,p.processStart)):0;
   const boundary=s.t===p.processEnd;
   if(!overlap&&!boundary)continue;
   if(s.quality!=='good'||(overlap&&next.quality!=='good'))fail('처리 구간의 품질 불량/불확실 샘플은 사용할 수 없습니다.');
   if(overlap&&next.t-s.t>maxGap)fail('허용 간격을 초과한 데이터 공백이 있습니다.');
   if(!Object.hasOwn(s.values,tag))fail('처리 구간에 누락된 태그: '+tag);
   const v=snapBoundary(convert(s.values[tag],p.channels[tag].unit,f.unit),f);
   if(v<0&&f.min>=0)fail(f.label+': 음수 센서 값입니다.');
   if(cumulative){if(v<previous)fail('누적값/개수가 처리 중 감소했습니다: '+tag);previous=v;}
   else if(v<f.min||v>f.max)fail(f.label+': 개별 센서 값이 모델 범위를 벗어났습니다.');
   min=Math.min(min,v);max=Math.max(max,v);area+=v*overlap;if(s.t<=p.processEnd)last=v;
  }
  if(cumulative&&!p.samples.some(s=>s.t===p.processEnd))fail('누적값/개수는 처리 종료 시각의 샘플이 필요합니다.');
  const mean=snapBoundary(area/(p.processEnd-p.processStart),f);recipe[key]=cumulative?last:mean;
  stats[key]={tag,sourceUnit:p.channels[tag].unit,unit:f.unit,min,max,mean,value:recipe[key],method:cumulative?'end-value':'time-weighted-left-hold'};
 }
 for(const key of Object.keys(mapping))if(!Object.hasOwn(fields,key)||key==='time')fail('지원하지 않는 매핑 변수: '+key);
 E.recipeFor(step,recipe);
 return {recipe,stats,processSeconds:p.processEnd-p.processStart,maxGap,unusedChannels:Object.keys(p.channels).filter(k=>!used.has(k))};
}
function simulate(packet,step,mapping,{maxGap=5,history=null,allowReference=false}={}){
 const p=validate(packet),reduced=aggregate(p,step,mapping,maxGap);let input;
 if(history){if(!Array.isArray(history.records)||history.records.length!==step.index)fail('입력 이력은 선택 공정 직전까지 정확히 완료되어야 합니다.');for(let i=0;i<history.records.length;i++){const r=history.records[i],s=E.route[i];if(!Number.isFinite(Date.parse(r.time))||!obj(r.recipe)||Object.keys(E.tools[s.tool].fields).some(k=>!Object.hasOwn(r.recipe,k)))fail('입력 이력에 누락된 실행 조건이 있습니다.');}input=E.replay('DATA',history.records);}
 else {if(step.index&&!allowReference)fail('이전 공정 이력을 넣거나 기준 공정 사용을 명시적으로 선택하세요.');input=E.createWafer('DATA');while(input.cursor<step.index){const next=E.execute(input);if(next.warnings.length)fail('기준 앞 공정에서 경고가 발생했습니다.');input=next.wafer;}}
 const actual=E.execute(input,reduced.recipe),reference=E.execute(input,step.recipe);
 return {schema:'waferflow-fab-data-result-v1',adapterVersion:VERSION,modelVersion:E.VERSION,createdAt:new Date().toISOString(),stepId:step.id,sourceClaim:p.source,sourceVerified:false,inputOrigin:history?'provided-simulation-history':step.index?'reference-simulated-upstream':'reference-silicon-substrate',packet:p,mapping:{...mapping},reduction:reduced,inputRecords:input.records,reference:{recipe:step.recipe,metrics:reference.metrics},result:{recipe:actual.recipe,metrics:actual.metrics,warnings:actual.warnings,records:actual.wafer.records},notice:'센서 입력을 대표 조건으로 축약한 미보정 모델 결과입니다. 시계열의 동적 열·반응 이력을 적분하지 않습니다. 장비 제어·양산 승인 결과가 아닙니다.'};
}
function csvRows(text){
 if(typeof text!=='string'||text.length>1500000)fail('파일은 1.5 MB 이하로 넣으세요.');const rows=[];let row=[],value='',quote=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quote=false;closed=true;}}else value+=c;}else if(c==='"'){if(value||closed)fail('CSV 따옴표 형식 오류');quote=true;}else if(c===','||c==='\n'||c==='\r'){row.push(value);value='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push(row);row=[];}}else{if(closed)fail('CSV 닫는 따옴표 뒤 문자를 확인하세요.');value+=c;}}
 if(quote)fail('CSV 따옴표가 닫히지 않았습니다.');if(value||closed||row.length){row.push(value);rows.push(row);}return rows;
}
function parseCSV(text){
 const rows=csvRows(text.replace(/^\uFEFF/,'')),header=rows.shift(),names=['equipment_id','chamber_id','run_id','lot_id','wafer_id','tool','started_at','process_start_s','process_end_s','t_s','quality','tag','value','unit','source','status'];
 if(!header||new Set(header).size!==header.length||header.length!==names.length||names.some(k=>!header.includes(k)))fail('CSV 헤더가 예제 형식과 다릅니다.');
 let p=null,metadata=null,previous=-1;const readNumber=(s,k)=>{if(s.trim()===''||!Number.isFinite(Number(s)))fail('CSV 숫자 오류: '+k);return Number(s);};
 for(const row of rows){if(row.length!==header.length)fail('CSV 열 수가 다릅니다.');const r=Object.fromEntries(header.map((k,i)=>[k,row[i]])),meta=JSON.stringify(names.filter(k=>!['t_s','quality','tag','value','unit'].includes(k)).map(k=>r[k]));if(metadata&&meta!==metadata)fail('한 파일에 서로 다른 장비 운전이 섞여 있습니다.');metadata=meta;
  p??={schema:SCHEMA,equipmentId:r.equipment_id,chamberId:r.chamber_id,runId:r.run_id,lotId:r.lot_id,waferId:r.wafer_id,tool:r.tool,startedAt:r.started_at,processStart:readNumber(r.process_start_s,'process_start_s'),processEnd:readNumber(r.process_end_s,'process_end_s'),source:r.source,status:r.status,channels:Object.create(null),samples:[]};
  if(!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(r.tag)||['constructor','prototype','__proto__'].includes(r.tag))fail('CSV 태그 이름 오류');
  if(p.channels[r.tag]&&p.channels[r.tag].unit!==r.unit)fail('한 태그의 단위가 바뀌었습니다.');p.channels[r.tag]={unit:r.unit};const t=readNumber(r.t_s,'t_s');if(t<previous)fail('CSV 시간 순서를 확인하세요.');if(t!==previous)p.samples.push({t,quality:r.quality,values:Object.create(null)});previous=t;const sample=p.samples.at(-1);if(!sample||sample.quality!==r.quality||Object.hasOwn(sample.values,r.tag))fail('중복 태그 또는 시각별 품질 불일치');sample.values[r.tag]=readNumber(r.value,'value');
 }
 return validate(p);
}
function example(){return {schema:SCHEMA,equipmentId:'DEMO-CLEAN-01',chamberId:'BATH-A',runId:'DEMO-RUN-001',lotId:'DEMO-LOT',waferId:'W01',tool:'clean',startedAt:'2026-09-21T00:00:00Z',processStart:0,processEnd:90,source:'synthetic',status:'completed',channels:{BathTemperature:{unit:'K'}},samples:Array.from({length:19},(_,i)=>({t:i*5,quality:'good',values:{BathTemperature:331.15+(i%4)}}))};}
root.FabData={SCHEMA,VERSION,validate,convert,aggregate,simulate,parseCSV,example};
})(typeof window!=='undefined'?window:globalThis);

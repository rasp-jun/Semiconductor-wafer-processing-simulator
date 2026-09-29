/* Findings and user-authored follow-up notes never modify calculation or approval state. */
globalThis.PilotReview=(()=>{
 function findings(report,row){return [...row.issues,...(report.spc.signals?.includes(row.runId)?['검증 잔차 관리한계 이탈']:[]),...(report.spc.baselineSignals?.includes(row.runId)?['기준 잔차 관리한계 이탈']:[]),...(Number.isFinite(row.residual)&&Math.abs(row.residual)>report.profile.acceptance.maxError?['개별 최대 허용 오차 초과']:[])];}
 function select(report,{filter='all',query=''}={}){const q=query.trim().toLowerCase();return report.rows.filter(r=>(!q||[r.runId,r.lotId,r.waferId].some(v=>String(v??'').toLowerCase().includes(q)))&&(filter==='all'||filter==='rejected'&&r.state==='rejected'||filter==='missing'&&r.state==='calculated'||filter==='alarm'&&(report.spc.signals?.includes(r.runId)||report.spc.baselineSignals?.includes(r.runId)||Number.isFinite(r.residual)&&Math.abs(r.residual)>report.profile.acceptance.maxError||report.chronologyConflicts?.some(pair=>pair.includes(r.index)))));}
 function note(raw){if(!raw||!Number.isInteger(raw.rowIndex)||raw.rowIndex<1||raw.rowIndex>100||!['open','investigating','resolved'].includes(raw.status))throw Error('조치 대상 또는 상태가 올바르지 않습니다.');for(const [k,max]of [['owner',100],['action',2000]])if(typeof raw[k]!=='string'||raw[k].length>max)throw Error('담당자 또는 조치 내용 길이를 확인하세요.');if(raw.status!=='open'&&(!raw.owner.trim()||!raw.action.trim()))throw Error('조사 중·조치 기록 완료에는 담당자와 조치 내용이 필요합니다.');if(raw.recordedAt!==undefined&&(typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt))||new Date(raw.recordedAt).toISOString()!==raw.recordedAt))throw Error('조치 기록 시각이 올바르지 않습니다.');return {rowIndex:raw.rowIndex,status:raw.status,owner:raw.owner.trim(),action:raw.action.trim(),...(raw.recordedAt?{recordedAt:raw.recordedAt}:{})};}
 function reviewPackage(raw){
  if(!raw||raw.schema!=='waferflow-pilot-package-v1'||!raw.input||typeof raw.input!=='object'||Array.isArray(raw.input))throw Error('검토 패키지의 입력 객체가 올바르지 않습니다.');
  const profile=FabPilot.profile(raw.input.profile),batch=raw.input.batch;
  if(!batch||batch.schema!=='waferflow-pilot-batch-v1'||!Array.isArray(batch.runs)||batch.runs.length<1||batch.runs.length>100)throw Error('패키지 운전 묶음은 1–100건이어야 합니다.');
  if(raw.inputSha256!==undefined&&(typeof raw.inputSha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.inputSha256)))throw Error('패키지 입력 해시 형식이 올바르지 않습니다.');
  if(raw.notes!==undefined&&(typeof raw.notes!=='string'||raw.notes.length>10000))throw Error('검토 메모는 10,000자 이하의 문자열이어야 합니다.');
  const notes=raw.caseNotes===undefined?[]:raw.caseNotes;
  if(!Array.isArray(notes)||notes.length>100)throw Error('운전 조치 기록 형식이 올바르지 않습니다.');
  const caseNotes=notes.map(note);
  if(new Set(caseNotes.map(n=>n.rowIndex)).size!==caseNotes.length||caseNotes.some(n=>n.rowIndex>batch.runs.length))throw Error('운전 조치 기록 대상이 중복되거나 없습니다.');
  const sources=raw.sourceFiles===undefined?[]:raw.sourceFiles;
  if(!Array.isArray(sources))throw Error('원본 파일 출처 목록이 올바르지 않습니다.');
  const sourceFiles=sources.map(file=>{if(!file||!['profile','batch','package'].includes(file.kind)||typeof file.name!=='string'||!file.name||file.name.length>500||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||file.hashKind!=='original-file-bytes')throw Error('원본 파일 이름·종류·해시를 확인하세요.');return {kind:file.kind,name:file.name,sha256:file.sha256,hashKind:file.hashKind,verification:'imported-declaration'};});
  return {input:{profile,batch:JSON.parse(JSON.stringify(batch))},caseNotes,notes:raw.notes??'',sourceFiles};
 }
 function compare(report,leftIndex,rightIndex){
  if(leftIndex===rightIndex)throw Error('서로 다른 운전을 선택하세요.');
  const left=report.rows.find(r=>r.index===leftIndex),right=report.rows.find(r=>r.index===rightIndex);
  if(!left?.simulation||!right?.simulation||left.state==='rejected'||right.state==='rejected')throw Error('계산이 완료된 운전 두 건이 필요합니다.');
  const a=left.simulation,b=right.simulation;
  if(a.modelVersion!==b.modelVersion||a.adapterVersion!==b.adapterVersion||a.stepId!==b.stepId)throw Error('공정 또는 모델 버전이 달라 비교할 수 없습니다.');
  const inputs=Object.keys(a.reduction.recipe).map(key=>{const av=a.reduction.recipe[key],bv=b.reduction.recipe[key],sa=a.reduction.stats[key],sb=b.reduction.stats[key];if(!Number.isFinite(av)||!Number.isFinite(bv)||!!sa!==!!sb||sa&&(sa.unit!==sb.unit||sa.method!==sb.method))throw Error('입력 변수의 단위 또는 축약 방식이 다릅니다.');return {key,unit:sa?.unit??FabEngine.tools[report.profile.tool].fields[key].unit,left:av,right:bv,delta:bv-av,leftRange:sa?[sa.min,sa.max]:null,rightRange:sb?[sb.min,sb.max]:null,method:sa?.method??'process-duration'};});
  const differences=[];
  if(left.lotId!==right.lotId)differences.push('서로 다른 LOT입니다.');
  if(left.inputOrigin!==right.inputOrigin||JSON.stringify(a.inputRecords.map(r=>r.recipe))!==JSON.stringify(b.inputRecords.map(r=>r.recipe)))differences.push('앞 공정 입력 조건 또는 입력 출처가 다릅니다.');
  if(!inputs.some(x=>x.delta!==0))differences.push('대표 입력값이 같습니다. 실측 차이를 현재 모델 입력만으로 설명할 수 없습니다.');
  if(report.chronologyConflicts?.some(pair=>pair.includes(leftIndex)||pair.includes(rightIndex)))differences.push('선택 운전의 처리 구간 중첩을 먼저 확인하세요.');
  const pair=(x,y)=>({left:Number.isFinite(x)?x:null,right:Number.isFinite(y)?y:null,delta:Number.isFinite(x)&&Number.isFinite(y)?y-x:null});
  return {schema:'waferflow-pilot-comparison-v1',direction:'right-minus-left',leftIndex,rightIndex,leftRunId:left.runId,rightRunId:right.runId,profile:report.profile,inputs,predicted:pair(left.predicted,right.predicted),measured:pair(left.measured,right.measured),residual:pair(left.residual,right.residual),differences,notice:'차이는 오른쪽 − 왼쪽입니다. 관측된 차이를 비교하며 원인이나 레시피 변경 효과를 입증하지 않습니다.'};
 }
 function trace(row,key){const s=row.simulation,stat=s?.reduction.stats[key];if(!stat)return [];const p=s.packet,start=p.processStart,end=p.processEnd,raw=p.samples.filter(x=>x.t<=end),before=raw.filter(x=>x.t<=start).at(-1);if(!before)throw Error('처리 시작 경계를 재현할 수 없습니다.');const point=x=>({t:x.t-start,value:FabData.convert(x.values[stat.tag],stat.sourceUnit,stat.unit)});const points=[{...point(before),t:0},...raw.filter(x=>x.t>start).map(point)];if(points.at(-1).t<end-start)points.push({t:end-start,value:points.at(-1).value});return points;}
 function csv(report,options={}){
  const cell=x=>{if(typeof x==='number')return Number.isFinite(x)?String(x):'';let s=String(x??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const header=['row','run_id','lot_id','wafer_id','role','state','metric','unit','predicted','measured','residual','findings','profile_id','profile_revision','model_version'];
  const rows=select(report,options).map(r=>[r.index,r.runId,r.lotId,r.waferId,r.role,r.state,report.profile.metricPath,report.profile.metricUnit,r.predicted,r.measured,r.residual,findings(report,r).join(' / '),report.profile.id,report.profile.revision,report.profile.modelVersion]);
  return '\uFEFF'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 return {findings,select,note,reviewPackage,compare,trace,csv};
})();

/* Independent, disposable comparison experiments. No application or storage writes. */
(function(root){
  'use strict';
  const E=root.FabEngine;
  if(!E)throw new Error('FabEngine must be loaded before review examples.');
  const definitions=[
    {id:'oxidation-time',title:'산화 시간을 두 배로',kicker:'01 / THERMAL OXIDATION',description:'동일한 게이트 전처리 상태에서 산화 시간만 바꿔 산화막과 표면 높이를 비교합니다.',name:'게이트 산화막 성장',after:8.4},
    {id:'gate-etch-time',title:'식각 종료 시점의 차이',kicker:'02 / GATE ETCH',description:'폴리 게이트 식각 시간을 줄여 남은 폴리와 패턴 폭을 비교합니다. 잔막과 폭을 함께 확인하세요.',name:'폴리 게이트 패턴 식각',after:50},
    {id:'cmp-time',title:'평탄화에 필요한 시간',kicker:'03 / ILD PLANARIZATION',description:'동일한 ILD 증착 상태에서 연마 시간을 줄여 표면 단차와 절연막 두께를 비교합니다.',name:'ILD 평탄화',after:70}
  ];
  const list=Object.freeze(definitions.map(definition=>{
    const step=E.route.find(item=>item.name===definition.name);
    if(!step)throw new Error('예제 공정을 찾을 수 없습니다: '+definition.name);
    const field=E.tools[step.tool].fields.time;
    E.recipeFor(step,{time:definition.after});
    return Object.freeze({id:definition.id,title:definition.title,kicker:definition.kicker,description:definition.description,parameter:'time',parameterLabel:field.label,before:step.recipe.time,after:definition.after,unit:field.unit,stepId:step.id});
  }));
  function abortIfNeeded(signal){
    if(!signal?.aborted)return;
    const error=new Error('예제 계산을 취소했습니다.');error.name='AbortError';throw error;
  }
  const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function run(id,{signal,onProgress}={}){
    const example=list.find(item=>item.id===id);
    if(!example)throw new Error('지원하지 않는 비교 예제입니다.');
    if(onProgress!==undefined&&typeof onProgress!=='function')throw new TypeError('진행률 콜백은 함수여야 합니다.');
    abortIfNeeded(signal);
    const step=E.route.find(item=>item.id===example.stepId),total=step.index+2;
    let completed=0,prefix=E.createWafer('EXAMPLE-PREP');
    const progress=()=>{abortIfNeeded(signal);onProgress?.({completed,total});abortIfNeeded(signal);};
    progress();
    // Let the caller paint its progress/cancel controls before the first calculation.
    await yieldTask();abortIfNeeded(signal);
    while(prefix.cursor<step.index){
      prefix=E.execute(prefix).wafer;completed++;progress();
      if(completed%6===0){await yieldTask();abortIfNeeded(signal);}
    }
    // Both branches inherit the exact same completed records and geometry.
    const aInput=E.copy(prefix),bInput=E.copy(prefix);
    aInput.id='EXAMPLE-A';bInput.id='EXAMPLE-B';
    const a=E.execute(aInput,{[example.parameter]:example.before}).wafer;
    completed++;progress();
    await yieldTask();abortIfNeeded(signal);
    const b=E.execute(bInput,{[example.parameter]:example.after}).wafer;
    completed++;progress();
    const field=E.tools[step.tool].fields[example.parameter];
    return {
      schema:'waferflow-fab-comparison-v1',modelVersion:E.VERSION,generatedAt:new Date().toISOString(),completedOperations:step.index+1,stepId:step.id,
      reference:{waferId:a.id,title:example.title+' · 기준',note:'내장 예제 / '+field.label+' '+example.before+' '+field.unit+' / 공통 입력 이력에서 실행',records:E.copy(a.records),metrics:E.summarize(a)},
      current:{waferId:b.id,title:example.title+' · 변경',note:'내장 예제 / '+field.label+' '+example.after+' '+field.unit+' / 공통 입력 이력에서 단일 변수 변경',records:E.copy(b.records),metrics:E.summarize(b)},
      profile:a.columns.map((column,i)=>({x_nm:(i+.5)*E.WIDTH/E.NX,reference_nm:E.height(column),current_nm:E.height(b.columns[i])})),
      differences:[{stepId:step.id,name:step.name,field:example.parameter,label:field.label,unit:field.unit,reference:example.before,current:example.after}],
      notice:'Same completed operation, same uncalibrated geometric model. Draft recipes are excluded. Not measurement data or statistical inference.'
    };
  }
  root.CmosReviewExamples=Object.freeze({list,run});
})(typeof window!=='undefined'?window:globalThis);

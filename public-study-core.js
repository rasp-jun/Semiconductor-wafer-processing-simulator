'use strict';
globalThis.PublicStudy = (() => {
  function predict(model, features) {
    const n=model.coefficients?.length;
    if (!n || ![features,model.mean,model.scale,model.trainMinimum,model.trainMaximum].every(a=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite)) || !model.coefficients.every(Number.isFinite) || !Number.isFinite(model.intercept) || model.scale.some(x=>x<=0)) throw Error('모델 또는 입력 특성이 올바르지 않습니다.');
    const depth=model.intercept+features.reduce((s,x,i)=>s+(x-model.mean[i])/model.scale[i]*model.coefficients[i],0);
    if (!Number.isFinite(depth)) throw Error('계산 결과가 유한하지 않습니다.');
    return {depthUm:depth,outsideTraining:features.filter((x,i)=>x<model.trainMinimum[i]||x>model.trainMaximum[i]).length};
  }
  function scores(actual,predicted) {
    if (!actual.length || actual.length!==predicted.length || ![...actual,...predicted].every(Number.isFinite)) throw Error('검증값이 올바르지 않습니다.');
    const e=actual.map((x,i)=>Math.abs(x-predicted[i]));
    return {maeUm:e.reduce((s,x)=>s+x,0)/e.length,rmseUm:Math.sqrt(e.reduce((s,x)=>s+x*x,0)/e.length),maxAbsErrorUm:Math.max(...e)};
  }
  return {predict,scores};
})();

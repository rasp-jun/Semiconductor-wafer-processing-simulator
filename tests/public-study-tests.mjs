import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
export function runPublicStudyTests(root){
  const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(root+'/public-study-core.js','utf8'),ctx);
  const api=ctx.PublicStudy,b=JSON.parse(fs.readFileSync(root+'/public-data/spts-study.json','utf8')),tests=[];
  const check=(name,fn)=>{fn();tests.push({name,status:'passed'});};const near=(a,c)=>assert.ok(Math.abs(a-c)<1e-9,`${a} != ${c}`);
  check('Every browser prediction reproduces independent NumPy ridge output',()=>b.records.forEach(r=>near(api.predict(b.model,r.features).depthUm,r.predictedDepthUm)));
  const train=b.records.filter(r=>r.split==='train'),test=b.records.filter(r=>r.split==='test');
  check('Chronological holdout has no date overlap',()=>{assert.equal(train.length,65);assert.equal(test.length,10);assert.ok(train.every(r=>r.day<b.validation.testDay));assert.ok(test.every(r=>r.day===b.validation.testDay));});
  check('Normalization and baseline use training rows only',()=>{near(b.model.intercept,train.reduce((s,r)=>s+r.measuredDepthUm,0)/train.length);b.model.mean.forEach((m,i)=>{near(m,train.reduce((s,r)=>s+r.features[i],0)/train.length);const sd=Math.sqrt(train.reduce((s,r)=>s+(r.features[i]-m)**2,0)/train.length);near(b.model.scale[i],sd<1e-12?1:sd);});});
  check('Holdout metrics and constant baseline recompute',()=>{const actual=test.map(r=>r.measuredDepthUm),s=api.scores(actual,test.map(r=>api.predict(b.model,r.features).depthUm)),c=api.scores(actual,test.map(()=>b.model.intercept));for(const k of Object.keys(s)){near(s[k],b.validation.heldOut[k]);near(c[k],b.validation.constantBaseline[k]);}});
  check('Targets are nine-point measurements, features are sensor-only',()=>{assert.equal(b.features.length,36);assert.ok(b.features.every(f=>f.tag.startsWith('Stat3_Etch_MV_')));b.records.forEach(r=>{assert.equal(r.measurementSites.length,9);near(r.measuredDepthUm,r.measurementSites.reduce((s,p)=>s+p.siEtchUm,0)/9);assert.ok(r.trace.t.every((t,i)=>i===0?t===0:t>r.trace.t[i-1]));});});
  check('Source provenance, exclusions and physical mapping block are retained',()=>{assert.equal(b.source.files.length,4);assert.ok(b.source.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));assert.equal(b.audit.sourceGroups,b.records.length+b.audit.excluded.length);assert.ok(b.audit.physicalModelConnection.startsWith('blocked:'));assert.equal(b.source.license,'CC-BY-4.0');});
  check('Malformed features and model rejected',()=>{assert.throws(()=>api.predict(b.model,[1]));const f=[...train[0].features];f[0]=NaN;assert.throws(()=>api.predict(b.model,f));assert.throws(()=>api.predict({...b.model,scale:b.model.scale.map(()=>0)},train[0].features));assert.throws(()=>api.scores([],[]));});
  check('Out-of-training values are reported',()=>{const f=b.model.trainMaximum.map(x=>x+1);assert.equal(api.predict(b.model,f).outsideTraining,f.length);});
  return {passed:tests.length,failed:0,tests};
}

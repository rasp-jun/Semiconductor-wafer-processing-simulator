/* Read-only observation snapshots always derive from the pre-process wafer. */
(function(root){
 'use strict';const E=root.FabEngine;
 function inspect(before,step,recipe,fault,percent){
  if(!Number.isFinite(percent)||percent<0||percent>100)throw Error('관찰 시점은 0–100%여야 합니다.');
  const family=E.tools[step.tool].family,duration=root.FabViewport.playback(family,0).seconds,elapsed=duration*percent/100,timeline=root.FabViewport.playback(family,elapsed),fraction=root.FabViewport.reactionProgress(family,timeline.phase,timeline.progress);
  const result=fraction===0?{wafer:E.copy(before),warnings:[]}:E.process(before,step,recipe,fraction,fault);
  return {elapsed,timeline,fraction,wafer:result.wafer,warnings:result.warnings};
 }
 function changes(before,after){
  if(before.columns.length!==after.columns.length)throw Error('단면 격자가 다릅니다.');
  const amounts=column=>{const out=Object.create(null);for(const l of column)out[l.material]=(out[l.material]||0)+l.nm;return out;};
  return before.columns.map((column,i)=>{const a=amounts(column),b=amounts(after.columns[i]),materials=[...new Set([...Object.keys(a),...Object.keys(b)])].map(material=>({material,before:a[material]||0,after:b[material]||0,delta:(b[material]||0)-(a[material]||0)})).filter(x=>Math.abs(x.delta)>1e-6),added=materials.reduce((s,x)=>s+Math.max(0,x.delta),0),removed=materials.reduce((s,x)=>s+Math.max(0,-x.delta),0);return {index:i,materials,added,removed,kind:added&&removed?'mixed':added?'added':removed?'removed':'same'};});
 }
 function profile(before,after,material,presentOnly=false){
  if(!Object.hasOwn(E.materials,material)||before.columns.length!==E.NX||after.columns.length!==E.NX)throw Error('재료 또는 단면 격자가 올바르지 않습니다.');
  const sum=column=>column.reduce((s,l)=>s+(l.material===material?l.nm:0),0),points=before.columns.map((column,i)=>{const a=sum(column),b=sum(after.columns[i]);return {index:i,xNm:(i+.5)*E.WIDTH/E.NX,before:a,after:b,delta:b-a};});
  function statistics(key){const all=points.map(p=>p[key]),values=presentOnly?all.filter(x=>x>0):all,n=values.length;if(!n)return {count:0,occupied:0,mean:null,min:null,max:null,sd:null};const mean=values.reduce((s,x)=>s+x,0)/n;return {count:n,occupied:all.filter(x=>x>0).length,mean,min:Math.min(...values),max:Math.max(...values),sd:Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/n)};}
  return {material,scope:'representative 4.8 um cross-section, not full-wafer metrology',unit:'nm',presentOnly,points,before:statistics('before'),after:statistics('after')};
 }
 function dopingBands(wafer){
  const bands=[];if(!wafer.dopants.length)return bands;
  // Sample every lateral grid column. Only identical neighboring display cells
  // may share a rectangle; a gate edge or a different Si surface breaks the run.
  for(let depth=0;depth<E.BASE;depth+=30){
   let previous=null;
   for(let i=0;i<E.NX;i++){
    const silicon=wafer.columns[i].find(l=>l.material==='Si'),thickness=Math.min(30,(silicon?.nm||0)-depth,E.BASE-depth);
    if(thickness<=0){previous=null;continue;}
    const net=E.dopingAt(wafer,i,depth+thickness/2),opacity=Math.min(.7,Math.max(0,(Math.log10(Math.abs(net))-15)/5));
    if(opacity<=.02){previous=null;continue;}
    const topNm=silicon.nm-E.BASE-depth,bottomNm=topNm-thickness,type=net>0?'n':'p';
    if(previous&&previous.end===i&&previous.topNm===topNm&&previous.bottomNm===bottomNm&&previous.type===type&&previous.opacity===opacity)previous.end=i+1;
    else {previous={start:i,end:i+1,topNm,bottomNm,type,opacity};bands.push(previous);}
   }
  }
  return bands;
 }
 function polyObservation(wafer){
  const thresholdNm=20,thin=[];
  wafer.columns.forEach((column,index)=>{
   const layers=column.filter(layer=>layer.material==='Poly'&&layer.nm>0);
   if(layers.length&&!layers.some(layer=>layer.nm>thresholdNm))thin.push({index,thicknessNm:layers.reduce((sum,layer)=>sum+layer.nm,0)});
  });
  return {thresholdNm,thinSites:thin.length,maxThinNm:thin.length?Math.max(...thin.map(site=>site.thicknessNm)):0};
 }
 root.FabObserve={inspect,changes,profile,dopingBands,polyObservation};
})(typeof window!=='undefined'?window:globalThis);

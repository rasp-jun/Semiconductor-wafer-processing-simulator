(function(root){
  'use strict';
  const E=root.FabEngine, esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(value,digits=2)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
  const signed=value=>(value>0?'+':'')+number(value,3);
  function mount({getComparison,pause}){
    const dialog=document.querySelector('#reviewDialog');if(!dialog)return;
    const $=selector=>dialog.querySelector(selector), content=$('#reviewContent'),status=$('#reviewStatus');
    let sequence=0,controller=null,review=null,origin='',chartMode='height',probe=80,busy=false,titleDraft=null,noteDraft=null;
    const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('error',error);};
    const download=(name,type,text)=>{const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
    function stop(){sequence++;controller?.abort();controller=null;busy=false;dialog.removeAttribute('aria-busy');}
    function home(){
      stop();review=null;origin='';titleDraft=null;noteDraft=null;$('#reviewHome').hidden=true;$('#reviewExports').hidden=true;
      content.innerHTML=`<section class="review-welcome"><span class="review-overline">STRATUM / EXPERIMENT REVIEW</span><h3>조건의 차이를,<br><em>설명 가능한 결과로.</em></h3><p>같은 공정, 다른 조건. 두 실험의 실행 이력과 구조 변화를 한 장면에서 읽고 검토 자료로 남기세요.</p><div class="review-entry"><div><span class="review-overline">YOUR EXPERIMENT</span><h4>작업 중인 실험 비교</h4><p id="reviewCurrentHint"></p></div><button id="reviewCapture" type="button">현재 비교 가져오기 <span aria-hidden="true">↗</span></button></div></section><section class="review-examples" aria-labelledby="reviewExamplesTitle"><div class="review-section-heading"><span class="review-overline">THREE CONTROLLED STUDIES</span><h4 id="reviewExamplesTitle">한 가지 조건으로 시작하는 실험</h4><p>계산 예제 · 현재 작업에 추가되지 않습니다.</p></div>${root.CmosReviewExamples.list.map((item,i)=>`<button class="review-example" data-review-example="${esc(item.id)}" type="button"><span class="review-example-index">0${i+1}</span><span class="review-example-copy"><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small></span><span class="review-example-setting"><small>${esc(item.parameterLabel||item.parameter)} · ${esc(item.stepId)}</small><b>${number(item.before)} <i>→</i> ${number(item.after)} <small>${esc(item.unit)}</small></b></span><span class="review-example-arrow" aria-hidden="true">↗</span></button>`).join('')}</section><div class="review-import"><span>전달받은 검토 패키지가 있나요?</span><button id="reviewImport" type="button">파일 열고 재계산 확인 ↗</button><p>현재 웨이퍼를 바꾸지 않고 JSON 패키지를 검토합니다.</p></div>`;
      const data=getComparison();$('#reviewCapture').disabled=!data;
      $('#reviewCurrentHint').textContent=data?`${data.reference.waferId} ↔ ${data.current.waferId} · ${data.completedOperations}개 공통 완료 공정. 가져오는 순간의 완료 기록을 보관합니다.`:'웨이퍼 두 개를 준비한 뒤 결과 · 비교에서 기준과 공정 시점을 선택하세요.';
      setStatus('완료 기록 → 동일 시점 비교 → 재계산 확인 → 검토 자료');
    }
    function progress(message){
      busy=true;dialog.setAttribute('aria-busy','true');$('#reviewHome').hidden=false;$('#reviewExports').hidden=true;
      content.innerHTML=`<div class="review-loading"><span class="review-overline">COMPUTING THE EVIDENCE</span><h3>${esc(message)}</h3><p>실행 조건으로 웨이퍼 구조를 다시 계산하고 있습니다.</p><progress id="reviewProgress" max="1" value="0" aria-label="비교 계산 진행"></progress><span id="reviewProgressText" role="status">계산 준비 중</span><button id="reviewCancel" type="button">계산 취소</button></div>`;
      setStatus('계산 중 · 현재 작업의 실행 이력은 유지됩니다.');
    }
    async function task(message,operation){
      stop();review=null;titleDraft=null;noteDraft=null;const token=sequence;controller=new AbortController();const signal=controller.signal;
      progress(message);
      try{
        await new Promise(resolve=>setTimeout(resolve,30));if(token!==sequence)return;
        const result=await operation(signal,token);if(token!==sequence||!dialog.open)return;
        review=result.package;origin=result.origin;chartMode='height';probe=Math.floor(E.NX/2);busy=false;dialog.removeAttribute('aria-busy');render();
      }catch(error){if(token!==sequence||error.name==='AbortError')return;home();setStatus('확인하지 못했습니다: '+error.message,true);}
    }
    async function capture(){
      const data=getComparison();if(!data){home();return;}
      await task('현재 비교를 검토 자료로 준비합니다.',async()=>({package:await root.CmosReview.create(data,{title:(data.current.title||data.current.waferId)+' / 조건 비교',note:''}),origin:'현재 작업에서 가져온 완료 기록'}));
    }
    async function example(id){
      const item=root.CmosReviewExamples.list.find(x=>x.id===id);if(!item)return;
      await task(item.title+'을 계산합니다.',async(signal,token)=>{
        const data=await root.CmosReviewExamples.run(id,{signal,onProgress:({completed,total})=>{if(token!==sequence)return;$('#reviewProgress').max=total;$('#reviewProgress').value=completed;$('#reviewProgressText').textContent=`${completed} / ${total} 공정 계산`;}});
        if(signal.aborted)throw new DOMException('계산 취소','AbortError');
        return {package:await root.CmosReview.create(data,{title:item.title+' · 조건 비교',note:item.description}),origin:'독립 계산 예제 · 현재 작업과 별도로 생성'};
      });
    }
    function rows(data){
      const a=data.reference.metrics,b=data.current.metrics,gate=data.completedOperations>E.route.find(s=>s.name==='폴리 게이트 패턴 식각').index;
      return [['표면 최대–최소 단차',a.topography,b.topography,'nm'],...(gate?[['폴리 게이트 평균 폭',a.gateCD,b.gateCD,'nm']]:[]),['주입 평균 활성 비율',a.activation,b.activation,'%'],...Object.keys(E.materials).filter(key=>key!=='Si'&&(a.films[key].mean>0||b.films[key].mean>0)).map(key=>[key+' 평균 두께',a.films[key].mean,b.films[key].mean,'nm'])];
    }
    function render(){
      const p=review.payload,data=p.comparison,a=data.reference,b=data.current,warnings=[a,b].reduce((sum,side)=>sum+side.records.reduce((n,r)=>n+r.warnings.length,0),0);
      $('#reviewHome').hidden=false;$('#reviewExports').hidden=false;
      content.innerHTML=`<section class="review-document-heading"><div><span class="review-overline">PAIRED PROCESS STUDY / ${esc(data.stepId||'INCOMING')}</span><label class="review-title-label" for="reviewTitleInput">검토 제목</label><input id="reviewTitleInput" class="review-title-input" maxlength="100" value="${esc(p.title)}"><p>${esc(origin)} · 가져온 시점의 기록을 검토합니다.</p></div><div class="review-seal"><span>REPLAY</span><strong>확인 완료</strong><small>동일 모델의 계산 일치</small></div></section><div class="review-checkline"><span>✓ 파일 체크섬</span><span>✓ 모델 버전</span><span>✓ 양쪽 이력 재계산</span><small>${esc(p.modelVersion)}</small></div><div class="review-pair"><div class="review-side reference"><span>A / 기준 실험</span><strong>${esc(a.title||a.waferId)}</strong><small>${esc(a.waferId)}</small></div><div class="review-checkpoint"><b>${data.completedOperations}</b><span>동일 완료 공정</span></div><div class="review-side current"><span>B / 비교 실험</span><strong>${esc(b.title||b.waferId)}</strong><small>${esc(b.waferId)}</small></div></div><section class="review-profile-section"><div class="review-section-heading"><span class="review-overline">01 / SURFACE SIGNATURE</span><h4>조건이 남긴 표면</h4><div class="review-chart-switch" role="group" aria-label="검토 그래프 표시"><button data-review-chart="height" type="button" aria-pressed="true">높이 비교</button><button data-review-chart="delta" type="button" aria-pressed="false">차이만 보기</button></div></div><div id="reviewProfile" tabindex="0" role="group" aria-label="표면 비교 그래프. 좌우 방향키로 위치 탐색" aria-describedby="reviewProbe"></div><div class="review-profile-foot"><div class="review-profile-legend"><span>A 기준</span><span>B 비교</span></div><output id="reviewProbe" aria-live="polite"></output></div><p class="review-chart-note">4.8 µm 대표 단면 · 160개 위치 · 마우스 또는 방향키로 위치별 계산값 확인</p></section><div class="review-findings"><section><div class="review-section-heading"><span class="review-overline">02 / RECIPE DIFFERENCE</span><h4>변경한 실행 조건 <small>${data.differences.length}</small></h4></div><div class="review-table-scroll">${data.differences.length?`<table><thead><tr><th>공정 / 조건</th><th>A 기준</th><th>B 비교</th></tr></thead><tbody>${data.differences.map(d=>`<tr><td><small>${esc(d.stepId)} · ${esc(d.name)}</small><strong>${esc(d.label)}</strong></td><td>${esc(d.reference)} <small>${esc(d.unit)}</small></td><td>${esc(d.current)} <small>${esc(d.unit)}</small></td></tr>`).join('')}</tbody></table>`:'<p class="review-no-change">이 시점까지 실행한 조건이 동일합니다.</p>'}</div></section><section><div class="review-section-heading"><span class="review-overline">03 / STRUCTURE RESPONSE</span><h4>계산 결과의 차이</h4></div><div class="review-table-scroll"><table><thead><tr><th>구조 지표</th><th>A</th><th>B</th><th>B − A</th></tr></thead><tbody>${rows(data).map(([label,left,right,unit])=>`<tr><td>${esc(label)}<small>${esc(unit)}</small></td><td>${number(left)}</td><td>${number(right)}</td><td>${signed(right-left)}</td></tr>`).join('')}</tbody></table></div></section></div><section class="review-notes"><label for="reviewNoteInput"><span class="review-overline">REVIEWER NOTES</span><strong>관찰과 다음 실험</strong></label><textarea id="reviewNoteInput" rows="3" maxlength="3000" placeholder="관찰한 차이, 해석할 때의 한계, 다음에 확인할 조건을 기록하세요.">${esc(p.note)}</textarea><p>작성한 메모는 내려받는 패키지와 보고서에 포함됩니다.</p></section><details class="review-record-details"><summary>계산 기록 확인 · ${warnings}개 경고 · 패키지 정보</summary><dl><dt>검토 생성</dt><dd id="reviewCreatedAt">${esc(p.createdAt)}</dd><dt>모델</dt><dd>${esc(p.modelVersion)} · 가로 격자 30 nm</dd><dt>SHA-256</dt><dd id="reviewDigest">${esc(review.integrity.digest)}</dd></dl><p>체크섬은 파일 내용의 일치 여부를 확인합니다. 작성자 인증이나 승인 서명이 아닙니다.</p>${[a,b].map((side,i)=>`<h5>${i?'B':'A'} · ${esc(side.title||side.waferId)}</h5><p>${esc(side.note||'실험 메모 없음')}</p>${side.records.some(r=>r.warnings.length)?'<ul>'+side.records.flatMap(r=>r.warnings.map(w=>`<li>${esc(r.stepId)} / ${esc(w.code)} · ${esc(w.message)}</li>`)).join('')+'</ul>':'<p>이 비교 시점까지 모델이 기록한 경고 없음</p>'}`).join('')}</details><p class="review-scope">공개 원리를 축약한 미보정 구조 모델의 비교입니다. 실측 데이터·전기 수율·양산 승인 근거로 해석하지 않습니다. 미실행 레시피 초안은 포함하지 않습니다.</p>`;
      $('#reviewJSON').disabled=false;$('#reviewHTML').disabled=false;
      $('#reviewTitleInput').value=titleDraft??p.title;$('#reviewNoteInput').value=noteDraft??p.note;
      drawChart();setStatus(titleDraft!==null||noteDraft!==null?'검토 메모 수정됨 · 내려받을 때 체크섬을 다시 생성합니다.':'완료 기록과 재계산 결과가 일치합니다. 검토 자료를 내려받을 수 있습니다.');
    }
    function drawChart(){
      if(!review)return;const points=review.payload.comparison.profile,delta=chartMode==='delta',values=points.flatMap(p=>delta?[p.current_nm-p.reference_nm]:[p.reference_nm,p.current_nm]);
      const lo=Math.min(...values,delta?0:Infinity),hi=Math.max(...values,delta?0:-Infinity),pad=Math.max(.5,(hi-lo)*.14),low=lo-pad,high=hi+pad;
      const width=Math.max(320,Math.min(900,$('#reviewProfile').clientWidth)),left=46,span=width-74;
      const x=v=>left+v/E.WIDTH*span,y=v=>22+(high-v)/(high-low)*164;
      const path=fn=>points.map((p,i)=>`${i?'L':'M'}${x(p.x_nm).toFixed(2)},${y(fn(p)).toFixed(2)}`).join(' ');
      const point=points[probe],value=delta?point.current_nm-point.reference_nm:point.current_nm;
      $('#reviewProfile').innerHTML=`<svg viewBox="0 0 ${width} 224" data-chart-width="${width}" role="img" aria-label="${delta?'B − A 표면 높이 차이':'A와 B의 표면 높이 비교'}"><title>${delta?'표면 높이 차이':'표면 높이 비교'} · nm</title>${[0,.5,1].map(t=>{const v=low+(high-low)*t;return `<path d="M${left} ${y(v)}H${width-28}" class="review-grid"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end">${number(v,1)}</text>`;}).join('')}<text x="10" y="13">nm</text>${delta?`<path d="M${left} ${y(0)}H${width-28}" class="review-zero"/><path d="${path(p=>p.current_nm-p.reference_nm)}" class="review-curve current"/>`:`<path d="${path(p=>p.reference_nm)}" class="review-curve reference"/><path d="${path(p=>p.current_nm)}" class="review-curve current"/>`}${(width<500?[0,2.4,4.8]:[0,1.2,2.4,3.6,4.8]).map(v=>`<text x="${x(v*1000)}" y="214" text-anchor="middle">${v}</text>`).join('')}<text x="${width-8}" y="198" text-anchor="end">µm</text><path d="M${x(point.x_nm)} 20V188" class="review-cursor"/><circle cx="${x(point.x_nm)}" cy="${y(value)}" r="4" class="review-probe-dot"/></svg>`;
      $('#reviewProbe').textContent=`X ${number(point.x_nm/1000,3)} µm · A ${number(point.reference_nm,3)} / B ${number(point.current_nm,3)} nm · Δ ${signed(point.current_nm-point.reference_nm)} nm`;
      dialog.querySelectorAll('[data-review-chart]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reviewChart===chartMode)));
    }
    async function exportReview(kind){
      if(!review||busy)return;const token=sequence,original=review,title=$('#reviewTitleInput').value.trim(),note=$('#reviewNoteInput').value;
      busy=true;dialog.setAttribute('aria-busy','true');$('#reviewJSON').disabled=true;$('#reviewHTML').disabled=true;$('#reviewTitleInput').disabled=true;$('#reviewNoteInput').disabled=true;setStatus('검토 메모를 포함해 패키지를 확인하고 있습니다.');
      try{
        const pkg=title===original.payload.title&&note===original.payload.note?original:await root.CmosReview.create(original.payload.comparison,{title,note});
        if(token!==sequence||!dialog.open)return;
        const filename='waferflow-review-'+(pkg.payload.comparison.stepId||'incoming');
        download(filename+(kind==='html'?'.html':'.json'),kind==='html'?'text/html;charset=utf-8':'application/json;charset=utf-8',kind==='html'?root.CmosReview.reportHTML(pkg):JSON.stringify(pkg,null,2));
        review=pkg;titleDraft=null;noteDraft=null;$('#reviewDigest').textContent=pkg.integrity.digest;$('#reviewCreatedAt').textContent=pkg.payload.createdAt;
        setStatus(kind==='html'?'검토 보고서를 저장했습니다. 브라우저에서 열고 인쇄 메뉴로 PDF를 저장할 수 있습니다.':'검토 패키지를 저장했습니다. 파일 열기로 재계산 확인할 수 있습니다.');
      }catch(error){if(token===sequence)setStatus('내려받기 실패: '+error.message,true);}
      finally{if(token===sequence){busy=false;dialog.removeAttribute('aria-busy');$('#reviewJSON').disabled=false;$('#reviewHTML').disabled=false;$('#reviewTitleInput').disabled=false;$('#reviewNoteInput').disabled=false;}}
    }
    async function readFile(input){
      const file=input.files?.[0];input.value='';if(!file)return;
      await task('전달받은 기록을 확인합니다.',async(_signal,token)=>{
        if(file.size>12*1024*1024)throw Error('12 MB 이하의 검토 JSON 파일을 선택하세요.');
        const text=await file.text();if(token!==sequence)throw new DOMException('파일 열기 취소','AbortError');
        let data;try{data=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('JSON 문법이 올바른 검토 패키지를 선택하세요.');}
        const verified=await root.CmosReview.verify(data);return {package:verified.package,origin:'파일에서 확인한 검토 기록 · '+file.name};
      });
    }
    function open(captureCurrent=false){
      pause();if(!dialog.open)dialog.showModal();if(captureCurrent){capture();}else if(!review){home();}else{render();}
    }
    document.querySelector('#openReview').addEventListener('click',()=>open());
    document.querySelector('#comparePanel').addEventListener('click',event=>{if(event.target.closest('#reviewComparison'))open(true);});
    $('#closeReview').addEventListener('click',()=>dialog.close());
    $('#reviewHome').addEventListener('click',home);
    dialog.addEventListener('close',()=>{stop();$('#reviewJSON').disabled=false;$('#reviewHTML').disabled=false;});
    $('#reviewFile').addEventListener('change',event=>readFile(event.target));
    $('#reviewJSON').addEventListener('click',()=>exportReview('json'));$('#reviewHTML').addEventListener('click',()=>exportReview('html'));
    content.addEventListener('click',event=>{
      if(event.target.closest('#reviewCapture'))capture();
      if(event.target.closest('#reviewImport'))$('#reviewFile').click();
      if(event.target.closest('#reviewCancel'))home();
      const exampleButton=event.target.closest('[data-review-example]');if(exampleButton)example(exampleButton.dataset.reviewExample);
      const chartButton=event.target.closest('[data-review-chart]');if(chartButton){chartMode=chartButton.dataset.reviewChart;drawChart();}
    });
    content.addEventListener('input',event=>{if(event.target.matches('#reviewTitleInput,#reviewNoteInput')){titleDraft=$('#reviewTitleInput').value;noteDraft=$('#reviewNoteInput').value;setStatus('검토 메모 수정됨 · 내려받을 때 체크섬을 다시 생성합니다.');}});
    content.addEventListener('pointermove',event=>{const chart=event.target.closest('#reviewProfile');if(!chart||!review)return;const bounds=chart.getBoundingClientRect(),width=Number(chart.querySelector('svg').dataset.chartWidth);const next=Math.max(0,Math.min(E.NX-1,Math.floor(((event.clientX-bounds.left)/bounds.width*width-46)/(width-74)*E.NX)));if(next!==probe){probe=next;drawChart();}});
    content.addEventListener('keydown',event=>{if(event.target.id!=='reviewProfile'||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();probe=event.key==='Home'?0:event.key==='End'?E.NX-1:Math.max(0,Math.min(E.NX-1,probe+(event.key==='ArrowLeft'?-1:1)));drawChart();});
    root.addEventListener('resize',()=>{if(dialog.open&&review)drawChart();});
    return {open};
  }
  root.CmosReviewUI={mount};
})(window);

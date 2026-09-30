/* Multi-metric candidate review. Reads verified results; never edits a wafer. */
(function(root){
  'use strict';
  const C=root.CmosWindowCore;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value===null?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:3});
  function mount(slot,{getResult,getMetric,onEdit,onChange,onSelect,onError}){
    slot.innerHTML=`<details id="windowCandidates" class="window-candidates"><summary><span><b>여러 지표로 후보 찾기</b><small>목표 범위를 함께 적용하고 계산한 조합을 추립니다.</small></span><span id="windowCandidateCount">기준 설정</span></summary>
      <div class="window-screen-body"><form id="windowScreenForm" novalidate><fieldset id="windowScreenFields"><legend>모든 목표 범위를 동시에 만족하는 조건</legend><div id="windowScreenLimits"></div>
      <button id="windowScreenAdd" type="button">＋ 목표 지표 추가</button><div class="window-screen-options"><label class="window-screen-check"><input id="windowScreenWarnings" type="checkbox">모델 경고가 있는 조건 제외</label><label for="windowScreenSort">후보 정렬<select id="windowScreenSort"><option value="seconds">모델 처리 시간 (s)</option>${C.metrics.map(m=>`<option value="${m.id}">${esc(m.label)} (${esc(m.unit)})</option>`).join('')}</select></label><label for="windowScreenDirection">방향<select id="windowScreenDirection"><option value="asc">작은 값부터</option><option value="desc">큰 값부터</option></select></label></div>
      <div class="window-screen-actions"><button id="windowScreenApply" type="submit">목표를 만족하는 후보 찾기</button><button id="windowScreenReset" type="button">후보 기준 초기화</button></div></fieldset></form>
      <p id="windowScreenStatus" class="window-screen-status" role="status">목표 범위를 설정한 뒤 후보를 찾으세요.</p><div id="windowCandidateList" class="window-candidate-list" aria-label="정렬된 후보 조건"></div><p class="window-screen-scope">계산한 조합만 검토합니다. 정렬 순서는 최적 조건·공정 적합성 점수가 아닙니다. 동률은 조건 번호 순이며, 정렬 지표가 없는 조건은 마지막에 표시합니다.</p></div></details>`;
    const $=selector=>slot.querySelector(selector),$$=selector=>Array.from(slot.querySelectorAll(selector));
    let applied=null,assessment=null,busy=false,serial=0;
    const message=(text,error=false)=>{$('#windowScreenStatus').textContent=text;$('#windowScreenStatus').classList.toggle('is-error',error);};
    const range=metric=>{const values=(getResult()?.rows||[]).map(r=>r.metrics[metric]).filter(Number.isFinite);return {min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0,available:!!values.length};};
    function rawLimits(){return $$('[data-screen-limit]').map(row=>({metric:row.querySelector('select').value,min:row.querySelector('[data-screen-min]').value,max:row.querySelector('[data-screen-max]').value}));}
    function renderLimits(limits){
      $('#windowScreenLimits').innerHTML=limits.map((c,i)=>{const id=++serial;return `<div class="window-screen-limit" data-screen-limit="${id}"><label for="windowScreenMetric${id}">목표 ${i+1}<select id="windowScreenMetric${id}" data-screen-metric>${C.metrics.map(m=>`<option value="${m.id}"${c.metric===m.id?' selected':''}>${esc(m.label)} (${esc(m.unit)})</option>`).join('')}</select></label><label for="windowScreenMin${id}">하한<input id="windowScreenMin${id}" data-screen-min type="number" step="any" value="${esc(c.min)}" required></label><label for="windowScreenMax${id}">상한<input id="windowScreenMax${id}" data-screen-max type="number" step="any" value="${esc(c.max)}" required></label><button type="button" data-screen-remove="${id}" aria-label="목표 ${i+1} 제거"${limits.length===1?' disabled':''}>제거</button><p data-screen-range-note>${range(c.metric).available?'양 끝값을 포함합니다.':'현재 공정에서 이 지표의 계산값이 없습니다.'}</p></div>`;}).join('');
      updateChoices();
    }
    function updateChoices(){
      const selected=rawLimits().map(c=>c.metric);
      $$('[data-screen-metric]').forEach(select=>Array.from(select.options).forEach(option=>option.disabled=option.value!==select.value&&selected.includes(option.value)));
      $('#windowScreenAdd').disabled=busy||selected.length>=C.metrics.length;
    }
    function defaultLimits(){const metric=getMetric();return [{metric,...range(metric)}];}
    function renderResults(){
      $('#windowCandidateList').replaceChildren();
      if(!assessment){$('#windowCandidateCount').textContent='기준 설정';return;}
      const a=assessment,result=getResult();
      $('#windowCandidateCount').textContent=a.count+' / '+a.total+' 후보';
      message(`후보 ${a.count} / ${a.total}개 · 범위 밖 ${a.excluded.outside} · 지표 없음 ${a.excluded.unavailable} · 범위를 만족하나 경고로 제외 ${a.excluded.warnings}`);
      if(!a.count){$('#windowCandidateList').innerHTML='<p class="window-no-candidates">목표를 모두 만족하는 후보가 없습니다. 지표와 범위를 확인하거나 경고 제외 설정을 조정하세요.</p>';return;}
      $('#windowCandidateList').innerHTML=a.candidates.map(candidate=>{
        const row=result.rows.find(r=>r.id===candidate.id);
        return `<button type="button" class="window-candidate" data-screen-row="${esc(row.id)}" aria-label="${esc(row.id)}, ${esc(result.x.label)} ${number(row.x)} ${esc(result.x.unit)}, ${esc(result.y.label)} ${number(row.y)} ${esc(result.y.unit)}, 지도에서 선택"><span class="window-candidate-index">${candidate.rank}</span><span><b>${esc(row.id)} <small>지도에서 선택 ↗</small></b><span>${esc(result.x.label)} ${number(row.x)} ${esc(result.x.unit)} · ${esc(result.y.label)} ${number(row.y)} ${esc(result.y.unit)}</span><small>${esc(a.sortLabel)} ${number(candidate.sortValue)} ${esc(a.sortUnit)} · 모델 경고 ${candidate.warningCount}개</small></span></button>`;
      }).join('');
    }
    function invalidate(){
      onEdit();applied=null;assessment=null;renderResults();
      message('설정이 변경되었습니다. 후보 찾기를 눌러 적용하세요.');onChange();
    }
    function read(){
      const limits=rawLimits().map(c=>{
        if(!c.min.trim()||!c.max.trim())throw Error('각 목표의 하한과 상한을 모두 입력하세요.');
        return {metric:c.metric,min:Number(c.min),max:Number(c.max)};
      });
      return {limits,excludeWarnings:$('#windowScreenWarnings').checked,sort:{metric:$('#windowScreenSort').value,direction:$('#windowScreenDirection').value}};
    }
    function refresh(){
      if(!getResult())return;
      if(!$$('[data-screen-limit]').length)renderLimits(defaultLimits());
      assessment=applied?C.screen(getResult(),applied):null;
      renderResults();setBusy(busy);
    }
    function reset(){
      applied=null;assessment=null;$('#windowScreenLimits').replaceChildren();$('#windowCandidates').open=false;
      $('#windowScreenWarnings').checked=false;$('#windowScreenSort').value='seconds';$('#windowScreenDirection').value='asc';
      renderResults();message('목표 범위를 설정한 뒤 후보를 찾으세요.');
    }
    function restore(settings){
      if(!settings){refresh();return;}
      const checked=C.screen(getResult(),settings);applied=checked.settings;assessment=checked;
      renderLimits(applied.limits);$('#windowScreenWarnings').checked=applied.excludeWarnings;
      $('#windowScreenSort').value=applied.sort.metric;$('#windowScreenDirection').value=applied.sort.direction;
      $('#windowCandidates').open=true;renderResults();
    }
    function setBusy(value){busy=value;$('#windowScreenFields').disabled=busy||!getResult();$$('[data-screen-row]').forEach(button=>button.disabled=busy);updateChoices();}
    $('#windowScreenForm').addEventListener('submit',event=>{
      event.preventDefault();if(busy||!getResult())return;
      try{const checked=C.screen(getResult(),read());onEdit();applied=checked.settings;assessment=checked;renderResults();onChange();}
      catch(error){message(error.message,true);onError(error);}
    });
    $('#windowScreenForm').addEventListener('input',invalidate);
    $('#windowScreenForm').addEventListener('change',event=>{
      if(event.target.matches('[data-screen-metric]')){
        const row=event.target.closest('[data-screen-limit]'),bounds=range(event.target.value);
        row.querySelector('[data-screen-min]').value=bounds.min;row.querySelector('[data-screen-max]').value=bounds.max;
        row.querySelector('[data-screen-range-note]').textContent=bounds.available?'양 끝값을 포함합니다.':'현재 공정에서 이 지표의 계산값이 없습니다.';
        updateChoices();
      }
      invalidate();
    });
    $('#windowScreenAdd').addEventListener('click',()=>{
      if(busy)return;const values=rawLimits(),metric=C.metrics.find(m=>!values.some(c=>c.metric===m.id))?.id;if(!metric)return;
      renderLimits([...values,{metric,...range(metric)}]);invalidate();$$('[data-screen-metric]').at(-1).focus();
    });
    $('#windowScreenLimits').addEventListener('click',event=>{
      const button=event.target.closest('[data-screen-remove]');if(!button||busy)return;
      const rows=$$('[data-screen-limit]'),index=rows.indexOf(button.closest('[data-screen-limit]')),values=rawLimits();if(values.length<=1)return;
      values.splice(index,1);renderLimits(values);invalidate();$$('[data-screen-metric]')[Math.min(index,values.length-1)].focus();
    });
    $('#windowScreenReset').addEventListener('click',()=>{
      if(busy)return;reset();$('#windowCandidates').open=true;refresh();onEdit();onChange();$$('[data-screen-metric]')[0]?.focus();
    });
    $('#windowCandidateList').addEventListener('click',event=>{const button=event.target.closest('[data-screen-row]');if(button&&!busy)onSelect(button.dataset.screenRow);});
    reset();setBusy(false);
    return Object.freeze({reset,restore,refresh,setBusy,getSettings:()=>applied?JSON.parse(JSON.stringify(applied)):null,getAssessment:()=>assessment});
  }
  root.CmosWindowScreening=Object.freeze({mount});
})(window);

(function () {
  'use strict';
  const A = window.EquipmentApp, E = window.EquipmentEngine, M = window.EquipmentReviewMath, $ = s => document.querySelector(s);
  if (!A || !M || !$('#reviewWorkspace')) return;
  const esc = M.escape, fmt = M.number, states = { draft:'작성 중', submitted:'검토 요청', reviewed:'검토 완료', rejected:'반려' };
  const S = { user:null, csrf:'', projects:[], project:'', offset:0, total:0, items:[], selected:null, baseline:null, baseRevision:null, epoch:0, capabilities:null };
  const labels = Object.fromEntries(Object.entries(E.PROFILE.fields).map(([k, f]) => [k, f.label]));
  function message(text, error = false) { $('#reviewMessage').textContent = text; $('#reviewMessage').className = 'review-message' + (error ? ' error' : ''); }
  function clearSession() { S.epoch++; S.user = null; S.csrf = ''; S.selected = null; S.baseRevision = null; S.baseline = null; S.items = []; S.projects = []; S.project = ''; $('#archiveDetail').hidden = true; $('#archiveDetail').innerHTML = ''; $('#archiveRows').innerHTML = ''; renderSession(); renderComparison(); }
  async function api(path, method = 'GET', data) {
    const response = await fetch('/api' + path, { method, credentials:'same-origin', headers:{ 'Content-Type':'application/json', 'X-WaferFlow':'review', ...(S.csrf ? {'X-CSRF-Token':S.csrf} : {}) }, ...(data === undefined ? {} : {body:JSON.stringify(data)}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401) clearSession(); throw new Error(payload.error || (response.status === 404 ? '장비 검토 API가 없는 서버입니다. 업데이트한 서버에서 열어주세요.' : '서버 요청에 실패했습니다. HTTP ' + response.status)); }
    return payload;
  }
  async function task(button, fn) { if (button?.disabled) return; if (button) button.disabled = true; try { return await fn(); } catch (e) { message(e.message, true); const error = $('#reviewFormError'); if (error) error.textContent = e.message; } finally { if (button?.isConnected) button.disabled = button.id === 'archivePrevious' ? S.offset === 0 : button.id === 'archiveNext' ? S.offset + 30 >= S.total : false; } }
  function modal(title, html) { A.pause(); $('#reviewModalTitle').textContent = title; $('#reviewModalBody').innerHTML = html; $('#reviewModal').showModal(); $('#reviewModalBody input')?.focus(); }
  function close() { $('#reviewModal').close(); }
  function form(fields, action, buttonLabel) { return '<form id="equipmentReviewForm" data-action="' + action + '">' + fields + '<p id="reviewFormError" class="review-message error" role="alert"></p><div class="dialog-footer"><button class="primary" type="submit">' + buttonLabel + '</button></div></form>'; }
  function field(name, label, value = '', max = 100, multiline = false) { return '<label class="review-field">' + label + (multiline ? '<textarea name="' + name + '" maxlength="' + max + '" required>' + esc(value) + '</textarea>' : '<input name="' + name + '" maxlength="' + max + '" value="' + esc(value) + '" required>') + '</label>'; }
  function formValues(formEl) { return Object.fromEntries([...formEl.querySelectorAll('[name]')].map(el => [el.name || el.getAttribute('name'), el.value])); }
  function renderSession() {
    $('#reviewConnection').textContent = S.user ? S.user.display_name + ' · ' + ({admin:'관리자',engineer:'엔지니어',reviewer:'검토자'}[S.user.role]) : '서버 연결 전';
    $('#reviewConnect').textContent = S.user ? '연결 새로고침' : '계정 연결'; $('#reviewLogout').hidden = !S.user; $('#archiveArea').hidden = !S.user;
    $('#createReviewProject').hidden = !S.user || S.user.role === 'reviewer';
    $('#archiveRun').disabled = !!S.user && S.user.role === 'reviewer';
  }
  async function enter(me) {
    S.user = me.user; S.csrf = me.csrf;
    try { S.capabilities = await api('/equipment/capabilities'); S.projects = await api('/projects'); }
    catch (e) { clearSession(); throw e; }
    if (!S.projects.some(p => p.id === S.project)) S.project = S.projects[0]?.id || '';
    $('#archiveProject').innerHTML = S.projects.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
    $('#archiveProject').value = S.project; S.offset = 0; renderSession(); await refresh();
  }
  async function connect() {
    const status = await api('/status');
    if (!status.initialized) { modal('서버 계정 설정', '<p>첫 관리자 계정이 아직 없습니다. 기존 계정 관리 화면에서 관리자·엔지니어·검토자 계정을 설정한 뒤 이 화면에서 연결하세요.</p><p><a href="workbench.html" target="_blank" rel="noopener">계정 관리 화면 열기 ↗</a></p><p class="scope-note">기본 계정이나 공용 비밀번호는 자동 생성하지 않습니다.</p>'); return; }
    try { await enter(await api('/me')); message('서버 계정에 연결했습니다. 운전 기록은 보관 버튼을 누를 때 저장됩니다.'); }
    catch (e) {
      if (!e.message.includes('로그인')) throw e;
      modal('검토 서버 로그인', form('<label class="review-field">아이디<input name="username" required autocomplete="username" maxlength="60"></label><label class="review-field">비밀번호<input name="password" type="password" required autocomplete="current-password" maxlength="128"></label>', 'login', '로그인'));
    }
  }
  async function refresh() {
    const epoch = ++S.epoch, project = S.project;
    if (!S.user || !project) { S.items = []; S.total = 0; renderArchive(); return; }
    const result = await api('/equipment/runs?project_id=' + encodeURIComponent(project) + '&offset=' + S.offset);
    if (epoch !== S.epoch || project !== S.project || !S.user) return;
    S.items = result.items; S.total = result.total;
    if (S.selected) { const updated = S.items.find(x => x.id === S.selected.id); if (updated) S.selected = {...S.selected,...updated}; }
    renderArchive(); renderDetail();
  }
  function renderArchive() {
    $('#archiveRows').innerHTML = S.items.map(r => '<tr><td><strong>' + esc(r.title) + '</strong><small>r' + r.revision + ' · ' + esc(r.lot_id) + '</small></td><td>' + (r.summary.declared_outcome === 'completed' ? '기록상 완료' : '중단') + '<small>' + fmt(r.summary.duration) + ' s · 알람 ' + r.summary.alarm_count + '</small></td><td><span class="pill ' + (r.status === 'reviewed' ? 'teal' : '') + '">' + states[r.status] + '</span></td><td>' + esc(r.author) + '<small>' + esc(r.created_at) + '</small></td><td><button data-open-record="' + esc(r.id) + '">상세</button></td></tr>').join('') || '<tr><td colspan="5">' + (S.project ? '보관된 장비 검토 기록이 없습니다.' : '프로젝트를 먼저 만드세요.') + '</td></tr>';
    $('#archiveCount').textContent = S.total ? (S.offset + 1) + '–' + Math.min(S.offset + 30, S.total) + ' / ' + S.total + '개' : '0개';
    $('#archivePrevious').disabled = S.offset === 0; $('#archiveNext').disabled = S.offset + 30 >= S.total;
  }
  async function selectRecord(id) {
    const project = S.project, record = await api('/equipment/runs/' + encodeURIComponent(id));
    if (S.user && project === S.project && record.project_id === project) { S.selected = record; renderDetail(); }
  }
  function renderDetail() {
    const r = S.selected; $('#archiveDetail').hidden = !r; if (!r) return;
    const own = S.user && r.created_by === S.user.id, canWrite = S.user && S.user.role !== 'reviewer', canReview = S.user && ['admin','reviewer'].includes(S.user.role) && !own && r.status === 'submitted';
    $('#archiveDetail').innerHTML = '<div class="archive-detail-heading"><div><span class="eyebrow">IMMUTABLE RECORD / r' + r.revision + '</span><h3>' + esc(r.title) + '</h3></div><span class="pill">' + states[r.status] + '</span></div><p>' + esc(r.change_reason) + '</p><dl><dt>출처 선언</dt><dd>' + esc(r.source_name) + '</dd><dt>기록 ID</dt><dd>' + esc(r.id) + '</dd><dt>SHA-256</dt><dd>' + esc(r.trace_sha256) + '</dd><dt>작성자 / 검토자</dt><dd>' + esc(r.author) + ' / ' + esc(r.reviewer || '미지정') + '</dd><dt>검토 의견</dt><dd>' + esc(r.review_note || '없음') + '</dd><dt>현장 검증</dt><dd>미완료 · 장비 투입 승인 아님</dd></dl><div class="record-actions"><button data-review-action="replay">이 기록 재생</button><button data-review-action="baseline">비교 기준 지정</button><button data-review-action="report">이 기록 보고서 ↓</button><button data-review-action="json">보관 원본 ↓</button>' + (canWrite ? '<button data-review-action="revise">조건을 불러와 새 버전 작성</button>' : '') + (own && r.status === 'draft' ? '<button data-review-action="submit" class="primary">검토 요청</button>' : '') + (canReview ? '<button data-review-action="review" class="primary">검토 완료</button><button data-review-action="reject">반려</button>' : '') + '</div>';
  }
  function renderComparison() {
    $('#baselineLabel').textContent = S.baseline ? S.baseline.title + (S.baseline.revision ? ' · r' + S.baseline.revision : '') : '비교 기준을 지정하세요.';
    if (!S.baseline) { $('#reviewComparison').innerHTML = '<p class="muted">현재 기록을 기준으로 지정하고 조건을 변경해 다시 실행하세요.</p>'; return; }
    const comparison = M.compare(A.snapshot().trace, S.baseline.trace, $('#comparisonStage').value);
    if (!comparison.compatible) { $('#reviewComparison').innerHTML = '<p class="review-message">' + esc(comparison.reason) + '</p>'; return; }
    $('#reviewComparison').innerHTML = '<p class="comparison-scope">현재 계산 ' + fmt(comparison.current.duration) + ' s / 기준 ' + fmt(comparison.baseline.duration) + ' s · 미실행 초안 제외</p><div class="review-table-wrap"><table><thead><tr><th>채널</th><th>현재 평균</th><th>기준 평균</th><th>차이</th><th>현재 / 기준 커버리지</th></tr></thead><tbody>' + comparison.rows.map(r => '<tr><td>' + esc(labels[r.key] || r.key) + '<small>' + esc(r.unit) + '</small></td><td>' + fmt(r.current?.mean) + '</td><td>' + fmt(r.baseline?.mean) + '</td><td>' + (r.delta > 0 ? '+' : '') + fmt(r.delta) + '</td><td>' + fmt((r.current?.coverage || 0) * 100) + '% / ' + fmt((r.baseline?.coverage || 0) * 100) + '%</td></tr>').join('') + '</tbody></table></div><p class="comparison-scope">' + esc(comparison.reason) + '</p><p class="recipe-diff"><strong>레시피 변경</strong> ' + (comparison.recipe.length ? comparison.recipe.map(r => esc(labels[r.key] || r.key) + ': ' + fmt(r.baseline) + ' → ' + fmt(r.current) + ' ' + esc(r.unit)).join(' · ') : '동일 조건') + '</p>';
  }
  let archiveCapture = null;
  function archiveDialog() {
    if (!S.user) { message('서버 계정에 연결한 뒤 기록을 보관할 수 있습니다.'); return task(null, connect); }
    if (!S.project) { projectDialog(); return; }
    A.pause(); const snapshot = A.snapshot();
    archiveCapture = { trace:snapshot.trace, project:S.project, baseline:S.baseline?.id || null, base:S.baseRevision, request:Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
    const base = S.baseRevision;
    modal('운전 기록 보관', form('<p class="scope-note">현재 계산 전체 ' + fmt(snapshot.trace.duration) + ' s를 고정해 보관합니다. 재생 위치와 미실행 초안은 제외합니다. ' + (base ? 'r' + base.revision + '에서 새 버전을 만듭니다.' : '새 검토의 r1으로 보관합니다.') + '</p>' + field('title','검토 이름',base?.title || '이온 밀링 조건 검토') + field('lot_id','Lot / 시편 식별자',base?.lot_id || 'SIM-LOT') + field('source_name','데이터 출처',snapshot.imported ? '사용자 제공 로그 · 원출처를 입력하세요' : 'WaferFlow 합성 예제 · 실제 장비 데이터 아님',200) + field('change_reason','검토 목적 · 변경 사유','',2000,true), 'archive', '서버에 보관'));
  }
  function projectDialog() { if (!S.user || S.user.role === 'reviewer') return; modal('장비 검토 프로젝트 만들기', form(field('name','프로젝트 이름') + field('description','검토 목적','',1000,true), 'project', '프로젝트 만들기')); }
  function transitionDialog(action) {
    const r = S.selected; if (!r) return;
    modal(action === 'submit' ? '동료 검토 요청' : action === 'review' ? '실험 근거 검토 완료' : '변경안 반려', form('<p>' + esc(r.title) + ' · r' + r.revision + '</p><p class="scope-note">검토 상태는 이 기록에만 적용되며 실제 장비 투입 승인이 아닙니다.</p><input name="record_id" type="hidden" value="' + esc(r.id) + '"><input name="lock_version" type="hidden" value="' + r.lock_version + '"><input name="transition" type="hidden" value="' + action + '">' + (action === 'submit' ? '' : field('note','검토 의견','',2000,true)), 'transition', action === 'submit' ? '검토 요청' : action === 'review' ? '검토 완료 기록' : '반려 기록'));
  }
  function download(name, text, type) { const url = URL.createObjectURL(new Blob([text],{type})); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  async function recordReport() {
    const r = S.selected; if (!r) return;
    const baseline = r.baseline_id ? await api('/equipment/runs/' + encodeURIComponent(r.baseline_id)) : null;
    download('waferflow-review-' + r.id + '.html',M.report(r.trace,{record:r,baseline,selected:$('#comparisonStage').value,labels}),'text/html;charset=utf-8');
  }
  $('#equipmentReviewForm')?.addEventListener('submit', e => e.preventDefault());
  $('#reviewModalBody').addEventListener('submit', e => {
    if (e.target.id !== 'equipmentReviewForm') return; e.preventDefault();
    const formEl = e.target, data = formValues(formEl), action = formEl.dataset.action;
    task(formEl.querySelector('[type="submit"]'), async () => {
      if (action === 'login') { await enter(await api('/login','POST',data)); close(); message('계정에 연결했습니다.'); }
      if (action === 'project') { const result = await api('/projects','POST',data); S.project = result.id; await enter(await api('/me')); close(); message('프로젝트를 만들었습니다.'); }
      if (action === 'archive') {
        const capture = archiveCapture; if (!capture) throw new Error('보관할 기록을 다시 선택하세요.');
        const payload = {...data,project_id:capture.project,trace:capture.trace,baseline_id:capture.baseline,base_revision_id:capture.base?.id || null,request_key:capture.request};
        if (new Blob([JSON.stringify(payload)]).size > S.capabilities.max_archive_bytes) throw new Error('서버 보관은 요청당 최대 1.4 MB입니다. 원본 JSON을 별도로 보관하거나 로그 구간을 나누세요.');
        const record = await api('/equipment/runs','POST',payload); S.selected = record; S.baseRevision = null; S.project = record.project_id; S.offset = 0; $('#archiveProject').value = S.project;
        await refresh(); close(); message('r' + record.revision + '을 서버에 보관했습니다. 조건·로그·변경 사유는 고정되며 동료 검토를 요청할 수 있습니다.');
      }
      if (action === 'transition') { const record = await api('/equipment/runs/' + encodeURIComponent(data.record_id) + '/transition','POST',{action:data.transition,lock_version:Number(data.lock_version),note:data.note || ''}); S.selected = record; await refresh(); close(); message('검토 상태를 기록했습니다. 장비 투입 승인과는 구분됩니다.'); }
    });
  });
  $('#archiveRows').addEventListener('click', e => { const button = e.target.closest('[data-open-record]'); if (button) task(button, () => selectRecord(button.dataset.openRecord)); });
  $('#archiveDetail').addEventListener('click', e => {
    const button = e.target.closest('[data-review-action]'); if (!button || !S.selected) return;
    task(button, async () => {
      const action = button.dataset.reviewAction, r = S.selected;
      if (action === 'replay') { A.importData(r.trace); message(r.title + ' r' + r.revision + '의 서버 기록을 재생합니다.'); }
      if (action === 'baseline') { S.baseline = r; renderComparison(); message('서버 기록을 비교 기준으로 지정했습니다.'); }
      if (action === 'revise') { A.useRecipe(r.trace); S.baseRevision = r; message(r.title + ' r' + r.revision + '을 기준으로 새 변경안을 작성합니다. 조건 변경 → 실행 → 검토 기록 보관 순서로 진행하세요.'); }
      if (action === 'report') await recordReport();
      if (action === 'json') download('waferflow-archive-' + r.id + '.json',JSON.stringify({schema:'waferflow-equipment-review-record-v1',record:r},null,2),'application/json');
      if (['submit','review','reject'].includes(action)) transitionDialog(action);
    });
  });
  $('#reviewConnect').addEventListener('click', e => task(e.currentTarget,connect));
  $('#reviewLogout').addEventListener('click', e => task(e.currentTarget,async () => { await api('/logout','POST',{}); clearSession(); message('로그아웃했습니다. 현재 브라우저의 운전 화면은 유지됩니다.'); }));
  $('#archiveRun').addEventListener('click',archiveDialog); $('#closeReviewModal').addEventListener('click',close);
  $('#archiveRefresh').addEventListener('click', e => task(e.currentTarget,refresh)); $('#createReviewProject').addEventListener('click',projectDialog);
  $('#archiveProject').addEventListener('change', () => { S.project = $('#archiveProject').value; S.offset = 0; S.selected = null; S.baseline = null; S.baseRevision = null; renderComparison(); renderDetail(); task(null,refresh); });
  $('#archivePrevious').addEventListener('click', e => task(e.currentTarget,async () => { S.offset = Math.max(0,S.offset - 30); await refresh(); }));
  $('#archiveNext').addEventListener('click', e => task(e.currentTarget,async () => { S.offset += 30; await refresh(); }));
  $('#pinBaseline').addEventListener('click', () => { S.baseline = {title:'로컬 기준 · ' + new Date().toLocaleTimeString(),trace:A.snapshot().trace}; renderComparison(); message('현재 계산을 비교 기준으로 고정했습니다. 레시피 초안 변경만으로는 계산 결과가 바뀌지 않습니다.'); });
  $('#comparisonStage').addEventListener('change',renderComparison);
  $('#currentReport').addEventListener('click', () => download('waferflow-current-review.html',M.report(A.snapshot().trace,{baseline:S.baseline,selected:$('#comparisonStage').value,labels}),'text/html;charset=utf-8'));
  window.EquipmentReview = { traceChanged:renderComparison, connect, refresh, state:() => JSON.parse(JSON.stringify(S)) };
  renderSession(); renderComparison();
})();

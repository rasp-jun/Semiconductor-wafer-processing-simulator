(function () {
  'use strict';
  const E = window.EquipmentEngine, V = window.EquipmentView, $ = s => document.querySelector(s);
  if (!E || !V) { $('#feedback').hidden = false; $('#feedback').textContent = '장비 모듈을 불러오지 못했습니다. 서버를 다시 시작하고 새로고침하세요.'; return; }
  const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaults = () => Object.fromEntries(Object.entries(E.PROFILE.fields).map(([k, f]) => [k, f.default]));
  const STORAGE = 'waferflow-equipment-draft-v1';
  let simulationDraft = null;
  const state = { trace: null, time: 0, playing: false, activeRun: false, imported: false, draftChanged: false, last: null, raf: null, channel: 'pressurePa', eventKey: '', rotation: [] };
  const stage = id => E.STAGES.find(s => s.id === id);
  function say(message, error = false) { $('#feedback').hidden = !message; $('#feedback').textContent = message; $('#feedback').className = 'feedback' + (error ? ' error' : ''); }
  function fmt(v) { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v); return a >= 10000 ? (v / 1000).toFixed(1) + 'k' : a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : a > 0 && a < .01 ? v.toExponential(1) : v.toFixed(3); }
  function readRecipe() { return Object.fromEntries(Object.keys(E.PROFILE.fields).map(k => [k, $('#recipe-' + k).value])); }
  function writeRecipe(recipe) { for (const k of Object.keys(E.PROFILE.fields)) $('#recipe-' + k).value = recipe[k] ?? ''; }
  function persistDraft() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ recipe: readRecipe(), fault: $('#faultSelect').value })); $('#draftStatus').textContent = '운전 조건 저장됨 · 기존 Fab 기록 보존'; }
    catch (_) { $('#draftStatus').textContent = '로컬 저장 불가 · 현재 화면에서 사용 가능'; }
  }
  function validate() {
    const result = E.validateRecipe(readRecipe());
    for (const key of Object.keys(E.PROFILE.fields)) {
      const error = result.errors.find(e => e.field === key);
      $('#recipe-' + key).setAttribute('aria-invalid', String(!!error));
      $('#error-' + key).textContent = error?.message || '';
    }
    $('#preflight').innerHTML = result.checks.map(c => '<li class="' + escape(c.status) + '"><div>' + escape(c.label) + '<small>' + escape(c.detail || '') + '</small></div></li>').join('');
    $('#runButton').disabled = !result.ok || state.activeRun || state.imported;
    return result;
  }
  function lockControls() {
    const locked = state.activeRun || state.imported;
    for (const el of document.querySelectorAll('#recipeForm input, #defaultsButton, #faultSelect')) el.disabled = locked;
    $('#recipeMode').textContent = state.imported ? 'LOG REPLAY' : state.activeRun ? 'LOCKED' : state.draftChanged ? 'DRAFT CHANGED' : 'EDITABLE';
    $('#stopButton').disabled = !state.activeRun;
    $('#runButton').textContent = state.activeRun ? '계산된 운전 재생 중' : '▶ 설정 조건으로 실행';
    if (state.imported) {
      $('#runButton').disabled = true;
      $('#preflight').innerHTML = '<li class="info"><div>로그 재생 모드<small>입력 범위·실제 장비 적합성을 판정하지 않습니다.</small></div></li><li class="info"><div>제공된 레시피만 표시<small>빈 항목은 로그에 포함되지 않은 값입니다.</small></div></li>';
      for (const k of Object.keys(E.PROFILE.fields)) { $('#recipe-' + k).setAttribute('aria-invalid', 'false'); $('#error-' + k).textContent = ''; }
    } else validate();
  }
  function loadTrace(trace, imported = false) {
    state.playing = false; state.activeRun = false; state.trace = trace; state.time = trace.samples[0].t;
    state.imported = imported; state.last = null; state.eventKey = ''; state.rotation = [0];
    for (let i = 1; i < trace.samples.length; i++) {
      const a = trace.samples[i - 1], b = trace.samples[i];
      state.rotation.push(state.rotation[i - 1] + (a.values.rotationRpm ?? 0) * 6 * (b.t - a.t));
    }
    $('#scrubber').min = String(trace.samples[0].t); $('#scrubber').max = String(trace.duration);
    $('#dataBadge').textContent = imported ? '불러온 로그 · 출처 미검증' : '자체 생성 예제';
    $('#dataDescription').textContent = imported
      ? '파일의 센서값과 제공된 구동 신호를 재생합니다. 누락된 신호는 미상이며 실제 장비 출처·정확도는 확인되지 않았습니다.'
      : '공개 장비 채널을 참고한 범용 이온 밀링 모델입니다. 수치·단위·동작 시간은 자체 설정값이며 삼성·SK하이닉스의 실측 데이터가 아닙니다.';
    $('#returnSimulation').hidden = !imported;
    $('#profileLabel').textContent = imported ? '파일 프로필: ' + trace.profileId : 'GENERIC ION MILL · 단일 챔버';
    $('#modelVersion').textContent = trace.modelVersion + (imported ? ' · 파일 선언 버전 · 출처 미검증' : ' · 독립 장비 모델');
    $('#importedFaultOption')?.remove();
    if (imported) {
      const option = document.createElement('option'); option.id = 'importedFaultOption'; option.value = 'imported-info';
      option.textContent = '파일 표기: ' + (trace.fault || '시나리오 정보 없음');
      $('#faultSelect').appendChild(option); $('#faultSelect').value = 'imported-info';
    }
    $('#actualLegend').textContent = imported ? '파일 기록값' : '모델 응답';
    const available = Object.keys(E.CHANNELS).filter(k => trace.samples.some(s => Number.isFinite(s.values[k])));
    $('#channelSelect').innerHTML = available.map(k => '<option value="' + k + '">' + escape(E.CHANNELS[k].label) + '</option>').join('');
    if (!available.includes(state.channel)) state.channel = available[0];
    $('#channelSelect').value = state.channel;
    $('#stageStrip').innerHTML = E.STAGES.map((s, i) => '<button type="button" data-stage="' + s.id + '" ' + (trace.samples.some(p => p.stage === s.id) ? '' : 'disabled') + '><small>' + String(i + 1).padStart(2, '0') + '</small>' + escape(s.label) + '</button>').join('');
    for (const button of document.querySelectorAll('#stageStrip [data-stage]')) button.addEventListener('click', () => seek(trace.samples.find(p => p.stage === button.dataset.stage).t));
    $('#eventList').innerHTML = trace.events.map((e, i) => '<button type="button" class="event-item ' + escape(e.level) + '" data-event="' + i + '"><span class="event-time">' + e.t.toFixed(1) + ' s</span><span class="event-symbol">' + (e.level === 'alarm' ? '!' : e.level === 'warning' ? '△' : '●') + '</span><span><strong>' + escape(e.code) + '</strong>' + escape(e.message) + '</span></button>').join('') || '<p class="muted">이 파일에 이벤트 기록이 없습니다.</p>';
    for (const button of document.querySelectorAll('[data-event]')) button.addEventListener('click', () => seek(trace.events[Number(button.dataset.event)].t));
    lockControls(); buildChart(); render();
    window.EquipmentReview?.traceChanged();
  }
  function sampleAt(t) {
    const rows = state.trace.samples; let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (rows[mid].t <= t) lo = mid; else hi = mid - 1; }
    const a = rows[lo], b = rows[Math.min(lo + 1, rows.length - 1)], p = a === b ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const out = { ...a, t, values: { ...a.values }, targets: { ...(a.targets || {}) }, digital: { ...(a.digital || {}) } };
    // Only generated model responses are interpolated. Imported measurements are held at their actual sample time.
    if (!state.imported) {
      for (const key of Object.keys(out.values)) if (Number.isFinite(b.values[key])) out.values[key] += (b.values[key] - out.values[key]) * p;
      if (Number.isFinite(a.digital?.robot) && Number.isFinite(b.digital?.robot)) out.digital.robot += (b.digital.robot - out.digital.robot) * p;
    }
    const angle = state.rotation[lo] + (a.values.rotationRpm ?? 0) * 6 * (t - a.t);
    return { sample: out, angle, sampledAt: a.t };
  }
  function render() {
    if (!state.trace) return;
    const { sample, angle, sampledAt } = sampleAt(state.time), s = stage(sample.stage);
    const ended = state.time >= state.trace.duration, alarm = !state.imported && state.trace.events.some(e => e.level === 'alarm' && e.t <= state.time);
    view.render(sample, { time: state.time, playing: state.playing, imported: state.imported, rotationDeg: angle });
    const runLabel = state.imported ? (ended ? 'LOG END' : state.playing ? 'LOG PLAYBACK' : 'LOG PAUSED') : alarm ? 'ALARM / STOP' : ended ? (state.trace.outcome.status === 'completed' ? 'COMPLETE' : 'STOPPED') : state.playing ? 'RUNNING' : state.time > state.trace.samples[0].t ? 'PAUSED' : 'READY';
    $('#runState').textContent = runLabel;
    $('#runState').className = 'state ' + (alarm || (ended && state.trace.outcome.status === 'aborted') ? 'aborted' : ended ? 'completed' : state.playing ? 'running' : 'ready');
    $('#stageTitle').textContent = s?.label || '단계 미상';
    $('#timeLabel').textContent = state.time.toFixed(1) + ' / ' + state.trace.duration.toFixed(1) + ' s';
    $('#scrubber').value = String(state.time);
    $('#playButton').textContent = state.playing ? 'Ⅱ 정지' : '▶ 재생';
    $('#playButton').setAttribute('aria-label', state.playing ? '운전 기록 일시 정지' : '운전 기록 재생');
    $('#stageDescription').textContent = state.imported
      ? '기록 시각 ' + sampledAt.toFixed(2) + ' s · 기록값 유지 방식 · 제공된 신호만 표시'
      : (s?.description || '모델 운전 결과') + ' · 표시 속도 ' + $('#speedSelect').value + '×';
    for (const key of Object.keys(E.CHANNELS)) {
      $('#value-' + key).textContent = fmt(sample.values[key]);
      $('#target-' + key).textContent = 'SET ' + fmt(sample.targets?.[key]);
    }
    const bits = [['beam','BEAM'],['shutter','SHUTTER'],['pump','PUMP'],['gate','GATE']];
    for (const [key] of bits) {
      const val = sample.digital?.[key], el = $('#digital-' + key);
      el.className = val === true ? 'on' : val === false ? '' : 'unknown';
      el.querySelector('b').textContent = val == null ? '미상' : key === 'shutter' || key === 'gate' ? (val ? 'OPEN' : 'CLOSED') : val ? 'ON' : 'OFF';
    }
    const current = E.STAGES.findIndex(x => x.id === sample.stage);
    for (const button of document.querySelectorAll('#stageStrip [data-stage]')) {
      const i = E.STAGES.findIndex(x => x.id === button.dataset.stage);
      button.className = i === current ? 'active' : i < current && !button.disabled ? 'past' : '';
      if (i === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    }
    const eventKey = state.trace.events.filter(e => e.t <= state.time).length;
    if (state.eventKey !== eventKey) {
      state.eventKey = eventKey;
      for (const button of document.querySelectorAll('[data-event]')) button.classList.toggle('future', state.trace.events[Number(button.dataset.event)].t > state.time);
      $('#eventCount').textContent = eventKey + ' / ' + state.trace.events.length + ' EVENTS';
    }
    const latestAlarm = !state.imported && state.trace.events.filter(e => e.level === 'alarm' && e.t <= state.time).at(-1);
    $('#outcome').className = 'outcome' + (alarm || (ended && state.trace.outcome.status === 'aborted') ? ' alarm' : ended ? ' done' : '');
    $('#outcome').textContent = latestAlarm ? latestAlarm.message : ended ? (state.imported ? '파일 결과: ' : '') + state.trace.outcome.reason : state.imported ? '사용자 제공 로그 재생 · 알람 이력만으로 현재 장비 상태를 추정하지 않습니다.' : '모델 운전 ' + (state.playing ? '재생 중' : '대기 / 일시 정지') + ' · 조건부 전이와 알람을 확인하세요.';
    updateChartCursor(sample);
  }
  function buildChart() {
    const rows = state.trace.samples, k = state.channel, c = E.CHANNELS[k]; if (!c) return;
    const present = rows.flatMap(s => [s.values[k], s.targets?.[k]]).filter(Number.isFinite);
    const logarithmic = k === 'pressurePa' && present.every(v => v > 0) && Math.max(...present) / Math.min(...present) > 100;
    const transform = v => logarithmic ? Math.log10(v) : v;
    let min = Math.min(...present.map(transform)), max = Math.max(...present.map(transform));
    if (min === max) { min -= Math.max(Math.abs(min) * .05, .1); max += Math.max(Math.abs(max) * .05, .1); }
    else { const pad = (max - min) * .08; min -= pad; max += pad; }
    const start = rows[0].t, span = Math.max(.01, state.trace.duration - start);
    const x = t => 64 + (t - start) / span * 644, y = v => 187 - (transform(v) - min) / (max - min) * 155;
    state.chart = { x, y, start, span };
    let grid = '';
    for (let i = 0; i <= 4; i++) { const yy = 32 + i * 155 / 4, v = max - i * (max - min) / 4; grid += '<line x1="64" y1="' + yy + '" x2="708" y2="' + yy + '" stroke="#e8eef1"/><text x="54" y="' + (yy + 3) + '" text-anchor="end">' + escape(fmt(logarithmic ? 10 ** v : v)) + '</text>'; }
    for (let i = 0; i <= 4; i++) { const xx = 64 + i * 644 / 4; grid += '<text x="' + xx + '" y="211" text-anchor="middle">' + (start + span * i / 4).toFixed(0) + ' s</text>'; }
    // Retain every sample so short alarm excursions and missing-value gaps survive rendering.
    function path(key) {
      let d = '', open = false;
      for (const s of rows) {
        const v = key === 'values' ? s.values[k] : s.targets?.[k];
        if (!Number.isFinite(v) || (logarithmic && v <= 0)) { open = false; continue; }
        const xx = x(s.t).toFixed(2), yy = y(v).toFixed(2);
        d += !open ? 'M' + xx + ' ' + yy : state.imported || key === 'targets' ? 'H' + xx + 'V' + yy : 'L' + xx + ' ' + yy;
        open = true;
      }
      return d;
    }
    $('#chartScale').textContent = c.unit + (logarithmic ? ' · 로그 축' : ' · 선형 축');
    $('#traceChart').innerHTML = '<svg viewBox="0 0 736 225" role="img" aria-label="' + escape(c.label) + ' 시간별 설정값과 응답"><g fill="#94a6b2" font-family="Consolas,monospace" font-size="10">' + grid + '</g><path d="' + path('targets') + '" fill="none" stroke="#a8b6bf" stroke-width="1.5" stroke-dasharray="5 4"/><path d="' + path('values') + '" fill="none" stroke="#168d81" stroke-width="2"/><line id="chartCursor" x1="64" y1="23" x2="64" y2="190" stroke="#c28c42" stroke-width="1"/><circle id="chartDot" cx="64" cy="187" r="4" fill="#138d80" stroke="white" stroke-width="2"/></svg>';
  }
  function updateChartCursor(sample) {
    const chart = state.chart; if (!chart) return;
    const x = chart.x(state.time), v = sample.values[state.channel], c = E.CHANNELS[state.channel];
    $('#chartCursor').setAttribute('x1', x); $('#chartCursor').setAttribute('x2', x);
    $('#chartDot').setAttribute('visibility', Number.isFinite(v) ? 'visible' : 'hidden');
    if (Number.isFinite(v)) { $('#chartDot').setAttribute('cx', x); $('#chartDot').setAttribute('cy', chart.y(v)); }
    $('#channelValue').textContent = c.label + ' ' + fmt(v) + ' ' + c.unit + ' / SET ' + fmt(sample.targets?.[state.channel]);
  }
  function seek(time) {
    if (!Number.isFinite(Number(time))) return;
    state.playing = false; state.last = null; state.time = Math.max(state.trace.samples[0].t, Math.min(state.trace.duration, Number(time)));
    if (state.time >= state.trace.duration && state.activeRun) { state.activeRun = false; lockControls(); }
    render();
  }
  function play() {
    if (state.playing) { state.playing = false; state.last = null; }
    else { if (state.time >= state.trace.duration) state.time = state.trace.samples[0].t; state.playing = true; state.last = null; }
    render();
  }
  function startRun() {
    if (state.activeRun || state.imported || !validate().ok) return;
    try {
      const trace = E.simulate(readRecipe(), $('#faultSelect').value);
      state.draftChanged = false; loadTrace(trace); state.activeRun = true; state.playing = true;
      lockControls(); persistDraft(); say('설정한 조건으로 운전을 계산했습니다. 생성된 응답을 장비 동작과 함께 재생합니다.'); render();
    } catch (e) { say(e.message, true); }
  }
  function stopRun() {
    if (!state.activeRun) return;
    const current = sampleAt(state.time).sample, trace = JSON.parse(JSON.stringify(state.trace));
    // Hold the transfer position and gate as observed; stopping playback must not teleport the arm or close a gate on it.
    current.digital = { ...current.digital, beam: false, shutter: false };
    current.targets = { ...current.targets, beamVoltageV: 0, beamCurrentMa: 0, rotationRpm: 0 };
    trace.samples = trace.samples.filter(s => s.t < state.time); trace.samples.push(current);
    // A valid replay needs two strictly ordered samples, including when stopped immediately.
    if (trace.samples.length === 1) trace.samples.push({ ...JSON.parse(JSON.stringify(current)), t: current.t + .001 });
    trace.duration = trace.samples.at(-1).t;
    trace.events = trace.events.filter(e => e.t <= state.time);
    trace.events.push({ t: trace.duration, level: 'warning', code: 'USER_STOP', message: '사용자가 가상 운전을 중단했습니다. 빔·셔터를 비활성화한 중단 상태입니다.' });
    trace.outcome = { status: 'aborted', reason: '사용자 중단 · 완료 공정으로 처리하지 않음' };
    loadTrace(trace); state.time = trace.duration; render(); say('가상 운전을 중단했습니다. 중단 시점까지의 기록을 내보낼 수 있습니다.');
  }
  function tick(now) {
    if (state.playing && state.trace) {
      if (state.last != null) {
        const dt = Math.min(.25, Math.max(0, (now - state.last) / 1000));
        state.time = Math.min(state.trace.duration, state.time + dt * Number($('#speedSelect').value));
        if (state.time >= state.trace.duration) { state.playing = false; state.activeRun = false; lockControls(); }
      }
      state.last = now; render();
    } else state.last = null;
    state.raf = requestAnimationFrame(tick);
  }
  function importData(data) {
    const valid = E.validateTrace(data);
    if (!state.imported) simulationDraft = { recipe: readRecipe(), fault: $('#faultSelect').value };
    writeRecipe(valid.recipe || {});
    loadTrace(valid, true);
    say('로그를 불러왔습니다. 재생 버튼으로 기록을 확인하세요. 기존 Fab 데이터는 유지됩니다.');
  }
  function download() {
    const data = { ...state.trace, exportedAt: new Date().toISOString(), playback: { t: state.time }, scope: 'Offline equipment model/log replay; no manufacturing release decision.' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'waferflow-equipment-' + Date.now() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('현재 화면의 전체 계산 / 불러온 로그를 내보냈습니다. 재생 위치도 함께 기록했습니다.');
  }
  $('#recipeFields').innerHTML = Object.entries(E.PROFILE.fields).map(([k, f]) => '<div class="recipe-field"><label for="recipe-' + k + '">' + escape(f.label) + '<span>' + f.min + '–' + f.max + '</span></label><div class="input-wrap"><input id="recipe-' + k + '" name="' + k + '" type="number" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + f.default + '" aria-describedby="error-' + k + '"><span>' + escape(f.unit) + '</span></div><span id="error-' + k + '" class="field-error"></span></div>').join('');
  $('#readouts').innerHTML = Object.entries(E.CHANNELS).map(([k, c]) => '<div class="readout"><small>' + escape(c.label) + '</small><strong><span id="value-' + k + '">—</span><em>' + escape(c.unit) + '</em></strong><span class="target" id="target-' + k + '">SET —</span></div>').join('');
  $('#digitalStates').innerHTML = [['beam','BEAM'],['shutter','SHUTTER'],['pump','PUMP'],['gate','GATE']].map(([k, label]) => '<span id="digital-' + k + '">● ' + label + '<b>미상</b></span>').join('');
  const view = V.create($('#equipmentViewport'), { onSelect(id) { const part = V.PARTS[id]; if (part) { $('#partTitle').textContent = part.title; $('#partDescription').textContent = part.body; } } });
  writeRecipe(defaults());
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (saved && E.validateRecipe(saved.recipe).ok) { writeRecipe(saved.recipe); if (['none','vacuum','cooling','beam'].includes(saved.fault)) $('#faultSelect').value = saved.fault; }
  } catch (_) { $('#draftStatus').textContent = '저장된 초안을 읽지 못해 기본값을 사용합니다.'; }
  $('#recipeForm').addEventListener('submit', e => e.preventDefault());
  $('#recipeForm').addEventListener('input', () => { state.draftChanged = true; lockControls(); persistDraft(); say('운전 조건 초안이 변경되었습니다. 현재 차트는 이전 계산이며, 실행 버튼으로 다시 계산합니다.'); });
  $('#faultSelect').addEventListener('change', () => { state.draftChanged = true; lockControls(); persistDraft(); say('이상 조건을 변경했습니다. 실행 버튼으로 적용하세요.'); });
  $('#defaultsButton').addEventListener('click', () => { writeRecipe(defaults()); $('#faultSelect').value = 'none'; state.draftChanged = true; lockControls(); persistDraft(); say('예제 기본값을 복원했습니다. 실행 버튼으로 다시 계산하세요.'); });
  $('#runButton').addEventListener('click', startRun); $('#stopButton').addEventListener('click', stopRun);
  $('#playButton').addEventListener('click', play); $('#rewindButton').addEventListener('click', () => seek(state.trace.samples[0].t));
  $('#scrubber').addEventListener('input', () => seek($('#scrubber').value));
  $('#speedSelect').addEventListener('change', () => { state.last = null; render(); });
  $('#channelSelect').addEventListener('change', () => { state.channel = $('#channelSelect').value; buildChart(); render(); });
  $('#traceChart').addEventListener('click', e => {
    const box = $('#traceChart svg').getBoundingClientRect(); if (!box.width) return;
    // Account for SVG xMidYMid meet letterboxing, including narrow mobile charts.
    const scale = Math.min(box.width / 736, box.height / 225), offset = (box.width - 736 * scale) / 2;
    const x = (e.clientX - box.left - offset) / scale;
    seek(state.chart.start + Math.max(0, Math.min(1, (x - 64) / 644)) * state.chart.span);
  });
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async () => {
    const file = $('#importFile').files?.[0]; if (!file) return;
    try { if (file.size > 8 * 1024 * 1024) throw new Error('로그 파일은 8 MB 이하로 선택하세요.'); const text = await file.text(); importData(JSON.parse(text)); }
    catch (e) { say('로그 불러오기 실패: ' + e.message, true); }
    finally { $('#importFile').value = ''; }
  });
  $('#exportButton').addEventListener('click', download);
  $('#returnSimulation').addEventListener('click', () => {
    const recipe = simulationDraft && E.validateRecipe(simulationDraft.recipe).ok ? simulationDraft.recipe : defaults();
    writeRecipe(recipe); $('#faultSelect').value = simulationDraft?.fault || 'none';
    state.draftChanged = false; loadTrace(E.simulate(recipe, $('#faultSelect').value));
    say('독립 예제 모델로 돌아왔습니다. 설정 조건으로 실행할 수 있습니다.');
  });
  $('#sourceButton').addEventListener('click', () => { state.playing = false; state.last = null; render(); $('#sourceDialog').showModal(); });
  $('#closeSource').addEventListener('click', () => $('#sourceDialog').close()); $('#closeSourceBottom').addEventListener('click', () => $('#sourceDialog').close());
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) { state.playing = false; state.last = null; render(); say('화면이 숨겨져 재생을 일시 정지했습니다. 재생 버튼으로 이어갈 수 있습니다.'); } });
  $('#modelVersion').textContent = E.VERSION + ' · 데이터 저장: 이 화면의 초안만';
  loadTrace(E.simulate(readRecipe(), $('#faultSelect').value));
  state.raf = requestAnimationFrame(tick);
  window.EquipmentApp = { startRun, stopRun, seek, play, importData,
    pause() { state.playing = false; state.last = null; render(); },
    useRecipe(trace) {
      if (trace.profileId !== E.PROFILE.id || trace.modelVersion !== E.VERSION) throw new Error('현재 엔진과 장비 프로필·모델 버전이 다릅니다. 기록 재생만 가능합니다.');
      const check = E.validateRecipe(trace.recipe); if (!check.ok) throw new Error('이 기록의 레시피를 현재 예제 모델에서 실행할 수 없습니다.');
      const fault = ['none','vacuum','cooling','beam'].includes(trace.fault) ? trace.fault : 'none';
      const next = E.simulate(trace.recipe, fault);
      writeRecipe(trace.recipe); $('#faultSelect').value = fault; state.draftChanged = false; loadTrace(next); persistDraft();
      say('기록의 조건을 새 계산으로 불러왔습니다. 변경 후 실행해 새 버전으로 보관하세요.');
    },
    snapshot: () => JSON.parse(JSON.stringify({ ...state, raf: undefined, last: undefined, chart: undefined })), dispose() { cancelAnimationFrame(state.raf); view.dispose(); } };
})();

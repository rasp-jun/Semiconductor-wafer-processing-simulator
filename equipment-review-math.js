(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const number = value => Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : '미상';
  function stageSummary(trace, selected = 'process') {
    const channels = {}, intervals = [], samples = trace.samples;
    let duration = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const row = samples[i], dt = samples[i + 1].t - row.t;
      if (row.stage !== selected || dt <= 0) continue;
      duration += dt; intervals.push([row.t, samples[i + 1].t]);
      for (const [key, value] of Object.entries(row.values)) {
        if (!Number.isFinite(value)) continue;
        const c = channels[key] ||= { min:value, max:value, seconds:0, area:0, count:0 };
        c.min = Math.min(c.min, value); c.max = Math.max(c.max, value); c.seconds += dt; c.area += value * dt; c.count++;
      }
    }
    for (const c of Object.values(channels)) { c.mean = c.seconds ? c.area / c.seconds : null; delete c.area; c.coverage = duration ? c.seconds / duration : 0; }
    return { stage:selected, duration, channels, intervals };
  }
  function compare(current, baseline, selected = 'process') {
    if (current.profileId !== baseline.profileId || current.modelVersion !== baseline.modelVersion) return { compatible:false, reason:'장비 프로필 또는 모델 버전이 달라 수치 비교를 보류합니다.', rows:[] };
    const a = stageSummary(current, selected), b = stageSummary(baseline, selected);
    if (!a.duration || !b.duration) return { compatible:false, reason:'두 기록 모두에 선택 단계의 시간 구간이 있어야 합니다.', rows:[], current:a, baseline:b };
    const keys = [...new Set([...Object.keys(a.channels), ...Object.keys(b.channels)])];
    if (keys.some(k => current.units[k] && baseline.units[k] && current.units[k] !== baseline.units[k])) return { compatible:false, reason:'채널 단위가 달라 비교할 수 없습니다.', rows:[] };
    const rows = keys.map(key => ({ key, unit:current.units[key] || baseline.units[key], current:a.channels[key] || null, baseline:b.channels[key] || null,
      delta:a.channels[key] && b.channels[key] ? a.channels[key].mean - b.channels[key].mean : null }));
    const recipe = [...new Set([...Object.keys(current.recipe || {}), ...Object.keys(baseline.recipe || {})])].filter(key => current.recipe?.[key] !== baseline.recipe?.[key]).map(key => ({ key, current:current.recipe?.[key], baseline:baseline.recipe?.[key], unit:key === 'processSeconds' ? 's' : current.units[key] || baseline.units[key] || '' }));
    return { compatible:true, current:a, baseline:b, rows, recipe,
      reason:'단계별 시간 가중 평균 비교입니다. 샘플 사이에는 이전 값을 유지하며, 누락 채널 구간은 평균에서 제외합니다. 통계적 유의성·규격 합격 판정이 아닙니다.' };
  }
  function report(trace, { record = null, baseline = null, selected = 'process', labels = {} } = {}) {
    const result = baseline ? compare(trace, baseline.trace, selected) : null;
    const title = record?.title || '장비 운전 검토 자료';
    const metadata = record ? `<dl><dt>기록 / 버전</dt><dd>${escape(record.id)} / r${record.revision}</dd><dt>작성자 · 시각</dt><dd>${escape(record.author)} / ${escape(record.created_at)}</dd><dt>검토 상태</dt><dd>${escape(record.status)} · ${escape(record.reviewer || '미지정')}</dd><dt>검토 의견</dt><dd>${escape(record.review_note || '없음')}</dd><dt>Lot / 시편</dt><dd>${escape(record.lot_id)}</dd><dt>출처 선언</dt><dd>${escape(record.source_name)}</dd><dt>변경 사유</dt><dd>${escape(record.change_reason)}</dd><dt>서버 기록 SHA-256</dt><dd>${escape(record.trace_sha256)}</dd></dl>` : '<p>현재 브라우저의 계산 기록입니다. 서버 보관·동료 검토 상태가 연결되지 않았습니다.</p>';
    const comparison = !result ? '<p>비교 기준이 지정되지 않았습니다.</p>' : `<p>비교 기준: ${escape(baseline.title || baseline.id || '기준 기록')} · ${escape(baseline.id || '')}<br>SHA-256: ${escape(baseline.trace_sha256 || '로컬 비교 · 서버 해시 없음')}</p><p>${escape(result.reason)}</p>` + (result.compatible ? `<p>단계: ${escape(selected)} · 현재 ${number(result.current.duration)} s / 기준 ${number(result.baseline.duration)} s</p><table><thead><tr><th>채널</th><th>현재 평균</th><th>기준 평균</th><th>차이</th><th>현재 / 기준 커버리지</th></tr></thead><tbody>${result.rows.map(r => `<tr><td>${escape(labels[r.key] || r.key)} (${escape(r.unit)})</td><td>${number(r.current?.mean)}</td><td>${number(r.baseline?.mean)}</td><td>${number(r.delta)}</td><td>${number((r.current?.coverage || 0) * 100)}% / ${number((r.baseline?.coverage || 0) * 100)}%</td></tr>`).join('')}</tbody></table>` : '');
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>body{font:13px/1.7 Arial,'Malgun Gothic',sans-serif;color:#243d4a;max-width:1040px;margin:40px auto;padding:0 24px}h1{font-size:26px}h2{font-size:18px;margin-top:30px}.notice{padding:14px;background:#fff5df;border-left:4px solid #ba9354}dl{display:grid;grid-template-columns:160px 1fr;gap:5px 18px}dt{color:#708894}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}table{border-collapse:collapse;width:100%;font-size:11px}th,td{padding:9px;border-bottom:1px solid #d9e4e9;text-align:left;overflow-wrap:anywhere}th{background:#eef4f6}footer{margin-top:30px;color:#78909b;font-size:11px}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body><p>WAFERFLOW / EQUIPMENT REVIEW</p><h1>${escape(title)}</h1><p class="notice">현장 보정 미완료 · 실장비 적합성 검증 전. 검토 완료는 문서·실험 근거 검토이며 양산 투입 승인이 아닙니다.</p>${metadata}<h2>운전 기록</h2><p>프로필 ${escape(trace.profileId)} · 모델 ${escape(trace.modelVersion)}<br>시간 ${number(trace.duration)} s · ${trace.samples.length} samples · 알람 ${trace.events.filter(e => e.level === 'alarm').length}건<br>기록된 결과: ${escape(trace.outcome.status)} — ${escape(trace.outcome.reason)}</p><h2>계산에 사용한 레시피</h2><table><thead><tr><th>항목</th><th>값</th><th>단위</th></tr></thead><tbody>${Object.entries(trace.recipe || {}).map(([key, value]) => `<tr><td>${escape(labels[key] || key)}</td><td>${number(value)}</td><td>${escape(key === 'processSeconds' ? 's' : trace.units[key] || '미상')}</td></tr>`).join('') || '<tr><td colspan="3">레시피 미제공</td></tr>'}</tbody></table><h2>기준 운전과 비교</h2>${comparison}<h2>상태 전이 · 알람</h2><table><thead><tr><th>시간 / s</th><th>수준 / 코드</th><th>설명</th></tr></thead><tbody>${trace.events.map(e => `<tr><td>${number(e.t)}</td><td>${escape(e.level)} / ${escape(e.code)}</td><td>${escape(e.message)}</td></tr>`).join('')}</tbody></table><footer>보고서 생성 ${new Date().toISOString()} · 전체 기록 기준, 현재 재생 위치·미실행 초안 제외 · 보고서 자체는 디지털 서명되지 않았습니다.</footer></body></html>`;
  }
  root.EquipmentReviewMath = Object.freeze({ stageSummary, compare, report, escape, number });
})(typeof window === 'undefined' ? globalThis : window);

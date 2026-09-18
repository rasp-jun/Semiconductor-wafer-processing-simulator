(function (root) {
  'use strict';

  // Every limit, timing constant and response below is a synthetic example.
  // Public PHM 2018 channel descriptions inform the channel types only.
  const VERSION = 'wf-equipment-0.1.0';
  const SCHEMA = 'waferflow-equipment-trace-v1';
  const SOURCE = 'https://phmsociety.org/conference/annual-conference-of-the-phm-society/annual-conference-of-the-prognostics-and-health-management-society-2018-b/phm-data-challenge-6/';
  const PROFILE = {
    id: 'generic-ion-mill-synthetic-v1',
    label: '범용 이온 밀링 · 예제 장비',
    provenance: { kind: 'synthetic', label: '합성 예제 · 실제 장비 보정 전', source: SOURCE },
    description: '공개된 이온 밀링 로그의 채널 종류를 참고한 오프라인 예제입니다. 수치·제어 규칙·응답 시간은 자체 설정한 합성값이며 삼성·SK하이닉스 또는 장비 제조사의 운전 조건이 아닙니다.',
    fields: {
      pressurePa: { label: '공정 압력', unit: 'Pa', min: 0.05, max: 2, step: 0.05, default: 0.3 },
      beamVoltageV: { label: '빔 전압', unit: 'V', min: 200, max: 1500, step: 10, default: 700 },
      beamCurrentMa: { label: '빔 전류', unit: 'mA', min: 5, max: 120, step: 1, default: 40 },
      heliumPressurePa: { label: '후면 헬륨 압력', unit: 'Pa', min: 100, max: 1600, step: 10, default: 600 },
      rotationRpm: { label: '웨이퍼 회전', unit: 'rpm', min: 1, max: 30, step: 1, default: 10 },
      tiltDeg: { label: '입사 기울기', unit: '°', min: 0, max: 70, step: 1, default: 10 },
      processSeconds: { label: '가공 시간', unit: 's', min: 5, max: 300, step: 1, default: 40 }
    }
  };
  const CHANNELS = {
    pressurePa: { label: '챔버 압력', unit: 'Pa', color: '#72c9ed' },
    beamVoltageV: { label: '빔 전압', unit: 'V', color: '#f5be70' },
    beamCurrentMa: { label: '빔 전류', unit: 'mA', color: '#f495ac' },
    heliumPressurePa: { label: '헬륨 압력', unit: 'Pa', color: '#81d8b5' },
    rotationRpm: { label: '회전 속도', unit: 'rpm', color: '#b4a1fa' },
    tiltDeg: { label: '스테이지 기울기', unit: '°', color: '#d5d98a' }
  };
  const STAGES = [
    { id: 'load', label: '웨이퍼 반입', description: '대기압과 빔 정지를 확인한 뒤 게이트를 열고 웨이퍼를 스테이지에 올립니다.' },
    { id: 'pump', label: '진공 형성', description: '게이트를 닫고 펌프를 작동합니다. 압력이 준비 범위에 도달해야 다음 단계로 진행합니다.' },
    { id: 'stabilize', label: '조건 안정화', description: '헬륨 냉각과 회전·기울기를 맞춘 뒤 빔을 안정화합니다. 셔터는 닫혀 있습니다.' },
    { id: 'process', label: '이온 밀링', description: '진공·냉각·빔 상태가 준비되면 셔터를 열고 설정된 시간 동안 가공합니다.' },
    { id: 'cooldown', label: '빔 정지·냉각', description: '셔터를 닫고 빔을 차단합니다. 냉각을 유지하며 회전과 기울기를 정지 위치로 되돌립니다.' },
    { id: 'vent', label: '압력 복귀', description: '빔과 스테이지 정지를 확인한 뒤 챔버를 대기압 근처로 복귀시킵니다.' },
    { id: 'unload', label: '웨이퍼 반출', description: '압력 복귀와 빔 정지를 확인한 뒤 게이트를 열고 웨이퍼를 반출합니다.' }
  ];
  const keys = Object.keys(CHANNELS), fields = Object.keys(PROFILE.fields);
  const units = Object.fromEntries(keys.map(k => [k, CHANNELS[k].unit]));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const copy = o => JSON.parse(JSON.stringify(o));
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const inputNumber = v => typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const round = v => Math.round(v * 1e8) / 1e8;
  function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }

  function validateRecipe(recipe) {
    const errors = [], checks = [], numeric = {};
    if (!object(recipe)) return { ok: false, errors: [{ field: '', message: '레시피는 조건 객체여야 합니다.' }], checks: [] };
    for (const key of fields) {
      const f = PROFILE.fields[key], n = own(recipe, key) ? inputNumber(recipe[key]) : NaN;
      numeric[key] = n;
      if (!Number.isFinite(n)) errors.push({ field: key, message: `${f.label}: 비어 있지 않은 유한한 숫자를 입력하세요.` });
      else if (n < f.min || n > f.max) errors.push({ field: key, message: `${f.label}: 예제 범위 ${f.min}–${f.max} ${f.unit} 안에서 입력하세요.` });
    }
    for (const key of Object.keys(recipe)) if (!fields.includes(key)) errors.push({ field: key, message: `지원하지 않는 조건입니다: ${key.slice(0, 60)}` });
    checks.push({ label: '숫자·예제 범위 검사', status: errors.length ? 'fail' : 'pass', detail: errors.length ? `${errors.length}개 입력을 확인하세요.` : '7개 조건이 합성 프로필의 입력 범위 안에 있습니다.' });
    if (!errors.length) {
      const watts = numeric.beamVoltageV * numeric.beamCurrentMa / 1000;
      const powerOK = watts <= 100;
      checks.push({ label: '빔 부하 조합', status: powerOK ? 'pass' : 'fail', detail: `전압×전류 = ${round(watts)} W. 이 예제의 조합 한계는 100 W입니다.` });
      if (!powerOK) errors.push({ field: 'beamCurrentMa', message: '예제 빔 부하가 100 W를 넘습니다. 전류 또는 전압을 낮추세요.' });
      const required = 150 + 2.5 * watts, coolingOK = numeric.heliumPressurePa >= required;
      checks.push({ label: '냉각 조건 조합', status: coolingOK ? 'pass' : 'fail', detail: `합성 규칙 150 + 2.5×빔 부하에 따른 최소 헬륨 압력은 ${round(required)} Pa입니다.` });
      if (!coolingOK) errors.push({ field: 'heliumPressurePa', message: `합성 냉각 규칙에 따라 헬륨 압력이 ${round(required)} Pa 이상이어야 합니다.` });
    }
    checks.push({ label: '실제 장비 적합성', status: 'info', detail: '검증 불가 · 제조사 한계값, 현장 인터록, 실측 응답 데이터로 보정하지 않은 합성 프로필입니다.' });
    return { ok: errors.length === 0, errors, checks };
  }

  function simulate(input, fault = 'none') {
    const validation = validateRecipe(input);
    if (!validation.ok) throw new Error(validation.errors.map(e => e.message).join('\n'));
    if (!['none', 'vacuum', 'cooling', 'beam'].includes(fault)) throw new Error('지원하지 않는 고장 시나리오입니다.');
    const recipe = Object.fromEntries(fields.map(k => [k, inputNumber(input[k])])), dt = 0.25, atmosphere = 101325;
    const samples = [], events = [];
    let t = 0, index = 0, entered = 0, stable = 0, deviation = 0, injected = false, done = false;
    let outcome = { status: 'completed', reason: '예제 상태 순서와 조건 검사를 모두 완료했습니다. 실제 장비 적합성은 검증되지 않았습니다.' };
    const values = { pressurePa: atmosphere, beamVoltageV: 0, beamCurrentMa: 0, heliumPressurePa: 0, rotationRpm: 0, tiltDeg: 0 };
    let targets = { ...values }, digital = { beam: false, shutter: false, pump: false, gate: true, robot: 0, wafer: false };
    const addEvent = (level, code, message) => events.push({ t: round(t), level, code, message });
    const record = () => samples.push({ t: round(t), stage: STAGES[index].id, values: Object.fromEntries(keys.map(k => [k, round(values[k])])), targets: Object.fromEntries(keys.map(k => [k, round(targets[k])])), digital: { ...digital, robot: round(digital.robot) } });
    const advance = () => {
      index++; entered = t; stable = 0; deviation = 0;
      const stage = STAGES[index].id, processing = stage === 'process', cooling = ['stabilize', 'process', 'cooldown'].includes(stage);
      // Entry commands belong to the newly recorded stage, not to its predecessor.
      targets = { pressurePa: ['vent', 'unload'].includes(stage) ? atmosphere : recipe.pressurePa, beamVoltageV: processing ? recipe.beamVoltageV : 0, beamCurrentMa: processing ? recipe.beamCurrentMa : 0, heliumPressurePa: cooling ? recipe.heliumPressurePa : 0, rotationRpm: ['stabilize', 'process'].includes(stage) ? recipe.rotationRpm : 0, tiltDeg: ['stabilize', 'process'].includes(stage) ? recipe.tiltDeg : 0 };
      digital = { beam: processing, shutter: processing, pump: ['pump', 'stabilize', 'process', 'cooldown'].includes(stage), gate: stage === 'unload' && values.pressurePa >= atmosphere * 0.995 && values.beamVoltageV < 1 && values.beamCurrentMa < 0.1 && values.rotationRpm < 0.05, robot: 0, wafer: true };
      addEvent('info', `STAGE_${stage.toUpperCase()}`, `${STAGES[index].label} 시작`);
    };
    const abort = (code, reason) => {
      outcome = { status: 'aborted', reason };
      digital = { ...digital, beam: false, shutter: false, gate: false, robot: 0 };
      targets = { ...targets, beamVoltageV: 0, beamCurrentMa: 0, rotationRpm: 0, tiltDeg: values.tiltDeg };
      addEvent('alarm', code, `${reason} 빔 명령 차단·셔터 닫힘·반송 금지. 센서 값은 트립 시점 관측값입니다.`);
      done = true;
    };
    const near = (k, fraction = 0.05, floor = 0.05) => Math.abs(values[k] - recipe[k]) <= Math.max(floor, recipe[k] * fraction);
    addEvent('info', 'SYNTHETIC_DATA', '모든 수치와 응답은 합성 예제입니다. 실제 장비 로그 또는 제조사 운전 조건이 아닙니다.');
    addEvent('info', 'STAGE_LOAD', '웨이퍼 반입 시작');
    record();
    while (!done && t < 1800) {
      const stage = STAGES[index].id, elapsed = t - entered;
      targets = { pressurePa: recipe.pressurePa, beamVoltageV: 0, beamCurrentMa: 0, heliumPressurePa: 0, rotationRpm: 0, tiltDeg: 0 };
      digital = { ...digital, beam: false, shutter: false, pump: ['pump', 'stabilize', 'process', 'cooldown'].includes(stage), gate: false, robot: 0 };
      if (stage === 'load' || stage === 'unload') {
        targets.pressurePa = atmosphere;
        digital.gate = values.pressurePa >= atmosphere * 0.995 && values.beamVoltageV < 1 && values.beamCurrentMa < 0.1 && values.rotationRpm < 0.05;
        if (!digital.gate) abort('GATE_INTERLOCK', '대기압 복귀 또는 빔·회전 정지 조건을 만족하지 않아 게이트 개방을 금지했습니다.');
        else {
          const position = Math.min(1, (elapsed + dt) / 6);
          digital.robot = Math.sin(Math.PI * position) ** 2;
          // wafer means seated on the process stage; the robot carries it before/after the midpoint.
          digital.wafer = stage === 'load' ? position >= 0.5 : position < 0.5;
        }
      } else if (stage === 'pump') {
        digital.wafer = true;
      } else if (stage === 'stabilize' || stage === 'process') {
        targets.heliumPressurePa = recipe.heliumPressurePa;
        targets.rotationRpm = recipe.rotationRpm;
        targets.tiltDeg = recipe.tiltDeg;
        const ready = values.pressurePa <= recipe.pressurePa * 1.15 && values.heliumPressurePa >= recipe.heliumPressurePa * (stage === 'stabilize' ? 0.9 : 0.75);
        digital.beam = ready;
        digital.shutter = stage === 'process' && ready;
        if (ready) { targets.beamVoltageV = recipe.beamVoltageV; targets.beamCurrentMa = recipe.beamCurrentMa; }
        if (stage === 'process' && elapsed >= Math.min(8, recipe.processSeconds * 0.35) && ['cooling', 'beam'].includes(fault)) {
          if (!injected) { injected = true; addEvent('warning', `FAULT_${fault.toUpperCase()}`, fault === 'cooling' ? '합성 고장 주입: 헬륨 압력 손실' : '합성 고장 주입: 빔 전류 편차'); }
          // Setpoints stay at the requested recipe; the fault changes the observed response below.
        }
      } else if (stage === 'cooldown') {
        targets.heliumPressurePa = recipe.heliumPressurePa;
      } else if (stage === 'vent') targets.pressurePa = atmosphere;
      if (!done) {
        for (const k of keys) {
          const tau = k === 'pressurePa' ? (stage === 'vent' ? 3 : 4) : k === 'heliumPressurePa' ? 2 : k === 'beamVoltageV' ? 1.2 : k === 'beamCurrentMa' ? 0.8 : 1.8;
          let responseTarget = targets[k];
          if (k === 'pressurePa' && stage === 'pump' && fault === 'vacuum') responseTarget = 20;
          if (k === 'heliumPressurePa' && stage === 'process' && fault === 'cooling' && injected) responseTarget = 20;
          if (k === 'beamCurrentMa' && stage === 'process' && fault === 'beam' && injected) responseTarget *= 1.55;
          values[k] += (responseTarget - values[k]) * (1 - Math.exp(-dt / tau));
        }
        t = round(t + dt);
        const age = t - entered;
        if (stage === 'load' && age >= 6) { digital.robot = 0; digital.gate = false; advance(); }
        else if (stage === 'pump') {
          if (values.pressurePa <= recipe.pressurePa * 1.05) advance();
          else if (age >= 90) abort('VACUUM_TIMEOUT', '90초 안에 예제 진공 준비 압력에 도달하지 못했습니다.');
        } else if (stage === 'stabilize') {
          stable = digital.beam && near('beamVoltageV') && near('beamCurrentMa') && near('heliumPressurePa') && near('rotationRpm') && near('tiltDeg', 0.02, 0.5) ? stable + dt : 0;
          if (stable >= 2) advance();
          else if (age >= 30) abort('STABILIZE_TIMEOUT', '30초 안에 빔·냉각·스테이지 안정 조건에 도달하지 못했습니다.');
        } else if (stage === 'process') {
          if (values.pressurePa > recipe.pressurePa * 1.25) abort('VACUUM_INTERLOCK', '가공 중 예제 진공 허용 압력을 벗어났습니다.');
          else if (values.heliumPressurePa < recipe.heliumPressurePa * 0.75) abort('COOLING_INTERLOCK', '가공 중 헬륨 압력이 설정값의 75% 아래로 떨어졌습니다.');
          else {
            deviation = Math.abs(values.beamCurrentMa - recipe.beamCurrentMa) > recipe.beamCurrentMa * 0.2 || Math.abs(values.beamVoltageV - recipe.beamVoltageV) > recipe.beamVoltageV * 0.2 ? deviation + dt : 0;
            if (deviation >= 1) abort('BEAM_DEVIATION', '빔 전압 또는 전류가 설정값에서 20% 넘게 벗어난 상태가 1초 지속되었습니다.');
            else if (age >= recipe.processSeconds) { digital.beam = false; digital.shutter = false; targets.beamVoltageV = 0; targets.beamCurrentMa = 0; advance(); }
          }
        } else if (stage === 'cooldown') {
          if (age >= 6 && values.beamVoltageV < 1 && values.beamCurrentMa < 0.1 && values.rotationRpm < 0.05 && values.tiltDeg < 0.05) advance();
          else if (age >= 25) abort('COOLDOWN_TIMEOUT', '냉각 대기 시간 안에 빔·회전·기울기 정지 조건을 만족하지 못했습니다.');
        } else if (stage === 'vent') {
          if (values.pressurePa >= atmosphere * 0.995 && values.beamVoltageV < 1 && values.beamCurrentMa < 0.1 && values.rotationRpm < 0.05) advance();
          else if (age >= 40) abort('VENT_TIMEOUT', '40초 안에 예제 반출 압력에 도달하지 못했습니다.');
        } else if (stage === 'unload' && age >= 6) {
          digital.robot = 0; digital.wafer = false; done = true; addEvent('info', 'RUN_COMPLETED', '예제 시퀀스 완료. 웨이퍼 반출 및 빔 차단 상태를 확인했습니다.');
        }
      }
      // An interlock before integration uses the current sample timestamp; replace rather than duplicate it.
      if (samples.length && samples[samples.length - 1].t === t) samples.pop();
      record();
    }
    if (!done) { abort('RUN_TIMEOUT', '최대 예제 실행 시간 1800초를 초과했습니다.'); samples.pop(); record(); }
    return { schema: SCHEMA, modelVersion: VERSION, profileId: PROFILE.id, provenance: copy(PROFILE.provenance), units: { ...units }, recipe, fault, samples, events, outcome, duration: round(t) };
  }

  function validateTrace(data) {
    const fail = message => { throw new Error(`로그 형식 오류: ${message}`); };
    const text = (v, label, max = 500) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail(`${label}은 ${max}자 이내의 문자열이어야 합니다.`); return v; };
    const checkObject = (o, label) => { if (!object(o)) fail(`${label}은 객체여야 합니다.`); };
    const checkNumber = (v, label) => { if (!finite(v) || Math.abs(v) > 1e12) fail(`${label}은 유한한 숫자여야 합니다.`); return v; };
    // Reject prototype pollution and accessors before reading nested user-controlled objects.
    let visited = 0;
    const audit = (v, depth = 0) => {
      if (++visited > 1000000 || depth > 12) fail('중첩 또는 데이터 크기 한도를 초과했습니다.');
      if (!v || typeof v !== 'object') { if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') fail('JSON으로 표현할 수 없는 값입니다.'); return; }
      const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
      if (proto) {
        const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
        if (!ctor || typeof ctor.value !== 'function' || ctor.value.name !== (array ? 'Array' : 'Object') || ctor.value.prototype !== proto || !Function.prototype.toString.call(ctor.value).includes('[native code]')) fail('일반 JSON 객체와 배열만 가져올 수 있습니다.');
      } else if (array) fail('일반 JSON 배열만 가져올 수 있습니다.');
      if (Object.getOwnPropertySymbols(v).length) fail('JSON에 없는 기호 속성을 포함할 수 없습니다.');
      for (const k of Object.getOwnPropertyNames(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('허용되지 않는 객체 키가 있습니다.');
        if (array && k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k)) fail('배열에는 순서대로 저장된 데이터만 포함할 수 있습니다.');
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (d.get || d.set) fail('실행 가능한 속성을 포함할 수 없습니다.');
        audit(d.value, depth + 1);
      }
    };
    audit(data); checkObject(data, '로그');
    if (data.schema !== SCHEMA) fail(`schema는 ${SCHEMA}여야 합니다.`);
    const modelVersion = text(data.modelVersion, '모델 버전', 80), profileId = text(data.profileId, '장비 프로필 ID', 100);
    checkObject(data.units, 'units 단위표');
    const importedUnits = {};
    for (const k of Object.keys(data.units)) {
      if (!own(CHANNELS, k)) fail(`지원하지 않는 단위 채널: ${k.slice(0, 60)}`);
      if (data.units[k] !== CHANNELS[k].unit) fail(`${CHANNELS[k].label}의 단위는 ${CHANNELS[k].unit}이어야 합니다. 단위가 없거나 다른 값은 자동 변환하지 않습니다.`);
      importedUnits[k] = data.units[k];
    }
    if (!Object.keys(importedUnits).length) fail('인식 가능한 채널 단위가 하나 이상 필요합니다.');
    if (!Array.isArray(data.samples) || data.samples.length < 2 || data.samples.length > 15000) fail('samples는 2–15000개여야 합니다.');
    const readChannels = (o, label) => {
      checkObject(o, label); const result = {};
      for (const k of Object.keys(o)) {
        if (!own(CHANNELS, k)) fail(`${label}에 지원하지 않는 채널이 있습니다: ${k.slice(0, 60)}`);
        if (!own(importedUnits, k)) fail(`${CHANNELS[k].label}의 단위 선언이 없습니다.`);
        result[k] = checkNumber(o[k], `${label}.${k}`);
      }
      return result;
    };
    let previous = -1;
    const samples = data.samples.map((row, i) => {
      checkObject(row, `samples[${i}]`);
      const t = checkNumber(row.t, `samples[${i}].t`);
      if (t < 0 || t > 1800 || t <= previous || (i === 0 && t !== 0)) fail('시간은 0초부터 시작하여 중복 없이 증가해야 하며 최대 1800초입니다.');
      previous = t;
      if (![...STAGES.map(s => s.id), 'unknown'].includes(row.stage)) fail(`samples[${i}]의 공정 단계가 인식되지 않습니다.`);
      const values = readChannels(row.values, `samples[${i}].values`);
      if (!Object.keys(values).length) fail(`samples[${i}]에 인식 가능한 센서 값이 없습니다.`);
      const result = { t, stage: row.stage, values };
      if (own(row, 'targets')) result.targets = readChannels(row.targets, `samples[${i}].targets`);
      if (own(row, 'digital')) {
        checkObject(row.digital, `samples[${i}].digital`); result.digital = {};
        for (const k of Object.keys(row.digital)) {
          if (!['beam', 'shutter', 'pump', 'gate', 'robot', 'wafer'].includes(k)) fail(`지원하지 않는 디지털 채널: ${k.slice(0, 60)}`);
          const v = row.digital[k];
          if (k === 'robot' ? !finite(v) || v < 0 || v > 1 : typeof v !== 'boolean') fail(`samples[${i}].digital.${k}의 값이 올바르지 않습니다.`);
          result.digital[k] = v;
        }
      }
      return result;
    });
    const duration = samples[samples.length - 1].t;
    if (own(data, 'duration') && (!finite(data.duration) || Math.abs(data.duration - duration) > 1e-6)) fail('duration이 마지막 샘플 시간과 일치하지 않습니다.');
    if (!Array.isArray(data.events) || data.events.length > 5000) fail('events는 최대 5000개의 배열이어야 합니다.');
    previous = -1;
    const events = data.events.map((event, i) => {
      checkObject(event, `events[${i}]`); const t = checkNumber(event.t, `events[${i}].t`);
      if (t < 0 || t > duration || t < previous) fail('이벤트 시간은 기록 범위 안에서 증가하는 순서여야 합니다.'); previous = t;
      if (!['info', 'warning', 'alarm'].includes(event.level)) fail('이벤트 수준은 info, warning, alarm 중 하나여야 합니다.');
      return { t, level: event.level, code: text(event.code, '이벤트 코드', 80), message: text(event.message, '이벤트 설명', 1000) };
    });
    checkObject(data.outcome, 'outcome');
    if (!['completed', 'aborted'].includes(data.outcome.status)) fail('결과 상태는 completed 또는 aborted여야 합니다.');
    const outcome = { status: data.outcome.status, reason: text(data.outcome.reason, '결과 설명', 1000) };
    const normalized = { schema: SCHEMA, modelVersion, profileId, provenance: { kind: 'unverified', label: '가져온 로그 · 출처 및 단위 선언 미검증', source: '사용자가 가져온 JSON · 출처 주장은 확인되지 않음' }, units: importedUnits, samples, events, outcome, duration };
    if (own(data, 'recipe')) {
      checkObject(data.recipe, 'recipe'); normalized.recipe = {};
      for (const k of Object.keys(data.recipe)) {
        if (!fields.includes(k)) fail(`지원하지 않는 레시피 조건: ${k.slice(0, 60)}`);
        // Imported setpoints use the same declared engineering units as observed channels.
        // processSeconds is the schema's elapsed processing duration in seconds, like sample.t.
        if (own(CHANNELS, k) && !own(importedUnits, k)) fail(`레시피 ${CHANNELS[k].label}의 단위 선언이 없습니다.`);
        normalized.recipe[k] = checkNumber(data.recipe[k], `recipe.${k}`);
      }
    }
    if (own(data, 'fault')) normalized.fault = text(data.fault, '고장 시나리오', 80);
    return normalized;
  }

  root.EquipmentEngine = Object.freeze({ VERSION, PROFILE: freeze(PROFILE), CHANNELS: freeze(CHANNELS), STAGES: freeze(STAGES), validateRecipe, simulate, validateTrace });
})(typeof window === 'undefined' ? globalThis : window);

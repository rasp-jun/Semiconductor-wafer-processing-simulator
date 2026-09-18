/* WaferFlow educational surrogate v0.2. All coefficients are illustrative, not fab calibration. */
(function (root) {
  'use strict';
  const version = 'wf-edu-0.2.0';
  const fields = {
    temperature: { label: '산화 온도', unit: '°C', min: 850, max: 1100, step: 5 },
    oxidationTime: { label: '산화 시간', unit: 'min', min: 10, max: 90, step: 1 },
    rpm: { label: '스핀 속도', unit: 'rpm', min: 1500, max: 5000, step: 100 },
    bakeTemp: { label: '소프트베이크 온도', unit: '°C', min: 80, max: 130, step: 1 },
    bakeTime: { label: '소프트베이크 시간', unit: 's', min: 30, max: 120, step: 1 },
    pebTemp: { label: 'PEB 온도', unit: '°C', min: 90, max: 130, step: 1 },
    dose: { label: '노광량', unit: 'mJ/cm²', min: 70, max: 150, step: 1 },
    focus: { label: '초점 오프셋', unit: 'µm', min: -1, max: 1, step: 0.05 },
    developTime: { label: '현상 시간', unit: 's', min: 30, max: 90, step: 1 },
    power: { label: 'RF 파워', unit: 'W', min: 100, max: 400, step: 5 },
    pressure: { label: '챔버 압력', unit: 'mTorr', min: 10, max: 80, step: 1 },
    etchTime: { label: '식각 시간', unit: 's', min: 30, max: 150, step: 1 }
  };
  const stages = [
    { id: 'oxidation', name: '열산화', english: 'Thermal oxidation', short: 'OX', fields: ['temperature', 'oxidationTime'], description: '고온에서 산소가 실리콘과 반응해 산화막을 성장시킵니다. 산화막이 두꺼워질수록 성장 속도가 느려지는 관계를 관찰하세요.', equipment: '산화로 · O₂ atmosphere' },
    { id: 'coat', name: '감광액 도포', english: 'Spin coating', short: 'PR', fields: ['rpm'], description: '웨이퍼를 회전시켜 양성 감광액을 펼칩니다. 이 모델에서는 회전 속도가 높을수록 감광막이 얇아집니다.', equipment: '스핀 코터 · Positive PR' },
    { id: 'softbake', name: '소프트베이크', english: 'Soft bake', short: 'SB', fields: ['bakeTemp', 'bakeTime'], description: '도포한 감광막의 용매를 줄여 막을 안정화합니다. 베이크 온도와 시간의 편차가 패턴 품질에 영향을 주는 교육용 관계를 적용했습니다.', equipment: '핫플레이트 · 용매 제거' },
    { id: 'exposure', name: '정렬 · 노광', english: 'Alignment & exposure', short: 'UV', fields: ['dose', 'focus'], description: '마스크 개구부를 통과한 빛이 양성 감광막의 용해 특성을 바꿉니다. 빛을 받은 부분은 아직 남아 있다가 현상 단계에서 제거됩니다.', equipment: '광학 노광기 · 365 nm, 교육용' },
    { id: 'peb', name: '노광 후 베이크', english: 'Post-exposure bake', short: 'PEB', fields: ['pebTemp'], description: '선택한 교육용 레시피의 노광 후 베이크입니다. 필요 여부와 목적은 감광액에 따라 다르며, 여기서는 패턴 안정화와 온도 편차를 보여줍니다.', equipment: 'PEB 핫플레이트 · 고정 60 s' },
    { id: 'develop', name: '현상', english: 'Development', short: 'DEV', fields: ['developTime'], description: '빛을 받은 양성 감광막을 제거해 식각 창을 엽니다. 부족한 현상은 잔사를, 과도한 현상은 패턴 손실을 유발하도록 구성했습니다.', equipment: '현상 모듈 · Positive-tone' },
    { id: 'etch', name: '플라즈마 식각', english: 'Plasma etching', short: 'RIE', fields: ['power', 'pressure', 'etchTime'], description: '플라즈마의 이온과 반응종이 노출된 산화막을 제거합니다. 충분히 제거하면서 실리콘 손상과 가장자리 편차를 줄이는 조건을 찾으세요.', equipment: 'RIE 챔버 · 개념 단면' },
    { id: 'strip', name: '감광막 제거', english: 'Resist stripping', short: 'STR', fields: [], description: '남아 있는 감광막을 제거하고 산화막 패턴을 확인합니다. 보호된 산화막과 개구부의 잔류막을 구분해 보세요.', equipment: 'PR strip · 최종 검사' }
  ];
  const defaults = { temperature: 1000, oxidationTime: 40, rpm: 3000, bakeTemp: 100, bakeTime: 60, pebTemp: 110, dose: 100, focus: 0, developTime: 60, power: 220, pressure: 30, etchTime: 80 };
  const missions = [
    { id: 'edge', code: 'CASE 001', title: '사라진 가장자리 수율을 찾아서', subtitle: '가장자리 과식각', level: '입문', focusStage: 6, target: 90, budget: 150, seed: 701, defaults: { ...defaults, power: 310 }, description: '가장자리에 모인 불량. 식각 조건을 바꿔 수율 90%와 가상 비용 $150 이하를 함께 달성하세요.', hint: 'RF 파워만 220 W 부근으로 낮춰 기준과 비교해 보세요. 너무 낮추면 잔류막이 생길 수 있습니다.' },
    { id: 'residue', code: 'CASE 002', title: '열리지 않는 식각 창의 비밀', subtitle: '현상 잔사', level: '기초', focusStage: 5, target: 90, budget: 150, seed: 902, defaults: { ...defaults, dose: 90, developTime: 52 }, description: '식각을 늘려도 남는 잔류막. 노광과 현상의 연결을 살펴 수율 90% 이상을 달성하세요.', hint: '식각보다 앞선 공정을 확인하세요. 노광량 100 mJ/cm², 현상 시간 60 s를 한 변수씩 비교해 보세요.' },
    { id: 'focus', code: 'CASE 003', title: '흔들리는 패턴, 좁아진 공정창', subtitle: '초점과 균일도', level: '응용', focusStage: 3, target: 93, budget: 150, seed: 1203, defaults: { ...defaults, focus: 0.7, pressure: 65 }, description: '초점 오차와 압력 편차가 함께 작용합니다. 공정창을 비교해 수율 93% 이상을 달성하세요.', hint: '초점을 0 µm에 가깝게 맞춘 뒤 압력을 30 mTorr 부근으로 조절하세요. 두 변수의 효과를 따로 기록해 보세요.' }
  ];
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const round = (v, n = 2) => Number(v.toFixed(n));
  function normalize(input) {
    const out = {};
    for (const [key, f] of Object.entries(fields)) {
      const value = Number(input?.[key]);
      out[key] = round(clamp(Number.isFinite(value) ? value : defaults[key], f.min, f.max), 3);
    }
    return out;
  }
  // Stateless coordinate noise: stable between runs, common random numbers for A/B comparisons.
  function noise(x, y, seed) {
    let n = Math.imul(x + 43, 374761393) ^ Math.imul(y + 47, 668265263) ^ Math.imul(seed, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function simulate(input, missionId = 'edge', seedOverride) {
    const p = normalize(input);
    const mission = missions.find(m => m.id === missionId) || missions[0];
    const seed = seedOverride ?? mission.seed;
    // Deal–Grove functional form, illustrative A/B at 1000 °C; nm, min.
    const A = 180;
    const B = 700 * Math.exp((p.temperature - 1000) / 90);
    const oxide = (Math.sqrt(A * A + 4 * B * p.oxidationTime) - A) / 2;
    const pr = 850 * Math.sqrt(3000 / p.rpm);
    const rate = 1.25 * Math.pow(p.power / 220, 0.72) * Math.pow(30 / p.pressure, 0.12);
    const depth = rate * p.etchTime;
    const bakePenalty = Math.abs(p.bakeTemp - 100) / 80 + Math.abs(p.bakeTime - 60) / 200 + Math.abs(p.pebTemp - 110) / 120;
    const develop = (p.dose / 100) * (p.developTime / 60) * Math.max(.5, 1 - bakePenalty * .3);
    const cd = 500 + (p.dose - 100) * 1.4 + 40 * p.focus ** 2 + (p.developTime - 60) * 0.5;
    const residue = Math.max(0, 1 - develop) * pr * 0.18;
    const edgeStress = Math.max(0, p.power - 240) / 130;
    const uniformity = 1.4 + Math.abs(p.pressure - 30) * 0.11 + Math.abs(p.rpm - 3000) * 0.0015;
    const dies = [];
    for (let y = -13; y <= 13; y++) for (let x = -13; x <= 13; x++) {
      const radius = Math.sqrt(x * x + y * y) / 13.5;
      if (radius > 0.965 || (y === 13 && Math.abs(x) < 2)) continue;
      const localNoise = noise(x, y, seed);
      const radial = Math.pow(radius, 3);
      const localDepth = depth * (1 + radial * (uniformity / 100 + edgeStress * 0.3) + (localNoise - 0.5) * 0.04);
      const localOxide = oxide * (1 + (radius ** 2 - .5) * uniformity / 100);
      const localResidue = Math.max(0, localOxide - localDepth) + residue;
      const damage = Math.max(0, localDepth - localOxide * 1.16);
      const localCD = cd + (localNoise - .5) * (8 + Math.abs(p.focus) * 85) + (x / 13) * p.focus * 18;
      const risks = [
        { kind: '과식각', risk: clamp(damage / 65 + edgeStress * radial * .65, 0, .96) },
        { kind: '잔류막', risk: clamp(localResidue / 55, 0, .97) },
        { kind: '패턴 편차', risk: clamp(Math.max(0, Math.abs(localCD - 500) - 30) / 90 + Math.abs(p.focus) ** 2 * .3 + bakePenalty * .2, 0, .96) },
        { kind: '배경 결함', risk: .018 }
      ].sort((a, b) => b.risk - a.risk);
      const probability = 1 - risks.reduce((acc, item) => acc * (1 - item.risk), 1);
      const failed = noise(x + 73, y - 31, seed) < probability;
      dies.push({ x, y, radius: round(radius, 4), failed, kind: failed ? risks[0].kind : '정상', depth: round(localDepth), residue: round(localResidue), cd: round(localCD), risk: round(probability, 4) });
    }
    const bad = dies.filter(d => d.failed).length;
    const yieldRate = round((dies.length - bad) / dies.length * 100, 1);
    const cost = round(58 + p.oxidationTime * .6 + p.temperature * .016 + p.etchTime * .12 + p.power * .025 + p.dose * .055 + p.developTime * .05);
    const cycleTime = round(p.oxidationTime + p.etchTime / 60 + p.developTime / 60 + p.bakeTime / 60 + 6, 1);
    const distribution = ['과식각', '잔류막', '패턴 편차', '배경 결함'].map(kind => ({ kind, count: dies.filter(d => d.failed && d.kind === kind).length }));
    const dominant = [...distribution].sort((a, b) => b.count - a.count)[0].kind;
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    const minimum = Math.min(...dies.map(d => d.depth));
    const maximum = Math.max(...dies.map(d => d.depth));
    const span = maximum - minimum || 1;
    dies.forEach(d => counts[Math.min(7, Math.floor((d.depth - minimum) / span * 8))]++);
    const mean = dies.reduce((sum, d) => sum + d.depth, 0) / dies.length;
    const sigma = Math.sqrt(dies.reduce((sum, d) => sum + (d.depth - mean) ** 2, 0) / dies.length);
    return { version, source: 'synthetic-educational-model', missionId: mission.id, seed, params: p, dies, total: dies.length, bad, good: dies.length - bad, yield: yieldRate, cost, cycleTime, oxide: round(oxide), pr: round(pr), etchRate: round(rate), depth: round(depth), residue: round(residue), cd: round(cd), uniformity: round(uniformity), distribution, dominant, histogram: { counts, min: round(minimum), max: round(maximum), mean: round(mean), sigma: round(sigma) }, passed: yieldRate >= mission.target && cost <= mission.budget };
  }
  function sweep(input, missionId, key, samples = 9) {
    const f = fields[key];
    if (!f) throw new Error('Unknown parameter');
    const count = clamp(Math.round(samples), 2, 50);
    return Array.from({ length: count }, (_, i) => {
      const value = round(f.min + (f.max - f.min) * i / (count - 1), 2);
      const result = simulate({ ...input, [key]: value }, missionId);
      return { value, yield: result.yield, cost: result.cost, passed: result.passed };
    });
  }
  function monteCarlo(input, missionId, count = 30) {
    const runs = clamp(Math.round(count), 2, 100);
    const mission = missions.find(m => m.id === missionId) || missions[0];
    const samples = Array.from({ length: runs }, (_, i) => simulate(input, mission.id, mission.seed + i * 17));
    const values = samples.map(s => s.yield).sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / runs;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (runs - 1));
    const halfWidth = 1.96 * sd / Math.sqrt(runs);
    return { runs, mean: round(mean), sd: round(sd), interval: [round(Math.max(0, mean - halfWidth)), round(Math.min(100, mean + halfWidth))], min: values[0], max: values[values.length - 1], samples: values, note: '고정 레시피에서 난수 시드만 변경한 합성 표본. 평균 수율의 정규 근사 95% 구간이며 모델 정확도의 신뢰구간이 아님.' };
  }
  root.WaferEngine = { version, fields, stages, defaults, missions, normalize, simulate, sweep, monteCarlo };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WaferEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);

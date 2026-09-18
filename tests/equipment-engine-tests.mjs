import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export async function runEquipmentEngineTests(root) {
  const tests = [], test = (name, fn) => { fn(); tests.push({ name, status: 'passed' }); };
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(root + '/equipment-engine.js', 'utf8'), context);
  const E = context.EquipmentEngine;
  const clone = o => JSON.parse(JSON.stringify(o));
  const recipe = Object.fromEntries(Object.entries(E.PROFILE.fields).map(([k, f]) => [k, f.default]));
  const normal = E.simulate(recipe);
  const changed = fn => { const trace = clone(normal); fn(trace); return trace; };

  test('Profile is explicit synthetic data with public channel provenance and immutable definitions', () => {
    assert.equal(E.PROFILE.provenance.kind, 'synthetic');
    assert(E.PROFILE.provenance.source.startsWith('https://phmsociety.org/'));
    assert(E.PROFILE.description.includes('삼성·SK하이닉스'));
    assert(Object.isFrozen(E.PROFILE.fields.pressurePa));
    assert.equal(normal.modelVersion, E.VERSION);
    assert.equal(normal.profileId, E.PROFILE.id);
    assert.equal(normal.provenance.kind, 'synthetic');
    for (const [key, channel] of Object.entries(E.CHANNELS)) assert.equal(normal.units[key], channel.unit);
  });
  test('Reference sequence reaches all seven stages in order and retains a completed terminal sample', () => {
    assert.equal(normal.outcome.status, 'completed');
    assert.deepEqual([...new Set(normal.samples.map(s => s.stage))], clone(E.STAGES.map(s => s.id)));
    assert.equal(normal.events.filter(e => e.level === 'alarm').length, 0);
    assert.equal(normal.duration, normal.samples.at(-1).t);
    assert.equal(normal.samples.at(-1).digital.wafer, false);
    assert.equal(normal.samples.at(-1).digital.robot, 0);
    assert.equal(normal.samples.at(-1).digital.beam, false);
    assert.equal(normal.samples.at(-1).digital.shutter, false);
    assert.equal(normal.events.at(-1).code, 'RUN_COMPLETED');
  });
  test('Simulation is deterministic, detached and does not mutate recipe input', () => {
    const before = JSON.stringify(recipe);
    assert.equal(JSON.stringify(E.simulate(recipe)), JSON.stringify(normal));
    assert.equal(JSON.stringify(recipe), before);
    const another = E.simulate(recipe); another.recipe.pressurePa = 999; another.samples[0].values.pressurePa = 4;
    assert.equal(normal.recipe.pressurePa, recipe.pressurePa);
    assert.equal(normal.samples[0].values.pressurePa, 101325);
  });
  test('Integration is finite, strictly timed at 0.25 s and within bounded first-order increments', () => {
    const limits = { pressurePa: 9000, beamVoltageV: 160, beamCurrentMa: 12, heliumPressurePa: 80, rotationRpm: 1.5, tiltDeg: 1.5 };
    for (let i = 1; i < normal.samples.length; i++) {
      const previous = normal.samples[i - 1], current = normal.samples[i];
      assert.equal(current.t - previous.t, 0.25);
      for (const key of Object.keys(E.CHANNELS)) {
        assert(Number.isFinite(current.values[key]));
        assert(current.values[key] >= 0);
        assert(Math.abs(current.values[key] - previous.values[key]) < limits[key], `${key} jumped at ${current.t}`);
      }
      assert(Math.abs(current.digital.robot - previous.digital.robot) <= 0.14);
    }
  });
  test('Beam and shutter obey chamber, cooling and gate conditions on every normal sample', () => {
    for (const s of normal.samples) {
      if (s.digital.beam) {
        assert(['stabilize', 'process'].includes(s.stage));
        assert(s.values.pressurePa <= recipe.pressurePa * 1.15);
        assert(s.values.heliumPressurePa >= recipe.heliumPressurePa * 0.75);
        assert.equal(s.digital.gate, false);
      }
      if (s.digital.shutter) { assert.equal(s.stage, 'process'); assert.equal(s.digital.beam, true); }
      if (s.digital.gate) {
        assert(s.values.pressurePa >= 101325 * 0.995);
        assert(s.values.beamVoltageV < 1);
        assert(s.values.beamCurrentMa < 0.1);
        assert(s.values.rotationRpm < 0.05);
        assert.equal(s.digital.beam, false);
      }
      if (s.digital.robot > 0) { assert(s.digital.gate); assert(['load', 'unload'].includes(s.stage)); }
    }
  });
  test('Process duration is recipe-driven and changing it does not replace upstream behavior', () => {
    const longer = E.simulate({ ...recipe, processSeconds: recipe.processSeconds + 20 });
    assert.equal(longer.duration - normal.duration, 20);
    for (const trace of [normal, longer]) {
      const start = trace.events.find(e => e.code === 'STAGE_PROCESS').t;
      const finish = trace.events.find(e => e.code === 'STAGE_COOLDOWN').t;
      assert.equal(finish - start, trace.recipe.processSeconds);
    }
    const firstProcess = normal.events.find(e => e.code === 'STAGE_PROCESS').t;
    assert.equal(JSON.stringify(normal.samples.filter(s => s.t < firstProcess)), JSON.stringify(longer.samples.filter(s => s.t < firstProcess)));
  });
  test('Stage-entry samples immediately apply their new commands without stale beam, pump or shutter state', () => {
    const first = stage => normal.samples.find(s => s.stage === stage);
    assert.equal(first('pump').digital.pump, true);
    assert.equal(first('pump').digital.gate, false);
    assert.equal(first('pump').targets.pressurePa, recipe.pressurePa);
    assert.equal(first('stabilize').targets.heliumPressurePa, recipe.heliumPressurePa);
    assert.equal(first('process').digital.beam, true);
    assert.equal(first('process').digital.shutter, true);
    for (const stage of ['cooldown', 'vent', 'unload']) {
      assert.equal(first(stage).digital.beam, false);
      assert.equal(first(stage).digital.shutter, false);
      assert.equal(first(stage).targets.beamVoltageV, 0);
      assert.equal(first(stage).targets.beamCurrentMa, 0);
    }
    assert.equal(first('cooldown').targets.rotationRpm, 0);
    assert.equal(first('vent').digital.pump, false);
    assert.equal(first('vent').targets.pressurePa, 101325);
    assert.equal(first('unload').digital.gate, true);
  });
  test('Wafer digital signal denotes the wafer seated on the process stage at transfer midpoint', () => {
    const unload = normal.events.find(e => e.code === 'STAGE_UNLOAD').t;
    assert.equal(normal.samples.find(s => s.t === 2.75).digital.wafer, false);
    assert.equal(normal.samples.find(s => s.t === 3).digital.wafer, true);
    assert.equal(normal.samples.find(s => s.t === unload + 2.75).digital.wafer, true);
    assert.equal(normal.samples.find(s => s.t === unload + 3).digital.wafer, false);
  });
  test('Lower pressure takes longer to pump and the observed process reaches its setpoint', () => {
    const lower = E.simulate({ ...recipe, pressurePa: 0.05 });
    assert.equal(lower.outcome.status, 'completed');
    assert(lower.events.find(e => e.code === 'STAGE_STABILIZE').t > normal.events.find(e => e.code === 'STAGE_STABILIZE').t);
    assert(Math.abs(lower.samples.findLast(s => s.stage === 'process').values.pressurePa - 0.05) < 0.001);
  });
  test('Valid high-tilt and high-load recipe completes using condition-based stabilization', () => {
    const alternative = E.simulate({ ...recipe, beamVoltageV: 1000, beamCurrentMa: 90, heliumPressurePa: 1000, rotationRpm: 30, tiltDeg: 70, processSeconds: 5 });
    assert.equal(alternative.outcome.status, 'completed');
    const processing = alternative.samples.filter(s => s.stage === 'process');
    assert(processing.every(s => Math.abs(s.values.tiltDeg - 70) < 0.5));
  });
  test('Vacuum fault times out before any beam or shutter is enabled', () => {
    const trace = E.simulate(recipe, 'vacuum');
    assert.equal(trace.outcome.status, 'aborted');
    assert.equal(trace.events.at(-1).code, 'VACUUM_TIMEOUT');
    assert(trace.samples.every(s => !s.digital.beam && !s.digital.shutter));
    assert.equal(trace.samples.at(-1).targets.pressurePa, recipe.pressurePa);
    assert(trace.samples.at(-1).values.pressurePa > 19);
    assert.equal(trace.duration - trace.events.find(e => e.code === 'STAGE_PUMP').t, 90);
  });
  test('Cooling loss retains requested setpoint and aborts at the observed pressure threshold', () => {
    const trace = E.simulate(recipe, 'cooling'), last = trace.samples.at(-1);
    assert.equal(trace.outcome.status, 'aborted');
    assert.equal(trace.events.at(-1).code, 'COOLING_INTERLOCK');
    assert(last.values.heliumPressurePa < recipe.heliumPressurePa * 0.75);
    assert.equal(last.targets.heliumPressurePa, recipe.heliumPressurePa);
    assert(trace.samples.some(s => s.digital.shutter));
  });
  test('Beam current deviation is observed against the unchanged setpoint before tripping', () => {
    const trace = E.simulate(recipe, 'beam');
    assert.equal(trace.outcome.status, 'aborted');
    assert.equal(trace.events.at(-1).code, 'BEAM_DEVIATION');
    assert(trace.samples.some(s => s.digital.beam && s.values.beamCurrentMa > recipe.beamCurrentMa * 1.2 && s.targets.beamCurrentMa === recipe.beamCurrentMa));
  });
  test('Every aborted run retains a terminal inhibited command state and stops generating motion samples', () => {
    for (const fault of ['vacuum', 'cooling', 'beam']) {
      const trace = E.simulate(recipe, fault), last = trace.samples.at(-1);
      assert.equal(last.digital.beam, false);
      assert.equal(last.digital.shutter, false);
      assert.equal(last.digital.gate, false);
      assert.equal(last.digital.robot, 0);
      assert.equal(last.targets.rotationRpm, 0);
      assert.equal(last.targets.beamCurrentMa, 0);
      assert.equal(last.targets.beamVoltageV, 0);
      assert.equal(last.t, trace.events.at(-1).t);
      assert.equal(last.t, trace.duration);
      assert(!trace.samples.some(s => s.t > trace.events.at(-1).t));
    }
  });
  test('Cooling and beam faults still trip for the minimum supported process duration', () => {
    for (const fault of ['cooling', 'beam']) assert.equal(E.simulate({ ...recipe, processSeconds: 5 }, fault).outcome.status, 'aborted');
  });
  test('Recipe rejects blank, whitespace, missing, null, boolean and nonfinite values before simulation', () => {
    for (const invalid of ['', '  ', null, false, true, undefined, NaN, Infinity, 'Infinity', 'abc']) {
      const input = { ...recipe, tiltDeg: invalid };
      assert.equal(E.validateRecipe(input).ok, false, String(invalid));
      assert.throws(() => E.simulate(input));
    }
    const missing = { ...recipe }; delete missing.pressurePa;
    assert.equal(E.validateRecipe(missing).ok, false);
    assert.equal(E.validateRecipe({ ...recipe, mystery: 1 }).ok, false);
    assert.throws(() => E.simulate(recipe, 'made-up'));
  });
  test('Explicit zero tilt and numeric input strings are valid and normalized to numbers', () => {
    const input = Object.fromEntries(Object.entries(recipe).map(([k, v]) => [k, String(v)])); input.tiltDeg = '0';
    assert.equal(E.validateRecipe(input).ok, true);
    assert.equal(E.simulate(input).recipe.tiltDeg, 0);
    assert.equal(typeof E.simulate(input).recipe.beamVoltageV, 'number');
  });
  test('Recipe checks include numeric bounds and meaningful power/cooling combination errors', () => {
    assert.equal(E.validateRecipe({ ...recipe, pressurePa: 0 }).ok, false);
    const power = E.validateRecipe({ ...recipe, beamVoltageV: 1500, beamCurrentMa: 120 });
    assert.equal(power.ok, false); assert(power.errors.some(e => e.field === 'beamCurrentMa'));
    const cooling = E.validateRecipe({ ...recipe, heliumPressurePa: 100 });
    assert.equal(cooling.ok, false); assert(cooling.errors.some(e => e.field === 'heliumPressurePa'));
    assert(E.validateRecipe(recipe).checks.some(c => c.status === 'info' && c.detail.includes('검증 불가')));
  });
  test('Trace import clones accepted data and never trusts claimed measured or synthetic provenance', () => {
    for (const kind of ['measured', 'synthetic']) {
      const data = clone(normal); data.provenance = { kind, label: '공식 실측', source: '공장' };
      const before = JSON.stringify(data), imported = E.validateTrace(data);
      assert.equal(imported.provenance.kind, 'unverified');
      assert.equal(JSON.stringify(data), before);
      assert.equal(JSON.stringify(imported.samples), JSON.stringify(data.samples));
      imported.samples[0].values.pressurePa = 1;
      assert.equal(data.samples[0].values.pressurePa, 101325);
    }
  });
  test('Partial-channel imported logs retain unknown-stage and missing targets/digital/recipe as missing', () => {
    const data = clone(normal);
    delete data.recipe;
    data.units = { pressurePa: 'Pa' };
    data.samples = [{ t: 0, stage: 'unknown', values: { pressurePa: 100 } }, { t: 1, stage: 'unknown', values: { pressurePa: 90 } }];
    data.events = []; data.duration = 1;
    const imported = E.validateTrace(data);
    assert.equal(imported.samples[0].stage, 'unknown');
    assert(!('beamCurrentMa' in imported.samples[0].values));
    assert(!('targets' in imported.samples[0]));
    assert(!('digital' in imported.samples[0]));
    assert(!('recipe' in imported));
  });
  test('Trace import rejects missing, mismatched and unknown units instead of guessing a conversion', () => {
    assert.throws(() => E.validateTrace(changed(d => { delete d.units; })), /단위표/);
    assert.throws(() => E.validateTrace(changed(d => { d.units.pressurePa = 'Torr'; })), /단위/);
    assert.throws(() => E.validateTrace(changed(d => { delete d.units.pressurePa; })), /단위/);
    assert.throws(() => E.validateTrace(changed(d => { d.units.unknownChannel = 'W'; })), /지원하지 않는/);
  });
  test('Imported recipe channel values require declared units while processSeconds has schema-defined seconds', () => {
    const data = clone(normal);
    data.units = { pressurePa: 'Pa' };
    data.samples = [{ t: 0, stage: 'unknown', values: { pressurePa: 100 } }, { t: 1, stage: 'unknown', values: { pressurePa: 90 } }];
    data.events = []; data.duration = 1;
    data.recipe = { pressurePa: 500, beamVoltageV: 700, processSeconds: 900 };
    assert.throws(() => E.validateTrace(data), /레시피.*단위 선언/);
    delete data.recipe.beamVoltageV;
    const imported = E.validateTrace(data);
    assert.equal(imported.recipe.pressurePa, 500); // Outside synthetic bounds remains an observed import value.
    assert.equal(imported.recipe.processSeconds, 900);
    data.recipe.beamVoltageV = 700; data.units.beamVoltageV = 'V';
    assert.equal(E.validateTrace(data).recipe.beamVoltageV, 700);
  });
  test('Trace import strictly rejects unknown stage/channel and nonnumeric observed, target or digital values', () => {
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].stage = 'mystery'; })), /단계/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].values.voltage = 3; })), /채널/);
    for (const value of [null, '', '1', NaN, Infinity]) assert.throws(() => E.validateTrace(changed(d => { d.samples[1].values.pressurePa = value; })), /숫자/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].targets.beamCurrentMa = null; })), /숫자/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].digital.beam = 'false'; })), /올바르지/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].digital.robot = 1.01; })), /올바르지/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].values = {}; })), /센서 값/);
  });
  test('Trace import rejects duplicate, backward, offset and oversized time axes', () => {
    assert.throws(() => E.validateTrace(changed(d => { d.samples[1].t = 0; })), /시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[2].t = 0.1; })), /시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples[0].t = 0.1; })), /시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples.at(-1).t = 1801; })), /시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.duration += 1; })), /duration/);
    assert.throws(() => E.validateTrace(changed(d => { d.samples = Array(15001).fill(d.samples[0]); })), /15000/);
  });
  test('Trace import validates event chronology, outcome and bounded text', () => {
    assert.throws(() => E.validateTrace(changed(d => { d.events[0].t = -1; })), /이벤트 시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.events[1].t = d.duration + 1; })), /이벤트 시간/);
    assert.throws(() => E.validateTrace(changed(d => { d.events[0].level = 'success'; })), /수준/);
    assert.throws(() => E.validateTrace(changed(d => { d.events[0].message = 'a'.repeat(1001); })), /문자열/);
    assert.throws(() => E.validateTrace(changed(d => { d.outcome.status = 'approved'; })), /결과 상태/);
    assert.throws(() => E.validateTrace(changed(d => { d.schema = 'other'; })), /schema/);
  });
  test('Trace import rejects prototype pollution and accessor payloads without invoking accessors', () => {
    const poisoned = JSON.parse(JSON.stringify(normal).replace('"schema":', '"__proto__":{"polluted":true},"schema":'));
    assert.throws(() => E.validateTrace(poisoned), /객체 키/);
    let invoked = false; const payload = clone(normal);
    Object.defineProperty(payload, 'secret', { get() { invoked = true; return 1; }, enumerable: true });
    assert.throws(() => E.validateTrace(payload), /실행 가능한/);
    assert.equal(invoked, false);
    assert.equal({}.polluted, undefined);
  });
  test('Trace import rejects inherited executable fields and array method overrides', () => {
    let invoked = false;
    const inherited = Object.create({ get schema() { invoked = true; return normal.schema; } });
    Object.assign(inherited, { units: normal.units, samples: normal.samples });
    assert.throws(() => E.validateTrace(inherited), /JSON 객체/);
    assert.equal(invoked, false);
    const overridden = clone(normal); overridden.samples.map = 'unsafe';
    assert.throws(() => E.validateTrace(overridden), /배열/);
  });
  test('Late malformed sample rejects atomically without changing caller data or the current valid trace', () => {
    const invalid = clone(normal); invalid.samples.at(-1).digital.robot = -1;
    const original = JSON.stringify(invalid), validBefore = JSON.stringify(normal);
    assert.throws(() => E.validateTrace(invalid));
    assert.equal(JSON.stringify(invalid), original);
    assert.equal(JSON.stringify(normal), validBefore);
    assert.equal(E.validateTrace(normal).samples.length, normal.samples.length);
  });

  return { suite: 'equipment-engine', passed: tests.length, tests };
}

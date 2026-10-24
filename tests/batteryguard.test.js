'use strict';
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const battery = require(path.join(APP, 'battery'));
const guard = require(path.join(APP, 'batteryguard'));
const { BATTERIES } = require('./fixtures');
function check(name, fn) { try { fn(); console.log('ok -', name); } catch (e) { console.error('not ok -', name); throw e; } }
const now = Date.UTC(2026, 0, 1, 12);
const cfg = { soc_entity: 'sensor.battery', power_entity: 'sensor.power', min_pct: 10, max_pct: 80, capacity_kwh: 10, charge_kw: 3, discharge_kw: 3, power_sign: 'charge_positive' };
const states = (soc, age = 0, power = 0) => [
  { entity_id: cfg.soc_entity, state: String(soc), last_updated: new Date(now - age).toISOString() },
  { entity_id: cfg.power_entity, state: String(power), attributes: { unit_of_measurement: 'kW' } },
];
const control = { available: true, actions: { auto: () => [], charge: () => [], discharge: () => [], hold: () => [], no_discharge: () => [] }, soc_limits: {} };
check('charging is stopped at/near the live maximum, including measured auto charging', () => {
  for (const level of [79.5, 80, 85]) assert.equal(guard.constrain({ action: 'charge' }, cfg, control, states(level), now).action, 'hold');
  assert.equal(guard.constrain({ action: 'auto' }, cfg, control, states(79.5, 0, 3), now).action, 'hold');
  assert.equal(guard.constrain({ action: 'charge' }, cfg, control, states(50), now).action, 'charge');
});
check('discharging is stopped at the reserve, but charging can recover from below it', () => {
  for (const action of ['auto', 'discharge']) assert.equal(guard.constrain({ action }, cfg, control, states(10), now).action, 'no_discharge');
  assert.equal(guard.constrain({ action: 'charge' }, cfg, control, states(5), now).action, 'charge');
  assert.equal(guard.constrain({ action: 'auto' }, cfg, control, states(80), now).action, 'auto');
});
check('old, missing, invalid and out-of-range SoC never authorize charging', () => {
  for (const v of ['unavailable', '', ' ', 'false', -1, 101]) assert.equal(guard.constrain({ action: 'charge' }, cfg, control, states(v), now).blocked, true);
  assert.equal(guard.constrain({ action: 'charge' }, cfg, control, states(50, guard.MAX_AGE_MS + 1), now).code, 'battery_soc_unknown');
  assert.equal(guard.constrain({ action: 'charge' }, cfg, control, [], now).blocked, true);
});
check('unsupported stop capabilities block control instead of pretending to enforce limits', () => {
  const simple = { actions: { charge: () => [], auto: () => [] }, soc_limits: {} };
  assert.equal(guard.constrain({ action: 'auto' }, cfg, simple, states(50), now).action, 'release');
  assert.equal(guard.constrain({ action: 'charge' }, { ...cfg, min_pct: 0 }, simple, states(50), now).code, 'battery_max_unsupported');
});
for (const platform of ['huawei_solar', 'victron', 'teslemetry']) {
  check(platform + ' restores non-default limits/mode and zero reserve after a serialized restart', () => {
    const f = BATTERIES.find((x) => x.platform === platform);
    const entities = f.list.map(([entity_id, , , device_id]) => ({ entity_id, device_id, platform }));
    const ss = f.list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes }));
    for (const st of ss) {
      if (/maximum_charging_power/.test(st.entity_id)) st.state = '1200';
      if (/maximum_discharging_power|maxdischargepower/.test(st.entity_id)) st.state = '1700';
      if (/ess_mode/.test(st.entity_id)) st.state = 'SELF_CONSUMPTION';
      if (/operation_mode/.test(st.entity_id) && platform === 'teslemetry') st.state = 'autonomous';
      if (/backup_reserve/.test(st.entity_id)) st.state = '0';
    }
    const before = Object.fromEntries(ss.map((s) => [s.entity_id, s.state]));
    const selected = { platform, device_id: f.list[0][3] };
    let ctl = battery.controlFor(selected, entities, ss);
    const commands = battery.commandsFor(ctl, platform === 'huawei_solar' ? 'hold' : 'no_discharge', 3, 75).commands;
    const original = JSON.parse(JSON.stringify(guard.capture(commands, ss)));
    const apply = (cmd) => {
      const st = ss.find((x) => cmd.target && x.entity_id === cmd.target.entity_id);
      if (st) st.state = String(cmd.data.value ?? cmd.data.option ?? (cmd.service.endsWith('turn_on') ? 'on' : 'off'));
    };
    commands.forEach(apply);
    ctl = battery.controlFor(selected, entities, ss, { values: Object.fromEntries(Object.entries(original).map(([id, o]) => [id, o.value])) });
    guard.restore(ctl, original).forEach(apply);
    for (const id of Object.keys(original)) assert.equal(ss.find((x) => x.entity_id === id).state, String(before[id]));
    if (platform === 'huawei_solar') assert.equal(ss.find((x) => /maximum_charging_power/.test(x.entity_id)).state, '1200');
    if (platform === 'teslemetry') assert.equal(ss.find((x) => /operation_mode/.test(x.entity_id)).state, 'autonomous');
  });
}
check('snapshot refuses unavailable settings and never invents a maximum for legacy recovery', () => {
  assert.throws(() => guard.capture([{ service: 'number.set_value', target: { entity_id: 'number.missing' }, data: { value: 0 } }], []));
  assert.throws(() => guard.restore(control, null), /older version/);
});
check('native reserve is never lowered below the original; a stronger EV reserve wins', () => {
  const ctl = { ...control, soc_limits: { min: 'number.reserve' } };
  const ss = [{ entity_id: 'number.reserve', state: '20', attributes: { min: 0, max: 100, step: 1 } }];
  const orig = { 'number.reserve': { service: 'number.set_value', value: 20 } };
  const bounds = guard.nativeLimits(ctl, { ...cfg, min_pct: 30 }, ss, orig);
  assert.equal(bounds[0].data.value, 30);
  const merged = guard.merge([{ service: 'number.set_value', target: { entity_id: 'number.reserve' }, data: { value: 75 } }], bounds, ctl);
  assert.equal(merged[0].data.value, 75);
  assert.equal(guard.nativeLimits(ctl, { ...cfg, min_pct: 10 }, ss, orig).length, 0);
});
check('every charger participates in never/solar-only/range/always policies', () => {
  const source = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const begin = source.indexOf('function batteryWanted('), end = source.indexOf('let lastBattery', begin);
  const entries = [{ want: 'pause', charging: false, plugged: false }, { want: 'none', charging: true, plugged: true, power_w: 7000 }];
  const policy = (ev_discharge, solar = 0, active = false) => vm.runInNewContext(source.slice(begin, end) + '\n batteryWanted(cfg, null, entries, 50)', {
    cfg: { ev_discharge, solar_priority: 'battery', ev_from_pct: 80, ev_to_pct: 40 }, entries, batteryLedger: { solar_kwh: solar }, evRange: { active },
  });
  assert.equal(policy('never').action, 'no_discharge');
  assert.equal(policy('solar_only').action, 'no_discharge');
  assert.equal(policy('solar_only', 1).action, 'auto');
  assert.equal(policy('range', 0, false).action, 'no_discharge');
  assert.equal(policy('range', 0, true).action, 'auto');
  assert.equal(policy('always').action, 'auto');
});
console.log('All checks passed');

'use strict';

// Charger brand test: real entity and action names of the common Home
// Assistant charger integrations (taken from their source code), checked
// against detection, the control check and the status texts.
//
// Run: node tests/brands.test.js   (from the repository root)

process.env.DATA_DIR = process.env.DATA_DIR || require('os').tmpdir();
const assert = require('assert');
const { detectChargers } = require('../smart_charging_planner/app/chargers');
const { checkControl } = require('../smart_charging_planner/app/control');
const controller = require('../smart_charging_planner/app/controller');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

const { CHARGERS } = require('./fixtures');
const BRANDS = CHARGERS.filter((c) => !c.readOnly);

for (const b of BRANDS) {
  console.log(b.brand);
  const { entities, devices, states } = b.dev;
  const found = detectChargers(entities, devices, states);
  check('detected as charger', () => assert.strictEqual(found.length, 1));
  const c = found[0];
  if (!c) continue;
  if (b.expect.status) check(`status sensor ${b.expect.status}`, () => assert.strictEqual(c.suggested.status, b.expect.status));
  if (b.expect.power) check(`power sensor ${b.expect.power}`, () => assert.strictEqual(c.suggested.power, b.expect.power));

  const r = checkControl({ charger: { device_id: 'd', integration: c.integration }, entities, states, services: b.services });
  const rec = r.recommended.start_stop;
  check(`start/stop method ${b.expect.startStop}`, () => assert.strictEqual(rec && rec.type, b.expect.startStop));
  if (b.expect.switchEntity) check(`uses ${b.expect.switchEntity}`, () => assert.strictEqual(rec.entity_id, b.expect.switchEntity));
  if (b.expect.start) check(`start = ${b.expect.start}`, () => assert.strictEqual(rec.start_value || rec.start_option, b.expect.start));
  if (b.expect.stop) check(`stop = ${b.expect.stop}`, () => assert.strictEqual(rec.stop_value || rec.stop_option, b.expect.stop));
  for (const key of ['warning', 'warning2']) {
    if (b.expect[key]) check(`warns ${b.expect[key]}`, () => assert.ok(r.warnings.some((w) => w.code === b.expect[key]), JSON.stringify(r.warnings)));
  }
  if (b.expect.noWarning) check(`no ${b.expect.noWarning}`, () => assert.ok(!r.warnings.some((w) => w.code === b.expect.noWarning), JSON.stringify(r.warnings)));

  // The start and stop commands are well formed and allowed by the guard.
  const on = controller.startStopCommand(rec, true, 'd');
  const off = controller.startStopCommand(rec, false, 'd');
  const allowed = controller.allowedFor(rec);
  check('start/stop commands allowed', () => {
    for (const cmd of [on, off]) {
      assert.ok(cmd && cmd.service, 'no command');
      const ok = allowed.some((a) => a.service === cmd.service && (!a.entity_id || (cmd.target && cmd.target.entity_id === a.entity_id)));
      assert.ok(ok, `${cmd.service} not allowed`);
    }
  });

  // Solar: charging current and switching between one and three phases.
  if ('current' in b.expect) {
    const cur = r.recommended.current;
    const got = cur ? `${cur.type}:${cur.type === 'number' ? cur.entity_id : cur.service}` : null;
    check(`solar current: ${b.expect.current || 'not possible'}`, () => assert.strictEqual(got, b.expect.current));
    if (cur) {
      const cmd = controller.currentCommand(cur, 10, 'd');
      const allowedCur = controller.allowedFor(cur);
      check('current command 10 A allowed', () => {
        assert.ok(cmd && allowedCur.some((a) => a.service === cmd.service && (!a.entity_id || cmd.target.entity_id === a.entity_id)), JSON.stringify(cmd));
        assert.ok(Object.values(cmd.data).includes(10), JSON.stringify(cmd.data));
      });
    }
  }
  if ('phase' in b.expect) {
    const ph = r.recommended.phase;
    const one = ph ? controller.phaseCommand(ph, 1, 'd') : null;
    const three = ph ? controller.phaseCommand(ph, 3, 'd') : null;
    const val = (c) => (c ? (c.data.option ?? Object.entries(c.data).filter(([k]) => k !== 'device_id').map(([, v]) => v)[0] ?? c.service.split('_').pop()) : null);
    const got = ph ? `${ph.type}:${val(one)}/${val(three)}` : null;
    check(`phase switching: ${b.expect.phase || 'not possible'}`, () => assert.strictEqual(got, b.expect.phase));
    if (ph) {
      const allowedPh = controller.allowedFor(ph);
      check('phase commands allowed', () => {
        for (const c of [one, three]) assert.ok(allowedPh.some((a) => a.service === c.service && (!a.entity_id || c.target.entity_id === a.entity_id)), JSON.stringify(c));
      });
    }
  }

  // Status texts: [plugged, charging]
  for (const [text, [plugged, charging]] of Object.entries(b.statuses)) {
    const st = states.map((s) => (s.entity_id === c.suggested.status ? { ...s, state: text, last_changed: new Date().toISOString() } : s));
    const a = controller.readActual({ vehicle: null, charger: { status_entity: c.suggested.status }, states: st });
    check(`status "${text}" → plugged ${plugged}, charging ${charging}`, () => {
      assert.strictEqual(a.plugged, plugged, `plugged ${a.plugged}`);
      if (charging !== null) assert.strictEqual(a.charging, charging, `charging ${a.charging}`);
    });
    // With the car's own "Plugged in" sensor too (any car brand: on/off). The
    // charger saying "connected" wins (the car's cloud is often minutes late);
    // otherwise the car's sensor (for example at a public charger).
    for (const carPlug of ['on', 'off']) {
      const withCar = [...st, { entity_id: 'binary_sensor.car_plugged_in', state: carPlug, attributes: { device_class: 'plug' }, last_changed: new Date().toISOString() }];
      const v = controller.readActual({ vehicle: { plugged_entity: 'binary_sensor.car_plugged_in' }, charger: { status_entity: c.suggested.status }, states: withCar });
      const want = plugged === true ? true : carPlug === 'on';
      check(`status "${text}" + car sensor ${carPlug} → plugged ${want}`, () => assert.strictEqual(v.plugged, want, `plugged ${v.plugged}`));
    }
  }
  // Problem texts (an error, a fault, booting, updating): the charger has a
  // problem; not "a car is connected".
  for (const text of b.problems || []) {
    const st = states.map((s) => (s.entity_id === c.suggested.status ? { ...s, state: text, last_changed: new Date().toISOString() } : s));
    const a = controller.readActual({ vehicle: null, charger: { status_entity: c.suggested.status }, states: st });
    check(`status "${text}" → a charger problem, not "plugged in"`, () => {
      assert.strictEqual(a.status_invalid, true, 'not seen as a problem');
      assert.notStrictEqual(a.plugged, true, 'counted as plugged in');
    });
  }
}

// An on/off sensor as charger status (allowed in Settings › Charger).
console.log('On/off sensor as charger status');
{
  const read = (state, dc, carPlug, power) => {
    const st = [{ entity_id: 'binary_sensor.wallbox_status', state, attributes: { ...(dc ? { device_class: dc } : {}) }, last_changed: new Date().toISOString() }];
    if (carPlug) st.push({ entity_id: 'binary_sensor.car_plugged_in', state: carPlug, attributes: { device_class: 'plug' } });
    if (power != null) st.push({ entity_id: 'sensor.wallbox_power', state: String(power), attributes: { unit_of_measurement: 'W' } });
    return controller.readActual({
      vehicle: carPlug ? { plugged_entity: 'binary_sensor.car_plugged_in' } : null,
      charger: { status_entity: 'binary_sensor.wallbox_status', ...(power != null ? { power_entity: 'sensor.wallbox_power' } : {}) },
      states: st,
    });
  };
  check('plug sensor off → not plugged in, not charging', () => {
    const a = read('off', 'plug');
    assert.strictEqual(a.plugged, false);
    assert.strictEqual(a.charging, false);
  });
  check('plug sensor off wins over a late car sensor that still says on', () => assert.strictEqual(read('off', 'plug', 'on').plugged, false));
  check('plug sensor on → plugged in, charging not known (so the app can start it)', () => {
    const a = read('on', 'plug');
    assert.strictEqual(a.plugged, true);
    assert.strictEqual(a.charging, null);
  });
  check('plug sensor on + power 7 kW → charging', () => assert.strictEqual(read('on', 'plug', null, 7000).charging, true));
  check('plug sensor on + power 0 W → not charging', () => assert.strictEqual(read('on', 'plug', null, 0).charging, false));
  check('charging sensor on → plugged in and charging', () => {
    const a = read('on', 'battery_charging');
    assert.strictEqual(a.plugged, true);
    assert.strictEqual(a.charging, true);
  });
  check('charging sensor off + car sensor off → not plugged in', () => {
    const a = read('off', 'battery_charging', 'off');
    assert.strictEqual(a.plugged, false);
    assert.strictEqual(a.charging, false);
  });
  check('charging sensor off + car sensor on → plugged in, not charging', () => {
    const a = read('off', 'battery_charging', 'on');
    assert.strictEqual(a.plugged, true);
    assert.strictEqual(a.charging, false);
  });
  check('no device class: the name decides (…_status → plug)', () => assert.strictEqual(read('off', null).plugged, false));
  check('unavailable → status invalid, as before', () => assert.strictEqual(read('unavailable', 'plug').status_invalid, true));
}

// Tesla Wall Connector can only read.
console.log('Tesla Wall Connector');
{
  const { entities, states } = CHARGERS.find((c) => c.readOnly).dev;
  const r = checkControl({ charger: { device_id: 'd', integration: 'tesla_wall_connector' }, entities, states, services: {} });
  check('says it can only read', () => assert.ok(r.warnings.some((w) => w.code === 'read_only_integration')));
}

// Easee v2026.11.0 (#57): the action contracts of nordicopen/easee_hass
// v2026.11.0 (services.yaml), with the new Equalizer action. A synthetic copy,
// not the real integration.
console.log('Easee v2026.11.0 (#57)');
{
  const base = CHARGERS.find((c) => c.brand === 'Easee');
  const { entities, states } = base.dev;
  const services = {
    easee: {
      ...base.services.easee,
      set_charger_dynamic_limit: { name: 'Set charger dynamic limit', fields: { device_id: { selector: { device: { integration: 'easee', model: 'Charger' } } }, current: { selector: { number: { min: 0, max: 32, unit_of_measurement: 'A' } } }, time_to_live: { selector: { number: { min: 0, max: 1440, unit_of_measurement: 'min' } } } } },
      set_charger_phase_mode: { name: 'Set charger phase mode', fields: { device_id: { selector: { device: { integration: 'easee' } } }, phase_mode: { selector: { select: { options: ['1_phase', 'auto_phase', '3_phase'] } } } } },
      // New: the Equalizer's maximum continuous current (a site limit).
      set_equalizer_max_continuous_limit: { name: 'Set Equalizer max continuous limit', description: 'Sets the maximum continuous current limit of the Equalizer.', fields: { device_id: { selector: { device: { filter: { integration: 'easee', model: 'Equalizer' } } } }, current: { selector: { number: { min: 0, max: 63, unit_of_measurement: 'A' } } } } },
      // The same action without "Equalizer" in its name: the device selector decides.
      set_max_continuous_limit: { name: 'Set max continuous limit', fields: { device_id: { selector: { device: { filter: { integration: 'easee', model: 'Equalizer' } } } }, current: { selector: { number: { min: 0, max: 63, unit_of_measurement: 'A' } } } } },
    },
  };
  const r = checkControl({ charger: { device_id: 'd', integration: 'easee' }, entities, states, services });
  const ids = r.current.map((m) => m.service || m.entity_id);
  check('the Equalizer action is never a charger current method', () => assert.ok(ids.includes('set_charger_dynamic_limit') && !ids.includes('set_equalizer_max_continuous_limit') && !ids.includes('set_max_continuous_limit'), JSON.stringify(ids)));
  check('set_charger_dynamic_limit stays recommended, with time_to_live', () => {
    const cur = r.recommended.current;
    assert.ok(cur && cur.service === 'set_charger_dynamic_limit' && cur.ttl_field === 'time_to_live', JSON.stringify(cur));
  });
  check('start/stop: the Charger enabled switch, not pause/resume', () => assert.strictEqual(r.recommended.start_stop.entity_id, 'switch.eh123456_charger_enabled'));
  check('phase switching with the named options 1_phase / 3_phase', () => {
    const ph = r.recommended.phase;
    assert.ok(ph && ph.one_value === '1_phase' && ph.three_value === '3_phase', JSON.stringify(ph));
    assert.strictEqual(controller.phaseCommand(ph, 3, 'd').data.phase_mode, '3_phase');
  });
  check('the current command sends device_id as text and the current in A', () => {
    const cmd = controller.currentCommand(r.recommended.current, 10, 'd');
    assert.ok(cmd.data.device_id === 'd' && cmd.data.current === 10, JSON.stringify(cmd));
  });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

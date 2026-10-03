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

// Build registries and states for one device.
function device(id, name, platform, list) {
  const entities = list.map(([entity_id]) => ({ entity_id, device_id: id, platform }));
  const states = list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes: { friendly_name: entity_id, ...(attributes || {}) } }));
  return { entities, devices: [{ id, name }], states };
}
const W = { unit_of_measurement: 'W', device_class: 'power' };
const KW = { unit_of_measurement: 'kW', device_class: 'power' };
const A = (min, max) => ({ unit_of_measurement: 'A', min, max });

const BRANDS = [
  {
    brand: 'Easee',
    dev: device('d', 'EMVGUS3H', 'easee', [
      ['sensor.emvgus3h_status', 'awaiting_start', { device_class: 'enum' }],
      ['sensor.emvgus3h_power', '0', KW],
      ['switch.emvgus3h_charger_enabled', 'on'],
      ['switch.emvgus3h_smart_charging', 'on'],
      ['button.emvgus3h_override_schedule', 'unknown'],
    ]),
    services: {
      easee: {
        action_command: { fields: { device_id: {}, action_command: { selector: { select: { options: ['start', 'stop', 'pause', 'resume', 'toggle', 'reboot'] } } } }, target: { device: {} } },
        set_charger_dynamic_limit: { name: 'Set charger dynamic limit', fields: { device_id: {}, current: { selector: { number: { min: 0, max: 32, unit_of_measurement: 'A' } } }, time_to_live: { selector: { number: { min: 0, max: 1080 } } } } },
        set_charger_phase_mode: { name: 'Set charger phase mode', fields: { device_id: {}, phase_mode: { selector: { select: { options: ['1_phase', 'auto_phase', '3_phase'] } } } } },
      },
    },
    expect: { status: 'sensor.emvgus3h_status', power: 'sensor.emvgus3h_power', startStop: 'action_choice', start: 'resume', noWarning: 'own_smart_charging_on', current: 'action_current:set_charger_dynamic_limit', phase: 'action_phase:1_phase/3_phase' },
    statuses: { awaiting_start: [true, false], charging: [true, true], disconnected: [false, null], completed: [true, false], ready_to_charge: [true, false] },
  },
  {
    brand: 'Zaptec',
    dev: device('d', 'Zaptec Go', 'zaptec', [
      ['sensor.zaptec_go_charger_mode', 'connected_requesting', { device_class: 'enum' }],
      ['sensor.zaptec_go_charge_power', '0', W],
      ['button.zaptec_go_resume_charging', 'unknown'],
      ['button.zaptec_go_stop_charging', 'unknown'],
      ['switch.zaptec_go_charging', 'off'],
      ['number.zaptec_go_charger_max_current', '32', A(0, 32)],
    ]),
    services: {},
    expect: { status: 'sensor.zaptec_go_charger_mode', power: 'sensor.zaptec_go_charge_power', startStop: 'buttons', current: 'number:number.zaptec_go_charger_max_current', phase: null },
    statuses: { disconnected: [false, null], connected_requesting: [true, false], connected_charging: [true, true], connected_finished: [true, false] },
  },
  {
    brand: 'Alfen',
    dev: device('d', 'Alfen Eve', 'alfen_wallbox', [
      ['sensor.alfen_eve_status_code_socket_1', 'Charging Normal'],
      ['sensor.alfen_eve_active_power_total_socket_1', '7400', W],
      ['switch.alfen_eve_charging', 'on'],
      ['select.alfen_eve_socket_1_operation_mode', 'Operative', { options: ['Operative', 'In-operative'] }],
      ['select.alfen_eve_solar_charging_mode', 'Green', { options: ['Disable', 'Comfort', 'Green'] }],
      ['number.alfen_eve_power_connector_max_current_socket_1', '16', A(0, 16)],
    ]),
    services: {},
    expect: { status: 'sensor.alfen_eve_status_code_socket_1', power: 'sensor.alfen_eve_active_power_total_socket_1', startStop: 'switch', warning: 'own_mode_on', warning2: 'alfen_single_login', current: 'number:number.alfen_eve_power_connector_max_current_socket_1', phase: null },
    statuses: { Available: [false, null], 'Charging Normal': [true, true], 'Suspended Over Current': [true, false], 'Finish Wait Disconnect': [true, false] },
  },
  {
    brand: 'Wallbox',
    dev: device('d', 'Wallbox Pulsar Plus', 'wallbox', [
      ['sensor.wallbox_pulsar_plus_status_description', 'Charging'],
      ['sensor.wallbox_pulsar_plus_charging_power', '7.4', KW],
      ['switch.wallbox_pulsar_plus_pause_resume', 'on'],
      ['number.wallbox_pulsar_plus_maximum_charging_current', '16', A(6, 32)],
      ['select.wallbox_pulsar_plus_ecosmart', 'eco_mode', { options: ['off', 'eco_mode', 'full_solar'] }],
    ]),
    services: {},
    expect: { status: 'sensor.wallbox_pulsar_plus_status_description', power: 'sensor.wallbox_pulsar_plus_charging_power', startStop: 'switch', warning: 'own_mode_on', current: 'number:number.wallbox_pulsar_plus_maximum_charging_current', phase: null },
    statuses: { Charging: [true, true], Paused: [true, false], Ready: [false, null], Disconnected: [false, null], 'Waiting for car demand': [true, false] },
  },
  {
    brand: 'go-e (marq24)',
    dev: device('d', 'go-e 123456', 'goecharger_api2', [
      ['sensor.goe_123456_car_value', 'Idle', { friendly_name: 'Car state' }],
      ['sensor.goe_123456_nrg_11', '0', { ...W, friendly_name: 'Power total now' }],
      ['sensor.goe_123456_nrg_7', '0', { ...W, friendly_name: 'Power L1' }],
      ['sensor.goe_123456_modelstatus_value', 'NotChargingBecauseNoChargeCtrlData', { friendly_name: 'Status' }],
      ['select.goe_123456_frc', '0', { options: ['0', '1', '2'], friendly_name: 'Force state' }],
      ['select.goe_123456_lmo', '3', { options: ['3', '4', '5'], friendly_name: 'Logic mode' }],
      ['number.goe_123456_amp', '16', { ...A(6, 32), friendly_name: 'Requested current' }],
      ['select.goe_123456_psm', '0', { options: ['0', '1', '2'], friendly_name: 'Phase switch mode' }],
    ]),
    services: {},
    expect: { status: 'sensor.goe_123456_car_value', power: 'sensor.goe_123456_nrg_11', startStop: 'select', start: '2', stop: '1', current: 'number:number.goe_123456_amp', phase: 'select_phase:1/2' },
    statuses: { Idle: [false, null], Charging: [true, true], 'Wait for car': [true, false], Complete: [true, false] },
  },
  {
    brand: 'go-e (cathiele)',
    dev: device('d', 'goecharger', 'goecharger', [
      ['sensor.goecharger_home_car_status', 'Charger ready, no vehicle'],
      ['sensor.goecharger_home_p_all', '0', KW],
      ['switch.goecharger_home_allow_charging', 'on'],
    ]),
    services: {},
    expect: { status: 'sensor.goecharger_home_car_status', startStop: 'switch', current: null, phase: null },
    statuses: { 'Charger ready, no vehicle': [false, null], charging: [true, true], 'Waiting for vehicle': [true, false], 'charging finished, vehicle still connected': [true, false] },
  },
  {
    brand: 'Peblar',
    dev: device('d', 'Peblar EV Charger', 'peblar', [
      ['sensor.peblar_ev_charger_state', 'no_ev_connected', { device_class: 'enum' }],
      ['sensor.peblar_ev_charger_power', '0', W],
      ['switch.peblar_ev_charger_charge', 'on'],
      ['number.peblar_ev_charger_charge_limit', '16', A(6, 32)],
      ['select.peblar_ev_charger_smart_charging', 'default', { options: ['default', 'fast_solar', 'pure_solar', 'smart_solar', 'scheduled'] }],
      ['switch.peblar_ev_charger_force_single_phase', 'off'],
    ]),
    services: {},
    expect: { status: 'sensor.peblar_ev_charger_state', power: 'sensor.peblar_ev_charger_power', startStop: 'switch', noWarning: 'own_mode_on', current: 'number:number.peblar_ev_charger_charge_limit', phase: 'switch_phase:on/off', switchEntity: 'switch.peblar_ev_charger_charge' },
    statuses: { no_ev_connected: [false, null], charging: [true, true], suspended: [true, false] },
  },
  {
    brand: 'OCPP',
    dev: device('d', 'charger', 'ocpp', [
      ['sensor.charger_status_connector', 'Available'],
      ['sensor.charger_power_active_import', '0', KW],
      ['switch.charger_charge_control', 'off'],
      ['switch.charger_availability', 'on'],
      ['number.charger_maximum_current', '32', A(0, 32)],
    ]),
    services: { ocpp: { set_charge_rate: { name: 'Set charge rate', fields: { limit_amps: { selector: { number: { min: 0, max: 32, unit_of_measurement: 'A' } } } } } } },
    expect: { status: 'sensor.charger_status_connector', power: 'sensor.charger_power_active_import', startStop: 'switch', switchEntity: 'switch.charger_charge_control', warning: 'ocpp_backend', current: 'number:number.charger_maximum_current', phase: null },
    statuses: { Available: [false, null], Preparing: [true, false], Charging: [true, true], SuspendedEV: [true, false], SuspendedEVSE: [true, false], Finishing: [true, false] },
  },
  {
    brand: 'Ohme',
    dev: device('d', 'Ohme Home Pro', 'ohme', [
      ['sensor.ohme_home_pro_status', 'plugged_in', { device_class: 'enum' }],
      ['sensor.ohme_home_pro_power', '0', W],
      ['select.ohme_home_pro_charge_mode', 'smart_charge', { options: ['smart_charge', 'max_charge', 'paused'] }],
    ]),
    services: {},
    expect: { status: 'sensor.ohme_home_pro_status', power: 'sensor.ohme_home_pro_power', startStop: 'select', start: 'max_charge', stop: 'paused', warning: 'own_mode_on', current: null, phase: null },
    statuses: { unplugged: [false, null], plugged_in: [true, false], charging: [true, true], paused: [true, false], finished: [true, false] },
  },
];

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
    const val = (c) => (c ? (c.data.option ?? Object.values(c.data)[0] ?? c.service.split('_').pop()) : null);
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
  }
}

// Tesla Wall Connector can only read.
console.log('Tesla Wall Connector');
{
  const { entities, devices, states } = device('d', 'Tesla Wall Connector', 'tesla_wall_connector', [
    ['sensor.tesla_wall_connector_status', 'charging_finished'],
    ['sensor.tesla_wall_connector_power', '0', W],
  ]);
  const r = checkControl({ charger: { device_id: 'd', integration: 'tesla_wall_connector' }, entities, states, services: {} });
  check('says it can only read', () => assert.ok(r.warnings.some((w) => w.code === 'read_only_integration')));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

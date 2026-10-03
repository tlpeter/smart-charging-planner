'use strict';

// Home battery test, brand by brand: detection (level, power, capacity),
// which actions the app can do, the exact commands, and that the safety
// guard allows exactly those. Entity and option names from the integrations'
// own source code (see the notes per brand). Then the battery plan.
//
// Run: node tests/battery.test.js   (from the repository root)

process.env.DATA_DIR = process.env.DATA_DIR || require('os').tmpdir();
const assert = require('assert');
const path = require('path');
const app = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const battery = require(path.join(app, 'battery.js'));
const { planBattery } = require(path.join(app, 'batteryplan.js'));

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

const P = { unit_of_measurement: '%' };
const W = { unit_of_measurement: 'W', device_class: 'power' };
const KW = { unit_of_measurement: 'kW', device_class: 'power' };

// [entity_id, state, attributes, device]
const BRANDS = [
  { platform: 'sigen', note: 'select options, Remote EMS switch, limits in kW', list: [
    ['sensor.sigen_plant_battery_state_of_charge', '55', P, 'plant'],
    ['sensor.sigen_plant_battery_power', '-1.2', KW, 'plant'],
    ['sensor.sigen_plant_rated_energy_capacity', '16.12', { unit_of_measurement: 'kWh' }, 'plant'],
    ['switch.sigen_plant_remote_ems_controlled_by_home_assistant', 'off', {}, 'plant'],
    ['select.sigen_plant_remote_ems_control_mode', 'Maximum Self Consumption', { options: ['PCS Remote Control', 'Standby', 'Maximum Self Consumption', 'Command Charging (Grid First)', 'Command Charging (PV First)', 'Command Discharging (PV First)', 'Command Discharging (ESS First)', 'V2G'] }, 'plant'],
    ['number.sigen_plant_ess_max_charging_limit', '10', { unit_of_measurement: 'kW', min: 0, max: 100 }, 'plant'],
    ['number.sigen_plant_ess_max_discharging_limit', '10', { unit_of_measurement: 'kW', min: 0, max: 100 }, 'plant'],
  ], expect: { soc: 'sensor.sigen_plant_battery_state_of_charge', power: 'sensor.sigen_plant_battery_power', capacity: 'sensor.sigen_plant_rated_energy_capacity', kw: -1.2, actions: ['auto', 'charge', 'discharge', 'hold'], charge: 'select.select_option:Command Charging (Grid First)' } },
  { platform: 'huawei_solar', note: 'services forcible_charge/discharge (W, minutes), max (dis)charging power numbers', list: [
    ['sensor.batteries_state_of_capacity', '40', P, 'bat'],
    ['sensor.batteries_charge_discharge_power', '800', W, 'bat'],
    ['sensor.batteries_rated_capacity', '10000', { unit_of_measurement: 'Wh' }, 'bat'],
    ['number.batteries_maximum_charging_power', '5000', { unit_of_measurement: 'W', min: 0, max: 5000 }, 'bat'],
    ['number.batteries_maximum_discharging_power', '5000', { unit_of_measurement: 'W', min: 0, max: 5000 }, 'bat'],
    ['sensor.inverter_input_power', '3000', W, 'inv'],
  ], expect: { soc: 'sensor.batteries_state_of_capacity', power: 'sensor.batteries_charge_discharge_power', kw: 0.8, actions: ['auto', 'charge', 'discharge', 'no_discharge', 'hold'], charge: 'huawei_solar.forcible_charge' } },
  { platform: 'solaredge_modbus_multi', note: 'Storage Control Mode "Remote Control" + Command Mode', list: [
    ['sensor.solaredge_i1_b1_state_of_energy', '70', P, 'b1'],
    ['sensor.solaredge_i1_b1_dc_power', '-500', W, 'b1'],
    ['sensor.solaredge_i1_b1_dc_power_inverted', '500', W, 'b1'],
    ['sensor.solaredge_i1_b1_maximum_energy', '9700', { unit_of_measurement: 'Wh' }, 'b1'],
    ['select.solaredge_i1_storage_control_mode', 'Maximize Self Consumption', { options: ['Disabled', 'Maximize Self Consumption', 'Time of Use', 'Backup Only', 'Remote Control'] }, 'i1'],
    ['select.solaredge_i1_storage_command_mode', 'Maximize Self Consumption', { options: ['Solar Power Only (Off)', 'Charge from Clipped Solar Power', 'Charge from Solar Power', 'Charge from Solar Power and Grid', 'Discharge to Maximize Export', 'Discharge to Minimize Import', 'Maximize Self Consumption'] }, 'i1'],
    ['number.solaredge_i1_storage_charge_limit', '5000', W, 'i1'],
    ['number.solaredge_i1_storage_discharge_limit', '5000', W, 'i1'],
    ['number.solaredge_i1_storage_command_timeout', '3600', { unit_of_measurement: 's' }, 'i1'],
  ], expect: { soc: 'sensor.solaredge_i1_b1_state_of_energy', power: 'sensor.solaredge_i1_b1_dc_power', kw: -0.5, actions: ['auto', 'charge', 'discharge', 'hold', 'no_discharge'], charge: 'select.select_option:Charge from Solar Power and Grid' } },
  { platform: 'victron', note: 'ESS mode select, max discharge power (sfstar/hass-victron)', list: [
    ['sensor.victron_system_battery_soc', '65', P, 'gx'],
    ['sensor.victron_system_battery_power', '1200', W, 'gx'],
    ['select.victron_settings_ess_mode', 'SELF_CONSUMPTION_WITH_BATTERY_LIFE', { options: ['SELF_CONSUMPTION_WITH_BATTERY_LIFE', 'SELF_CONSUMPTION', 'KEEP_CHARGED', 'EXTERNAL_CONTROL'] }, 'gx'],
    ['number.victron_settings_ess_maxdischargepower', '4000', { unit_of_measurement: 'W', min: 0, max: 8000 }, 'gx'],
  ], expect: { soc: 'sensor.victron_system_battery_soc', power: 'sensor.victron_system_battery_power', kw: 1.2, actions: ['auto', 'charge', 'no_discharge'], charge: 'select.select_option:KEEP_CHARGED' } },
  { platform: 'goodwe', note: 'operation mode general / eco_charge / eco_discharge; battery power positive = discharging', list: [
    ['sensor.battery_state_of_charge', '80', P, 'gw'],
    ['sensor.battery_power', '1500', W, 'gw'],
    ['sensor.pv_power', '3000', W, 'gw'],
    ['select.inverter_operation_mode', 'general', { options: ['general', 'off_grid', 'backup', 'eco', 'peak_shaving', 'eco_charge', 'eco_discharge'] }, 'gw'],
  ], expect: { soc: 'sensor.battery_state_of_charge', power: 'sensor.battery_power', kw: -1.5, actions: ['auto', 'charge', 'discharge'], charge: 'select.select_option:eco_charge' } },
  { platform: 'teslemetry', note: 'operation mode + backup reserve; no forced charging', list: [
    ['sensor.my_home_percentage_charged', '75', P, 'site'],
    ['sensor.my_home_battery_power', '2000', W, 'site'],
    ['select.my_home_operation_mode', 'self_consumption', { options: ['autonomous', 'backup', 'self_consumption'] }, 'site'],
    ['number.my_home_backup_reserve', '20', { unit_of_measurement: '%', min: 0, max: 100 }, 'site'],
  ], expect: { soc: 'sensor.my_home_percentage_charged', power: 'sensor.my_home_battery_power', actions: ['auto', 'no_discharge'], noDischarge: 'number.set_value:75' } },
  { platform: 'homewizard', note: 'battery group mode on the P1 meter: zero / to_full / standby / zero_charge_only', list: [
    ['sensor.p1_meter_power', '300', W, 'p1'],
    ['select.p1_meter_battery_group_charging_strategy', 'zero', { options: ['standby', 'to_full', 'zero', 'zero_charge_only', 'zero_discharge_only'] }, 'p1'],
    ['sensor.plug_in_battery_state_of_charge', '50', P, 'pib'],
    ['sensor.plug_in_battery_power', '-400', W, 'pib'],
  ], expect: { soc: 'sensor.plug_in_battery_state_of_charge', power: 'sensor.plug_in_battery_power', kw: -0.4, actions: ['auto', 'charge', 'hold', 'no_discharge'], charge: 'select.select_option:to_full' } },
  { platform: 'marstek_modbus', note: 'RS485 control + force mode standby/charge/discharge, power in W', list: [
    ['sensor.marstek_venus_battery_soc', '45', P, 'mv'],
    ['sensor.marstek_venus_battery_power', '600', W, 'mv'],
    ['sensor.marstek_venus_battery_total_energy', '5.12', { unit_of_measurement: 'kWh' }, 'mv'],
    ['switch.marstek_venus_rs485_control_mode', 'off', {}, 'mv'],
    ['select.marstek_venus_force_mode', 'standby', { options: ['standby', 'charge', 'discharge'] }, 'mv'],
    ['select.marstek_venus_user_work_mode', 'anti_feed', { options: ['manual', 'anti_feed', 'trade_mode'] }, 'mv'],
    ['number.marstek_venus_set_charge_power', '0', { unit_of_measurement: 'W', min: 0, max: 2500 }, 'mv'],
    ['number.marstek_venus_set_discharge_power', '0', { unit_of_measurement: 'W', min: 0, max: 2500 }, 'mv'],
  ], expect: { soc: 'sensor.marstek_venus_battery_soc', power: 'sensor.marstek_venus_battery_power', actions: ['auto', 'charge', 'discharge', 'hold'], charge: 'select.select_option:charge' } },
  { platform: 'marstek_local_api', note: 'set_passive_mode (negative power = charge) + Auto mode button', list: [
    ['sensor.venus_battery_soc', '60', P, 'mv'],
    ['sensor.venus_power', '-300', W, 'mv'],
    ['button.venus_auto_mode', 'unknown', {}, 'mv'],
  ], expect: { soc: 'sensor.venus_battery_soc', power: 'sensor.venus_power', actions: ['charge', 'discharge', 'auto'], charge: 'marstek_local_api.set_passive_mode' } },
  { platform: 'sessy', note: 'power strategy select: idle for hold; setpoint sign not documented, so no charging', list: [
    ['sensor.sessy_a1b2_state_of_charge', '35', P, 'ss'],
    ['sensor.sessy_a1b2_power', '-1000', W, 'ss'],
    ['select.sessy_a1b2_power_strategy', 'roi', { options: ['api', 'nom', 'roi', 'idle', 'eco', 'sessy_connect'] }, 'ss'],
  ], expect: { soc: 'sensor.sessy_a1b2_state_of_charge', power: 'sensor.sessy_a1b2_power', kw: 1, actions: ['auto', 'hold'] } },
  { platform: 'zonneplan_one', note: 'read only: Zonneplan steers the Nexus itself', list: [
    ['sensor.nexus_percentage', '62', P, 'zp'],
    ['sensor.nexus_power', '0', W, 'zp'],
  ], expect: { soc: 'sensor.nexus_percentage', readOnly: true } },
  { platform: 'growatt_server', note: 'read only (time segments in %)', list: [
    ['sensor.growatt_tlx_statement_of_charge', '70', P, 'gr'],
  ], expect: { soc: 'sensor.growatt_tlx_statement_of_charge', readOnly: true } },
  { platform: 'anker_solix', note: 'read only (schedules and presets)', list: [
    ['sensor.solarbank_state_of_charge', '90', P, 'ak'],
    ['sensor.solarbank_battery_power', '100', W, 'ak'],
  ], expect: { soc: 'sensor.solarbank_state_of_charge', readOnly: true } },
  { platform: 'ecoflow_cloud', note: 'read only', list: [
    ['sensor.powerocean_bpsoc', '50', P, 'ef'],
  ], expect: { soc: 'sensor.powerocean_bpsoc', readOnly: true } },
  { platform: 'powerwall', note: 'local Powerwall: read only', list: [
    ['sensor.powerwall_charge', '88', P, 'pw'],
    ['sensor.powerwall_battery_power', '-1.1', KW, 'pw'],
  ], expect: { soc: 'sensor.powerwall_charge', readOnly: true } },
];

for (const b of BRANDS) {
  console.log(`${battery.BRANDS[b.platform].name} (${b.platform}) – ${b.note}`);
  const entities = b.list.map(([entity_id, , , dev]) => ({ entity_id, platform: b.platform, device_id: dev }));
  const devices = [...new Set(b.list.map((x) => x[3]))].map((id) => ({ id, name: `${battery.BRANDS[b.platform].name} ${id}` }));
  const states = b.list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes: { friendly_name: entity_id, ...attributes } }));
  const found = battery.detectBatteries(entities, devices, states);
  const c = found[0];
  check(`battery level ${b.expect.soc}`, () => assert.ok(c && c.soc_entity === b.expect.soc, JSON.stringify(found)));
  if (!c) continue;
  if (b.expect.power) check(`power ${b.expect.power}`, () => assert.strictEqual(c.power_entity, b.expect.power));
  if (b.expect.capacity) check(`capacity ${b.expect.capacity}`, () => assert.strictEqual(c.capacity_entity, b.expect.capacity));
  if (b.expect.kw != null) check(`power ${b.expect.kw} kW (positive = charging)`, () => assert.ok(Math.abs(battery.powerKw(c, states) - b.expect.kw) < 1e-9, `${battery.powerKw(c, states)}`));
  const ctl = battery.controlFor(c, entities, states);
  if (b.expect.readOnly) {
    check('read only, with the reason', () => assert.ok(!ctl.available && ctl.note, JSON.stringify(ctl)));
    continue;
  }
  check(`can: ${b.expect.actions.join(', ')}`, () => assert.deepStrictEqual([...ctl.supported].sort(), [...b.expect.actions].sort()));
  const allowed = battery.allowedFor(ctl);
  check('every command allowed by the guard, nothing else', () => {
    for (const a of ctl.supported) {
      const r = battery.commandsFor(ctl, a, 3, 75);
      assert.ok(r && r.commands.length, `no commands for ${a}`);
      for (const cmd of r.commands) {
        const ok = allowed.some((x) => x.service === cmd.service && (!x.entity_id || (cmd.target && cmd.target.entity_id === x.entity_id)));
        assert.ok(ok, `${a}: ${cmd.service} ${JSON.stringify(cmd.target)} not allowed`);
      }
    }
    assert.ok(!allowed.some((x) => x.entity_id && !states.find((s) => s.entity_id === x.entity_id)), 'guard allows unknown entities');
  });
  const fmt = (cmd) => (cmd.service.endsWith('select_option') ? `${cmd.service}:${cmd.data.option}` : cmd.service.endsWith('set_value') ? `${cmd.service}:${cmd.data.value}` : cmd.service);
  if (b.expect.charge) check(`charge: ${b.expect.charge}`, () => assert.ok(battery.commandsFor(ctl, 'charge', 3, 50).commands.map(fmt).includes(b.expect.charge)));
  if (b.expect.noDischarge) check(`no discharging: ${b.expect.noDischarge}`, () => assert.ok(battery.commandsFor(ctl, 'no_discharge', 3, 75).commands.map(fmt).includes(b.expect.noDischarge)));
  if (!ctl.supported.includes('no_discharge')) {
    check('no discharging falls back to hold (or is not possible)', () => {
      const r = battery.commandsFor(ctl, 'no_discharge', 3, 50);
      assert.ok(ctl.supported.includes('hold') ? r.action === 'hold' : r === null, JSON.stringify(r && r.action));
    });
  }
}

// ---------------------------------------------------------------------------
console.log('Battery plan');
const H = 3600000;
const day = (f) => Array.from({ length: 24 }, (_, h) => ({ start: h * H, end: (h + 1) * H, buy: 0.28, sell: 0.05, house_kw: 0.4, pv_kw: 0, ev_kw: 0, ...f(h) }));
const bat = { capacity_kwh: 10, soc_pct: 20, min_pct: 10, max_pct: 100, charge_kw: 5, discharge_kw: 5, efficiency: 0.9, wear: 0.02, actions: ['auto', 'hold', 'no_discharge', 'charge'] };
check('big spread (0.10 at night, 0.45 in the evening): charges at night, saves money', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.10 : h >= 17 && h < 22 ? 0.45 : 0.28, house_kw: h >= 17 && h < 22 ? 2 : 0.4 })), bat);
  assert.ok(r.actions.slice(0, 5).some((a) => a.action === 'charge'), r.actions.map((a) => a.action[0]).join(''));
  assert.ok(r.saving > 0.5, `saving ${r.saving}`);
});
check('small spread (0.27 vs 0.28): never charges from the grid (losses and wear)', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.27 : 0.28 })), bat);
  assert.ok(!r.actions.some((a) => a.action === 'charge'), r.actions.map((a) => a.action[0]).join(''));
});
check('grid charging off: no "charge" at all', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.10 : 0.45 })), { ...bat, actions: ['auto', 'hold', 'no_discharge'] });
  assert.ok(!r.actions.some((a) => a.action === 'charge'));
});
check('cheap morning, expensive evening: holds in the morning instead of emptying', () => {
  const r = planBattery(day((h) => ({ buy: h >= 6 && h < 12 ? 0.15 : h >= 17 && h < 22 ? 0.45 : 0.28, house_kw: 0.6 })), { ...bat, soc_pct: 80, actions: ['auto', 'hold', 'no_discharge'] });
  assert.ok(r.actions.slice(6, 12).every((a) => a.action !== 'auto'), r.actions.map((a) => a.action[0]).join(''));
});
check('car charging at night, "never": the battery does not discharge into it', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 11 : 0 })), { ...bat, soc_pct: 80, ev_discharge: 'never' });
  assert.ok(r.actions.slice(0, 4).every((a) => a.action !== 'auto' && a.discharge_kwh === 0), JSON.stringify(r.actions.slice(0, 4).map((a) => [a.action, a.discharge_kwh])));
});
check('car charging, "always": the battery may cover the car when that pays', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 11 : 0, buy: h < 4 ? 0.40 : 0.20 })), { ...bat, soc_pct: 90, ev_discharge: 'always' });
  assert.ok(r.actions.slice(0, 4).some((a) => a.discharge_kwh > 0.5), JSON.stringify(r.actions.slice(0, 4).map((a) => [a.action, a.discharge_kwh])));
});
check('sun: fills from solar surplus, never above the maximum', () => {
  const r = planBattery(day((h) => ({ pv_kw: h >= 10 && h < 16 ? 4 : 0 })), { ...bat, max_pct: 90 });
  assert.ok(Math.max(...r.actions.map((a) => a.soc_pct)) <= 90.01 && r.actions[15].soc_pct > 80, r.actions.map((a) => Math.round(a.soc_pct)).join(' '));
});
check('never below the minimum', () => {
  const r = planBattery(day((h) => ({ house_kw: 2, buy: 0.5 })), { ...bat, soc_pct: 50, min_pct: 20 });
  assert.ok(Math.min(...r.actions.map((a) => a.soc_pct)) >= 19.99, r.actions.map((a) => Math.round(a.soc_pct)).join(' '));
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

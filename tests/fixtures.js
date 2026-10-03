'use strict';

// Brand fixtures shared by the tests: real entity, option and action names of
// the charger and home battery integrations (taken from their source code).
//   CHARGERS:  brands.test.js and matrix.test.js
//   BATTERIES: battery.test.js and matrix.test.js

// Build registries and states for one device.
function device(id, name, platform, list) {
  const entities = list.map(([entity_id]) => ({ entity_id, device_id: id, platform }));
  const states = list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes: { friendly_name: entity_id, ...(attributes || {}) } }));
  return { entities, devices: [{ id, name }], states };
}
const W = { unit_of_measurement: 'W', device_class: 'power' };
const KW = { unit_of_measurement: 'kW', device_class: 'power' };
const A = (min, max) => ({ unit_of_measurement: 'A', min, max });

const CHARGERS = [
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

// Tesla Wall Connector: the integration can only read.
CHARGERS.push({
  brand: 'Tesla Wall Connector',
  readOnly: true,
  dev: device('d', 'Tesla Wall Connector', 'tesla_wall_connector', [
    ['sensor.tesla_wall_connector_status', 'charging_finished'],
    ['sensor.tesla_wall_connector_power', '0', W],
  ]),
  services: {},
  expect: {},
  statuses: { not_connected: [false, null], charging: [true, true], charging_finished: [true, false] },
});

const P = { unit_of_measurement: '%' };

// [entity_id, state, attributes, device]
const BATTERIES = [
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


module.exports = { CHARGERS, BATTERIES, device };

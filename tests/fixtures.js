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
    dev: device('d', 'EH123456', 'easee', [
      ['sensor.eh123456_status', 'awaiting_start', { device_class: 'enum' }],
      ['sensor.eh123456_power', '0', KW],
      ['switch.eh123456_charger_enabled', 'on'],
      ['switch.eh123456_smart_charging', 'on'],
      ['button.eh123456_override_schedule', 'unknown'],
    ]),
    services: {
      easee: {
        action_command: { fields: { device_id: {}, action_command: { selector: { select: { options: ['start', 'stop', 'pause', 'resume', 'toggle', 'reboot'] } } } } },
        set_charger_dynamic_limit: { name: 'Set charger dynamic limit', fields: { device_id: {}, current: { selector: { number: { min: 0, max: 32, unit_of_measurement: 'A' } } }, time_to_live: { selector: { number: { min: 0, max: 1080 } } } } },
        set_charger_phase_mode: { name: 'Set charger phase mode', fields: { device_id: {}, phase_mode: { selector: { select: { options: ['1_phase', 'auto_phase', '3_phase'] } } } } },
      },
    },
    expect: { status: 'sensor.eh123456_status', power: 'sensor.eh123456_power', startStop: 'switch', switchEntity: 'switch.eh123456_charger_enabled', noWarning: 'own_smart_charging_on', current: 'action_current:set_charger_dynamic_limit', phase: 'action_phase:1_phase/3_phase' },
    // All status texts of the integration (nordicopen/easee_hass, EASEE_STATUS).
    statuses: { awaiting_start: [true, false], charging: [true, true], disconnected: [false, null], completed: [true, false], ready_to_charge: [true, false], awaiting_authorization: [true, false], de_authorizing: [true, null], start_charging: [true, null], stop_charging: [true, null], awaiting_load_balancing: [true, false], awaiting_smart_start: [true, false] },
    problems: ['error', 'offline'],
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
    // custom-components/zaptec, charger_operation_mode.
    statuses: { disconnected: [false, null], connected_requesting: [true, false], connected_charging: [true, true], connected_finished: [true, false] },
    problems: ['unknown'],
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
    // leeyuentuen/alfen_wallbox, STATUS_DICT.
    statuses: {
      Available: [false, null], Authorizing: [true, null], Authorized: [true, null], 'Cable connected': [true, null], 'EV Connected': [true, null],
      'Preparing Charging': [true, null], 'Wait Vehicle Charging': [true, false], 'Charging Normal': [true, true], 'Charging Simplified': [true, true],
      'Suspended Over-Current': [true, false], 'Suspended Over Current': [true, false], 'Suspended HF Switching': [true, false],
      'Finish Wait Vehicle': [true, false], 'Finish Wait Disconnect': [true, false], Reserved: [false, null],
      'Load Balancing Limited': [true, null], 'Load Balancing Forced Off': [true, null], 'Not Charging': [true, false],
      'Solar Charging Wait': [true, false], 'Charging Non Charging': [true, false], 'Solar Charging': [true, true], 'Partial Solar Charging': [true, true],
      'Charge Point Ready, Waiting For Power': [true, false],
    },
    problems: ['Unknown', 'Off', 'Booting', 'Check Mains', 'Error Protective Earth', 'Error Contactor Fault', 'Error Illegal CP Value', 'Error Message Time-Out', 'Error', 'In Operative'],
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
    // Home Assistant core, wallbox/const.py ChargerStatus.
    statuses: {
      Charging: [true, true], Discharging: [true, null], Paused: [true, false], Scheduled: [true, null], Ready: [false, null], Disconnected: [false, null],
      'Waiting for car demand': [true, false], Waiting: [true, false], Locked: [false, null], 'Locked, car connected': [true, null],
      'Waiting in queue by Power Sharing': [true, false], 'Waiting in queue by Power Boost': [true, false], 'Waiting MID failed': [true, false],
      'Waiting MID safety margin exceeded': [true, false], 'Waiting in queue by Eco-Smart': [true, false],
    },
    problems: ['Error', 'Updating', 'Unknown'],
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
    // marq24/ha-goecharger-api2, car state (lookup sensor).
    statuses: { Idle: [false, null], Charging: [true, true], 'Wait for car': [true, false], Complete: [true, false] },
    problems: ['Unknown/Error', 'Error'],
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
    // Home Assistant core, peblar/const.py PEBLAR_CP_STATE_TO_HOME_ASSISTANT.
    statuses: { no_ev_connected: [false, null], charging: [true, true], suspended: [true, false] },
    problems: ['error', 'fault', 'invalid'],
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
    // OCPP 1.6 ChargePointStatus (lbbrhzn/ocpp).
    statuses: { Available: [false, null], Preparing: [true, false], Charging: [true, true], SuspendedEV: [true, false], SuspendedEVSE: [true, false], Finishing: [true, false], Reserved: [false, null] },
    problems: ['Faulted', 'Unavailable'],
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
    // Home Assistant core, ohme ChargerStatus.
    statuses: { unplugged: [false, null], plugged_in: [true, false], charging: [true, true], paused: [true, false], finished: [true, false], pending_approval: [true, null] },
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


// ---------------------------------------------------------------------------
// Cars: the real entity names of the car integrations, read from their source
// code (entity descriptions and English translations, October 2026). An
// entity's id is the car's name plus the entity's name, as Home Assistant
// makes it. Entities that are off by default in the integration are marked
// { disabled: true }: Home Assistant lists them, but the app must not use them.
//   cars.test.js and matrix.test.js
// Each car: brand, platform (the integration), name (the car's device name),
// capacity (kWh), list ([entity_id, state, attributes, { disabled }]),
// dynamic (which entity shows the battery level, the plug, charging and the
// limit in the fake, and how), expect (what the app should pick).
const PCT = { unit_of_measurement: '%' };
const BAT = { unit_of_measurement: '%', device_class: 'battery' };
const KM = { unit_of_measurement: 'km', device_class: 'distance' };
const PLUG = { device_class: 'plug' };
const CHG = { device_class: 'battery_charging' };
const CONN = { device_class: 'connectivity' };
const ENUM = { device_class: 'enum' };
const lim = (min, max, step, dc = 'battery') => ({ unit_of_measurement: '%', min, max, step, mode: 'slider', ...(dc ? { device_class: dc } : {}) });
const off = { disabled: true };
const named = (name, list) => list.map(([id, st, a, extra]) => [id, st, { friendly_name: `${name} ${a.name}`, ...a, name: undefined }, extra]);

// Tesla Fleet, Teslemetry and Tessie share the names (home-assistant/core).
const tesla = (platform, name, slug, o = {}) => ({
  brand: { tesla_fleet: 'Tesla (Tesla Fleet)', teslemetry: 'Tesla (Teslemetry)', tessie: 'Tesla (Tessie)' }[platform],
  platform, name, capacity: o.capacity || 75,
  source: `home-assistant/core: homeassistant/components/${platform}`,
  list: named(name, [
    [`sensor.${slug}_battery_level`, '55', { name: 'Battery level', ...BAT }],
    ...(platform === 'teslemetry'
      ? [[`sensor.${slug}_battery_range`, '310', { name: 'Battery range', ...KM }, off], [`sensor.${slug}_estimate_battery_range`, '290', { name: 'Estimate battery range', ...KM }]]
      : [[`sensor.${slug}_battery_range`, '310', { name: 'Battery range', ...KM }], [`sensor.${slug}_estimate_battery_range`, '290', { name: 'Estimate battery range', ...KM }, off]]),
    [`sensor.${slug}_usable_battery_level`, '54', { name: 'Usable battery level', ...BAT }, off],
    [`sensor.${slug}_charging`, 'stopped', { name: 'Charging', ...ENUM, options: ['starting', 'charging', 'stopped', 'complete', 'disconnected', 'no_power'] }],
    ...(platform === 'tessie' ? [[`binary_sensor.${slug}_charging`, 'off', { name: 'Charging', ...CHG }]] : []),
    [`sensor.${slug}_charger_power`, '0', { name: 'Charger power', unit_of_measurement: 'kW', device_class: 'power' }],
    [`sensor.${slug}_charge_cable`, 'unknown', { name: 'Charge cable', ...ENUM }, off],
    [`binary_sensor.${slug}_charge_cable`, 'on', { name: 'Charge cable', ...CONN }],
    [`binary_sensor.${slug}_preconditioning_enabled`, 'off', { name: 'Preconditioning enabled' }],
    [`number.${slug}_charge_limit`, '80', { name: 'Charge limit', ...lim(50, 100, 1) }],
    [`number.${slug}_charge_current`, '16', { name: 'Charge current', unit_of_measurement: 'A', min: 0, max: 32, step: 1 }],
    [`switch.${slug}_charge`, 'off', { name: 'Charge' }],
  ]),
  dynamic: {
    soc: `sensor.${slug}_battery_level`,
    plug: { id: `binary_sensor.${slug}_charge_cable`, on: 'on', off: 'off' },
    charging: platform === 'tessie'
      ? [{ id: `binary_sensor.${slug}_charging`, on: 'on', off: 'off' }, { id: `sensor.${slug}_charging`, on: 'charging', off: 'stopped' }]
      : [{ id: `sensor.${slug}_charging`, on: 'charging', off: 'stopped' }],
    limit: `number.${slug}_charge_limit`,
  },
  expect: {
    soc: `sensor.${slug}_battery_level`,
    range: platform === 'teslemetry' ? `sensor.${slug}_estimate_battery_range` : `sensor.${slug}_battery_range`,
    plugged: `binary_sensor.${slug}_charge_cable`,
    charging: platform === 'tessie' ? `binary_sensor.${slug}_charging` : `sensor.${slug}_charging`,
    limit: `number.${slug}_charge_limit`, writable: true, limit85: 85,
  },
});

const CARS = [
  tesla('tesla_fleet', 'Model Y', 'model_y', { capacity: 75 }),
  tesla('teslemetry', 'Model 3', 'model_3', { capacity: 60 }),
  tesla('tessie', 'Model S', 'model_s', { capacity: 100 }),
  {
    // home-assistant/core: homeassistant/components/renault (battery and plug
    // without a translation key: named after their device class).
    brand: 'Renault', platform: 'renault', name: 'Megane', capacity: 60,
    source: 'home-assistant/core: homeassistant/components/renault',
    list: named('Megane', [
      ['sensor.megane_battery', '55', { name: 'Battery', ...BAT }],
      ['sensor.megane_battery_autonomy', '240', { name: 'Battery autonomy', ...KM }],
      ['sensor.megane_battery_available_energy', '31', { name: 'Battery available energy', unit_of_measurement: 'kWh', device_class: 'energy' }],
      ['sensor.megane_charge_state', 'not_in_charge', { name: 'Charge state', ...ENUM }],
      ['sensor.megane_plug_state', 'plugged', { name: 'Plug state', ...ENUM, options: ['unplugged', 'plugged', 'plug_error', 'plug_unknown'] }],
      ['sensor.megane_charging_power', '0', { name: 'Charging power', unit_of_measurement: 'kW', device_class: 'power' }],
      ['binary_sensor.megane_plug', 'on', { name: 'Plug', ...PLUG }],
      ['binary_sensor.megane_charging', 'off', { name: 'Charging', ...CHG }],
      ['number.megane_minimum_charge_level', '15', { name: 'Minimum charge level', ...lim(15, 45, 5) }],
      ['number.megane_target_charge_level', '80', { name: 'Target charge level', ...lim(55, 100, 5) }],
    ]),
    dynamic: {
      soc: 'sensor.megane_battery',
      plug: [{ id: 'binary_sensor.megane_plug', on: 'on', off: 'off' }, { id: 'sensor.megane_plug_state', on: 'plugged', off: 'unplugged' }],
      charging: [{ id: 'binary_sensor.megane_charging', on: 'on', off: 'off' }, { id: 'sensor.megane_charge_state', on: 'charge_in_progress', off: 'not_in_charge' }],
      limit: 'number.megane_target_charge_level',
    },
    expect: { soc: 'sensor.megane_battery', range: 'sensor.megane_battery_autonomy', plugged: 'binary_sensor.megane_plug', charging: 'binary_sensor.megane_charging', limit: 'number.megane_target_charge_level', writable: true, limit85: 85 },
  },
  {
    // Hyundai-Kia-Connect/kia_uvo (HACS): sensor.py, binary_sensor.py,
    // number.py and translations/en.json. The DC limit is listed before the AC
    // limit here on purpose: the order in the registry can differ, and for
    // charging at home the app must take the AC limit.
    brand: 'Hyundai / Kia (Kia Uvo / Hyundai Bluelink)', platform: 'kia_uvo', name: 'Ioniq 5', capacity: 77,
    source: 'github.com/Hyundai-Kia-Connect/kia_uvo',
    list: named('Ioniq 5', [
      ['sensor.ioniq_5_total_driving_range', '330', { name: 'Total Driving Range', ...KM }],
      ['sensor.ioniq_5_ev_battery_level', '55', { name: 'EV Battery Level', ...BAT }],
      ['sensor.ioniq_5_ev_state_of_health_battery', '97', { name: 'EV State of Health Battery', ...BAT }],
      ['sensor.ioniq_5_ev_range', '330', { name: 'EV Range', ...KM }],
      ['binary_sensor.ioniq_5_ev_battery_charge', 'off', { name: 'EV Battery Charge', ...CHG }],
      ['binary_sensor.ioniq_5_ev_battery_plug', 'on', { name: 'EV Battery Plug', ...PLUG }],
      ['number.ioniq_5_dc_charging_limit', '80', { name: 'DC Charging Limit', ...lim(50, 100, 10, null) }],
      ['number.ioniq_5_ac_charging_limit', '80', { name: 'AC Charging Limit', ...lim(50, 100, 10, null) }],
      ['number.ioniq_5_v2l_limit', '20', { name: 'V2L Limit', ...lim(20, 80, 5, null) }],
    ]),
    dynamic: {
      soc: 'sensor.ioniq_5_ev_battery_level',
      plug: { id: 'binary_sensor.ioniq_5_ev_battery_plug', on: 'on', off: 'off' },
      charging: { id: 'binary_sensor.ioniq_5_ev_battery_charge', on: 'on', off: 'off' },
      limit: 'number.ioniq_5_ac_charging_limit',
    },
    expect: { soc: 'sensor.ioniq_5_ev_battery_level', range: 'sensor.ioniq_5_ev_range', plugged: 'binary_sensor.ioniq_5_ev_battery_plug', charging: 'binary_sensor.ioniq_5_ev_battery_charge', limit: 'number.ioniq_5_ac_charging_limit', writable: true, limit85: 90 },
  },
  {
    // skodaconnect/homeassistant-myskoda (HACS).
    brand: 'Skoda (MySkoda)', platform: 'myskoda', name: 'Enyaq', capacity: 77,
    source: 'github.com/skodaconnect/homeassistant-myskoda',
    list: named('Enyaq', [
      ['sensor.enyaq_battery_percentage', '55', { name: 'Battery Percentage', ...BAT }],
      ['sensor.enyaq_range', '300', { name: 'Range', ...KM }],
      ['sensor.enyaq_electric_range', '300', { name: 'Electric Range', ...KM }],
      ['sensor.enyaq_charging_state', 'ready_for_charging', { name: 'Charging State', ...ENUM }],
      ['sensor.enyaq_charging_power', '0', { name: 'Charging Power', unit_of_measurement: 'kW', device_class: 'power' }],
      ['sensor.enyaq_target_battery_percentage', '80', { name: 'Target Battery Percentage', ...PCT }],
      ['binary_sensor.enyaq_charger_connected', 'on', { name: 'Charger Connected', ...PLUG }],
      ['binary_sensor.enyaq_charge_lock', 'on', { name: 'Charge Lock', device_class: 'lock' }],
      ['number.enyaq_charge_limit', '80', { name: 'Charge Limit', ...lim(50, 100, 10) }],
      ['switch.enyaq_charging', 'off', { name: 'Charging' }],
      ['switch.enyaq_battery_care', 'off', { name: 'Battery Care' }],
    ]),
    dynamic: {
      soc: 'sensor.enyaq_battery_percentage',
      plug: { id: 'binary_sensor.enyaq_charger_connected', on: 'on', off: 'off' },
      charging: { id: 'sensor.enyaq_charging_state', on: 'charging', off: 'ready_for_charging' },
      limit: 'number.enyaq_charge_limit',
    },
    expect: { soc: 'sensor.enyaq_battery_percentage', range: 'sensor.enyaq_electric_range', plugged: 'binary_sensor.enyaq_charger_connected', charging: 'sensor.enyaq_charging_state', limit: 'number.enyaq_charge_limit', writable: true, limit85: 90 },
  },
  {
    // mitch-dc/volkswagen_we_connect_id (HACS): names are "<nickname> <name>".
    // The target SoC is listed before the battery level, as in its sensor.py.
    brand: 'Volkswagen ID (WeConnect ID)', platform: 'volkswagen_we_connect_id', name: 'ID.4', capacity: 77,
    source: 'github.com/mitch-dc/volkswagen_we_connect_id',
    list: named('ID.4', [
      ['sensor.id_4_charging_state', 'readyForCharging', { name: 'Charging State' }],
      ['sensor.id_4_charging_mode', 'manual', { name: 'Charging Mode' }],
      ['sensor.id_4_charge_power', '0', { name: 'Charge Power', unit_of_measurement: 'kW', device_class: 'power' }],
      ['sensor.id_4_target_state_of_charge', '80', { name: 'Target State of Charge', ...BAT }],
      ['sensor.id_4_state_of_charge', '55', { name: 'State of Charge', ...BAT }],
      ['sensor.id_4_range', '280', { name: 'Range', ...KM }],
      ['sensor.id_4_auto_unlock_plug_when_charged', 'permanent', { name: 'Auto Unlock Plug When Charged' }],
      ['sensor.id_4_plug_connection_state', 'connected', { name: 'Plug Connection State' }],
      ['sensor.id_4_plug_lock_state', 'locked', { name: 'Plug Lock State' }],
      ['binary_sensor.id_4_car_is_online', 'on', { name: 'Car Is Online', ...CONN }],
      ['number.id_4_target_state_of_charge', '80', { name: 'Target State Of Charge', ...lim(10, 100, 10, null) }],
    ]),
    dynamic: {
      soc: 'sensor.id_4_state_of_charge',
      plug: { id: 'sensor.id_4_plug_connection_state', on: 'connected', off: 'disconnected' },
      charging: { id: 'sensor.id_4_charging_state', on: 'charging', off: 'readyForCharging' },
      limit: ['number.id_4_target_state_of_charge', 'sensor.id_4_target_state_of_charge'],
    },
    expect: { soc: 'sensor.id_4_state_of_charge', range: 'sensor.id_4_range', plugged: 'sensor.id_4_plug_connection_state', charging: 'sensor.id_4_charging_state', limit: 'number.id_4_target_state_of_charge', writable: true, limit85: 90 },
  },
  {
    // home-assistant/core: homeassistant/components/volvo. No number for the
    // target: it can only be read.
    brand: 'Volvo', platform: 'volvo', name: 'EX30', capacity: 64,
    source: 'home-assistant/core: homeassistant/components/volvo',
    list: named('EX30', [
      ['sensor.ex30_battery_charge_level', '55', { name: 'Battery charge level', ...BAT }],
      ['sensor.ex30_distance_to_empty_battery', '250', { name: 'Distance to empty battery', ...KM }],
      ['sensor.ex30_charging_connection_status', 'connected', { name: 'Charging connection status', ...ENUM, options: ['connected', 'disconnected', 'fault'] }],
      ['sensor.ex30_charging_status', 'idle', { name: 'Charging status', ...ENUM, options: ['charging', 'discharging', 'done', 'error', 'idle', 'scheduled'] }],
      ['sensor.ex30_charging_limit', '16', { name: 'Charging limit', unit_of_measurement: 'A', device_class: 'current' }],
      ['sensor.ex30_charging_power', '0', { name: 'Charging power', unit_of_measurement: 'W', device_class: 'power' }],
      ['sensor.ex30_target_battery_charge_level', '80', { name: 'Target battery charge level', ...PCT }],
    ]),
    dynamic: {
      soc: 'sensor.ex30_battery_charge_level',
      plug: { id: 'sensor.ex30_charging_connection_status', on: 'connected', off: 'disconnected' },
      charging: { id: 'sensor.ex30_charging_status', on: 'charging', off: 'idle' },
      limit: 'sensor.ex30_target_battery_charge_level',
    },
    expect: { soc: 'sensor.ex30_battery_charge_level', range: 'sensor.ex30_distance_to_empty_battery', plugged: 'sensor.ex30_charging_connection_status', charging: 'sensor.ex30_charging_status', limit: 'sensor.ex30_target_battery_charge_level', writable: false },
  },
  {
    // pypolestar/polestar_api (HACS); state texts from pypolestar's models.py.
    brand: 'Polestar', platform: 'polestar_api', name: 'Polestar 2', capacity: 78,
    source: 'github.com/pypolestar/polestar_api',
    list: named('Polestar 2', [
      ['sensor.polestar_2_range', '320', { name: 'Range', ...KM }],
      ['sensor.polestar_2_battery_charge_level', '55', { name: 'Battery Charge Level', ...BAT }],
      ['sensor.polestar_2_estimate_full_charge_range', '480', { name: 'Estimate Full Charge Range', ...KM }],
      ['sensor.polestar_2_charging_time', '0', { name: 'Charging Time', unit_of_measurement: 'min' }],
      ['sensor.polestar_2_charging_status', 'Idle', { name: 'Charging Status' }],
      ['sensor.polestar_2_charger_connection_status', 'Connected', { name: 'Charger Connection Status' }],
      ['sensor.polestar_2_charging_power', '0', { name: 'Charging Power', unit_of_measurement: 'W', device_class: 'power' }],
      ['sensor.polestar_2_charging_target_level', '80', { name: 'Charging Target Level', ...PCT }],
      ['binary_sensor.polestar_2_api_connected', 'on', { name: 'API Connected', ...CONN }],
    ]),
    dynamic: {
      soc: 'sensor.polestar_2_battery_charge_level',
      plug: { id: 'sensor.polestar_2_charger_connection_status', on: 'Connected', off: 'Disconnected' },
      charging: { id: 'sensor.polestar_2_charging_status', on: 'Charging', off: 'Idle' },
      limit: 'sensor.polestar_2_charging_target_level',
    },
    expect: { soc: 'sensor.polestar_2_battery_charge_level', range: 'sensor.polestar_2_range', plugged: 'sensor.polestar_2_charger_connection_status', charging: 'sensor.polestar_2_charging_status', limit: 'sensor.polestar_2_charging_target_level', writable: false },
  },
  {
    // ReneNulschDE/mbapi2020 (HACS): const.py. No plug sensor; the maximum
    // is set with an action of the integration, so the app can only read it.
    brand: 'Mercedes-Benz (mbapi2020)', platform: 'mbapi2020', name: 'EQA', capacity: 66,
    source: 'github.com/ReneNulschDE/mbapi2020',
    list: named('EQA', [
      ['sensor.eqa_state_of_charge', '55', { name: 'State of Charge', ...BAT }],
      ['sensor.eqa_max_state_of_charge', '80', { name: 'Max State of Charge', ...PCT }],
      ['sensor.eqa_range_electric', '260', { name: 'Range Electric', ...KM }],
      ['sensor.eqa_charging_status', '3', { name: 'Charging Status' }],
      ['sensor.eqa_charging_power', '0', { name: 'Charging Power', unit_of_measurement: 'kW', device_class: 'power' }],
      ['binary_sensor.eqa_charging_active', 'off', { name: 'Charging active', ...CHG }],
    ]),
    dynamic: {
      soc: 'sensor.eqa_state_of_charge',
      plug: null,
      charging: { id: 'binary_sensor.eqa_charging_active', on: 'on', off: 'off' },
      limit: 'sensor.eqa_max_state_of_charge',
    },
    expect: { soc: 'sensor.eqa_state_of_charge', range: 'sensor.eqa_range_electric', plugged: null, charging: 'binary_sensor.eqa_charging_active', limit: 'sensor.eqa_max_state_of_charge', writable: false },
  },
];

module.exports = { CHARGERS, BATTERIES, CARS, device };

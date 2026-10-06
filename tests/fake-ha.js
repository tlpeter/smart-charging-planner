'use strict';

// A small fake Home Assistant for the settings test: the WebSocket API and the
// REST API the app uses. A profile chooses the car and the charger:
//   renault_easee  Renault Megane E-Tech (renault) + Easee Charge (easee)
//   skoda_wallbox  Skoda Enyaq (myskoda) + Wallbox Pulsar Plus (wallbox)
// Entity names follow the integrations' own source code. Further: a P1
// meter, EnergyZero prices, a price sensor with a 7-day forecast, a calendar,
// helpers and notify actions. Everything the app sends is recorded in `calls`.

const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'node_modules', 'ws'));
const { localMidnight, isoLocal } = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'prices.js'));

const TZ = 'Europe/Amsterdam';

// The car's charging power: current × phases × 230 V while charging.
const carKw = (w) => (w.charging ? Math.round((w.amps ?? 16) * (w.phases ?? 3) * 230) / 1000 : 0);
// Grid power (positive = import): house + car - solar.
// Home battery (Sigenergy): kW, positive = charging.
const batKw = (w) => {
  if (!w.hasBattery) return 0;
  const b = w.bat;
  if (b.ems !== 'on') return b.autoKw || 0;
  if (b.mode === 'Command Charging (Grid First)') return Math.min(5, b.chg);
  if (b.mode === 'Command Discharging (ESS First)') return -Math.min(5, b.dis);
  if (b.mode === 'Standby') return 0;
  return b.autoKw || 0;
};
const gridW = (w) => Math.round((w.houseW ?? 850) + carKw(w) * 1000 + batKw(w) * 1000 - (w.pvW ?? 0));
const PCT = { unit_of_measurement: '%' };
const KW = { unit_of_measurement: 'kW', device_class: 'power' };

const PROFILES = {
  renault_easee: {
    label: 'Renault Megane E-Tech + Easee Charge',
    car: {
      device: 'car', name: 'JLZ03X', manufacturer: 'Renault', model: 'Megane E-Tech', platform: 'renault', capacity: 52,
      soc: 'sensor.jlz03x_battery', range: 'sensor.jlz03x_range', plugged: 'binary_sensor.jlz03x_plugged_in',
      limit: 'number.jlz03x_target_charge_level', limit_min: 55, limit_max: 100, limit_step: 5,
      preheat: 'binary_sensor.jlz03x_hvac',
      states: (w) => [
        ['sensor.jlz03x_battery', w.soc, { friendly_name: 'JLZ03X Battery', ...PCT, device_class: 'battery' }],
        ['sensor.jlz03x_range', '150', { friendly_name: 'JLZ03X Range', unit_of_measurement: 'km', device_class: 'distance' }],
        ['binary_sensor.jlz03x_plugged_in', w.plugged ? 'on' : 'off', { friendly_name: 'JLZ03X Plugged in', device_class: 'plug' }],
        ['binary_sensor.jlz03x_charging', w.charging ? 'on' : 'off', { friendly_name: 'JLZ03X Charging', device_class: 'battery_charging' }],
        ['number.jlz03x_target_charge_level', w.limit, { friendly_name: 'JLZ03X Target charge level', ...PCT, min: 55, max: 100, step: 5 }],
        ['number.jlz03x_minimum_charge_level', '15', { friendly_name: 'JLZ03X Minimum charge level', ...PCT, min: 15, max: 45, step: 5 }],
        ['binary_sensor.jlz03x_hvac', w.preheat, { friendly_name: 'JLZ03X HVAC' }],
      ],
    },
    charger: {
      device: 'ch', name: 'Laadpaal', manufacturer: 'Easee', model: 'Charge', platform: 'easee',
      status: 'sensor.laadpaal_status', power: 'sensor.laadpaal_power', switch: 'switch.laadpaal_charger_enabled',
      text: { unplugged: 'disconnected', paused: 'awaiting_start', charging: 'charging' },
      services: {
        easee: {
          action_command: { fields: { device_id: {}, action_command: { selector: { select: { options: ['start', 'stop', 'pause', 'resume', 'toggle', 'reboot'] } } } } },
          set_charger_dynamic_limit: { name: 'Set charger dynamic limit', fields: { device_id: {}, current: { selector: { number: { min: 0, max: 32, unit_of_measurement: 'A' } } }, time_to_live: { selector: { number: { min: 0, max: 1080 } } } } },
          set_charger_phase_mode: { name: 'Set charger phase mode', fields: { device_id: {}, phase_mode: { selector: { select: { options: ['1_phase', 'auto_phase', '3_phase'] } } } } },
          // Equalizer surplus charging (nordicopen/easee_hass services.yaml)
          set_surplus_charging: { name: 'Set surplus charging', fields: { device_id: {}, equalizer_id: {}, enable: { selector: { boolean: {} } }, current: { selector: { number: { min: 0, max: 40, unit_of_measurement: 'A' } } } } },
        },
      },
      // An Easee Equalizer with surplus charging, on its own device.
      equalizer: (w) => [
        ['switch.equalizer_surplus_charging', w.eqSurplus ? 'on' : 'off', { friendly_name: 'Equalizer Surplus charging', surplusChargingCurrent: w.eqCurrent ?? 0 }, 'eq'],
        ['sensor.equalizer_export_power', '0', { friendly_name: 'Equalizer Export power', unit_of_measurement: 'kW', device_class: 'power' }, 'eq'],
      ],
      states: (w, status) => [
        ['sensor.laadpaal_status', status, { friendly_name: 'Laadpaal Status', device_class: 'enum' }],
        ['sensor.laadpaal_power', carKw(w), { friendly_name: 'Laadpaal Power', ...KW }],
        ['switch.laadpaal_charger_enabled', w.charging ? 'on' : 'off', { friendly_name: 'Laadpaal Charger enabled' }],
        ['switch.laadpaal_smart_charging', 'off', { friendly_name: 'Laadpaal Smart charging' }],
      ],
      // What a start or stop command does.
      // Start and stop: the "Charger enabled" switch (the default for Easee).
      react(call) {
        if (call.domain === 'switch' && call.target && call.target.entity_id === 'switch.laadpaal_charger_enabled') {
          return call.service === 'turn_on' ? 'start' : call.service === 'turn_off' ? 'stop' : null;
        }
        if (call.domain !== 'easee') return null;
        const c = call.data.action_command;
        return ['resume', 'start'].includes(c) ? 'start' : ['pause', 'stop'].includes(c) ? 'stop' : null;
      },
      isStart: (c) => (c.domain === 'switch' && c.service === 'turn_on' && c.target && c.target.entity_id === 'switch.laadpaal_charger_enabled') || (c.domain === 'easee' && ['resume', 'start'].includes(c.data.action_command)),
      isControl: (c) => (c.domain === 'switch' && c.target && c.target.entity_id === 'switch.laadpaal_charger_enabled') || (c.domain === 'easee' && c.service === 'action_command'),
      describe: (c) => (c.domain === 'easee' ? `easee.${c.service} ${JSON.stringify(c.data)}` : `${c.domain}.${c.service} ${c.target && c.target.entity_id}`),
      // Current and phases (solar)
      currentOf: (c) => (c.domain === 'easee' && c.service === 'set_charger_dynamic_limit' ? c.data.current : null),
      phasesOf: (c) => (c.domain === 'easee' && c.service === 'set_charger_phase_mode' ? (c.data.phase_mode === '1_phase' ? 1 : 3) : null),
    },
  },
  skoda_wallbox: {
    label: 'Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus',
    car: {
      device: 'car', name: 'Enyaq', manufacturer: 'Skoda', model: 'Enyaq iV 80', platform: 'myskoda', capacity: 77,
      soc: 'sensor.enyaq_battery_percentage', range: 'sensor.enyaq_range', plugged: 'binary_sensor.enyaq_charger_connected',
      limit: 'number.enyaq_charge_limit', limit_min: 50, limit_max: 100, limit_step: 10,
      preheat: 'input_boolean.enyaq_voorverwarmen',
      states: (w) => [
        ['sensor.enyaq_battery_percentage', w.soc, { friendly_name: 'Enyaq Battery Percentage', ...PCT, device_class: 'battery' }],
        ['sensor.enyaq_range', '210', { friendly_name: 'Enyaq Range', unit_of_measurement: 'km', device_class: 'distance' }],
        ['sensor.enyaq_charging_state', w.charging ? 'charging' : w.plugged ? 'ready_for_charging' : 'connect_cable', { friendly_name: 'Enyaq Charging State', device_class: 'enum' }],
        ['sensor.enyaq_charging_power', carKw(w), { friendly_name: 'Enyaq Charging Power', ...KW }],
        ['binary_sensor.enyaq_charger_connected', w.plugged ? 'on' : 'off', { friendly_name: 'Enyaq Charger Connected', device_class: 'plug' }],
        ['binary_sensor.enyaq_charge_lock', 'on', { friendly_name: 'Enyaq Charge Lock', device_class: 'lock' }],
        ['number.enyaq_charge_limit', w.limit, { friendly_name: 'Enyaq Charge Limit', ...PCT, min: 50, max: 100, step: 10 }],
        ['switch.enyaq_charging', w.charging ? 'on' : 'off', { friendly_name: 'Enyaq Charging' }],
        ['switch.enyaq_battery_care_mode', 'off', { friendly_name: 'Enyaq Battery Care' }],
        ['climate.enyaq_air_conditioning', 'off', { friendly_name: 'Enyaq Air Conditioning' }],
        // A helper of the user, not on the car's device.
        ['input_boolean.enyaq_voorverwarmen', w.preheat, { friendly_name: 'Enyaq voorverwarmen' }, null],
      ],
    },
    charger: {
      device: 'ch', name: 'Wallbox Pulsar Plus', manufacturer: 'Wallbox', model: 'Pulsar Plus', platform: 'wallbox',
      status: 'sensor.wallbox_pulsar_plus_status_description', power: 'sensor.wallbox_pulsar_plus_charging_power',
      switch: 'switch.wallbox_pulsar_plus_pause_resume',
      text: { unplugged: 'Ready', paused: 'Paused', charging: 'Charging' },
      ownMode: 'Eco-smart (select.wallbox_pulsar_plus_ecosmart)',
      services: {},
      states: (w, status) => [
        ['sensor.wallbox_pulsar_plus_status_description', status, { friendly_name: 'Wallbox Pulsar Plus Status Description' }],
        ['sensor.wallbox_pulsar_plus_charging_power', carKw(w), { friendly_name: 'Wallbox Pulsar Plus Charging Power', ...KW }],
        ['sensor.wallbox_pulsar_plus_added_energy', '12.3', { friendly_name: 'Wallbox Pulsar Plus Added Energy', unit_of_measurement: 'kWh', device_class: 'energy' }],
        ['sensor.wallbox_pulsar_plus_charging_speed', '0', { friendly_name: 'Wallbox Pulsar Plus Charging Speed' }],
        ['switch.wallbox_pulsar_plus_pause_resume', w.charging ? 'on' : 'off', { friendly_name: 'Wallbox Pulsar Plus Pause/Resume' }],
        ['number.wallbox_pulsar_plus_maximum_charging_current', '16', { friendly_name: 'Wallbox Pulsar Plus Maximum Charging Current', unit_of_measurement: 'A', min: 6, max: 32, step: 1 }],
        ['select.wallbox_pulsar_plus_ecosmart', w.ownMode ? 'eco_mode' : 'off', { friendly_name: 'Wallbox Pulsar Plus Solar charging', options: ['off', 'eco_mode', 'full_solar'] }],
        ['lock.wallbox_pulsar_plus_lock', 'unlocked', { friendly_name: 'Wallbox Pulsar Plus Lock' }],
      ],
      react(call) {
        if (call.domain !== 'switch' || !call.target || call.target.entity_id !== 'switch.wallbox_pulsar_plus_pause_resume') return null;
        return call.service === 'turn_on' ? 'start' : call.service === 'turn_off' ? 'stop' : null;
      },
      isStart: (c) => c.domain === 'switch' && c.service === 'turn_on' && c.target && c.target.entity_id === 'switch.wallbox_pulsar_plus_pause_resume',
      isControl: (c) => c.domain === 'switch' && c.target && c.target.entity_id === 'switch.wallbox_pulsar_plus_pause_resume',
      describe: (c) => `${c.domain}.${c.service} ${c.target.entity_id}${c.data && c.data.value != null ? ' ' + c.data.value : ''}`,
      currentOf: (c) => (c.domain === 'number' && c.target && c.target.entity_id === 'number.wallbox_pulsar_plus_maximum_charging_current' ? c.data.value : null),
      phasesOf: () => null,
    },
  },
};

function createWorld(profileName = 'renault_easee') {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile ${profileName}`);
  const d0 = localMidnight(TZ, 0);
  const H = 3600000;
  const w = {
    tz: TZ,
    profile,
    soc: 40,
    limit: 80,
    plugged: true,
    charging: false,
    powerKw: 0,
    preheat: 'off',
    events: [],
    calls: [], // call_service sent by the app
    rest: [], // REST requests (sensors)
    // EnergyZero: today and tomorrow, cheap 02:00-05:00 tomorrow.
    energyzero: () => Array.from({ length: 48 }, (_, i) => ({
      timestamp: new Date(d0 + i * H).toISOString(),
      // No cheap hours today: the result must not depend on the time of day the test runs.
      price: i >= 26 && i < 29 ? 0.05 : 0.20,
    })),
  };
  // Combined sensor: real prices today/tomorrow, then 5 days of forecast;
  // the day after tomorrow 11:00-15:00 very cheap.
  w.combined = () => Array.from({ length: 168 }, (_, i) => {
    const t = d0 + i * H;
    const day = Math.floor(i / 24);
    const h = i % 24;
    return {
      time: isoLocal(t, TZ).slice(0, 19).replace('T', ' '),
      price: day < 2 ? 0.30 : day === 2 && h >= 11 && h < 15 ? 0.15 : 0.32,
      source: day < 2 ? 'anwb' : 'forecast',
    };
  });
  return w;
}

// [entity_id, state, attributes, device ('car' | 'ch' | null)]
function entityList(w) {
  const p = w.profile;
  const ch = p.charger;
  const status = !w.plugged ? ch.text.unplugged : w.charging ? ch.text.charging : ch.text.paused;
  const car = p.car.states(w).map(([id, st, a, dev]) => [id, String(st), a, dev === undefined ? p.car.device : dev]);
  const charger = ch.states(w, status).map(([id, st, a]) => [id, String(st), a, ch.device]);
  return [
    ...car,
    ...charger,
    ['sensor.p1_power', String(gridW(w)), { friendly_name: 'P1 Power', unit_of_measurement: 'W', device_class: 'power' }, 'p1'],
    ['sensor.p1_current_l1', '3', { friendly_name: 'P1 Current L1', unit_of_measurement: 'A', device_class: 'current' }, 'p1'],
    ['sensor.p1_current_l2', '2', { friendly_name: 'P1 Current L2', unit_of_measurement: 'A', device_class: 'current' }, 'p1'],
    ['sensor.p1_current_l3', '2', { friendly_name: 'P1 Current L3', unit_of_measurement: 'A', device_class: 'current' }, 'p1'],
    ['sensor.energyzero_today_energy_current_hour_price', '0.20', { friendly_name: 'Current hour price', unit_of_measurement: '€/kWh' }, 'ez'],
    ['sensor.stroom_prijzen_gecombineerd', '0.30', { friendly_name: 'Stroom prijzen gecombineerd', unit_of_measurement: '€/kWh', prices: w.combined() }, null],
    ['calendar.auto', 'off', { friendly_name: 'Auto' }, null],
    // Inverter (Fronius): solar power now.
    ['sensor.solarnet_power_photovoltaics', String(w.pvW ?? 0), { friendly_name: 'SolarNet Power photovoltaics', unit_of_measurement: 'W', device_class: 'power' }, 'inv'],
    ['sensor.solarnet_power_grid', String(gridW(w)), { friendly_name: 'SolarNet Power grid', unit_of_measurement: 'W', device_class: 'power' }, 'inv'],
    ...(w.hasBattery ? [
      ['sensor.sigen_plant_battery_state_of_charge', String(w.bat.soc), { friendly_name: 'Sigen Plant Battery State of Charge', unit_of_measurement: '%', device_class: 'battery' }, 'plant'],
      ['sensor.sigen_plant_battery_power', String(batKw(w)), { friendly_name: 'Sigen Plant Battery Power', unit_of_measurement: 'kW', device_class: 'power' }, 'plant'],
      ['sensor.sigen_plant_rated_energy_capacity', '16.12', { friendly_name: 'Sigen Plant Rated Energy Capacity', unit_of_measurement: 'kWh' }, 'plant'],
      ['switch.sigen_plant_remote_ems_controlled_by_home_assistant', w.bat.ems, { friendly_name: 'Sigen Plant Remote EMS (Controlled by Home Assistant)' }, 'plant'],
      ['select.sigen_plant_remote_ems_control_mode', w.bat.mode, { friendly_name: 'Sigen Plant Remote EMS control mode', options: ['PCS Remote Control', 'Standby', 'Maximum Self Consumption', 'Command Charging (Grid First)', 'Command Charging (PV First)', 'Command Discharging (PV First)', 'Command Discharging (ESS First)', 'V2G'] }, 'plant'],
      ['number.sigen_plant_ess_max_charging_limit', String(w.bat.chg), { friendly_name: 'Sigen Plant ESS Max Charging Limit', unit_of_measurement: 'kW', min: 0, max: 100 }, 'plant'],
      ['number.sigen_plant_ess_max_discharging_limit', String(w.bat.dis), { friendly_name: 'Sigen Plant ESS Max Discharging Limit', unit_of_measurement: 'kW', min: 0, max: 100 }, 'plant'],
    ] : []),
    // Any other home battery (matrix test): entities from tests/fixtures.js.
    ...(w.profile.charger.equalizer ? w.profile.charger.equalizer(w) : []),
    ...(w.otherBattery ? w.otherBattery.list.map(([id, , a, dev]) => [id, String(w.store.get(id)), a, dev]) : []),
    ['input_datetime.ev_vertrek', w.helperTime || 'unknown', { friendly_name: 'EV vertrek', has_date: true, has_time: true }, null],
    ['input_number.ev_doel', '70', { friendly_name: 'EV doel', unit_of_measurement: '%' }, null],
  ];
}

const PLATFORM_OF = { p1: 'dsmr', ez: 'energyzero', inv: 'fronius', plant: 'sigen', eq: 'easee' };

function states(w) {
  const ago = new Date(Date.now() - 600000).toISOString();
  // w.ages: { entity_id: ms } for an entity that Home Assistant has not read
  // for a while (a car whose cloud is down).
  const at = (id) => (w.ages && w.ages[id] ? new Date(Date.now() - w.ages[id]).toISOString() : ago);
  return entityList(w).map(([entity_id, state, attributes]) => ({ entity_id, state, last_changed: at(entity_id), last_reported: at(entity_id), last_updated: at(entity_id), attributes }));
}

function registry(w) {
  const p = w.profile;
  const platform = (dev, id) => (dev === p.car.device ? p.car.platform : dev === p.charger.device ? p.charger.platform
    : (w.otherBattery && w.otherBattery.devices[dev]) || PLATFORM_OF[dev] || id.split('.')[0]);
  return entityList(w).map(([entity_id, , , dev]) => {
    const pf = platform(dev, entity_id);
    return { entity_id, device_id: dev, platform: pf, config_entry_id: pf === 'energyzero' ? 'ce_ez' : `ce_${pf}` };
  });
}

function devices(w) {
  const p = w.profile;
  return [
    { id: p.car.device, name: p.car.name, manufacturer: p.car.manufacturer, model: p.car.model },
    { id: p.charger.device, name: p.charger.name, manufacturer: p.charger.manufacturer, model: p.charger.model },
    { id: 'p1', name: 'P1 meter', manufacturer: 'DSMR', model: 'P1' },
    { id: 'ez', name: 'EnergyZero', manufacturer: 'EnergyZero' },
    { id: 'inv', name: 'SolarNet', manufacturer: 'Fronius', model: 'Symo' },
    { id: 'plant', name: 'Sigen Plant', manufacturer: 'Sigenergy', model: 'SigenStor' },
    ...(w.profile.charger.equalizer ? [{ id: 'eq', name: 'Equalizer', manufacturer: 'Easee', model: 'Equalizer' }] : []),
    ...(w.otherBattery ? Object.keys(w.otherBattery.devices).map((id) => ({ id, name: w.otherBattery.names[id] || id })) : []),
  ];
}

function start(w, wsPort, restPort) {
  const services = {
    ...w.profile.charger.services,
    notify: { mobile_app_pixel_8: { name: 'Send a notification via mobile_app_pixel_8' }, persistent_notification: {} },
    energyzero: { get_energy_prices: {} },
  };
  const wss = new WebSocket.Server({ port: wsPort });
  wss.on('connection', (s) => {
    s.send(JSON.stringify({ type: 'auth_required' }));
    s.on('message', (raw) => {
      const m = JSON.parse(raw);
      const ok = (result) => s.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
      const fail = (message) => s.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { code: 'x', message } }));
      if (m.type === 'auth') return s.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.9.4' }));
      switch (m.type) {
        case 'get_config': return ok({ time_zone: w.tz, currency: 'EUR', version: '2026.9.4' });
        case 'get_states': return ok(states(w));
        case 'get_services': return ok(services);
        case 'config/entity_registry/list': return ok(registry(w));
        case 'config/device_registry/list': return ok(devices(w));
        case 'search/related': return ok({});
        // Energy dashboard: one solar forecast (Forecast.Solar), 3 kWh per hour
        // from 10:00 to 16:00 today and tomorrow.
        case 'energy/get_prefs': return ok({ energy_sources: [{ type: 'solar', stat_energy_from: 'sensor.pv_energy', config_entry_solar_forecast: w.noForecast ? [] : ['fs1'] }] });
        case 'energy/solar_forecast': {
          if (w.noForecast) return ok({});
          const wh = {};
          for (const day of [0, 1, 2]) {
            for (let h = 10; h < 16; h++) wh[new Date(localMidnight(TZ, day) + h * 3600000).toISOString()] = w.solarWh ?? 3000;
          }
          return ok({ fs1: { wh_hours: wh } });
        }
        case 'recorder/statistics_during_period': {
          const out = {};
          for (const id of m.statistic_ids) out[id] = [];
          // w.chargedKw: the charger delivered this power the whole period (5-minute means in W).
          if (w.chargedKw && m.statistic_ids.includes(w.profile.charger.power)) {
            const rows = [];
            for (let t = Date.parse(m.start_time); t < Date.parse(m.end_time); t += 300000) rows.push({ start: t, end: t + 300000, mean: w.chargedKw * 1000 });
            out[w.profile.charger.power] = rows;
          }
          return ok(out);
        }
        case 'call_service': {
          if (m.domain === 'energyzero') return ok({ context: {}, response: { prices: w.energyzero() } });
          if (m.domain === 'calendar' && m.service === 'get_events') {
            return ok({ context: {}, response: { 'calendar.auto': { events: w.events } } });
          }
          // Like Home Assistant: an action with a device_id field (Easee)
          // validates it as text; a target device arrives as a list.
          const svc = services[m.domain] && services[m.domain][m.service];
          if (svc && svc.fields && svc.fields.device_id) {
            const v = (m.service_data || {}).device_id ?? (m.target && m.target.device_id != null ? [].concat(m.target.device_id) : undefined);
            if (typeof v !== 'string') return fail("value should be a string at 'device_id'");
          }
          const call = { domain: m.domain, service: m.service, data: m.service_data || {}, target: m.target };
          if (w.failNextControl > 0 && w.profile.charger.isControl(call)) {
            w.failNextControl--;
            return fail('simulated charger command failure');
          }
          w.calls.push(call);
          const tid = call.target && call.target.entity_id;
          if (m.domain === 'number' && m.service === 'set_value' && /target_charge_level|charge_limit/.test(tid || '')) w.limit = call.data.value;
          if (w.hasBattery && tid) {
            if (tid === 'switch.sigen_plant_remote_ems_controlled_by_home_assistant') w.bat.ems = m.service === 'turn_on' ? 'on' : 'off';
            if (tid === 'select.sigen_plant_remote_ems_control_mode') w.bat.mode = call.data.option;
            if (tid === 'number.sigen_plant_ess_max_charging_limit') w.bat.chg = call.data.value;
            if (tid === 'number.sigen_plant_ess_max_discharging_limit') w.bat.dis = call.data.value;
          }
          // Matrix test: switches, selects and numbers keep what was sent.
          if (w.store && tid && w.store.has(tid)) {
            if (m.domain === 'switch' && ['turn_on', 'turn_off'].includes(m.service)) w.store.set(tid, m.service === 'turn_on' ? 'on' : 'off');
            if (m.domain === 'select' && m.service === 'select_option') w.store.set(tid, call.data.option);
            if (m.domain === 'number' && m.service === 'set_value') w.store.set(tid, String(call.data.value));
          }
          if (m.domain === 'easee' && m.service === 'set_surplus_charging') {
            w.eqSurplus = call.data.enable === true;
            w.eqCurrent = call.data.current;
            // Like the Equalizer: with surplus charging on and no sun, the car waits.
            if (w.eqSurplus && (w.pvW ?? 0) < 1400) w.charging = false;
          }
          const amps = w.profile.charger.currentOf && w.profile.charger.currentOf(call);
          if (amps != null) w.amps = amps;
          const ph = w.profile.charger.phasesOf && w.profile.charger.phasesOf(call);
          if (ph != null) w.phases = ph;
          const r = w.profile.charger.react(call);
          if (r === 'start') w.charging = !(w.eqSurplus && (w.pvW ?? 0) < 1400);
          if (r === 'stop') w.charging = false;
          return ok({ context: {} });
        }
        default: return fail(`not supported in the fake: ${m.type}`);
      }
    });
  });
  const rest = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      w.rest.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  }).listen(restPort);
  return {
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await Promise.all([
        new Promise((resolve) => wss.close(resolve)),
        new Promise((resolve) => rest.close(resolve)),
      ]);
    },
  };
}

module.exports = { PROFILES, createWorld, start, TZ };

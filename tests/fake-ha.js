'use strict';

// A small fake Home Assistant for the settings test: the WebSocket API and the
// REST API the app uses, with a car (Renault), a charger (Easee), a P1 meter,
// EnergyZero prices, a price sensor with a 7-day forecast, a calendar,
// helpers and notify actions. Everything the app sends is recorded in `calls`.

const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'node_modules', 'ws'));
const { localMidnight, isoLocal } = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'prices.js'));

const TZ = 'Europe/Amsterdam';

function createWorld() {
  const d0 = localMidnight(TZ, 0);
  const H = 3600000;
  const w = {
    tz: TZ,
    soc: 40,
    limit: 80,
    plugged: true,
    status: 'awaiting_start',
    powerKw: 0,
    preheat: 'off',
    events: [],
    calls: [], // call_service sent by the app
    rest: [], // REST requests (sensors)
    // EnergyZero: today and tomorrow, cheap 02:00-05:00 tomorrow.
    energyzero: () => Array.from({ length: 48 }, (_, i) => ({
      timestamp: new Date(d0 + i * H).toISOString(),
      price: i >= 26 && i < 29 ? 0.05 : i >= 12 && i < 16 ? 0.10 : 0.20,
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

function states(w) {
  const ago = new Date(Date.now() - 600000).toISOString();
  return [
    // Car (Renault)
    { entity_id: 'sensor.jlz03x_battery', state: String(w.soc), attributes: { friendly_name: 'JLZ03X Battery', unit_of_measurement: '%', device_class: 'battery' } },
    { entity_id: 'sensor.jlz03x_range', state: '150', attributes: { friendly_name: 'JLZ03X Range', unit_of_measurement: 'km', device_class: 'distance' } },
    { entity_id: 'binary_sensor.jlz03x_plugged_in', state: w.plugged ? 'on' : 'off', attributes: { friendly_name: 'JLZ03X Plugged in', device_class: 'plug' } },
    { entity_id: 'binary_sensor.jlz03x_charging', state: w.status === 'charging' ? 'on' : 'off', attributes: { friendly_name: 'JLZ03X Charging', device_class: 'battery_charging' } },
    { entity_id: 'number.jlz03x_target_charge_level', state: String(w.limit), attributes: { friendly_name: 'JLZ03X Target charge level', unit_of_measurement: '%', min: 55, max: 100, step: 5 } },
    { entity_id: 'binary_sensor.jlz03x_hvac', state: w.preheat, attributes: { friendly_name: 'JLZ03X HVAC' } },
    // Charger (Easee)
    { entity_id: 'sensor.laadpaal_status', state: w.plugged ? w.status : 'disconnected', last_changed: ago, attributes: { friendly_name: 'Laadpaal Status', device_class: 'enum' } },
    { entity_id: 'sensor.laadpaal_power', state: String(w.powerKw), attributes: { friendly_name: 'Laadpaal Power', unit_of_measurement: 'kW', device_class: 'power' } },
    { entity_id: 'switch.laadpaal_charger_enabled', state: 'on', attributes: { friendly_name: 'Laadpaal Charger enabled' } },
    // P1 meter
    { entity_id: 'sensor.p1_power', state: '850', attributes: { friendly_name: 'P1 Power', unit_of_measurement: 'W', device_class: 'power' } },
    { entity_id: 'sensor.p1_current_l1', state: '3', attributes: { friendly_name: 'P1 Current L1', unit_of_measurement: 'A', device_class: 'current' } },
    { entity_id: 'sensor.p1_current_l2', state: '2', attributes: { friendly_name: 'P1 Current L2', unit_of_measurement: 'A', device_class: 'current' } },
    { entity_id: 'sensor.p1_current_l3', state: '2', attributes: { friendly_name: 'P1 Current L3', unit_of_measurement: 'A', device_class: 'current' } },
    // Prices
    { entity_id: 'sensor.energyzero_today_energy_current_hour_price', state: '0.20', attributes: { friendly_name: 'Current hour price', unit_of_measurement: '€/kWh' } },
    { entity_id: 'sensor.stroom_prijzen_gecombineerd', state: '0.30', attributes: { friendly_name: 'Stroom prijzen gecombineerd', unit_of_measurement: '€/kWh', prices: w.combined() } },
    // Departures
    { entity_id: 'calendar.auto', state: 'off', attributes: { friendly_name: 'Auto' } },
    { entity_id: 'input_datetime.ev_vertrek', state: w.helperTime || 'unknown', attributes: { friendly_name: 'EV vertrek', has_date: true, has_time: true } },
    { entity_id: 'input_number.ev_doel', state: '70', attributes: { friendly_name: 'EV doel', unit_of_measurement: '%' } },
  ];
}

const REGISTRY = [
  ['sensor.jlz03x_battery', 'car', 'renault'], ['sensor.jlz03x_range', 'car', 'renault'],
  ['binary_sensor.jlz03x_plugged_in', 'car', 'renault'], ['binary_sensor.jlz03x_charging', 'car', 'renault'],
  ['number.jlz03x_target_charge_level', 'car', 'renault'], ['binary_sensor.jlz03x_hvac', 'car', 'renault'],
  ['sensor.laadpaal_status', 'ch', 'easee'], ['sensor.laadpaal_power', 'ch', 'easee'], ['switch.laadpaal_charger_enabled', 'ch', 'easee'],
  ['sensor.p1_power', 'p1', 'dsmr'], ['sensor.p1_current_l1', 'p1', 'dsmr'], ['sensor.p1_current_l2', 'p1', 'dsmr'], ['sensor.p1_current_l3', 'p1', 'dsmr'],
  ['sensor.energyzero_today_energy_current_hour_price', 'ez', 'energyzero'],
  ['sensor.stroom_prijzen_gecombineerd', null, 'template'],
  ['calendar.auto', null, 'local_calendar'],
].map(([entity_id, device_id, platform]) => ({ entity_id, device_id, platform, config_entry_id: platform === 'energyzero' ? 'ce_ez' : `ce_${platform}` }));

const DEVICES = [
  { id: 'car', name: 'JLZ03X', manufacturer: 'Renault', model: 'Megane E-Tech' },
  { id: 'ch', name: 'Laadpaal', manufacturer: 'Easee', model: 'Charge' },
  { id: 'p1', name: 'P1 meter', manufacturer: 'DSMR', model: 'P1' },
  { id: 'ez', name: 'EnergyZero', manufacturer: 'EnergyZero' },
];

const SERVICES = {
  easee: {
    action_command: { fields: { device_id: {}, action_command: { selector: { select: { options: ['start', 'stop', 'pause', 'resume', 'toggle', 'reboot'] } } } }, target: { device: {} } },
  },
  notify: { mobile_app_pixel_8: { name: 'Send a notification via mobile_app_pixel_8' }, persistent_notification: {} },
  energyzero: { get_energy_prices: {} },
};

function start(w, wsPort, restPort) {
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
        case 'get_services': return ok(SERVICES);
        case 'config/entity_registry/list': return ok(REGISTRY);
        case 'config/device_registry/list': return ok(DEVICES);
        case 'search/related': return ok({});
        case 'recorder/statistics_during_period': {
          const out = {};
          for (const id of m.statistic_ids) out[id] = [];
          return ok(out);
        }
        case 'call_service': {
          if (m.domain === 'energyzero') return ok({ context: {}, response: { prices: w.energyzero() } });
          if (m.domain === 'calendar' && m.service === 'get_events') {
            return ok({ context: {}, response: { 'calendar.auto': { events: w.events } } });
          }
          w.calls.push({ domain: m.domain, service: m.service, data: m.service_data, target: m.target });
          if (m.domain === 'number' && m.service === 'set_value') w.limit = m.service_data.value;
          if (m.domain === 'easee') {
            const cmd = m.service_data.action_command;
            if (cmd === 'resume' || cmd === 'start') { w.status = 'charging'; w.powerKw = 9.2; }
            if (cmd === 'pause' || cmd === 'stop') { w.status = 'awaiting_start'; w.powerKw = 0; }
          }
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
  return { close: () => { wss.close(); rest.close(); } };
}

module.exports = { createWorld, start, TZ };

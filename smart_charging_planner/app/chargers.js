'use strict';

// Charger detection.
//
// Like vehicles, two methods:
//   1. Known charger integrations (a helper list, not complete).
//   2. Recognition by features: a device with an adjustable current in A
//      (a number entity) or a charger-like name plus a power sensor.
// Devices already recognised as a vehicle are skipped: some cars have their
// own "charging current" setting, but they are not a charger.

const KNOWN_CHARGER_DOMAINS = new Set([
  'easee', 'wallbox', 'zaptec', 'go_echarger', 'goecharger', 'goecharger_api2',
  'ocpp', 'alfen_wallbox', 'peblar', 'openevse', 'tesla_wall_connector', 'myenergi',
  'ohme', 'v2c', 'keba', 'nrgkick', 'blue_current', 'pod_point', 'smappee', 'webasto',
  'etrel', 'ev_charger',
]);

const EXCLUDED_DOMAINS = new Set(['mobile_app', 'homewizard', 'dsmr', 'dsmr_reader', 'p1_monitor']);

// Devices that belong to a charging setup but are not a charger themselves:
// load balancers (Easee Equalizer), energy meters, P1 meters, circuits.
const NOT_A_CHARGER = /equalizer|kwh[ _-]?meter|energy[ _-]?meter|smart[ _-]?meter|\bp1\b|circuit|load[ _-]?balanc/;

const UNAVAILABLE = new Set(['unavailable', 'unknown']);

const CHARGER_NAME = /charger|wallbox|laadpaal|laadpunt|evse|charge_point|chargepoint|charge_max|charge_up/;

function words(entity, s) {
  return [
    entity.entity_id,
    entity.name,
    entity.original_name,
    s && s.attributes && s.attributes.friendly_name,
  ].filter(Boolean).join(' ').toLowerCase();
}

const domainOf = (id) => id.split('.')[0];

function isCurrentNumber(e, s) {
  if (!s || domainOf(e.entity_id) !== 'number') return false;
  const a = s.attributes || {};
  return a.unit_of_measurement === 'A';
}

function isPower(e, s) {
  if (!s || domainOf(e.entity_id) !== 'sensor') return false;
  const a = s.attributes || {};
  return a.device_class === 'power' || a.unit_of_measurement === 'W' || a.unit_of_measurement === 'kW';
}

function isStatus(e, s) {
  if (!s) return false;
  const a = s.attributes || {};
  const d = domainOf(e.entity_id);
  if (d === 'binary_sensor') return ['plug', 'battery_charging'].includes(a.device_class) || /plug|connected|charging|cable/.test(words(e, s));
  if (d !== 'sensor') return false;
  if (a.unit_of_measurement) return false; // status is text, not a number
  return a.device_class === 'enum' || /status|state|mode/.test(words(e, s));
}

function isControlSwitch(e, s) {
  return !!s && domainOf(e.entity_id) === 'switch';
}

function option(e, s) {
  const a = (s && s.attributes) || {};
  return {
    entity_id: e.entity_id,
    name: a.friendly_name || e.name || e.original_name || e.entity_id,
    state: s ? s.state : null,
    unit: a.unit_of_measurement || null,
    min: a.min ?? null,
    max: a.max ?? null,
  };
}

function pickBest(list, patterns) {
  for (const p of patterns) {
    const hit = list.find((o) => p.test(`${o.entity_id} ${o.name}`.toLowerCase()));
    if (hit) return hit.entity_id;
  }
  return list.length ? list[0].entity_id : null;
}

function detectChargers(entities, devices, states, vehicleDeviceIds = new Set()) {
  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const byDevice = new Map();
  for (const e of entities) {
    if (!e.device_id || e.disabled_by) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }

  const candidates = [];

  for (const device of devices) {
    if (vehicleDeviceIds.has(device.id)) continue;
    const ents = byDevice.get(device.id) || [];
    if (!ents.length) continue;
    const domains = new Set(ents.map((e) => e.platform));
    if ([...domains].some((d) => EXCLUDED_DOMAINS.has(d))) continue;

    const status = [];
    const power = [];
    const current = [];
    const switches = [];

    for (const e of ents) {
      const s = stateById.get(e.entity_id);
      if (isStatus(e, s)) status.push(option(e, s));
      if (isPower(e, s)) power.push(option(e, s));
      if (isCurrentNumber(e, s)) current.push(option(e, s));
      if (isControlSwitch(e, s)) switches.push(option(e, s));
    }

    const deviceText = [device.name, device.name_by_user, device.model, device.manufacturer]
      .filter(Boolean).join(' ').toLowerCase();
    if (NOT_A_CHARGER.test(deviceText)) continue;
    const known = [...domains].find((d) => KNOWN_CHARGER_DOMAINS.has(d));
    const chargerName = CHARGER_NAME.test(deviceText) ||
      ents.some((e) => CHARGER_NAME.test(e.entity_id));
    const byFeatures = chargerName && (power.length > 0 || current.length > 0);
    if (!known && !byFeatures) continue;

    // Offline: none of its entities report a value (e.g. an old charger
    // that was replaced but is still in Home Assistant).
    const offline = ents.every((e) => {
      const s = stateById.get(e.entity_id);
      return !s || UNAVAILABLE.has(s.state);
    });

    candidates.push({
      device_id: device.id,
      name: device.name_by_user || device.name || 'Unknown device',
      manufacturer: device.manufacturer || null,
      model: device.model || null,
      integration: known || [...domains][0],
      detected_by: known ? 'known_integration' : 'features',
      offline,
      options: { status, power, current, switch: switches },
      suggested: {
        status: pickBest(status, [/_status\b|charger_status|status/, /state/]),
        power: pickBest(power, [/charging_power|charger_power|_power\b/, /power/]),
        current: pickBest(current, [/max_charging_current|charging_current|dynamic|current_limit|current/]),
        switch: current.length ? null : pickBest(switches, [/is_enabled|enable|charging|start|pause/]),
      },
      // Controlling a charger without a current setting or switch is done
      // through actions (services); that comes in a later version.
      needs_actions: current.length === 0 && switches.length === 0,
    });
  }

  candidates.sort((a, b) =>
    (a.offline - b.offline) ||
    (a.detected_by === b.detected_by ? 0 : a.detected_by === 'known_integration' ? -1 : 1) ||
    a.name.localeCompare(b.name));
  return candidates;
}

// Lists for choosing manually when nothing is found.
function manualChargerOptions(entities, states) {
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  const out = { status: [], power: [], current: [], switch: [] };
  for (const s of states) {
    const e = regById.get(s.entity_id) || { entity_id: s.entity_id };
    if (isCurrentNumber(e, s)) out.current.push(option(e, s));
    if (isPower(e, s)) out.power.push(option(e, s));
    const a = s.attributes || {};
    const d = domainOf(s.entity_id);
    if ((d === 'sensor' && a.device_class === 'enum') ||
        (d === 'binary_sensor' && ['plug', 'battery_charging'].includes(a.device_class))) {
      out.status.push(option(e, s));
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

module.exports = { detectChargers, manualChargerOptions, KNOWN_CHARGER_DOMAINS };

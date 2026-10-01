'use strict';

// Vehicle detection.
//
// Home Assistant has no "car" category, so we combine two methods:
//   1. Known car integrations (a helper list, not complete).
//   2. Recognition by features: a device with a battery % sensor AND a
//      distance sensor (range or odometer) is almost certainly a vehicle.
//      Phones have battery %, but no range, so they are skipped.

// Integration domains known to represent vehicles. Unknown ones are still
// found through method 2; a wrong name here does no harm.
const KNOWN_VEHICLE_DOMAINS = new Set([
  'renault', 'tesla_fleet', 'teslemetry', 'tessie', 'tesla_custom',
  'bmw_connected_drive', 'mbapi2020', 'kia_uvo', 'volkswagen_we_connect_id',
  'volkswagencarnet', 'audiconnect', 'skodaconnect', 'myskoda', 'polestar_api',
  'nissan_leaf', 'fordpass', 'toyota', 'mazda', 'subaru', 'volvo', 'volvooncall',
  'smart_hashtag', 'stellantis_vehicles', 'psa_car_controller', 'hyundai_kia_connect',
]);

// Integrations that are never a vehicle, even if they look like one.
const EXCLUDED_DOMAINS = new Set(['mobile_app', 'battery_notes']);

const DISTANCE_UNITS = new Set(['km', 'mi', 'm']);

function words(entity, stateObj) {
  const name = [
    entity.entity_id,
    entity.name,
    entity.original_name,
    stateObj && stateObj.attributes && stateObj.attributes.friendly_name,
  ].filter(Boolean).join(' ').toLowerCase();
  return name;
}

function isBatteryPercent(entity, s) {
  if (!entity.entity_id.startsWith('sensor.') || !s) return false;
  const a = s.attributes || {};
  if (a.unit_of_measurement !== '%') return false;
  if (a.device_class === 'battery') return true;
  return /battery|soc|state_of_charge|charge_level|accu|batterij/.test(words(entity, s));
}

function isDistance(entity, s) {
  if (!entity.entity_id.startsWith('sensor.') || !s) return false;
  const a = s.attributes || {};
  return a.device_class === 'distance' || DISTANCE_UNITS.has(a.unit_of_measurement);
}

function isRange(entity, s) {
  return isDistance(entity, s) && /range|autonomy|actieradius|bereik/.test(words(entity, s));
}

function isCharging(entity, s) {
  if (!s) return false;
  const a = s.attributes || {};
  if (entity.entity_id.startsWith('binary_sensor.') && a.device_class === 'battery_charging') return true;
  return /charging|charge_state|charging_status|laden/.test(words(entity, s)) &&
    !/plug|time|power|rate|limit|current|energy/.test(words(entity, s)) &&
    (entity.entity_id.startsWith('binary_sensor.') || entity.entity_id.startsWith('sensor.'));
}

function isPlugged(entity, s) {
  if (!s) return false;
  const a = s.attributes || {};
  if (entity.entity_id.startsWith('binary_sensor.') && a.device_class === 'plug') return true;
  return /plug/.test(words(entity, s)) &&
    (entity.entity_id.startsWith('binary_sensor.') || entity.entity_id.startsWith('sensor.'));
}

// The car's own charge limit ("Target charge level", "Charge limit"): the
// car stops charging there, whatever the charger does.
function isChargeLimit(entity, s) {
  if (!s) return false;
  const id = entity.entity_id;
  if (!/^(number|sensor|input_number)\./.test(id)) return false;
  const a = s.attributes || {};
  if (a.unit_of_measurement !== '%') return false;
  const w = words(entity, s);
  return /target.?(charge|soc|battery|level)|charge.?(limit|target)|charging.?limit|max.?(charge|soc)|soc.?(limit|target)|laadlimiet|laaddoel/.test(w) &&
    !/min(imum)?/.test(w);
}

function option(entity, s) {
  const a = (s && s.attributes) || {};
  return {
    entity_id: entity.entity_id,
    name: a.friendly_name || entity.name || entity.original_name || entity.entity_id,
    state: s ? s.state : null,
    unit: a.unit_of_measurement || null,
  };
}

// Pick the most likely entity: prefer the one with the strongest hint.
function pickBest(list, preferPattern) {
  if (!list.length) return null;
  const preferred = list.find((o) => preferPattern.test(o.entity_id.toLowerCase()));
  return (preferred || list[0]).entity_id;
}

// entities: entity registry, devices: device registry, states: current states.
function detectVehicles(entities, devices, states) {
  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const byDevice = new Map();

  for (const e of entities) {
    if (!e.device_id || e.disabled_by) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }

  const candidates = [];

  for (const device of devices) {
    const ents = byDevice.get(device.id) || [];
    if (!ents.length) continue;

    const domains = new Set(ents.map((e) => e.platform));
    if ([...domains].some((d) => EXCLUDED_DOMAINS.has(d))) continue;

    const battery = [];
    const range = [];
    const distance = [];
    const charging = [];
    const plugged = [];
    const chargeLimit = [];

    for (const e of ents) {
      const s = stateById.get(e.entity_id);
      if (isBatteryPercent(e, s)) battery.push(option(e, s));
      if (isRange(e, s)) range.push(option(e, s));
      if (isDistance(e, s)) distance.push(option(e, s));
      if (isCharging(e, s)) charging.push(option(e, s));
      if (isPlugged(e, s)) plugged.push(option(e, s));
      if (isChargeLimit(e, s)) chargeLimit.push(option(e, s));
    }

    const known = [...domains].find((d) => KNOWN_VEHICLE_DOMAINS.has(d));
    const byFeatures = battery.length > 0 && distance.length > 0;
    if (!known && !byFeatures) continue;

    const offline = ents.every((e) => {
      const s = stateById.get(e.entity_id);
      return !s || s.state === 'unavailable' || s.state === 'unknown';
    });

    candidates.push({
      device_id: device.id,
      name: device.name_by_user || device.name || 'Unknown device',
      manufacturer: device.manufacturer || null,
      model: device.model || null,
      integration: known || [...domains][0],
      detected_by: known ? 'known_integration' : 'features',
      offline,
      options: {
        soc: battery,
        range: range.length ? range : distance,
        charging,
        plugged,
        charge_limit: chargeLimit,
      },
      suggested: {
        soc: pickBest(battery, /battery_level|state_of_charge|soc|battery/),
        range: pickBest(range.length ? range : [], /range/),
        charging: pickBest(charging, /charging/),
        plugged: pickBest(plugged, /plug/),
        charge_limit: pickBest(chargeLimit.filter((o) => o.entity_id.startsWith('number.')).concat(chargeLimit), /target|limit/),
      },
    });
  }

  // Known integrations first, then by name.
  candidates.sort((a, b) =>
    (a.offline - b.offline) ||
    (a.detected_by === b.detected_by ? 0 : a.detected_by === 'known_integration' ? -1 : 1) ||
    a.name.localeCompare(b.name));

  return candidates;
}

// The charge limit entity on the car's device, for vehicles saved before the
// app knew about it.
function findChargeLimit(entities, states, deviceId) {
  if (!deviceId) return null;
  const stateById = new Map(states.map((x) => [x.entity_id, x]));
  const list = entities
    .filter((e) => e.device_id === deviceId && !e.disabled_by && isChargeLimit(e, stateById.get(e.entity_id)))
    .map((e) => e.entity_id);
  return list.find((id) => id.startsWith('number.')) || list[0] || null;
}

// All sensors in %, for choosing a SoC manually when nothing is found.
function percentSensors(entities, states) {
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  return states
    .filter((s) => s.entity_id.startsWith('sensor.') &&
      s.attributes && s.attributes.unit_of_measurement === '%')
    .map((s) => option(regById.get(s.entity_id) || { entity_id: s.entity_id }, s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { detectVehicles, percentSensors, findChargeLimit, isChargeLimit, KNOWN_VEHICLE_DOMAINS };

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
  // "Distance to empty battery" (Volvo) is a range too.
  return isDistance(entity, s) && /range|autonomy|actieradius|bereik|to.?empty/.test(words(entity, s));
}

function isCharging(entity, s) {
  if (!s) return false;
  const a = s.attributes || {};
  if (entity.entity_id.startsWith('binary_sensor.') && a.device_class === 'battery_charging') return true;
  return /charging|charge_state|charging_status|laden/.test(words(entity, s)) &&
    !/plug|time|power|rate|limit|current|energy|connect|cable/.test(words(entity, s)) &&
    (entity.entity_id.startsWith('binary_sensor.') || entity.entity_id.startsWith('sensor.'));
}

// Is the charging cable in the car? A plug sensor, or (Tesla) a "Charge cable"
// connectivity sensor, or (Volkswagen, Volvo, Polestar) a text sensor such as
// "Plug connection state" or "Charger connection status" (connected /
// disconnected). Not the plug lock or "unlock plug when charged".
function isPlugged(entity, s) {
  if (!s) return false;
  const a = s.attributes || {};
  const id = entity.entity_id;
  if (!id.startsWith('binary_sensor.') && !id.startsWith('sensor.')) return false;
  if (id.startsWith('binary_sensor.') && a.device_class === 'plug') return true;
  const w = words(entity, s);
  if (/lock|unlock/.test(w)) return false;
  if (id.startsWith('binary_sensor.') && a.device_class === 'connectivity') return /cable|plug|charge.?port|charger/.test(w);
  return /plug|cable|charg(er|ing).?connect/.test(w);
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
  return /target.?(charge|soc|battery|level|state.?of.?charge)|charge.?(limit|target)|charging.?limit|max(imum)?.?(charge|soc|state.?of.?charge)|soc.?(limit|target)|laadlimiet|laaddoel/.test(w) &&
    !/min(imum)?|v2l|discharg/.test(w);
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

// Pick the most likely entity: the first pattern that one of them matches
// wins (patterns in order of preference), else the first one.
function pickBest(list, ...patterns) {
  if (!list.length) return null;
  for (const re of patterns) {
    const hit = list.find((o) => re.test(o.entity_id.toLowerCase()));
    if (hit) return hit.entity_id;
  }
  return list[0].entity_id;
}
// Not the battery level: a target, a maximum, a minimum or the battery's health.
const NOT_SOC = /target|max|min|limit|health|soh/;

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
      if (isCharging(e, s)) charging.push({ ...option(e, s), binary: e.entity_id.startsWith('binary_sensor.') && !!s && (s.attributes || {}).device_class === 'battery_charging' });
      if (isPlugged(e, s)) plugged.push({ ...option(e, s), binary: e.entity_id.startsWith('binary_sensor.') });
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
        // Not a target or a maximum that is also in % (Volkswagen "Target
        // State of Charge", Mercedes "Max State of Charge", Kia "State of Health").
        soc: pickBest(battery.filter((o) => !NOT_SOC.test(o.entity_id)).concat(battery), /battery_level|state_of_charge|soc|battery/),
        // The electric range first (a hybrid also has a total range).
        range: pickBest(range.length ? range : [], /ev_range|electric|battery_range|autonomy|to_empty/, /range/),
        // An on/off "charging" sensor first, then a status text.
        charging: pickBest(charging.filter((o) => o.binary).concat(charging.filter((o) => !/mode|setting|type/.test(o.entity_id))).concat(charging), /charg/),
        // An on/off sensor first, then a status text ("connected").
        plugged: pickBest(plugged.filter((o) => o.binary).concat(plugged), /plug|cable|connect/),
        // A number the app can set first; for home charging the AC limit, not the DC one (Kia, Hyundai).
        charge_limit: pickBest(chargeLimit.filter((o) => o.entity_id.startsWith('number.') && !/(^|_)dc_/.test(o.entity_id))
          .concat(chargeLimit.filter((o) => o.entity_id.startsWith('number.')), chargeLimit), /target|limit|state_of_charge/),
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
  // A number the app can set first, and the AC limit before the DC one (Kia, Hyundai).
  return list.find((id) => id.startsWith('number.') && !/(^|_)dc_/.test(id)) || list.find((id) => id.startsWith('number.')) || list[0] || null;
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

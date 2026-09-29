'use strict';

// Grid detection: where does the home's power measurement come from, and is
// there already a load balancer protecting the main fuse?
//
// Grid meters: P1 readers (DSMR, HomeWizard P1, SlimmeLezer, P1 Monitor),
// Tibber Pulse, or a load balancer that measures at the connection (Easee
// Equalizer). Meters that measure a single device, such as a kWh meter for
// the charger, are skipped when their name says so.

const GRID_DOMAINS = new Set(['dsmr', 'dsmr_reader', 'p1_monitor', 'tibber']);
const GRID_TEXT = /\bp1\b|dsmr|slimme ?lezer|smart[ _-]?meter|slimme[ _-]?meter|grid|equalizer|energy[ _-]?meter|kwh[ _-]?meter|electricity[ _-]?meter/;
const P1_TEXT = /\bp1\b|dsmr|slimme ?lezer|smart[ _-]?meter|slimme[ _-]?meter|electricity[ _-]?meter/;
// A meter for one device (the charger, a heat pump) is not the grid meter.
const DEVICE_METER_TEXT = /laadpaal|laadpunt|charger|wallbox|warmtepomp|heat[ _-]?pump|boiler|wasmachine|washing|dryer|droger|oven/;

const LOAD_BALANCER_TEXT = /equalizer|load[ _-]?balanc|power[ _-]?boost|\bdlm\b|loadmanager|load[ _-]?manager/;

const UNAVAILABLE = new Set(['unavailable', 'unknown']);
const PHASE = /phase|_l[123](_|\b)|\bl[123]\b|fase/;
const IMPORT = /import|consumption|afname|delivered|verbruik|usage/;
const EXPORT = /export|production|teruglever|returned|injection|opwek/;

function words(e, s) {
  return [e.entity_id, e.name, e.original_name, s && s.attributes && s.attributes.friendly_name]
    .filter(Boolean).join(' ').toLowerCase();
}

function option(e, s) {
  const a = (s && s.attributes) || {};
  return {
    entity_id: e.entity_id,
    name: a.friendly_name || e.name || e.original_name || e.entity_id,
    state: s ? s.state : null,
    unit: a.unit_of_measurement || null,
  };
}

function isPower(e, s) {
  if (!s || !e.entity_id.startsWith('sensor.')) return false;
  const a = s.attributes || {};
  return a.device_class === 'power' || ['W', 'kW'].includes(a.unit_of_measurement);
}

function isCurrent(e, s) {
  if (!s || !e.entity_id.startsWith('sensor.')) return false;
  const a = s.attributes || {};
  return a.unit_of_measurement === 'A';
}

function phaseOf(text) {
  const m = text.match(/(?:phase|_l|\bl|fase)[ _-]?([123])/);
  return m ? Number(m[1]) : null;
}

function pickBest(list, patterns) {
  for (const p of patterns) {
    const hit = list.find((o) => p.test(`${o.entity_id} ${o.name}`.toLowerCase()));
    if (hit) return hit.entity_id;
  }
  return list.length ? list[0].entity_id : null;
}

function groupByDevice(entities) {
  const byDevice = new Map();
  for (const e of entities) {
    if (!e.device_id || e.disabled_by) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }
  return byDevice;
}

function deviceText(d) {
  return [d.name, d.name_by_user, d.model, d.manufacturer].filter(Boolean).join(' ').toLowerCase();
}

function isOffline(ents, stateById) {
  return ents.every((e) => {
    const s = stateById.get(e.entity_id);
    return !s || UNAVAILABLE.has(s.state);
  });
}

function detectGridMeters(entities, devices, states, skipDeviceIds = new Set()) {
  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const byDevice = groupByDevice(entities);
  const candidates = [];

  for (const device of devices) {
    if (skipDeviceIds.has(device.id)) continue;
    const ents = byDevice.get(device.id) || [];
    if (!ents.length) continue;
    const text = deviceText(device);
    const domains = new Set(ents.map((e) => e.platform));
    const known = [...domains].find((d) => GRID_DOMAINS.has(d));
    if (!known && !GRID_TEXT.test(text)) continue;
    if (DEVICE_METER_TEXT.test(text)) continue;

    const net = [];
    const imp = [];
    const exp = [];
    const currents = [];
    for (const e of ents) {
      const s = stateById.get(e.entity_id);
      const w = words(e, s);
      if (isPower(e, s) && !PHASE.test(w)) {
        if (EXPORT.test(w)) exp.push(option(e, s));
        else if (IMPORT.test(w)) imp.push(option(e, s));
        else net.push(option(e, s));
      }
      if (isCurrent(e, s)) currents.push({ ...option(e, s), phase: phaseOf(w) });
    }
    if (!net.length && !imp.length) continue;

    const byPhase = (p) => currents.filter((c) => c.phase === p);
    candidates.push({
      device_id: device.id,
      name: device.name_by_user || device.name || 'Unknown device',
      manufacturer: device.manufacturer || null,
      model: device.model || null,
      integration: known || [...domains][0],
      detected_by: known || P1_TEXT.test(text) ? 'known_integration' : 'features',
      kind: P1_TEXT.test(text) || known ? 'p1' : LOAD_BALANCER_TEXT.test(text) ? 'load_balancer' : 'meter',
      offline: isOffline(ents, stateById),
      options: {
        net, import: imp, export: exp,
        current_l1: currents, current_l2: currents, current_l3: currents,
      },
      suggested: {
        net: net.length ? pickBest(net, [/_power$|active_power|\bpower\b/]) : null,
        import: net.length ? null : pickBest(imp, [/power_consumption|import|consumption/]),
        export: net.length ? null : pickBest(exp, [/power_production|export|production/]),
        current_l1: byPhase(1)[0] ? byPhase(1)[0].entity_id : null,
        current_l2: byPhase(2)[0] ? byPhase(2)[0].entity_id : null,
        current_l3: byPhase(3)[0] ? byPhase(3)[0].entity_id : null,
      },
    });
  }

  const rank = { p1: 0, load_balancer: 1, meter: 2 };
  candidates.sort((a, b) => (a.offline - b.offline) || (rank[a.kind] - rank[b.kind]) ||
    a.name.localeCompare(b.name));
  return candidates;
}

function detectLoadBalancers(entities, devices, states, skipDeviceIds = new Set()) {
  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const byDevice = groupByDevice(entities);
  return devices
    .filter((d) => !skipDeviceIds.has(d.id) && LOAD_BALANCER_TEXT.test(deviceText(d)) && byDevice.has(d.id))
    .map((d) => {
      const ents = byDevice.get(d.id);
      return {
        device_id: d.id,
        name: d.name_by_user || d.name || 'Unknown device',
        integration: ents[0].platform,
        model: d.model || null,
        offline: isOffline(ents, stateById),
      };
    })
    .sort((a, b) => a.offline - b.offline);
}

function manualGridOptions(entities, states) {
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  const power = [];
  const current = [];
  for (const s of states) {
    const e = regById.get(s.entity_id) || { entity_id: s.entity_id };
    if (isPower(e, s)) power.push(option(e, s));
    if (isCurrent(e, s)) current.push(option(e, s));
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  power.sort(byName);
  current.sort(byName);
  return {
    net: power, import: power, export: power,
    current_l1: current, current_l2: current, current_l3: current,
  };
}

module.exports = { detectGridMeters, detectLoadBalancers, manualGridOptions };

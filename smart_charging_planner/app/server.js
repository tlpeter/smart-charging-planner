'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');
const { detectVehicles, percentSensors, findChargeLimit } = require('./vehicles');
const { detectChargers, manualChargerOptions } = require('./chargers');
const { detectGridMeters, detectLoadBalancers, manualGridOptions } = require('./grid');
const { detectPriceSources, fetchPrices, summarise, totalPrice, isoLocal, parseLocal, ACTION_SOURCES } = require('./prices');
const { DAYS, normalise, collect, winnersPerDay, nextDeparture, calendarTrips } = require('./departures');
const { chargePowerKw, energyNeededKwh, planCharging, periods } = require('./planner');
const { houseLoadProfile, availableForBlock } = require('./houseload');
const { computeSavings } = require('./savings');
const { buildTripEvents, markDuplicates, toHaData } = require('./trips');
const { checkControl } = require('./control');
const controller = require('./controller');
const session = require('./session');
const { learnedPower } = require('./chargepower');
const boost = require('./boost');
const notifier = require('./notify');

const PORT = 8099;
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_VERSION = require('./package.json').version;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

// The car's own charge limit (e.g. Renault "Target charge level"). For a
// vehicle saved before the app knew about it, it is looked up on the car's
// device once.
const foundLimit = new Map(); // device_id -> entity_id | null
async function carChargeLimit(vehicle, states) {
  if (!vehicle) return null;
  let id = vehicle.charge_limit_entity;
  if (id === undefined && vehicle.device_id) {
    if (!foundLimit.has(vehicle.device_id)) {
      try {
        const { entities } = await loadRegistries();
        foundLimit.set(vehicle.device_id, findChargeLimit(entities, states, vehicle.device_id));
      } catch {
        foundLimit.set(vehicle.device_id, null);
      }
    }
    id = foundLimit.get(vehicle.device_id);
  }
  if (!id) return null;
  const st = states.find((x) => x.entity_id === id);
  const value = st ? Number(st.state) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 100) return { entity_id: id, value: null, name: (st && st.attributes && st.attributes.friendly_name) || id };
  return {
    entity_id: id,
    value,
    name: (st.attributes && st.attributes.friendly_name) || id,
    writable: /^(number|input_number)\./.test(id),
    min: st.attributes && st.attributes.min,
    max: st.attributes && st.attributes.max,
    step: st.attributes && st.attributes.step,
  };
}

async function loadRegistries() {
  const [entities, devices, states] = await Promise.all([
    ha.call({ type: 'config/entity_registry/list' }),
    ha.call({ type: 'config/device_registry/list' }),
    ha.call({ type: 'get_states' }),
  ]);
  return { entities, devices, states };
}

// Current value of an entity, with its unit, for showing in the UI.
function valueOf(states, entityId) {
  if (!entityId) return null;
  const s = states.find((x) => x.entity_id === entityId);
  if (!s) return { entity_id: entityId, state: 'not found', unit: null };
  return {
    entity_id: entityId,
    name: (s.attributes && s.attributes.friendly_name) || entityId,
    state: s.state,
    unit: (s.attributes && s.attributes.unit_of_measurement) || null,
  };
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

let savingsCache = null;

const routes = {
  'GET /api/status': async () => {
    let entityCount = null;
    if (ha.state.connected) {
      try {
        entityCount = (await ha.call({ type: 'get_states' })).length;
      } catch (err) {
        ha.state.lastError = err.message;
      }
    }
    return {
      app_version: APP_VERSION,
      connected: ha.state.connected,
      ha_version: ha.state.version,
      time_zone: ha.state.timeZone,
      entity_count: entityCount,
      log_level: options.log_level,
      refresh_minutes: options.refresh_minutes,
      last_refresh: planCache ? planCache.at : null,
      allow_control: options.allow_control,
      allow_calendar_write: options.allow_calendar_write === true,
      error: ha.state.lastError,
    };
  },

  // Look for vehicles in Home Assistant.
  'GET /api/vehicles/detect': async () => {
    const { entities, devices, states } = await loadRegistries();
    return {
      candidates: detectVehicles(entities, devices, states),
      percent_sensors: percentSensors(entities, states),
    };
  },

  // The saved vehicle(s) with their live values.
  'GET /api/vehicles': async () => {
    const saved = settings.load().vehicles;
    const states = ha.state.connected ? await ha.call({ type: 'get_states' }) : [];
    return {
      vehicles: saved.map((v) => ({
        ...v,
        live: {
          soc: valueOf(states, v.soc_entity),
          range: valueOf(states, v.range_entity),
          charging: valueOf(states, v.charging_entity),
          plugged: valueOf(states, v.plugged_entity),
          charge_limit: valueOf(states, v.charge_limit_entity),
        },
      })),
    };
  },

  // Save the chosen vehicle. v1 keeps one vehicle; the list allows more later.
  'POST /api/vehicles': async (req) => {
    const body = await readBody(req);
    // Modes: "sensor" (battery level from the car), "manual_soc" (the user
    // enters it at plug-in), "fixed_kwh" (a fixed amount per session).
    const mode = ['manual_soc', 'fixed_kwh'].includes(body.mode) ? body.mode : 'sensor';
    if (mode === 'sensor' && (!body.soc_entity || !String(body.soc_entity).startsWith('sensor.'))) {
      throw badRequest('A battery (SoC) sensor is required');
    }
    if (mode === 'manual_soc' && !(Number(body.capacity_kwh) > 0)) throw badRequest('Battery capacity is required to estimate the battery level');
    const fixedKwh = mode === 'fixed_kwh' ? Number(body.fixed_kwh) : null;
    if (mode === 'fixed_kwh' && !(fixedKwh >= 1 && fixedKwh <= 150)) throw badRequest('The amount per session must be between 1 and 150 kWh');
    const capacity = body.capacity_kwh === '' || body.capacity_kwh == null
      ? null : Number(body.capacity_kwh);
    if (capacity !== null && !(capacity > 0 && capacity < 300)) {
      const err = new Error('Battery capacity must be between 0 and 300 kWh');
      err.status = 400;
      throw err;
    }
    const vehicle = {
      name: String(body.name || 'My vehicle').slice(0, 60),
      mode,
      fixed_kwh: fixedKwh,
      device_id: body.device_id || null,
      integration: body.integration || null,
      soc_entity: mode === 'sensor' ? body.soc_entity : null,
      range_entity: body.range_entity || null,
      charging_entity: body.charging_entity || null,
      plugged_entity: String(body.plugged_entity || '').startsWith('binary_sensor.') || String(body.plugged_entity || '').startsWith('sensor.') ? body.plugged_entity : null,
      capacity_kwh: capacity,
      charge_limit_entity: /^(number|sensor|input_number)\./.test(String(body.charge_limit_entity || '')) ? body.charge_limit_entity : null,
    };
    const s = settings.load();
    s.vehicles = [vehicle];
    settings.save(s);
    ha.log('Saved vehicle', vehicle.name, vehicle.soc_entity);
    return { ok: true, vehicle };
  },

  // Battery level entered by the user (cars without integration).
  'POST /api/vehicle/soc': async (req) => {
    const body = await readBody(req);
    const v = Number(body.soc);
    if (!(v >= 0 && v <= 100)) throw badRequest('Battery level must be between 0 and 100 %');
    session.setManualSoc(v);
    return { ok: true };
  },

  'DELETE /api/vehicles': async () => {
    const s = settings.load();
    s.vehicles = [];
    settings.save(s);
    return { ok: true };
  },

  // Look for chargers in Home Assistant. Vehicles are excluded.
  'GET /api/chargers/detect': async () => {
    const { entities, devices, states } = await loadRegistries();
    const vehicleIds = new Set(detectVehicles(entities, devices, states).map((v) => v.device_id));
    return {
      candidates: detectChargers(entities, devices, states, vehicleIds),
      manual: manualChargerOptions(entities, states),
    };
  },

  'GET /api/chargers': async () => {
    const saved = settings.load().chargers;
    const states = ha.state.connected ? await ha.call({ type: 'get_states' }) : [];
    return {
      chargers: saved.map((c) => ({
        ...c,
        live: {
          status: valueOf(states, c.status_entity),
          power: valueOf(states, c.power_entity),
          current: valueOf(states, c.current_entity),
          switch: valueOf(states, c.switch_entity),
          max: effectiveMaxCurrent(c, states),
        },
      })),
    };
  },

  'POST /api/chargers': async (req) => {
    const body = await readBody(req);
    const pick = (key, domains) => {
      const v = body[key];
      if (!v) return null;
      if (!domains.includes(String(v).split('.')[0])) throw badRequest(`Invalid entity for ${key}`);
      return v;
    };
    const charger = {
      name: String(body.name || 'My charger').slice(0, 60),
      device_id: body.device_id || null,
      integration: body.integration || null,
      status_entity: pick('status_entity', ['sensor', 'binary_sensor']),
      power_entity: pick('power_entity', ['sensor']),
      current_entity: pick('current_entity', ['number']),
      switch_entity: pick('switch_entity', ['switch']),
      phases: Number(body.phases) === 1 ? 1 : 3,
      max_current: body.max_current === '' || body.max_current == null ? null : Number(body.max_current),
      // Limit sensors to follow live; the lowest value counts.
      max_current_entities: (Array.isArray(body.max_current_entities) ? body.max_current_entities : String(body.max_current_entities || '').split(','))
        .map((x) => String(x).trim())
        .filter((x) => /^(sensor|number)\./.test(x))
        .slice(0, 4),
    };
    if (!charger.status_entity && !charger.power_entity && !charger.current_entity && !charger.switch_entity) {
      throw badRequest('Choose at least one entity');
    }
    if (charger.max_current !== null && !(charger.max_current >= 6 && charger.max_current <= 80)) {
      throw badRequest('Maximum current must be between 6 and 80 A');
    }
    const s = settings.load();
    s.chargers = [charger];
    settings.save(s);
    ha.log('Saved charger', charger.name);
    return { ok: true, charger };
  },

  'DELETE /api/chargers': async () => {
    const s = settings.load();
    s.chargers = [];
    settings.save(s);
    return { ok: true };
  },

  // Grid meter and load balancer. Vehicles and chargers are skipped.
  'GET /api/grid/detect': async () => {
    const { entities, devices, states } = await loadRegistries();
    const vehicleIds = detectVehicles(entities, devices, states).map((v) => v.device_id);
    const chargerIds = detectChargers(entities, devices, states, new Set(vehicleIds)).map((c) => c.device_id);
    const skip = new Set([...vehicleIds, ...chargerIds]);
    return {
      candidates: detectGridMeters(entities, devices, states, skip),
      load_balancers: detectLoadBalancers(entities, devices, states, skip),
      manual: manualGridOptions(entities, states),
    };
  },

  'GET /api/grid': async () => {
    const saved = settings.load().grid;
    const states = ha.state.connected ? await ha.call({ type: 'get_states' }) : [];
    return {
      grid: saved.map((g) => ({
        ...g,
        live: {
          net: valueOf(states, g.net_entity),
          import: valueOf(states, g.import_entity),
          export: valueOf(states, g.export_entity),
          current_l1: valueOf(states, g.current_l1_entity),
          current_l2: valueOf(states, g.current_l2_entity),
          current_l3: valueOf(states, g.current_l3_entity),
        },
      })),
    };
  },

  'POST /api/grid': async (req) => {
    const body = await readBody(req);
    const sensor = (key) => {
      const v = body[key];
      if (!v) return null;
      if (!String(v).startsWith('sensor.')) throw badRequest(`Invalid entity for ${key}`);
      return v;
    };
    const grid = {
      name: String(body.name || 'Grid meter').slice(0, 60),
      device_id: body.device_id || null,
      integration: body.integration || null,
      net_entity: sensor('net_entity'),
      import_entity: sensor('import_entity'),
      export_entity: sensor('export_entity'),
      current_l1_entity: sensor('current_l1_entity'),
      current_l2_entity: sensor('current_l2_entity'),
      current_l3_entity: sensor('current_l3_entity'),
      phases: Number(body.phases) === 1 ? 1 : 3,
      main_fuse: Number(body.main_fuse),
      load_balancer: null,
    };
    if (!grid.net_entity && !grid.import_entity) {
      throw badRequest('Choose a net power sensor, or an import power sensor');
    }
    if (!(grid.main_fuse >= 6 && grid.main_fuse <= 200)) {
      throw badRequest('Main fuse must be between 6 and 200 A');
    }
    // Load balancer: "" = none, "other" = built into the charger or not in HA,
    // otherwise the device id of a detected load balancer.
    const lb = String(body.load_balancer || '');
    if (lb === 'other') {
      grid.load_balancer = { type: 'other', device_id: null, name: 'Built into charger or not in Home Assistant' };
    } else if (lb) {
      grid.load_balancer = { type: 'device', device_id: lb, name: String(body.load_balancer_name || 'Load balancer').slice(0, 60) };
    }
    const s = settings.load();
    s.grid = [grid];
    settings.save(s);
    ha.log('Saved grid meter', grid.name);
    return { ok: true, grid };
  },

  'DELETE /api/grid': async () => {
    const s = settings.load();
    s.grid = [];
    settings.save(s);
    return { ok: true };
  },

  // Price sources.
  'GET /api/prices/detect': async () => {
    const { entities, devices, states } = await loadRegistries();
    return { candidates: detectPriceSources(entities, devices, states) };
  },

  // Fetch prices with the given (unsaved) settings and summarise them.
  'POST /api/prices/test': async (req) => {
    const cfg = priceConfigFrom(await readBody(req));
    const result = await fetchPrices(cfg.source, ha.state.timeZone);
    return { summary: summarise(result, cfg), time_zone: ha.state.timeZone };
  },

  'GET /api/prices': async () => {
    const cfg = settings.load().prices;
    if (!cfg) return { prices: null };
    try {
      const result = await fetchPrices(cfg.source, ha.state.timeZone);
      return { prices: cfg, summary: summarise(result, cfg), time_zone: ha.state.timeZone };
    } catch (err) {
      return { prices: cfg, error: err.message, time_zone: ha.state.timeZone };
    }
  },

  'POST /api/prices': async (req) => {
    const cfg = priceConfigFrom(await readBody(req));
    const s = settings.load();
    s.prices = cfg;
    settings.save(s);
    ha.log('Saved price source', cfg.source.id);
    return { ok: true, prices: cfg };
  },

  'DELETE /api/prices': async () => {
    const s = settings.load();
    s.prices = null;
    settings.save(s);
    return { ok: true };
  },

  // The charging plan (advice only) with everything the Overview shows.
  'GET /api/plan': async () => {
    const s = settings.load();
    const tz = ha.state.timeZone;
    const now = Date.now();
    const missing = [];
    const vehicle = s.vehicles[0] || null;
    const charger = s.chargers[0] || null;
    if (!s.prices) missing.push('prices');
    if (!vehicle) missing.push('vehicle');

    let prices = [];
    let priceError = null;
    if (s.prices) {
      try {
        const result = await fetchPrices(s.prices.source, tz);
        prices = result.prices.map((p) => ({ ...p, total: totalPrice(p.price, s.prices) }));
      } catch (err) {
        priceError = err.message;
      }
    }

    const states = await ha.call({ type: 'get_states' });
    const mode = vehicle ? vehicle.mode || 'sensor' : null;
    const socValue = vehicle && mode === 'sensor' ? valueOf(states, vehicle.soc_entity) : null;
    let soc = socValue ? Number(socValue.state) : NaN;
    const plugged = vehicle && vehicle.plugged_entity ? valueOf(states, vehicle.plugged_entity) : null;

    // Cars without integration: follow the session and the energy charged.
    const actualNow = controller.readActual({ vehicle, charger, states, now });
    const sess = session.update(actualNow.plugged, now);
    let sessionInfo = null;
    if (vehicle && mode !== 'sensor') {
      const from = mode === 'manual_soc'
        ? (sess.manual_soc ? Math.max(sess.manual_soc.at, sess.since || 0) : null)
        : sess.since;
      let kwhSince = 0;
      let energyError = null;
      if (from && charger && charger.power_entity) {
        try {
          kwhSince = await session.energySince(charger.power_entity, from, now);
        } catch (err) {
          energyError = err.message;
        }
      }
      sessionInfo = {
        plugged: sess.plugged,
        since: sess.since,
        since_known: sess.since_known,
        manual_soc: sess.manual_soc,
        kwh_since: kwhSince,
        counting: !!(charger && charger.power_entity),
        energy_error: energyError,
      };
      if (mode === 'manual_soc' && sess.manual_soc && vehicle.capacity_kwh > 0) {
        const loss = 1 + (Number(s.planning.loss_percent) || 0) / 100;
        soc = Math.min(100, sess.manual_soc.value + (kwhSince / loss / vehicle.capacity_kwh) * 100);
        soc = Math.round(soc * 10) / 10;
      }
    }

    const planning = s.planning;
    const dep = normalise(s.departures, s.planning);
    const { events, error: calendarError } = await calendarEvents(dep, tz, now);
    const departure = nextDeparture(dep, { states, events, tz, now });

    const maxInfo = charger ? effectiveMaxCurrent(charger, states) : null;
    const maxCurrent = maxInfo && maxInfo.amps ? maxInfo.amps : null;
    const phases = charger ? charger.phases : 3;
    const theoreticalKw = chargePowerKw(phases, maxCurrent);
    // What the car really charges at, learned from the charger power sensor.
    const learned = charger && charger.power_entity ? await learnedPower(charger.power_entity, now) : { available: false, reason: 'no_power_sensor' };
    const learnedKw = learned.available ? learned.kw : null;
    const powerKw = learnedKw ? Math.min(theoreticalKw, learnedKw) : theoreticalKw;

    // House load: less room for the charger when the house uses more.
    const grid = s.grid[0] || null;
    let houseLoad = { available: false, reason: planning.use_house_load === false ? 'off' : 'no_grid' };
    if (grid && planning.use_house_load !== false) {
      houseLoad = await houseLoadProfile(grid, charger, tz, now);
      if (houseLoad.available) {
        const opts = { profile: houseLoad.profile, mainFuse: grid.main_fuse, phases, chargerMax: maxCurrent || 16 };
        prices = prices.map((p) => {
          const a = availableForBlock(p.start, tz, opts);
          return { ...p, power_kw: learnedKw ? Math.min(a.power_kw, learnedKw) : a.power_kw, amps: a.amps };
        });
      }
    }
    const wantedSoc = departure ? departure.soc : dep.default_soc;
    // The car stops at its own charge limit; planning above it is pointless.
    const carLimit = vehicle && mode !== 'fixed_kwh' ? await carChargeLimit(vehicle, states) : null;
    const limited = carLimit && carLimit.value != null && wantedSoc > carLimit.value;
    const targetSoc = limited ? carLimit.value : wantedSoc;
    let neededKwh = vehicle ? energyNeededKwh(soc, targetSoc, vehicle.capacity_kwh, planning.loss_percent) : null;
    if (vehicle && mode === 'fixed_kwh') {
      // Nothing to plan while unplugged; otherwise the rest of the fixed amount.
      neededKwh = sessionInfo && sessionInfo.plugged ? Math.max(0, vehicle.fixed_kwh - sessionInfo.kwh_since) : null;
    }
    // Without a departure: plan in the cheapest known blocks, no deadline.
    const deadline = departure ? departure.time : (prices.length ? prices[prices.length - 1].end : now);
    const plan = planCharging({
      prices, now, deadline, neededKwh, powerKw,
      continuous: planning.continuous !== false,
      minSplitSaving: Number(planning.min_split_saving) || 0,
    });
    if (!departure) plan.notes.unshift('no_departure');
    if (vehicle && mode === 'manual_soc' && !(sessionInfo && sessionInfo.manual_soc)) {
      plan.notes = ['enter_soc', ...plan.notes.filter((n) => n !== 'missing_data')];
    }
    if (vehicle && mode === 'fixed_kwh' && !(sessionInfo && sessionInfo.plugged)) {
      plan.notes = ['fixed_waiting', ...plan.notes.filter((n) => n !== 'missing_data')];
    }
    if (calendarError) plan.notes.push('calendar_error');
    if (limited) plan.notes.push('car_limit');

    // "Charge now": replaces the plan with charging right away.
    let activePlan = plan;
    let boostInfo = null;
    const b = boost.current();
    if (b && actualNow.plugged === false) boost.stop('car unplugged'); // nothing to stop: the car is gone
    else if (b) {
      let kwh = null;
      let boostError = null;
      try {
        kwh = await boostNeededKwh(b, {
          soc, capacity: vehicle && vehicle.capacity_kwh, loss: planning.loss_percent, carLimit,
          normalNeeded: neededKwh, powerEntity: charger && charger.power_entity, now,
        });
      } catch (err) {
        boostError = err.message;
      }
      if (kwh != null && kwh <= 0.01) {
        const prev = boost.stop('goal reached');
        if (prev) ha.log('Charge now reached its goal; the plan takes over');
      }
      else {
        boostInfo = { active: true, mode: b.mode, value: b.value, started: b.started, remaining_kwh: kwh, error: boostError, send: b.send || null };
        if (kwh != null) {
          const lastEnd = prices.length ? prices[prices.length - 1].end : now;
          activePlan = planCharging({ prices, now, deadline: lastEnd, neededKwh: kwh, powerKw, immediate: true });
          boostInfo.end = activePlan.blocks.length ? activePlan.blocks[activePlan.blocks.length - 1].end : null;
        }
      }
    }

    return {
      time_zone: tz,
      currency: ha.state.currency,
      now,
      missing,
      price_error: priceError,
      calendar_error: calendarError,
      planning: { ...planning, target_soc: targetSoc, wanted_soc: wantedSoc },
      car_limit: carLimit,
      departure,
      vehicle: vehicle ? {
        name: vehicle.name,
        mode,
        fixed_kwh: vehicle.fixed_kwh || null,
        session: sessionInfo,
        soc: Number.isFinite(soc) ? soc : null,
        soc_state: socValue ? socValue.state : null,
        capacity_kwh: vehicle.capacity_kwh,
        plugged: plugged ? plugged.state : null,
      } : null,
      charger: charger ? { name: charger.name, phases: charger.phases, max_current: maxCurrent, max_source: maxInfo && maxInfo.source } : null,
      assumed_current: maxCurrent ? null : 16,
      power: {
        planned_kw: powerKw,
        theoretical_kw: theoreticalKw,
        amps: maxCurrent || 16,
        phases,
        max_source: maxInfo ? maxInfo.source : null,
        max_name: maxInfo ? maxInfo.name || null : null,
        learned,
        now_w: actualNow.power_w,
        charging_now: actualNow.charging,
      },
      prices: prices.map((p) => ({ start: p.start, end: p.end, total: p.total, power_kw: p.power_kw, amps: p.amps })),
      house_load: houseLoad.available ? {
        available: true,
        profile: houseLoad.profile.map((w) => Math.round(w)),
        days: houseLoad.days,
        charger_subtracted: houseLoad.charger_subtracted,
        main_fuse: grid.main_fuse,
      } : { available: false, reason: houseLoad.reason },
      plan: { ...activePlan, periods: periods(activePlan.blocks) },
      normal_plan: { ...plan, periods: periods(plan.blocks) },
      boost: boostInfo,
      plugged_now: actualNow.plugged,
      control_allowed: options.allow_control,
    };
  },

  // Savings per charging session over the last 30 days.
  'GET /api/savings': async () => {
    const s = settings.load();
    const tz = ha.state.timeZone;
    const now = Date.now();
    if (savingsCache && now - savingsCache.at < 10 * 60000 && savingsCache.key === JSON.stringify([s.chargers, s.vehicles, s.prices])) {
      return savingsCache.result;
    }
    const result = {
      time_zone: tz,
      currency: ha.state.currency,
      ...(await computeSavings({ charger: s.chargers[0], vehicle: s.vehicles[0], priceCfg: s.prices, tz, now })),
    };
    savingsCache = { at: now, key: JSON.stringify([s.chargers, s.vehicles, s.prices]), result };
    return result;
  },

  // Add trips to the calendar. Without "Allow adding trips to calendar" this
  // only shows what would be added (test mode).
  'POST /api/trips/preview': async (req) => tripsPlan(await readBody(req)),

  'POST /api/trips': async (req) => {
    const plan = await tripsPlan(await readBody(req));
    if (!plan.write_allowed) {
      throw badRequest('Test mode: nothing was added. Turn on "Allow adding trips to calendar" in the app\'s Configuration tab to add trips.');
    }
    let created = 0;
    for (const e of plan.events) {
      if (e.duplicate) continue;
      await ha.createCalendarEvent(plan.calendar, toHaData(e, ha.state.timeZone));
      created++;
    }
    return { ok: true, created, skipped: plan.events.length - created };
  },

  // Control check: how could the app control the charger? Nothing is sent.
  'GET /api/control/check': async () => {
    const s = settings.load();
    const charger = s.chargers[0] || null;
    const [{ entities, states }, services] = await Promise.all([
      loadRegistries(),
      ha.call({ type: 'get_services' }),
    ]);
    let c = charger;
    if (c && !c.device_id) {
      // Chosen manually: find the device through one of its entities.
      const ids = [c.status_entity, c.current_entity, c.switch_entity].filter(Boolean);
      const reg = entities.find((e) => ids.includes(e.entity_id) && e.device_id);
      if (reg) c = { ...c, device_id: reg.device_id, integration: c.integration || reg.platform };
    }
    return { control_allowed: options.allow_control, ...checkControl({ charger: c, entities, states, services }) };
  },

  // Departure times.
  'GET /api/departures': async () => {
    const s = settings.load();
    const tz = ha.state.timeZone;
    const now = Date.now();
    const dep = normalise(s.departures, s.planning);
    const states = await ha.call({ type: 'get_states' });
    const { events, error } = await calendarEvents(dep, tz, now);
    const days = winnersPerDay(collect(dep, { states, events, tz, now }), tz);
    const list = (domain) => states
      .filter((x) => x.entity_id.startsWith(domain + '.'))
      .map((x) => ({ entity_id: x.entity_id, name: (x.attributes && x.attributes.friendly_name) || x.entity_id, state: x.state }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      time_zone: tz,
      now,
      departures: dep,
      next: days.length ? days[0].winner : null,
      upcoming: days,
      calendar_error: error,
      calendar_trips: calendarTrips(dep, events, tz, now).filter((t) => t.time < now + 14 * 86400000),
      calendar_write_allowed: options.allow_calendar_write === true,
      options: {
        input_datetime: list('input_datetime'),
        input_number: list('input_number'),
        calendar: list('calendar'),
      },
    };
  },

  'POST /api/departures': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    const cur = normalise(s.departures, s.planning);
    const soc = (v, name) => {
      const n = Number(v);
      if (!(n >= 10 && n <= 100)) throw badRequest(`${name}: battery level must be between 10 and 100 %`);
      return n;
    };
    const time = (v, name) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw badRequest(`${name}: use a time like 07:00`);
      return v;
    };
    const schedule = {};
    for (const day of DAYS) {
      const d = (body.schedule || {})[day] || {};
      schedule[day] = { enabled: !!d.enabled, time: time(d.time, day), soc: soc(d.soc, day) };
    }
    const helper = body.helper || {};
    const cal = body.calendar || {};
    const buffer = Number(cal.buffer_minutes);
    if (!(buffer >= 0 && buffer <= 240)) throw badRequest('Calendar buffer must be between 0 and 240 minutes');
    if (helper.enabled && !String(helper.datetime_entity || '').startsWith('input_datetime.')) throw badRequest('Choose a date/time helper');
    if (cal.enabled && !String(cal.entity || '').startsWith('calendar.')) throw badRequest('Choose a calendar');
    const match = ['target', 'keyword', 'all'].includes(cal.match) ? cal.match : 'target';
    s.departures = {
      ...cur,
      default_soc: soc(body.default_soc, 'Default'),
      schedule_enabled: !!body.schedule_enabled,
      schedule,
      helper: {
        enabled: !!helper.enabled,
        datetime_entity: helper.datetime_entity || null,
        soc_entity: String(helper.soc_entity || '').startsWith('input_number.') ? helper.soc_entity : null,
      },
      calendar: {
        enabled: !!cal.enabled,
        entity: cal.entity || null,
        match,
        keyword: String(cal.keyword || '').slice(0, 40),
        buffer_minutes: buffer,
        soc: soc(cal.soc, 'Calendar'),
      },
    };
    settings.save(s);
    return { ok: true };
  },

  // One-off departure. Expires by itself after the departure time.
  'POST /api/departures/override': async (req) => {
    const body = await readBody(req);
    const tz = ha.state.timeZone;
    const time = parseLocal(body.datetime, tz);
    const now = Date.now();
    if (!Number.isFinite(time) || time <= now) throw badRequest('Choose a date and time in the future');
    if (time > now + 7 * 86400000) throw badRequest('Choose a moment within the next 7 days');
    const s = settings.load();
    const dep = normalise(s.departures, s.planning);
    const n = Number(body.soc);
    if (!(n >= 10 && n <= 100)) throw badRequest('Battery level must be between 10 and 100 %');
    s.departures = { ...dep, override: { time, soc: n } };
    settings.save(s);
    return { ok: true };
  },

  'DELETE /api/departures/override': async () => {
    const s = settings.load();
    s.departures = { ...normalise(s.departures, s.planning), override: null };
    settings.save(s);
    return { ok: true };
  },
};

// What adding trips would create, with duplicates marked.
async function tripsPlan(body) {
  const s = settings.load();
  const tz = ha.state.timeZone;
  const dep = normalise(s.departures, s.planning);
  const calendar = dep.calendar.entity;
  if (!calendar) throw badRequest('Choose a calendar on the Departures tab first');
  const events = buildTripEvents(body, tz);
  let existing = [];
  try {
    const r = await ha.callAction('calendar', 'get_events', {
      start_date_time: isoLocal(events[0].start - 60000, tz),
      end_date_time: isoLocal(events[events.length - 1].end + 60000, tz),
    }, { entity_id: calendar });
    existing = (r && r[calendar] && r[calendar].events) || [];
  } catch (err) {
    ha.warn('Could not check for duplicate trips:', err.message);
  }
  return {
    calendar,
    write_allowed: options.allow_calendar_write === true,
    events: markDuplicates(events, existing, tz),
    time_zone: tz,
  };
}

// Calendar events for the next 15 days, when the calendar source is on.
async function calendarEvents(dep, tz, now) {
  if (!dep.calendar.enabled || !dep.calendar.entity) return { events: [], error: null };
  try {
    const r = await ha.callAction('calendar', 'get_events', {
      start_date_time: isoLocal(now, tz),
      end_date_time: isoLocal(now + 15 * 86400000, tz),
    }, { entity_id: dep.calendar.entity });
    const entry = r && r[dep.calendar.entity];
    return { events: (entry && entry.events) || [], error: null };
  } catch (err) {
    ha.warn('Could not read calendar', dep.calendar.entity, '-', err.message);
    return { events: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Background refresh: recalculate the plan every "refresh_minutes" (set in the
// app's Configuration tab), also when nobody has the page open.
// ---------------------------------------------------------------------------

const computePlan = routes['GET /api/plan'];

// kWh still needed for a "Charge now" goal.
async function boostNeededKwh(b, { soc, capacity, loss, normalNeeded, powerEntity, now, carLimit }) {
  if (b.mode === 'target') return normalNeeded;
  if (b.mode === 'soc') {
    const goal = carLimit && carLimit.value != null ? Math.min(b.value, carLimit.value) : b.value;
    return energyNeededKwh(soc, goal, capacity, loss);
  }
  if (b.mode === 'kwh') {
    const done = powerEntity && b.started ? await session.energySince(powerEntity, b.started, now) : 0;
    return Math.max(0, b.value - done);
  }
  return null;
}

function boostFromBody(body, cached, starting = false) {
  const mode = String(body.mode || '');
  if (!boost.MODES.includes(mode)) throw badRequest('Choose how long to charge');
  const value = Number(body.value);
  if (mode === 'soc') {
    if (!(value >= 1 && value <= 100)) throw badRequest('Battery level must be between 1 and 100 %');
    if (!Number.isFinite(cached.vehicle && cached.vehicle.soc)) throw badRequest('The battery level is not known; choose an amount in kWh instead');
  }
  if (mode === 'kwh' && !(value >= 0.5 && value <= 200)) throw badRequest('Amount must be between 0.5 and 200 kWh');
  const lim = cached.car_limit;
  if (starting && mode === 'soc' && lim && lim.value != null && value > lim.value) {
    throw badRequest(`Your car stops at ${lim.value}% (${lim.name}). Raise that limit first, or choose ${lim.value}% or less.`);
  }
  if (mode === 'target' && cached.normal_plan.needed_kwh == null) throw badRequest('The plan does not know how much to charge; choose an amount in kWh instead');
  return { mode, value: mode === 'target' ? null : value };
}

async function freshPlan() {
  if (!planCache || Date.now() - planCache.at > 60000) await refreshPlan('charge now');
  return planCache.result;
}

// What "Charge now" would do, compared with the plan. Nothing is started.
routes['POST /api/boost/preview'] = async (req) => {
  const body = await readBody(req);
  const cached = await freshPlan();
  const b = boostFromBody(body, cached);
  const now = Date.now();
  const v = cached.vehicle || {};
  const lim = cached.car_limit;
  const aboveLimit = b.mode === 'soc' && lim && lim.value != null && b.value > lim.value;
  const kwh = b.mode === 'target' ? cached.normal_plan.needed_kwh
    : b.mode === 'soc' ? energyNeededKwh(v.soc, aboveLimit ? lim.value : b.value, v.capacity_kwh, cached.planning.loss_percent)
      : b.value;
  const powerKw = cached.power ? cached.power.planned_kw : 11;
  const prices = cached.prices;
  const lastEnd = prices.length ? prices[prices.length - 1].end : now;
  const nowPlan = planCharging({ prices, now, deadline: lastEnd, neededKwh: kwh, powerKw, immediate: true });
  const deadline = cached.departure ? cached.departure.time : lastEnd;
  const laterPlan = planCharging({
    prices, now, deadline, neededKwh: kwh, powerKw,
    continuous: cached.planning.continuous !== false,
    minSplitSaving: Number(cached.planning.min_split_saving) || 0,
  });
  const normal = cached.normal_plan;
  const periodsNormal = normal.periods || [];
  const running = periodsNormal.find((x) => x.start <= now && now < x.end) || null;
  const next = periodsNormal.find((x) => x.start > now) || null;
  const soonMinutes = 60;
  const span = (pl) => (pl.blocks.length ? { start: pl.blocks[0].start, end: pl.blocks[pl.blocks.length - 1].end, cost: pl.cost, kwh: pl.planned_kwh, notes: pl.notes } : { notes: pl.notes });
  return {
    goal: b,
    kwh,
    plugged: cached.plugged_now,
    now: span(nowPlan),
    plan: span(laterPlan),
    extra_cost: nowPlan.cost != null && laterPlan.cost != null ? nowPlan.cost - laterPlan.cost : null,
    running: running ? { start: running.start, end: running.end } : null,
    soon: next && next.start - now <= soonMinutes * 60000 ? { start: next.start, end: next.end, avg_price: next.avg_price } : null,
    soon_minutes: soonMinutes,
    car_limit: lim || null,
    above_limit: aboveLimit,
    wanted_soc: b.mode === 'soc' ? b.value : null,
    control_allowed: options.allow_control,
    departure: cached.departure ? cached.departure.time : null,
  };
};

// Really start or stop the charger with the chosen start/stop method.
// Only when "Allow control" is on; otherwise it is logged as not sent.
async function manualControl(on, reason) {
  const s = settings.load();
  const charger = s.chargers[0] || null;
  if (!charger) throw badRequest('Set up a charger first');
  const rules = { ...controller.DEFAULT_RULES, ...(s.control || {}) };
  const [methods, states] = await Promise.all([currentControlMethods(charger), ha.call({ type: 'get_states' })]);
  const chosen = chosenMethods(methods, rules);
  const m = chosen && chosen.start_stop;
  const command = controller.startStopCommand(m, on, methods && methods.device_id);
  const actual = controller.readActual({ vehicle: s.vehicles[0] || null, charger, states });
  const entry = {
    time: Date.now(),
    manual: true,
    plugged: actual.plugged,
    charging: actual.charging,
    status: actual.status,
    power_w: actual.power_w,
    want: on ? 'charge' : 'pause',
    code: on ? 'manual_start' : 'manual_stop',
    reason,
    commands: command ? [{ what: on ? 'start charging' : 'pause charging', service: command.service, data: command.data, target: command.target }] : [],
    agrees: true,
    sent: false,
    control_allowed: options.allow_control,
  };
  if (!command) {
    entry.error = 'No start/stop method chosen in Settings › Control';
  } else if (!options.allow_control) {
    entry.error = 'Allow control is off, so nothing was sent';
  } else {
    try {
      await ha.sendControl(command, controller.allowedFor(m));
      entry.sent = true;
      lastManual = { on, at: entry.time };
      await afterSent(on, command, reason);
      // Remember it, so the live control knows the last command sent.
      lastLiveSend = { key: JSON.stringify([command.service, command.data, command.target]), at: entry.time };
    } catch (err) {
      entry.error = err.message;
      await commandFailed(on, err.message);
    }
  }
  controller.logSent(entry);
  if (entry.error) ha.log(`${reason}: not sent (${entry.error})`);
  return { sent: entry.sent, error: entry.error || null, command: entry.commands[0] || null, at: entry.time };
}

routes['POST /api/boost'] = async (req) => {
  const body = await readBody(req);
  const cached = await freshPlan();
  const b = boostFromBody(body, cached, true);
  if (cached.plugged_now === false) throw badRequest('The car is not plugged in');
  const s = settings.load();
  const states = await ha.call({ type: 'get_states' });
  const actual = controller.readActual({ vehicle: s.vehicles[0] || null, charger: s.chargers[0] || null, states });
  if (actual.plugged === false) throw badRequest('The car is not plugged in');
  const wasCharging = actual.charging === true;
  boost.start(b);
  let send = null;
  if (!wasCharging) {
    send = await manualControl(true, 'Charge now started by you');
  } else {
    send = { sent: false, error: null, note: 'The charger was already charging, so nothing had to be sent', at: Date.now() };
  }
  boost.update({ was_charging: wasCharging, send });
  planCache = null;
  await refreshPlan('charge now started', { fresh: true });
  return { ok: true, send };
};

routes['DELETE /api/boost'] = async () => {
  boost.stop('stopped by you');
  lastManual = null;
  planCache = null;
  await refreshPlan('charge now stopped', { fresh: true });
  const n = lastDryRun;
  const c = n && n.commands[0];
  const send = n && (n.sent || n.error) && c ? { sent: !!n.sent, error: n.error || null, command: c, at: n.sent_at || Date.now() } : null;
  return { ok: true, send, next: n ? { want: n.want, reason: n.reason } : null };
};

// Raise (or set) the car's own charge limit. Only with "Allow control" on,
// and only the limit entity of the chosen vehicle.
routes['POST /api/vehicle/charge_limit'] = async (req) => {
  const body = await readBody(req);
  const s = settings.load();
  const vehicle = s.vehicles[0] || null;
  const states = await ha.call({ type: 'get_states' });
  const lim = await carChargeLimit(vehicle, states);
  if (!lim) throw badRequest('No charge limit of the car found');
  if (!lim.writable) throw badRequest(`${lim.name} cannot be changed from Home Assistant`);
  const min = Number.isFinite(lim.min) ? lim.min : 1;
  const max = Number.isFinite(lim.max) ? lim.max : 100;
  const step = Number(lim.step) > 0 ? Number(lim.step) : 1;
  // Round up to a value the car accepts (Renault: steps of 5).
  const value = Math.min(max, Math.ceil((Number(body.value) - min) / step - 1e-9) * step + min);
  if (!(value >= min && value <= max)) throw badRequest(`Choose a value between ${min} and ${max} %`);
  const domain = lim.entity_id.split('.')[0];
  const command = { service: `${domain}.set_value`, data: { value }, target: { entity_id: lim.entity_id } };
  const entry = {
    time: Date.now(), manual: true, want: 'none', code: 'car_limit',
    reason: `Car charge limit ${lim.value}% → ${value}%`,
    commands: [{ what: `set car charge limit to ${value}%`, service: command.service, data: command.data, target: command.target }],
    agrees: true, sent: false, control_allowed: options.allow_control,
  };
  try {
    await ha.sendControl(command, [{ service: command.service, entity_id: lim.entity_id }]);
    entry.sent = true;
  } catch (err) {
    entry.error = err.message;
  }
  controller.logSent(entry);
  if (!entry.sent) throw badRequest(entry.error);
  ha.log(`Car charge limit set to ${value}% (${lim.entity_id})`);
  planCache = null;
  return { ok: true, value, entity_id: lim.entity_id };
};

// Manual test on the Control tab: start or stop once.
routes['POST /api/control/manual'] = async (req) => {
  const body = await readBody(req);
  if (body.action !== 'start' && body.action !== 'stop') throw badRequest('Choose start or stop');
  const r = await manualControl(body.action === 'start', body.action === 'start' ? 'Manual test: start' : 'Manual test: stop');
  return r;
};
let planCache = null; // { at, result }
let planRunning = null;
let refreshTimer = null;

// A refresh that is already running may have started before a change (for
// example Charge now). With fresh = true the plan is calculated again after
// it, so the result always includes the change.
let rerunAfter = null;
function refreshPlan(reason, { fresh = false } = {}) {
  if (planRunning) {
    if (!fresh) return planRunning;
    if (!rerunAfter) {
      rerunAfter = planRunning.catch(() => {}).then(() => {
        rerunAfter = null;
        return refreshPlan(`${reason} (again)`);
      });
    }
    return rerunAfter;
  }
  planRunning = (async () => {
    try {
      const result = await computePlan();
      planCache = { at: Date.now(), result };
      try {
        await runDryRun(result);
      } catch (err) {
        ha.warn('Control dry run failed:', err.message);
      }
      const p = result.plan;
      if (result.departure && p.notes.includes('not_enough_time') && !result.boost) {
        const short = Math.max(0, (p.needed_kwh || 0) - (p.planned_kwh || 0));
        await notifier.notify('problem', 'Car will not be ready',
          `Only ${p.planned_kwh.toFixed(1)} of ${(p.needed_kwh || 0).toFixed(1)} kWh fits before the departure at ${hmLocal(result.departure.time)} (${short.toFixed(1)} kWh short).`,
          { key: `notready:${result.departure.time}`, minGapMs: 24 * 3600000 });
      }
      ha.debug(`Plan refreshed (${reason}):`, p.blocks.length ? `${p.planned_kwh.toFixed(1)} kWh in ${p.periods.length} period(s)` : 'nothing to charge', p.notes.join(',') || '');
      return result;
    } catch (err) {
      ha.warn('Plan refresh failed:', err.message);
      throw err;
    } finally {
      planRunning = null;
    }
  })();
  return planRunning;
}

routes['GET /api/plan'] = async (req) => {
  const url = new URL(req.url, 'http://localhost');
  const force = url.searchParams.get('refresh') === '1';
  const maxAge = options.refresh_minutes * 60000;
  if (force || !planCache || Date.now() - planCache.at > maxAge) await refreshPlan(force ? 'manual' : 'on request');
  return {
    ...planCache.result,
    computed_at: planCache.at,
    next_refresh: planCache.at + maxAge,
    refresh_minutes: options.refresh_minutes,
  };
};

// Control dry run (phase A): decide what the app would do, log it, send nothing.
let controlMethods = null; // { at, result }
let lastDryRun = null;

async function currentControlMethods(charger) {
  if (controlMethods && Date.now() - controlMethods.at < 60 * 60000 && controlMethods.key === JSON.stringify(charger)) return controlMethods.result;
  const [{ entities, states }, services] = await Promise.all([loadRegistries(), ha.call({ type: 'get_services' })]);
  let c = charger;
  if (c && !c.device_id) {
    const ids = [c.status_entity, c.current_entity, c.switch_entity].filter(Boolean);
    const reg = entities.find((e) => ids.includes(e.entity_id) && e.device_id);
    if (reg) c = { ...c, device_id: reg.device_id, integration: c.integration || reg.platform };
  }
  const result = checkControl({ charger: c, entities, states, services });
  controlMethods = { at: Date.now(), key: JSON.stringify(charger), result };
  return result;
}

async function runDryRun(planResult) {
  const s = settings.load();
  const charger = s.chargers[0] || null;
  if (!charger) return null;
  const [states, methods] = await Promise.all([ha.call({ type: 'get_states' }), currentControlMethods(charger)]);
  const rules = { ...controller.DEFAULT_RULES, ...(s.control || {}) };
  lastDryRun = controller.dryRun({
    plan: planResult,
    vehicle: s.vehicles[0] || null,
    charger,
    states,
    methods: chosenMethods(methods, rules),
    deviceId: methods && methods.device_id,
    rules,
    controlAllowed: options.allow_control,
    live: options.allow_control === true,
    boostActive: !!boost.current(),
  });
  ha.debug('Control:', lastDryRun.want, lastDryRun.reason, lastDryRun.commands.map((c) => c.what).join(', ') || 'no commands');
  if (options.allow_control === true) {
    await checkReaction(lastDryRun);
    await sendLive(lastDryRun, chosenMethods(methods, rules));
  }
  await notifier.publishSensors(planResult, lastDryRun, { lastCommand: lastCommandInfo });
  return lastDryRun;
}

// Time as the user reads it, e.g. "Thu 03:10".
function hmLocal(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ha.state.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

// After a start or pause, check a few minutes later that the charger really
// followed. If not, log it and send a notification.
const CHECK_AFTER_MS = Number(process.env.SCP_CHECK_AFTER_MS) || 5 * 60000;
let pendingCheck = null; // { on, at, service }
let lastCommandInfo = null; // for the status sensor

async function afterSent(on, command, reason, extraText = '') {
  pendingCheck = { on, at: Date.now(), service: command.service };
  lastCommandInfo = `${on ? 'start' : 'pause'} at ${hmLocal(Date.now())}`;
  await notifier.notify('startstop', on ? 'Charging started' : 'Charging paused', `${reason}${extraText}.`);
}

async function commandFailed(on, err) {
  await notifier.notify('problem', 'Charger command failed', `Could not ${on ? 'start' : 'pause'} the charger: ${err}`, { key: `fail:${on}`, minGapMs: 30 * 60000 });
}

async function checkReaction(entry) {
  if (!pendingCheck || Date.now() - pendingCheck.at < CHECK_AFTER_MS) return;
  const { on, service } = pendingCheck;
  pendingCheck = null;
  if (entry.plugged === false) return; // unplugged meanwhile: nothing to check
  const followed = on ? entry.charging === true : entry.charging !== true;
  if (followed) return;
  const text = on
    ? `The charger did not start charging within 5 minutes after ${service} (status: ${entry.status || 'unknown'}). The car may be full, or not ready to charge.`
    : `The charger is still charging 5 minutes after ${service}.`;
  controller.logSent({
    time: Date.now(), live: true, want: on ? 'charge' : 'pause', code: 'no_reaction',
    reason: 'Charger did not react', error: text, sent: false,
    plugged: entry.plugged, charging: entry.charging, status: entry.status, power_w: entry.power_w, agrees: false,
  });
  ha.warn(text);
  await notifier.notify('problem', on ? 'Charger did not start' : 'Charger did not pause', text, { key: `noreact:${on}`, minGapMs: 60 * 60000 });
}

// Live control: send the start/stop command the decision needs. The same
// command is not repeated within 15 minutes, so a charger that does not
// react is not flooded.
const LIVE_RETRY_MS = 15 * 60000;
let lastLiveSend = null; // { key, at }

// After a start you asked for (Charge now, manual test), the app does not
// pause the charger for a few minutes, whatever a calculation says. Only
// unplugging ends it earlier.
const MANUAL_GRACE_MS = 3 * 60000;
let lastManual = null; // { on, at }

async function sendLive(entry, chosen) {
  const c = entry.commands.find((x) => x.what === 'start charging' || x.what === 'pause charging');
  if (!c) return;
  if (lastManual && Date.now() - lastManual.at < MANUAL_GRACE_MS && (c.what === 'start charging') !== lastManual.on) {
    entry.held = true;
    ha.debug('Not sending', c.what, '- you', lastManual.on ? 'started' : 'stopped', 'charging less than 3 minutes ago');
    return;
  }
  const key = JSON.stringify([c.service, c.data, c.target]);
  if (lastLiveSend && lastLiveSend.key === key && Date.now() - lastLiveSend.at < LIVE_RETRY_MS) {
    entry.waiting = true;
    return;
  }
  lastLiveSend = { key, at: Date.now() };
  const line = { ...entry, time: Date.now(), live: true, commands: [c], sent: false };
  try {
    await ha.sendControl(c, controller.allowedFor(chosen && chosen.start_stop));
    line.sent = true;
    entry.sent = true;
  } catch (err) {
    line.error = err.message;
    entry.error = err.message;
    ha.warn('Could not', c.what, '-', err.message);
  }
  entry.sent_at = line.time;
  controller.logSent(line);
  const on = c.what === 'start charging';
  if (line.sent) await afterSent(on, c, entry.reason, entry.block_end ? ` until ${hmLocal(entry.block_end)}` : '');
  else await commandFailed(on, line.error);
}

// The methods the user chose, or the recommended ones.
function chosenMethods(methods, rules) {
  if (!methods || !methods.available) return null;
  const pick = (list, id, fallback) => {
    if (id === 'none') return null;
    return (id && list.find((m) => m.id === id)) || fallback;
  };
  return {
    start_stop: pick(methods.start_stop, rules.start_stop_id, methods.recommended.start_stop),
    current: pick(methods.current, rules.current_id, methods.recommended.current),
  };
}

routes['GET /api/control'] = async () => {
  const s = settings.load();
  if (!planCache) await refreshPlan('on request').catch(() => {});
  else if (!lastDryRun) await runDryRun(planCache.result).catch(() => {});
  const charger = s.chargers[0] || null;
  const methods = charger ? await currentControlMethods(charger).catch(() => null) : null;
  const rules = { ...controller.DEFAULT_RULES, ...(s.control || {}) };
  const states = await ha.call({ type: 'get_states' });
  const opt = (x) => ({ entity_id: x.entity_id, name: (x.attributes && x.attributes.friendly_name) || x.entity_id, state: x.state });
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    time_zone: ha.state.timeZone,
    currency: ha.state.currency,
    control_allowed: options.allow_control,
    rules,
    methods: methods && methods.available ? {
      start_stop: methods.start_stop,
      current: methods.current,
      recommended: { start_stop: methods.recommended.start_stop && methods.recommended.start_stop.id, current: methods.recommended.current && methods.recommended.current.id },
      warnings: methods.warnings,
    } : null,
    options: {
      min_soc: states.filter((x) => /^(number|sensor|input_number)\./.test(x.entity_id) && x.attributes && x.attributes.unit_of_measurement === '%').map(opt).sort(byName),
      preheat: states.filter((x) => /^(input_boolean|switch|binary_sensor)\./.test(x.entity_id) &&
        (x.entity_id.startsWith('input_boolean.') || /preheat|precondition|climate|hvac|airco|voorverwarm|verwarm|condition/.test(x.entity_id))).map(opt).sort(byName),
    },
    now: lastDryRun,
    chosen_start_stop: (() => {
      const c = chosenMethods(methods, rules);
      const cmd = c && controller.startStopCommand(c.start_stop, true, methods && methods.device_id);
      return cmd ? cmd.service + (cmd.target && cmd.target.entity_id ? ` → ${cmd.target.entity_id}` : '') : null;
    })(),
    log: controller.recentLog(150),
  };
};

// Setup wizard: what is set up, and whether the user finished the wizard.
routes['GET /api/setup'] = async () => {
  const s = settings.load();
  const has = { vehicle: s.vehicles.length > 0, charger: s.chargers.length > 0, grid: s.grid.length > 0, prices: !!s.prices };
  // Set up before the wizard existed: counts as done.
  const done = s.setup_done === true || (s.setup_done == null && has.vehicle && has.charger && has.prices);
  return { ...has, done };
};

routes['POST /api/setup'] = async (req) => {
  const body = await readBody(req);
  const s = settings.load();
  s.setup_done = body.done === true;
  settings.save(s);
  return { ok: true, done: s.setup_done };
};

// Notify actions that exist in Home Assistant, for the choice list.
async function notifyOptions() {
  const services = await ha.call({ type: 'get_services' });
  const n = (services && services.notify) || {};
  return Object.keys(n)
    .filter((k) => k !== 'send_message') // needs a notify entity, not usable like this
    .map((k) => ({ id: `notify.${k}`, name: (n[k] && n[k].name) || k }))
    .sort((a, b) => (a.id.startsWith('notify.mobile_app_') ? 0 : 1) - (b.id.startsWith('notify.mobile_app_') ? 0 : 1) || a.id.localeCompare(b.id));
}

routes['GET /api/notify'] = async () => {
  let choices = [];
  try {
    choices = await notifyOptions();
  } catch (err) {
    ha.warn('Could not list notify actions:', err.message);
  }
  return { ...notifier.status(), choices };
};

routes['POST /api/notify'] = async (req) => {
  const body = await readBody(req);
  const id = String(body.service || '').trim();
  if (id) {
    const choices = await notifyOptions();
    if (!choices.some((c) => c.id === id)) throw badRequest('Choose a notify action from the list');
  }
  const s = settings.load();
  s.notify = { service: id || null };
  settings.save(s);
  notifier.target();
  ha.log(id ? `Notifications go to ${id}` : 'Notifications chosen in the app switched off');
  return notifier.status();
};

routes['POST /api/notify/test'] = async () => {
  if (!notifier.target()) throw badRequest('Choose a notify action first');
  const r = await notifier.notify('problem', 'Smart Charging test', 'This is a test notification from Smart Charging Planner.');
  if (!r.sent) throw badRequest(`Not sent: ${r.error || r.reason}`);
  return { ok: true };
};

routes['DELETE /api/control/log'] = async () => {
  controller.clearLog();
  ha.log('Control log cleared');
  return { ok: true };
};

routes['POST /api/control/settings'] = async (req) => {
  const b = await readBody(req);
  const num = (v, name, min, max, allowEmpty = false) => {
    if (allowEmpty && (v === '' || v == null)) return null;
    const n = Number(v);
    if (!(n >= min && n <= max)) throw badRequest(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const ent = (v, re) => (v && re.test(String(v)) ? String(v) : null);
  const s = settings.load();
  s.control = {
    start_stop_id: b.start_stop_id ? String(b.start_stop_id).slice(0, 200) : null,
    current_id: b.current_id ? String(b.current_id).slice(0, 200) : null,
    min_soc_enabled: b.min_soc_enabled === true,
    min_soc: num(b.min_soc, 'Minimum battery level', 0, 100),
    min_soc_entity: ent(b.min_soc_entity, /^(number|sensor|input_number)\./),
    min_soc_max_price: num(b.min_soc_max_price, 'Maximum price for the minimum', -1, 5, true),
    preheat_entity: ent(b.preheat_entity, /^(input_boolean|switch|binary_sensor)\./),
    force_minutes: num(b.force_minutes, 'Force window', 0, 600),
    hysteresis: num(b.hysteresis, 'Hysteresis', 0, 1),
  };
  settings.save(s);
  lastDryRun = null;
  return { ok: true, control: s.control };
};

function startBackgroundRefresh() {
  if (refreshTimer) return;
  const every = options.refresh_minutes * 60000;
  ha.log(`Background refresh every ${options.refresh_minutes} minute(s)`);
  refreshPlan('start').catch(() => {});
  refreshTimer = setInterval(() => {
    if (ha.state.connected) refreshPlan('timer').catch(() => {});
  }, every);
  // With control on, check the charger every minute between plan refreshes,
  // so plugging in or the start of a planned period is followed quickly.
  if (options.allow_control === true && every > 60000) {
    setInterval(() => {
      if (ha.state.connected && planCache && !planRunning) {
        runDryRun(planCache.result).catch((err) => ha.warn('Control step failed:', err.message));
      }
    }, 60000);
  }
}

// Maximum charging current: the lowest of the followed limit sensors and the
// manually entered value. Falls back to the manual value when sensors are
// unavailable.
function effectiveMaxCurrent(charger, states) {
  const values = [];
  for (const id of charger.max_current_entities || []) {
    const s = states.find((x) => x.entity_id === id);
    const n = s ? Number(s.state) : NaN;
    if (Number.isFinite(n) && n > 0) values.push({ amps: n, source: id, name: (s.attributes && s.attributes.friendly_name) || id });
  }
  if (charger.max_current > 0) values.push({ amps: charger.max_current, source: 'manual', name: 'set manually' });
  if (!values.length) return { amps: null, source: null };
  values.sort((a, b) => a.amps - b.amps);
  return values[0];
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Validate price settings sent by the page.
function priceConfigFrom(body) {
  const src = body.source || {};
  let source;
  if (src.type === 'action') {
    if (!ACTION_SOURCES[src.domain] || !src.config_entry) throw badRequest('Invalid price source');
    source = { id: `action:${src.domain}:${src.config_entry}`, type: 'action', domain: src.domain, config_entry: String(src.config_entry), name: String(src.name || src.domain).slice(0, 80) };
  } else if (src.type === 'attribute') {
    if (!String(src.entity_id || '').startsWith('sensor.')) throw badRequest('Invalid price sensor');
    source = { id: `attr:${src.entity_id}`, type: 'attribute', domain: src.domain || null, entity_id: src.entity_id, name: String(src.name || src.entity_id).slice(0, 80) };
  } else {
    throw badRequest('Choose a price source');
  }
  const types = ['market_excl_vat', 'market_incl_vat', 'all_in'];
  const num = (v, name, min, max) => {
    const n = v === '' || v == null ? 0 : Number(v);
    if (!(n >= min && n <= max)) throw badRequest(`${name} must be between ${min} and ${max}`);
    return n;
  };
  return {
    source,
    price_type: types.includes(body.price_type) ? body.price_type : 'market_excl_vat',
    purchase_fee: num(body.purchase_fee, 'Purchase fee', -1, 1),
    energy_tax: num(body.energy_tax, 'Energy tax', 0, 1),
    vat_percent: num(body.vat_percent ?? 21, 'VAT', 0, 50),
  };
}

// ---------------------------------------------------------------------------
// Web server (served through Home Assistant ingress)
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];

  if (route) {
    if (url.pathname !== '/api/status' && !ha.state.connected) {
      sendJson(res, 503, { error: 'Not connected to Home Assistant' });
      return;
    }
    try {
      const body = await route(req);
      if (req.method !== 'GET' && url.pathname !== '/api/boost/preview') planCache = null; // settings changed: plan is outdated
      sendJson(res, 200, body);
    } catch (err) {
      ha.log('Error on', req.method, url.pathname, '-', err.message);
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  ha.log(`Smart Charging Planner ${APP_VERSION} listening on port ${PORT}`);
  ha.onConnect(startBackgroundRefresh);
  ha.connect();
});

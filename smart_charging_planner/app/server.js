'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');
const { detectVehicles, percentSensors } = require('./vehicles');
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
    const powerKw = chargePowerKw(phases, maxCurrent);

    // House load: less room for the charger when the house uses more.
    const grid = s.grid[0] || null;
    let houseLoad = { available: false, reason: planning.use_house_load === false ? 'off' : 'no_grid' };
    if (grid && planning.use_house_load !== false) {
      houseLoad = await houseLoadProfile(grid, charger, tz, now);
      if (houseLoad.available) {
        const opts = { profile: houseLoad.profile, mainFuse: grid.main_fuse, phases, chargerMax: maxCurrent || 16 };
        prices = prices.map((p) => {
          const a = availableForBlock(p.start, tz, opts);
          return { ...p, power_kw: a.power_kw, amps: a.amps };
        });
      }
    }
    const targetSoc = departure ? departure.soc : dep.default_soc;
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

    return {
      time_zone: tz,
      currency: ha.state.currency,
      now,
      missing,
      price_error: priceError,
      calendar_error: calendarError,
      planning: { ...planning, target_soc: targetSoc },
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
      prices: prices.map((p) => ({ start: p.start, end: p.end, total: p.total, power_kw: p.power_kw, amps: p.amps })),
      house_load: houseLoad.available ? {
        available: true,
        profile: houseLoad.profile.map((w) => Math.round(w)),
        days: houseLoad.days,
        charger_subtracted: houseLoad.charger_subtracted,
        main_fuse: grid.main_fuse,
      } : { available: false, reason: houseLoad.reason },
      plan: { ...plan, periods: periods(plan.blocks) },
      control_allowed: options.allow_control,
    };
  },

  'POST /api/planning': async (req) => {
    const body = await readBody(req);
    const loss = body.loss_percent === '' || body.loss_percent == null ? 10 : Number(body.loss_percent);
    if (!(loss >= 0 && loss <= 30)) throw badRequest('Charging loss must be between 0 and 30 %');
    const minSplit = body.min_split_saving === '' || body.min_split_saving == null ? 0.5 : Number(body.min_split_saving);
    if (!(minSplit >= 0 && minSplit <= 20)) throw badRequest('Minimum saving must be between 0 and 20');
    const s = settings.load();
    s.planning = {
      ...s.planning,
      loss_percent: loss,
      use_house_load: body.use_house_load === true || body.use_house_load === 'on',
      continuous: body.continuous === true || body.continuous === 'on',
      min_split_saving: minSplit,
    };
    settings.save(s);
    return { ok: true, planning: s.planning };
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
let planCache = null; // { at, result }
let planRunning = null;
let refreshTimer = null;

function refreshPlan(reason) {
  if (planRunning) return planRunning;
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
  });
  ha.debug('Dry run:', lastDryRun.want, lastDryRun.reason, lastDryRun.commands.map((c) => c.what).join(', ') || 'no commands');
  return lastDryRun;
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
    log: controller.recentLog(150),
  };
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
      if (req.method !== 'GET') planCache = null; // settings changed: plan is outdated
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

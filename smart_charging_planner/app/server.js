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
const { detectPriceSources, fetchPrices, summarise, totalPrice, localTimeOn, ACTION_SOURCES } = require('./prices');
const { chargePowerKw, energyNeededKwh, nextDeadline, planCharging, periods } = require('./planner');

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
      allow_control: options.allow_control,
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
    if (!body.soc_entity || !String(body.soc_entity).startsWith('sensor.')) {
      const err = new Error('A battery (SoC) sensor is required');
      err.status = 400;
      throw err;
    }
    const capacity = body.capacity_kwh === '' || body.capacity_kwh == null
      ? null : Number(body.capacity_kwh);
    if (capacity !== null && !(capacity > 0 && capacity < 300)) {
      const err = new Error('Battery capacity must be between 0 and 300 kWh');
      err.status = 400;
      throw err;
    }
    const vehicle = {
      name: String(body.name || 'My vehicle').slice(0, 60),
      device_id: body.device_id || null,
      integration: body.integration || null,
      soc_entity: body.soc_entity,
      range_entity: body.range_entity || null,
      charging_entity: body.charging_entity || null,
      plugged_entity: body.plugged_entity || null,
      capacity_kwh: capacity,
    };
    const s = settings.load();
    s.vehicles = [vehicle];
    settings.save(s);
    ha.log('Saved vehicle', vehicle.name, vehicle.soc_entity);
    return { ok: true, vehicle };
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
    const socValue = vehicle ? valueOf(states, vehicle.soc_entity) : null;
    const soc = socValue ? Number(socValue.state) : NaN;
    const plugged = vehicle && vehicle.plugged_entity ? valueOf(states, vehicle.plugged_entity) : null;

    const planning = s.planning;
    const maxCurrent = charger && charger.max_current ? charger.max_current : null;
    const powerKw = chargePowerKw(charger ? charger.phases : 3, maxCurrent);
    const neededKwh = vehicle ? energyNeededKwh(soc, planning.target_soc, vehicle.capacity_kwh, planning.loss_percent) : null;
    const deadline = nextDeadline(planning.ready_by, tz, now, localTimeOn);
    const plan = planCharging({ prices, now, deadline, neededKwh, powerKw });

    return {
      time_zone: tz,
      currency: ha.state.currency,
      now,
      missing,
      price_error: priceError,
      planning,
      vehicle: vehicle ? {
        name: vehicle.name,
        soc: Number.isFinite(soc) ? soc : null,
        soc_state: socValue ? socValue.state : null,
        capacity_kwh: vehicle.capacity_kwh,
        plugged: plugged ? plugged.state : null,
      } : null,
      charger: charger ? { name: charger.name, phases: charger.phases, max_current: charger.max_current } : null,
      assumed_current: maxCurrent ? null : 16,
      prices: prices.map((p) => ({ start: p.start, end: p.end, total: p.total })),
      plan: { ...plan, periods: periods(plan.blocks) },
      control_allowed: options.allow_control,
    };
  },

  'POST /api/planning': async (req) => {
    const body = await readBody(req);
    const target = Number(body.target_soc);
    const loss = body.loss_percent === '' || body.loss_percent == null ? 10 : Number(body.loss_percent);
    if (!(target >= 10 && target <= 100)) throw badRequest('Target must be between 10 and 100 %');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.ready_by || ''))) throw badRequest('Ready by must be a time like 07:00');
    if (!(loss >= 0 && loss <= 30)) throw badRequest('Charging loss must be between 0 and 30 %');
    const s = settings.load();
    s.planning = { target_soc: target, ready_by: body.ready_by, loss_percent: loss };
    settings.save(s);
    return { ok: true, planning: s.planning };
  },
};

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
      sendJson(res, 200, await route(req));
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
  ha.connect();
});

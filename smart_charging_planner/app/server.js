'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const settings = require('./settings');
const { detectVehicles, percentSensors } = require('./vehicles');
const { detectChargers, manualChargerOptions } = require('./chargers');

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
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
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

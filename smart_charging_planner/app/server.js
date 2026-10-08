'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');
const { detectVehicles, percentSensors, findChargeLimit, isChargeLimit } = require('./vehicles');
const activecar = require('./activecar');
const MAX_VEHICLES = 6;
const MAX_CHARGERS = 4;
const { detectChargers, manualChargerOptions } = require('./chargers');
const { detectGridMeters, detectLoadBalancers, manualGridOptions } = require('./grid');
const { detectPriceSources, fetchPrices, fetchForecast, summarise, totalPrice, isoLocal, parseLocal, localDate, localDateTime, tzParts, ACTION_SOURCES } = require('./prices');
const { DAYS, normalise, collect, winnersPerDay, nextDeparture, calendarTrips } = require('./departures');
const { chargePowerKw, energyNeededKwh, planCharging, planStaged, planCare, periods } = require('./planner');
const { evaluateReadyGuard } = require('./reliability');
const tripcost = require('./tripcost');
const sharing = require('./sharing');
const { houseLoadProfile, availableForBlock } = require('./houseload');
const { computeSavings } = require('./savings');
const { buildTripEvents, markDuplicates, toHaData } = require('./trips');
const { checkControl } = require('./control');
const controller = require('./controller');
const session = require('./session');
const { learnedPower } = require('./chargepower');
const boost = require('./boost');
const chargefor = require('./chargefor');
const equalizer = require('./equalizer');
const diagnostics = require('./diagnostics');
const cardata = require('./cardata');
const solar = require('./solar');
const solarctl = require('./solarctl');
const chargeMode = require('./mode');
const battery = require('./battery');
const { planBattery } = require('./batteryplan');
const notifier = require('./notify');
const { validateImportSettings } = require('./importschema');

const PORT = Number(process.env.SCP_PORT) || 8099; // SCP_PORT: tests only
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
]);
const APP_VERSION = require('./package.json').version;
require('./tripcost').setUserAgent(APP_VERSION);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Read a JSON object body: at most 100 kB, and it must be a plain object.
const MAX_BODY = 100000;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (status, message) => {
      if (done) return;
      done = true;
      const err = new Error(message);
      err.status = status;
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(413, 'Request too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => fail(400, 'Request failed'));
    req.on('end', () => {
      if (done) return;
      let body = {};
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          fail(400, 'Invalid JSON');
          return;
        }
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        fail(400, 'Expected a JSON object');
        return;
      }
      done = true;
      resolve(body);
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
    writable: /^number\./.test(id) && st.attributes && st.attributes.unit_of_measurement === '%',
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
// Per charger (scope.js): the plan, the control state and what was sent last.
//   planCache { at, result } · planRunning / rerunAfter (a refresh in progress)
//   controlMethods { at, key, result } · lastDryRun (the last decision)
//   lastLiveSend { key, at } · lastManual { on, at } · pendingCheck { on, at, service }
//   lastCurrent { amps, at } · lastPhases { phases, at } · lastLimitSend { value, at, tries, vehicle_id }
//   solarState (solarctl) · lastCommandInfo (status sensor) · savingsCache · conflictsCache
const scope = require('./scope');
const ST = scope.store(() => ({
  savingsCache: null,
  lastLimitSend: null,
  planCache: null,
  planRunning: null,
  rerunAfter: null,
  controlMethods: null,
  lastDryRun: null,
  solarState: solarctl.initialState(),
  lastCurrent: null,
  lastPhases: null,
  pendingCheck: null,
  lastCommandInfo: null,
  lastLiveSend: null,
  lastManual: null,
  conflictsCache: null,
}));

// ---------------------------------------------------------------------------
// More than one car (activecar.js decides which one is connected).

// "I have more than one car" (Settings › Vehicle) is off by default: then
// only the first car counts and the app works as with one car.
function cars(s) {
  return s.multi_car === true ? s.vehicles : s.vehicles.slice(0, 1);
}

// "I have more than one charger" (Settings › Charger), off by default: then
// only the first charger counts.
function chargersList(s) {
  return s.multi_charger === true ? s.chargers : s.chargers.slice(0, 1);
}

// The charger of the current scope (scope.js): the charger a request or a
// control step is for. Without more chargers: the first one.
function currentCharger(s) {
  const list = chargersList(s);
  scope.setPrimary(list.length ? list[0].id : null);
  return list.find((c) => c.id === scope.id()) || list[0] || null;
}

// More chargers: the start/stop and current methods belong to a charger; the
// first charger keeps them in the rules (as before), another on itself.
function rulesFor(s, charger = currentCharger(s)) {
  const rules = { ...controller.DEFAULT_RULES, ...(s.control || {}) };
  const first = chargersList(s)[0];
  if (charger && first && charger.id !== first.id) {
    const m = charger.methods || {};
    rules.start_stop_id = m.start_stop_id || null;
    rules.current_id = m.current_id || null;
  }
  return rules;
}

// Notifications and sensors say which charger (more chargers only).
notifier.setChargerContext(() => {
  const s = settings.load();
  const list = chargersList(s);
  if (list.length <= 1) return null;
  const c = currentCharger(s);
  if (!c) return null;
  const slug = String(c.name || c.id).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || c.id;
  return { name: c.name || c.id, slug, primary: c.id === list[0].id };
});

// The connected car (or the car the app plans for), as the last plan saw it.
function currentVehicle(s) {
  return activecar.vehicleFrom({ vehicles: cars(s) });
}

// The car as the control sees it. With more than one car, "plugged in" comes
// from the charger status: a car's own plug sensor also says "plugged in" at
// a public charger.
function plugView(s, vehicle, charger) {
  if (!vehicle) return null;
  if (cars(s).length > 1 && charger && charger.status_entity) return { ...vehicle, plugged_entity: null };
  return vehicle;
}

// Pick the connected car from the states (and remember it for the rest).
// More chargers: a car another charger has (its usual car, plugged in there,
// or the car you chose there) is not a candidate here.
function pickVehicle(s, states, now = Date.now()) {
  const charger = currentCharger(s);
  const bare = controller.readActual({ vehicle: null, charger, states, now });
  let chargerPlugged = bare.plugged;
  let list = cars(s);
  if (chargerPlugged == null && list.length === 1) chargerPlugged = controller.readActual({ vehicle: list[0], charger, states, now }).plugged;
  let preferred = null;
  const chargers = chargersList(s);
  if (chargers.length > 1 && charger) {
    preferred = list.some((v) => v.id === charger.vehicle_id) ? charger.vehicle_id : null;
    const taken = new Set();
    for (const other of chargers) {
      if (other.id === charger.id) continue;
      const plugged = controller.readActual({ vehicle: null, charger: other, states, now }).plugged;
      const u = list.find((v) => v.id === other.vehicle_id);
      if (plugged === true && u && activecar.readBool(states, u.plugged_entity) === true && u.id !== preferred) taken.add(u.id);
      const chosen = scope.run(other.id, () => activecar.choice());
      if (chosen && plugged !== false) taken.add(chosen.id);
      // The car that charger found by its plug sensor.
      const seen = scope.run(other.id, () => activecar.lastPick());
      if (plugged === true && seen && seen.vehicle_id && ['sensor', 'charging_sensor', 'no_other', 'chosen'].includes(seen.how)) taken.add(seen.vehicle_id);
    }
    const rest = list.filter((v) => !taken.has(v.id));
    if (rest.length) list = rest;
  }
  return activecar.pick(list, states, { chargerPlugged, chargerCharging: bare.charging, now, preferred });
}

// ---------------------------------------------------------------------------
// Looking ahead: after the current departure, what is the next goal, and what
// will the car need for it? The trip's cost comes from the destination in the
// calendar (tripcost.js); the expected charging is a plan from the moment the
// car is back. Shown on Home in orange; it never steers anything.

const RETURN_TITLE = /^\s*(naar\s+(huis|thuis)|terug|home|back home|to home)\b/i;
function isReturnTrip(t) {
  if (!t) return false;
  if (tripcost.isHome(t.location) || RETURN_TITLE.test(t.title || '')) return true;
  // Your own home address as location (within 1 km of the home in Home Assistant).
  return !!t.location && tripcost.distance(t.location).status === 'home';
}

function lookAhead({ dep, events, tz, now, states, vehicle, mode, soc, targetSoc, neededKwh, plan, powerKw, prices, planning, departure, carCtxNow }) {
  if (!departure || !vehicle) return null;
  const all = collect(dep, { states, events, tz, now, days: 8, cars: carCtxNow }).sort((a, b) => a.time - b.time);
  const trips = calendarTrips(dep, events, tz, now, carCtxNow);
  const cur = departure.source === 'calendar' ? trips.find((t) => t.time === departure.time) || departure : departure;
  // The level when the car leaves: the target when the plan gets there.
  let socAtDep = Number.isFinite(soc) ? soc : null;
  if (socAtDep != null && Number.isFinite(targetSoc) && targetSoc > socAtDep) {
    const share = neededKwh > 0 ? Math.min(1, (plan.planned_kwh || 0) / neededKwh) : 1;
    socAtDep = Math.round((socAtDep + (targetSoc - socAtDep) * share) * 10) / 10;
  }
  // The way back: the very next calendar trip, when that is a trip home (within
  // 36 hours). Another trip first (for example to work the next morning)
  // means this trip has no trip home in the calendar: there and back.
  const following = cur.location && !tripcost.isHome(cur.location)
    ? trips.find((t) => t.time > cur.time && t.time < cur.time + 36 * 3600000) : null;
  const back = following && isReturnTrip(following) ? following : null;
  const trip = cur.location && mode !== 'fixed_kwh'
    ? tripcost.tripCost({ location: cur.location, returnLocation: back ? back.location || 'thuis' : undefined, vehicle, states, soc: Number.isFinite(soc) ? soc : socAtDep })
    : { status: 'unknown', reason: 'no_location', pct: null };
  const startOf = (t) => t.event_start || t.time;
  const returnAt = back ? (back.event_end || startOf(back) + 3600000)
    : cur.event_end || startOf(cur) + 3600000;
  const socAfter = socAtDep != null && trip.pct != null ? Math.max(0, Math.round((socAtDep - trip.pct) * 10) / 10) : socAtDep;
  // The next goal: the first departure after the car is back that is not the way home.
  const nextDep = all.find((x) => x.time > returnAt && !(x.source === 'calendar' && isReturnTrip(trips.find((t) => t.time === x.time))));
  const out = {
    current: {
      time: departure.time,
      title: departure.title || cur.title || null,
      location: cur.location || null,
      target_soc: departure.soc,
      soc_at_departure: socAtDep,
    },
    trip: { ...trip, return_trip: back ? { title: back.title, time: back.time } : null, return_at: returnAt, soc_after: socAfter },
    goal: null,
    expected: null,
  };
  if (!nextDep) return out;
  const nt = nextDep.source === 'calendar' ? trips.find((t) => t.time === nextDep.time) : null;
  out.goal = { time: nextDep.time, soc: nextDep.soc, source: nextDep.source, title: nextDep.title || (nt && nt.title) || null, location: nt ? nt.location : null };
  if (socAfter == null || !(vehicle.capacity_kwh > 0)) return out;
  const need = energyNeededKwh(socAfter, nextDep.soc, vehicle.capacity_kwh, planning.loss_percent);
  const after = prices.filter((p) => p.end > returnAt && p.start < nextDep.time);
  const exp = need > 0.01 && after.length
    ? planCharging({ prices: after, now: Math.max(now, returnAt), deadline: nextDep.time, neededKwh: need, powerKw, continuous: planning.continuous !== false, minSplitSaving: Number(planning.min_split_saving) || 0 })
    : null;
  const lastKnown = prices.length ? prices[prices.length - 1].end : now;
  out.expected = {
    soc_from: socAfter,
    soc_to: nextDep.soc,
    needed_kwh: Math.round(need * 10) / 10,
    below_goal: socAfter < nextDep.soc - 0.5,
    prices_known: lastKnown >= nextDep.time, // with the price forecast when there is one
    uses_forecast: !!(exp && exp.blocks.some((b) => b.forecast)),
    blocks: exp ? exp.blocks.map((b) => ({ ...b, expected: true })) : [],
    periods: exp ? periods(exp.blocks) : [],
    planned_kwh: exp ? exp.planned_kwh : 0,
    cost: exp && exp.blocks.length ? exp.cost : null,
  };
  return out;
}

// Learning the car's use from trips (tripcost.js): when the car is unplugged
// around a departure with a known distance, and when it is plugged in again.
const tripWatch = new Map(); // vehicle id -> { plugged }
function tripLearning(vehicle, plugged, soc, carData, next, now) {
  if (!vehicle || !vehicle.id || plugged == null) return;
  const w = tripWatch.get(vehicle.id) || { plugged: null };
  const live = !(carData && carData.ok === false) && Number.isFinite(soc);
  if (w.plugged === true && plugged === false && live && next && next.trip && next.trip.status === 'ok'
    && Math.abs(next.current.time - now) < 3 * 3600000) {
    tripcost.tripStarted(vehicle.id, soc, (next.trip.km || 0) + (next.trip.back_km || 0), now);
  }
  if (w.plugged === false && plugged === true && live) tripcost.tripEnded(vehicle.id, soc, now);
  tripWatch.set(vehicle.id, { plugged });
}

// Departures: shared by all cars, unless a car has its own (more cars only).
function ownDepartures(vehicle, s) {
  return !!(s && s.multi_car === true && vehicle && vehicle.own_departures === true);
}
function departuresFor(s, vehicle) {
  return ownDepartures(vehicle, s) ? normalise(vehicle.departures, s.planning) : normalise(s.departures, s.planning);
}
function setDeparturesFor(s, vehicle, dep) {
  const v = vehicle && s.vehicles.find((x) => x.id === vehicle.id);
  if (ownDepartures(v, s)) v.departures = dep;
  else s.departures = dep;
}
// Calendar trips with "auto:"/"car:" are only for that car (more cars).
function carCtx(s, vehicle) {
  const list = cars(s);
  return list.length > 1 && vehicle ? { vehicle, list } : null;
}

// ?vehicle=… (or body.vehicle_id): that car; else the connected car.
function vehicleParam(s, id) {
  if (id) {
    const v = cars(s).find((x) => x.id === String(id));
    if (!v) throw badRequest('That car is not in the app (any more)');
    return v;
  }
  return currentVehicle(s);
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
      refresh_minutes: options.refresh_minutes,
      last_refresh: ST().planCache ? ST().planCache.at : null,
      allow_control: options.allow_control,
      allow_battery_control: options.allow_battery_control === true,
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
    const all = settings.load();
    const saved = all.vehicles;
    const states = ha.state.connected ? await ha.call({ type: 'get_states' }) : [];
    return {
      multi_car: all.multi_car === true,
      max_vehicles: MAX_VEHICLES,
      vehicles: saved.map((v, i) => ({
        used: all.multi_car === true || i === 0,
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

  // Save a vehicle. With id: change that car. With add: a new car next to
  // the others. Neither (older pages, the setup wizard): the first car.
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
      device_id: body.device_id ? String(body.device_id).slice(0, 64) : null,
      integration: body.integration ? String(body.integration).slice(0, 40) : null, // shown only; control uses the registry
      soc_entity: mode === 'sensor' ? body.soc_entity : null,
      range_entity: body.range_entity || null,
      charging_entity: body.charging_entity || null,
      plugged_entity: String(body.plugged_entity || '').startsWith('binary_sensor.') || String(body.plugged_entity || '').startsWith('sensor.') ? body.plugged_entity : null,
      capacity_kwh: capacity,
      // More cars: the name used in calendar events ("auto: renault" / "car: kia").
      calendar_name: String(body.calendar_name || '').trim().slice(0, 30) || null,
      // Use per 100 km, for trip estimates when there is no range sensor (and before trips are learned).
      consumption_kwh_100km: body.consumption_kwh_100km === undefined || body.consumption_kwh_100km === '' || body.consumption_kwh_100km == null ? null : Number(body.consumption_kwh_100km),
      charge_limit_entity: null, // checked below
      stale_hours: body.stale_hours === undefined || body.stale_hours === '' ? cardata.DEFAULT_STALE_HOURS : Number(body.stale_hours),
    };
    if (!(vehicle.stale_hours >= 0.5 && vehicle.stale_hours <= 48)) throw badRequest('Car data is old after must be between 0.5 and 48 hours');
    if (vehicle.consumption_kwh_100km != null && !(vehicle.consumption_kwh_100km >= 8 && vehicle.consumption_kwh_100km <= 40)) throw badRequest('Use per 100 km must be between 8 and 40 kWh');
    if (body.charge_limit_entity) {
      // SAFETY: only a % entity that looks like a charge limit, on the car's own device.
      const { entities, states } = await loadRegistries();
      const id = String(body.charge_limit_entity);
      const reg = entities.find((e) => e.entity_id === id);
      const st = states.find((x) => x.entity_id === id);
      const sameDevice = !vehicle.device_id || (reg && reg.device_id === vehicle.device_id);
      if (!reg || !st || !sameDevice || !isChargeLimit(reg, st)) throw badRequest("That entity is not the car's charge limit");
      vehicle.charge_limit_entity = id;
    }
    const s = settings.load();
    const idx = body.id ? s.vehicles.findIndex((v) => v.id === String(body.id)) : -1;
    if (body.id && idx < 0 && !body.add) throw badRequest('That car is not in the app (any more)');
    if (body.add && s.multi_car !== true && s.vehicles.length) throw badRequest('Turn on "I have more than one car" first');
    if (body.add && s.vehicles.length >= MAX_VEHICLES) throw badRequest(`At most ${MAX_VEHICLES} cars`);
    if (idx >= 0) {
      // Keep what is not on this form: the car's own departures.
      const old = s.vehicles[idx];
      s.vehicles[idx] = { ...vehicle, id: old.id, own_departures: old.own_departures === true, departures: old.departures };
    } else if (body.add || !s.vehicles.length) {
      s.vehicles.push(vehicle);
    } else {
      const old = s.vehicles[0];
      s.vehicles[0] = { ...vehicle, id: old.id, own_departures: old.own_departures === true, departures: old.departures };
    }
    settings.vehicleIds(s.vehicles);
    settings.save(s);
    const saved = s.vehicles[idx >= 0 ? idx : body.add ? s.vehicles.length - 1 : 0];
    ST().planCache = null;
    ha.log('Saved vehicle', saved.name, saved.soc_entity);
    return { ok: true, vehicle: saved };
  },

  // Battery level entered by the user (cars without integration).
  'POST /api/vehicle/soc': async (req) => {
    const body = await readBody(req);
    const v = Number(body.soc);
    if (!(v >= 0 && v <= 100)) throw badRequest('Battery level must be between 0 and 100 %');
    session.setManualSoc(v);
    return { ok: true };
  },

  // ?id=…: remove that car. Without id: all cars.
  'DELETE /api/vehicles': async (req) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const s = settings.load();
    if (id) {
      if (!s.vehicles.some((v) => v.id === id)) throw badRequest('That car is not in the app (any more)');
      s.vehicles = s.vehicles.filter((v) => v.id !== id);
      if (activecar.choice() && activecar.choice().id === id) activecar.choose(null);
    } else {
      s.vehicles = [];
      activecar.choose(null);
    }
    settings.save(s);
    ST().planCache = null;
    return { ok: true };
  },

  // "I have more than one car": on or off. Off: only the first car is used;
  // the other cars stay saved, so turning it on again brings them back.
  'POST /api/vehicles/multi': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    s.multi_car = body.enabled === true;
    if (!s.multi_car) activecar.choose(null);
    settings.save(s);
    ST().planCache = null;
    ha.log(s.multi_car ? 'More than one car: on' : 'More than one car: off');
    return { ok: true, multi_car: s.multi_car };
  },

  // Which car is connected (more than one car): your choice, or automatic.
  'POST /api/vehicles/connected': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    const id = body.vehicle_id ? String(body.vehicle_id) : null;
    if (s.multi_car !== true) throw badRequest('Turn on "I have more than one car" first (Settings › Vehicle)');
    if (id && !cars(s).some((v) => v.id === id)) throw badRequest('That car is not in the app (any more)');
    activecar.choose(id);
    ST().planCache = null;
    ha.log(id ? `Connected car chosen: ${s.vehicles.find((v) => v.id === id).name}` : 'Connected car: automatic again');
    refreshPlan('connected car chosen', { fresh: true }).catch(() => {});
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
    const all = settings.load();
    const saved = all.chargers;
    const states = ha.state.connected ? await ha.call({ type: 'get_states' }) : [];
    return {
      multi_charger: all.multi_charger === true,
      max_chargers: MAX_CHARGERS,
      cars: cars(all).map((v) => ({ id: v.id, name: v.name })),
      chargers: saved.map((c, i) => ({
        ...c,
        used: all.multi_charger === true || i === 0,
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
    // More chargers: the car that is usually on this charger.
    charger.vehicle_id = body.vehicle_id && s.vehicles.some((v) => v.id === String(body.vehicle_id)) ? String(body.vehicle_id) : null;
    // With id: change that charger. With add: a new charger. Neither: the first.
    const idx = body.id ? s.chargers.findIndex((c) => c.id === String(body.id)) : -1;
    if (body.id && idx < 0 && !body.add) throw badRequest('That charger is not in the app (any more)');
    if (body.add && s.multi_charger !== true && s.chargers.length) throw badRequest('Turn on "I have more than one charger" first');
    if (body.add && s.chargers.length >= MAX_CHARGERS) throw badRequest(`At most ${MAX_CHARGERS} chargers`);
    const keep = (old) => ({ ...charger, id: old.id, methods: old.methods, vehicle_id: body.vehicle_id === undefined ? old.vehicle_id || null : charger.vehicle_id });
    if (idx >= 0) s.chargers[idx] = keep(s.chargers[idx]);
    else if (body.add || !s.chargers.length) s.chargers.push(charger);
    else s.chargers[0] = keep(s.chargers[0]);
    settings.chargerIds(s.chargers);
    settings.save(s);
    const saved = s.chargers[idx >= 0 ? idx : body.add ? s.chargers.length - 1 : 0];
    ST().planCache = null;
    ha.log('Saved charger', saved.name);
    return { ok: true, charger: saved };
  },

  // ?id=…: remove that charger. Without id: all chargers.
  'DELETE /api/chargers': async (req) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const s = settings.load();
    if (id) {
      if (!s.chargers.some((c) => c.id === id)) throw badRequest('That charger is not in the app (any more)');
      s.chargers = s.chargers.filter((c) => c.id !== id);
    } else {
      s.chargers = [];
    }
    settings.save(s);
    return { ok: true };
  },

  // "I have more than one charger": on or off. Off: only the first charger is
  // used; the others stay saved.
  'POST /api/chargers/multi': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    s.multi_charger = body.enabled === true;
    settings.save(s);
    ha.log(s.multi_charger ? 'More than one charger: on' : 'More than one charger: off');
    refreshAll(s.multi_charger ? 'more chargers on' : 'more chargers off').catch(() => {});
    return { ok: true, multi_charger: s.multi_charger };
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
    // Always offered: a fixed or day/night tariff, for contracts without dynamic prices.
    const fixed = { id: 'fixed', type: 'fixed', name: 'Fixed or day/night tariff (no dynamic contract)', price_type: 'all_in' };
    return { candidates: [...detectPriceSources(entities, devices, states, ha.state.timeZone), fixed] };
  },

  // Fetch prices with the given (unsaved) settings and summarise them.
  'POST /api/prices/test': async (req) => {
    const cfg = priceConfigFrom(await readBody(req));
    const result = await fetchPrices(cfg.source, ha.state.timeZone);
    return { summary: summarise(result, cfg), forecast: await forecastSummary(cfg, result), time_zone: ha.state.timeZone };
  },

  'GET /api/prices': async () => {
    const cfg = settings.load().prices;
    if (!cfg) return { prices: null };
    try {
      const result = await fetchPrices(cfg.source, ha.state.timeZone);
      return { prices: cfg, summary: summarise(result, cfg), forecast: await forecastSummary(cfg, result), time_zone: ha.state.timeZone };
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
    const charger = currentCharger(s);
    if (!s.prices) missing.push('prices');

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
    // The end of the real prices; a forecast only fills the time after it.
    const realEnd = prices.length ? prices[prices.length - 1].end : null;
    let forecastInfo = null;
    if (s.prices && s.prices.forecast && realEnd) {
      try {
        const fc = await forecastPrices(s.prices, tz, realEnd);
        prices = prices.concat(fc.prices);
        forecastInfo = { entity_id: s.prices.forecast.entity_id, margin: fc.margin, count: fc.prices.length, until: fc.prices.length ? fc.prices[fc.prices.length - 1].end : null };
      } catch (err) {
        forecastInfo = { entity_id: s.prices.forecast.entity_id, error: err.message };
      }
    }

    const states = await ha.call({ type: 'get_states' });
    // More than one car: plan for the connected one.
    const carPick = pickVehicle(s, states, now);
    const vehicle = carPick.vehicle;
    if (!vehicle) missing.push('vehicle');
    const mode = vehicle ? vehicle.mode || 'sensor' : null;
    const socValue = vehicle && mode === 'sensor' ? valueOf(states, vehicle.soc_entity) : null;
    let soc = socValue ? Number(socValue.state) : NaN;
    const plugged = vehicle && vehicle.plugged_entity ? valueOf(states, vehicle.plugged_entity) : null;

    // Cars without integration: follow the session and the energy charged.
    const actualNow = controller.readActual({ vehicle: plugView(s, vehicle, charger), charger, states, now });
    const sess = session.update(actualNow.plugged, now);

    // The car's cloud down (battery level unavailable or not read for a long
    // time): go on from the last good level plus what the charger delivered.
    let carData = null;
    if (vehicle && mode === 'sensor') {
      const st = states.find((x) => x.entity_id === vehicle.soc_entity);
      const h = cardata.check(st, now, vehicle.stale_hours);
      if (h.ok) {
        cardata.remember(vehicle.soc_entity, h.soc, h.at);
        carData = { ok: true };
      } else {
        // The newest of: the last good level, and an old (stale) reading.
        const remembered = cardata.lastGood(vehicle.soc_entity);
        const staleRead = h.reason === 'stale' ? { soc: h.soc, at: h.at } : null;
        const lastGood = [remembered, staleRead].filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
        let kwh = 0;
        let estimate;
        if (lastGood) {
          if (charger && charger.power_entity && vehicle.capacity_kwh > 0) {
            kwh = await session.energySince(charger.power_entity, lastGood.at, now).catch(() => 0);
          }
          const loss = 1 + (Number(s.planning.loss_percent) || 0) / 100;
          estimate = vehicle.capacity_kwh > 0 ? Math.min(100, lastGood.soc + (kwh / loss / vehicle.capacity_kwh) * 100) : lastGood.soc;
        } else {
          // Nothing known: plan carefully, as if the car is at the minimum.
          const rules = rulesFor(s);
          estimate = rules.min_soc_enabled && Number.isFinite(Number(rules.min_soc)) ? Number(rules.min_soc) : 20;
        }
        soc = Math.round(estimate * 10) / 10;
        carData = {
          ok: false,
          reason: h.reason,
          since: lastGood ? lastGood.at : h.at,
          last_soc: lastGood ? lastGood.soc : null,
          kwh_since: Math.round(kwh * 100) / 100,
          estimate: soc,
          assumed: !lastGood,
        };
      }
      carDataChanged(vehicle, carData);
    }
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
    const dep = departuresFor(s, vehicle);
    const { events, error: calendarError } = await calendarEvents(dep, tz, now);
    let departure = nextDeparture(dep, { states, events, tz, now, cars: carCtx(s, vehicle) });
    // "Ready for" a later day: that becomes the departure; a departure before
    // it only gets the minimum battery level.
    let cf = chargefor.current(now);
    // A choice made for a departure that is gone (removed from the calendar or
    // the schedule) ends by itself. Not when the calendar could not be read.
    if (cf && cf.based_on && !calendarError) {
      const days = winnersPerDay(collect(dep, { states, events, tz, now, days: 3, cars: carCtx(s, vehicle) }), tz);
      if (!days.some((d) => d.day === cf.based_on.date)) {
        const what = `${cf.based_on.title || SOURCE_LABEL[cf.based_on.source] || 'departure'} on ${cf.based_on.date}`;
        chargefor.clear(`the departure it was chosen for is gone: ${what}`);
        controller.clearLock();
        notifier.notify('problem', 'Ready-for choice ended', `The departure it was chosen for (${what}) is no longer planned. The car is planned for the next departure again.`, { key: 'chargefor_gone', minGapMs: 60000 }).catch(() => {});
        cf = null;
      }
    }
    let interim = null;
    if (cf) {
      interim = departure && departure.time < cf.until - 60000 ? departure : null;
      departure = { time: cf.until, soc: cf.soc, source: 'choice', title: cf.day === 'tomorrow' ? 'Ready tomorrow' : 'Ready the day after tomorrow' };
    }

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
    // Solar: the expected surplus per block, at the value of your own solar
    // power (what exporting would earn).
    const sol = s.solar && s.solar.enabled ? s.solar : null;
    const cm = chargeMode.current(!!sol);
    let solarInfo = sol ? { enabled: true, mode: cm, max_soc: sol.max_soc } : { enabled: false, mode: 'plan' };
    if (sol && cm !== 'plan' && prices.length) {
      try {
        const fc = await solarForecastCached(sol, states);
        const factor = Number(sol.forecast_factor) || 0.8;
        const baseW = Number(sol.house_base_w) || 0;
        const typeOf = (p) => (p.forecast && s.prices.forecast ? s.prices.forecast.price_type || s.prices.price_type : s.prices.price_type);
        let todayKwh = 0;
        const dayEnd = prices[0] ? prices[0].start + 24 * 3600000 : now;
        prices = prices.map((p) => {
          const wh = fc.hours.get(Math.floor(p.start / 3600000) * 3600000) || 0;
          const pvKw = (wh / 1000) * factor;
          if (p.start < dayEnd && p.end > now) todayKwh += pvKw * ((p.end - p.start) / 3600000);
          const houseW = houseLoad.available ? houseLoad.profile[tzParts(p.start, tz).h] || 0 : baseW;
          const surplus = Math.max(0, pvKw - houseW / 1000);
          return { ...p, solar_kw: surplus, solar_price: solar.feedInValue(p.price, typeOf(p), sol.feed_in), pv_kw: pvKw };
        });
        solarInfo = { ...solarInfo, forecast_source: fc.source, forecast_hours: fc.hours.size, expected_kwh_left_today: todayKwh };
      } catch (err) {
        solarInfo = { ...solarInfo, forecast_error: err.message };
      }
    }
    const wantedSoc = departure ? departure.soc : dep.default_soc;
    // The car stops at its own charge limit; planning above it is pointless.
    const carLimit = vehicle && mode !== 'fixed_kwh' ? await carChargeLimit(vehicle, states) : null;
    // The app sets the car's limit itself when the car supports it.
    const managesLimit = managingCarLimit(s) && !!(carLimit && carLimit.writable);
    const limited = !managesLimit && carLimit && carLimit.value != null && wantedSoc > carLimit.value;
    const targetSoc = limited ? carLimit.value : wantedSoc;
    let neededKwh = vehicle ? energyNeededKwh(soc, targetSoc, vehicle.capacity_kwh, planning.loss_percent) : null;
    if (vehicle && mode === 'fixed_kwh') {
      // Nothing to plan while unplugged; otherwise the rest of the fixed amount.
      neededKwh = sessionInfo && sessionInfo.plugged ? Math.max(0, vehicle.fixed_kwh - sessionInfo.kwh_since) : null;
    }
    // Without a departure: plan in the cheapest real prices, no deadline
    // (a forecast could otherwise make the app wait for days).
    const deadline = departure ? departure.time : (realEnd || now);
    const minKwh = interim && vehicle && mode !== 'fixed_kwh'
      ? energyNeededKwh(soc, Math.min(cf.min_soc, targetSoc), vehicle.capacity_kwh, planning.loss_percent) : 0;
    const solarOnly = cm === 'solar';
    // Battery care (Settings › Rules, on by default): a target above the care
    // level (e.g. 100 %) is charged up to that level whenever it is cheapest,
    // the rest only in the last hours before the departure.
    const careRules = rulesFor(s);
    let care = null;
    if (careRules.battery_care_enabled !== false && departure && !interim && vehicle && mode !== 'fixed_kwh'
      && vehicle.capacity_kwh > 0 && Number.isFinite(soc) && neededKwh > 0.01) {
      const careSoc = Number(careRules.battery_care_soc) || 80;
      if (targetSoc > careSoc) {
        const careKwh = soc < careSoc ? energyNeededKwh(soc, careSoc, vehicle.capacity_kwh, planning.loss_percent) : 0;
        const topKwh = Math.max(0, neededKwh - careKwh);
        const hours = Math.max(Number(careRules.battery_care_hours) || 4, powerKw > 0 ? topKwh / powerKw + 0.5 : 0);
        care = { soc: careSoc, target: targetSoc, care_kwh: careKwh, window_start: departure.time - hours * 3600000 };
      }
    }
    const plan = care
      ? planCare({
        prices, now, deadline, windowStart: care.window_start, careKwh: care.care_kwh, neededKwh, powerKw,
        continuous: planning.continuous !== false,
        minSplitSaving: Number(planning.min_split_saving) || 0,
        solarOnly,
      })
      : interim && minKwh > 0.01
      ? planStaged({
        prices, now, firstDeadline: interim.time, minKwh, deadline, neededKwh, powerKw,
        continuous: planning.continuous !== false,
        minSplitSaving: Number(planning.min_split_saving) || 0,
        solarOnly,
      })
      : planCharging({
        prices, now, deadline, neededKwh, powerKw,
        continuous: planning.continuous !== false,
        minSplitSaving: Number(planning.min_split_saving) || 0,
        solarOnly,
      });
    if (care) {
      if (plan.care) care.window_start = plan.care.window_start;
      plan.care = { ...care, ...(plan.care || {}), soc: care.soc, target: care.target };
      plan.notes.push('battery_care');
    }
    if (solarInfo.forecast_error) plan.notes.push('solar_forecast_error');
    if (solarOnly) plan.notes.push('solar_only');
    if (!departure) plan.notes.unshift('no_departure');
    if (vehicle && mode === 'manual_soc' && !(sessionInfo && sessionInfo.manual_soc)) {
      plan.notes = ['enter_soc', ...plan.notes.filter((n) => n !== 'missing_data')];
    }
    if (vehicle && mode === 'fixed_kwh' && !(sessionInfo && sessionInfo.plugged)) {
      plan.notes = ['fixed_waiting', ...plan.notes.filter((n) => n !== 'missing_data')];
    }
    if (calendarError) plan.notes.push('calendar_error');
    if (plan.blocks.some((b) => b.forecast)) plan.notes.push('uses_forecast');
    if (forecastInfo && forecastInfo.error) plan.notes.push('forecast_error');
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
          soc, capacity: vehicle && vehicle.capacity_kwh, loss: planning.loss_percent, carLimit: managesLimit ? null : carLimit,
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
          const lastEnd = Math.max(realEnd || now, prices.length ? prices[prices.length - 1].end : now);
          activePlan = planCharging({ prices, now, deadline: lastEnd, neededKwh: kwh, powerKw, immediate: true });
          boostInfo.end = activePlan.blocks.length ? activePlan.blocks[activePlan.blocks.length - 1].end : null;
        }
      }
    }

    // Ready Guard independently checks whether the cost plan still has enough
    // real-world margin. It may later overrule price/solar waiting, but never
    // claims that an impossible or unplugged target is guaranteed.
    const readyRules = rulesFor(s);
    const reliability = evaluateReadyGuard({
      now,
      enabled: readyRules.ready_guard_enabled,
      marginMinutes: readyRules.ready_guard_margin_minutes,
      deadline: departure ? departure.time : null,
      neededKwh,
      plannedKwh: plan.planned_kwh,
      blocks: plan.blocks,
      powerKw,
      plugged: actualNow.plugged,
      charging: actualNow.charging,
      controlAllowed: options.allow_control,
      carData,
      notes: plan.notes,
    });

    // After this departure: the next goal, the expected battery level after the
    // trip, and the expected charging for it (shown in orange, never steered).
    let next = null;
    try {
      next = lookAhead({ s, dep, events, tz, now, states, vehicle, mode, soc, targetSoc, neededKwh, plan, powerKw, prices, planning, departure, carCtxNow: carCtx(s, vehicle) });
    } catch (err) {
      ha.warn('Looking ahead failed:', err.message);
    }
    tripLearning(vehicle, actualNow.plugged, soc, carData, next, now);

    // Home battery: its own plan next to the car's.
    let batteryInfo = null;
    const bcfg = batterySettings(s);
    if (bcfg.enabled && bcfg.soc_entity) {
      try {
        batteryInfo = await batteryPlanFor(s, bcfg, { prices, activePlan, houseLoad, tz, states, sol });
      } catch (err) {
        batteryInfo = { enabled: true, error: err.message };
      }
    }

    return {
      time_zone: tz,
      currency: ha.state.currency,
      now,
      missing,
      battery: batteryInfo,
      price_error: priceError,
      calendar_error: calendarError,
      planning: { ...planning, target_soc: targetSoc, wanted_soc: wantedSoc },
      car_limit: carLimit,
      manages_car_limit: managesLimit,
      charge_for: cf ? {
        day: cf.day, until: cf.until, soc: cf.soc, min_soc: cf.min_soc, created: cf.created || null, based_on: cf.based_on || null,
        interim: interim ? { time: interim.time, soc: interim.soc, source: interim.source, title: interim.title || null } : null,
        min_kwh: minKwh,
      } : null,
      departure,
      next,
      // More than one car: which one is connected, and how the app knows.
      cars: cars(s).length > 1 ? {
        list: cars(s).map((v) => ({ id: v.id, name: v.name, own_departures: ownDepartures(v, s), plug_sensor: !!v.plugged_entity })),
        connected_id: carPick.vehicle_id,
        how: carPick.how,
        ask: !!carPick.ask,
        candidates: carPick.candidates || [],
        conflict: carPick.conflict || null,
        charger_plugged: actualNow.plugged,
        chosen: !!activecar.choice(),
      } : null,
      vehicle: vehicle ? {
        id: vehicle.id,
        name: vehicle.name,
        mode,
        fixed_kwh: vehicle.fixed_kwh || null,
        session: sessionInfo,
        soc: Number.isFinite(soc) ? soc : null,
        soc_state: socValue ? socValue.state : null,
        car_data: carData,
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
      // The chart shows the prices up to the departure (forecast included).
      prices: prices.filter((p) => p.start < Math.max(realEnd || 0, deadline)).map((p) => ({
        start: p.start, end: p.end, total: p.total, power_kw: p.power_kw, amps: p.amps,
        ...(p.forecast ? { forecast: true, expected: p.expected } : {}),
        ...(Number.isFinite(p.pv_kw) ? { pv_kw: p.pv_kw, solar_kw: p.solar_kw, solar_price: p.solar_price } : {}),
      })),
      forecast: forecastInfo,
      solar: solarInfo,
      house_load: houseLoad.available ? {
        available: true,
        profile: houseLoad.profile.map((w) => Math.round(w)),
        days: houseLoad.days,
        charger_subtracted: houseLoad.charger_subtracted,
        main_fuse: grid.main_fuse,
      } : { available: false, reason: houseLoad.reason },
      plan: { ...activePlan, periods: periods(activePlan.blocks) },
      normal_plan: { ...plan, periods: periods(plan.blocks) },
      reliability,
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
    if (ST().savingsCache && now - ST().savingsCache.at < 10 * 60000 && ST().savingsCache.key === JSON.stringify([currentCharger(s), s.vehicles, s.prices])) {
      return ST().savingsCache.result;
    }
    const result = {
      time_zone: tz,
      currency: ha.state.currency,
      ...(await computeSavings({ charger: currentCharger(s), vehicle: currentVehicle(s), priceCfg: s.prices, tz, now })),
    };
    ST().savingsCache = { at: now, key: JSON.stringify([currentCharger(s), s.vehicles, s.prices]), result };
    return result;
  },

  // Add trips to the calendar. Without "Allow adding trips to calendar" this
  // only shows what would be added (test mode).
  'POST /api/trips/preview': async (req) => tripsPlan(await readBody(req)),

  'POST /api/trips': async (req) => {
    const plan = await tripsPlan(await readBody(req));
    if (!plan.calendar_writable) {
      throw badRequest(`${plan.calendar} is read only (for example an Apple iCloud calendar): Home Assistant cannot add events to it. Add the trip in the calendar app itself, or choose a calendar that can (Google, Local calendar, CalDAV).`);
    }
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
    const charger = currentCharger(s);
    ST().controlMethods = null; // always a fresh check
    const r = await currentControlMethods(charger);
    return { control_allowed: options.allow_control, ...r };
  },

  // Departure times.
  // ?vehicle=…: the departures of that car (more cars); else the connected car.
  'GET /api/departures': async (req) => {
    const s = settings.load();
    const tz = ha.state.timeZone;
    const now = Date.now();
    const vehicle = vehicleParam(s, new URL(req.url, 'http://localhost').searchParams.get('vehicle'));
    const dep = departuresFor(s, vehicle);
    const states = await ha.call({ type: 'get_states' });
    const { events, error } = await calendarEvents(dep, tz, now);
    const days = winnersPerDay(collect(dep, { states, events, tz, now, cars: carCtx(s, vehicle) }), tz);
    const list = (domain) => states
      .filter((x) => x.entity_id.startsWith(domain + '.'))
      .map((x) => ({ entity_id: x.entity_id, name: (x.attributes && x.attributes.friendly_name) || x.entity_id, state: x.state }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      time_zone: tz,
      now,
      vehicle_id: vehicle ? vehicle.id : null,
      own_departures: ownDepartures(vehicle, s),
      cars: cars(s).length > 1 ? cars(s).map((v) => ({ id: v.id, name: v.name, own_departures: ownDepartures(v, s) })) : null,
      departures: dep,
      next: days.length ? days[0].winner : null,
      charge_for: chargefor.current(),
      upcoming: days,
      calendar_error: error,
      calendar_trips: (() => {
        // What each trip costs (there and back), from its destination (tripcost.js).
        const socSt = vehicle && vehicle.soc_entity ? states.find((x) => x.entity_id === vehicle.soc_entity) : null;
        const socNow = socSt ? Number(socSt.state) : NaN;
        return calendarTrips(dep, events, tz, now, carCtx(s, vehicle)).filter((t) => t.time < now + 14 * 86400000).map((t) => ({
          ...t,
          cost: t.location && !isReturnTrip(t) ? tripcost.tripCost({ location: t.location, vehicle, states, soc: socNow }) : null,
        }));
      })(),
      calendar_write_allowed: options.allow_calendar_write === true,
      calendar_writable: calendarWritable(states, dep.calendar.entity),
      options: {
        input_datetime: list('input_datetime'),
        input_number: list('input_number'),
        calendar: list('calendar').map((c) => ({ ...c, writable: calendarWritable(states, c.entity_id) })),
      },
    };
  },

  'POST /api/departures': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    const vehicle = vehicleParam(s, body.vehicle_id);
    const cur = departuresFor(s, vehicle);
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
    setDeparturesFor(s, vehicle, {
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
    });
    settings.save(s);
    ST().planCache = null;
    return { ok: true };
  },

  // More cars: a car gets its own departures (starting as a copy of the
  // shared ones), or uses the shared departures again.
  'POST /api/departures/own': async (req) => {
    const body = await readBody(req);
    const s = settings.load();
    const v = cars(s).find((x) => x.id === String(body.vehicle_id || ''));
    if (!v) throw badRequest('That car is not in the app (any more)');
    if (s.multi_car !== true) throw badRequest('Turn on "I have more than one car" first (Settings › Vehicle)');
    if (body.own === true) {
      if (!v.own_departures) v.departures = { ...normalise(s.departures, s.planning), override: null };
      v.own_departures = true;
    } else {
      v.own_departures = false;
    }
    settings.save(s);
    ST().planCache = null;
    return { ok: true, own_departures: v.own_departures };
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
    const vehicle = vehicleParam(s, body.vehicle_id);
    const dep = departuresFor(s, vehicle);
    const n = Number(body.soc);
    if (!(n >= 10 && n <= 100)) throw badRequest('Battery level must be between 10 and 100 %');
    setDeparturesFor(s, vehicle, { ...dep, override: { time, soc: n } });
    settings.save(s);
    ST().planCache = null;
    return { ok: true };
  },

  'DELETE /api/departures/override': async (req) => {
    const s = settings.load();
    const vehicle = vehicleParam(s, new URL(req.url, 'http://localhost').searchParams.get('vehicle'));
    setDeparturesFor(s, vehicle, { ...departuresFor(s, vehicle), override: null });
    settings.save(s);
    ST().planCache = null;
    return { ok: true };
  },
};

// What adding trips would create, with duplicates marked.
async function tripsPlan(body) {
  const s = settings.load();
  const tz = ha.state.timeZone;
  const vehicle = vehicleParam(s, body && body.vehicle_id);
  const dep = departuresFor(s, vehicle);
  const calendar = dep.calendar.entity;
  if (!calendar) throw badRequest('Choose a calendar on the Planning tab first');
  // More cars: the trip says which car ("auto: renault"); "all" = every car.
  const forAll = !body || body.for_all_cars === true;
  const car = cars(s).length > 1 && vehicle && !forAll ? (vehicle.calendar_name || vehicle.name) : null;
  const events = buildTripEvents({ ...body, car }, tz);
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
  const writable = calendarWritable(await ha.call({ type: 'get_states' }), calendar);
  return {
    calendar,
    write_allowed: options.allow_calendar_write === true,
    calendar_writable: writable,
    events: markDuplicates(events, existing, tz),
    time_zone: tz,
  };
}

// Can the app add events to this calendar? Home Assistant's calendar feature
// "create event" (bit 1 of supported_features). Apple iCloud calendars
// (Home Assistant 2026.10+) are read only. Unknown (no attribute): assume yes.
function calendarWritable(states, entityId) {
  const st = entityId ? states.find((x) => x.entity_id === entityId) : null;
  if (!st || !st.attributes || st.attributes.supported_features == null) return true;
  return (Number(st.attributes.supported_features) & 1) === 1;
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
  if (starting && mode === 'soc' && lim && lim.value != null && value > lim.value && !cached.manages_car_limit) {
    throw badRequest(`Your car stops at ${lim.value}% (${lim.name}). Raise that limit first, or choose ${lim.value}% or less.`);
  }
  if (mode === 'target' && cached.normal_plan.needed_kwh == null) throw badRequest('The plan does not know how much to charge; choose an amount in kWh instead');
  return { mode, value: mode === 'target' ? null : value };
}

async function freshPlan() {
  if (!ST().planCache || Date.now() - ST().planCache.at > 60000) {
    const r = await refreshPlan('on request', { fresh: !ST().planCache });
    if (r) return r;
  }
  if (!ST().planCache) throw new Error('The plan could not be calculated yet; try again in a moment');
  return ST().planCache.result;
}

// What "Charge now" would do, compared with the plan. Nothing is started.
routes['POST /api/boost/preview'] = async (req) => {
  const body = await readBody(req);
  const cached = await freshPlan();
  const b = boostFromBody(body, cached);
  const now = Date.now();
  const v = cached.vehicle || {};
  const lim = cached.car_limit;
  const aboveLimit = b.mode === 'soc' && lim && lim.value != null && b.value > lim.value && !cached.manages_car_limit;
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
    limit: limitPreview(cached, b.mode === 'soc' ? b.value
      : b.mode === 'kwh' && Number.isFinite(v.soc) && v.capacity_kwh > 0
        ? Math.min(100, Math.ceil(v.soc + (b.value / (1 + (Number(cached.planning.loss_percent) || 0) / 100) / v.capacity_kwh) * 100))
        : null),
    wanted_soc: b.mode === 'soc' ? b.value : null,
    control_allowed: options.allow_control,
    manages_car_limit: !!cached.manages_car_limit,
    departure: cached.departure ? cached.departure.time : null,
  };
};

// Really start or stop the charger with the chosen start/stop method.
// Only when "Allow control" is on; otherwise it is logged as not sent.
async function manualControl(on, reason) {
  const s = settings.load();
  const charger = currentCharger(s);
  if (!charger) throw badRequest('Set up a charger first');
  const rules = rulesFor(s);
  const [methods, states] = await Promise.all([currentControlMethods(charger), ha.call({ type: 'get_states' })]);
  const chosen = chosenMethods(methods, rules);
  const m = chosen && chosen.start_stop;
  const command = controller.startStopCommand(m, on, methods && methods.device_id);
  const actual = controller.readActual({ vehicle: plugView(s, currentVehicle(s), charger), charger, states });
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
    entry.error = 'No start/stop method chosen in Settings › Charger';
  } else if (!options.allow_control) {
    entry.error = 'Allow control is off, so nothing was sent';
  } else {
    try {
      await ha.sendControl(command, controller.allowedFor(m));
      entry.sent = true;
      ST().lastManual = { on, at: entry.time };
      await afterSent(on, command, reason);
      // Remember it, so the live control knows the last command sent.
      ST().lastLiveSend = { key: JSON.stringify([command.service, command.data, command.target]), at: entry.time };
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
  const actual = controller.readActual({ vehicle: plugView(s, currentVehicle(s), currentCharger(s)), charger: currentCharger(s), states });
  if (actual.plugged === false) throw badRequest('The car is not plugged in');
  const wasCharging = actual.charging === true;
  boost.start(b);
  // Raise the car's limit first, so the car accepts the charge.
  await manageCarLimit(cached, actual, states).catch((err) => ha.warn('Managing the car limit failed:', err.message));
  let send = null;
  if (!wasCharging) {
    send = await manualControl(true, 'Charge now started by you');
  } else {
    send = { sent: false, error: null, note: 'The charger was already charging, so nothing had to be sent', at: Date.now() };
  }
  boost.update({ was_charging: wasCharging, send });
  ST().planCache = null;
  await refreshPlan('charge now started', { fresh: true });
  return { ok: true, send };
};

routes['DELETE /api/boost'] = async () => {
  boost.stop('stopped by you');
  ST().lastManual = null;
  ST().planCache = null;
  await refreshPlan('charge now stopped', { fresh: true });
  const n = ST().lastDryRun;
  const c = n && n.commands[0];
  const send = n && (n.sent || n.error) && c ? { sent: !!n.sent, error: n.error || null, command: c, at: n.sent_at || Date.now() } : null;
  return { ok: true, send, next: n ? { want: n.want, reason: n.reason } : null };
};

// ---------------------------------------------------------------------------
// "Ready for": tomorrow or the day after tomorrow
// ---------------------------------------------------------------------------

// Departures per day for the coming days (the winner of each day).
async function departureDays(s, tz, now) {
  const vehicle = currentVehicle(s);
  const dep = departuresFor(s, vehicle);
  const states = await ha.call({ type: 'get_states' });
  const { events } = await calendarEvents(dep, tz, now);
  return { dep, days: winnersPerDay(collect(dep, { states, events, tz, now, days: 3, cars: carCtx(s, vehicle) }), tz) };
}

function dayStart(tz, offset, now) {
  const p = tzParts(now, tz);
  return localDateTime(tz, p.y, p.m, p.d + offset, 0, 0);
}

routes['GET /api/chargefor'] = async () => {
  const s = settings.load();
  const tz = ha.state.timeZone;
  const now = Date.now();
  const { dep, days } = await departureDays(s, tz, now);
  const rules = rulesFor(s);
  const cached = await freshPlan();
  const hm = (ms) => isoLocal(ms, tz).slice(11, 16);
  const choices = {};
  for (const [key, offset] of [['tomorrow', 1], ['day_after', 2]]) {
    const date = localDate(dayStart(tz, offset, now) + 12 * 3600000, tz);
    const day = days.find((d) => d.day === date);
    const w = day && day.winner;
    // Departures before that day: they only get the minimum.
    const before = days.filter((d) => d.day < date).map((d) => ({ time: d.winner.time, soc: d.winner.soc, source: d.winner.source, title: d.winner.title || null }));
    choices[key] = {
      date,
      time: w ? hm(w.time) : '07:00',
      soc: w ? w.soc : dep.default_soc,
      from: w ? { source: w.source, title: w.title || null } : null,
      before,
    };
  }
  const forecast = !!(s.prices && s.prices.forecast);
  const lastPrice = cached.prices && cached.prices.length ? cached.prices[cached.prices.length - 1].end : null;
  return {
    time_zone: tz,
    active: cached.charge_for || null,
    options: choices,
    min_range: chargefor.MIN_RANGE,
    min_default: Math.min(45, Math.max(20, Number(rules.min_choice) || 30)),
    forecast,
    prices_until: lastPrice,
    soc: cached.vehicle ? cached.vehicle.soc : null,
    limit: limitPreview(cached, null),
    car_limit: cached.car_limit || null,
    manages_car_limit: !!cached.manages_car_limit,
    control_allowed: options.allow_control,
  };
};

routes['POST /api/chargefor/preview'] = async (req) => {
  const c = chargeForFromBody(await readBody(req));
  const cached = await freshPlan();
  return { choice: c, limit: limitPreview(cached, c.soc) };
};

const SOURCE_LABEL = { schedule: 'weekly schedule', helper: 'helper', calendar: 'calendar', override: 'one-off departure' };

function chargeForFromBody(b) {
  const tz = ha.state.timeZone;
  const now = Date.now();
  const offset = b.day === 'tomorrow' ? 1 : b.day === 'day_after' ? 2 : null;
  if (!offset) throw badRequest('Choose tomorrow or the day after tomorrow');
  const m = String(b.time || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw badRequest('Choose a time like 07:00');
  const p = tzParts(now, tz);
  const until = localDateTime(tz, p.y, p.m, p.d + offset, Number(m[1]), Number(m[2]));
  const soc = Number(b.soc);
  if (!(soc >= 10 && soc <= 100)) throw badRequest('Battery level must be between 10 and 100 %');
  const min = Number(b.min_soc);
  const [lo, hi] = chargefor.MIN_RANGE;
  if (!(min >= lo && min <= hi)) throw badRequest(`Minimum must be between ${lo} and ${hi} %`);
  return { day: b.day, until, soc, min_soc: min };
}

routes['POST /api/chargefor'] = async (req) => {
  const c = chargeForFromBody(await readBody(req));
  // Remember the departure of that day, if any: when it disappears, the
  // choice ends by itself.
  try {
    const tz = ha.state.timeZone;
    const { days } = await departureDays(settings.load(), tz, Date.now());
    const date = localDate(c.until, tz);
    const day = days.find((d) => d.day === date);
    if (day && day.winner) c.based_on = { date, time: day.winner.time, source: day.winner.source, title: day.winner.title || null };
  } catch (err) {
    ha.warn('Could not read the departures for the ready-for choice:', err.message);
  }
  chargefor.set(c);
  controller.clearLock(); // a new choice: do not finish a period of the old plan
  ST().planCache = null;
  await refreshPlan('ready-for choice set', { fresh: true });
  return { ok: true, active: ST().planCache && ST().planCache.result.charge_for };
};

routes['DELETE /api/chargefor'] = async () => {
  chargefor.clear('back to normal, by you');
  controller.clearLock(); // a new choice: do not finish a period of the old plan
  ST().planCache = null;
  await refreshPlan('ready-for choice ended', { fresh: true });
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Home battery (Settings › Battery)
// ---------------------------------------------------------------------------

const BATTERY_DEFAULTS = {
  enabled: false,
  platform: null,
  device_id: null,
  name: null,
  soc_entity: null,
  power_entity: null,
  power_sign: 'charge_positive',
  capacity_kwh: 10,
  charge_kw: 3,
  discharge_kw: 3,
  min_pct: 10,
  max_pct: 100,
  efficiency: 0.9,
  wear: 0.03,
  arbitrage: true,
  ev_discharge: 'never', // 'never' | 'solar_only' | 'always' | 'range'
  ev_from_pct: 80, // range: the battery starts charging the car from this level
  ev_to_pct: 40, // range: and stops at this level (kept for the house)
  solar_priority: 'smart',
  saved: null, // values to put back (Tesla backup reserve, Sessy strategy)
};

function batterySettings(s) {
  return { ...BATTERY_DEFAULTS, ...(s.battery || {}) };
}

async function batteryControl(bcfg) {
  const { entities, states } = await loadRegistries();
  return { control: battery.controlFor(bcfg, entities, states, bcfg.saved), states };
}

function socNow(bcfg, states) {
  const st = (states || []).find((x) => x.entity_id === bcfg.soc_entity);
  const n = Number(st && st.state);
  return Number.isFinite(n) ? n : null;
}

// The battery plan from the price blocks, the expected sun, the house and the car.
async function batteryPlanFor(s, bcfg, { prices, activePlan, houseLoad, tz, states, sol }) {
  const soc = socNow(bcfg, states);
  if (soc == null) return { enabled: true, error: `Battery level ${bcfg.soc_entity} not readable` };
  const { control } = await batteryControl(bcfg);
  const baseW = sol ? Number(sol.house_base_w) || 400 : 400;
  const typeOf = (p) => (p.forecast && s.prices && s.prices.forecast ? s.prices.forecast.price_type || s.prices.price_type : s.prices && s.prices.price_type);
  const now = Date.now();
  const evBlocks = (activePlan && activePlan.blocks) || [];
  const blocks = prices.filter((p) => p.end > now).map((p) => {
    const h = (p.end - Math.max(p.start, now)) / 3600000;
    const evKwh = evBlocks.filter((b) => b.start < p.end && b.end > p.start).reduce((a, b) => a + (b.kwh - (b.solar_kwh || 0)), 0);
    return {
      start: Math.max(p.start, now),
      end: p.end,
      buy: Number.isFinite(p.expected) ? p.expected : p.total,
      sell: sol ? solar.feedInValue(p.price, typeOf(p), sol.feed_in) : 0,
      house_kw: (houseLoad && houseLoad.available ? houseLoad.profile[tzParts(p.start, tz).h] || 0 : baseW) / 1000,
      pv_kw: Number.isFinite(p.pv_kw) ? p.pv_kw : 0,
      ev_kw: h > 0 ? evKwh / h : 0,
    };
  });
  const actions = control.available ? control.supported.filter((a) => a !== 'discharge') : ['auto'];
  const plan = planBattery(blocks, {
    ...bcfg,
    soc_pct: soc,
    ev_range_active: evRange.active || (Number.isFinite(soc) && soc >= bcfg.ev_from_pct),
    actions: bcfg.arbitrage ? actions : actions.filter((a) => a !== 'charge'),
  });
  return {
    enabled: true,
    name: bcfg.name,
    soc,
    power_kw: bcfg.power_entity ? battery.powerKw(bcfg, states) : null,
    control: control.available ? { supported: control.supported, note: control.note || null } : { supported: [], note: control.note || null, reason: control.reason },
    control_allowed: options.allow_control === true && options.allow_battery_control === true,
    actions: plan.actions,
    saving: plan.saving,
    notes: plan.notes,
    ev_discharge: bcfg.ev_discharge,
    ev_from_pct: bcfg.ev_from_pct,
    ev_to_pct: bcfg.ev_to_pct,
    ev_range_active: evRange.active,
    solar_kwh: batteryLedger.solar_kwh,
  };
}

// Where the energy in the battery came from (for "only stored solar into the car").
const batteryLedger = { solar_kwh: 0, grid_kwh: 0, at: null };
function updateLedger(bcfg, states, gridW) {
  const now = Date.now();
  const kw = battery.powerKw(bcfg, states);
  const dt = batteryLedger.at ? Math.min(10 * 60000, now - batteryLedger.at) / 3600000 : 0;
  batteryLedger.at = now;
  if (kw == null || !(dt > 0)) return;
  if (kw > 0.05) {
    const fromGrid = Number.isFinite(gridW) ? Math.min(kw, Math.max(0, gridW / 1000)) : 0;
    batteryLedger.grid_kwh += fromGrid * dt;
    batteryLedger.solar_kwh += (kw - fromGrid) * dt;
  } else if (kw < -0.05) {
    const total = batteryLedger.solar_kwh + batteryLedger.grid_kwh;
    const out = -kw * dt;
    if (total > 0) {
      batteryLedger.solar_kwh = Math.max(0, batteryLedger.solar_kwh - out * (batteryLedger.solar_kwh / total));
      batteryLedger.grid_kwh = Math.max(0, batteryLedger.grid_kwh - out * (batteryLedger.grid_kwh / total));
    }
  }
  const cap = Number(bcfg.capacity_kwh) || 0;
  const soc = socNow(bcfg, states);
  // Never more than what is in the battery.
  if (cap > 0 && soc != null) {
    const inside = Math.max(0, (soc / 100) * cap);
    const sum = batteryLedger.solar_kwh + batteryLedger.grid_kwh;
    if (sum > inside && sum > 0) {
      batteryLedger.solar_kwh *= inside / sum;
      batteryLedger.grid_kwh *= inside / sum;
    }
  }
}

// What the battery should do now: the plan, then the car.
// "Between two levels": on from the start level, off at the stop level, and
// only on again at the start level (no switching back and forth in between).
const evRange = { active: false };
function updateEvRange(bcfg, soc) {
  if (bcfg.ev_discharge !== 'range' || !Number.isFinite(soc)) { evRange.active = false; return; }
  if (soc >= bcfg.ev_from_pct) evRange.active = true;
  if (soc <= bcfg.ev_to_pct) evRange.active = false;
}

function batteryWanted(bcfg, planResult, entry, soc = null) {
  const b = planResult && planResult.battery;
  const now = Date.now();
  const blk = b && b.actions ? b.actions.find((a) => a.start <= now && now < a.end) : null;
  let action = blk ? blk.action : 'auto';
  let reason = blk ? `Battery plan: ${action.replace('_', ' ')}` : 'No battery plan: normal mode';
  // The car charges when the app wants it, or when the charger says so
  // (charging started outside the app, a charger the app cannot steer).
  // A pause that was just sent successfully: the car stops in a moment.
  const pausing = !!entry && entry.want === 'pause' && entry.sent === true;
  // With the Easee Equalizer doing solar, "charge" only means the charger is on;
  // the car charges when the Equalizer sees surplus: go by what it really does.
  const eqSolar = !!entry && entry.solar_equalizer && entry.code === 'solar';
  const evCharging = !!entry && entry.plugged !== false && (eqSolar ? entry.charging === true : (entry.want === 'charge' || (entry.charging === true && !pausing)));
  if (evCharging && entry.code === 'solar' && bcfg.solar_priority === 'smart' && ['auto', 'no_discharge'].includes(action)) {
    action = 'hold';
    reason = 'The car is charging on solar: the battery waits, so the sun goes to the car';
  } else if (evCharging && action === 'auto') {
    if (bcfg.ev_discharge === 'never') { action = 'no_discharge'; reason = 'The car is charging: the battery does not discharge into it'; }
    if (bcfg.ev_discharge === 'solar_only' && batteryLedger.solar_kwh < 0.3) { action = 'no_discharge'; reason = 'The car is charging and the battery holds no stored solar power: no discharging into the car'; }
    if (bcfg.ev_discharge === 'range' && !evRange.active) {
      action = 'no_discharge';
      reason = Number.isFinite(soc) && soc <= bcfg.ev_to_pct
        ? `The car is charging; the battery is at ${Math.round(soc)} %, the stop level for the car is ${bcfg.ev_to_pct} %: no discharging into the car`
        : `The car is charging; the battery charges the car only from ${bcfg.ev_from_pct} %: no discharging into it`;
    } else if (bcfg.ev_discharge === 'range') {
      reason = `The car is charging; the battery may charge it until it is at ${bcfg.ev_to_pct} %`;
    }
  }
  return { action, reason };
}

let lastBattery = null; // { action, at, sent }

// Remember values to put back later (Tesla backup reserve, Sessy strategy),
// before the app changes the battery for the first time.
function rememberBattery(control) {
  if (lastBattery || !control.remember) return;
  const st = settings.load();
  const cur = batterySettings(st);
  st.battery = { ...cur, saved: { ...(cur.saved || {}), ...control.remember } };
  settings.save(st);
}

// Put a battery the app changed back in its own mode (before switching to
// another battery or when planning is turned off).
async function releaseBattery(bcfg) {
  if (!lastBattery || !bcfg.soc_entity) return;
  try {
    const { control, states } = await batteryControl(bcfg);
    const c = control.available ? battery.commandsFor(control, 'auto', Number(bcfg.charge_kw) || 3, socNow(bcfg, states)) : null;
    if (c) {
      const allowed = battery.allowedFor(control);
      for (const cmd of c.commands) await ha.sendBattery(cmd, allowed);
      controller.logSent({ time: Date.now(), live: true, manual: false, want: 'battery', code: 'battery_auto', reason: 'Other battery chosen: back to its own mode', commands: c.commands.map((x) => ({ what: 'battery: auto', service: x.service, data: x.data, target: x.target })), sent: true, agrees: true });
    }
  } catch (err) {
    ha.warn('Putting the previous battery back in its own mode failed:', err.message);
  }
  lastBattery = null;
}
async function batteryStep(s, planResult, entry, states) {
  const bcfg = batterySettings(s);
  if (!bcfg.soc_entity) return null;
  const grid = s.grid[0] || null;
  const sol = s.solar && s.solar.enabled ? s.solar : null;
  updateLedger(bcfg, states, solar.gridNetW(grid, states, sol ? sol.grid_sign : 'import_positive'));
  const socLive = socNow(bcfg, states);
  updateEvRange(bcfg, socLive);
  const want = bcfg.enabled ? batteryWanted(bcfg, planResult, entry, socLive) : { action: 'auto', reason: 'Battery planning is off' };
  const info = { ...want, sent: false, live: options.allow_control === true && options.allow_battery_control === true };
  if (!info.live) return info;
  // Nothing changed by the app yet and "auto" wanted: leave the battery alone.
  if (!lastBattery && want.action === 'auto') return info;
  const { control } = await batteryControl(bcfg);
  if (!control.available) return { ...info, error: control.note };
  // Sent again every 15 minutes (30 for timed commands such as Huawei), in
  // case the battery or someone else changed it meanwhile.
  const refresh = (control.refresh_minutes || 15) * 60000;
  const soc = socNow(bcfg, states);
  // The action the battery really gets ("no discharging" can become "hold").
  const c = battery.commandsFor(control, want.action, Number(bcfg.charge_kw) || 3, soc);
  if (!c) return { ...info, error: `${want.action} is not possible with this battery` };
  const same = lastBattery && lastBattery.action === c.action;
  if (same && !(refresh && Date.now() - lastBattery.at >= refresh)) return { ...info, action: c.action };
  rememberBattery(control);
  const allowed = battery.allowedFor(control);
  const line = { time: Date.now(), live: true, manual: false, want: 'battery', code: `battery_${c.action}`, reason: want.reason, commands: [], sent: false, agrees: true };
  try {
    for (const cmd of c.commands) {
      await ha.sendBattery(cmd, allowed);
      line.commands.push({ what: `battery: ${c.action}`, service: cmd.service, data: cmd.data, target: cmd.target });
    }
    line.sent = true;
    lastBattery = c.action === 'auto' ? null : { action: c.action, at: Date.now() };
    await notifier.notify('startstop', 'Home battery', `${want.reason}.`);
  } catch (err) {
    line.error = err.message;
    lastBattery = { action: c.action, at: Date.now(), failed: true };
    await notifier.notify('problem', 'Home battery command failed', `${c.action}: ${err.message}`, { key: 'battery', minGapMs: 60 * 60000 });
  }
  controller.logSent(line);
  return { ...info, action: c.action, sent: line.sent, error: line.error || null };
}

routes['GET /api/battery'] = async () => {
  const s = settings.load();
  const cfg = batterySettings(s);
  const { entities, devices, states } = await loadRegistries();
  const candidates = battery.detectBatteries(entities, devices, states).map((c) => {
    const ctl = battery.controlFor(c, entities, states, null);
    const cap = c.capacity_entity ? states.find((x) => x.entity_id === c.capacity_entity) : null;
    let capKwh = cap ? Number(cap.state) : null;
    if (cap && cap.attributes && cap.attributes.unit_of_measurement === 'Wh' && Number.isFinite(capKwh)) capKwh /= 1000;
    return {
      ...c,
      soc: socNow(c, states),
      power_kw: c.power_entity ? battery.powerKw(c, states) : null,
      capacity_kwh: Number.isFinite(capKwh) && capKwh > 0 ? capKwh : null,
      control: ctl.available ? { supported: ctl.supported, note: ctl.note || null, protects_car: ctl.supported.includes('no_discharge') || ctl.supported.includes('hold') } : { supported: [], note: ctl.note || null, reason: ctl.reason, protects_car: false },
    };
  });
  const cur = cfg.soc_entity ? { soc: socNow(cfg, states), power_kw: cfg.power_entity ? battery.powerKw(cfg, states) : null } : null;
  return {
    settings: cfg,
    candidates,
    now: cur,
    brands: Object.entries(battery.BRANDS).map(([k, v]) => ({ platform: k, name: v.name, integration: v.integration, read_only: !!battery.READ_ONLY_REASON[k] || !battery.ADAPTERS[k] })),
    control_allowed: options.allow_control === true,
    battery_control_allowed: options.allow_battery_control === true,
    ledger: { ...batteryLedger },
    last: lastBattery,
  };
};

routes['POST /api/battery'] = async (req) => {
  const b = await readBody(req);
  const num = (v, name, min, max) => {
    const n = Number(v);
    if (!(n >= min && n <= max)) throw badRequest(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const s = settings.load();
  const prev = batterySettings(s);
  const cfg = {
    ...prev,
    enabled: b.enabled === true,
    capacity_kwh: num(b.capacity_kwh, 'Capacity', 0.5, 200),
    charge_kw: num(b.charge_kw, 'Charging power', 0.1, 50),
    discharge_kw: num(b.discharge_kw, 'Discharging power', 0.1, 50),
    min_pct: num(b.min_pct, 'Minimum level', 0, 90),
    max_pct: num(b.max_pct, 'Maximum level', 50, 100),
    efficiency: num(b.efficiency, 'Round-trip efficiency', 0.5, 1),
    wear: num(b.wear, 'Wear', 0, 0.5),
    arbitrage: b.arbitrage !== false,
    ev_discharge: ['never', 'solar_only', 'always', 'range'].includes(b.ev_discharge) ? b.ev_discharge : 'never',
    ev_from_pct: b.ev_from_pct === undefined ? prev.ev_from_pct : num(b.ev_from_pct, 'Start level for the car', 1, 100),
    ev_to_pct: b.ev_to_pct === undefined ? prev.ev_to_pct : num(b.ev_to_pct, 'Stop level for the car', 0, 99),
    solar_priority: b.solar_priority === 'battery' ? 'battery' : b.solar_priority === 'car' ? 'car' : 'smart',
    power_sign: b.power_sign === 'discharge_positive' ? 'discharge_positive' : 'charge_positive',
  };
  if (cfg.min_pct >= cfg.max_pct) throw badRequest('The minimum level must be below the maximum level');
  if (cfg.ev_discharge === 'range') {
    if (cfg.ev_to_pct >= cfg.ev_from_pct) throw badRequest('The stop level for the car must be below the start level');
    if (cfg.ev_to_pct < cfg.min_pct) throw badRequest(`The stop level for the car cannot be below the battery's minimum (${cfg.min_pct} %)`);
    if (cfg.ev_from_pct > cfg.max_pct) throw badRequest(`The start level for the car cannot be above the battery's maximum (${cfg.max_pct} %)`);
  }
  if (b.platform !== undefined || b.soc_entity !== undefined) {
    // SAFETY: the battery must be one that the app detected itself.
    const { entities, devices, states } = await loadRegistries();
    const found = battery.detectBatteries(entities, devices, states).find((c) => c.soc_entity === b.soc_entity && c.platform === b.platform);
    if (b.soc_entity && !found) throw badRequest('That battery was not found in Home Assistant');
    if (found) Object.assign(cfg, { platform: found.platform, device_id: found.device_id, name: found.name, soc_entity: found.soc_entity, power_entity: found.power_entity });
    if (!b.soc_entity) Object.assign(cfg, { platform: null, device_id: null, name: null, soc_entity: null, power_entity: null, enabled: false });
    if (cfg.soc_entity !== prev.soc_entity) {
      // Another battery: the old one back to its own mode, start afresh.
      await releaseBattery(prev);
      cfg.saved = null;
      batteryLedger.solar_kwh = 0;
      batteryLedger.grid_kwh = 0;
      batteryLedger.at = null;
    }
  }
  if (cfg.enabled && !cfg.soc_entity) throw badRequest('Choose a battery first');
  s.battery = cfg;
  settings.save(s);
  ST().planCache = null;
  ha.log(`Battery settings saved (${cfg.enabled ? 'on' : 'off'})`);
  return { ok: true, settings: cfg };
};

// Diagnostics: one battery action by hand, to check that the commands work.
routes['POST /api/battery/test'] = async (req) => {
  const b = await readBody(req);
  const s = settings.load();
  const cfg = batterySettings(s);
  if (!cfg.soc_entity) throw badRequest('Choose a battery first');
  const { control, states } = await batteryControl(cfg);
  if (!control.available) throw badRequest(control.note || 'This battery cannot be steered');
  const c = battery.commandsFor(control, String(b.action || ''), Number(cfg.charge_kw) || 3, socNow(cfg, states));
  if (!c) throw badRequest('That action is not possible with this battery');
  rememberBattery(control);
  const allowed = battery.allowedFor(control);
  const sent = [];
  for (const cmd of c.commands) {
    await ha.sendBattery(cmd, allowed);
    sent.push(`${cmd.service} ${JSON.stringify(cmd.data)}`);
  }
  lastBattery = c.action === 'auto' ? null : { action: c.action, at: Date.now(), manual: true };
  controller.logSent({ time: Date.now(), live: true, manual: true, want: 'battery', code: `battery_${c.action}`, reason: `Battery test: ${c.action}`, commands: c.commands.map((x) => ({ what: `battery: ${c.action}`, service: x.service, data: x.data, target: x.target })), sent: true, agrees: true });
  return { ok: true, action: c.action, sent };
};

// ---------------------------------------------------------------------------
// Solar (Settings › Solar) and the charging mode (Home)
// ---------------------------------------------------------------------------

const SOLAR_DEFAULTS = {
  enabled: false,
  forecast: 'energy', // 'energy' | 'sensor' | 'none'
  forecast_entity: null,
  forecast_factor: 0.8,
  house_base_w: 400,
  pv_entity: null,
  grid_sign: 'import_positive',
  start_delay_min: 5,
  stop_delay_min: 5,
  grid_allow_w: 0,
  max_soc: 90,
  current_control: true,
  phase_switching: false,
  phase_method_id: null,
  feed_in: { mode: 'market', fee: 0.02, fixed: 0.05, vat_percent: 0 },
  solar_control: 'app', // 'app' | 'equalizer' (Easee Equalizer surplus charging)
  equalizer: null, // { device_id, switch_entity, name } when solar_control is 'equalizer'
};

function solarSettings(s) {
  const x = s.solar || {};
  return { ...SOLAR_DEFAULTS, ...x, feed_in: { ...SOLAR_DEFAULTS.feed_in, ...(x.feed_in || {}) } };
}

routes['GET /api/solar'] = async () => {
  const s = settings.load();
  const cfg = solarSettings(s);
  const { entities, devices: devicesList, states } = await loadRegistries();
  const charger = currentCharger(s);
  const methods = charger ? await currentControlMethods(charger).catch(() => null) : null;
  const rules = rulesFor(s);
  const chosen = chosenMethods(methods, rules);
  const prefs = await solar.energyPrefs();
  let fc = null;
  try {
    const f = await solar.forecast({ ...cfg, forecast: cfg.forecast === 'none' ? 'energy' : cfg.forecast }, states);
    const tz = ha.state.timeZone;
    const day = (offset) => {
      const a = dayStart(tz, offset, Date.now());
      const b = dayStart(tz, offset + 1, Date.now());
      let wh = 0;
      for (const [t, v] of f.hours) if (t >= a && t < b) wh += v;
      return wh / 1000;
    };
    fc = { source: f.source, entries: f.entries, hours: f.hours.size, today_kwh: day(0), tomorrow_kwh: day(1) };
  } catch (err) {
    fc = { error: err.message };
  }
  const grid = s.grid[0] || null;
  const pv = solar.detectPvSensors(entities, states);
  const pvNow = cfg.pv_entity ? solar.powerW(states.find((x) => x.entity_id === cfg.pv_entity)) : null;
  const sensorCandidates = states
    .filter((x) => x.entity_id.startsWith('sensor.') && solar.sensorForecast(x).hours.size > 0)
    .map((x) => ({ entity_id: x.entity_id, name: (x.attributes && x.attributes.friendly_name) || x.entity_id }));
  return {
    settings: cfg,
    mode: chargeMode.current(cfg.enabled),
    energy: prefs,
    forecast: fc,
    forecast_sensors: sensorCandidates,
    pv_sensors: pv.slice(0, 8),
    pv_now_w: pvNow,
    grid: grid ? { name: grid.name, net_w: solar.gridNetW(grid, states, cfg.grid_sign) } : null,
    price_type: s.prices ? s.prices.price_type : null,
    current_method: chosen && chosen.current ? { id: chosen.current.id, label: chosen.current.label } : null,
    phase_methods: methods && methods.available ? (methods.phase || []).map((m) => ({ id: m.id, label: m.label, type: m.type })) : [],
    equalizer: charger && methods && methods.available && (methods.domains || []).includes('easee') ? equalizer.detectEqualizer(entities, states, devicesList) : null,
    control_allowed: options.allow_control,
    now: ST().lastDryRun && ST().lastDryRun.solar_now ? ST().lastDryRun.solar_now : null,
  };
};

routes['POST /api/solar'] = async (req) => {
  const b = await readBody(req);
  const num = (v, name, min, max) => {
    const n = Number(v);
    if (!(n >= min && n <= max)) throw badRequest(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const f = b.feed_in || {};
  const cfg = {
    enabled: b.enabled === true,
    forecast: ['energy', 'sensor', 'none'].includes(b.forecast) ? b.forecast : 'energy',
    forecast_entity: null,
    forecast_factor: num(b.forecast_factor ?? 0.8, 'Forecast factor', 0.3, 1.2),
    house_base_w: num(b.house_base_w ?? 400, 'House use', 0, 10000),
    pv_entity: null,
    grid_sign: b.grid_sign === 'export_positive' ? 'export_positive' : 'import_positive',
    start_delay_min: num(b.start_delay_min ?? 5, 'Start delay', 0, 30),
    stop_delay_min: num(b.stop_delay_min ?? 5, 'Stop delay', 0, 30),
    grid_allow_w: num(b.grid_allow_w ?? 0, 'Allowed grid power', 0, 5000),
    max_soc: num(b.max_soc ?? 90, 'Solar charging up to', 50, 100),
    current_control: b.current_control !== false,
    phase_switching: b.phase_switching === true,
    phase_method_id: b.phase_method_id ? String(b.phase_method_id).slice(0, 200) : null,
    feed_in: {
      mode: f.mode === 'fixed' ? 'fixed' : 'market',
      fee: num(f.fee ?? 0.02, 'Feed-in costs', -1, 1),
      fixed: num(f.fixed ?? 0.05, 'Fixed feed-in compensation', -1, 1),
      vat_percent: num(f.vat_percent ?? 0, 'VAT on feed-in', 0, 50),
    },
  };
  if (cfg.forecast === 'sensor') {
    if (!/^sensor\.[a-z0-9_]+$/.test(String(b.forecast_entity || ''))) throw badRequest('Choose a forecast sensor');
    cfg.forecast_entity = b.forecast_entity;
  }
  if (b.pv_entity) {
    if (!/^sensor\.[a-z0-9_]+$/.test(String(b.pv_entity))) throw badRequest('Invalid solar power sensor');
    cfg.pv_entity = b.pv_entity;
  }
  const s = settings.load();
  if (cfg.enabled && !(s.grid && s.grid[0])) throw badRequest('Set up the grid meter first (Settings › Grid): the app sees the solar surplus there');
  cfg.solar_control = 'app';
  cfg.equalizer = null;
  if (b.solar_control === 'equalizer') {
    // SAFETY: only an Equalizer that Home Assistant's registry shows, next to an Easee charger.
    const charger = currentCharger(s);
    const methods = charger ? await currentControlMethods(charger).catch(() => null) : null;
    if (!(methods && methods.available && (methods.domains || []).includes('easee'))) throw badRequest('Solar charging by the Equalizer needs an Easee charger (Settings › Charger)');
    const { entities, devices, states } = await loadRegistries();
    const eq = equalizer.detectEqualizer(entities, states, devices);
    if (!eq) throw badRequest('No Easee Equalizer with surplus charging found in Home Assistant');
    cfg.solar_control = 'equalizer';
    cfg.equalizer = { device_id: eq.device_id, switch_entity: eq.switch_entity, name: eq.name };
  }
  s.solar = cfg;
  settings.save(s);
  solarFcCache = null;
  ST().planCache = null;
  ha.log(`Solar settings saved (${cfg.enabled ? 'on' : 'off'})`);
  return { ok: true, settings: cfg };
};

routes['GET /api/chargemode'] = async () => {
  const s = settings.load();
  const cfg = solarSettings(s);
  return { mode: chargeMode.current(cfg.enabled), solar_enabled: cfg.enabled, modes: chargeMode.MODES };
};

routes['POST /api/chargemode'] = async (req) => {
  const b = await readBody(req);
  const s = settings.load();
  if (!solarSettings(s).enabled && b.mode !== 'plan') throw badRequest('Set up solar first (Settings › Solar)');
  if (!chargeMode.MODES.includes(b.mode)) throw badRequest('Choose a charging mode');
  chargeMode.set(b.mode);
  controller.clearLock();
  ST().planCache = null;
  await refreshPlan('charging mode changed', { fresh: true });
  return { ok: true, mode: b.mode };
};

// ---------------------------------------------------------------------------
// Settings check: is everything set up well?
// ---------------------------------------------------------------------------

routes['GET /api/checklist'] = async () => {
  const s = settings.load();
  const items = [];
  const add = (key, state, title, detail, page) => items.push({ key, state, title, detail, page });
  const v = currentVehicle(s);
  const c = currentCharger(s);
  const carText = (x) => `${x.name}${x.capacity_kwh ? `, ${x.capacity_kwh} kWh` : ''}`;
  const list = cars(s);
  add('vehicle', v ? 'ok' : 'missing', list.length > 1 ? `Vehicles (${list.length})` : 'Vehicle', v ? list.map(carText).join(' · ') : 'Not set up', 'vehicle');
  for (const x of list) {
    if ((x.mode || 'sensor') !== 'fixed_kwh' && !(x.capacity_kwh > 0)) add(list.length > 1 ? `capacity:${x.id}` : 'capacity', 'missing', list.length > 1 ? `Battery capacity of ${x.name}` : 'Battery capacity', 'Needed to calculate how much to charge', 'vehicle');
  }
  if (chargersList(s).length > 1) {
    const g = s.grid[0];
    add('sharing', g && (g.main_fuse > 0 || g.load_balancer) ? 'ok' : 'warn', 'Sharing the connection',
      g && g.load_balancer ? `${g.load_balancer.name} shares the connection`
        : g && g.main_fuse > 0 ? `Main fuse ${g.main_fuse} A: the car with the least room to spare goes first, the rest is shared`
          : 'Set up the grid meter and main fuse (Settings › Grid), so the chargers share the connection', 'grid');
  }
  if (list.length > 1) {
    const noPlug = list.filter((x) => !x.plugged_entity);
    add('car_recognition', noPlug.length <= 1 ? 'ok' : 'optional', 'Recognising the connected car',
      noPlug.length <= 1
        ? (noPlug.length ? `By the cars' plug sensors (${noPlug[0].name} has none: it is the one when no other car is plugged in)` : "By the cars' plug sensors")
        : `${noPlug.map((x) => x.name).join(' and ')} have no "Plugged in" sensor: choose the connected car on Home`, 'vehicle');
  }
  add('charger', c ? 'ok' : 'missing', 'Charger', c ? c.name : 'Not set up', 'charger');
  if (c) {
    const rules = rulesFor(s);
    const methods = await currentControlMethods(c).catch(() => null);
    const chosen = chosenMethods(methods, rules);
    add('method', chosen && chosen.start_stop ? 'ok' : 'missing', 'Start and stop', chosen && chosen.start_stop ? chosen.start_stop.label || 'Chosen' : 'No way to start and stop the charger found', 'charger');
  }
  add('prices', s.prices ? 'ok' : 'missing', 'Prices', s.prices ? s.prices.source.name : 'Not set up', 'prices');
  if (s.prices && s.prices.source.type !== 'fixed') {
    add('forecast', s.prices.forecast ? 'ok' : 'optional', 'Price forecast', s.prices.forecast ? s.prices.forecast.entity_id : 'Optional: lets the app wait for a cheaper day', 'prices');
  }
  const dep = departuresFor(s, v);
  const sources = [dep.schedule_enabled && 'weekly schedule', dep.calendar.enabled && 'calendar', dep.helper.enabled && 'helper'].filter(Boolean);
  add('departures', sources.length ? 'ok' : 'warn', 'Departures', sources.length ? sources.join(', ') : 'No departure source: the app charges in the cheapest known hours', 'departures');
  add('control', options.allow_control ? 'ok' : 'warn', 'Allow control', options.allow_control ? 'On: the app starts and pauses the charger' : 'Off: advice only. Turn on in Home Assistant › Apps › Smart Charging Planner › Configuration', null);
  if (v) {
    const states = await ha.call({ type: 'get_states' });
    const lim = await carChargeLimit(v, states).catch(() => null);
    if (!lim) add('car_limit', 'optional', "Car's charge limit", 'Not found; the app cannot see or set it', 'vehicle');
    else if (!lim.writable) add('car_limit', 'warn', "Car's charge limit", `${lim.name} can only be read; set it in the car yourself`, 'vehicle');
    else if (s.control && s.control.car_limit_off) add('car_limit', 'warn', "Car's charge limit", 'Off in Settings › Rules: the app does not change it', 'ctlset');
    else if (!options.allow_control) add('car_limit', 'warn', "Car's charge limit", 'Follows your choices once Allow control is on', null);
    else add('car_limit', 'ok', "Car's charge limit", `Follows every choice automatically (${lim.name}, now ${lim.value}%)`, 'ctlset');
  }
  const conflicts = await findConflicts().catch(() => null);
  const n = conflicts ? conflicts.items.filter((x) => !x.dismissed).length : 0;
  add('conflicts', n ? 'warn' : 'ok', 'Your own automations', n ? `${n} automation(s) use the same charger or car limit` : 'No conflicts found', 'ctlset');
  add('notify', s.notify && s.notify.service ? 'ok' : 'optional', 'Notifications', s.notify && s.notify.service ? s.notify.service : 'Optional: choose where to send them', 'status');
  add('grid', s.grid && s.grid[0] ? 'ok' : 'optional', 'Grid meter', s.grid && s.grid[0] ? s.grid[0].name : 'Optional: for the house load and solar', 'grid');
  const bc = batterySettings(s);
  if (!bc.enabled) add('battery', 'optional', 'Home battery', 'Optional: plan the home battery next to the car', 'battery');
  else {
    const { control } = await batteryControl(bc).catch(() => ({ control: { available: false, note: 'Could not be checked' } }));
    if (!control.available) add('battery', 'warn', 'Home battery', `${bc.name}: the plan is advice only. ${control.note || ''}`.trim(), 'battery');
    else if (!(options.allow_control && options.allow_battery_control)) add('battery', 'warn', 'Home battery', `${bc.name}: advice only. Turn on Allow control and Allow home battery control in Home Assistant › Apps › Smart Charging Planner › Configuration`, 'battery');
    else add('battery', 'ok', 'Home battery', `${bc.name}: steered by the app (${control.supported.join(', ')})`, 'battery');
  }
  const sc = solarSettings(s);
  if (!sc.enabled) add('solar', 'optional', 'Solar', 'Optional: charge with your own solar power', 'solar');
  else {
    let detail = `On · forecast ${sc.forecast === 'none' ? 'off' : sc.forecast === 'energy' ? 'from the Energy dashboard' : sc.forecast_entity}`;
    let state = 'ok';
    if (sc.forecast === 'energy') {
      const p = await solar.energyPrefs();
      if (!p.forecast_entries.length) { state = 'warn'; detail = 'On, but the Energy dashboard has no solar forecast; add Forecast.Solar, Solcast or Open-Meteo there'; }
    }
    if (state === 'ok' && sc.current_control) {
      const m = c ? await currentControlMethods(c).catch(() => null) : null;
      const ch = chosenMethods(m, rulesFor(s));
      if (!(ch && ch.current)) { state = 'warn'; detail = 'On, but the charger has no way to set the current: solar charging only starts with enough surplus for full power'; }
    }
    add('solar', state, 'Solar', detail, 'solar');
  }
  return { items, ready: !items.some((i) => i.state === 'missing') };
};

// "Let the app manage the car's charge limit": only with Allow control on.
// On by default: the car's limit follows every choice. Off only when chosen
// in Settings › Rules (for example when an own automation does it).
function managingCarLimit(s) {
  return options.allow_control === true && !(s.control && s.control.car_limit_off === true);
}

// The limit the car needs: the highest goal that is still active. A goal
// below the plan (Charge now to the minimum) never lowers it.
function limitGoal(planResult, b) {
  let wanted = Number(planResult && planResult.planning && planResult.planning.wanted_soc);
  let reason = planResult && planResult.charge_for ? 'Ready-for choice' : 'Planned target';
  if (!Number.isFinite(wanted)) wanted = NaN;
  // Battery care: up to the care level until the last hours before departure.
  const care = planResult && planResult.plan && planResult.plan.care;
  if (!b && care && Date.now() < care.window_start && Number.isFinite(wanted) && wanted > care.soc) {
    wanted = care.soc;
    reason = 'Battery care';
  }
  if (b && b.mode === 'soc' && !(b.value <= wanted)) { wanted = b.value; reason = 'Charge now'; }
  // Charging on solar surplus goes up to its own maximum.
  const sol = planResult && planResult.solar;
  if (sol && sol.enabled && sol.mode !== 'plan' && Number.isFinite(Number(sol.max_soc)) && !(Number(sol.max_soc) <= wanted)) {
    wanted = Number(sol.max_soc);
    reason = 'Solar charging';
  }
  if (b && b.mode === 'kwh') {
    const v = planResult && planResult.vehicle;
    const left = planResult && planResult.boost ? planResult.boost.remaining_kwh : b.value;
    const loss = 1 + (Number(planResult && planResult.planning && planResult.planning.loss_percent) || 0) / 100;
    if (v && Number.isFinite(v.soc) && v.capacity_kwh > 0 && Number.isFinite(left)) {
      const end = Math.min(100, Math.ceil(v.soc + (left / loss / v.capacity_kwh) * 100));
      if (!(end <= wanted)) { wanted = end; reason = 'Charge now'; }
    }
  }
  return { wanted, reason };
}

// What the car's limit will be for a goal, for the previews.
function limitPreview(planResult, goalSoc) {
  const lim = planResult && planResult.car_limit;
  if (!lim || lim.value == null) return { supported: false, reason: 'none' };
  const managed = !!planResult.manages_car_limit;
  let wantedPlan = Number(planResult.planning && planResult.planning.wanted_soc);
  const care = planResult.plan && planResult.plan.care;
  if (care && Date.now() < care.window_start && wantedPlan > care.soc && !(goalSoc > care.soc && planResult.boost)) wantedPlan = care.soc;
  const goal = Math.max(Number.isFinite(goalSoc) ? goalSoc : 0, Number.isFinite(wantedPlan) ? wantedPlan : 0);
  if (!lim.writable) return { supported: false, reason: 'read_only', now: lim.value, name: lim.name, goal };
  if (!managed) return { supported: true, managed: false, reason: options.allow_control ? 'off' : 'control_off', now: lim.value, name: lim.name, goal };
  return { supported: true, managed: true, now: lim.value, to: limitValue(lim, goal), name: lim.name, goal };
}

// Round up to a value the car accepts (Renault: steps of 5).
function limitValue(lim, wanted) {
  // SAFETY: a charge limit is a battery percentage; never below 50 or above 100.
  const min = Math.max(50, Number.isFinite(lim.min) ? lim.min : 50);
  const max = Math.min(100, Number.isFinite(lim.max) ? lim.max : 100);
  const step = Number(lim.step) > 0 ? Number(lim.step) : 1;
  const v = Math.ceil((Number(wanted) - min) / step - 1e-9) * step + min;
  return Math.max(min, Math.min(max, v));
}

// Send the car's charge limit. Used by the button and by managing.
async function sendCarLimit(lim, value, reason, live) {
  const domain = lim.entity_id.split('.')[0];
  const command = { service: `${domain}.set_value`, data: { value }, target: { entity_id: lim.entity_id } };
  const entry = {
    time: Date.now(), manual: !live, live: !!live, want: 'none', code: 'car_limit',
    reason: `${reason}: car charge limit ${lim.value}% → ${value}%`,
    commands: [{ what: `set car charge limit to ${value}%`, service: command.service, data: command.data, target: command.target }],
    agrees: true, sent: false, control_allowed: options.allow_control,
  };
  try {
    await ha.sendControl(command, [{ service: command.service, entity_id: lim.entity_id }]);
    entry.sent = true;
    ha.log(`Car charge limit set to ${value}% (${lim.entity_id}) - ${reason}`);
  } catch (err) {
    entry.error = err.message;
  }
  controller.logSent(entry);
  return entry;
}

// Keep the car's limit at the goal: the Charge now level while it runs,
// otherwise the departure target (e.g. "doel: 80" from the calendar).
// Only while the car is plugged in. A new value is sent right away, once.
// The car's cloud is slow and limits the number of calls, so the same value
// is only sent again when the car still shows the old one after 15 minutes,
// at most twice.
const LIMIT_RETRY_MS = Number(process.env.SCP_LIMIT_GAP_MS) || 15 * 60000;
const LIMIT_MAX_TRIES = 3;
async function manageCarLimit(planResult, actual, states) {
  const s = settings.load();
  if (!managingCarLimit(s) || !planResult || actual.plugged !== true) return;
  // Only the car this plan is for (more cars: the connected one), and not
  // while Home asks which car is connected.
  const vehicle = planResult.vehicle ? s.vehicles.find((x) => x.id === planResult.vehicle.id) || null : null;
  if (planResult.cars && planResult.cars.ask) return;
  if (ST().lastLimitSend && ST().lastLimitSend.vehicle_id !== (vehicle && vehicle.id)) ST().lastLimitSend = null;
  if (!vehicle || (vehicle.mode || 'sensor') === 'fixed_kwh') return;
  // The car's cloud is down: do not send the limit (it would fail, and the
  // car's API has a limit on the number of calls).
  const cd = planResult.vehicle && planResult.vehicle.car_data;
  if (cd && cd.ok === false) return;
  const lim = await carChargeLimit(vehicle, states);
  if (!lim || !lim.writable || lim.value == null) return;
  const { wanted, reason } = limitGoal(planResult, boost.current());
  if (!Number.isFinite(Number(wanted))) return;
  const value = limitValue(lim, wanted);
  if (value === lim.value) return;
  let tries = 1;
  if (ST().lastLimitSend && ST().lastLimitSend.value === value) {
    // Already sent: wait for the car to report it.
    if (Date.now() - ST().lastLimitSend.at < LIMIT_RETRY_MS) return;
    if (ST().lastLimitSend.tries >= LIMIT_MAX_TRIES) {
      if (!ST().lastLimitSend.gaveUp) {
        ST().lastLimitSend.gaveUp = true;
        await notifier.notify('problem', 'Car charge limit not changed',
          `The car still reports ${lim.value}% after ${LIMIT_MAX_TRIES} attempts to set ${value}% (${lim.name}).`);
      }
      return;
    }
    tries = ST().lastLimitSend.tries + 1;
  }
  ST().lastLimitSend = { value, at: Date.now(), tries, vehicle_id: vehicle.id };
  const e = await sendCarLimit(lim, value, tries > 1 ? `${reason} (attempt ${tries})` : reason, true);
  if (e.sent) await notifier.notify('startstop', 'Car charge limit changed', `${e.reason}.`);
  else await notifier.notify('problem', 'Car charge limit not changed', `${e.reason} failed: ${e.error}`, { key: 'carlimit', minGapMs: 60 * 60000 });
}

// Raise (or set) the car's own charge limit. Only with "Allow control" on,
// and only the limit entity of the chosen vehicle.
routes['POST /api/vehicle/charge_limit'] = async (req) => {
  const body = await readBody(req);
  const s = settings.load();
  const vehicle = vehicleParam(s, body.vehicle_id);
  const states = await ha.call({ type: 'get_states' });
  const lim = await carChargeLimit(vehicle, states);
  if (!lim) throw badRequest('No charge limit of the car found');
  if (!lim.writable) throw badRequest(`${lim.name} cannot be changed from Home Assistant`);
  if (!(Number(body.value) > 0)) throw badRequest('Choose a battery level');
  const value = limitValue(lim, body.value);
  const entry = await sendCarLimit(lim, value, 'Set by you', false);
  if (!entry.sent) throw badRequest(entry.error);
  ST().lastLimitSend = { value, at: Date.now(), tries: 1, vehicle_id: vehicle && vehicle.id };
  ST().planCache = null;
  return { ok: true, value, entity_id: lim.entity_id };
};

// Manual test on the Control tab: start or stop once.
routes['POST /api/control/manual'] = async (req) => {
  const body = await readBody(req);
  if (body.action !== 'start' && body.action !== 'stop') throw badRequest('Choose start or stop');
  const r = await manualControl(body.action === 'start', body.action === 'start' ? 'Manual test: start' : 'Manual test: stop');
  return r;
};
let refreshTimer = null;

// A refresh that is already running may have started before a change (for
// example Charge now). With fresh = true the plan is calculated again after
// it, so the result always includes the change.
function refreshPlan(reason, { fresh = false, noControl = false } = {}) {
  if (ST().planRunning) {
    if (!fresh) return ST().planRunning;
    if (!ST().rerunAfter) {
      ST().rerunAfter = ST().planRunning.catch(() => {}).then(() => {
        ST().rerunAfter = null;
        return refreshPlan(`${reason} (again)`);
      });
    }
    return ST().rerunAfter;
  }
  ST().planRunning = (async () => {
    try {
      const result = await computePlan();
      // What the car's own limit will be, for Home.
      try {
        result.limit = limitPreview(result, limitGoal(result, boost.current()).wanted);
      } catch {
        result.limit = null;
      }
      ST().planCache = { at: Date.now(), result };
      if (!noControl) {
        try {
          await runDryRun(result);
        } catch (err) {
          ha.warn('Control dry run failed:', err.message);
        }
      }
      const p = result.plan;
      const rg = result.reliability;
      if (rg && rg.base_status === 'not_achievable' && !result.boost) {
        await notifier.notify('problem', 'Ready Guard: target at risk',
          `${rg.message} Departure is ${hmLocal(result.departure.time)}.`,
          { key: `ready:not-achievable:${result.departure.time}`, minGapMs: 6 * 3600000 });
      } else if (rg && rg.protect && !result.boost) {
        await notifier.notify('problem', 'Ready Guard active', rg.message,
          { key: `ready:active:${result.departure.time}`, minGapMs: 6 * 3600000 });
      } else if (rg && rg.base_status === 'action_needed' && result.departure && !result.boost) {
        await notifier.notify('problem', 'Ready Guard needs you', rg.message,
          { key: `ready:action:${result.departure.time}`, minGapMs: 6 * 3600000 });
      }
      // More cars, and the app cannot tell which one is connected.
      const cars = result.cars;
      if (cars && cars.ask && cars.charger_plugged === true) {
        const guess = (cars.list.find((c) => c.id === cars.connected_id) || {}).name || 'the first car';
        await notifier.notify('problem', 'Which car is connected?',
          `A car is plugged in, but the app cannot tell which one. It plans for ${guess} for now. Choose the connected car on Home.`,
          { key: 'which_car', minGapMs: 6 * 3600000 });
      }
      ha.debug(`Plan refreshed (${reason}):`, p.blocks.length ? `${p.planned_kwh.toFixed(1)} kWh in ${p.periods.length} period(s)` : 'nothing to charge', p.notes.join(',') || '');
      return result;
    } catch (err) {
      ha.warn('Plan refresh failed:', err.message);
      throw err;
    } finally {
      ST().planRunning = null;
    }
  })();
  return ST().planRunning;
}

routes['GET /api/plan'] = async (req) => {
  const url = new URL(req.url, 'http://localhost');
  const force = url.searchParams.get('refresh') === '1';
  const maxAge = options.refresh_minutes * 60000;
  if (force || !ST().planCache || Date.now() - ST().planCache.at > maxAge) await refreshPlan(force ? 'manual' : 'on request', { fresh: force });
  if (!ST().planCache) await refreshPlan('on request', { fresh: true });
  if (!ST().planCache) throw new Error('The plan could not be calculated yet; see the app log');
  return {
    ...ST().planCache.result,
    solar_now: ST().lastDryRun && ST().lastDryRun.solar_now ? { ...ST().lastDryRun.solar_now, code: ST().lastDryRun.code, amps: ST().lastDryRun.amps, phases: ST().lastDryRun.phases } : null,
    battery_now: ST().lastDryRun && ST().lastDryRun.battery_now ? ST().lastDryRun.battery_now : null,
    computed_at: ST().planCache.at,
    next_refresh: ST().planCache.at + maxAge,
    refresh_minutes: options.refresh_minutes,
  };
};

// Control dry run (phase A): decide what the app would do, log it, send nothing.

async function currentControlMethods(charger) {
  if (ST().controlMethods && Date.now() - ST().controlMethods.at < 60 * 60000 && ST().controlMethods.key === JSON.stringify(charger)) return ST().controlMethods.result;
  const [{ entities, devices, states }, services] = await Promise.all([loadRegistries(), ha.call({ type: 'get_services' })]);
  // SAFETY: the device and its integration come from Home Assistant's own
  // registry, and the device must be recognised as a charger. Settings sent
  // to the app cannot turn another device (a garage door, a pump) into "the
  // charger".
  let deviceId = charger && charger.device_id;
  if (charger && !deviceId) {
    const ids = [charger.status_entity, charger.current_entity, charger.switch_entity, charger.power_entity].filter(Boolean);
    const reg = entities.find((e) => ids.includes(e.entity_id) && e.device_id);
    deviceId = reg ? reg.device_id : null;
  }
  const s = settings.load();
  const vehicleDevices = new Set(s.vehicles.map((v) => v.device_id).filter(Boolean));
  const asCharger = deviceId ? detectChargers(entities, devices, states, vehicleDevices).find((x) => x.device_id === deviceId) : null;
  let result;
  if (!charger) result = { available: false, reason: 'no_charger' };
  else if (!asCharger) result = { available: false, reason: 'not_a_charger' };
  else result = checkControl({ charger: { ...charger, device_id: deviceId, integration: asCharger.integration }, entities, states, services });
  ST().controlMethods = { at: Date.now(), key: JSON.stringify(charger), result };
  return result;
}

// ---------------------------------------------------------------------------
// Solar: forecast cache, the live surplus step, current and phases
// ---------------------------------------------------------------------------

let solarFcCache = null; // { key, at, result }
async function solarForecastCached(sol, states) {
  const key = JSON.stringify([sol.forecast, sol.forecast_entity]);
  if (solarFcCache && solarFcCache.key === key && Date.now() - solarFcCache.at < 15 * 60000) return solarFcCache.result;
  const result = await solar.forecast(sol, states);
  solarFcCache = { key, at: Date.now(), result };
  return result;
}

function phaseMethodFor(methods, sol) {
  if (!methods || !methods.available || !sol || !sol.phase_switching) return null;
  const list = methods.phase || [];
  return (sol.phase_method_id && list.find((m) => m.id === sol.phase_method_id)) || list[0] || null;
}

function solarStep(s, planResult, states, methods, rules, charger) {
  const sol = s.solar && s.solar.enabled ? s.solar : null;
  const cm = chargeMode.current(!!sol);
  if (!sol || cm === 'plan' || !planResult) { ST().solarState = solarctl.initialState(); return null; }
  const grid = s.grid[0] || null;
  const net = solar.gridNetW(grid, states, sol.grid_sign);
  if (sol.solar_control === 'equalizer' && sol.equalizer) {
    // The Equalizer follows the surplus itself (current, phases, start and
    // stop): the charger stays on and the Equalizer's surplus charging is on.
    ST().solarState = solarctl.initialState();
    const soc = planResult.vehicle ? planResult.vehicle.soc : null;
    const full = Number.isFinite(soc) && soc >= (Number(sol.max_soc) || 100);
    return {
      charge: !full,
      amps: null,
      phases: null,
      equalizer: true,
      reason: full ? `Battery at ${sol.max_soc}%, the most to charge with solar` : 'Charging on solar surplus through the Easee Equalizer (it starts, stops and sets the current itself)',
      mode: cm,
      available_w: null,
      grid_w: net,
    };
  }
  const actual = controller.readActual({ vehicle: plugView(s, currentVehicle(s), charger), charger, states });
  const carW = Number.isFinite(actual.power_w) ? actual.power_w : 0;
  let available = net == null ? null : carW - net + (Number(sol.grid_allow_w) || 0);
  // Smart solar priority: while the car still needs energy, what the home
  // battery takes from the sun counts as available for the car.
  const bcfg = batterySettings(s);
  if (available != null && bcfg.enabled && bcfg.power_entity && bcfg.solar_priority !== 'battery') {
    const v = planResult.vehicle;
    const needs = v && Number.isFinite(v.soc) && planResult.planning && v.soc < planResult.planning.target_soc;
    const bkw = battery.powerKw(bcfg, states);
    if ((needs || bcfg.solar_priority === 'car') && bkw > 0) available += bkw * 1000;
  }
  const chosen = chosenMethods(methods, rules);
  const currentControl = sol.current_control !== false && !!(chosen && chosen.current);
  const maxAmps = (planResult.charger && planResult.charger.max_current) || 16;
  const r = solarctl.step(ST().solarState, {
    now: Date.now(),
    available_w: available,
    soc: planResult.vehicle ? planResult.vehicle.soc : null,
    max_soc: Number(sol.max_soc) || 100,
    phases_now: charger ? charger.phases : 3,
    max_amps: maxAmps,
    // Without control over the current the charger takes its maximum, so
    // only start when the surplus covers that.
    min_amps: currentControl ? solarctl.MIN_AMPS : maxAmps,
    can_switch_phases: !!phaseMethodFor(methods, sol) && currentControl,
    start_delay_ms: (Number(sol.start_delay_min) || 0) * 60000,
    stop_delay_ms: (Number(sol.stop_delay_min) || 0) * 60000,
  });
  ST().solarState = r.state;
  return { ...r, mode: cm, available_w: available, grid_w: net };
}

// Easee Equalizer surplus charging: on while charging on solar, off while
// charging at full power (a planned block, Charge now, the minimum level).
// Only sent when the switch is not already as wanted, at most every few
// minutes (the Easee cloud). When the Equalizer no longer does solar, the
// surplus charging the app switched on is switched off once.
let lastEqualizer = null; // { enable, at, device_id }
const EQ_GAP_MS = Number(process.env.SCP_EQ_GAP_MS) || 5 * 60000; // SCP_EQ_GAP_MS: tests only
async function equalizerStep(s, entry, states, charger) {
  const sol = s.solar && s.solar.enabled ? s.solar : null;
  const eqMode = !!(sol && sol.solar_control === 'equalizer' && sol.equalizer);
  const eq = eqMode ? sol.equalizer : lastEqualizer && lastEqualizer.eq;
  if (!eq) return;
  let want = null;
  if (eqMode && chargeMode.current(true) !== 'plan') {
    if (entry.want === 'charge' && entry.code === 'solar') want = true;
    else if (entry.want === 'charge') want = false;
  } else if (lastEqualizer && lastEqualizer.enable) {
    want = false; // the app switched it on: switch it off again
  }
  if (want == null) return;
  const st = (states || []).find((x) => x.entity_id === eq.switch_entity);
  const isOn = st ? st.state === 'on' : null;
  if (isOn === want) {
    if (!want && !eqMode) lastEqualizer = null;
    return;
  }
  if (lastEqualizer && lastEqualizer.enable === want && Date.now() - lastEqualizer.at < EQ_GAP_MS) return;
  const cmd = equalizer.surplusCommand(eq, want, equalizer.importAmps(sol ? sol.grid_allow_w : 0, charger ? charger.phases : 3));
  const line = { ...entry, time: Date.now(), live: true, commands: [cmd], sent: false, reason: want ? 'Charging on solar: the Equalizer follows the surplus' : 'Charging at full power: Equalizer surplus charging off' };
  try {
    await ha.sendControl(cmd, [{ service: 'easee.set_surplus_charging' }]);
    line.sent = true;
  } catch (err) {
    line.error = err.message;
    await notifier.notify('problem', 'Equalizer command failed', `${cmd.what}: ${err.message}`, { key: 'equalizer', minGapMs: 60 * 60000 });
  }
  lastEqualizer = { enable: want, at: Date.now(), eq };
  controller.logSent(line);
}

// Set the charging current (and phases) for solar charging, and back to the
// maximum (and three phases) when charging at full power again. Only what the
// app changed itself is changed back; a current the app never touched is
// left alone. At most once a minute, phases at most every 10 minutes.
const CURRENT_GAP_MS = Number(process.env.SCP_CURRENT_GAP_MS) || 60000;
const PHASE_RESTORE_MS = Number(process.env.SCP_PHASE_GAP_MS) || 2 * 60000;
async function sendCurrentAndPhases(entry, s, methods, rules, planResult) {
  const sol = s.solar && s.solar.enabled ? s.solar : null;
  // More chargers: a current lowered to share the connection (sharing.js).
  const shared = !!entry.shared;
  if (entry.want !== 'charge' || entry.plugged === false) return;
  if (!sol && !shared && !ST().lastCurrent) return;
  // The Equalizer sets the current and phases itself while charging on solar.
  if (entry.solar && entry.solar_equalizer) return;
  const chosen = chosenMethods(methods, rules);
  const curM = chosen && (shared || !sol || sol.current_control !== false) ? chosen.current : null;
  const phaseM = sol ? phaseMethodFor(methods, sol) : null;
  const charger = currentCharger(s) || {};
  const maxAmps = (planResult && planResult.charger && planResult.charger.max_current) || 16;
  const wantAmps = entry.solar || shared ? entry.amps : maxAmps;
  const wantPhases = entry.solar ? entry.phases : (charger.phases === 1 ? 1 : 3);
  const now = Date.now();
  const send = async (command, method, what) => {
    const line = { ...entry, time: now, live: true, commands: [command], sent: false };
    try {
      await ha.sendControl(command, controller.allowedFor(method));
      line.sent = true;
    } catch (err) {
      line.error = err.message;
      ha.warn('Could not', command.what, '-', err.message);
      await notifier.notify('problem', 'Charger command failed', `Could not ${command.what}: ${err.message}`, { key: `fail:${what}`, minGapMs: 30 * 60000 });
    }
    controller.logSent(line);
    return line.sent;
  };
  if (phaseM && wantPhases && (!ST().lastPhases || ST().lastPhases.phases !== wantPhases)) {
    // Unknown and three phases wanted: leave the charger as it is.
    const needed = ST().lastPhases ? true : wantPhases === 1;
    if (needed && (!ST().lastPhases || now - ST().lastPhases.at >= PHASE_RESTORE_MS)) {
      const c = controller.phaseCommand(phaseM, wantPhases, methods.device_id);
      if (c && await send(c, phaseM, 'phase')) ST().lastPhases = { phases: wantPhases, at: now };
    }
  }
  if (curM && Number.isFinite(wantAmps)) {
    const changedByApp = ST().lastCurrent != null;
    if (!entry.solar && !shared && !changedByApp) return; // never touched: leave it
    if (!ST().lastCurrent || ST().lastCurrent.amps !== wantAmps) {
      if (ST().lastCurrent && now - ST().lastCurrent.at < CURRENT_GAP_MS && wantAmps !== maxAmps) return;
      const c = controller.currentCommand(curM, wantAmps, methods.device_id);
      if (c && await send(c, curM, 'current')) ST().lastCurrent = wantAmps === maxAmps && !entry.solar ? null : { amps: wantAmps, at: now };
    }
  }
}

async function runDryRun(planResult) {
  const s = settings.load();
  const charger = currentCharger(s);
  if (!charger) {
    // No charger: the home battery can still follow its plan.
    try {
      const states = await ha.call({ type: 'get_states' });
      const bn = await batteryStep(s, planResult, null, states);
      if (bn) ST().lastDryRun = { time: Date.now(), want: 'none', code: 'no_charger', reason: 'No charger set up', commands: [], battery_now: bn };
    } catch (err) {
      ha.warn('Home battery step failed:', err.message);
    }
    return null;
  }
  // More chargers: decide for every charger, share the connection, then act.
  if (chargersList(s).length > 1) {
    await controlSite();
    return ST().lastDryRun;
  }
  const step = await decideStep(planResult);
  await actStep(step);
  return ST().lastDryRun;
}

// What this charger wants now (nothing is sent yet).
async function decideStep(planResult, { share = null, record = true } = {}) {
  const s = settings.load();
  const charger = currentCharger(s);
  const [states, methods] = await Promise.all([ha.call({ type: 'get_states' }), currentControlMethods(charger)]);
  const rules = rulesFor(s);
  const solarCtx = solarStep(s, planResult, states, methods, rules, charger);
  ST().lastDryRun = controller.dryRun({
    plan: planResult,
    vehicle: plugView(s, currentVehicle(s), charger),
    charger,
    states,
    methods: chosenMethods(methods, rules),
    deviceId: methods && methods.device_id,
    rules,
    controlAllowed: options.allow_control,
    live: options.allow_control === true,
    boostActive: !!boost.current(),
    solar: solarCtx,
    share,
    record,
  });
  const entry = ST().lastDryRun;
  if (solarCtx) entry.solar_now = { available_w: solarCtx.available_w, grid_w: solarCtx.grid_w, mode: solarCtx.mode, reason: solarCtx.reason, equalizer: !!solarCtx.equalizer };
  entry.solar_equalizer = !!(solarCtx && solarCtx.equalizer);
  return { s, charger, states, methods, rules, planResult, entry };
}

// Send what was decided (after sharing the connection, with more chargers).
async function actStep({ s, charger, states, methods, rules, planResult, entry }) {
  ha.debug('Control:', entry.want, entry.reason, entry.commands.map((c) => c.what).join(', ') || 'no commands');
  if (options.allow_control === true) {
    await checkReaction(entry);
    await sendLive(entry, chosenMethods(methods, rules));
    await sendCurrentAndPhases(entry, s, methods, rules, planResult).catch((err) => ha.warn('Setting the current or phases failed:', err.message));
    await manageCarLimit(planResult, entry, states).catch((err) => ha.warn('Managing the car limit failed:', err.message));
    // The Equalizer and the home battery belong to the house: the first charger steers them.
    if (scope.isPrimary()) await equalizerStep(s, entry, states, charger).catch((err) => ha.warn('Equalizer surplus charging failed:', err.message));
  }
  if (scope.isPrimary()) {
    try {
      entry.battery_now = await batteryStep(s, planResult, entry, states);
    } catch (err) {
      ha.warn('Home battery step failed:', err.message);
    }
  }
  await notifier.publishSensors(planResult, entry, { lastCommand: ST().lastCommandInfo });
  return entry;
}

// More chargers: one control step for the whole house. Every charger decides
// with its own plan (first round: nothing recorded); the connection is shared
// (sharing.js); then each charger decides again with its share and sends.
// One step at a time.
let siteRunning = null;
let lastShare = null; // for Home and diagnostics
function controlSite() {
  const run = (siteRunning || Promise.resolve()).catch(() => {}).then(async () => {
    const s = settings.load();
    const first = [];
    for (const c of chargersList(s)) {
      await scope.run(c.id, async () => {
        const cached = ST().planCache;
        if (!cached) return;
        try {
          first.push({ id: c.id, step: await decideStep(cached.result, { record: false }) });
        } catch (err) {
          ha.warn(`Control step (${c.name}) failed:`, err.message);
        }
      });
    }
    let shares = {};
    try {
      shares = shareConnection(s, first);
    } catch (err) {
      ha.warn('Sharing the connection failed:', err.message);
    }
    for (const { id } of first) {
      await scope.run(id, async () => {
        try {
          const step = await decideStep(ST().planCache.result, { share: shares[id] || null });
          await actStep(step);
        } catch (err) {
          ha.warn('Control step failed:', err.message);
        }
      });
    }
  });
  siteRunning = run.finally(() => { if (siteRunning === run) siteRunning = null; });
  return run;
}

// More chargers: every charger at a glance (Home), with how the connection is shared.
routes['GET /api/chargers/overview'] = async () => {
  const s = settings.load();
  const list = chargersList(s);
  const out = [];
  for (const c of list) {
    out.push(scope.run(c.id, () => {
      const p = ST().planCache && ST().planCache.result;
      const n = ST().lastDryRun;
      return {
        id: c.id,
        name: c.name,
        vehicle: p && p.vehicle ? { id: p.vehicle.id, name: p.vehicle.name, soc: p.vehicle.soc } : null,
        how: p && p.cars ? p.cars.how : null,
        ask: !!(p && p.cars && p.cars.ask),
        departure: p && p.departure ? { time: p.departure.time, soc: p.departure.soc } : null,
        planned_kwh: p && p.plan ? p.plan.planned_kwh : null,
        ready_guard: p && p.reliability ? { status: p.reliability.status, label: p.reliability.label, latest_safe_start: p.reliability.latest_safe_start } : null,
        plugged: n ? n.plugged : null,
        charging: n ? n.charging : null,
        power_w: n ? n.power_w : null,
        want: n ? n.want : null,
        code: n ? n.code : null,
        reason: n ? n.reason : null,
        amps: n ? n.amps : null,
        shared: !!(n && n.shared),
      };
    }));
  }
  return { multi_charger: list.length > 1, chargers: out, share: lastShare };
};

// What every charger may use of the connection (sharing.js).
function shareConnection(s, steps) {
  const grid = s.grid[0] || null;
  const states = steps.length ? steps[0].step.states : [];
  const num = (id) => {
    const st = id ? states.find((x) => x.entity_id === id) : null;
    const n = st ? Number(st.state) : NaN;
    if (!Number.isFinite(n)) return null;
    const unit = (st.attributes && st.attributes.unit_of_measurement) || '';
    return /^kW$/i.test(unit) ? n * 1000 : n;
  };
  const list = steps.map(({ id, step }, i) => {
    const e = step.entry;
    const r = step.planResult && step.planResult.reliability;
    const chosen = chosenMethods(step.methods, step.rules);
    const maxA = (step.planResult && step.planResult.charger && step.planResult.charger.max_current) || 16;
    return {
      id,
      name: (step.planResult && step.planResult.vehicle && step.planResult.vehicle.name) || step.charger.name,
      want: e.want,
      amps: e.amps || maxA,
      can_set_current: !!(chosen && chosen.current),
      solar: !!e.solar,
      power_w: Number.isFinite(e.power_w) ? e.power_w : 0,
      phases: step.charger.phases === 1 ? 1 : 3,
      priority: {
        code: e.code,
        protect: !!(r && r.protect),
        latest_safe_start: r ? r.latest_safe_start : null,
        departure: step.planResult && step.planResult.departure ? step.planResult.departure.time : null,
      },
      order: i,
    };
  });
  let availableA = null;
  let how = 'no_grid';
  if (grid && grid.load_balancer) how = 'load_balancer';
  else if (grid && grid.main_fuse > 0) {
    const phaseA = [grid.current_l1_entity, grid.current_l2_entity, grid.current_l3_entity].map(num).filter((x) => x != null);
    const net = grid.net_entity ? num(grid.net_entity) : grid.import_entity && num(grid.import_entity) != null ? num(grid.import_entity) - (num(grid.export_entity) ?? 0) : null;
    const chargersW = list.reduce((a, c) => a + c.power_w, 0);
    const chargersA = list.reduce((a, c) => a + c.power_w / 230 / c.phases, 0);
    availableA = sharing.available({ mainFuse: grid.main_fuse, phases: grid.phases, gridA: phaseA.length ? Math.max(...phaseA) : null, gridW: Number.isFinite(net) ? net : null, chargersW, chargersA });
    how = phaseA.length ? 'phase_currents' : Number.isFinite(net) ? 'net_power' : 'main_fuse';
  }
  const { order, result } = sharing.share(list, availableA);
  lastShare = { at: Date.now(), how, available_a: availableA == null ? null : Math.round(availableA * 10) / 10, order, result, main_fuse: grid ? grid.main_fuse : null };
  return result;
}

// Plans of every charger (more chargers), or the one charger.
async function refreshAll(reason, opts = {}) {
  const s = settings.load();
  const list = chargersList(s);
  if (list.length <= 1) return refreshPlan(reason, opts);
  const out = [];
  for (const c of list) {
    out.push(await scope.run(c.id, () => refreshPlan(reason, { ...opts, noControl: true }).catch((err) => { ha.warn(`Plan (${c.name}) failed:`, err.message); return null; })));
  }
  await controlSite().catch((err) => ha.warn('Control step failed:', err.message));
  return out[0];
}

// Time as the user reads it, e.g. "Thu 03:10".
function hmLocal(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ha.state.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

// After a start or pause, check a few minutes later that the charger really
// followed. If not, log it and send a notification.
const CHECK_AFTER_MS = Number(process.env.SCP_CHECK_AFTER_MS) || 5 * 60000;

async function afterSent(on, command, reason, extraText = '') {
  ST().pendingCheck = { on, at: Date.now(), service: command.service };
  ST().lastCommandInfo = `${on ? 'start' : 'pause'} at ${hmLocal(Date.now())}`;
  await notifier.notify('startstop', on ? 'Charging started' : 'Charging paused', `${reason}${extraText}.`);
}

async function commandFailed(on, err) {
  await notifier.notify('problem', 'Charger command failed', `Could not ${on ? 'start' : 'pause'} the charger: ${err}`, { key: `fail:${on}`, minGapMs: 30 * 60000 });
}

async function checkReaction(entry) {
  if (!ST().pendingCheck || Date.now() - ST().pendingCheck.at < CHECK_AFTER_MS) return;
  const { on, service } = ST().pendingCheck;
  ST().pendingCheck = null;
  if (entry.plugged === false) return; // unplugged meanwhile: nothing to check
  // The Equalizer starts charging only when there is surplus.
  if (on && entry.solar_equalizer && entry.code === 'solar') return;
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

// After a start you asked for (Charge now, manual test), the app does not
// pause the charger for a few minutes, whatever a calculation says. Only
// unplugging ends it earlier.
const MANUAL_GRACE_MS = 3 * 60000;

async function sendLive(entry, chosen) {
  const c = entry.commands.find((x) => x.what === 'start charging' || x.what === 'pause charging');
  if (!c) return;
  if (ST().lastManual && Date.now() - ST().lastManual.at < MANUAL_GRACE_MS && (c.what === 'start charging') !== ST().lastManual.on) {
    entry.held = true;
    ha.debug('Not sending', c.what, '- you', ST().lastManual.on ? 'started' : 'stopped', 'charging less than 3 minutes ago');
    return;
  }
  const key = JSON.stringify([c.service, c.data, c.target]);
  if (ST().lastLiveSend && ST().lastLiveSend.key === key && Date.now() - ST().lastLiveSend.at < LIVE_RETRY_MS) {
    entry.waiting = true;
    return;
  }
  const line = { ...entry, time: Date.now(), live: true, commands: [c], sent: false };
  try {
    await ha.sendControl(c, controller.allowedFor(chosen && chosen.start_stop));
    line.sent = true;
    entry.sent = true;
    // Only throttle a command that Home Assistant accepted. A transient
    // failure must be retried at the next control step, not hidden for 15 min.
    ST().lastLiveSend = { key, at: line.time };
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

// Short lists for the rules: entities of the car first, then entities whose
// name fits (and whatever is chosen now), instead of every helper in Home
// Assistant.
async function ruleEntityOptions(s, states, rules) {
  let carIds = new Set();
  const carDevices = new Set(s.vehicles.map((x) => x.device_id).filter(Boolean));
  if (carDevices.size) {
    try {
      const { entities } = await loadRegistries();
      carIds = new Set(entities.filter((e) => carDevices.has(e.device_id)).map((e) => e.entity_id));
    } catch {
      // no car group
    }
  }
  const text = (x) => `${x.entity_id} ${(x.attributes && x.attributes.friendly_name) || ''}`.toLowerCase();
  const opt = (x) => ({
    entity_id: x.entity_id,
    name: (x.attributes && x.attributes.friendly_name) || x.entity_id,
    state: x.state,
    group: carIds.has(x.entity_id) ? 'car' : 'other',
  });
  const order = (a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group === 'car' ? -1 : 1);
  const pick = (filter, chosen) => states.filter((x) => filter(x) || x.entity_id === chosen).map(opt).sort(order);
  const onOff = /^(input_boolean|switch|binary_sensor)\./;
  const preheatWords = /precondition|pre[ _-]?condition|preheat|pre[ _-]?heat|hvac|airco|air[ _-]?con|voorverwarm|voorkoel/;
  const percent = (x) => /^(number|sensor|input_number)\./.test(x.entity_id) && x.attributes && x.attributes.unit_of_measurement === '%';
  return {
    preheat: pick((x) => onOff.test(x.entity_id) && (preheatWords.test(text(x)) || (carIds.has(x.entity_id) && /climate|heat|cool/.test(text(x)))), rules.preheat_entity),
    min_soc: pick((x) => percent(x) && /min(imum)?/.test(text(x)) && (carIds.has(x.entity_id) || /charg|soc|battery|accu|laad|ev\b/.test(text(x))), rules.min_soc_entity),
  };
}

routes['GET /api/control'] = async () => {
  const s = settings.load();
  if (!ST().planCache) await refreshPlan('on request').catch(() => {});
  else if (!ST().lastDryRun) await runDryRun(ST().planCache.result).catch(() => {});
  const charger = currentCharger(s);
  const methods = charger ? await currentControlMethods(charger).catch(() => null) : null;
  const rules = rulesFor(s);
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
    options: await ruleEntityOptions(s, states, rules),
    now: ST().lastDryRun,
    car_limit: await carChargeLimit(currentVehicle(s), states).catch(() => null),
    chosen_start_stop: (() => {
      const c = chosenMethods(methods, rules);
      const cmd = c && controller.startStopCommand(c.start_stop, true, methods && methods.device_id);
      return cmd ? cmd.service + (cmd.target && cmd.target.entity_id ? ` → ${cmd.target.entity_id}` : '') : null;
    })(),
    log: controller.recentLog(150),
  };
};

// Settings export / import (Settings › Diagnostics): a backup, and to move
// the settings to another install (for example the dev version). Only the
// app's own settings; "Allow control" and the other options stay in Home
// Assistant's Configuration tab and are never part of it.
const SETTINGS_KEYS = ['vehicles', 'multi_car', 'chargers', 'multi_charger', 'grid', 'prices', 'planning', 'departures', 'control', 'notify', 'solar', 'battery', 'setup_done'];
const EXPORT_FORMAT = 'smart-charging-planner-settings';

routes['GET /api/settings/export'] = async () => {
  const s = settings.load();
  const out = {};
  for (const k of SETTINGS_KEYS) if (s[k] !== undefined) out[k] = s[k];
  // The battery's remembered values (Tesla reserve, Sessy strategy) belong to this install only.
  if (out.battery) out.battery = { ...out.battery, saved: null };
  return {
    format: EXPORT_FORMAT,
    format_version: 1,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    charge_mode: chargeMode.current(true),
    settings: out,
  };
};

// Check an export against this Home Assistant. dryRun: only report.
async function importSettings(body, dryRun) {
  if (!body || body.format !== EXPORT_FORMAT || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    throw badRequest('This is not a Smart Charging Planner settings file');
  }
  if (Number(body.format_version) > 1) throw badRequest('This file comes from a newer version of the app; update the app first');
  const unknown = Object.keys(body.settings).filter((k) => !SETTINGS_KEYS.includes(k));
  if (unknown.length) throw badRequest(`Unknown parts in the file: ${unknown.join(', ')}`);
  validateImportSettings(body.settings);
  const next = { ...settings.load() };
  for (const k of SETTINGS_KEYS) if (body.settings[k] !== undefined) next[k] = body.settings[k];

  const { entities, devices, states } = await loadRegistries();
  const notes = [];
  // Entities the settings use that this Home Assistant does not have.
  const ids = new Set();
  JSON.stringify(next, (k, v) => { if (typeof v === 'string' && /^(sensor|binary_sensor|switch|number|select|button|input_number|input_datetime|input_boolean|calendar)\.[a-z0-9_]+$/.test(v)) ids.add(v); return v; });
  const missing = [...ids].filter((id) => !states.some((x) => x.entity_id === id)).sort();
  if (missing.length) notes.push(`Not found in this Home Assistant: ${missing.join(', ')}`);
  // SAFETY: the same checks as when you save these parts by hand.
  next.vehicles = (next.vehicles || []).map((v) => {
    if (!v || !v.charge_limit_entity) return v;
    const reg = entities.find((e) => e.entity_id === v.charge_limit_entity);
    const st = states.find((x) => x.entity_id === v.charge_limit_entity);
    if (!reg || !st || (v.device_id && reg.device_id !== v.device_id) || !isChargeLimit(reg, st)) {
      notes.push(`The charge limit of ${v.name || 'the car'} was left out: it is not on the car's device here`);
      return { ...v, charge_limit_entity: null };
    }
    return v;
  });
  if (next.vehicles.length > MAX_VEHICLES) {
    notes.push(`Only the first ${MAX_VEHICLES} cars were taken`);
    next.vehicles = next.vehicles.slice(0, MAX_VEHICLES);
  }
  settings.vehicleIds(next.vehicles);
  if (Array.isArray(next.chargers)) {
    if (next.chargers.length > MAX_CHARGERS) {
      notes.push(`Only the first ${MAX_CHARGERS} chargers were taken`);
      next.chargers = next.chargers.slice(0, MAX_CHARGERS);
    }
    settings.chargerIds(next.chargers);
    const carIds = new Set(next.vehicles.map((v) => v.id));
    next.chargers = next.chargers.map((c) => (c.vehicle_id && !carIds.has(c.vehicle_id) ? { ...c, vehicle_id: null } : c));
  }
  const b = next.battery;
  if (b && b.soc_entity) {
    const found = battery.detectBatteries(entities, devices, states).find((c) => c.soc_entity === b.soc_entity && c.platform === b.platform);
    if (!found) {
      next.battery = { ...b, enabled: false, platform: null, device_id: null, soc_entity: null, power_entity: null, saved: null };
      notes.push('The home battery was left out: it was not found here');
    } else {
      next.battery = { ...b, device_id: found.device_id, power_entity: found.power_entity, saved: null };
    }
  }
  const sol = next.solar;
  if (sol && sol.solar_control === 'equalizer') {
    const eq = equalizer.detectEqualizer(entities, states, devices);
    if (!eq) {
      next.solar = { ...sol, solar_control: 'app', equalizer: null };
      notes.push('Solar by the Easee Equalizer was switched to the app: no Equalizer found here');
    } else next.solar = { ...sol, equalizer: { device_id: eq.device_id, switch_entity: eq.switch_entity, name: eq.name } };
  }
  if (next.notify && next.notify.service) {
    const choices = await notifyOptions().catch(() => []);
    if (!choices.some((c) => c.id === next.notify.service)) {
      next.notify = { service: null };
      notes.push('Notifications were switched off: that notify action does not exist here');
    }
  }
  const summary = {
    from_version: body.app_version || null,
    exported_at: body.exported_at || null,
    vehicle: next.vehicles.length ? next.vehicles.map((v) => v.name || v.soc_entity).join(', ') : null,
    charger: next.chargers && next.chargers[0] ? next.chargers[0].name || next.chargers[0].status_entity : null,
    prices: next.prices && next.prices.source ? next.prices.source.name || next.prices.source.type : null,
    solar: !!(next.solar && next.solar.enabled),
    battery: !!(next.battery && next.battery.enabled),
    notes,
  };
  if (dryRun) return { ok: true, preview: true, summary };
  settings.save(next);
  if (['plan', 'plan_solar', 'solar'].includes(body.charge_mode)) {
    try { chargeMode.set(body.charge_mode); } catch { /* keep the current mode */ }
  }
  ST().controlMethods = null;
  solarFcCache = null;
  controller.clearLock();
  ST().planCache = null;
  ha.log(`Settings imported (from version ${body.app_version || 'unknown'})${notes.length ? `: ${notes.join('; ')}` : ''}`);
  await refreshPlan('settings imported', { fresh: true }).catch(() => {});
  return { ok: true, summary };
}

routes['POST /api/settings/import/preview'] = async (req) => importSettings(await readBody(req), true);
routes['POST /api/settings/import'] = async (req) => importSettings(await readBody(req), false);

// One notification when the car's data drops out, one when it is back (per car).
const carOffline = new Map(); // vehicle id -> { since }
function carDataChanged(vehicle, cd) {
  const name = vehicle.name || 'The car';
  const id = vehicle.id || 'car';
  const multi = cars(settings.load()).length > 1;
  const key = (k) => (multi ? `${k}:${id}` : k);
  if (cd && !cd.ok && !carOffline.has(id)) {
    carOffline.set(id, { since: Date.now() });
    const why = cd.reason === 'stale' ? 'has not been updated for a long time' : 'is not available';
    const what = cd.assumed ? `No earlier level is known, so the app plans as if it is at ${cd.estimate}%.` : `The app plans with an estimate (${cd.estimate}%: the last level ${cd.last_soc}% plus what the charger delivered since).`;
    ha.warn(`Car data: battery level of ${name} ${why}; estimate ${cd.estimate}%`);
    notifier.notify('problem', 'Car not reachable', `The battery level of ${name} ${why} (the car's cloud may be down). ${what} The car's charge limit is not changed until it is back.`, { key: key('car_offline'), minGapMs: 60 * 60000 }).catch(() => {});
  } else if (cd && cd.ok && carOffline.has(id)) {
    carOffline.delete(id);
    ha.log(`Car data: battery level of ${name} is back`);
    notifier.notify('problem', 'Car reachable again', `The battery level of ${name} is updated again. The plan uses the real level.`, { key: key('car_online'), minGapMs: 60 * 60000 }).catch(() => {});
  }
}

// "Download diagnostics" (Settings › Diagnostics): one file to attach to a bug
// report. Personal details are removed (see diagnostics.js).
routes['GET /api/diagnostics'] = async () => {
  const s = settings.load();
  const safe = async (fn) => { try { return await fn(); } catch (err) { return { error: err.message }; } };
  const { entities, devices, states } = await loadRegistries();
  const charger = currentCharger(s);
  const methods = charger ? await safe(() => currentControlMethods(charger)) : null;
  // The entities the settings use, with their state and the attributes that matter.
  const ids = new Set();
  JSON.stringify(s, (k, v) => { if (typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v) && !/^notify\./.test(v)) ids.add(v); return v; });
  const KEEP_ATTR = ['unit_of_measurement', 'device_class', 'state_class', 'options', 'min', 'max', 'step', 'surplusChargingCurrent'];
  const used = [...ids].sort().map((id) => {
    const st = states.find((x) => x.entity_id === id);
    const reg = entities.find((e) => e.entity_id === id);
    if (!st) return { entity_id: id, state: 'not found' };
    const attrs = Object.fromEntries(Object.entries(st.attributes || {}).filter(([k]) => KEEP_ATTR.includes(k)));
    return { entity_id: id, platform: reg ? reg.platform : null, state: st.state, last_changed: st.last_changed, attributes: attrs };
  });
  const p = ST().planCache ? ST().planCache.result : null;
  const detect = {
    chargers: await safe(async () => (await routes['GET /api/chargers/detect']()).candidates.map((c) => ({ integration: c.integration, suggested: c.suggested }))),
    vehicles: await safe(async () => (await routes['GET /api/vehicles/detect']()).candidates.map((c) => ({ platform: c.platform, soc_entity: c.soc_entity, plugged_entity: c.plugged_entity, charge_limit_entity: c.charge_limit_entity }))),
    batteries: await safe(() => battery.detectBatteries(entities, devices, states).map((c) => ({ platform: c.platform, soc_entity: c.soc_entity, power_entity: c.power_entity, control: battery.controlFor(c, entities, states, null).supported || [] }))),
    equalizer: await safe(() => equalizer.detectEqualizer(entities, states, devices)),
    pv_sensors: await safe(() => solar.detectPvSensors(entities, states).slice(0, 5).map((x) => ({ entity_id: x.entity_id, brand: x.brand }))),
  };
  return diagnostics.redact({
    generated_at: new Date().toISOString(),
    app_version: APP_VERSION,
    ha_version: ha.state.version,
    time_zone: ha.state.timeZone,
    connected: ha.state.connected,
    options,
    settings: s,
    control_check: methods,
    detected: detect,
    entities: used,
    plan: p ? {
      computed_at: p.computed_at,
      notes: p.plan && p.plan.notes,
      planning: p.planning,
      departure: p.departure ? { time: p.departure.time, soc: p.departure.soc, source: p.departure.source } : null,
      blocks: p.plan && p.plan.blocks ? p.plan.blocks.map((b) => ({ start: b.start, end: b.end, kwh: b.kwh, price: b.price, solar_kwh: b.solar_kwh || 0 })) : [],
      prices: p.prices ? { count: p.prices.length, first: p.prices[0] && p.prices[0].start, last: p.prices.length ? p.prices[p.prices.length - 1].end : null, forecast: p.prices.filter((x) => x.forecast).length } : null,
      vehicle: p.vehicle ? { mode: p.vehicle.mode, soc: p.vehicle.soc, soc_state: p.vehicle.soc_state, car_data: p.vehicle.car_data, plugged: p.vehicle.plugged } : null,
      share: lastShare,
      cars: p.cars ? { count: p.cars.list.length, connected_id: p.cars.connected_id, how: p.cars.how, ask: p.cars.ask, candidates: p.cars.candidates, conflict: p.cars.conflict, chosen: p.cars.chosen, charger_plugged: p.cars.charger_plugged } : null,
      charge_for: p.charge_for, boost: p.boost, solar: p.solar, battery: p.battery ? { enabled: p.battery.enabled, soc: p.battery.soc, control: p.battery.control, error: p.battery.error || null } : null,
    } : null,
    now: ST().lastDryRun,
    control_log: controller.recentLog(100),
    app_log: ha.recentLog().slice(-200).map(diagnostics.redactLine),
  });
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

// Automations (and scripts they call) that also use the charger's start/stop
// entity, the charger device or the car's charge limit. They may fight with
// the app. Only a warning: the app never turns automations off.
async function findConflicts() {
  if (ST().conflictsCache && Date.now() - ST().conflictsCache.at < 5 * 60000) return ST().conflictsCache.result;
  const s = settings.load();
  const charger = currentCharger(s);
  const result = { items: [], dismissed: (s.conflicts_dismissed || []).slice(), checked: [] };
  if (!charger) return result;
  const rules = rulesFor(s);
  const [methods, states] = await Promise.all([currentControlMethods(charger).catch(() => null), ha.call({ type: 'get_states' })]);
  const chosen = chosenMethods(methods, rules);
  const m = chosen && chosen.start_stop;
  const watched = [];
  if (m && m.entity_id) watched.push({ item_type: 'entity', item_id: m.entity_id, what: 'the charger start/stop' });
  if (m && m.start_entity) watched.push({ item_type: 'entity', item_id: m.start_entity, what: 'the charger start/stop' });
  if (m && m.stop_entity) watched.push({ item_type: 'entity', item_id: m.stop_entity, what: 'the charger start/stop' });
  if (m && /^action_/.test(m.type) && methods && methods.device_id) watched.push({ item_type: 'device', item_id: methods.device_id, what: 'the charger' });
  for (const vehicle of cars(s)) {
    const lim = await carChargeLimit(vehicle, states).catch(() => null);
    if (lim && lim.entity_id) watched.push({ item_type: 'entity', item_id: lim.entity_id, what: cars(s).length > 1 ? `the charge limit of ${vehicle.name}` : "the car's charge limit" });
  }
  const stateOf = (id) => states.find((x) => x.entity_id === id);
  const found = new Map(); // automation entity_id -> { uses: Set, via: Set }
  const add = (id, what, via) => {
    if (!found.has(id)) found.set(id, { uses: new Set(), via: new Set() });
    found.get(id).uses.add(what);
    if (via) found.get(id).via.add(via);
  };
  for (const w of watched) {
    result.checked.push(w.item_id);
    let rel;
    try {
      rel = await ha.call({ type: 'search/related', item_type: w.item_type, item_id: w.item_id });
    } catch (err) {
      ha.debug('search/related failed for', w.item_id, err.message);
      continue;
    }
    for (const a of (rel && rel.automation) || []) add(a, w.what);
    // One step further: automations that call a script that uses it.
    for (const sc of (rel && rel.script) || []) {
      try {
        const rel2 = await ha.call({ type: 'search/related', item_type: 'entity', item_id: sc });
        for (const a of (rel2 && rel2.automation) || []) add(a, w.what, sc);
      } catch {
        // ignore
      }
    }
  }
  for (const [id, f] of found) {
    const st = stateOf(id);
    if (!st || st.state !== 'on') continue; // only enabled automations
    result.items.push({
      entity_id: id,
      name: (st.attributes && st.attributes.friendly_name) || id,
      uses: [...f.uses],
      via: [...f.via],
      dismissed: result.dismissed.includes(id),
    });
  }
  result.items.sort((a, b) => a.dismissed - b.dismissed || a.name.localeCompare(b.name));
  ST().conflictsCache = { at: Date.now(), result };
  return result;
}

routes['GET /api/conflicts'] = async (req) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('refresh') === '1') ST().conflictsCache = null;
  return findConflicts();
};

routes['POST /api/conflicts/dismiss'] = async (req) => {
  const body = await readBody(req);
  const id = String(body.entity_id || '');
  if (!/^automation\./.test(id)) throw badRequest('Not an automation');
  const s = settings.load();
  const list = new Set(s.conflicts_dismissed || []);
  if (body.undo === true) list.delete(id); else list.add(id);
  s.conflicts_dismissed = [...list];
  settings.save(s);
  ST().conflictsCache = null;
  return findConflicts();
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
  const methods = {
    start_stop_id: b.start_stop_id ? String(b.start_stop_id).slice(0, 200) : null,
    current_id: b.current_id ? String(b.current_id).slice(0, 200) : null,
  };
  // More chargers: another charger keeps its own start/stop and current method.
  const charger = currentCharger(s);
  const first = chargersList(s)[0];
  const own = charger && first && charger.id !== first.id;
  if (own) s.chargers.find((c) => c.id === charger.id).methods = methods;
  const prev = s.control || {};
  s.control = {
    start_stop_id: own ? prev.start_stop_id || null : methods.start_stop_id,
    current_id: own ? prev.current_id || null : methods.current_id,
    min_soc_enabled: b.min_soc_enabled === true,
    min_soc: num(b.min_soc, 'Minimum battery level', 0, 100),
    min_soc_entity: ent(b.min_soc_entity, /^(number|sensor|input_number)\./),
    min_soc_max_price: num(b.min_soc_max_price, 'Maximum price for the minimum', -1, 5, true),
    preheat_entity: ent(b.preheat_entity, /^(input_boolean|switch|binary_sensor)\./),
    force_minutes: num(b.force_minutes, 'Force window', 0, 600),
    hysteresis: num(b.hysteresis, 'Hysteresis', 0, 1),
    ready_guard_enabled: b.ready_guard_enabled !== false,
    ready_guard_margin_minutes: num(b.ready_guard_margin_minutes ?? 30, 'Ready Guard margin', 30, 120),
    battery_care_enabled: b.battery_care_enabled !== false,
    battery_care_soc: num(b.battery_care_soc ?? 80, 'Battery care level', 50, 95),
    battery_care_hours: num(b.battery_care_hours ?? 4, 'Battery care hours', 1, 24),
    car_limit_off: b.car_limit_off === true,
    min_choice: num(b.min_choice ?? 30, 'Default minimum for quick choices', 20, 45),
  };
  settings.save(s);
  ST().lastDryRun = null;
  ST().conflictsCache = null;
  return { ok: true, control: rulesFor(s) };
};

function startBackgroundRefresh() {
  const reconnect = !!refreshTimer;
  // onConnect runs after every HA reconnect. Recalculate immediately before
  // the one-minute control loop may use a plan made with stale HA state.
  refreshAll(reconnect ? 'Home Assistant reconnected' : 'start', { fresh: reconnect }).catch(() => {});
  if (reconnect) return;
  const every = options.refresh_minutes * 60000;
  ha.log(`Background refresh every ${options.refresh_minutes} minute(s)`);
  refreshTimer = setInterval(() => {
    if (ha.state.connected) refreshAll('timer').catch(() => {});
  }, every);
  // With control on, check the charger every minute between plan refreshes,
  // so plugging in or the start of a planned period is followed quickly.
  if (options.allow_control === true && every > 60000) {
    setInterval(() => {
      if (ha.state.connected && ST().planCache && !ST().planRunning) {
        runDryRun(ST().planCache.result).catch((err) => ha.warn('Control step failed:', err.message));
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

// Forecast prices after the real ones, as all-in prices plus the margin.
// The margin makes the app only wait for a forecast that is clearly cheaper.
async function forecastPrices(cfg, tz, fromMs) {
  const f = cfg.forecast;
  const fc = await fetchForecast(f, tz, fromMs);
  const margin = Number(f.margin) || 0;
  const costs = { ...cfg, price_type: f.price_type || cfg.price_type };
  return {
    margin,
    warnings: fc.warnings,
    prices: fc.prices.map((p) => {
      const expected = totalPrice(p.price, costs);
      return { ...p, forecast: true, expected, total: expected + margin };
    }),
  };
}

// For the Prices page: what the forecast adds after the real prices.
async function forecastSummary(cfg, result) {
  if (!cfg.forecast) return null;
  const tz = ha.state.timeZone;
  const realEnd = result.prices.length ? result.prices[result.prices.length - 1].end : null;
  if (!realEnd) return { entity_id: cfg.forecast.entity_id, error: 'No real prices, so the forecast is not used' };
  try {
    const fc = await forecastPrices(cfg, tz, realEnd);
    const list = fc.prices;
    const avg = list.length ? list.reduce((a, p) => a + p.expected, 0) / list.length : null;
    const low = list.length ? list.reduce((a, p) => (p.expected < a.expected ? p : a)) : null;
    return {
      entity_id: cfg.forecast.entity_id,
      margin: fc.margin,
      count: list.length,
      from: list.length ? list[0].start : null,
      until: list.length ? list[list.length - 1].end : null,
      average: avg,
      lowest: low ? { start: low.start, end: low.end, total: low.expected } : null,
      warnings: fc.warnings,
    };
  } catch (err) {
    return { entity_id: cfg.forecast.entity_id, error: err.message };
  }
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
  } else if (src.type === 'fixed') {
    const f = body.fixed || {};
    const price = (v, name) => {
      const n = Number(v);
      if (!(n >= 0 && n <= 5)) throw badRequest(`${name} must be between 0 and 5 per kWh`);
      return n;
    };
    const time = (v, name) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw badRequest(`${name} must be a time like 23:00`);
      return String(v);
    };
    const mode = f.mode === 'day_night' ? 'day_night' : 'single';
    source = { id: 'fixed', type: 'fixed', mode, normal: price(f.normal, 'Tariff') };
    if (mode === 'day_night') {
      source.low = price(f.low, 'Low (night) tariff');
      source.low_from = time(f.low_from, 'Low tariff from');
      source.low_to = time(f.low_to, 'Low tariff until');
      source.weekend_low = f.weekend_low === true;
      if (source.low_from === source.low_to) throw badRequest('Low tariff from and until must differ');
    }
    source.name = mode === 'day_night' ? 'Day/night tariff' : 'Fixed tariff';
    // The tariff is entered all-in, as on the energy bill.
    return { source, price_type: 'all_in', purchase_fee: 0, energy_tax: 0, vat_percent: 0 };
  } else {
    throw badRequest('Choose a price source');
  }
  const types = ['market_excl_vat', 'market_incl_vat', 'all_in'];
  const num = (v, name, min, max) => {
    const n = v === '' || v == null ? 0 : Number(v);
    if (!(n >= min && n <= max)) throw badRequest(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const priceType = types.includes(body.price_type) ? body.price_type : 'market_excl_vat';
  // Optional forecast sensor for the days after tomorrow.
  let forecast = null;
  const fcEntity = String(body.forecast_entity || '');
  if (fcEntity) {
    if (!/^sensor\.[a-z0-9_]+$/.test(fcEntity)) throw badRequest('Invalid forecast sensor');
    forecast = {
      entity_id: fcEntity,
      price_type: types.includes(body.forecast_price_type) ? body.forecast_price_type : priceType,
      margin: num(body.forecast_margin ?? 0.02, 'Forecast margin', 0, 0.5),
    };
  }
  return {
    source,
    price_type: priceType,
    purchase_fee: num(body.purchase_fee, 'Purchase fee', -1, 1),
    energy_tax: num(body.energy_tax, 'Energy tax', 0, 1),
    vat_percent: num(body.vat_percent ?? 21, 'VAT', 0, 50),
    forecast,
  };
}

// ---------------------------------------------------------------------------
// Web server (served through Home Assistant ingress)
// ---------------------------------------------------------------------------

// SAFETY: only the Home Assistant ingress proxy may talk to the app. Other
// apps (add-ons) on the internal network are refused. Loopback is allowed
// for processes inside this container only.
const INGRESS_PROXY = new Set(['172.30.32.2', '::ffff:172.30.32.2', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ALLOW_ANY_CLIENT = process.env.SCP_ALLOW_ANY_CLIENT === '1'; // development only

const server = http.createServer(async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (!ALLOW_ANY_CLIENT && !INGRESS_PROXY.has(remote)) {
    ha.warn('Refused request from', remote, '- only Home Assistant ingress is allowed');
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];

  // SAFETY against requests from other websites (CSRF): changes must be
  // JSON (which a plain web form cannot send without the browser asking
  // first) and must not come from another site.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const fetchSite = String(req.headers['sec-fetch-site'] || '');
    if (fetchSite === 'cross-site' || (type !== 'application/json' && (req.headers['content-length'] || req.headers['transfer-encoding']))) {
      ha.warn('Refused', req.method, url.pathname, '- not a same-site JSON request');
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
  }

  if (route) {
    if (url.pathname !== '/api/status' && !ha.state.connected) {
      sendJson(res, 503, { error: 'Not connected to Home Assistant' });
      return;
    }
    try {
      // More chargers: ?charger=… says which charger the request is for.
      const wanted = url.searchParams.get('charger');
      const all = settings.load();
      if (wanted && !chargersList(all).some((c) => c.id === wanted)) throw badRequest('That charger is not in the app (any more)');
      const body = await scope.run(wanted || (chargersList(all)[0] || {}).id, () => route(req));
      if (req.method !== 'GET' && url.pathname !== '/api/boost/preview') {
        for (const x of ST.all.values()) x.planCache = null; // settings changed: plans are outdated
      }
      sendJson(res, 200, body);
    } catch (err) {
      ha.log('Error on', req.method, url.pathname, '-', err.message);
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && STATIC_FILES.has(url.pathname)) {
    const [file, type] = STATIC_FILES.get(url.pathname);
    fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load page');
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
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

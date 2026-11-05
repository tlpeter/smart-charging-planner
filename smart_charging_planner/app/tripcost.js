'use strict';

// How much battery a trip costs: the distance from the destination in the
// calendar event (OpenStreetMap), and the car's use per km.
//
// Distance: the address is looked up with OpenStreetMap Nominatim, the road
// distance with OSRM (OpenStreetMap routing). When OSRM cannot be reached:
// the straight line × 1.3 (an estimate, marked as such). Every place and
// route is looked up once and remembered (/data/places.json). Lookups run in
// the background, one per second (Nominatim's usage policy), so a plan never
// waits for them: until a place is known, the trip shows "looking up".
//
// Use per km, best first: learned from your own trips (the battery level when
// the car left and when it came back, and the distance of that trip), the
// car's range sensor (range at the battery level now), or the consumption in
// Settings › Vehicle (default 18 kWh/100 km) and the battery capacity.
// Plus 10 % margin (motorway).
//
// Use more in the cold (#56, per car, off by default): below 15 °C the use
// goes up by a percentage per degree colder (the setting, or learned from
// trips at different temperatures). Not for the range sensor: the car's own
// estimate already includes the weather of now.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'places.json');
const GEOCODE_URL = process.env.SCP_GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL = process.env.SCP_ROUTE_URL || 'https://router.project-osrm.org/route/v1/driving';

// Routing privacy (#31). What may be sent to look up a trip's distance:
//  - 'osm':     the public OpenStreetMap services (Nominatim for the address,
//               the OSRM demo server for the road distance);
//  - 'custom':  your own Nominatim- and OSRM-compatible servers;
//  - 'offline': nothing leaves Home Assistant: zones (straight line × 1.3),
//               distances you enter in My places, and places looked up before;
//  - 'off':     no trip distances at all.
// null: not chosen yet; works like 'offline' until you choose.
const ROUTING_MODES = ['osm', 'custom', 'offline', 'off'];
let routingConfig = () => ({ mode: 'osm' });
function setRouting(fn) {
  routingConfig = typeof fn === 'function' ? fn : () => fn || {};
}
function routing() {
  const r = routingConfig() || {};
  const mode = ROUTING_MODES.includes(r.mode) ? r.mode : null;
  return {
    mode,
    online: mode === 'osm' || mode === 'custom',
    geocode_url: mode === 'custom' && r.geocode_url ? r.geocode_url : GEOCODE_URL,
    route_url: mode === 'custom' && r.route_url ? r.route_url : ROUTE_URL,
  };
}
const GAP_MS = Number(process.env.SCP_GEOCODE_GAP_MS) || 1100;
const ROAD_FACTOR = 1.3;
const MARGIN = 1.1;
const DEFAULT_KWH_100KM = 18;
const COLD_BASE_C = 15; // no correction at or above this temperature
const COLD_DEFAULT_PCT = 1.5; // extra use per degree below COLD_BASE_C
const COLD_MAX_FACTOR = 1.8; // at most +80 %
const SAMPLES = 20; // learned trips kept with their temperature
const RETRY_MS = 24 * 3600000; // a place that was not found is tried again after a day
let userAgent = 'SmartChargingPlanner (Home Assistant app; https://github.com/tlpeter/smart-charging-planner)';

let cache;
function load() {
  if (!cache) cache = readJson(FILE, null) || {};
  cache.places = cache.places || {};
  cache.routes = cache.routes || {};
  cache.learned = cache.learned || {}; // vehicle id -> { pct_per_km, trips, at }
  cache.away = cache.away || {}; // vehicle id -> { soc, km, at } while the car is on a trip
  return cache;
}
function save() {
  try { writeJsonAtomic(FILE, cache); } catch { /* best effort */ }
}

const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Words that are a place for you but not an address ("Work", "Werk", "Home", "Thuis").
const GENERIC = new Set(['werk', 'work', 'kantoor', 'office', 'school', 'sport', 'gym', 'training', 'thuis', 'home', 'huis', 'naar huis', 'boodschappen', 'winkel', 'shopping', 'opa', 'oma', 'ouders', 'parents']);
const HOME = /^(thuis|huis|home|naar huis|naar thuis|naar home|terug|back home|to home)$/i;

// My places (Plan › My places): a name you use in the calendar ("Work",
// "Gym") with its address. The event's location, or the title
// ("To Work", "Naar Werk"), is matched against the names.
let savedPlaces = () => [];
function setSavedPlaces(fn) {
  savedPlaces = typeof fn === 'function' ? fn : () => fn || [];
}
function savedPlace(text) {
  const t = norm(text);
  if (!t) return null;
  return (savedPlaces() || []).find((p) => p && norm(p.name) === t && (String(p.address || '').trim() || Number(p.km) > 0)) || null;
}
// Zones in Home Assistant (Settings › Areas & zones), such as "Werk": a name
// with GPS coordinates, used like My places. The home zone is your home.
let zones = [];
function setZones(states) {
  zones = (states || []).filter((x) => /^zone\./.test(x.entity_id) && x.entity_id !== 'zone.home' && x.attributes
    && Number.isFinite(Number(x.attributes.latitude)) && Number.isFinite(Number(x.attributes.longitude)))
    .map((x) => ({
      entity_id: x.entity_id,
      name: String(x.attributes.friendly_name || x.entity_id.slice(5)),
      keys: [norm(x.attributes.friendly_name), norm(x.entity_id.slice(5).replace(/_/g, ' '))].filter(Boolean),
      lat: Number(x.attributes.latitude),
      lon: Number(x.attributes.longitude),
    }));
}
function zoneList() {
  return zones.map(({ entity_id, name, lat, lon }) => ({ entity_id, name, lat, lon }));
}
// A name you use: My places first, then a zone.
function lookupName(text) {
  const saved = savedPlace(text);
  if (saved) return { location: saved.address || null, place: saved.name, kind: 'saved', ...(Number(saved.km) > 0 ? { manual_km: Number(saved.km) } : {}) };
  const t = norm(text);
  const z = t ? zones.find((x) => x.keys.includes(t)) : null;
  return z ? { location: z.name, place: z.name, kind: 'zone', point: { lat: z.lat, lon: z.lon } } : null;
}

// The name in a title: "Naar Werk", "To the office", "Werk".
function titleName(title) {
  return String(title || '').trim().replace(/^(naar|to|nach|vers|à)\s+(de |het |the )?/i, '').trim();
}
function titlePlace(title) {
  return lookupName(titleName(title));
}
// The name to suggest for My places when a trip's distance is not known.
function askName(location, title) {
  const n = titleName(title);
  if (n && !isHome(n) && n.length <= 40) return n;
  const l = String(location || '').trim();
  return l && !isHome(l) && l.length <= 40 ? l : null;
}

// Which location to use for a trip: a saved place by its location, the
// location itself when it can be looked up, or a saved place by the title.
// Returns { location, place } (place: the saved place's name, or null).
function placeFor(location, title) {
  const byLoc = lookupName(location);
  if (byLoc) return byLoc;
  if (isHome(location)) return { location, place: null };
  // The title's place wins, unless the location is a real address (with a
  // number) that OpenStreetMap can find.
  const byTitle = titlePlace(title);
  if (byTitle && (!location || !looksLikePlace(location) || !/\d/.test(location) || peek(location) === 'not_found')) {
    return byTitle;
  }
  return { location: location || null, place: null };
}
// What is known about a place without looking it up: 'found', 'not_found' or null.
function peek(text) {
  const p = load().places[norm(text)];
  return !p ? null : p.found ? 'found' : 'not_found';
}

function isHome(text) {
  return HOME.test(String(text || '').trim());
}

// Something Nominatim can find: an address (a number or a comma) or a place
// name that is not one of the generic words.
function looksLikePlace(text) {
  const t = norm(text);
  if (!t || t.length < 3 || GENERIC.has(t)) return false;
  return /\d|,/.test(t) || /^[\p{L}][\p{L}'’. -]{2,}$/u.test(t);
}

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Background lookups, one at a time.

const queue = [];
const queued = new Set();
let running = false;

function enqueue(key, job) {
  if (queued.has(key)) return;
  queued.add(key);
  queue.push({ key, job });
  if (!running) run();
}

async function run() {
  running = true;
  while (queue.length) {
    const { key, job } = queue.shift();
    // The choice may have changed while this lookup waited: send nothing then.
    if (!routing().online) {
      queued.delete(key);
      continue;
    }
    try {
      await job();
    } catch (err) {
      ha.debug('Trip distance lookup failed:', key, err.message);
    }
    queued.delete(key);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  running = false;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function geocode(text, country) {
  const q = new URLSearchParams({ q: text, format: 'json', limit: '1' });
  if (country) q.set('countrycodes', String(country).toLowerCase());
  const r = await getJson(`${routing().geocode_url}?${q}`);
  const hit = Array.isArray(r) && r[0];
  return hit && Number.isFinite(Number(hit.lat)) ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

// The route by road: { km, min } (min: the drive time, when the route service gives it).
async function routeKm(from, to) {
  const r = await getJson(`${routing().route_url}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`);
  const route = r && r.routes && r.routes[0];
  const m = route && route.distance;
  if (!Number.isFinite(m)) return null;
  const sec = route.duration;
  return { km: m / 1000, min: Number.isFinite(sec) && sec > 0 ? Math.round(sec / 60) : null };
}

// Drive time in minutes for a distance (#62): the route's own time when
// known, else an average of 70 km/h. null without a distance.
const AVG_KMH = 70;
function driveMinutes(km, min = null) {
  if (Number.isFinite(min) && min > 0) return { min, how: 'route' };
  if (!(km > 0)) return null;
  return { min: Math.max(1, Math.round((km / AVG_KMH) * 60)), how: 'estimate' };
}

// The distance from home to a place, from what is known now: { status, km, how }.
// status: 'home' | 'ok' | 'pending' (being looked up) | 'unknown' (not an
// address, or not found) | 'no_home' (Home Assistant has no home location).
function distance(location, home = ha.state.home, country = ha.state.country) {
  const text = String(location || '').trim();
  if (!text) return { status: 'unknown', reason: 'no_location' };
  if (isHome(text)) return { status: 'home', km: 0 };
  if (!looksLikePlace(text)) return { status: 'unknown', reason: 'not_an_address' };
  if (!home) return { status: 'no_home' };
  const rt = routing();
  if (rt.mode === 'off') return { status: 'unknown', reason: 'routing_off' };
  const c = load();
  const key = norm(text);
  const place = c.places[key];
  if (!rt.online && (!place || !place.found)) return { status: 'unknown', reason: rt.mode ? 'offline' : 'routing_not_chosen' };
  if (!place || (!place.found && Date.now() - place.at > RETRY_MS)) {
    enqueue(`place:${key}`, async () => {
      let p = null;
      try {
        // Not found: try again without the first part ("Northwind Labs,
        // Industrieweg 10, …" → "Industrieweg 10, …"): a company or place
        // name in front of the address.
        // First in the home country (a short address finds the place at
        // home, not one abroad); when nothing is found there, anywhere
        // (#49): a trip abroad.
        const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
        let asked = 0;
        for (const limit of country ? [country, null] : [null]) {
          for (let i = 0; i < parts.length && !p; i++) {
            const q = parts.slice(i).join(', ');
            if (i > 0 && !/\d/.test(q) && parts.length - i < 2) break; // only a country or town left
            if (asked++) await new Promise((r) => setTimeout(r, GAP_MS));
            p = await geocode(q, limit);
          }
          if (p) break;
        }
      } catch (err) {
        ha.debug('OpenStreetMap could not look up', text, '-', err.message);
        return; // not stored: tried again next time
      }
      load().places[key] = p ? { ...p, found: true, at: Date.now() } : { found: false, at: Date.now() };
      save();
      changed();
    });
    return { status: 'pending' };
  }
  if (!place.found) return { status: 'unknown', reason: 'not_found' };
  return toPoint(home, place, text);
}

// The distance from home to a known point (a found address, or a zone in
// Home Assistant): by road when OpenStreetMap has the route, else an estimate.
function pointDistance(point, home = ha.state.home) {
  if (!home) return { status: 'no_home' };
  if (routing().mode === 'off') return { status: 'unknown', reason: 'routing_off' };
  return toPoint(home, point, `${point.lat},${point.lon}`);
}
function toPoint(home, place, text) {
  const c = load();
  const straight = haversineKm(home, place);
  if (straight < 1) return { status: 'home', km: 0 };
  const rkey = `${home.lat.toFixed(4)},${home.lon.toFixed(4)}|${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  const route = c.routes[rkey];
  // A route saved before the drive time was kept (#62): asked once more for its time.
  const noTime = route && route.km != null && route.min === undefined;
  if (routing().online && (!route || noTime || (route.km == null && Date.now() - route.at > RETRY_MS))) {
    enqueue(`route:${rkey}`, async () => {
      let r = null;
      try {
        r = await routeKm(home, place);
      } catch (err) {
        ha.debug('OpenStreetMap route failed', text, '-', err.message);
      }
      const old = load().routes[rkey];
      // A failed time lookup keeps the km known before.
      load().routes[rkey] = r ? { km: r.km, min: r.min, at: Date.now() } : old && old.km != null ? { ...old, min: null } : { km: null, at: Date.now() };
      save();
      changed();
    });
  }
  if (route && route.km != null) return { status: 'ok', km: route.km, how: 'route', lat: place.lat, lon: place.lon, ...(Number.isFinite(route.min) ? { min: route.min } : {}) };
  return { status: 'ok', km: Math.round(straight * ROAD_FACTOR * 10) / 10, how: 'estimate', lat: place.lat, lon: place.lon };
}

// The cold correction of a car (#56): null when off. { extra, learned }:
// extra = % more use per degree below 15 °C.
// The trip log (#61) gives the real use per drive (odometer); with enough
// drives it replaces the learning from planned distances below.
let logProvider = null;
function setLogProvider(fn) {
  logProvider = typeof fn === 'function' ? fn : null;
}
function learnedRec(vehicleId) {
  if (!vehicleId) return null;
  let fromLog = null;
  try { fromLog = logProvider ? logProvider(vehicleId) : null; } catch { fromLog = null; }
  return fromLog || load().learned[vehicleId] || null;
}

// On for the car (#56). On by default since #61 (settings.js turns it on once).
function coldOn(vehicle) {
  return !!vehicle && vehicle.cold_correction === true;
}

function coldModel(vehicle) {
  if (!coldOn(vehicle)) return null;
  const set = Number(vehicle.cold_extra_pct);
  const fit = vehicle.id ? fitCold(learnedRec(vehicle.id)) : null;
  if (fit) return { extra: fit.extra, learned: true, base: fit.base, trips: fit.trips };
  return { extra: Number.isFinite(set) && set >= 0 ? set : COLD_DEFAULT_PCT, learned: false };
}

// How much more a car uses at a temperature: 1 = no correction.
function coldFactor(extraPct, temp) {
  if (!Number.isFinite(temp) || !(extraPct > 0)) return 1;
  return Math.min(COLD_MAX_FACTOR, 1 + (extraPct / 100) * Math.max(0, COLD_BASE_C - temp));
}

// Learn the extra use per degree from trips with a known temperature: at
// least 4, with at least 5 degrees between the coldest and the warmest (below
// 15 °C). A straight line through use against degrees below 15 °C; null when
// there is not enough spread or the line makes no sense.
function fitCold(learnedRec) {
  const pts = ((learnedRec && learnedRec.samples) || []).filter((x) => Number.isFinite(x.t) && x.v > 0)
    .map((x) => ({ x: Math.max(0, COLD_BASE_C - x.t), y: x.v }));
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 5) return null;
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const slope = sxy / sxx;
  const base = my - slope * mx;
  if (!(base > 0)) return null;
  const extra = Math.max(0, Math.min(5, (slope / base) * 100));
  return { extra: Math.round(extra * 100) / 100, base, trips: n };
}

// Battery % per km: from the range sensor (range at the level now), or the
// consumption and the battery capacity. null when neither is known.
// temp (°C): the temperature of the trip, for the cold correction (#56).
function pctPerKm(vehicle, states, soc, temp = null) {
  if (!vehicle) return null;
  const cold = coldModel(vehicle);
  const withCold = (use) => {
    if (!cold || use.how === 'range') return use;
    if (!Number.isFinite(temp)) return { ...use, cold: { temp: null, factor: 1, extra: cold.extra, learned: cold.learned } };
    const factor = coldFactor(cold.extra, temp);
    // Learned at different temperatures: the use at 15 °C from the line.
    const base = cold.learned && use.how === 'learned' ? cold.base : use.pct_per_km;
    return { ...use, pct_per_km: base * factor, cold: { temp, factor: Math.round(factor * 1000) / 1000, extra: cold.extra, learned: cold.learned } };
  };
  const learned = learnedRec(vehicle.id);
  if (learned && learned.trips >= 2 && learned.pct_per_km > 0) return withCold({ pct_per_km: learned.pct_per_km, how: 'learned', trips: learned.trips });
  const st = vehicle.range_entity ? states.find((x) => x.entity_id === vehicle.range_entity) : null;
  let range = st ? Number(st.state) : NaN;
  const unit = st && st.attributes ? String(st.attributes.unit_of_measurement || 'km') : 'km';
  if (/mi/i.test(unit)) range *= 1.609;
  if (Number.isFinite(range) && range > 10 && Number.isFinite(soc) && soc >= 10) {
    return { pct_per_km: soc / range, how: 'range' };
  }
  const kwh100 = Number(vehicle.consumption_kwh_100km) > 0 ? Number(vehicle.consumption_kwh_100km) : DEFAULT_KWH_100KM;
  if (vehicle.capacity_kwh > 0) return withCold({ pct_per_km: (kwh100 / 100 / vehicle.capacity_kwh) * 100, how: 'consumption', kwh_100km: kwh100 });
  return null;
}

// Where a place is, for a trip from one place to the next: { status, lat, lon }.
function pointOf(given, title) {
  const { location, point, manual_km: manualKm } = placeFor(given, title);
  if (manualKm) return { status: 'ok', lat: null, lon: null, home_km: manualKm, how: 'manual' };
  const d = point ? pointDistance(point) : distance(location);
  if (d.status === 'home') return { status: 'home', lat: ha.state.home ? ha.state.home.lat : null, lon: ha.state.home ? ha.state.home.lon : null, home_km: 0 };
  if (d.status !== 'ok') return { status: d.status, reason: d.reason || null };
  return { status: 'ok', lat: d.lat, lon: d.lon, home_km: d.km, how: d.how };
}

// What a trip costs: { km (one way), pct (there and back, or there plus the
// return trip in the calendar), how, status }.
// stops: more places after the first one, without going home in between
// (for example work, then sport, then home). Each part is the distance from
// the place before; the way back starts at the last place.
function tripCost({ location: given, title = null, returnLocation = undefined, stops = [], vehicle, states, soc, temp = null }) {
  if (stops && stops.length) return chainCost({ location: given, title, stops, vehicle, states, soc, temp });
  const { location, place, kind, point, manual_km: manualKm } = placeFor(given, title);
  const reach = manualKm ? { status: 'ok', km: manualKm, how: 'manual' } : point ? pointDistance(point) : distance(location);
  const there = { ...reach, ...(place ? { place, place_kind: kind } : {}) };
  if (there.status !== 'ok') {
    const ask = there.status === 'unknown' ? askName(given, title) : null;
    return { status: there.status, reason: there.reason || null, km: there.km ?? null, pct: there.status === 'home' ? 0 : null, ...(place ? { place, place_kind: kind } : {}), ...(ask ? { ask } : {}) };
  }
  const use = pctPerKm(vehicle, states, soc, temp);
  if (!use) return { status: 'no_consumption', km: there.km, how: there.how, pct: null, ...(place ? { place, place_kind: kind } : {}) };
  // Back: the return trip in the calendar when there is one (home: the same distance).
  const backKm = returnLocation === undefined ? there.km : (() => {
    const r = placeFor(returnLocation, null);
    if (r.manual_km) return r.manual_km;
    const b = r.point ? pointDistance(r.point) : distance(r.location);
    return b.status === 'home' ? there.km : b.status === 'ok' ? b.km : there.km;
  })();
  const pct = Math.round((there.km + backKm) * use.pct_per_km * MARGIN * 10) / 10;
  // lat/lon: where the destination is (for charging stops on the way, #37).
  const at = Number.isFinite(there.lat) && Number.isFinite(there.lon) ? { lat: there.lat, lon: there.lon } : {};
  const drive = driveMinutes(backKm, backKm === there.km ? there.min : null);
  return { status: 'ok', km: there.km, back_km: backKm, how: there.how, use: use.how, pct_per_km: use.pct_per_km, pct, ...(drive ? { back_min: drive.min, back_min_how: drive.how } : {}), ...(use.cold ? { cold: use.cold } : {}), ...at, ...(place ? { place, place_kind: kind } : {}) };
}

// A trip with more places in a row: home → first place → next place → … → home.
function chainCost({ location: given, title, stops, vehicle, states, soc, temp = null }) {
  const first = tripCost({ location: given, title, vehicle, states, soc, temp });
  if (first.status !== 'ok') return first;
  let prev = pointOf(given, title);
  if (prev.status !== 'ok') return first;
  const legs = [];
  for (const s of stops) {
    const cur = pointOf(s.location, s.title);
    if (cur.status === 'pending') return { ...first, status: 'pending', pct: null };
    if (cur.status !== 'ok' && cur.status !== 'home') {
      const ask = cur.status === 'unknown' ? askName(s.location, s.title) : null;
      return { ...first, status: 'unknown', reason: cur.reason || 'not_found', pct: null, ...(ask ? { ask } : {}) };
    }
    // A place with only a distance you entered has no position: the leg from
    // the place before is estimated as that place's distance from home.
    const noPos = cur.lat == null || prev.lat == null;
    const leg = cur.status === 'home' ? { km: prev.home_km, how: prev.how }
      : noPos ? { km: cur.home_km, how: 'estimate' }
        : toPoint(prev, cur, `${cur.lat},${cur.lon}`);
    legs.push({ title: s.title || null, km: leg.km || 0, how: leg.how || null });
    if (leg.how === 'estimate') first.how = 'estimate';
    prev = cur;
  }
  const backKm = prev.home_km || 0;
  const total = first.km + legs.reduce((a, l) => a + l.km, 0) + backKm;
  const pct = Math.round(total * first.pct_per_km * MARGIN * 10) / 10;
  // The drive home is from the last place (an estimate from its distance).
  const drive = driveMinutes(backKm);
  return { ...first, legs, back_km: backKm, total_km: Math.round(total * 10) / 10, pct, back_min: drive ? drive.min : null, back_min_how: drive ? drive.how : null };
}

// Learning from your trips. When the car is unplugged for a trip with a known
// distance, the battery level is remembered; when it is plugged in again, the
// drop divided by the distance there and back is one sample. Samples are
// averaged (newer ones count more). Only plausible trips count.
// temp (°C, or null): the outside temperature when the car left / came back,
// remembered with the sample for the cold correction (#56).
function tripStarted(vehicleId, soc, kmTotal, now = Date.now(), temp = null) {
  if (!vehicleId || !Number.isFinite(soc) || !(kmTotal > 5)) return;
  load().away[vehicleId] = { soc, km: kmTotal, at: now, temp: Number.isFinite(temp) ? temp : null };
  save();
}

function tripEnded(vehicleId, soc, now = Date.now(), temp = null) {
  const c = load();
  const a = c.away[vehicleId];
  if (!a) return null;
  delete c.away[vehicleId];
  let sample = null;
  const drop = a.soc - soc;
  // Plausible: back within two days, used at least 2 %, between 0.05 and 1.5 % per km.
  if (Number.isFinite(soc) && now - a.at < 48 * 3600000 && drop >= 2) {
    const v = drop / a.km;
    if (v >= 0.05 && v <= 1.5) {
      sample = v;
      const l = c.learned[vehicleId];
      const temps = [a.temp, temp].filter(Number.isFinite);
      const t = temps.length ? Math.round((temps.reduce((x, y) => x + y, 0) / temps.length) * 10) / 10 : null;
      const samples = [...((l && l.samples) || []), { v, t, at: now }].slice(-SAMPLES);
      c.learned[vehicleId] = l
        ? { pct_per_km: l.pct_per_km * 0.7 + v * 0.3, trips: l.trips + 1, at: now, samples }
        : { pct_per_km: v, trips: 1, at: now, samples };
      ha.log(`Trip use learned: ${drop.toFixed(1)}% for ${a.km.toFixed(0)} km (${(v * 100).toFixed(1)}% per 100 km)`);
    }
  }
  save();
  return sample;
}

function learned(vehicleId) {
  return learnedRec(vehicleId);
}

function setUserAgent(version) {
  userAgent = `SmartChargingPlanner/${version} (Home Assistant app; https://github.com/tlpeter/smart-charging-planner)`;
}

// A place or route was looked up: the plan can show the trip's cost now.
const listeners = [];
function onUpdate(fn) {
  listeners.push(fn);
}
function changed() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a listener never stops the lookup */ }
  }
}

// Tests only.
function reset() {
  cache = { places: {}, routes: {}, learned: {}, away: {} };
  queue.length = 0;
  queued.clear();
}
function idle() {
  return !running && !queue.length;
}

module.exports = { driveMinutes, setLogProvider, coldOn, ROUTING_MODES, setRouting, routing, distance, pointDistance, placeFor, askName, setZones, zoneList, setSavedPlaces, onUpdate, tripCost, pctPerKm, coldModel, coldFactor, fitCold, COLD_BASE_C, COLD_DEFAULT_PCT, tripStarted, tripEnded, learned, isHome, looksLikePlace, haversineKm, setUserAgent, reset, idle, ROAD_FACTOR, MARGIN, DEFAULT_KWH_100KM };

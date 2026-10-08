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
// Plus 10 % margin (cold, motorway).

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'places.json');
const GEOCODE_URL = process.env.SCP_GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL = process.env.SCP_ROUTE_URL || 'https://router.project-osrm.org/route/v1/driving';
const GAP_MS = Number(process.env.SCP_GEOCODE_GAP_MS) || 1100;
const ROAD_FACTOR = 1.3;
const MARGIN = 1.1;
const DEFAULT_KWH_100KM = 18;
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

// Words that are a place for you but not an address ("Werk", "Thuis").
const GENERIC = new Set(['werk', 'work', 'kantoor', 'office', 'school', 'sport', 'gym', 'training', 'thuis', 'home', 'huis', 'naar huis', 'boodschappen', 'winkel', 'shopping', 'opa', 'oma', 'ouders', 'parents']);
const HOME = /^(thuis|huis|home|naar huis|naar thuis|terug|back home)$/i;

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
  const r = await getJson(`${GEOCODE_URL}?${q}`);
  const hit = Array.isArray(r) && r[0];
  return hit && Number.isFinite(Number(hit.lat)) ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

async function routeKm(from, to) {
  const r = await getJson(`${ROUTE_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`);
  const m = r && r.routes && r.routes[0] && r.routes[0].distance;
  return Number.isFinite(m) ? m / 1000 : null;
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
  const c = load();
  const key = norm(text);
  const place = c.places[key];
  if (!place || (!place.found && Date.now() - place.at > RETRY_MS)) {
    enqueue(`place:${key}`, async () => {
      let p = null;
      try {
        // Not found: try again without the first part ("IQ Messenger, Pieter
        // Zeemanweg 57, …" → "Pieter Zeemanweg 57, …"): a company or place
        // name in front of the address.
        const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
        for (let i = 0; i < parts.length && !p; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
          const q = parts.slice(i).join(', ');
          if (i > 0 && !/\d/.test(q) && parts.length - i < 2) break; // only a country or town left
          p = await geocode(q, country);
        }
      } catch (err) {
        ha.debug('OpenStreetMap could not look up', text, '-', err.message);
        return; // not stored: tried again next time
      }
      load().places[key] = p ? { ...p, found: true, at: Date.now() } : { found: false, at: Date.now() };
      save();
    });
    return { status: 'pending' };
  }
  if (!place.found) return { status: 'unknown', reason: 'not_found' };
  const straight = haversineKm(home, place);
  if (straight < 1) return { status: 'home', km: 0 };
  const rkey = `${home.lat.toFixed(4)},${home.lon.toFixed(4)}|${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  const route = c.routes[rkey];
  if (route && route.km != null) return { status: 'ok', km: route.km, how: 'route', lat: place.lat, lon: place.lon };
  if (!route || Date.now() - route.at > RETRY_MS) {
    enqueue(`route:${rkey}`, async () => {
      let km = null;
      try {
        km = await routeKm(home, place);
      } catch (err) {
        ha.debug('OpenStreetMap route failed', text, '-', err.message);
      }
      load().routes[rkey] = { km, at: Date.now() };
      save();
    });
  }
  return { status: 'ok', km: Math.round(straight * ROAD_FACTOR * 10) / 10, how: 'estimate', lat: place.lat, lon: place.lon };
}

// Battery % per km: from the range sensor (range at the level now), or the
// consumption and the battery capacity. null when neither is known.
function pctPerKm(vehicle, states, soc) {
  if (!vehicle) return null;
  const learned = vehicle.id ? load().learned[vehicle.id] : null;
  if (learned && learned.trips >= 2 && learned.pct_per_km > 0) return { pct_per_km: learned.pct_per_km, how: 'learned', trips: learned.trips };
  const st = vehicle.range_entity ? states.find((x) => x.entity_id === vehicle.range_entity) : null;
  let range = st ? Number(st.state) : NaN;
  const unit = st && st.attributes ? String(st.attributes.unit_of_measurement || 'km') : 'km';
  if (/mi/i.test(unit)) range *= 1.609;
  if (Number.isFinite(range) && range > 10 && Number.isFinite(soc) && soc >= 10) {
    return { pct_per_km: soc / range, how: 'range' };
  }
  const kwh100 = Number(vehicle.consumption_kwh_100km) > 0 ? Number(vehicle.consumption_kwh_100km) : DEFAULT_KWH_100KM;
  if (vehicle.capacity_kwh > 0) return { pct_per_km: (kwh100 / 100 / vehicle.capacity_kwh) * 100, how: 'consumption', kwh_100km: kwh100 };
  return null;
}

// What a trip costs: { km (one way), pct (there and back, or there plus the
// return trip in the calendar), how, status }.
function tripCost({ location, returnLocation = undefined, vehicle, states, soc }) {
  const there = distance(location);
  if (there.status !== 'ok') return { status: there.status, reason: there.reason || null, km: there.km ?? null, pct: there.status === 'home' ? 0 : null };
  const use = pctPerKm(vehicle, states, soc);
  if (!use) return { status: 'no_consumption', km: there.km, how: there.how, pct: null };
  // Back: the return trip in the calendar when there is one (home: the same distance).
  const backKm = returnLocation === undefined ? there.km : (() => {
    const b = distance(returnLocation);
    return b.status === 'home' ? there.km : b.status === 'ok' ? b.km : there.km;
  })();
  const pct = Math.round((there.km + backKm) * use.pct_per_km * MARGIN * 10) / 10;
  return { status: 'ok', km: there.km, back_km: backKm, how: there.how, use: use.how, pct_per_km: use.pct_per_km, pct };
}

// Learning from your trips. When the car is unplugged for a trip with a known
// distance, the battery level is remembered; when it is plugged in again, the
// drop divided by the distance there and back is one sample. Samples are
// averaged (newer ones count more). Only plausible trips count.
function tripStarted(vehicleId, soc, kmTotal, now = Date.now()) {
  if (!vehicleId || !Number.isFinite(soc) || !(kmTotal > 5)) return;
  load().away[vehicleId] = { soc, km: kmTotal, at: now };
  save();
}

function tripEnded(vehicleId, soc, now = Date.now()) {
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
      c.learned[vehicleId] = l
        ? { pct_per_km: l.pct_per_km * 0.7 + v * 0.3, trips: l.trips + 1, at: now }
        : { pct_per_km: v, trips: 1, at: now };
      ha.log(`Trip use learned: ${drop.toFixed(1)}% for ${a.km.toFixed(0)} km (${(v * 100).toFixed(1)}% per 100 km)`);
    }
  }
  save();
  return sample;
}

function learned(vehicleId) {
  return vehicleId ? load().learned[vehicleId] || null : null;
}

function setUserAgent(version) {
  userAgent = `SmartChargingPlanner/${version} (Home Assistant app; https://github.com/tlpeter/smart-charging-planner)`;
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

module.exports = { distance, tripCost, pctPerKm, tripStarted, tripEnded, learned, isHome, looksLikePlace, haversineKm, setUserAgent, reset, idle, ROAD_FACTOR, MARGIN, DEFAULT_KWH_100KM };

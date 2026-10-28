'use strict';

// Charging stops on the way (#37). When a trip needs more than the battery
// holds, suggest public charging stations along the route.
//
// How it works:
//  1. The route from home to the destination: OSRM (the same server as for
//     trip distances), as a line. Only when Trip distances may go online.
//  2. The stations along that line: Open Charge Map (api.openchargemap.io),
//     with your own free API key. It receives the line and the key.
//  3. The app keeps the stations that fit your settings (country, power,
//     connector, detour) and that the car can reach, and shows the best three:
//     your preferred operators first.
//
// Everything is looked up in the background, one request at a time, and
// remembered (/data/chargestops.json), so a plan never waits for it. Station
// data is not live: a station can be busy or out of order.
//
// Countries and operators: all of Europe (#40). A route that crosses a border
// gets stations in every country on it, unless you limit it to your countries.
// A long trip can need more than one stop (#40): the app plans them one after
// the other, each as far as the battery allows.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');
const tripcost = require('./tripcost');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'chargestops.json');
const OCM_URL = process.env.SCP_OCM_URL || 'https://api.openchargemap.io/v3/poi';
const GAP_MS = Number(process.env.SCP_OCM_GAP_MS) || 1100;
const ROUTE_TTL = 30 * 86400000; // a route is looked up again after 30 days
const STATION_TTL = 24 * 3600000; // stations along a route: once a day
const ERROR_RETRY = 3600000; // after a failed lookup: try again after an hour
const MAX_POINTS = 250; // the route line sent to Open Charge Map
const SHOW = 3; // suggestions per trip
const CHECK = 8; // stations whose real detour by road is looked up (#41)
const FAR_DETOUR_KM = 25; // a longer detour is only shown when nothing else fits
const MAX_STOPS = 40; // a safety limit for very long trips (#40), not a normal limit

// European countries (ISO codes, as Open Charge Map sends them) (#40).
const COUNTRIES = {
  AL: 'Albania', AD: 'Andorra', AT: 'Austria', BE: 'Belgium', BA: 'Bosnia and Herzegovina', BG: 'Bulgaria',
  HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
  DE: 'Germany', GR: 'Greece', HU: 'Hungary', IS: 'Iceland', IE: 'Ireland', IT: 'Italy', XK: 'Kosovo',
  LV: 'Latvia', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', MD: 'Moldova',
  MC: 'Monaco', ME: 'Montenegro', NL: 'Netherlands', MK: 'North Macedonia', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SM: 'San Marino', RS: 'Serbia', SK: 'Slovakia', SI: 'Slovenia',
  ES: 'Spain', SE: 'Sweden', CH: 'Switzerland', UA: 'Ukraine', GB: 'United Kingdom',
};
const ALL = Object.keys(COUNTRIES);

// The main charging operators. `match` finds the operator in the station data
// (Open Charge Map uses names such as "Allego BV", "Tesla Motors (Worldwide)"
// or "EnBW Energie Baden-Württemberg AG"); the first match wins, so a name
// that contains another one ("Shell Recharge") comes before it.
// countries: where it mainly operates (for the list on the settings page).
// fast: mainly fast charging.
const OPERATORS = [
  // Across Europe.
  { id: 'ionity', name: 'IONITY', countries: ALL, fast: true, match: /ionity/i },
  { id: 'tesla', name: 'Tesla Supercharger', countries: ALL, fast: true, match: /tesla/i },
  { id: 'fastned', name: 'Fastned', countries: ['NL', 'BE', 'DE', 'FR', 'CH', 'GB', 'DK'], fast: true, match: /fastned/i },
  { id: 'allego', name: 'Allego', countries: ['NL', 'BE', 'DE', 'FR', 'DK', 'SE', 'NO', 'GB', 'AT'], fast: true, match: /allego/i },
  { id: 'electra', name: 'Electra', countries: ['FR', 'BE', 'IT', 'NL', 'CH', 'ES', 'DE'], fast: true, match: /electra\b/i },
  { id: 'shell', name: 'Shell Recharge', countries: ['NL', 'BE', 'DE', 'GB', 'FR', 'AT', 'CH'], fast: true, match: /shell|newmotion|ubitricity/i },
  { id: 'bp', name: 'bp pulse', countries: ['NL', 'BE', 'GB', 'ES', 'PL'], fast: true, match: /\bbp\b|bp ?pulse|bp ?chargemaster/i },
  { id: 'aral', name: 'Aral pulse', countries: ['DE'], fast: true, match: /\baral\b/i },
  { id: 'totalenergies', name: 'TotalEnergies', countries: ['NL', 'BE', 'FR', 'DE', 'LU', 'IT', 'GB'], fast: true, match: /total ?energies|^total\b/i },
  { id: 'circlek', name: 'Circle K', countries: ['NO', 'SE', 'DK', 'IE', 'PL', 'EE', 'LV', 'LT'], fast: true, match: /circle ?k\b/i },
  { id: 'mer', name: 'Mer', countries: ['NO', 'SE', 'DE', 'GB'], fast: true, match: /^mer\b|\bmer (germany|norway|sweden|uk|solutions)/i },
  { id: 'recharge', name: 'Recharge', countries: ['NO', 'SE', 'FI'], fast: true, match: /^recharge\b/i },
  { id: 'powerdot', name: 'Power Dot', countries: ['PT', 'FR', 'ES', 'PL', 'BE', 'LU'], fast: true, match: /power ?dot/i },
  { id: 'eon', name: 'E.ON Drive', countries: ['DE', 'DK', 'SE', 'IT', 'CZ', 'GB'], fast: true, match: /\be\.on\b|\beon\b/i },
  // Netherlands and Belgium.
  { id: 'leap24', name: 'LEAP24', countries: ['NL'], fast: true, match: /leap ?24/i },
  { id: 'avia', name: 'AVIA Volt', countries: ['NL', 'CH'], fast: true, match: /avia/i },
  { id: 'tango', name: 'Tango', countries: ['NL'], fast: true, match: /tango/i },
  { id: 'powerdale', name: 'Powerdale', countries: ['BE'], fast: true, match: /powerdale/i },
  { id: 'dats24', name: 'DATS 24', countries: ['BE'], fast: true, match: /dats ?24/i },
  // Germany and Austria.
  { id: 'enbw', name: 'EnBW', countries: ['DE', 'AT'], fast: true, match: /enbw/i },
  { id: 'ewego', name: 'EWE Go', countries: ['DE'], fast: true, match: /ewe ?go|\bewe\b/i },
  { id: 'smatrics', name: 'SMATRICS', countries: ['AT'], fast: true, match: /smatrics/i },
  // Switzerland.
  { id: 'gofast', name: 'GOFAST', countries: ['CH'], fast: true, match: /gofast/i },
  { id: 'move', name: 'MOVE', countries: ['CH'], fast: true, match: /^move\b|move mobility/i },
  // France.
  { id: 'izivia', name: 'Izivia', countries: ['FR'], fast: true, match: /izivia|corri-?door/i },
  // Italy.
  { id: 'atlante', name: 'Atlante', countries: ['IT', 'FR', 'ES', 'PT'], fast: true, match: /atlante/i },
  { id: 'ewiva', name: 'Ewiva', countries: ['IT'], fast: true, match: /ewiva/i },
  { id: 'enelx', name: 'Enel X Way', countries: ['IT', 'ES'], fast: true, match: /\benel\b/i },
  { id: 'freetox', name: 'Free To X', countries: ['IT'], fast: true, match: /free ?to ?x/i },
  { id: 'becharge', name: 'Be Charge (Plenitude)', countries: ['IT'], fast: true, match: /be ?charge|plenitude/i },
  // Spain and Portugal.
  { id: 'iberdrola', name: 'Iberdrola', countries: ['ES', 'PT'], fast: true, match: /iberdrola/i },
  { id: 'zunder', name: 'Zunder', countries: ['ES', 'PT', 'FR'], fast: true, match: /zunder/i },
  { id: 'endesa', name: 'Endesa X', countries: ['ES'], fast: true, match: /endesa/i },
  { id: 'repsol', name: 'Repsol', countries: ['ES', 'PT'], fast: true, match: /repsol/i },
  { id: 'wenea', name: 'Wenea', countries: ['ES'], fast: true, match: /wenea/i },
  // The Nordic countries.
  { id: 'clever', name: 'Clever', countries: ['DK', 'SE', 'DE'], fast: true, match: /clever/i },
  { id: 'okq8', name: 'OKQ8', countries: ['SE'], fast: true, match: /okq8/i },
  { id: 'eviny', name: 'Eviny', countries: ['NO'], fast: true, match: /eviny|bkk/i },
  // Central and Eastern Europe.
  { id: 'orlen', name: 'Orlen Charge', countries: ['PL', 'CZ', 'SK', 'DE', 'LT'], fast: true, match: /orlen/i },
  { id: 'greenway', name: 'GreenWay', countries: ['PL', 'SK'], fast: true, match: /green ?way/i },
  { id: 'cez', name: 'ČEZ', countries: ['CZ'], fast: true, match: /\bcez\b|čez/i },
  // United Kingdom and Ireland.
  { id: 'gridserve', name: 'GRIDSERVE', countries: ['GB'], fast: true, match: /gridserve/i },
  { id: 'instavolt', name: 'InstaVolt', countries: ['GB', 'IS'], fast: true, match: /instavolt/i },
  { id: 'osprey', name: 'Osprey', countries: ['GB'], fast: true, match: /osprey/i },
  { id: 'esb', name: 'ESB ecars', countries: ['IE', 'GB'], fast: true, match: /\besb\b/i },
  // Luxembourg.
  { id: 'chargy', name: 'Chargy', countries: ['LU'], fast: false, match: /chargy/i },
  // Mainly normal charging.
  { id: 'engie', name: 'Engie Vianeo', countries: ['BE', 'FR'], fast: false, match: /engie|vianeo/i },
  { id: 'lidl', name: 'Lidl', countries: ['NL', 'BE', 'DE', 'FR', 'AT', 'IT', 'ES', 'PL'], fast: false, match: /lidl/i },
  { id: 'vattenfall', name: 'Vattenfall InCharge', countries: ['NL', 'DE', 'SE'], fast: false, match: /vattenfall|incharge/i },
  { id: 'equans', name: 'Equans', countries: ['NL'], fast: false, match: /equans/i },
  { id: 'eneco', name: 'Eneco', countries: ['NL'], fast: false, match: /eneco/i },
  { id: 'pitpoint', name: 'PitPoint', countries: ['NL'], fast: false, match: /pitpoint/i },
  { id: 'bluecorner', name: 'Blue Corner', countries: ['BE'], fast: false, match: /blue ?corner/i },
  { id: 'wattif', name: 'Wattif', countries: ['BE'], fast: false, match: /wattif/i },
  { id: 'podpoint', name: 'Pod Point', countries: ['GB'], fast: false, match: /pod ?point/i },
];

// Connectors: Open Charge Map connection type ids, with the name as a fallback.
const CONNECTORS = {
  ccs: { name: 'CCS', ids: [32, 33], match: (t) => /ccs|combo/i.test(t) },
  chademo: { name: 'CHAdeMO', ids: [2], match: (t) => /chademo/i.test(t) },
  type2: { name: 'Type 2', ids: [25, 1036], match: (t) => /type ?2|mennekes/i.test(t) && !/ccs|combo/i.test(t) },
};

const DEFAULTS = {
  enabled: false,
  api_key: '',
  countries: ['NL'],
  only_countries: false, // false: stations in every country on the route count (#40)
  operators: [],
  min_power_kw: 50,
  connectors: ['ccs'],
  max_detour_km: 5,
  reserve_pct: 10,
  charge_to_pct: 80, // how far to charge at a stop when more stops follow (#40)
  // The lowest level to arrive with at a charger (#40). Most cars charge
  // fastest when nearly empty: below reserve_pct the app looks for a station,
  // and it may drive on to this level to reach one. Not above reserve_pct.
  arrive_min_pct: 10,
};

let configFn = () => ({});
function setConfig(fn) {
  configFn = typeof fn === 'function' ? fn : () => fn || {};
}
function config() {
  const c = { ...DEFAULTS, ...(configFn() || {}) };
  c.countries = (Array.isArray(c.countries) ? c.countries : []).filter((x) => COUNTRIES[x]);
  if (!c.countries.length) c.countries = [...DEFAULTS.countries];
  c.operators = (Array.isArray(c.operators) ? c.operators : []).filter((x) => OPERATORS.some((o) => o.id === x));
  c.connectors = (Array.isArray(c.connectors) ? c.connectors : []).filter((x) => CONNECTORS[x]);
  if (!c.connectors.length) c.connectors = [...DEFAULTS.connectors];
  c.only_countries = c.only_countries === true;
  const to = Number(c.charge_to_pct);
  c.charge_to_pct = Number.isFinite(to) && to >= 50 && to <= 100 ? to : DEFAULTS.charge_to_pct;
  const res = Number(c.reserve_pct);
  c.reserve_pct = Number.isFinite(res) && res >= 0 && res <= 50 ? res : DEFAULTS.reserve_pct;
  const low = Number(c.arrive_min_pct);
  c.arrive_min_pct = Math.min(c.reserve_pct, Number.isFinite(low) && low >= 0 && low <= 50 ? low : DEFAULTS.arrive_min_pct);
  return c;
}
function enabled() {
  return !!config().enabled;
}

// Check and tidy settings sent by the page. The key is kept when the page
// sends none (it never shows the saved key).
function clean(body, saved = {}) {
  const b = body || {};
  const num = (v, name, min, max, dflt) => {
    if (v === undefined || v === null || v === '') return dflt;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max) {
      const err = new Error(`${name}: between ${min} and ${max}`);
      err.status = 400;
      throw err;
    }
    return n;
  };
  const list = (v, ok) => (Array.isArray(v) ? [...new Set(v.map(String))].filter(ok) : []);
  let key = typeof b.api_key === 'string' ? b.api_key.trim() : null;
  if (b.clear_key === true) key = '';
  if (key === null || (key === '' && b.clear_key !== true)) key = saved.api_key || '';
  if (key && !/^[A-Za-z0-9-]{8,80}$/.test(key)) {
    const err = new Error('Open Charge Map API key: letters, numbers and dashes only');
    err.status = 400;
    throw err;
  }
  const out = {
    enabled: b.enabled === true,
    api_key: key,
    countries: list(b.countries, (x) => !!COUNTRIES[x]),
    only_countries: b.only_countries === true,
    operators: list(b.operators, (x) => OPERATORS.some((o) => o.id === x)),
    min_power_kw: num(b.min_power_kw, 'Minimum power', 3, 400, DEFAULTS.min_power_kw),
    connectors: list(b.connectors, (x) => !!CONNECTORS[x]),
    max_detour_km: num(b.max_detour_km, 'Maximum detour', 1, 30, DEFAULTS.max_detour_km),
    reserve_pct: num(b.reserve_pct, 'Suggest a stop below', 0, 50, DEFAULTS.reserve_pct),
    charge_to_pct: num(b.charge_to_pct, 'Charge to at a stop', 50, 100, DEFAULTS.charge_to_pct),
  };
  out.arrive_min_pct = num(b.arrive_min_pct, 'Arrive at a charger with at least', 0, 50, Math.min(DEFAULTS.arrive_min_pct, out.reserve_pct));
  if (out.arrive_min_pct > out.reserve_pct) {
    const err = new Error('Arrive at a charger with at least: not above the level for a stop');
    err.status = 400;
    throw err;
  }
  if (out.charge_to_pct < out.reserve_pct + 20) {
    const err = new Error('Charge to at a stop: at least 20% above the level for a stop');
    err.status = 400;
    throw err;
  }
  if (!out.countries.length) {
    const err = new Error('Choose at least one country');
    err.status = 400;
    throw err;
  }
  if (!out.connectors.length) {
    const err = new Error('Choose at least one connector');
    err.status = 400;
    throw err;
  }
  if (out.enabled && !out.api_key) {
    const err = new Error('Enter your Open Charge Map API key, or turn charging stops off');
    err.status = 400;
    throw err;
  }
  return out;
}

// What the settings page shows: never the key itself.
function view(c = config()) {
  const { api_key: key, ...rest } = c;
  return {
    ...rest,
    has_key: !!key,
    routing_online: tripcost.routing().online,
    country_list: Object.entries(COUNTRIES).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    operator_list: OPERATORS.map(({ id, name, countries, fast }) => ({ id, name, countries, fast })),
    connector_list: Object.entries(CONNECTORS).map(([id, x]) => ({ id, name: x.name })),
  };
}

// ---------------------------------------------------------------------------
// Lines and distances.

// Google encoded polyline (precision 5), as OSRM sends and Open Charge Map reads.
function decodePolyline(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i <= str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return out;
}

function encodePolyline(points) {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += enc(lat - pLat) + enc(lon - pLon);
    pLat = lat;
    pLon = lon;
  }
  return out;
}

// Fewer points: keep a point when it is far enough from the last one kept.
function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  let total = 0;
  for (let k = 1; k < points.length; k++) total += tripcost.haversineKm(points[k - 1], points[k]);
  const step = total / (max - 1);
  const out = [points[0]];
  let since = 0;
  for (let k = 1; k < points.length - 1; k++) {
    since += tripcost.haversineKm(points[k - 1], points[k]);
    if (since >= step) {
      out.push(points[k]);
      since = 0;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Where a point is relative to the route: how far along it (km from the
// start) and how far off it (km). A flat map per segment is precise enough.
function onRoute(points, p) {
  let best = { along: 0, off: Infinity };
  let done = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const kx = 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    const ky = 110.57;
    const bx = (b.lon - a.lon) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lon - a.lon) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    const len = Math.sqrt(len2);
    if (off < best.off) best = { along: done + t * len, off };
    done += len;
  }
  return { along: best.along, off: best.off, total: done };
}

// ---------------------------------------------------------------------------
// Stations from Open Charge Map, in the app's own short form.

function connectorOf(c) {
  const id = Number(c.ConnectionTypeID ?? (c.ConnectionType && c.ConnectionType.ID));
  const title = String((c.ConnectionType && (c.ConnectionType.Title || c.ConnectionType.FormalName)) || '');
  for (const [key, x] of Object.entries(CONNECTORS)) {
    if (x.ids.includes(id) || x.match(title)) return key;
  }
  return null;
}

function operatorOf(title) {
  const t = String(title || '');
  const o = t ? OPERATORS.find((x) => x.match.test(t)) : null;
  return o ? o.id : null;
}

function shortStation(poi) {
  const a = poi.AddressInfo || {};
  // A missing position is not 0,0 (Number(null) is 0).
  const coord = (v) => (v == null || v === '' ? NaN : Number(v));
  const lat = coord(a.Latitude);
  const lon = coord(a.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (poi.StatusType && poi.StatusType.IsOperational === false) return null;
  const usage = String((poi.UsageType && poi.UsageType.Title) || '');
  if (/private/i.test(usage)) return null;
  const connectors = {};
  for (const c of poi.Connections || []) {
    if (c.StatusType && c.StatusType.IsOperational === false) continue;
    const key = connectorOf(c);
    if (!key) continue;
    const kw = Number(c.PowerKW);
    const n = Number(c.Quantity) > 0 ? Number(c.Quantity) : 1;
    const cur = connectors[key] || { kw: 0, count: 0 };
    connectors[key] = { kw: Math.max(cur.kw, Number.isFinite(kw) ? kw : 0), count: cur.count + n };
  }
  if (!Object.keys(connectors).length) return null;
  const opTitle = (poi.OperatorInfo && poi.OperatorInfo.Title) || null;
  const country = (a.Country && a.Country.ISOCode) || null;
  return {
    id: poi.ID,
    name: String(a.Title || '').slice(0, 80) || null,
    town: String(a.Town || '').slice(0, 60) || null,
    country: country ? String(country).toUpperCase() : null,
    lat,
    lon,
    operator: opTitle ? String(opTitle).slice(0, 60) : null,
    operator_id: operatorOf(opTitle),
    connectors,
  };
}

// ---------------------------------------------------------------------------
// Background lookups, one at a time.

let cache;
function load() {
  if (!cache) cache = readJson(FILE, null) || {};
  cache.routes = cache.routes || {};
  cache.stations = cache.stations || {};
  cache.detours = cache.detours || {};
  return cache;
}
function save() {
  try { writeJsonAtomic(FILE, cache); } catch { /* best effort */ }
}

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
    if (!tripcost.routing().online || !enabled() || !config().api_key) {
      queued.delete(key);
      continue;
    }
    try {
      await job();
    } catch (err) {
      ha.debug('Charging stop lookup failed:', key, err.message);
    }
    queued.delete(key);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  running = false;
}

let userAgent = 'SmartChargingPlanner (Home Assistant app; https://github.com/tlpeter/smart-charging-planner)';
function setUserAgent(version) {
  userAgent = `SmartChargingPlanner/${version} (Home Assistant app; https://github.com/tlpeter/smart-charging-planner)`;
}

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const r4 = (v) => v.toFixed(4);
const routeKey = (home, dest) => `${r4(home.lat)},${r4(home.lon)}|${r4(dest.lat)},${r4(dest.lon)}`;

function routeOf(home, dest, now) {
  const key = routeKey(home, dest);
  const r = load().routes[key];
  const stale = !r || (r.error ? now - r.at > ERROR_RETRY : now - r.at > ROUTE_TTL);
  if (stale) {
    enqueue(`route:${key}`, async () => {
      const url = `${tripcost.routing().route_url}/${home.lon},${home.lat};${dest.lon},${dest.lat}?overview=simplified&geometries=polyline`;
      let rec;
      try {
        const res = await getJson(url);
        const route = res && res.routes && res.routes[0];
        const pts = route && typeof route.geometry === 'string' ? thin(decodePolyline(route.geometry)) : [];
        rec = pts.length >= 2 ? { line: encodePolyline(pts), km: route.distance / 1000, at: Date.now() } : { error: 'no_route', at: Date.now() };
      } catch (err) {
        ha.debug('Charging stops: route lookup failed -', err.message);
        rec = { error: 'route_failed', at: Date.now() };
      }
      load().routes[key] = rec;
      save();
      changed();
    });
  }
  return r || null;
}

// How many stations to ask for: more on a longer route (#40), so a trip across
// Europe does not stop at the first few hundred stations.
const maxResults = (km) => Math.min(5000, Math.max(300, Math.round((km || 0) * 3)));

function stationsOf(key, line, detourKm, minKw, routeKm, now) {
  const corridor = Math.max(0.5, detourKm / 2);
  const skey = `${key}|${corridor}|${minKw}`;
  const s = load().stations[skey];
  const stale = !s || (s.error ? now - s.at > ERROR_RETRY : now - s.at > STATION_TTL);
  if (stale) {
    enqueue(`stations:${skey}`, async () => {
      const q = new URLSearchParams({ output: 'json', polyline: line, distance: String(corridor), distanceunit: 'km', minpowerkw: String(minKw), maxresults: String(maxResults(routeKm)), compact: 'false', verbose: 'false', client: 'SmartChargingPlanner' });
      let rec;
      try {
        const res = await getJson(`${OCM_URL}?${q}`, { 'X-API-Key': config().api_key });
        const list = Array.isArray(res) ? res.map(shortStation).filter(Boolean) : [];
        rec = { list, at: Date.now() };
      } catch (err) {
        ha.debug('Charging stops: Open Charge Map failed -', err.message);
        rec = { error: err.status === 401 || err.status === 403 ? 'bad_key' : 'stations_failed', at: Date.now() };
      }
      load().stations[skey] = rec;
      save();
      changed();
    });
  }
  return s || null;
}

// The real detour by road (#41): the drive start → station → end, from OSRM.
// OSRM knows one-way roads, so a service area on the other side of a motorway
// gets its real detour (to the next exit and back), not a few hundred metres.
function viaKm(rkey, from, s, to, back, now) {
  const key = `${rkey}|${s.id}|${back ? 'back' : 'out'}`;
  const d = load().detours[key];
  const stale = !d || (d.km == null ? now - d.at > ERROR_RETRY : now - d.at > ROUTE_TTL);
  if (stale) {
    enqueue(`detour:${key}`, async () => {
      let km = null;
      try {
        const res = await getJson(`${tripcost.routing().route_url}/${from.lon},${from.lat};${s.lon},${s.lat};${to.lon},${to.lat}?overview=false`);
        const m = res && res.routes && res.routes[0] && res.routes[0].distance;
        km = Number.isFinite(m) ? m / 1000 : null;
      } catch (err) {
        ha.debug('Charging stops: detour lookup failed -', err.message);
      }
      load().detours[key] = { km, at: Date.now() };
      save();
      changed();
    });
  }
  return d && d.km != null ? d.km : d ? NaN : null; // null: not known yet; NaN: failed
}

// ---------------------------------------------------------------------------
// Suggestions for one trip.
//
// home, dest: { lat, lon }; socLeave: the level when the car leaves (%);
// socEnd: the level when it is back (can be below 0); pctPerKm: battery % per
// km (without the margin); capacityKwh: the battery.
// Returns null when charging stops are off or the trip does not need one, else
// { status, reserve_pct, need_pct, need_kwh, reach_km, route_km, legs: [...],
//   stops: [...] }.
// The trip is there and back. A stop is planned as far along as the battery
// allows; when the battery is not enough after it either, the next stop follows
// from there (#40). legs: one per stop, each with up to three stations; the
// next stop is planned from the first station of the one before. stops: the
// stations of the first stop (as before #40).
// status: 'ok' | 'pending' | 'needs_routing' | 'no_key' | 'no_position' |
// 'no_route' | 'bad_key' | 'failed' | 'none' (no station fits) | 'partial'
// (the first stops fit, but from gap_km on no station does).
function suggest({ home, dest, socLeave, socEnd, pctPerKm, capacityKwh, now = Date.now() }) {
  const c = config();
  if (!c.enabled || socEnd == null || !(socEnd < c.reserve_pct)) return null;
  const needPct = Math.round((c.reserve_pct - socEnd) * 10) / 10;
  const base = {
    reserve_pct: c.reserve_pct,
    arrive_min_pct: c.arrive_min_pct,
    charge_to_pct: c.charge_to_pct,
    need_pct: needPct,
    need_kwh: capacityKwh > 0 ? Math.round((needPct / 100) * capacityKwh * 10) / 10 : null,
    stops: [],
    legs: [],
  };
  if (!tripcost.routing().online) return { ...base, status: 'needs_routing' };
  if (!c.api_key) return { ...base, status: 'no_key' };
  if (!home || !dest || dest.lat == null || dest.lon == null) return { ...base, status: 'no_position' };
  const route = routeOf(home, dest, now);
  if (!route) return { ...base, status: 'pending' };
  if (route.error) return { ...base, status: route.error === 'no_route' ? 'no_route' : 'failed' };
  const st = stationsOf(routeKey(home, dest), route.line, c.max_detour_km, c.min_power_kw, route.km, now);
  if (!st) return { ...base, status: 'pending', route_km: Math.round(route.km) };
  if (st.error) return { ...base, status: st.error === 'bad_key' ? 'bad_key' : 'failed', route_km: Math.round(route.km) };

  // Battery use per km, with the same 10 % margin as the trip cost. When the
  // trip's own cost says more (for example more places on the way), that.
  const R = route.km;
  const trip = 2 * R; // there and back
  const own = socLeave != null && trip > 0 ? (socLeave - socEnd) / trip : 0;
  const use = pctPerKm > 0 ? Math.max(pctPerKm * tripcost.MARGIN, own) : null;
  const points = decodePolyline(route.line);
  const prefer = new Set(c.operators);
  // Every station that fits your settings, with its place on the route line.
  // The line can be a little shorter than the road: scale to the road.
  let scale = 1;
  const near = [];
  for (const s of st.list) {
    if (c.only_countries && s.country && !c.countries.includes(s.country)) continue;
    const plugs = c.connectors.filter((k) => s.connectors[k] && s.connectors[k].kw >= c.min_power_kw);
    if (!plugs.length) continue;
    const pos = onRoute(points, s);
    if (pos.off * 2 > c.max_detour_km) continue;
    scale = pos.total > 0 ? R / pos.total : 1;
    near.push({ s, plugs, pos, preferred: !!s.operator_id && prefer.has(s.operator_id) });
  }
  // Each station is on the trip twice: on the way there and on the way back.
  // p: km from the start of the trip (there and back) to that point.
  const spots = [];
  for (const y of near) {
    const along = y.pos.along * scale;
    spots.push({ ...y, along, back: false, p: along });
    spots.push({ ...y, along, back: true, p: trip - along });
  }

  const rkey = routeKey(home, dest);
  let waiting = false;
  // The best stations for one stop: the real detour by road for the closest
  // (your operators first), then the smallest detour.
  const choose = (pool) => {
    pool.sort((a, b) => (b.preferred - a.preferred) || (a.pos.off - b.pos.off) || (b.p - a.p));
    const check = pool.slice(0, CHECK);
    let wait = false;
    for (const x of check) {
      const km = x.back ? viaKm(rkey, dest, x.s, home, true, now) : viaKm(rkey, home, x.s, dest, false, now);
      if (km === null) wait = true;
      // When the lookup failed: the straight estimate.
      x.detour = Number.isFinite(km) ? Math.max(0, km - R) : x.pos.off * 2;
    }
    if (wait) return null;
    // Within the maximum detour by road. When none is: the others up to a
    // longer detour (for example the other side of a motorway), marked as such.
    let fits = check.filter((x) => x.detour <= c.max_detour_km);
    const longer = !fits.length;
    if (longer) fits = check.filter((x) => x.detour <= Math.max(FAR_DETOUR_KM, c.max_detour_km * 3));
    // Your operators first: other operators only when none of yours fits. Then
    // the smallest detour, then the most power.
    const mine = fits.filter((x) => x.preferred);
    const pick = mine.length ? mine : fits;
    const kw = (x) => Math.max(...x.plugs.map((k) => x.s.connectors[k].kw));
    pick.sort((a, b) => (a.detour - b.detour) || (kw(b) - kw(a)));
    // A station once, also when it fits on the way there and on the way back.
    const seen = new Set();
    const unique = pick.filter((x) => !seen.has(x.s.id) && seen.add(x.s.id));
    return { pick: unique, longer: longer && pick.length > 0, others: prefer.size > 0 && !mine.length && fits.length > 0 };
  };
  const item = (x, far) => ({
    id: x.s.id,
    name: x.s.name,
    town: x.s.town,
    country: x.s.country,
    operator: x.s.operator,
    preferred: x.preferred,
    power_kw: Math.round(Math.max(...x.plugs.map((k) => x.s.connectors[k].kw))),
    connectors: x.plugs.map((k) => CONNECTORS[k].name),
    points: x.plugs.reduce((a, k) => a + x.s.connectors[k].count, 0),
    km_from_home: Math.round(x.along),
    km_on_trip: Math.round(x.p),
    on_way_back: x.back,
    detour_km: Math.round(x.detour * 10) / 10,
    ...(far ? { longer_detour: true } : {}),
    url: `https://map.openchargemap.io/?id=${encodeURIComponent(x.s.id)}`,
  });

  const legs = [];
  let gap = null;
  // Reach: down to the lowest level to arrive with at a charger. Below the
  // level for a stop the app looks for one (#40).
  const low = c.arrive_min_pct;
  const range0 = use && socLeave != null ? Math.max(0, (socLeave - low) / use) : null;
  if (range0 == null) {
    // The use per km or the level is not known: one stop, anywhere on the way there.
    const got = choose(spots.filter((x) => !x.back));
    if (!got) waiting = true;
    else if (!got.pick.length) gap = 0;
    else legs.push({ got, first: got.pick[0], arrive: null, to: null });
  } else {
    // How far a stop gets you: from the reserve up to "charge to".
    const full = Math.max(0, (c.charge_to_pct - c.reserve_pct) / use);
    let x = 0;
    let soc = socLeave;
    for (let n = 0; n < MAX_STOPS; n++) {
      // Home again above the level for a stop: no (more) stop needed.
      if (x + Math.max(0, (soc - c.reserve_pct) / use) >= trip) break;
      const range = Math.max(0, (soc - low) / use);
      // Stations ahead that the car reaches with at least the lowest level
      // (along the route, then off it).
      const ahead = spots.filter((y) => y.p > x + (n ? 1 : -1) && y.p + y.pos.off <= x + range);
      // A stop after which the rest of the trip fits; else one where the car
      // arrives below the level for a stop (fast charging when nearly empty);
      // else one far along (the second half of the reach), so there are not
      // more stops than needed.
      const search = x + Math.max(0, (soc - c.reserve_pct) / use);
      const last = ahead.filter((y) => y.p + full >= trip);
      const low2 = ahead.filter((y) => y.p >= search);
      const late = ahead.filter((y) => y.p >= x + range / 2);
      const pool = last.length ? last : low2.length ? low2 : late.length ? late : ahead;
      if (!pool.length) { gap = x; break; }
      const got = choose(pool.map((y) => ({ ...y })));
      if (!got) { waiting = true; break; }
      if (!got.pick.length) { gap = x; break; }
      const first = got.pick[0];
      const arrive = soc - (first.p - x) * use;
      // At the last stop: only what the rest needs (rounded up), at most "charge to".
      const fin = first.p + full >= trip;
      const to = fin ? Math.min(c.charge_to_pct, Math.ceil(c.reserve_pct + (trip - first.p) * use)) : c.charge_to_pct;
      legs.push({ got, first, arrive, to });
      if (!(first.p > x)) { gap = x; break; } // never stand still
      x = first.p;
      soc = to;
      if (n === MAX_STOPS - 1 && x + Math.max(0, (soc - c.reserve_pct) / use) < trip) gap = x;
    }
  }

  const common = {
    route_km: Math.round(R),
    reach_km: range0 == null ? null : Math.round(range0),
    stops_needed: legs.length,
  };
  if (waiting) return { ...base, ...common, status: 'pending' };
  const out = legs.map((l, i) => ({
    n: i + 1,
    km_on_trip: Math.round(l.first.p),
    on_way_back: l.first.back,
    arrive_pct: l.arrive == null ? null : Math.round(l.arrive),
    charge_to_pct: l.to,
    stations: l.got.pick.slice(0, SHOW).map((x) => item(x, l.got.longer)),
    found: l.got.pick.length,
    longer_only: l.got.longer,
    others_only: l.got.others,
  }));
  const first = out[0];
  return {
    ...base,
    ...common,
    status: gap != null ? (out.length ? 'partial' : 'none') : out.length ? 'ok' : 'none',
    ...(gap != null ? { gap_km: Math.round(gap) } : {}),
    legs: out,
    // The first stop, as before more stops (#40).
    stops: first ? first.stations : [],
    found: first ? first.found : 0,
    on_way_back: first ? first.on_way_back : false,
    longer_only: first ? first.longer_only : false,
    others_only: first ? first.others_only : false,
  };
}

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
  cache = { routes: {}, stations: {}, detours: {} };
  queue.length = 0;
  queued.clear();
}
function idle() {
  return !running && !queue.length;
}

module.exports = {
  COUNTRIES, OPERATORS, CONNECTORS, DEFAULTS, MAX_STOPS,
  setConfig, config, enabled, clean, view, suggest, onUpdate, setUserAgent,
  decodePolyline, encodePolyline, thin, onRoute, shortStation, operatorOf, connectorOf,
  reset, idle,
};

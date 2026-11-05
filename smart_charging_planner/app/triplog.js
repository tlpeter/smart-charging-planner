'use strict';

// Trip log (#61): the real use of every drive, per car, kept for as long as
// the app runs. On by default (Settings › Vehicle › Keep a trip log).
//
// Source: Home Assistant's long-term statistics (hourly, kept for years by
// default), so the drives from before the app knew about them are found too.
// Only read: recorder/statistics_during_period.
//  - the car's odometer (total km, state_class total_increasing): the real km;
//  - the car's battery level (mean/min/max per hour);
//  - an outside temperature sensor (mean per hour), for the cold (#56).
// A drive is a run of hours in which the odometer went up. Its battery level
// at the start is the highest value of the hour before and the first hour,
// at the end the lowest value of the last hour and the hour after. When the
// level went up on the way (charged away from home), the drive is listed but
// not used for the use per km.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'triplog.json');
const HOUR = 3600000;
const BACK_DAYS = 3 * 365; // the first time: up to three years back
const CHUNK_DAYS = 60; // statistics asked per part
const MIN_KM = 3; // a shorter drive is not listed
const USE_KM = 15; // shorter drives are too rough for the use per km
const MIN_DROP = 2; // % used, at least
const CHARGED_PCT = 2; // the level went up this much on the way: charged
const MAX_DRIVES = 10000; // per car, a safety limit (more than 25 years of drives)
const RECENT = 20; // drives used for the use per km now

let cache = null;
function load() {
  if (!cache) cache = readJson(FILE, null) || {};
  cache.cars = cache.cars || {};
  return cache;
}
function save() {
  try { writeJsonAtomic(FILE, load()); } catch { /* best effort */ }
}

// --- Which sensors --------------------------------------------------------

const words = (...p) => p.filter(Boolean).join(' ').toLowerCase();
const num = (s) => (s && s.state !== '' && Number.isFinite(Number(s.state)) ? Number(s.state) : null);

// The car's odometer: a distance sensor on the car's device that only goes up.
function findOdometer(vehicle, entities, states) {
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const onCar = (entities || []).filter((e) => vehicle.device_id && e.device_id === vehicle.device_id && !e.disabled_by && e.entity_id.startsWith('sensor.'));
  const score = (e) => {
    const s = byId.get(e.entity_id);
    const a = (s && s.attributes) || {};
    const name = words(e.entity_id, a.friendly_name, e.original_name, e.name);
    if (e.entity_id === vehicle.range_entity || /range|bereik|actieradius|remaining/.test(name)) return 0;
    let n = 0;
    if (/odometer|mileage|kilometer|kilometre|total.?distance|km.?stand|tachometer/.test(name)) n += 3;
    if (a.device_class === 'distance') n += 1;
    if (a.state_class === 'total_increasing' || a.state_class === 'total') n += 2;
    return n >= 3 ? n : 0;
  };
  const best = onCar.map((e) => [e, score(e)]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])[0];
  return best ? best[0].entity_id : null;
}

// An outside temperature: the car's own sensor first, then another outdoor
// sensor in Home Assistant (with statistics, so a number with a unit).
function findTemperature(vehicle, entities, states) {
  const outdoor = /outside|outdoor|exterior|ambient|buiten/;
  const isTemp = (s) => s && s.attributes && (s.attributes.device_class === 'temperature' || /°c|°f/i.test(String(s.attributes.unit_of_measurement || '')));
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const onCar = (entities || []).filter((e) => vehicle.device_id && e.device_id === vehicle.device_id && e.entity_id.startsWith('sensor.'));
  // The car's own sensor, when it reports a number (some cars never do).
  const carTemps = onCar.filter((e) => { const s = byId.get(e.entity_id); return isTemp(s) && outdoor.test(words(e.entity_id, s.attributes.friendly_name, e.original_name)); });
  const live = carTemps.find((e) => num(byId.get(e.entity_id)) != null);
  if (live) return live.entity_id;
  const others = (states || []).filter((s) => s.entity_id.startsWith('sensor.') && isTemp(s) && s.attributes.state_class === 'measurement'
    && outdoor.test(words(s.entity_id, s.attributes.friendly_name)) && num(s) != null);
  others.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  if (others.length) return others[0].entity_id;
  return carTemps.length ? carTemps[0].entity_id : null;
}

// The sensors the log uses for a car: chosen in Settings, else found.
function sensorsFor(vehicle, entities, states) {
  return {
    odometer: vehicle.odometer_entity || findOdometer(vehicle, entities, states),
    soc: vehicle.mode === 'sensor' ? vehicle.soc_entity || null : null,
    temp: vehicle.temperature_entity || findTemperature(vehicle, entities, states),
  };
}

function enabled(vehicle) {
  return !!vehicle && vehicle.trip_log !== false;
}

// --- From statistics to drives (pure, tested) ------------------------------

const startOf = (r) => (typeof r.start === 'number' ? r.start : Date.parse(r.start));

// rows: { odo: [{start, state|sum}], soc: [{start, mean, min, max}], temp: [{start, mean}] }
// Returns the drives that ended before `until` (a drive still going on is left
// for the next time).
function drivesFrom(rows, { capacityKwh = null, until = Infinity } = {}) {
  const odo = new Map();
  for (const r of rows.odo || []) {
    const v = Number.isFinite(r.state) ? r.state : Number.isFinite(r.sum) ? r.sum : null;
    if (v != null) odo.set(startOf(r), v);
  }
  const soc = new Map((rows.soc || []).filter((r) => Number.isFinite(r.max) || Number.isFinite(r.mean)).map((r) => [startOf(r), r]));
  const temp = new Map((rows.temp || []).filter((r) => Number.isFinite(r.mean)).map((r) => [startOf(r), r.mean]));
  const hours = [...odo.keys()].sort((a, b) => a - b);
  // Km driven in an hour: the odometer at the end of this hour minus the hour before.
  const driven = new Map();
  for (let i = 1; i < hours.length; i++) {
    if (hours[i] - hours[i - 1] !== HOUR) continue; // a gap: not known
    const km = odo.get(hours[i]) - odo.get(hours[i - 1]);
    if (km >= 0.5 && km < 400) driven.set(hours[i], km);
  }
  const hi = (h) => { const r = soc.get(h); return r ? (Number.isFinite(r.max) ? r.max : r.mean) : null; };
  const lo = (h) => { const r = soc.get(h); return r ? (Number.isFinite(r.min) ? r.min : r.mean) : null; };
  const drives = [];
  const starts = [...driven.keys()].sort((a, b) => a - b);
  let i = 0;
  while (i < starts.length) {
    const first = starts[i];
    let last = first;
    while (i + 1 < starts.length && starts[i + 1] === last + HOUR) { i++; last = starts[i]; }
    i++;
    if (last + 2 * HOUR > until) continue; // still going on, or the hour after is not known yet
    const km = odo.get(last) - odo.get(first - HOUR);
    if (!(km >= MIN_KM)) continue;
    const startVals = [hi(first - HOUR), hi(first)].filter(Number.isFinite);
    const endVals = [lo(last), lo(last + HOUR)].filter(Number.isFinite);
    const socStart = startVals.length ? Math.max(...startVals) : null;
    const socEnd = endVals.length ? Math.min(...endVals) : null;
    // Charged on the way: the level went up from one driving hour to the next.
    let charged = false;
    for (let h = first + HOUR; h <= last; h += HOUR) {
      if (Number.isFinite(hi(h)) && Number.isFinite(lo(h - HOUR)) && hi(h) > lo(h - HOUR) + CHARGED_PCT) charged = true;
    }
    const drop = socStart != null && socEnd != null ? Math.round((socStart - socEnd) * 10) / 10 : null;
    const temps = [];
    for (let h = first; h <= last; h += HOUR) if (temp.has(h)) temps.push(temp.get(h));
    const t = temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null;
    const v = drop != null && drop > 0 ? drop / km : null;
    const usable = !charged && km >= USE_KM && drop != null && drop >= MIN_DROP && v >= 0.05 && v <= 1.5;
    drives.push({
      start: first, end: last + HOUR,
      km: Math.round(km * 10) / 10,
      soc_start: socStart, soc_end: socEnd, pct: drop,
      kwh: drop != null && capacityKwh > 0 ? Math.round((drop / 100) * capacityKwh * 10) / 10 : null,
      pct_100km: v != null ? Math.round(v * 1000) / 10 : null,
      kwh_100km: v != null && capacityKwh > 0 ? Math.round(v * capacityKwh * 10) / 10 : null,
      temp: t,
      ...(charged ? { charged: true } : {}),
      used: usable,
      ...(!usable ? { why: charged ? 'charged' : drop == null ? 'no_soc' : km < USE_KM ? 'short' : 'implausible' } : {}),
    });
  }
  return drives;
}

// --- Keeping the log up to date --------------------------------------------

function carRec(id) {
  const c = load();
  return c.cars[id] || null;
}

// Read the statistics of a car from `from` up to `to`, in parts.
async function readStats(call, ids, from, to) {
  const out = { odo: [], soc: [], temp: [] };
  for (let t = from; t < to; t += CHUNK_DAYS * 86400000) {
    const end = Math.min(to, t + CHUNK_DAYS * 86400000);
    const list = [ids.odometer, ids.soc, ids.temp].filter(Boolean);
    const r = await call({
      type: 'recorder/statistics_during_period',
      start_time: new Date(t).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: list,
      period: 'hour',
      types: ['state', 'sum', 'mean', 'min', 'max'],
      units: { distance: 'km', temperature: '°C' },
    });
    out.odo.push(...((r && r[ids.odometer]) || []));
    if (ids.soc) out.soc.push(...((r && r[ids.soc]) || []));
    if (ids.temp) out.temp.push(...((r && r[ids.temp]) || []));
  }
  return out;
}

// Bring the log of one car up to date. call: ha.call. Returns the record.
async function refresh(vehicle, { call, entities, states, now = Date.now(), log = () => {} }) {
  if (!enabled(vehicle) || !vehicle.id) return null;
  const ids = sensorsFor(vehicle, entities, states);
  const c = load();
  let rec = c.cars[vehicle.id];
  // Other sensors than before: start again (the drives would not compare).
  if (rec && (rec.sensors.odometer !== ids.odometer || rec.sensors.soc !== ids.soc)) rec = null;
  if (!ids.odometer || !ids.soc) {
    c.cars[vehicle.id] = { sensors: ids, drives: rec ? rec.drives : [], done_until: rec ? rec.done_until : null, status: !ids.odometer ? 'no_odometer' : 'no_soc', at: now };
    save();
    return c.cars[vehicle.id];
  }
  const hourNow = Math.floor(now / HOUR) * HOUR;
  // Again from a day before what was done, so a drive around that moment is complete.
  const from = rec && rec.done_until ? rec.done_until - 24 * HOUR : hourNow - BACK_DAYS * 86400000;
  const first = !rec || !rec.done_until;
  const rows = await readStats(call, ids, from, hourNow);
  const found = drivesFrom(rows, { capacityKwh: vehicle.capacity_kwh, until: hourNow });
  const keep = rec ? rec.drives.filter((d) => d.start < from) : [];
  const byStart = new Map(keep.map((d) => [d.start, d]));
  for (const d of found) byStart.set(d.start, d);
  const drives = [...byStart.values()].sort((a, b) => a.start - b.start).slice(-MAX_DRIVES);
  // Done: up to the start of the hours that may still belong to a drive going on.
  const doneUntil = Math.max(from, hourNow - 2 * HOUR);
  c.cars[vehicle.id] = { sensors: ids, drives, done_until: doneUntil, status: 'ok', at: now, ...(first ? { first_from: from } : rec && rec.first_from ? { first_from: rec.first_from } : {}) };
  save();
  if (first) log(`Trip log: ${drives.length} drive(s) found in the history of ${vehicle.name || 'the car'}`);
  return c.cars[vehicle.id];
}

// --- What the log tells ---------------------------------------------------

// For the trip estimate and the cold correction (tripcost.js): the use per km
// of the latest drives (total % / total km) and every usable drive as a
// sample with its temperature. null with fewer than 2 usable drives.
function model(vehicleId) {
  const rec = carRec(vehicleId);
  const used = rec ? rec.drives.filter((d) => d.used) : [];
  if (used.length < 2) return null;
  const recent = used.slice(-RECENT);
  const km = recent.reduce((a, d) => a + d.km, 0);
  const pct = recent.reduce((a, d) => a + d.pct, 0);
  return {
    pct_per_km: pct / km,
    trips: used.length,
    at: used[used.length - 1].end,
    samples: used.map((d) => ({ v: d.pct / d.km, t: d.temp, at: d.end })),
    source: 'log',
  };
}

// For the page: the drives (newest first) and a summary.
function view(vehicleId, limit = 500) {
  const rec = carRec(vehicleId);
  if (!rec) return { status: 'not_yet', drives: [], total: 0 };
  const used = rec.drives.filter((d) => d.used);
  const km = used.reduce((a, d) => a + d.km, 0);
  const pct = used.reduce((a, d) => a + d.pct, 0);
  return {
    status: rec.status,
    sensors: rec.sensors,
    at: rec.at,
    since: rec.drives.length ? rec.drives[0].start : null,
    total: rec.drives.length,
    used: used.length,
    km: Math.round(rec.drives.reduce((a, d) => a + d.km, 0)),
    pct_100km: km > 0 ? Math.round((pct / km) * 1000) / 10 : null,
    drives: rec.drives.slice(-limit).reverse(),
  };
}

// Tests only.
function reset() {
  cache = { cars: {} };
}

module.exports = { enabled, sensorsFor, findOdometer, findTemperature, drivesFrom, refresh, model, view, reset, USE_KM, MIN_KM };

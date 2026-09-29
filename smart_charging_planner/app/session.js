'use strict';

// Charging session tracking, for cars without their own integration.
//
// Keeps track of when the car was plugged in and unplugged (from a plugged-in
// sensor or from the charger status), the battery level the user entered, and
// how much energy the charger delivered since then (from 5-minute statistics
// of the charger power sensor).

const fs = require('fs');
const path = require('path');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'session.json');
const CACHE_MS = 60000;

let state = null;
let energyCache = null; // { key, at, kwh }

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = { plugged: null, since: null, since_known: false, manual_soc: null };
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

// Called at every refresh with the current plugged-in state.
function update(plugged, now = Date.now()) {
  const s = load();
  if (plugged == null) return s;
  let changed = false;
  if (plugged && s.plugged !== true) {
    // Plugged in. If the app did not see it happen (first start), the real
    // moment is unknown.
    s.since = now;
    s.since_known = s.plugged === false;
    changed = true;
  }
  if (!plugged && s.plugged !== false) {
    // Unplugged: forget the entered battery level.
    s.since = null;
    s.since_known = false;
    s.manual_soc = null;
    changed = true;
  }
  s.plugged = plugged;
  if (changed) {
    save();
    ha.log(plugged ? 'Car plugged in' : 'Car unplugged');
  }
  return s;
}

function setManualSoc(value, now = Date.now()) {
  const s = load();
  s.manual_soc = { value, at: now };
  save();
  return s;
}

// kWh the charger delivered between `from` and now.
async function energySince(powerEntity, from, now = Date.now()) {
  if (!powerEntity || !from || from >= now) return 0;
  const key = `${powerEntity}|${from}`;
  if (energyCache && energyCache.key === key && now - energyCache.at < CACHE_MS) return energyCache.kwh;
  const data = await ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(now).toISOString(),
    statistic_ids: [powerEntity],
    period: '5minute',
    types: ['mean'],
    units: { power: 'W' },
  });
  const rows = (data && data[powerEntity]) || [];
  let kwh = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.mean)) continue;
    // Only the part of each 5-minute slot after `from` counts.
    const start = Math.max(r.start, from);
    const end = Math.min(r.end || r.start + 300000, now);
    if (end > start) kwh += (Math.max(0, r.mean) / 1000) * ((end - start) / 3600000);
  }
  energyCache = { key, at: now, kwh };
  return kwh;
}

function current() {
  return load();
}

module.exports = { update, setManualSoc, energySince, current };

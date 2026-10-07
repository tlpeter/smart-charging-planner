'use strict';

// Stores the app's own settings in /data, which survives app updates.

const fs = require('fs');
const path = require('path');
const { options } = require('./options');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  // A list from the start, so more vehicles can be added later.
  vehicles: [],
  multi_car: false, // "I have more than one car" (Settings › Vehicle)
  chargers: [],
  grid: [],
  prices: null,
  planning: { target_soc: 80, ready_by: '07:00', loss_percent: 10, use_house_load: true, continuous: true, min_split_saving: 0.5 },
  departures: null, // filled by departures.js defaults on first use
  control: null, // control rules and chosen methods (controller.js defaults)
  notify: { service: null }, // notify action chosen in the app
};

// The planning settings come from the app's Configuration tab in Home
// Assistant; they always win over anything saved earlier in the app.
function planningOptions() {
  return {
    loss_percent: options.loss_percent,
    continuous: options.continuous_charging,
    min_split_saving: options.min_split_saving,
    use_house_load: options.use_house_load,
  };
}

function load() {
  let s;
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    s = { ...DEFAULTS, ...saved, planning: { ...DEFAULTS.planning, ...(saved.planning || {}) } };
  } catch {
    s = JSON.parse(JSON.stringify(DEFAULTS));
  }
  s.planning = { ...s.planning, ...planningOptions() };
  // Every vehicle has a stable id (settings from before more cars had none).
  if (Array.isArray(s.vehicles) && vehicleIds(s.vehicles)) {
    try { save(s); } catch { /* read-only: ids again next time, the same ones */ }
  }
  return s;
}

function vehicleIds(vehicles) {
  let changed = false;
  const used = new Set(vehicles.map((v) => v && v.id).filter(Boolean));
  const seen = new Set();
  vehicles.forEach((v, i) => {
    if (!v) return;
    if (v.id && !seen.has(v.id)) {
      seen.add(v.id);
      return;
    }
    let n = i + 1;
    while (used.has(`car${n}`)) n++;
    v.id = `car${n}`;
    used.add(v.id);
    seen.add(v.id);
    changed = true;
  });
  return changed;
}

function save(settings) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, vehicleIds };

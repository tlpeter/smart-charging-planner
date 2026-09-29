'use strict';

// Stores the app's own settings in /data, which survives app updates.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  // A list from the start, so more vehicles can be added later.
  vehicles: [],
  chargers: [],
  grid: [],
  prices: null,
  planning: { target_soc: 80, ready_by: '07:00', loss_percent: 10, use_house_load: true, continuous: true, min_split_saving: 0.5 },
  departures: null, // filled by departures.js defaults on first use
};

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const saved = JSON.parse(raw);
    return { ...DEFAULTS, ...saved, planning: { ...DEFAULTS.planning, ...(saved.planning || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(settings) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save };

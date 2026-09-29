'use strict';

// Options from the app's Configuration tab in Home Assistant.
// The Supervisor writes them to /data/options.json; changing them restarts the app.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULTS = { log_level: 'info', allow_control: false, refresh_minutes: 5 };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    const merged = { ...DEFAULTS, ...raw };
    const n = Math.round(Number(merged.refresh_minutes));
    merged.refresh_minutes = n >= 1 && n <= 60 ? n : DEFAULTS.refresh_minutes;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { options: load() };

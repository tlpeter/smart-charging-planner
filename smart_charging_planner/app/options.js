'use strict';

// Options from the app's Configuration tab in Home Assistant.
// The Supervisor writes them to /data/options.json; changing them restarts the app.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULTS = { log_level: 'info', allow_control: false };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { options: load() };

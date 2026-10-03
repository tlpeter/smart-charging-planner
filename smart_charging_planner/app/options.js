'use strict';

// Options from the app's Configuration tab in Home Assistant.
// The Supervisor writes them to /data/options.json; changing them restarts the app.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULTS = {
  log_level: 'info',
  allow_control: false,
  allow_battery_control: false,
  refresh_minutes: 5,
  allow_calendar_write: false,
  loss_percent: 10,
  continuous_charging: true,
  min_split_saving: 0.5,
  use_house_load: true,
  notify_start_stop: true,
  publish_sensors: false,
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    const merged = { ...DEFAULTS, ...raw };
    const n = Math.round(Number(merged.refresh_minutes));
    merged.refresh_minutes = n >= 1 && n <= 60 ? n : DEFAULTS.refresh_minutes;
    const loss = Number(merged.loss_percent);
    merged.loss_percent = loss >= 0 && loss <= 30 ? loss : DEFAULTS.loss_percent;
    const split = Number(merged.min_split_saving);
    merged.min_split_saving = split >= 0 && split <= 20 ? split : DEFAULTS.min_split_saving;
    merged.continuous_charging = merged.continuous_charging !== false;
    merged.use_house_load = merged.use_house_load !== false;
    merged.notify_start_stop = merged.notify_start_stop !== false;
    merged.publish_sensors = merged.publish_sensors === true;
    merged.allow_battery_control = merged.allow_battery_control === true;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { options: load() };

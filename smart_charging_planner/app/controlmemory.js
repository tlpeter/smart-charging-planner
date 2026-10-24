'use strict';

// Write-ahead record of device changes owned by this app. Survives a crash or
// update. A record is cleared only after the release command was accepted.
const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const scope = require('./scope');
const DIR = process.env.DATA_DIR || '/data';
const CHARGER = path.join(DIR, 'device_control.json');
const BATTERY = path.join(DIR, 'battery_control.json');

function charger(identity) {
  const saved = readJson(scope.file(CHARGER), null);
  return saved && saved.identity === identity ? saved : { identity, current: null, phases: null };
}

function setCharger(identity, patch) {
  const next = { ...charger(identity), ...patch, identity };
  writeJsonAtomic(scope.file(CHARGER), next);
  return next;
}

function battery() { return readJson(BATTERY, null); }
function setBattery(value) { writeJsonAtomic(BATTERY, value); }

module.exports = { charger, setCharger, battery, setBattery };

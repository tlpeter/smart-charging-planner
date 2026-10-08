'use strict';

// "Charge now": a manual override that charges right away until a goal is
// reached, the car is unplugged, or the user stops it.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');
const scope = require('./scope');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'boost.json');
const MODES = ['target', 'soc', 'kwh'];

// Per charger (scope.js).
const S = scope.store(() => ({ state: undefined }));

function load() {
  if (S().state !== undefined) return S().state;
  S().state = readJson(scope.file(FILE), null);
  return S().state;
}

function save() {
  writeJsonAtomic(scope.file(FILE), S().state);
}

function current() {
  return load();
}

function start({ mode, value }, now = Date.now()) {
  S().state = { mode, value: mode === 'target' ? null : value, started: now };
  save();
  ha.log(`Charge now started (${mode}${S().state.value != null ? ' ' + S().state.value : ''})`);
  return S().state;
}

function update(fields) {
  if (!load()) return null;
  Object.assign(S().state, fields);
  save();
  return S().state;
}

// Ends Charge now and returns how it was, so the caller can undo the start.
function stop(reason) {
  const prev = load();
  if (!prev) return null;
  ha.log(`Charge now ended (${reason})`);
  S().state = null;
  save();
  return prev;
}

module.exports = { MODES, current, start, stop, update };

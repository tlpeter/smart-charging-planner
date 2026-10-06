'use strict';

// "Charge now": a manual override that charges right away until a goal is
// reached, the car is unplugged, or the user stops it.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'boost.json');
const MODES = ['target', 'soc', 'kwh'];

let state;

function load() {
  if (state !== undefined) return state;
  state = readJson(FILE, null);
  return state;
}

function save() {
  writeJsonAtomic(FILE, state);
}

function current() {
  return load();
}

function start({ mode, value }, now = Date.now()) {
  state = { mode, value: mode === 'target' ? null : value, started: now };
  save();
  ha.log(`Charge now started (${mode}${state.value != null ? ' ' + state.value : ''})`);
  return state;
}

function update(fields) {
  if (!load()) return null;
  Object.assign(state, fields);
  save();
  return state;
}

// Ends Charge now and returns how it was, so the caller can undo the start.
function stop(reason) {
  const prev = load();
  if (!prev) return null;
  ha.log(`Charge now ended (${reason})`);
  state = null;
  save();
  return prev;
}

module.exports = { MODES, current, start, stop, update };

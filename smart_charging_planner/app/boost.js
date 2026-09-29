'use strict';

// "Charge now": a manual override that charges right away until a goal is
// reached, the car is unplugged, or the user stops it.

const fs = require('fs');
const path = require('path');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'boost.json');
const MODES = ['target', 'soc', 'kwh'];

let state;

function load() {
  if (state !== undefined) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = null;
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state));
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

function stop(reason) {
  if (!load()) return;
  ha.log(`Charge now ended (${reason})`);
  state = null;
  save();
}

module.exports = { MODES, current, start, stop };

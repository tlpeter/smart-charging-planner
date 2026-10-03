'use strict';

// How to charge, chosen on Home (a usage choice, not a setting):
//   plan        the price plan only
//   plan_solar  the price plan, plus solar surplus whenever there is some;
//               the plan counts on the expected solar power
//   solar       solar surplus only (Charge now, the minimum battery level and
//               preconditioning still work)

const fs = require('fs');
const path = require('path');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'mode.json');
const MODES = ['plan', 'plan_solar', 'solar'];

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

// The mode in use. Without solar set up, always "plan".
function current(solarEnabled) {
  if (!solarEnabled) return 'plan';
  const s = load();
  return s && MODES.includes(s.mode) ? s.mode : 'plan_solar';
}

function set(mode) {
  if (!MODES.includes(mode)) throw new Error('Unknown mode');
  state = { mode, at: Date.now() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state));
  ha.log(`Charging mode: ${mode}`);
  return state;
}

module.exports = { MODES, current, set };

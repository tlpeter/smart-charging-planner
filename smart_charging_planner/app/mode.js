'use strict';

// How to charge, chosen on Home (a usage choice, not a setting):
//   plan        the price plan only
//   plan_solar  the price plan, plus solar surplus whenever there is some;
//               the plan counts on the expected solar power
//   solar       solar surplus only (Charge now, the minimum battery level and
//               preconditioning still work)

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');
const scope = require('./scope');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'mode.json');
const MODES = ['plan', 'plan_solar', 'solar'];

// Per charger (scope.js).
const S = scope.store(() => ({ state: undefined }));

function load() {
  if (S().state !== undefined) return S().state;
  S().state = readJson(scope.file(FILE), null);
  return S().state;
}

// The mode in use. Without solar set up, always "plan".
function current(solarEnabled) {
  if (!solarEnabled) return 'plan';
  const s = load();
  return s && MODES.includes(s.mode) ? s.mode : 'plan_solar';
}

function set(mode) {
  if (!MODES.includes(mode)) throw new Error('Unknown mode');
  S().state = { mode, at: Date.now() };
  writeJsonAtomic(scope.file(FILE), S().state);
  ha.log(`Charging mode: ${mode}`);
  return S().state;
}

module.exports = { MODES, current, set };

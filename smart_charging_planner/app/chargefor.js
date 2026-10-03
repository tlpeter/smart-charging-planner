'use strict';

// "Ready for": a one-off choice to have the car ready on a later day (for
// example the day after tomorrow, when that is cheaper), instead of the next
// departure. Departures before it get a minimum battery level, so the car is
// never empty in between. Ends by itself after the chosen time.

const fs = require('fs');
const path = require('path');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'chargefor.json');
const MIN_RANGE = [20, 45]; // allowed minimum battery level for departures in between

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

// The active choice, or null. An expired choice is removed.
function current(now = Date.now()) {
  const s = load();
  if (s && !(s.until > now)) {
    ha.log('Ready-for choice ended (time passed)');
    state = null;
    save();
    return null;
  }
  return s;
}

// { day: 'tomorrow' | 'day_after', until: ms, soc, min_soc }
function set(choice, now = Date.now()) {
  state = { ...choice, created: now };
  save();
  ha.log(`Ready-for choice set: ${choice.day}, ${choice.soc}% by ${new Date(choice.until).toISOString()}, minimum ${choice.min_soc}%`);
  return state;
}

function clear(reason) {
  const prev = load();
  if (!prev) return null;
  ha.log(`Ready-for choice ended (${reason})`);
  state = null;
  save();
  return prev;
}

module.exports = { MIN_RANGE, current, set, clear };

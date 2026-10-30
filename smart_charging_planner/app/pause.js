'use strict';

// Pause until (#33): you pause a charger until a time, until the car is
// unplugged, or until you resume it. The plan does not start the charger
// meanwhile. Per charger (scope.js), kept across a restart.
//
// Hand back control (#33): the app has put back what it changed on the
// chargers and the home battery, and sends nothing to them until you resume
// control. For the whole house (not per charger), kept across a restart.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');
const scope = require('./scope');

const DATA_DIR = process.env.DATA_DIR || '/data';
const PAUSE_FILE = path.join(DATA_DIR, 'pause.json');
const RELEASE_FILE = path.join(DATA_DIR, 'hands_off.json');
const MODES = ['time', 'unplug', 'resume'];
const MAX_PAUSE_MS = 7 * 24 * 3600000;

const S = scope.store(() => ({ state: undefined }));

function load() {
  if (S().state === undefined) S().state = readJson(scope.file(PAUSE_FILE), null);
  return S().state;
}

function save() {
  writeJsonAtomic(scope.file(PAUSE_FILE), S().state);
}

// The pause now, or null. A pause until a time ends by itself.
function current(now = Date.now()) {
  const p = load();
  if (!p) return null;
  if (p.mode === 'time' && !(p.until > now)) {
    stop('the pause time has passed');
    return null;
  }
  return p;
}

// Check a request from the page: { until: 'time' | 'unplug' | 'resume', at }.
function validate(body, now = Date.now()) {
  const mode = body && body.until;
  if (!MODES.includes(mode)) return { error: 'Choose until when to pause' };
  if (mode !== 'time') return { mode, until: null };
  const at = Number(body.at);
  if (!Number.isFinite(at) || at <= now + 60000) return { error: 'Choose a time in the future' };
  if (at > now + MAX_PAUSE_MS) return { error: 'A pause can last at most 7 days' };
  return { mode, until: Math.round(at) };
}

function start({ mode, until }, now = Date.now()) {
  S().state = { mode, until: mode === 'time' ? until : null, started: now };
  save();
  ha.log(`Paused by you (${mode === 'time' ? `until ${new Date(until).toISOString()}` : mode === 'unplug' ? 'until the car is unplugged' : 'until you resume'})`);
  return S().state;
}

function stop(reason) {
  const prev = load();
  if (!prev) return null;
  S().state = null;
  save();
  ha.log(`Pause ended (${reason})`);
  return prev;
}

// ---------------------------------------------------------------------------
// Hand back control: one record for the whole house.
let released;

function releasedNow() {
  if (released === undefined) released = readJson(RELEASE_FILE, null);
  return released;
}

// Written before anything is restored, so a control step that runs
// meanwhile (or after a restart) already leaves the devices alone.
function setReleased(value) {
  released = value || null;
  writeJsonAtomic(RELEASE_FILE, released);
  return released;
}

module.exports = { MODES, MAX_PAUSE_MS, current, validate, start, stop, releasedNow, setReleased };

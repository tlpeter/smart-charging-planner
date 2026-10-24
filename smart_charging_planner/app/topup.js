'use strict';

// "Ask to charge more for a long trip" (Settings › Rules, off by default).
// When the next trip costs more than the target leaves room for (with a
// reserve to be back home with), the app asks on your phone whether to charge
// more for that one trip. Only after "Yes" does the target go up, and only for
// that trip. "No", or no answer, keeps the target. One question per trip.

const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const ha = require('./ha');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'topup.json');
const SAME_TRIP_MS = 60000;
const ACTION = /^SCP_TOPUP_(YES|NO)_([0-9a-f]{8})$/;

// { [vehicle id]: { time, soc, from, pct, title, state: 'asked' | 'yes' | 'no', token, at, answered_at } }
let state;
function load() {
  if (state === undefined) state = readJson(FILE, () => ({})) || {};
  return state;
}
function save() {
  writeJsonAtomic(FILE, state);
}

// The question or answer for this car, or null. One for a trip that is gone is removed.
function current(vehicleId, now = Date.now()) {
  const s = load();
  const r = vehicleId ? s[vehicleId] : null;
  if (r && !(r.time > now - SAME_TRIP_MS)) {
    delete s[vehicleId];
    save();
    return null;
  }
  return r || null;
}

// After "Yes": the higher target for this one departure.
function apply(vehicleId, departure, now = Date.now()) {
  const r = current(vehicleId, now);
  if (!departure || !r || r.state !== 'yes' || Math.abs(r.time - departure.time) > SAME_TRIP_MS) return departure;
  if (!(r.soc > departure.soc)) return departure;
  return { ...departure, soc: r.soc, topup: { from: departure.soc, soc: r.soc } };
}

// A new question, or null when this trip was already asked (and not grown
// since) or you said no to it.
function ask(vehicleId, { time, soc, from, pct, title }, now = Date.now()) {
  const s = load();
  const r = current(vehicleId, now);
  if (r && Math.abs(r.time - time) <= SAME_TRIP_MS) {
    if (r.state === 'no') return null;
    if (r.state === 'asked' && soc <= r.soc + 2) return null;
    if (r.state === 'yes' && soc <= r.soc) return null;
  }
  const rec = { time, soc, from, pct, title: title || null, state: 'asked', token: crypto.randomBytes(4).toString('hex'), at: now };
  s[vehicleId] = rec;
  save();
  ha.log(`Trip top-up: asking to charge to ${soc}% (instead of ${from}%) for ${title || 'the next trip'}`);
  return rec;
}

// The answer, by its token (from the phone or from Home). Returns the record or null.
function answer(token, yes, now = Date.now()) {
  const s = load();
  const id = Object.keys(s).find((k) => s[k] && s[k].token === token);
  if (!id || !current(id, now) || s[id].state !== 'asked') return null;
  s[id] = { ...s[id], state: yes ? 'yes' : 'no', answered_at: now };
  save();
  ha.log(`Trip top-up: ${yes ? `yes, charging to ${s[id].soc}%` : `no, the target stays ${s[id].from}%`} for ${s[id].title || 'the next trip'}`);
  return s[id];
}

// A button on the phone: "SCP_TOPUP_YES_<token>" or "SCP_TOPUP_NO_<token>".
function fromAction(action) {
  const m = ACTION.exec(String(action || ''));
  return m ? { yes: m[1] === 'YES', token: m[2] } : null;
}
function actions(rec) {
  return [
    { action: `SCP_TOPUP_YES_${rec.token}`, title: `Yes, charge to ${rec.soc}%` },
    { action: `SCP_TOPUP_NO_${rec.token}`, title: `No, keep ${rec.from}%` },
  ];
}

function reset() {
  state = {};
}

module.exports = { current, apply, ask, answer, fromAction, actions, reset };

'use strict';

// Preconditioning before a departure (#44): the app asks the car to heat or
// cool a set number of minutes before it leaves. Off by default, per car.
//
// Which drives (the calendar decides first):
//  - a calendar trip with "precondition: yes": on, before it leaves;
//  - a calendar trip without it (or with "precondition: no"): off;
//    this also covers the next drive of a trip (work, then sport) and a
//    trip home in the calendar ("To home" / "Naar huis");
//  - no next event after a trip (the car comes home at the end of the event):
//    the setting "Preconditioning on the way back" decides, before the
//    event ends.
// The car does not need to be plugged in. When it is, the charger stays on
// (controller.js), so the energy comes from the grid.
//
// What is turned on: one entity of the car that the user chose, a switch
// (turned on) or a button (pressed). Never a helper, script or automation.
// Write-ahead: the request is saved before the command is sent, so after a
// restart the app knows what it asked. One attempt per drive, one retry.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'precondition.json');
const KEEP_MS = 2 * 86400000;
const RELEASE_AFTER_MS = 15 * 60000; // turn a switch off again 15 min after the departure (car still at home)
const CHAIN_MS = 36 * 3600000; // a trip home in the calendar counts within 36 hours (as in Looking ahead)
const DOMAINS = /^(switch|button)\./;

const DEFAULTS = { enabled: false, entity_id: null, minutes: 15, way_back: false };

function config(vehicle) {
  const c = { ...DEFAULTS, ...((vehicle && vehicle.precondition) || {}) };
  c.minutes = Number.isFinite(Number(c.minutes)) ? Number(c.minutes) : DEFAULTS.minutes;
  return c;
}

// Check settings sent by the page.
function clean(body) {
  const b = body || {};
  const bad = (m) => { const err = new Error(m); err.status = 400; throw err; };
  const minutes = b.minutes === undefined || b.minutes === '' || b.minutes == null ? DEFAULTS.minutes : Number(b.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 60) bad('Minutes before departure: between 5 and 60');
  const entity = b.entity_id ? String(b.entity_id) : null;
  if (entity && (!DOMAINS.test(entity) || !/^[a-z_]+\.[a-z0-9_]+$/.test(entity))) bad('Choose a switch or a button of the car');
  if (b.enabled === true && !entity) bad('Choose what the app turns on, or turn preconditioning off');
  return { enabled: b.enabled === true, entity_id: entity, minutes: Math.round(minutes), way_back: b.way_back === true };
}

// ---------------------------------------------------------------------------
// When: the moments to ask for preconditioning.
//
// trips: the car's calendar trips (departures.calendarTrips), sorted, also the
// one going on now. isReturn(trip): a trip home. Returns
// [{ key, at, until, kind, title }], kind: 'out' (from home), 'next' (on to
// the next place), 'back' (a trip home in the calendar), 'back_auto' (no
// event for the drive home: the setting decided).
function schedule({ trips, cfg, isReturn }) {
  if (!cfg || !cfg.enabled) return [];
  const minutes = cfg.minutes * 60000;
  const list = [...(trips || [])].sort((a, b) => a.time - b.time);
  const startOf = (t) => t.event_start || t.time;
  const endOf = (t) => t.event_end || startOf(t) + 3600000;
  const out = [];
  list.forEach((t, i) => {
    const prev = i > 0 ? list[i - 1] : null;
    const home = isReturn(t);
    const chained = prev && !isReturn(prev) && startOf(t) <= endOf(prev);
    const kind = home ? 'back' : chained ? 'next' : 'out';
    if (t.precondition === true) {
      out.push({ key: `ev|${startOf(t)}|${t.title || ''}`, at: t.time - minutes, until: t.time, kind, title: t.title || null });
    }
    if (home) return;
    // The drive after this event: a next event decides; none: the setting.
    const nx = list[i + 1];
    const hasNext = nx && startOf(nx) < startOf(t) + CHAIN_MS && (isReturn(nx) || startOf(nx) <= endOf(t));
    if (!hasNext && cfg.way_back && t.event_end) {
      out.push({ key: `back|${startOf(t)}|${t.title || ''}`, at: t.event_end - minutes, until: t.event_end, kind: 'back_auto', title: t.title || null });
    }
  });
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// What was asked (survives a restart).

let cache;
function load() {
  if (!cache) cache = readJson(FILE, null) || {};
  cache.records = cache.records || {};
  cache.schedule = cache.schedule || {};
  return cache;
}
function save() {
  try { writeJsonAtomic(FILE, cache); } catch { /* best effort */ }
}
function prune(now) {
  const c = load();
  for (const [k, r] of Object.entries(c.records)) if (now - (r.until || r.at || 0) > KEEP_MS) delete c.records[k];
}

function setSchedule(vehicleId, moments) {
  load().schedule[vehicleId] = moments;
  save();
}
function upcoming(vehicleId, now = Date.now()) {
  const c = load();
  return (c.schedule[vehicleId] || []).filter((m) => m.until > now).map((m) => ({ ...m, ...(c.records[`${vehicleId}|${m.key}`] ? { state: c.records[`${vehicleId}|${m.key}`].state } : {}) }));
}

// Preconditioning the app asked for is running now (for this car, before a
// drive from home): the charger stays on.
function active(vehicleId, now = Date.now()) {
  return Object.values(load().records).some((r) => r.vehicle_id === vehicleId && r.state === 'asked' && r.kind === 'out' && r.at <= now && now < r.until + RELEASE_AFTER_MS);
}

function commandFor(entity, on) {
  const domain = entity.split('.')[0];
  if (domain === 'button') return on ? { service: 'button.press', target: { entity_id: entity } } : null;
  return { service: `switch.${on ? 'turn_on' : 'turn_off'}`, target: { entity_id: entity } };
}

// One step, every minute. send(command): sends it (throws when refused or
// failed); live: "Allow control" is on; plugged(vehicle): true / false / null.
// Returns what happened, for the log.
async function step({ vehicles, now = Date.now(), live, send, plugged, log = () => {} }) {
  const c = load();
  const done = [];
  for (const v of vehicles || []) {
    const cfg = config(v);
    if (!cfg.enabled || !cfg.entity_id) continue;
    for (const m of c.schedule[v.id] || []) {
      if (!(m.at <= now && now < m.until)) continue;
      const key = `${v.id}|${m.key}`;
      const r = c.records[key];
      if (r && (r.state === 'asked' || r.state === 'would' || (r.state === 'failed' && r.attempts >= 2))) continue;
      if (!live) {
        c.records[key] = { vehicle_id: v.id, kind: m.kind, entity_id: cfg.entity_id, at: now, until: m.until, state: 'would', attempts: 0 };
        save();
        log(`Preconditioning: would start ${cfg.entity_id} now for ${m.title || 'the departure'} ("Allow control" is off)`);
        done.push({ key, state: 'would' });
        continue;
      }
      const cmd = commandFor(cfg.entity_id, true);
      // Write-ahead: saved before the command is sent.
      c.records[key] = { vehicle_id: v.id, kind: m.kind, entity_id: cfg.entity_id, at: now, until: m.until, state: 'asking', attempts: ((r && r.attempts) || 0) + 1 };
      save();
      try {
        await send(cmd);
        c.records[key].state = 'asked';
        log(`Preconditioning: asked ${cfg.entity_id} for ${m.title || 'the departure'} at ${new Date(m.until).toISOString()}`);
      } catch (err) {
        c.records[key].state = 'failed';
        c.records[key].error = String(err.message || err).slice(0, 120);
        log(`Preconditioning: ${cfg.entity_id} failed (${c.records[key].error})`);
      }
      save();
      done.push({ key, state: c.records[key].state });
    }
  }
  // Turn a switch off again when the car did not leave: only what the app
  // turned on, only from home, only while the car is still plugged in.
  for (const [key, r] of Object.entries(c.records)) {
    if (r.state !== 'asked' || now < r.until + RELEASE_AFTER_MS) continue;
    const v = (vehicles || []).find((x) => x.id === r.vehicle_id);
    if (!/^switch\./.test(r.entity_id) || r.kind !== 'out' || !v || plugged(v) !== true || !live) {
      r.state = 'done';
      save();
      continue;
    }
    // Write-ahead: the release is saved as started first.
    r.state = 'releasing';
    save();
    try {
      await send(commandFor(r.entity_id, false));
      r.state = 'done';
      log(`Preconditioning: turned ${r.entity_id} off again (the car did not leave)`);
    } catch (err) {
      r.state = 'asked'; // tried again next minute
      log(`Preconditioning: could not turn ${r.entity_id} off (${String(err.message || err).slice(0, 120)})`);
    }
    save();
    done.push({ key, state: r.state });
  }
  prune(now);
  return done;
}

// After a restart: a release that was started but not confirmed is tried again.
function recover() {
  const c = load();
  for (const r of Object.values(c.records)) {
    if (r.state === 'releasing') r.state = 'asked';
    // Not known whether it reached the car: not sent again (a second button
    // press could switch it off again).
    if (r.state === 'asking') r.state = 'asked';
  }
  save();
}

// Tests only.
function reset() {
  cache = { records: {}, schedule: {} };
}

module.exports = { DEFAULTS, DOMAINS, config, clean, schedule, setSchedule, upcoming, active, step, recover, commandFor, reset, RELEASE_AFTER_MS };

'use strict';

// More than one car, one charger: which car is connected?
//
// 1. One car: always that car.
// 2. Your own choice on Home wins. It holds until the charger is unplugged
//    after the choice (so a choice made before plugging in counts for the
//    next car that is plugged in).
// 3. The car's own "plugged in" sensor: exactly one car says it is plugged in.
//    When no car says so, and exactly one car has no plug sensor, it is that
//    one. A car's charging sensor breaks a tie while the charger charges.
// 4. Not sure: the last car that was connected (or the first car), and Home
//    asks you to choose.
//
// The car's own plug sensor also says "plugged in" at a public charger, so
// with more than one car whether the home charger is in use comes from the
// charger status, not from the car.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'activecar.json');

let state; // { choice: { id, at } | null, last: { id, at } | null, plugged: bool | null }
let current = null; // the last pick: { vehicle, how, ... }

function load() {
  if (state === undefined) state = readJson(FILE, null) || { choice: null, last: null, plugged: null };
  return state;
}

function save() {
  try {
    writeJsonAtomic(FILE, state);
  } catch { /* best effort */ }
}

const ON = /^(on|true|yes|plugged|plugged_in|connected|charging|1)$/;
const OFF = /^(off|false|no|unplugged|not_plugged|disconnected|not_connected|0)$/;

// true / false / null (unknown) from a sensor state.
function readBool(states, id) {
  if (!id) return null;
  const st = states.find((x) => x.entity_id === id);
  if (!st) return null;
  const v = String(st.state).toLowerCase().replace(/\s+/g, '_');
  if (ON.test(v)) return true;
  if (OFF.test(v)) return false;
  return null;
}

// chargerPlugged: is a car connected to the charger (from the charger status),
// chargerCharging: is it charging. Both may be null (unknown).
function pick(vehicles, states, { chargerPlugged = null, chargerCharging = null, now = Date.now() } = {}) {
  const st = load();
  const list = vehicles || [];
  let dirty = false;

  // The charger was unplugged: a choice made before that is used up.
  if (chargerPlugged === false && st.plugged === true && st.choice && st.choice.at < now) {
    st.choice = null;
    dirty = true;
  }
  if (chargerPlugged != null && st.plugged !== chargerPlugged) {
    st.plugged = chargerPlugged;
    dirty = true;
  }

  const result = (vehicle, how, extra = {}) => {
    if (vehicle && chargerPlugged === true && (!st.last || st.last.id !== vehicle.id) && how !== 'guess') {
      st.last = { id: vehicle.id, at: now };
      dirty = true;
    }
    if (dirty) save();
    current = {
      vehicle,
      vehicle_id: vehicle ? vehicle.id : null,
      how,
      ask: false,
      candidates: [],
      ...extra,
    };
    return current;
  };

  if (!list.length) return result(null, 'none');
  if (list.length === 1) return result(list[0], 'only');

  const chosen = st.choice && list.find((v) => v.id === st.choice.id);
  const plugs = list.map((v) => ({ v, plug: readBool(states, v.plugged_entity), charging: readBool(states, v.charging_entity) }));
  const sure = plugs.filter((x) => x.plug === true);
  const noSensor = plugs.filter((x) => !x.v.plugged_entity || x.plug === null);
  const candidates = (sure.length ? sure : noSensor).map((x) => x.v.id);

  if (chosen) {
    // Your choice wins; say so when a plug sensor says another car.
    const other = sure.length === 1 && sure[0].v.id !== chosen.id ? sure[0].v : null;
    return result(chosen, 'chosen', { candidates, conflict: other ? other.id : null });
  }
  if (chargerPlugged !== true) {
    // Nothing connected: plan for the last connected car.
    const last = st.last && list.find((v) => v.id === st.last.id);
    return result(last || list[0], last ? 'last' : 'first', { candidates, connected: false });
  }
  if (sure.length === 1) return result(sure[0].v, 'sensor', { candidates });
  if (sure.length > 1 && chargerCharging === true) {
    const ch = sure.filter((x) => x.charging === true);
    if (ch.length === 1) return result(ch[0].v, 'charging_sensor', { candidates });
  }
  if (!sure.length && noSensor.length === 1) return result(noSensor[0].v, 'no_other', { candidates });
  const last = st.last && list.find((v) => v.id === st.last.id && (!candidates.length || candidates.includes(v.id)));
  return result(last || list.find((v) => candidates.includes(v.id)) || list[0], 'guess', { candidates, ask: true });
}

// Your choice on Home. id null: back to automatic.
function choose(id, now = Date.now()) {
  load();
  state.choice = id ? { id, at: now } : null;
  save();
}

function choice() {
  return load().choice;
}

// The last pick, or the first car before anything was picked.
function vehicleFrom(s) {
  const list = (s && s.vehicles) || [];
  if (current && current.vehicle_id) {
    const v = list.find((x) => x.id === current.vehicle_id);
    if (v) return v;
  }
  return list[0] || null;
}

function lastPick() {
  return current;
}

// Tests only.
function reset() {
  state = { choice: null, last: null, plugged: null };
  current = null;
}

module.exports = { pick, choose, choice, vehicleFrom, lastPick, readBool, reset };

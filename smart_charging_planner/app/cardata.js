'use strict';

// Car data health: is the car's battery level live, or is the car's cloud
// (Renault, MySkoda, Tesla …) down? A level that is "unavailable", or that
// Home Assistant has not read for longer than the chosen time, does not stop
// the plan: the app goes on from the last good level plus the energy the
// charger delivered since then. Works for every car integration.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'cardata.json');
const INVALID = new Set(['unknown', 'unavailable', '', 'none', 'null']);
const DEFAULT_STALE_HOURS = 3;

let last; // { entities: { [entity_id]: { soc, at } } } – one per car

function load() {
  if (last !== undefined) return last;
  const saved = readJson(FILE, null);
  if (saved && saved.entities) last = saved;
  else if (saved && saved.entity_id) last = { entities: { [saved.entity_id]: { soc: saved.soc, at: saved.at } } }; // one car, before more cars
  else last = { entities: {} };
  return last;
}

function save() {
  try {
    writeJsonAtomic(FILE, last);
  } catch { /* best effort */ }
}

// When Home Assistant last read the entity. last_reported (HA 2024.3+) also
// moves when the value stayed the same; older versions only have last_updated.
function readAt(st) {
  const t = Date.parse((st && (st.last_reported || st.last_updated || st.last_changed)) || '');
  return Number.isFinite(t) ? t : null;
}

// { ok, reason: null | 'unavailable' | 'stale' | 'missing', soc, at, age_ms }
function check(st, now, staleHours = DEFAULT_STALE_HOURS) {
  if (!st) return { ok: false, reason: 'missing', soc: null, at: null, age_ms: null };
  const at = readAt(st);
  const value = Number(st.state);
  if (INVALID.has(String(st.state).toLowerCase()) || !Number.isFinite(value)) {
    return { ok: false, reason: 'unavailable', soc: null, at, age_ms: at ? now - at : null };
  }
  const age = at ? now - at : 0;
  const limit = (Number(staleHours) > 0 ? Number(staleHours) : DEFAULT_STALE_HOURS) * 3600000;
  if (age > limit) return { ok: false, reason: 'stale', soc: value, at, age_ms: age };
  return { ok: true, reason: null, soc: value, at, age_ms: age };
}

function remember(entityId, soc, at, context = null) {
  const cur = load().entities[entityId];
  const session = context && context.session_id;
  if (cur && cur.soc === soc && cur.at === at && cur.session_id === session) return;
  last.entities[entityId] = { soc, at: at || Date.now(), ...(context || {}) };
  save();
}

// The last good level of this entity, or null.
function lastGood(entityId) {
  const cur = load().entities[entityId];
  return cur ? { entity_id: entityId, ...cur } : null;
}

// Only a reading taken during this car's observed charging session may be
// extended with that session's charger energy. Never carry it across a trip.
function usable(lastGood, session, { vehicleId, chargerId, plugged }) {
  return !!(lastGood && session && plugged === true && session.id
    && session.vehicle_id === vehicleId
    && lastGood.vehicle_id === vehicleId && lastGood.charger_id === chargerId
    && lastGood.session_id === session.id && lastGood.at >= session.since);
}

module.exports = { check, remember, lastGood, usable, DEFAULT_STALE_HOURS };

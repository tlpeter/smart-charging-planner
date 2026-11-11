'use strict';

// "Send the route to my phone before a trip" (#66), Settings › Rules.
// A set number of minutes before a calendar trip leaves, the app sends one
// notification with the trip's location. A tap opens Google Maps with the
// route; from there the user can send it to a car with Google built-in
// ("Send to car"). There is no public way to push a destination to the car
// itself, so the app only sends a message: nothing goes to the car or charger.
//
// Once per trip, also after a restart (what was sent is saved). When the app
// was off at that moment, nothing is sent afterwards.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'routenotify.json');
const KEEP_MS = 2 * 86400000;
const MAX_TRIES = 2; // one retry when the notification failed

// The Google Maps link for a place: opens the route from where the phone is.
function mapsUrl(location) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(location).trim())}&travelmode=driving`;
}

// One trip, one key: its start and its location (not the car, so a trip for
// every car gives one message).
function keyOf(t) {
  return `${t.event_start || t.time}|${String(t.location || '').trim().toLowerCase()}`;
}

// The moments from calendar trips: [{ key, at, until, title, location, url, car_id }].
// trips: departures.calendarTrips; isReturn(trip): a trip home (left out).
function schedule({ trips, minutes, isReturn }) {
  const ms = Math.max(1, Number(minutes) || 30) * 60000;
  const seen = new Set();
  const out = [];
  for (const t of trips || []) {
    const location = String(t.location || '').trim();
    if (!location || !Number.isFinite(t.time) || (isReturn && isReturn(t))) continue;
    const key = keyOf(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, at: t.time - ms, until: t.time, title: t.title || null, location, url: mapsUrl(location), car_id: t.car_id || null });
  }
  return out.sort((a, b) => a.at - b.at);
}

// --- What was sent (survives a restart) ------------------------------------

let cache;
let moments = [];
function load() {
  if (!cache) cache = readJson(FILE, null) || {};
  cache.sent = cache.sent || {};
  return cache;
}
function save() {
  try { writeJsonAtomic(FILE, cache); } catch { /* best effort */ }
}
function prune(now) {
  const c = load();
  for (const [k, r] of Object.entries(c.sent)) if (now - (r.until || r.at || 0) > KEEP_MS) delete c.sent[k];
}

function setSchedule(list) {
  moments = Array.isArray(list) ? list : [];
}
function upcoming(now = Date.now()) {
  const c = load();
  return moments.filter((m) => m.until > now).map((m) => ({ ...m, sent: !!(c.sent[m.key] && c.sent[m.key].done) }));
}

// Send what is due now. send(moment) → { sent, reason }. Returns the moments
// that were handled in this step.
async function step({ now = Date.now(), send }) {
  const c = load();
  prune(now);
  const done = [];
  for (const m of moments) {
    if (now < m.at || now >= m.until) continue;
    const r = c.sent[m.key] || { tries: 0 };
    if (r.done || r.tries >= MAX_TRIES) continue;
    // Saved before sending, so a restart in between does not send it twice.
    c.sent[m.key] = { ...r, tries: r.tries + 1, at: now, until: m.until };
    save();
    let res;
    try { res = await send(m); } catch (err) { res = { sent: false, error: err.message }; }
    // No recipient wants it: also done, nothing to try again.
    const finished = !!(res && (res.sent || res.reason === 'off' || res.reason === 'no_recipient' || res.reason === 'repeat'));
    c.sent[m.key] = { ...c.sent[m.key], done: finished, result: res && res.sent ? 'sent' : (res && (res.reason || res.error)) || 'failed' };
    save();
    done.push({ ...m, result: c.sent[m.key].result });
  }
  return done;
}

// For tests: forget the cache (a new start).
function reset() {
  cache = undefined;
  moments = [];
}

module.exports = { mapsUrl, keyOf, schedule, setSchedule, upcoming, step, reset, MAX_TRIES };

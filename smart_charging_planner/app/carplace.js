'use strict';

// Where is the car when it is not plugged in? (#46)
//
// The app asks, in this order, and the first clear answer wins:
//   1. the car's own location (a device_tracker of the car);
//   2. a person (for example the driver's phone with the Companion app);
//   3. a trip home in the calendar ("Naar huis", "Back home", …);
//   4. none of these: unknown.
// The app never assumes "at home" when it does not know. A sensor that is
// unknown or unavailable is skipped, so a broken sensor never makes the
// plan worse than having no sensor at all.

// States that say nothing about where the car is.
const UNCLEAR = new Set(['', 'unknown', 'unavailable', 'none', 'null']);

// 'home', 'away' or null (not clear) for one entity.
function read(states, entityId) {
  if (!entityId) return null;
  const st = (states || []).find((x) => x.entity_id === entityId);
  if (!st) return null;
  const v = String(st.state == null ? '' : st.state).trim().toLowerCase();
  if (UNCLEAR.has(v)) return null;
  return v === 'home' ? 'home' : 'away'; // not_home or the name of another zone
}

// plugged: true / false / null. homeTrip: { until, title } from the calendar,
// or null. Returns null when the app does not know whether the car is
// plugged in (then nothing changes), otherwise
// { at: 'home' | 'away' | 'unknown', source, until?, title? }.
function where({ plugged, vehicle, states, homeTrip = null }) {
  if (plugged === true) return { at: 'home', source: 'plugged' };
  if (plugged !== false) return null;
  const back = homeTrip ? { until: homeTrip.until, title: homeTrip.title || null } : {};
  for (const [key, source] of [['location_entity', 'car'], ['person_entity', 'person']]) {
    const at = read(states, vehicle && vehicle[key]);
    if (at === 'home') return { at, source };
    if (at === 'away') return { at, source, ...back };
  }
  if (homeTrip) return { at: 'away', source: 'calendar', ...back };
  return { at: 'unknown', source: null };
}

// Is the planned charging only "if plugged in in time"? Yes when the car is
// away without a known time back, or when the app does not know where it is.
function conditional(place) {
  return !!place && (place.at === 'unknown' || (place.at === 'away' && !place.until));
}

module.exports = { where, read, conditional };

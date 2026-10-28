'use strict';

// The charging stops on the Home Assistant map (#53).
//
// For the next trip with charging stops the app writes its own sensors with a
// position: sensor.smart_charging_stop_1, _2, … (the recommended station of
// each stop) and sensor.smart_charging_trip_destination. The Map in Home
// Assistant shows every entity with a position, so they appear there; a
// popup with a map card needs Browser Mod. When no trip needs a stop, or the
// option is off, the app removes them again.
//
// Only what changed is written. Home Assistant does not keep these sensors
// across its own restart: after a new connection everything is written again.

const ha = require('./ha');

const MAX = 40; // stops (the same limit as chargestops.MAX_STOPS)
let written = new Map(); // entity id → what was written (JSON)

// The next trip with charging stops in a plan: its timeline item.
function tripOf(plan) {
  const tl = (plan && plan.next && plan.next.timeline) || [];
  return tl.find((x) => x.type === 'back' && x.charge_stops && ['ok', 'partial'].includes(x.charge_stops.status) &&
    Array.isArray(x.charge_stops.legs) && x.charge_stops.legs.length) || null;
}

// The sensors for one trip: [{ entity_id, state, attributes }].
function sensorsFor(item) {
  if (!item) return [];
  const c = item.charge_stops;
  const out = [];
  for (const leg of c.legs.slice(0, MAX)) {
    const st = leg.stations && leg.stations[0];
    if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lon)) continue;
    out.push({
      entity_id: `sensor.smart_charging_stop_${leg.n}`,
      state: String(leg.n),
      attributes: {
        friendly_name: `Charging stop ${leg.n}: ${st.name || 'charging station'}`.slice(0, 100),
        icon: 'mdi:ev-station',
        latitude: st.lat,
        longitude: st.lon,
        operator: st.operator || null,
        power_kw: st.power_kw,
        points: st.points,
        arrive_pct: st.arrive_pct,
        charge_to_pct: leg.charge_to_pct,
        on_way_back: !!leg.on_way_back,
        km_on_trip: leg.km_on_trip,
        url: st.url,
      },
    });
  }
  if (out.length && c.dest && Number.isFinite(c.dest.lat) && Number.isFinite(c.dest.lon)) {
    out.push({
      entity_id: 'sensor.smart_charging_trip_destination',
      state: 'D',
      attributes: { friendly_name: 'Trip destination', icon: 'mdi:flag-checkered', latitude: c.dest.lat, longitude: c.dest.lon },
    });
  }
  return out;
}

// Make Home Assistant show what this plan needs: write new or changed
// sensors, remove the ones no longer needed. on: the option is on.
// existing: the map sensors Home Assistant has now (from its states), so
// ones left from before an app restart are removed too.
const MAP_SENSOR = /^sensor\.smart_charging_(stop_[0-9]{1,2}|trip_destination)$/;
async function sync(plan, on, existing = []) {
  for (const id of existing) if (MAP_SENSOR.test(id) && !written.has(id)) written.set(id, null);
  ha.setMapSensors(on);
  const want = on ? sensorsFor(tripOf(plan)) : [];
  const keep = new Set(want.map((x) => x.entity_id));
  for (const x of want) {
    const json = JSON.stringify([x.state, x.attributes]);
    if (written.get(x.entity_id) === json) continue;
    await ha.setState(x.entity_id, x.state, x.attributes);
    written.set(x.entity_id, json);
  }
  for (const id of [...written.keys()]) {
    if (keep.has(id)) continue;
    try {
      await ha.removeState(id);
    } catch (err) {
      // Not removed: at least off the map (no position).
      ha.debug('Removing', id, 'failed:', err.message);
      ha.setMapSensors(true);
      try { await ha.setState(id, 'unavailable', { friendly_name: 'Charging stop (not used)' }); } finally { ha.setMapSensors(on); }
    }
    written.delete(id);
  }
  return want.map((x) => x.entity_id);
}

// After a new connection to Home Assistant (for example after its restart):
// write everything again at the next sync.
function forget() {
  written = new Map();
}

module.exports = { tripOf, sensorsFor, sync, forget };

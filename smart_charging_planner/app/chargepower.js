'use strict';

// Charging power as it really is: learned from the charger power sensor.
//
// The theoretical power (phases x 230 V x maximum current) is often too high:
// a load balancer, the car's own on-board charger or the voltage can limit it.
// This looks at the 5-minute statistics of the last days and takes the power
// the car typically charges at when it charges at full speed.

const ha = require('./ha');

const DAYS = 10; // Home Assistant keeps 5-minute statistics for 10 days by default
const MIN_W = 1000; // slots below this are not charging
const MIN_SLOTS = 6; // at least 30 minutes of charging needed
const CACHE_MS = 3600000;

let cache = null; // { entity, at, result }

// Pure: typical full-speed power in W from a list of 5-minute means.
function typicalPower(means) {
  const charging = means.filter((w) => Number.isFinite(w) && w >= MIN_W).sort((a, b) => b - a);
  if (charging.length < MIN_SLOTS) return null;
  // Ramp-up, taper near full and partly used slots are lower; take the value
  // that 20% of the charging slots reach or exceed.
  return charging[Math.floor(charging.length * 0.2)];
}

async function learnedPower(powerEntity, now = Date.now()) {
  if (!powerEntity) return { available: false, reason: 'no_power_sensor' };
  if (cache && cache.entity === powerEntity && now - cache.at < CACHE_MS) return cache.result;
  let result;
  try {
    const from = now - DAYS * 86400000;
    const data = await ha.call({
      type: 'recorder/statistics_during_period',
      start_time: new Date(from).toISOString(),
      end_time: new Date(now).toISOString(),
      statistic_ids: [powerEntity],
      period: '5minute',
      types: ['mean'],
      units: { power: 'W' },
    });
    const rows = (data && data[powerEntity]) || [];
    const means = rows.map((r) => r.mean);
    const w = typicalPower(means);
    const slots = means.filter((x) => Number.isFinite(x) && x >= MIN_W).length;
    result = w
      ? { available: true, kw: Math.round(w / 100) / 10, minutes: slots * 5, days: DAYS }
      : { available: false, reason: rows.length ? 'not_enough_charging' : 'no_statistics', minutes: slots * 5, days: DAYS };
  } catch (err) {
    result = { available: false, reason: 'error', error: err.message };
  }
  cache = { entity: powerEntity, at: now, result };
  return result;
}

module.exports = { learnedPower, typicalPower };

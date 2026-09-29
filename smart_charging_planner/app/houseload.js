'use strict';

// House load: how much the home typically draws from the grid per hour of the
// day, WITHOUT the car charging. Used to estimate how much current is left for
// the charger under the main fuse (what a load balancer like the Easee
// Equalizer does in real time).
//
// Source: Home Assistant long-term statistics (hourly means) of the grid meter,
// minus the charger's own power. Only sensors with long-term statistics work
// (state_class "measurement"); P1 power sensors normally have that.

const ha = require('./ha');
const { tzParts } = require('./prices');

const DAYS_BACK = 14;
const PERCENTILE = 0.8; // a busy-ish hour, not the average
const VOLTAGE = 230;
const MIN_CURRENT = 6; // most EVs cannot charge below 6 A
const CACHE_MS = 60 * 60 * 1000;

let cache = null; // { key, at, result }

function percentile(values, p) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
}

async function stats(ids, start, end) {
  if (!ids.length) return {};
  return ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    statistic_ids: ids,
    period: 'hour',
    types: ['mean'],
    units: { power: 'W' },
  });
}

// Profile: 24 values (W) per local hour, or null when there is not enough data.
async function houseLoadProfile(grid, charger, tz, now = Date.now()) {
  if (!grid) return { available: false, reason: 'no_grid' };
  const gridIds = grid.net_entity ? [grid.net_entity] : [grid.import_entity, grid.export_entity].filter(Boolean);
  const chargerId = charger && charger.power_entity ? charger.power_entity : null;
  const key = JSON.stringify([gridIds, chargerId, tz]);
  if (cache && cache.key === key && now - cache.at < CACHE_MS) return cache.result;

  const end = now;
  const start = now - DAYS_BACK * 86400000;
  let data;
  try {
    data = await stats([...gridIds, chargerId].filter(Boolean), start, end);
  } catch (err) {
    ha.warn('Could not read statistics:', err.message);
    return { available: false, reason: 'statistics_error', error: err.message };
  }

  const byHour = (id) => new Map(((data && data[id]) || []).map((r) => [r.start, r.mean]));
  let net;
  if (grid.net_entity) {
    net = byHour(grid.net_entity);
  } else {
    const imp = byHour(grid.import_entity);
    const exp = grid.export_entity ? byHour(grid.export_entity) : new Map();
    net = new Map([...imp.entries()].map(([t, v]) => [t, v - (exp.get(t) || 0)]));
  }
  const chargerW = chargerId ? byHour(chargerId) : new Map();

  const perHour = Array.from({ length: 24 }, () => []);
  for (const [t, v] of net.entries()) {
    if (!Number.isFinite(v)) continue;
    const house = Math.max(0, v - Math.max(0, chargerW.get(t) || 0));
    perHour[tzParts(t, tz).h].push(house);
  }
  const samples = perHour.reduce((s, l) => s + l.length, 0);
  if (samples < 24 * 3) {
    const result = { available: false, reason: 'not_enough_history', samples };
    cache = { key, at: now, result };
    return result;
  }
  const profile = perHour.map((l) => percentile(l, PERCENTILE) ?? 0);
  const result = {
    available: true,
    profile,
    samples,
    days: DAYS_BACK,
    charger_subtracted: !!chargerId,
  };
  cache = { key, at: now, result };
  ha.debug('House load profile (W):', profile.map((w) => Math.round(w)).join(' '));
  return result;
}

// Current (A) left for the charger in a block, and the resulting power (kW).
function availableForBlock(start, tz, { profile, mainFuse, phases, chargerMax }) {
  const houseW = profile[tzParts(start, tz).h] || 0;
  const houseA = houseW / (VOLTAGE * phases); // spread over the phases
  let amps = Math.min(chargerMax, mainFuse - houseA);
  if (amps < MIN_CURRENT) amps = 0;
  return { amps, power_kw: (phases * VOLTAGE * amps) / 1000, house_w: houseW };
}

module.exports = { houseLoadProfile, availableForBlock, MIN_CURRENT };

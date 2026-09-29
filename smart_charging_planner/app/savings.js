'use strict';

// Savings: per charging session, what was actually paid, what charging right
// away after plugging in would have cost, and what the plan would have cost.
//
// Charging energy: hourly statistics of the charger power sensor.
// Plugged in / out: history of the vehicle's plugged-in sensor (optional).
// Prices: the app's own price history (plus look-back for action sources).
// Everything is per hour, so the numbers are estimates.

const ha = require('./ha');
const history = require('./pricehistory');
const { tzParts, localDateTime, backfill, totalPrice } = require('./prices');

const HOUR = 3600000;
const MIN_W = 300; // below this an hour does not count as charging
const MERGE_GAP_H = 4; // pauses shorter than this stay within one session

async function chargerHours(entityId, from, to) {
  const data = await ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    statistic_ids: [entityId],
    period: 'hour',
    types: ['mean'],
    units: { power: 'W' },
  });
  return ((data && data[entityId]) || [])
    .filter((r) => Number.isFinite(r.mean))
    .map((r) => ({ start: r.start, kwh: Math.max(0, r.mean) / 1000, w: Math.max(0, r.mean) }));
}

// Plugged-in periods [{from, to}] from the state history of a binary sensor.
async function pluggedPeriods(entityId, from, to) {
  const data = await ha.call({
    type: 'history/history_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  const rows = (data && data[entityId]) || [];
  const out = [];
  let open = null;
  for (const r of rows) {
    const state = r.s ?? r.state;
    const t = r.lc ? r.lc * 1000 : r.lu ? r.lu * 1000 : Date.parse(r.last_changed || r.last_updated);
    const on = state === 'on';
    if (on && open == null) open = Math.max(t, from);
    if (!on && open != null) {
      out.push({ from: open, to: t });
      open = null;
    }
  }
  if (open != null) out.push({ from: open, to, still_plugged: true });
  return out;
}

function groupSessions(hours) {
  const active = hours.filter((h) => h.w >= MIN_W).sort((a, b) => a.start - b.start);
  const sessions = [];
  for (const h of active) {
    const last = sessions[sessions.length - 1];
    if (last && h.start - last.end <= MERGE_GAP_H * HOUR) {
      last.hours.push(h);
      last.end = h.start + HOUR;
    } else {
      sessions.push({ start: h.start, end: h.start + HOUR, hours: [h] });
    }
  }
  return sessions;
}

// All-in price per hour start (average of 15-minute prices within the hour).
function hourlyPrices(sourceId, from, to, cfg) {
  const byHour = new Map();
  for (const p of history.range(sourceId, from, to)) {
    const h = Math.floor(p.start / HOUR) * HOUR;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(totalPrice(p.price, cfg));
  }
  const out = new Map();
  for (const [h, list] of byHour) out.set(h, list.reduce((a, b) => a + b, 0) / list.length);
  return out;
}

// Energy placed in the given hours in order, at most `power` kWh per hour.
function fill(hoursList, energy, power, price) {
  let left = energy;
  let cost = 0;
  for (const h of hoursList) {
    if (left <= 1e-9) break;
    const kwh = Math.min(left, power);
    cost += kwh * price.get(h);
    left -= kwh;
  }
  return left > 0.05 ? null : cost; // null: did not fit in the window
}

function dayRanges(from, to, tz) {
  const out = [];
  const p = tzParts(from, tz);
  for (let i = 0; ; i++) {
    const start = localDateTime(tz, p.y, p.m, p.d + i);
    if (start >= to) break;
    out.push([start, localDateTime(tz, p.y, p.m, p.d + i + 1)]);
  }
  return out;
}

async function computeSavings({ charger, vehicle, priceCfg, tz, days = 30, now = Date.now() }) {
  if (!charger || !charger.power_entity) return { available: false, reason: 'no_charger_power' };
  if (!priceCfg) return { available: false, reason: 'no_prices' };

  const from = now - days * 86400000;
  const hours = await chargerHours(charger.power_entity, from, now);
  const sessions = groupSessions(hours);

  let plugged = null;
  let pluggedError = null;
  if (vehicle && vehicle.plugged_entity && vehicle.plugged_entity.startsWith('binary_sensor.')) {
    try {
      plugged = await pluggedPeriods(vehicle.plugged_entity, from, now);
    } catch (err) {
      pluggedError = err.message;
    }
  }

  // Look back for missing price days (only possible for integration actions).
  if (sessions.length) {
    await backfill(priceCfg.source, dayRanges(sessions[0].start - 86400000, now, tz), tz);
  }
  const price = hourlyPrices(priceCfg.source.id, from - 86400000, now + 86400000, priceCfg);

  const results = sessions.map((s) => {
    const energy = s.hours.reduce((a, h) => a + h.kwh, 0);
    const power = Math.max(...s.hours.map((h) => h.kwh)); // kWh in the busiest hour
    // Window: the plugged-in period around the charging, else the charging itself.
    // Only whole hours count, unless charging already happened in that hour.
    const plug = plugged && plugged.find((p) => p.from <= s.start + HOUR && p.to >= s.start);
    const winFrom = plug ? Math.min(Math.ceil(plug.from / HOUR) * HOUR, s.start) : s.start;
    const winTo = plug ? Math.max(Math.floor(plug.to / HOUR) * HOUR, s.end) : s.end;
    const windowHours = [];
    for (let h = winFrom; h < winTo; h += HOUR) windowHours.push(h);

    const missing = s.hours.some((h) => !price.has(h.start)) || windowHours.some((h) => !price.has(h));
    const base = {
      start: s.start,
      end: s.end,
      plugged_from: plug ? plug.from : null,
      plugged_to: plug ? (plug.still_plugged ? null : plug.to) : null,
      window: plug ? 'plugged' : 'charging',
      energy_kwh: energy,
    };
    if (missing) return { ...base, complete: false };

    const actual = s.hours.reduce((a, h) => a + h.kwh * price.get(h.start), 0);
    const direct = fill(windowHours, energy, power, price);
    const cheapest = fill([...windowHours].sort((a, b) => price.get(a) - price.get(b)), energy, power, price);
    return {
      ...base,
      complete: true,
      actual_cost: actual,
      direct_cost: direct,
      plan_cost: cheapest,
      avg_price: actual / energy,
    };
  });

  const done = results.filter((r) => r.complete && r.direct_cost != null && r.plan_cost != null);
  const sum = (k) => done.reduce((a, r) => a + r[k], 0);
  return {
    available: true,
    days,
    plugged_source: plugged ? 'sensor' : null,
    plugged_error: pluggedError,
    sessions: results.reverse(),
    totals: {
      sessions: done.length,
      energy_kwh: sum('energy_kwh'),
      actual_cost: sum('actual_cost'),
      direct_cost: sum('direct_cost'),
      plan_cost: sum('plan_cost'),
    },
    incomplete: results.filter((r) => !r.complete).length,
  };
}

module.exports = { computeSavings, groupSessions, fill };

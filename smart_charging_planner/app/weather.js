'use strict';

// The outside temperature for a trip (#56), from a weather entity in Home
// Assistant (for example the Met.no "weather.forecast_home"). Only read:
// the entity's own temperature now, and its forecast with the read-only
// action weather.get_forecasts (hourly, and daily for further ahead).
// Forecasts are kept for 30 minutes, so a plan never waits for them twice.

const ha = require('./ha');

const KEEP_MS = 30 * 60000;
const RETRY_MS = 5 * 60000;
const cache = new Map(); // entity -> { at, hourly: [{ time, temp }], daily: [{ date, temp }], error }

// °F → °C when the entity says so.
function celsius(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return /F/i.test(String(unit || '')) ? (n - 32) * 5 / 9 : n;
}

function list(response, entity) {
  const r = response && response[entity];
  return (r && Array.isArray(r.forecast)) ? r.forecast : [];
}

// Fetch the forecasts again when they are older than 30 minutes.
// states: for the unit of the entity. Never throws.
async function refresh(entity, states = [], now = Date.now()) {
  if (!entity || !/^weather\./.test(entity)) return null;
  const old = cache.get(entity);
  if (old && now - old.at < (old.error ? RETRY_MS : KEEP_MS)) return old;
  const st = (states || []).find((x) => x.entity_id === entity);
  const unit = st && st.attributes ? st.attributes.temperature_unit : null;
  const next = { at: now, hourly: [], daily: [], error: null };
  for (const type of ['hourly', 'daily']) {
    try {
      const r = await ha.callAction('weather', 'get_forecasts', { type }, { entity_id: entity });
      const rows = list(r, entity).map((f) => {
        const time = Date.parse(f.datetime);
        // Daily: the middle of the day's high and low when both are known.
        const hi = celsius(f.temperature, unit);
        const lo = celsius(f.templow, unit);
        const temp = type === 'daily' && hi != null && lo != null ? (hi + lo) / 2 : hi;
        return { time, temp };
      }).filter((x) => Number.isFinite(x.time) && x.temp != null);
      if (type === 'hourly') next.hourly = rows;
      else next.daily = rows;
    } catch (err) {
      // Some weather entities have only one of the two forecasts.
      next.error = err.message;
    }
  }
  if (next.hourly.length || next.daily.length) next.error = null;
  else ha.debug('Weather forecast not available:', entity, next.error || 'empty');
  cache.set(entity, next);
  return next;
}

// The temperature (°C) at a moment: the hourly forecast within 90 minutes,
// else the daily forecast of that day (in the time zone), else the entity's
// temperature now when the moment is within 3 hours. null when not known.
function tempAt(entity, at, { states = [], tz = 'UTC', now = Date.now() } = {}) {
  if (!entity || !Number.isFinite(at)) return null;
  const c = cache.get(entity);
  if (c && c.hourly.length) {
    let best = null;
    for (const h of c.hourly) if (!best || Math.abs(h.time - at) < Math.abs(best.time - at)) best = h;
    if (best && Math.abs(best.time - at) <= 90 * 60000) return round(best.temp);
  }
  if (c && c.daily.length) {
    const day = dayOf(at, tz);
    const d = c.daily.find((x) => dayOf(x.time, tz) === day);
    if (d) return round(d.temp);
  }
  if (Math.abs(at - now) <= 3 * 3600000) return currentTemp(entity, states);
  return null;
}

// The entity's own temperature now (°C), or null.
function currentTemp(entity, states = []) {
  const st = (states || []).find((x) => x.entity_id === entity);
  if (!st || !st.attributes) return null;
  const t = celsius(st.attributes.temperature, st.attributes.temperature_unit);
  return t == null ? null : round(t);
}

function dayOf(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const round = (t) => Math.round(t * 10) / 10;

// Tests only.
function reset() {
  cache.clear();
}

module.exports = { refresh, tempAt, currentTemp, celsius, reset };

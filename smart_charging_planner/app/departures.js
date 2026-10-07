'use strict';

// Departure times: when must the car be ready, and how full?
//
// Four sources, each can be switched on or off:
//   1. One-off override (highest priority)
//   2. Calendar events with a keyword
//   3. Home Assistant helper (input_datetime + optional input_number)
//   4. Weekly schedule (lowest priority)
// Rules: the earliest day with any departure is used. On that day the source
// with the highest priority wins; within one source the earliest time counts.

const { tzParts, localDateTime, localDate, parseLocal } = require('./prices');

const PRIORITY = { override: 1, calendar: 2, helper: 3, schedule: 4 };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function defaultDepartures() {
  const schedule = {};
  for (const d of DAYS) schedule[d] = { enabled: true, time: '07:00', soc: 80 };
  return {
    default_soc: 80,
    schedule_enabled: true,
    schedule,
    helper: { enabled: false, datetime_entity: null, soc_entity: null },
    // match: 'target' = events with a target in the text (e.g. "doel: 80"),
    // 'keyword' = events containing the keyword, 'all' = every event with a time.
    calendar: { enabled: false, entity: null, match: 'target', keyword: 'EV', buffer_minutes: 0, soc: 80 },
    override: null, // { time: ms, soc }
  };
}

// Merge saved settings over the defaults, so new fields always exist.
// Older versions stored one "ready by" time and target; carry those over.
function normalise(saved, legacyPlanning) {
  const d = defaultDepartures();
  if (!saved && legacyPlanning) {
    for (const day of DAYS) {
      d.schedule[day] = { enabled: true, time: legacyPlanning.ready_by || '07:00', soc: legacyPlanning.target_soc || 80 };
    }
    d.default_soc = legacyPlanning.target_soc || 80;
    return d;
  }
  if (!saved) return d;
  const schedule = {};
  for (const day of DAYS) schedule[day] = { ...d.schedule[day], ...((saved.schedule || {})[day] || {}) };
  return {
    ...d,
    ...saved,
    schedule,
    helper: { ...d.helper, ...(saved.helper || {}) },
    // Calendars saved before "match" existed used the keyword.
    calendar: { ...d.calendar, ...(saved.calendar && !saved.calendar.match ? { match: 'keyword' } : {}), ...(saved.calendar || {}) },
  };
}

function weekdayKey(ms, tz) {
  const p = tzParts(ms, tz);
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  return DAYS[(js + 6) % 7];
}

function hhmm(str) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// --- Candidates per source -------------------------------------------------

function fromSchedule(dep, tz, now, days) {
  if (!dep.schedule_enabled) return [];
  const out = [];
  const p = tzParts(now, tz);
  for (let i = 0; i <= days; i++) {
    const midday = localDateTime(tz, p.y, p.m, p.d + i, 12, 0);
    const day = dep.schedule[weekdayKey(midday, tz)];
    const t = day && day.enabled && hhmm(day.time);
    if (!t) continue;
    const time = localDateTime(tz, p.y, p.m, p.d + i, t[0], t[1]);
    if (time > now) out.push({ time, soc: Number(day.soc) || dep.default_soc, source: 'schedule' });
  }
  return out;
}

function fromHelper(dep, states, tz, now) {
  const h = dep.helper;
  if (!h.enabled || !h.datetime_entity) return [];
  const s = states.find((x) => x.entity_id === h.datetime_entity);
  if (!s || ['unknown', 'unavailable', ''].includes(s.state)) return [];
  const a = s.attributes || {};
  let time;
  if (a.has_date === false || /^\d{1,2}:\d{2}/.test(s.state)) {
    // Time only: the next time the clock shows it.
    const t = hhmm(s.state);
    if (!t) return [];
    const p = tzParts(now, tz);
    time = localDateTime(tz, p.y, p.m, p.d, t[0], t[1]);
    if (time <= now) time = localDateTime(tz, p.y, p.m, p.d + 1, t[0], t[1]);
  } else {
    time = parseLocal(s.state, tz);
  }
  if (!Number.isFinite(time) || time <= now) return [];
  let soc = dep.default_soc;
  if (h.soc_entity) {
    const n = states.find((x) => x.entity_id === h.soc_entity);
    if (n && Number.isFinite(Number(n.state))) soc = Number(n.state);
  }
  return [{ time, soc, source: 'helper' }];
}

// Target battery level written in an event, e.g. "doel: 80", "target=90", "85%".
function parseTarget(text) {
  const t = String(text || '');
  const m = t.match(/\b(?:doel|target|soc|laaddoel|charge)\s*[:=]?\s*(\d{1,3})\s*%?/i) || t.match(/\b(\d{1,3})\s*%/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 10 && n <= 100 ? n : null;
}

// "precondition: ja" / "yes" / "on" -> true, "nee" / "no" / "off" -> false.
// Dutch: "voorverwarmen: ja", "voorconditioneren: ja".
function parsePrecondition(text) {
  const m = String(text || '').match(/(?:precondition(?:ing)?|voorverwarm(?:en)?|voorconditioner(?:en)?)\s*[:=]\s*(\w+)/i);
  if (!m) return null;
  if (/^(ja|yes|on|true|aan|1)$/i.test(m[1])) return true;
  if (/^(nee|no|off|false|uit|0)$/i.test(m[1])) return false;
  return null;
}

// Which car a trip is for: "auto: renault", "car: EV6" (also "vehicle:",
// "voertuig:"). The value ends at a new line, a comma or semicolon, or the
// next "word:" (e.g. "doel: 80 auto: renault precondition: ja").
function parseCar(text) {
  const m = String(text || '').match(/(?:^|[\s,;(])(?:auto|car|vehicle|voertuig)\s*[:=]\s*([^\n,;]+?)(?=\s+[\p{L}_]+\s*[:=]|[\n,;)]|$)/imu);
  const v = m ? m[1].trim() : '';
  return v ? v.slice(0, 40) : null;
}

const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

// The car a calendar tag means: its "name in the calendar", its name, or
// (when only one car has it) its brand integration, e.g. "renault", "kia".
// null: no car matches (or more than one does).
function matchCar(tag, cars) {
  const t = norm(tag);
  if (!t || !cars || !cars.length) return null;
  const first = norm(String(tag).trim().split(/\s+/)[0]);
  for (const key of [(v) => v.calendar_name, (v) => v.name]) {
    const hit = cars.filter((v) => key(v) && norm(key(v)) === t);
    if (hit.length === 1) return hit[0];
  }
  const brand = (v) => [norm(v.integration), norm(String(v.integration || '').split('_')[0])].filter(Boolean);
  for (const k of [t, first]) {
    const hit = cars.filter((v) => brand(v).includes(k));
    if (hit.length === 1) return hit[0];
  }
  for (const key of [(v) => v.calendar_name, (v) => v.name]) {
    const hit = cars.filter((v) => key(v) && norm(key(v)) === first);
    if (hit.length === 1) return hit[0];
  }
  return null;
}

// Calendar events that are trips, with their details.
// carCtx (more cars): { vehicle, list } – a trip for another car is left out;
// a trip without "auto:"/"car:" is for every car; an unknown car counts for
// every car and is marked.
function calendarTrips(dep, events, tz, now, carCtx = null) {
  const c = dep.calendar;
  if (!c.enabled || !events) return [];
  const keyword = String(c.keyword || '').trim().toLowerCase();
  const out = [];
  for (const e of events) {
    const start = String(e.start || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) continue; // all-day event: no time
    const text = `${e.summary || ''}\n${e.description || ''}`;
    const target = parseTarget(e.description) ?? parseTarget(e.summary);
    if (c.match === 'target' && target == null) continue;
    if (c.match === 'keyword' && keyword && !text.toLowerCase().includes(keyword)) continue;
    const ms = parseLocal(start, tz);
    if (!Number.isFinite(ms)) continue;
    const time = ms - (Number(c.buffer_minutes) || 0) * 60000;
    if (time <= now) continue;
    const tag = parseCar(text);
    let carId = null;
    let carUnknown = false;
    if (tag && carCtx && carCtx.list && carCtx.list.length > 1) {
      const car = matchCar(tag, carCtx.list);
      if (car && carCtx.vehicle && car.id !== carCtx.vehicle.id) continue;
      carId = car ? car.id : null;
      carUnknown = !car;
    }
    out.push({
      time,
      event_start: ms,
      soc: target ?? (Number(c.soc) || dep.default_soc),
      soc_from_event: target != null,
      source: 'calendar',
      title: e.summary || '',
      location: e.location || null,
      precondition: parsePrecondition(text),
      car: tag,
      car_id: carId,
      car_unknown: carUnknown,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

function fromCalendar(dep, events, tz, now, carCtx) {
  return calendarTrips(dep, events, tz, now, carCtx);
}

function fromOverride(dep, now) {
  const o = dep.override;
  if (!o || !(o.time > now)) return [];
  return [{ time: o.time, soc: Number(o.soc) || dep.default_soc, source: 'override' }];
}

// --- Choosing --------------------------------------------------------------

// Winner per local day, in date order.
function winnersPerDay(candidates, tz) {
  const byDay = new Map();
  for (const c of candidates) {
    const day = localDate(c.time, tz);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      list.sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] || a.time - b.time);
      const winner = list[0];
      // Replaced: departures from a lower priority source on that day.
      // Later: more trips from the same source that day (the plan prepares for the first).
      return {
        day,
        winner,
        others: list.slice(1).filter((x) => x.source !== winner.source),
        later: list.slice(1).filter((x) => x.source === winner.source).sort((a, b) => a.time - b.time),
      };
    });
}

function collect(dep, { states, events, tz, now, days = 7, cars = null }) {
  return [
    ...fromOverride(dep, now),
    ...fromCalendar(dep, events, tz, now, cars),
    ...fromHelper(dep, states, tz, now),
    ...fromSchedule(dep, tz, now, days),
  ];
}

function nextDeparture(dep, ctx) {
  const days = winnersPerDay(collect(dep, ctx), ctx.tz);
  return days.length ? days[0].winner : null;
}

module.exports = {
  DAYS, PRIORITY, defaultDepartures, normalise, collect, winnersPerDay, nextDeparture,
  calendarTrips, parseTarget, parsePrecondition, parseCar, matchCar,
};

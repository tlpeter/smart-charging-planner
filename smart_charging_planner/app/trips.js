'use strict';

// Building trip events for the calendar, in the same format as a typical
// dashboard: title "Naar <destination>", the destination as location, and
// "doel: 80 precondition: ja" as description. The app reads this format back
// (Departures -> Calendar -> "Events with a target in the description").

const { tzParts, localDateTime, parseLocal, isoLocal } = require('./prices');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_EVENTS = 60;
const DURATION_MIN = 15;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function weekdayKey(ms, tz) {
  const p = tzParts(ms, tz);
  return DAYS[(new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7];
}

// Home Assistant's calendar.create_event expects local "YYYY-MM-DD HH:MM:SS".
function haDateTime(ms, tz) {
  return isoLocal(ms, tz).slice(0, 19).replace('T', ' ');
}

// input: { datetime: "YYYY-MM-DDTHH:MM", destination, soc, precondition, weekdays: [], weeks }
function buildTripEvents(input, tz, now = Date.now()) {
  const first = parseLocal(input.datetime, tz);
  if (!Number.isFinite(first) || first <= now) throw badRequest('Choose a departure in the future');
  const destination = String(input.destination || '').trim();
  if (!destination) throw badRequest('Enter a destination');
  if (destination.length > 80) throw badRequest('Destination is too long (max. 80 characters)');
  const soc = Number(input.soc);
  if (!(soc >= 10 && soc <= 100)) throw badRequest('Target must be between 10 and 100 %');
  const weekdays = (input.weekdays || []).filter((d) => DAYS.includes(d));
  const weeks = weekdays.length ? Number(input.weeks) : 0;
  if (weekdays.length && !(weeks >= 1 && weeks <= 12)) throw badRequest('Weeks ahead must be between 1 and 12');

  const p = tzParts(first, tz);
  const starts = [];
  if (!weekdays.length) {
    starts.push(first);
  } else {
    // Every chosen weekday from the first departure, for the chosen weeks.
    for (let i = 0; i < weeks * 7; i++) {
      const t = localDateTime(tz, p.y, p.m, p.d + i, p.h, p.mi);
      if (t > now && weekdays.includes(weekdayKey(t, tz))) starts.push(t);
    }
  }
  if (!starts.length) throw badRequest('The chosen weekdays give no departures');
  if (starts.length > MAX_EVENTS) throw badRequest(`That would add ${starts.length} trips; the maximum is ${MAX_EVENTS}`);

  const car = String(input.car || '').replace(/[\n,;:]/g, ' ').trim().slice(0, 30);
  const description = `doel: ${soc} precondition: ${input.precondition ? 'ja' : 'nee'}${car ? ` auto: ${car}` : ''}`;
  return starts.map((start) => ({
    summary: `Naar ${destination}`,
    location: destination,
    description,
    start,
    end: start + DURATION_MIN * 60000,
  }));
}

// Mark events that already exist in the calendar (same title, same start).
function markDuplicates(planned, existing, tz) {
  const keys = new Set((existing || []).map((e) => {
    const t = parseLocal(e.start, tz);
    return `${String(e.summary || '').trim().toLowerCase()}|${Math.round(t / 60000)}`;
  }));
  return planned.map((e) => ({
    ...e,
    duplicate: keys.has(`${e.summary.toLowerCase()}|${Math.round(e.start / 60000)}`),
  }));
}

function toHaData(e, tz) {
  return {
    summary: e.summary,
    description: e.description,
    location: e.location,
    start_date_time: haDateTime(e.start, tz),
    end_date_time: haDateTime(e.end, tz),
  };
}

module.exports = { buildTripEvents, markDuplicates, toHaData, MAX_EVENTS };

'use strict';

// Building trip events for the calendar: a title "To <destination>", the
// destination as location, and "target: 80 precondition: no" as description.
// In Dutch: "Naar <destination>" and "doel: 80 precondition: nee".
// The app reads both languages back (Departures -> Calendar -> "Events with a
// target in the description"), so a calendar may mix them.

const { tzParts, localDateTime, parseLocal, isoLocal } = require('./prices');
const { parseCar } = require('./departures');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_EVENTS = 60;

// The words the app writes, per language (Plan › Calendar › Language for new trips).
const WORDS = {
  en: { to: 'To', target: 'target', precondition: 'precondition', yes: 'yes', no: 'no', car: 'car' },
  nl: { to: 'Naar', target: 'doel', precondition: 'precondition', yes: 'ja', no: 'nee', car: 'auto' },
};

// The language for new trips: the setting, or with "auto" the language of
// Home Assistant (Dutch when Home Assistant is in Dutch, otherwise English).
function tripLanguage(setting, haLanguage) {
  if (setting === 'en' || setting === 'nl') return setting;
  return /^nl\b/i.test(String(haLanguage || '')) ? 'nl' : 'en';
}
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

// input: { datetime: "YYYY-MM-DDTHH:MM", destination, back: "HH:MM" (optional), soc, precondition, weekdays: [], weeks }
function buildTripEvents(input, tz, now = Date.now(), lang = 'en') {
  const w = WORDS[lang] || WORDS.en;
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

  // Back home at (optional, HH:MM): the event lasts until then (the next day
  // when that time is earlier than leaving), so the app knows when the car is back.
  let backMin = null;
  const bm = String(input.back || '').match(/^(\d{1,2}):(\d{2})$/);
  if (String(input.back || '').trim() && !bm) throw badRequest('Back home: enter a time (HH:MM)');
  if (bm) {
    const h = Number(bm[1]);
    const mi = Number(bm[2]);
    if (h > 23 || mi > 59) throw badRequest('Back home: enter a time (HH:MM)');
    backMin = h * 60 + mi;
  }
  const endOf = (start) => {
    if (backMin == null) return start + DURATION_MIN * 60000;
    const q = tzParts(start, tz);
    const leaveMin = q.h * 60 + q.mi;
    return localDateTime(tz, q.y, q.m, q.d + (backMin <= leaveMin ? 1 : 0), Math.floor(backMin / 60), backMin % 60);
  };

  const car = String(input.car || '').replace(/[\n,;:]/g, ' ').trim().slice(0, 30);
  const description = `${w.target}: ${soc} ${w.precondition}: ${input.precondition ? w.yes : w.no}${car ? ` ${w.car}: ${car}` : ''}`;
  return starts.map((start) => ({
    summary: `${w.to} ${destination}`,
    location: destination,
    description,
    start,
    end: endOf(start),
  }));
}

// A writing-language change must not create the same trip a second time.
// Only normalize the app's To/Naar prefix when its destination agrees with
// the event location. Keep actual title/location changes and car tags apart.
function tripKey(e, tz) {
  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const time = parseLocal(e.start, tz);
  if (!Number.isFinite(time)) return null;
  const title = norm(e.summary);
  const location = norm(e.location);
  const trip = title.match(/^(?:to|naar)\s+(.+)$/);
  const appTitle = !!(trip && location && trip[1] === location);
  const destination = appTitle ? trip[1] : title;
  const car = norm(parseCar(`${e.summary || ''}\n${e.description || ''}`));
  return JSON.stringify([appTitle, destination, location, car, Math.round(time / 60000)]);
}

// Existing trips are skipped, not edited. A different target alone does not
// replace an existing event; edit it in the calendar.
function markDuplicates(planned, existing, tz) {
  const keys = new Set((existing || []).map((e) => tripKey(e, tz)).filter(Boolean));
  return planned.map((e) => ({
    ...e,
    duplicate: keys.has(tripKey(e, tz)),
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

module.exports = { buildTripEvents, markDuplicates, toHaData, tripLanguage, WORDS, MAX_EVENTS };

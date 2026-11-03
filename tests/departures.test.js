'use strict';

// Which departure counts on a day (#25): the source with the highest
// priority wins the day; an earlier departure of a lower source that it drops
// is marked so the app can warn; all-day events that look like a trip are
// listed as not used; two trips in one day; a trip just after midnight.
// Run: node tests/departures.test.js   (from the repository root)
// All times and titles are made up.

const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-departures-'));
const assert = require('assert/strict');
const d = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'departures'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

const TZ = 'Europe/Amsterdam';
// Monday 9 November 2026, 05:00 local (UTC+1).
const NOW = Date.parse('2026-11-09T05:00:00+01:00');
const local = (s) => Date.parse(`${s}+01:00`);
const ev = (summary, start, end, description = '') => ({ summary, start, end, description });

// Weekly schedule: Monday and Tuesday 07:00 at 80 %; the calendar reads
// events with a target.
function settings(extra = {}) {
  const dep = d.normalise({
    schedule_enabled: true,
    calendar: { enabled: true, entity: 'calendar.trips', match: 'target', buffer_minutes: 0, soc: 80 },
    ...extra,
  });
  for (const day of d.DAYS) dep.schedule[day] = { enabled: day === 'mon' || day === 'tue', time: '07:00', soc: 80, precondition: false };
  return dep;
}
const daysFor = (dep, events) => d.winnersPerDay(d.collect(dep, { states: [], events, tz: TZ, now: NOW, days: 3 }), TZ);

check('a calendar trip at 18:00 wins the day and drops the schedule at 07:00: marked, with the trip that won', () => {
  const dep = settings();
  const days = daysFor(dep, [ev('Party in Rivertown', '2026-11-09T18:00:00+01:00', '2026-11-09T23:00:00+01:00', 'target: 90')]);
  const mon = days.find((x) => x.day === '2026-11-09');
  assert.equal(mon.winner.source, 'calendar');
  assert.equal(mon.winner.time, local('2026-11-09T18:00:00'));
  assert.equal(mon.others.length, 1);
  assert.equal(mon.others[0].source, 'schedule');
  assert.equal(mon.others[0].dropped_earlier, true);
  const dropped = d.droppedEarlier(days);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].time, local('2026-11-09T07:00:00'));
  assert.equal(dropped[0].by.source, 'calendar');
  assert.equal(dropped[0].by.title, 'Party in Rivertown');
  // Tuesday has only the schedule: nothing dropped there.
  assert.equal(days.find((x) => x.day === '2026-11-10').winner.source, 'schedule');
});

check('a calendar trip earlier than the schedule replaces it, but nothing is dropped before it', () => {
  const days = daysFor(settings(), [ev('Early meeting', '2026-11-09T06:00:00+01:00', '2026-11-09T09:00:00+01:00', 'target: 85')]);
  const mon = days.find((x) => x.day === '2026-11-09');
  assert.equal(mon.winner.source, 'calendar');
  assert.equal(mon.others[0].source, 'schedule');
  assert.equal(mon.others[0].dropped_earlier, undefined);
  assert.deepEqual(d.droppedEarlier(days), []);
});

check('two trips in one day: the first counts, the second is "later that day", nothing dropped', () => {
  const dep = settings({ schedule_enabled: false });
  const days = daysFor(dep, [
    ev('Work', '2026-11-09T08:00:00+01:00', '2026-11-09T16:00:00+01:00', 'target: 80'),
    ev('Sport', '2026-11-09T19:00:00+01:00', '2026-11-09T21:00:00+01:00', 'target: 80'),
  ]);
  assert.equal(days[0].winner.title, 'Work');
  assert.deepEqual(days[0].later.map((x) => x.title), ['Sport']);
  assert.deepEqual(d.droppedEarlier(days), []);
});

check('a trip just after midnight counts for the next day and does not drop the evening before', () => {
  const days = daysFor(settings(), [ev('Night flight', '2026-11-10T00:30:00+01:00', '2026-11-10T04:00:00+01:00', 'target: 95')]);
  assert.equal(days.find((x) => x.day === '2026-11-09').winner.source, 'schedule');
  const tue = days.find((x) => x.day === '2026-11-10');
  assert.equal(tue.winner.title, 'Night flight');
  // The schedule at 07:00 on Tuesday is later than 00:30: replaced, not dropped before it.
  assert.deepEqual(d.droppedEarlier(days), []);
});

check('all-day events that look like a trip are listed as not used; other all-day events and past ones are not', () => {
  const dep = settings();
  const events = [
    ev('Holiday to Exempelstad', '2026-11-11', '2026-11-12', 'target: 100'),
    ev('Birthday', '2026-11-12', '2026-11-13', ''),
    ev('Yesterday all day', '2026-11-08', '2026-11-09', 'target: 90'),
    ev('Timed trip', '2026-11-11T09:00:00+01:00', '2026-11-11T12:00:00+01:00', 'target: 80'),
  ];
  assert.deepEqual(d.ignoredEvents(dep, events, TZ, NOW), [{ title: 'Holiday to Exempelstad', date: '2026-11-11', reason: 'all_day' }]);
  // Read by keyword: an all-day event with the keyword is listed too.
  const kw = settings({ calendar: { enabled: true, entity: 'calendar.trips', match: 'keyword', keyword: 'EV', buffer_minutes: 0, soc: 80 } });
  assert.deepEqual(d.ignoredEvents(kw, [ev('EV to the coast', '2026-11-11', '2026-11-12')], TZ, NOW).map((x) => x.title), ['EV to the coast']);
  // Calendar off: nothing.
  assert.deepEqual(d.ignoredEvents(settings({ calendar: { enabled: false } }), events, TZ, NOW), []);
});

console.log(failures ? `\n${failures} failed` : '\nAll departure checks passed');
process.exit(failures ? 1 : 0);

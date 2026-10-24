'use strict';

// More than one car on one charger: which car is connected?
// Run: node tests/activecar.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-activecar-'));
const assert = require('assert');
const activecar = require('../smart_charging_planner/app/activecar');
const settings = require('../smart_charging_planner/app/settings');

let failures = 0;
function check(name, fn) {
  activecar.reset();
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

const A = { id: 'car1', name: 'Megane', plugged_entity: 'binary_sensor.a_plug', charging_entity: 'binary_sensor.a_charging' };
const B = { id: 'car2', name: 'EV6', plugged_entity: 'binary_sensor.b_plug', charging_entity: 'binary_sensor.b_charging' };
const C = { id: 'car3', name: 'Old Leaf' }; // no plug sensor
const st = (o) => Object.entries(o).map(([entity_id, state]) => ({ entity_id, state }));

check('one car: always that car', () => {
  const r = activecar.pick([A], st({ 'binary_sensor.a_plug': 'off' }), { chargerPlugged: true });
  assert.strictEqual(r.vehicle.id, 'car1');
  assert.strictEqual(r.how, 'only');
});
check('exactly one plug sensor on: that car', () => {
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'off', 'binary_sensor.b_plug': 'on' }), { chargerPlugged: true });
  assert.strictEqual(r.vehicle.id, 'car2');
  assert.strictEqual(r.how, 'sensor');
  assert.strictEqual(r.ask, false);
});
check('text states are understood ("plugged", "disconnected")', () => {
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'Disconnected', 'binary_sensor.b_plug': 'plugged' }), { chargerPlugged: true });
  assert.strictEqual(r.vehicle.id, 'car2');
});
check('both plugged in, only one charging while the charger charges: that car', () => {
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'on', 'binary_sensor.b_plug': 'on', 'binary_sensor.a_charging': 'off', 'binary_sensor.b_charging': 'on' }), { chargerPlugged: true, chargerCharging: true });
  assert.strictEqual(r.vehicle.id, 'car2');
  assert.strictEqual(r.how, 'charging_sensor');
});
check('both plugged in, nothing else to go on: asks', () => {
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'on', 'binary_sensor.b_plug': 'on' }), { chargerPlugged: true });
  assert.strictEqual(r.how, 'guess');
  assert.strictEqual(r.ask, true);
  assert.deepStrictEqual(r.candidates.sort(), ['car1', 'car2']);
});
check('no plug sensor on, one car without a sensor: that car', () => {
  const r = activecar.pick([A, B, C], st({ 'binary_sensor.a_plug': 'off', 'binary_sensor.b_plug': 'off' }), { chargerPlugged: true });
  assert.strictEqual(r.vehicle.id, 'car3');
  assert.strictEqual(r.how, 'no_other');
});
check('plug sensor unavailable counts as no sensor', () => {
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'unavailable', 'binary_sensor.b_plug': 'off' }), { chargerPlugged: true });
  assert.strictEqual(r.vehicle.id, 'car1');
  assert.strictEqual(r.how, 'no_other');
});
check('your choice wins, and holds until the charger is unplugged', () => {
  const t0 = Date.now();
  const plugA = st({ 'binary_sensor.a_plug': 'on', 'binary_sensor.b_plug': 'off' });
  activecar.pick([A, B], plugA, { chargerPlugged: true, now: t0 });
  activecar.choose('car2', t0 + 1000);
  let r = activecar.pick([A, B], plugA, { chargerPlugged: true, now: t0 + 2000 });
  assert.strictEqual(r.vehicle.id, 'car2');
  assert.strictEqual(r.how, 'chosen');
  assert.strictEqual(r.conflict, 'car1');
  r = activecar.pick([A, B], st({}), { chargerPlugged: false, now: t0 + 3000 });
  assert.strictEqual(activecar.choice(), null);
  assert.strictEqual(r.how, 'last');
  assert.strictEqual(r.vehicle.id, 'car2');
});
check('a choice made while nothing is plugged in counts for the next plug-in', () => {
  const t0 = Date.now();
  activecar.pick([A, B], st({}), { chargerPlugged: false, now: t0 });
  activecar.choose('car2', t0 + 1000);
  activecar.pick([A, B], st({}), { chargerPlugged: false, now: t0 + 2000 });
  const r = activecar.pick([A, B], st({ 'binary_sensor.a_plug': 'on' }), { chargerPlugged: true, now: t0 + 3000 });
  assert.strictEqual(r.vehicle.id, 'car2');
  assert.strictEqual(r.how, 'chosen');
});
check('nothing connected: the last connected car, else the first', () => {
  let r = activecar.pick([A, B], st({}), { chargerPlugged: false });
  assert.strictEqual(r.how, 'first');
  assert.strictEqual(r.vehicle.id, 'car1');
  activecar.pick([A, B], st({ 'binary_sensor.b_plug': 'on' }), { chargerPlugged: true });
  r = activecar.pick([A, B], st({}), { chargerPlugged: false });
  assert.strictEqual(r.how, 'last');
  assert.strictEqual(r.vehicle.id, 'car2');
});
check('saved cars without an id get stable ids (car1, car2), existing ids are kept', () => {
  const list = [{ name: 'a' }, { id: 'car1', name: 'b' }, { name: 'c' }];
  assert.strictEqual(settings.vehicleIds(list), true);
  assert.deepStrictEqual(list.map((v) => v.id), ['car2', 'car1', 'car3']);
  assert.strictEqual(settings.vehicleIds(list), false);
});

const { parseCar, matchCar, parsePrecondition } = require('../smart_charging_planner/app/departures');
check('calendar: "auto:" and "car:" (and "vehicle:", "voertuig:") say which car, in any place of the text', () => {
  assert.strictEqual(parseCar('doel: 80 precondition: ja auto: renault'), 'renault');
  assert.strictEqual(parseCar('target: 70\ncar: EV6'), 'EV6');
  assert.strictEqual(parseCar('car: Model 3, target: 90'), 'Model 3');
  assert.strictEqual(parseCar('Naar Gent (auto: kia)'), 'kia');
  assert.strictEqual(parseCar('vehicle=Leaf'), 'Leaf');
  assert.strictEqual(parseCar('voertuig: Leaf'), 'Leaf');
  assert.strictEqual(parseCar('automatisch laden doel: 80'), null);
  assert.strictEqual(parseCar('doel: 80'), null);
});
check('calendar: the car is found by its calendar name, its name, or its brand when only one car has it', () => {
  const list = [{ id: 'a', name: 'JLZ03X', integration: 'renault' }, { id: 'b', name: 'EV6', integration: 'kia_uvo', calendar_name: 'Kia' }, { id: 'c', name: 'Zoe', integration: 'renault', calendar_name: 'zoe' }];
  assert.strictEqual(matchCar('kia', list).id, 'b');
  assert.strictEqual(matchCar('EV6', list).id, 'b');
  assert.strictEqual(matchCar('jlz03x', list).id, 'a');
  assert.strictEqual(matchCar('Zoë', list).id, 'c');
  assert.strictEqual(matchCar('renault', list), null); // two Renaults: not sure
  assert.strictEqual(matchCar('tesla', list), null);
});
check('calendar: precondition in Dutch and English', () => {
  assert.strictEqual(parsePrecondition('precondition: yes'), true);
  assert.strictEqual(parsePrecondition('voorverwarmen: ja'), true);
  assert.strictEqual(parsePrecondition('voorconditioneren: nee'), false);
});

check('calendar: trips the app writes are read back, in English and Dutch', () => {
  const { buildTripEvents, tripLanguage } = require('../smart_charging_planner/app/trips');
  const { parseTarget } = require('../smart_charging_planner/app/departures');
  const at = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  for (const lang of ['en', 'nl']) {
    const [e] = buildTripEvents({ datetime: at, destination: 'Gent', soc: 85, precondition: true, car: 'EV6' }, 'UTC', Date.now(), lang);
    assert.strictEqual(e.summary, lang === 'nl' ? 'Naar Gent' : 'To Gent');
    assert.strictEqual(parseTarget(e.description), 85);
    assert.strictEqual(parsePrecondition(e.description), true);
    assert.strictEqual(parseCar(e.description), 'EV6');
  }
  assert.strictEqual(tripLanguage('auto', 'nl'), 'nl');
  assert.strictEqual(tripLanguage('auto', 'nl-BE'), 'nl');
  assert.strictEqual(tripLanguage('auto', 'en-GB'), 'en');
  assert.strictEqual(tripLanguage('auto', undefined), 'en');
  assert.strictEqual(tripLanguage('en', 'nl'), 'en');
});

check('calendar: changing the writing language skips the same trip, including old Dutch events', () => {
  const { buildTripEvents, markDuplicates, tripLanguage } = require('../smart_charging_planner/app/trips');
  const now = Date.UTC(2026, 9, 24), tz = 'Europe/Amsterdam';
  const input = { datetime: '2026-10-26T08:00', destination: 'Work', soc: 80, car: 'EV6' };
  const event = (lang) => buildTripEvents(input, tz, now, lang)[0];
  for (const [before, after] of [['nl', 'en'], ['en', 'nl'],
    [tripLanguage('auto', 'nl'), tripLanguage('auto', 'en')],
    ['nl', tripLanguage('auto', 'en')]]) {
    const old = event(before), next = event(after);
    const existing = { ...old, start: new Date(old.start).toISOString() };
    assert.strictEqual(markDuplicates([next], [existing], tz)[0].duplicate, true);
  }
});
check('calendar: duplicate detection keeps different cars, destinations, titles and start times separate', () => {
  const { buildTripEvents, markDuplicates } = require('../smart_charging_planner/app/trips');
  const now = Date.UTC(2026, 9, 24), tz = 'Europe/Amsterdam';
  const input = { datetime: '2026-10-26T08:00', destination: 'Work', soc: 80, car: 'EV6' };
  const old = buildTripEvents(input, tz, now, 'nl')[0];
  const next = buildTripEvents(input, tz, now, 'en')[0];
  const distinct = [
    buildTripEvents({ ...input, car: 'Leaf' }, tz, now, 'en')[0],
    buildTripEvents({ ...input, car: '' }, tz, now, 'en')[0],
    buildTripEvents({ ...input, destination: 'Gym' }, tz, now, 'en')[0],
    { ...next, location: 'Another address' },
    { ...next, summary: 'To Work via Gym' },
    { ...next, summary: 'Work' },
    { ...next, start: next.start + 60000 },
  ];
  assert(markDuplicates(distinct, [old], tz).every((e) => !e.duplicate));
  assert.strictEqual(markDuplicates([next], [{ ...old, summary: '  NAAR   Work  ', location: ' WORK ', description: 'doel: 80 auto: ev6' }], tz)[0].duplicate, true);
  // Keep the old same-trip rule: changing a target does not edit or add an event.
  const differentGoal = buildTripEvents({ ...input, soc: 90 }, tz, now, 'en')[0];
  assert.strictEqual(markDuplicates([differentGoal], [old], tz)[0].duplicate, true);
});
check('calendar: the two repeated DST hours are different trips', () => {
  const { markDuplicates } = require('../smart_charging_planner/app/trips');
  const old = { summary: 'Naar Work', location: 'Work', description: 'doel: 80 auto: EV6', start: '2026-10-25T02:00:00+02:00' };
  const later = { ...old, summary: 'To Work', description: 'target: 80 car: EV6', start: Date.parse('2026-10-25T02:00:00+01:00') };
  assert.strictEqual(markDuplicates([later], [old], 'Europe/Amsterdam')[0].duplicate, false);
  assert.strictEqual(markDuplicates([later], [{ ...old, start: '2026-10-25T02:00:00+01:00' }], 'Europe/Amsterdam')[0].duplicate, true);
  assert.strictEqual(markDuplicates([later], [{ ...old, start: 'invalid' }], 'Europe/Amsterdam')[0].duplicate, false);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

'use strict';

// Where is the car when it is not plugged in (#46)? The car's location, then
// a person, then a trip home in the calendar; none of them: not known.

const assert = require('assert');
const { where, conditional } = require('../smart_charging_planner/app/carplace');
const { chargeState } = require('../smart_charging_planner/app/chargestate');

function check(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (err) {
    console.error('not ok -', name);
    throw err;
  }
}

const car = { location_entity: 'device_tracker.car', person_entity: 'person.alex' };
const states = (c, p) => [
  ...(c === undefined ? [] : [{ entity_id: 'device_tracker.car', state: c }]),
  ...(p === undefined ? [] : [{ entity_id: 'person.alex', state: p }]),
];
const trip = { until: 1000, title: 'Naar huis' };

check('plugged in is always at home; plug state not known changes nothing', () => {
  assert.deepEqual(where({ plugged: true, vehicle: car, states: states('not_home', 'not_home') }), { at: 'home', source: 'plugged' });
  assert.equal(where({ plugged: null, vehicle: car, states: states('not_home') }), null);
});

check('the car location comes first', () => {
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('not_home', 'home') }), { at: 'away', source: 'car' });
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('home', 'not_home'), homeTrip: trip }), { at: 'home', source: 'car' });
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('Work', 'home') }), { at: 'away', source: 'car' }, 'a zone name is away');
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('HOME') }), { at: 'home', source: 'car' });
});

check('an unclear car location is skipped: then the person', () => {
  for (const bad of ['unknown', 'unavailable', '', 'none']) {
    assert.deepEqual(where({ plugged: false, vehicle: car, states: states(bad, 'not_home') }), { at: 'away', source: 'person' }, bad);
  }
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states(undefined, 'home') }), { at: 'home', source: 'person' }, 'missing entity');
});

check('then the calendar; away by car or person takes the time back from the calendar', () => {
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('unknown', 'unavailable'), homeTrip: trip }), { at: 'away', source: 'calendar', until: 1000, title: 'Naar huis' });
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('not_home'), homeTrip: trip }), { at: 'away', source: 'car', until: 1000, title: 'Naar huis' });
  assert.deepEqual(where({ plugged: false, vehicle: {}, states: [], homeTrip: trip }), { at: 'away', source: 'calendar', until: 1000, title: 'Naar huis' });
});

check('nothing known: unknown, never "at home"', () => {
  assert.deepEqual(where({ plugged: false, vehicle: {}, states: [] }), { at: 'unknown', source: null });
  assert.deepEqual(where({ plugged: false, vehicle: car, states: states('unavailable', 'unknown') }), { at: 'unknown', source: null });
  assert.deepEqual(where({ plugged: false, vehicle: null, states: null }), { at: 'unknown', source: null });
});

check('charging is "if plugged in" when not known, or away without a time back', () => {
  assert.equal(conditional({ at: 'unknown' }), true);
  assert.equal(conditional({ at: 'away', source: 'car' }), true);
  assert.equal(conditional({ at: 'away', source: 'car', until: 1000 }), false);
  assert.equal(conditional({ at: 'home', source: 'car' }), false);
  assert.equal(conditional(null), false);
});

check('Home says where the car is', () => {
  const fmt = { hm: () => '17:00', dayHm: () => 'Mon 17:00' };
  const d = (place) => ({ control_allowed: true, vehicle: { soc: 64 }, departure: { time: 1 }, plan: { blocks: [], notes: [], place }, reliability: {} });
  const n = { plugged: false, at: 0 };
  const away = chargeState(d({ at: 'away', source: 'car', conditional: true }), n, fmt);
  assert.equal(away.title, 'Car away');
  assert.match(away.detail, /Away \(car location\) · not known when it is back\. Plug in to be ready by Mon 17:00\./);
  assert.match(chargeState(d({ at: 'away', source: 'calendar', until: 2 }), n, fmt).detail, /Away \(calendar\) · back around Mon 17:00/);
  assert.match(chargeState(d({ at: 'unknown', source: null, conditional: true }), n, fmt).detail, /location is not known, so Looking ahead counts from the level now/);
  assert.match(chargeState(d({ at: 'home', source: 'person' }), n, fmt).detail, /^At home \(person\)\. Plug in/);
  assert.equal(chargeState(d(undefined), n, fmt).detail, 'Plug in to be ready by Mon 17:00.');
});

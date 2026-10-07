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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

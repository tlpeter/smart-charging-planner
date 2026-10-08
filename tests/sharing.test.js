'use strict';

// More chargers, one connection: who may charge, and with how much current?
// Run: node tests/sharing.test.js   (from the repository root)

const assert = require('assert');
const { share, available } = require('../smart_charging_planner/app/sharing');

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

const H = 3600000;
const car = (id, o = {}) => ({ id, name: id, want: 'charge', amps: 16, can_set_current: true, solar: false, priority: {}, order: 0, ...o });

check('the car with the earliest latest safe start goes first, not the one that leaves first', () => {
  // A leaves at 07:00 but needs little (safe start 05:45); B leaves 08:30 but needs a lot (03:40).
  const r = share([car('A', { priority: { latest_safe_start: 5.75 * H, departure: 7 * H } }), car('B', { priority: { latest_safe_start: 3.67 * H, departure: 8.5 * H } })], 22);
  assert.deepStrictEqual(r.order, ['B', 'A']);
  assert.strictEqual(r.result.B, undefined); // full current
  assert.strictEqual(r.result.A.amps, 6);
});
check('Charge now goes before everything; a car below its minimum before a planned car', () => {
  const r = share([car('plan', { priority: { latest_safe_start: 1 } }), car('min', { priority: { code: 'below_minimum' } }), car('now', { priority: { code: 'boost' } })], 50);
  assert.deepStrictEqual(r.order, ['now', 'min', 'plan']);
});
check('Ready Guard protecting a car goes before a normal plan', () => {
  const r = share([car('plan', { priority: { latest_safe_start: 1 } }), car('guard', { priority: { protect: true, latest_safe_start: 9 } })], 50);
  assert.deepStrictEqual(r.order, ['guard', 'plan']);
});
check('enough for everyone: nobody is limited', () => {
  const r = share([car('A'), car('B')], 40);
  assert.deepStrictEqual(r.result, {});
});
check('the rest is shared fairly by the others', () => {
  const r = share([car('A', { priority: { latest_safe_start: 1 } }), car('B', { priority: { latest_safe_start: 2 } }), car('C', { priority: { latest_safe_start: 3 } })], 32);
  assert.strictEqual(r.result.A, undefined);
  assert.strictEqual(r.result.B.amps, 8);
  assert.strictEqual(r.result.C.amps, 8);
});
check('less than 6 A each: the next car in line gets 6 A, the others wait', () => {
  const r = share([car('A', { priority: { latest_safe_start: 1 } }), car('B', { priority: { latest_safe_start: 2 } }), car('C', { priority: { latest_safe_start: 3 } })], 24);
  assert.strictEqual(r.result.B.amps, 6);
  assert.strictEqual(r.result.C.pause, true);
});
check('a charger that can only start and stop gets its full current or waits', () => {
  const r = share([car('A', { priority: { latest_safe_start: 1 } }), car('B', { can_set_current: false, priority: { latest_safe_start: 2 } })], 25);
  assert.strictEqual(r.result.B.pause, true);
  const r2 = share([car('A', { priority: { latest_safe_start: 1 } }), car('B', { can_set_current: false, priority: { latest_safe_start: 2 } })], 33);
  assert.strictEqual(r2.result.B, undefined);
});
check('the first car is lowered only when even it does not fit and its current can be set', () => {
  const r = share([car('A'), car('B', { order: 1 })], 10);
  assert.strictEqual(r.result.A.amps, 10);
  assert.strictEqual(r.result.B.pause, true);
});
check('solar: only the first car charges on the sun', () => {
  const r = share([car('A', { solar: true, priority: { latest_safe_start: 1 } }), car('B', { solar: true, priority: { latest_safe_start: 2 } })], null);
  assert.strictEqual(r.result.A, undefined);
  assert.strictEqual(r.result.B.pause, true);
});
check('unknown connection (no grid meter or a load balancer): nobody is limited', () => {
  const r = share([car('A'), car('B', { order: 1 })], null);
  assert.deepStrictEqual(r.result, {});
});
check('available current: main fuse minus the house (grid minus the chargers) minus 1 A', () => {
  assert.strictEqual(Math.round(available({ mainFuse: 25, gridW: 850 + 11040, chargersW: 11040 }) * 10) / 10, 22.8);
  assert.strictEqual(available({ mainFuse: 25, gridA: 20, chargersA: 16 }), 20);
  assert.strictEqual(available({ mainFuse: 25, gridW: -3000, chargersW: 0 }), 24); // exporting: the house uses nothing extra
  assert.strictEqual(available({ mainFuse: 0 }), null);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

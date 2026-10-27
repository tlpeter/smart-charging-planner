'use strict';

// More chargers, one connection: who may charge, and with how much current?
// Run: node tests/sharing.test.js   (from the repository root)

const assert = require('assert');
const { share, available, capacity, linesOf } = require('../smart_charging_planner/app/sharing');

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

for (const capacity of [0, 4, 5]) {
  check('the first adjustable charger pauses below 6 A (' + capacity + ' A)', () => {
    const r = share([car('first'), car('second', { order: 1 })], capacity);
    assert.strictEqual(r.result.first.pause, true);
    assert.strictEqual(r.result.second.pause, true);
  });
}
check('the first adjustable charger can use exactly 6 A', () => {
  const r = share([car('first'), car('second', { order: 1 })], 6);
  assert.strictEqual(r.result.first.amps, 6);
  assert.strictEqual(r.result.first.pause, false);
  assert.strictEqual(r.result.second.pause, true);
});
check('a first start/stop-only charger waits when its full current does not fit', () => {
  for (const capacity of [0, 4, 5, 6, 10]) {
    const r = share([car('first', { can_set_current: false }), car('second', { order: 1 })], capacity);
    assert.strictEqual(r.result.first.pause, true);
    if (capacity >= 6) assert.strictEqual(r.result.second.amps, capacity);
    else assert.strictEqual(r.result.second.pause, true);
  }
});
check('a first start/stop-only charger receives its full current when it fits', () => {
  assert.strictEqual(share([car('first', { can_set_current: false })], 16).result.first, undefined);
});
check('both grid sign conventions give the same allocation for import and export', () => {
  const { gridNetW } = require('../smart_charging_planner/app/solar');
  for (const netW of [13800, -3000, 0]) {
    const capacity = (sign, value, unit = 'W') => available({ mainFuse: 25, gridW: gridNetW(
      { net_entity: 'sensor.grid' },
      [{ entity_id: 'sensor.grid', state: String(value), attributes: { unit_of_measurement: unit } }], sign) });
    assert.strictEqual(capacity('import_positive', netW), capacity('export_positive', -netW));
    assert.strictEqual(capacity('import_positive', netW), capacity('export_positive', -netW / 1000, 'kW'));
  }
  assert.strictEqual(gridNetW({ net_entity: 'sensor.absent' }, [], 'export_positive'), null);
});

// Per phase (#29).
const first = (o = {}) => car('A', { priority: { latest_safe_start: 1 }, ...o });
const second = (o = {}) => car('B', { priority: { latest_safe_start: 2 }, ...o });
check('two one-phase chargers on different phases both get their full current', () => {
  const r = share([first({ lines: ['L1'] }), second({ lines: ['L2'] })], { L1: 21, L2: 22, L3: 22 });
  assert.deepStrictEqual(r.result, {});
});
check('two one-phase chargers on the same phase share it: the second gets what is left or waits', () => {
  let r = share([first({ lines: ['L1'] }), second({ lines: ['L1'] })], { L1: 21, L2: 22, L3: 22 });
  assert.strictEqual(r.result.A, undefined);
  assert.strictEqual(r.result.B.pause, true); // 5 A left on L1
  r = share([first({ lines: ['L1'] }), second({ lines: ['L1'] })], { L1: 24, L2: 24, L3: 24 });
  assert.strictEqual(r.result.B.amps, 8);
});
check('one phase with an unknown phase: the current is kept free on every phase', () => {
  assert.deepStrictEqual(linesOf({ phases: 1, phase: null }), ['L1', 'L2', 'L3']);
  assert.deepStrictEqual(linesOf({ phases: 1, phase: 'L2' }), ['L2']);
  assert.deepStrictEqual(linesOf({ phases: 3, phase: 'L2' }), ['L1', 'L2', 'L3']);
  assert.deepStrictEqual(linesOf({ phases: 3, gridPhases: 1 }), ['L1']);
  const known = share([first({ lines: ['L2'] }), second({ lines: ['L1'] })], { L1: 21, L2: 22, L3: 22 });
  assert.strictEqual(known.result.B, undefined); // L1 is free: full current
  const unknown = share([first({ lines: ['L2'] }), second({ lines: linesOf({ phases: 1 }) })], { L1: 21, L2: 22, L3: 22 });
  assert.strictEqual(unknown.result.B.amps, 6); // only 6 A left on L2
});
check('mixed: a three-phase charger and a one-phase charger', () => {
  // Three-phase first (16 A on each phase): 5/6/6 A left.
  const onL1 = share([first(), second({ lines: ['L1'] })], { L1: 21, L2: 22, L3: 22 });
  assert.strictEqual(onL1.result.B.pause, true);
  const onL2 = share([first(), second({ lines: ['L2'] })], { L1: 21, L2: 22, L3: 22 });
  assert.strictEqual(onL2.result.B.amps, 6);
  // One-phase first on L1: the three-phase charger is limited by L1.
  const r = share([first({ lines: ['L1'] }), second()], { L1: 30, L2: 24, L3: 24 });
  assert.strictEqual(r.result.B.amps, 14);
});
check('fair share per phase: chargers on other phases do not count', () => {
  const r = share([first({ lines: ['L1'], amps: 6 }), second({ lines: ['L2'] }), car('C', { lines: ['L2'], priority: { latest_safe_start: 3 } })], { L1: 24, L2: 24, L3: 24 });
  assert.strictEqual(r.result.B.amps, 12);
  assert.strictEqual(r.result.C.amps, 12);
});
check('changes take time: a charger only goes up as far as the others have come down', () => {
  // B draws 16 A now and must make room for A (Charge now).
  const now = [first({ priority: { code: 'boost' }, measured_a: 0 }), second({ measured_a: 16 })];
  const r = share(now, 24);
  assert.strictEqual(r.result.B.amps, 8); // B goes down to 8 A
  assert.strictEqual(r.result.A.amps, 8); // A may only use 24 - 16 for now
  assert.ok(/for now/.test(r.result.A.reason), r.result.A.reason);
  // Next step, B draws 8 A: A gets its full 16 A.
  const next = share([first({ priority: { code: 'boost' }, measured_a: 8 }), second({ measured_a: 8 })], 24);
  assert.strictEqual(next.result.A, undefined);
  // A start/stop-only charger waits until there is room for all of it.
  const ss = share([first({ priority: { code: 'boost' }, can_set_current: false }), second({ measured_a: 16 })], 24);
  assert.strictEqual(ss.result.A.pause, true);
  assert.ok(/lowering/.test(ss.result.A.reason));
});
check('a charger that stops wanting still counts with what it draws now', () => {
  const r = share([first(), car('B', { want: 'pause', measured_a: 16 })], 24);
  assert.strictEqual(r.result.A.amps, 8);
});
check('home battery: grid charging only with what the chargers leave, the cars go first', () => {
  const bat = (o = {}) => ({ lines: ['L1', 'L2', 'L3'], need_a: 4.3, measured_a: 0, ...o }); // 3 kW on three phases
  assert.strictEqual(share([first()], 24, { battery: bat() }).battery.fits, true); // 8 A left
  assert.strictEqual(share([first(), second({ amps: 6 })], 24, { battery: bat() }).battery.fits, false); // 2 A left
  // A one-phase battery on L2 only needs room on L2.
  const one = { lines: ['L2'], need_a: 13, measured_a: 0 };
  assert.strictEqual(share([first({ lines: ['L1'] })], { L1: 21, L2: 22, L3: 22 }, { battery: one }).battery.fits, true);
  assert.strictEqual(share([first({ lines: ['L2'] })], { L1: 21, L2: 22, L3: 22 }, { battery: one }).battery.fits, false);
  // The battery charges now (13 A on L2): a charger on L2 goes up only once the battery stopped.
  const r = share([first({ lines: ['L2'] })], { L1: 21, L2: 22, L3: 22 }, { battery: { ...one, measured_a: 13 } });
  assert.strictEqual(r.result.A.amps, 9);
  assert.strictEqual(r.battery.fits, false);
  // No battery: no battery answer.
  assert.strictEqual(share([first()], 24).battery, null);
});
check('capacity per phase: main fuse minus the house on that phase (grid minus the chargers on it) minus 1 A', () => {
  const c = capacity({ mainFuse: 25, phaseA: { L1: 19, L2: 2, L3: 2 }, consumers: [{ lines: ['L1'], measured_a: 16 }] });
  assert.deepStrictEqual(c, { L1: 21, L2: 22, L3: 22 });
  // An unknown-phase charger is taken off every phase (and kept free on every phase by share).
  const u = capacity({ mainFuse: 25, phaseA: { L1: 19, L2: 2, L3: 2 }, consumers: [{ lines: ['L1', 'L2', 'L3'], measured_a: 16 }] });
  assert.deepStrictEqual(u, { L1: 21, L2: 24, L3: 24 });
  // Net power only: spread over the phases, as before.
  const n = capacity({ mainFuse: 25, gridW: 850 + 11040, consumers: [{ power_w: 11040 }] });
  assert.strictEqual(Math.round(n.L1 * 10) / 10, 22.8);
  // One-phase connection: only L1.
  assert.deepStrictEqual(Object.keys(capacity({ mainFuse: 35, phases: 1, gridW: 0 })), ['L1']);
  // A missing phase reading falls back to net power; no reading at all: the safe side, 6 A.
  assert.strictEqual(capacity({ mainFuse: 25, phaseA: { L1: 3, L2: null, L3: 2 }, gridW: 0 }).L2, 24);
  assert.deepStrictEqual(capacity({ mainFuse: 25 }), { L1: 6, L2: 6, L3: 6 });
  assert.strictEqual(capacity({ mainFuse: 0 }), null);
});
check('no fresh reading: one charger at 6 A, the others wait, no grid charging for the battery', () => {
  const r = share([first({ measured_a: 16 }), second({ measured_a: 16 })], capacity({ mainFuse: 25 }), { battery: { need_a: 4, measured_a: 0 } });
  assert.strictEqual(r.result.A.amps, 6);
  assert.strictEqual(r.result.B.pause, true);
  assert.strictEqual(r.battery.fits, false);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

'use strict';

const assert = require('assert');
const { evaluateReadyGuard, duration } = require('../smart_charging_planner/app/reliability');
const controller = require('../smart_charging_planner/app/controller');

const H = 3600000;
const now = Date.UTC(2026, 0, 1, 8);

function check(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (err) {
    console.error('not ok -', name);
    throw err;
  }
}

check('reports an affordable plan with time left as on track', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 6 * H, neededKwh: 18, plannedKwh: 18, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + H, end: now + 3 * H }],
  });
  assert.equal(r.status, 'on_track');
  assert.equal(r.protect, false);
  assert(r.latest_safe_start > now);
  assert(r.safety_margin_minutes >= 30);
});

check('starts protection after the latest safe start', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 2 * H, neededKwh: 16, plannedKwh: 16, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + H, end: now + 2 * H }],
  });
  assert.equal(r.status, 'at_risk');
  assert.equal(r.protect, true);
  assert.match(r.reason, /latest safe start/i);
});

check('marks a physically impossible target and still protects it', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + H, neededKwh: 20, plannedKwh: 8, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true, blocks: [],
  });
  assert.equal(r.status, 'not_achievable');
  assert.equal(r.protect, true);
  assert(r.shortfall_kwh > 10);
});

check('asks the user to plug in without pretending it can act', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 4 * H, neededKwh: 10, plannedKwh: 10, powerKw: 11,
    plugged: false, charging: false, controlAllowed: true, blocks: [],
  });
  assert.equal(r.status, 'action_needed');
  assert.equal(r.protect, false);
});

check('makes a required intervention visibly advice-only when control is off', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + H, neededKwh: 8, plannedKwh: 8, powerKw: 11,
    plugged: true, charging: false, controlAllowed: false, blocks: [],
  });
  assert.equal(r.status, 'advice_only');
  assert.equal(r.base_status, 'at_risk');
  assert.equal(r.protect, true);
});


check('controller gives Ready Guard priority over price and solar waiting', () => {
  const reliability = evaluateReadyGuard({
    now, deadline: now + 2 * H, neededKwh: 16, plannedKwh: 16, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + H, end: now + 2 * H }],
  });
  const decision = controller.decide({
    now,
    actual: { plugged: true, charging: false, status_invalid: false },
    rules: controller.DEFAULT_RULES,
    states: [],
    phases: 3,
    solar: { mode: 'solar', charge: false, reason: 'Waiting for sun' },
    plan: {
      reliability,
      vehicle: { soc: 30 },
      planning: { target_soc: 80 },
      departure: { time: now + 2 * H },
      charger: { max_current: 16 },
      prices: [],
      plan: { blocks: [], periods: [], notes: [] },
    },
  });
  assert.equal(decision.code, 'ready_guard');
  assert.equal(decision.want, 'charge');
  assert.equal(decision.clear_lock, true);
});

check('can be disabled without changing the plan', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + H, neededKwh: 8, plannedKwh: 0, powerKw: 11,
    plugged: true, controlAllowed: true, enabled: false,
  });
  assert.equal(r.status, 'off');
  assert.equal(r.protect, false);
});

check('does nothing without a departure and accepts an already reached target', () => {
  assert.equal(evaluateReadyGuard({ now, neededKwh: 5, powerKw: 11 }).status, 'no_goal');
  const done = evaluateReadyGuard({ now, deadline: now + H, neededKwh: 0, powerKw: 11, plugged: true });
  assert.equal(done.status, 'on_track');
  assert.equal(done.protect, false);
});

check('time to spare in days and hours, not thousands of minutes', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 110 * H, neededKwh: 10, plannedKwh: 10, powerKw: 11,
    blocks: [{ start: now, end: now + 2 * H, price: 0.2 }], plugged: true, controlAllowed: true,
  });
  assert.match(r.message, /4 d 12 h to spare/);
  assert.equal(duration(45), '45 min');
  assert.equal(duration(200), '3 h 20 min');
  assert.equal(duration(120), '2 h');
  assert.equal(duration(5160), '3 d 14 h');
});

check('prices not yet known up to departure: shown on the chip, status stays on track', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 40 * H, neededKwh: 10, plannedKwh: 10, powerKw: 11,
    blocks: [{ start: now + 2 * H, end: now + 4 * H, price: 0.2 }], plugged: true, controlAllowed: true,
    notes: ['prices_incomplete'],
  });
  const chip = r.factors.find((f) => f.key === 'prices');
  assert.equal(chip.state, 'warn');
  assert.equal(chip.label, 'Prices not yet known up to departure');
  assert.equal(r.status, 'on_track');
});

check('forecast failure alone does not downgrade a complete real-price plan', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 8 * H, neededKwh: 10, plannedKwh: 10, powerKw: 11,
    blocks: [{ start: now + H, end: now + 3 * H, price: 0.2 }], plugged: true, controlAllowed: true,
    notes: ['forecast_error'],
  });
  const chip = r.factors.find((f) => f.key === 'prices');
  assert.equal(chip.state, 'warn');
  assert.match(chip.label, /forecast unavailable/i);
  assert.equal(r.status, 'on_track');
});

console.log('Ready Guard tests passed');

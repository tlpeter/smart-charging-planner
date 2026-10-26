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
  const plannedReady = now + 3 * H;
  const r = evaluateReadyGuard({
    now, deadline: now + 6 * H, neededKwh: 18, plannedKwh: 18, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + H, end: plannedReady }],
  });
  assert.equal(r.status, 'on_track');
  assert.equal(r.protect, false);
  assert(r.latest_safe_start > now);
  assert(r.safety_margin_minutes >= 30);
  assert.equal(r.expected_ready, plannedReady);
  assert.equal(r.planned_ready, plannedReady);
  assert(r.continuous_ready < plannedReady);
});

check('keeps the uninterrupted Ready Guard estimate when the known plan is incomplete', () => {
  const r = evaluateReadyGuard({
    now, deadline: now + 8 * H, neededKwh: 18, plannedKwh: 8, powerKw: 11,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + 5 * H, end: now + 6 * H }],
  });
  assert.equal(r.status, 'at_risk');
  assert.equal(r.expected_ready, r.continuous_ready);
  assert.notEqual(r.expected_ready, r.planned_ready);
  assert.equal(r.guard_until, r.continuous_ready);
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

check('the car\'s own charge limit below the wanted level is "action needed", not "ready"', () => {
  // 11 Oct 2026: trip needs 100%, car limit 80% (the app may not change it),
  // battery 87%: the plan to 80% was "already at the target".
  const r = evaluateReadyGuard({
    now, deadline: now + 3 * H, neededKwh: 0, plannedKwh: 0, powerKw: 9,
    plugged: true, charging: false, controlAllowed: true, blocks: [],
    carLimit: { value: 80, wanted: 100, writable: true, controlAllowed: true },
  });
  assert.equal(r.status, 'action_needed');
  assert.equal(r.base_status, 'action_needed');
  assert.match(r.label, /80%/);
  assert.match(r.message, /100% is wanted/);
  assert.match(r.message, /Settings › Rules/);
  const ro = evaluateReadyGuard({
    now, deadline: now + 3 * H, neededKwh: 0, plannedKwh: 0, powerKw: 9, plugged: true, controlAllowed: true,
    carLimit: { value: 80, wanted: 100, writable: false },
  });
  assert.match(ro.message, /in the car or its app/);
  const same = evaluateReadyGuard({
    now, deadline: now + 3 * H, neededKwh: 0, plannedKwh: 0, powerKw: 9, plugged: true, controlAllowed: true,
    carLimit: { value: 100, wanted: 100 },
  });
  assert.equal(same.status, 'on_track', 'a limit that is high enough changes nothing');
});

check('a plan that starts after the latest safe start says Ready Guard starts earlier', () => {
  const deadline = now + 2 * H;
  const r = evaluateReadyGuard({
    now, deadline, neededKwh: 8.6, plannedKwh: 8.6, powerKw: 9,
    plugged: true, charging: false, controlAllowed: true,
    blocks: [{ start: now + H, end: now + H + 57 * 60000 }],
  });
  assert(r.latest_safe_start < now + H);
  assert.equal(r.status, 'at_risk');
  assert.equal(r.label, 'Ready Guard starts earlier');
  assert.equal(r.protect, false, 'it only takes over at the latest safe start itself');
});

// A block that is only for "Always charge below a minimum" follows that rule
// alone: above its maximum price (or above the minimum) it does not charge
// and does not lock the period.
function minimumPlan(price) {
  return {
    vehicle: { soc: 30 },
    planning: { target_soc: 80 },
    departure: { time: now + 12 * H },
    charger: { max_current: 16 },
    prices: [{ start: now - H / 4, end: now + H, total: price }],
    plan: {
      blocks: [
        { start: now - H / 4, end: now + 2 * H, kwh: 20, min_kwh: 20, price: 0.18, power_kw: 11 },
        { start: now + 8 * H, end: now + 9 * H, kwh: 10, price: 0.12, power_kw: 11 },
      ],
      periods: [{ start: now - H / 4, end: now + 2 * H }, { start: now + 8 * H, end: now + 9 * H }],
      notes: ['below_minimum'],
    },
  };
}
const minRules = { ...controller.DEFAULT_RULES, ready_guard_enabled: false, min_soc_enabled: true, min_soc: 40, min_soc_max_price: 0.2 };

check('below the minimum and the price allows it: charges for the minimum', () => {
  const d = controller.decide({ now, actual: { plugged: true, charging: false, status_invalid: false }, rules: minRules, states: [], phases: 3, plan: minimumPlan(0.18) });
  assert.equal(d.code, 'below_minimum');
  assert.equal(d.new_lock, undefined);
});

check('price above the maximum: a minimum-only block does not charge or lock', () => {
  const d = controller.decide({ now, actual: { plugged: true, charging: true, status_invalid: false }, rules: minRules, states: [], phases: 3, plan: minimumPlan(0.35), prevCode: 'below_minimum' });
  assert.equal(d.want, 'pause');
  assert.equal(d.code, 'not_planned');
  assert.equal(d.new_lock, undefined);
});

check('above the minimum: a minimum-only block that is still in the plan does not charge', () => {
  const plan = { ...minimumPlan(0.18), vehicle: { soc: 41 } };
  const d = controller.decide({ now, actual: { plugged: true, charging: true, status_invalid: false }, rules: minRules, states: [], phases: 3, plan, prevCode: 'below_minimum' });
  assert.equal(d.want, 'pause');
});

check('a block that is partly for the minimum is still a planned block', () => {
  const plan = minimumPlan(0.35);
  plan.plan.blocks[0] = { ...plan.plan.blocks[0], kwh: 20, min_kwh: 5 };
  const d = controller.decide({ now, actual: { plugged: true, charging: false, status_invalid: false }, rules: minRules, states: [], phases: 3, plan });
  assert.equal(d.code, 'planned');
});


const carePlan = {
  vehicle: { soc: 79 }, planning: { target_soc: 90 }, departure: { time: now + 10 * H },
  prices: [{ start: now, end: now + H, total: 0.40 }],
  plan: { blocks: [{ start: now + 8 * H, end: now + 9 * H, kwh: 6.6, price: 0.10 }],
    notes: ['battery_care'], care: { soc: 80, target: 90, window_start: now + 6 * H, refill_deferred: true } },
};
const careCtx = { now, actual: { plugged: true, charging: true, status_invalid: false }, rules: { ...controller.DEFAULT_RULES, ready_guard_enabled: false },
  states: [], phases: 3, plan: carePlan, lock: { start: now - H, end: now + H, amps: 16 }, prevCode: 'planned' };
check('Battery Care deferred refill ignores a previous lock and price hysteresis (#43)', () => {
  const d = controller.decide(careCtx);
  assert.equal(d.want, 'pause');
  assert.equal(d.code, 'battery_care_wait');
  assert.equal(d.clear_lock, true);
  assert.equal(d.next_start, now + 8 * H);
});
check('Battery Care at the holding level stops instead of continuing to 90%', () => {
  const d = controller.decide({ ...careCtx, plan: { ...carePlan, vehicle: { soc: 80 }, plan: { ...carePlan.plan, care: { ...carePlan.plan.care, refill_deferred: false } } } });
  assert.equal(d.want, 'pause');
  assert.equal(d.clear_lock, true);
});
check('Battery Care refill still respects a separately configured hard minimum', () => {
  const d = controller.decide({ ...careCtx, rules: { ...careCtx.rules, min_soc_enabled: true, min_soc: 80 } });
  assert.equal(d.code, 'below_minimum');
  assert.equal(d.want, 'charge');
  const capped = controller.decide({ ...careCtx, rules: { ...careCtx.rules, min_soc_enabled: true, min_soc: 80, min_soc_max_price: 0.20 } });
  assert.equal(capped.want, 'pause');
});
check('Battery Care refill never delays explicit Charge now or Ready Guard', () => {
  assert.equal(controller.decide({ ...careCtx, boostActive: true }).code, 'boost');
  assert.equal(controller.decide({ ...careCtx, plan: { ...carePlan, reliability: { protect: true, guard_until: now + 10 * H } } }).code, 'ready_guard');
  assert.equal(controller.decide({ ...careCtx, plan: { ...carePlan, departure: { time: now + 0.5 * H } }, rules: { ...careCtx.rules, force_minutes: 60 } }).code, 'force_window');
  assert.equal(controller.decide({ ...careCtx, solar: { mode: 'plan_solar', charge: true, amps: 6 } }).code, 'solar');
});
check('Battery Care charges normally in the selected final-window price slot', () => {
  const d = controller.decide({ ...careCtx, now: now + 8 * H, lock: null });
  assert.equal(d.code, 'planned');
  assert.equal(d.want, 'charge');
});

console.log('Ready Guard tests passed');

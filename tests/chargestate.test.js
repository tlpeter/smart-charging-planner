'use strict';

// The charging status on top of Home: which state, which colour.
// Ready green, charging red, waiting yellow (amber), in the way orange, idle grey.

const assert = require('assert');
const { chargeState } = require('../smart_charging_planner/app/chargestate');

const H = 3600000;
const now = Date.UTC(2026, 9, 11, 9);
const fmt = { hm: (ms) => new Date(ms).toISOString().slice(11, 16), dayHm: (ms) => `Sun ${new Date(ms).toISOString().slice(11, 16)}` };

function check(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (err) {
    console.error('not ok -', name);
    throw err;
  }
}

const plan = (o = {}) => ({
  control_allowed: true,
  vehicle: { soc: 87, car_data: { ok: true } },
  planning: { target_soc: 100, wanted_soc: 100 },
  plan: { blocks: [{ start: now + H, end: now + 2 * H }], notes: [] },
  reliability: { base_status: 'on_track', expected_ready: now + 2 * H },
  departure: { time: now + 3 * H, soc: 100 },
  ...o,
});
const n = (o = {}) => ({ at: now, plugged: true, charging: false, power_w: 0, want: 'pause', code: 'not_planned', reason: 'Not a planned block', next_start: now + H, ...o });
const S = (d, x) => chargeState(d, x, fmt);

check('charging is red, with power, level and ready time', () => {
  const s = S(plan(), n({ charging: true, power_w: 9100, want: 'charge', code: 'planned' }));
  assert.equal(s.state, 'charging');
  assert.equal(s.color, 'red');
  assert.equal(s.title, 'Charging now');
  assert.match(s.detail, /9\.1 kW · 87% → 100% · ready around Sun 11:00/);
});

check('below the minimum: "Charging to your minimum", up to the minimum, ready when the minimum part ends', () => {
  const d = plan({
    vehicle: { soc: 21, car_data: { ok: true } },
    planning: { target_soc: 80, wanted_soc: 80 },
    plan: { blocks: [{ start: now, end: now + 1.4 * H, kwh: 12.5, min_kwh: 12.5 }, { start: now + 15 * H, end: now + 18 * H, kwh: 26 }], notes: ['below_minimum'], minimum: { soc: 40, kwh: 12.5, kind: 'always' } },
    reliability: { base_status: 'on_track', expected_ready: now + 18 * H },
  });
  const s = S(d, n({ charging: true, power_w: 9000, want: 'charge', code: 'below_minimum' }));
  assert.equal(s.title, 'Charging to your minimum');
  assert.match(s.detail, /9\.0 kW · 21% → 40% · ready around Sun 10:24 · your minimum first, then the plan/);
});

check('Charge now to a level: that level and its own end time', () => {
  const d = plan({
    vehicle: { soc: 21, car_data: { ok: true } },
    planning: { target_soc: 80, wanted_soc: 80 },
    boost: { active: true, mode: 'soc', value: 50, end: now + 2 * H },
    plan: { blocks: [{ start: now, end: now + 2 * H, kwh: 17 }], notes: [] },
  });
  const s = S(d, n({ charging: true, power_w: 9000, want: 'charge', code: 'boost' }));
  assert.equal(s.title, 'Charging now');
  assert.match(s.detail, /21% → 50% · ready around Sun 11:00 · Charge now/);
  const q = S({ ...d, boost: { ...d.boost, value: 40, minimum: true } }, n({ charging: true, power_w: 9000, want: 'charge', code: 'boost' }));
  assert.match(q.detail, /21% → 40% · .*Quick minimum/);
  // "Just turn it on": no goal, no end time and no car data (it may be a visitor's car).
  const on = S({ ...d, boost: { active: true, mode: 'on', value: null } }, n({ charging: true, power_w: 9000, want: 'charge', code: 'boost' }));
  assert.match(on.detail, /^9\.0 kW · Charge now: on until you press Stop or unplug$/);
});

check('Battery care: at the care level before the last hours, the status says when charging really starts (also when the charger is on)', () => {
  const d = plan({
    vehicle: { soc: 81, car_data: { ok: true } },
    planning: { target_soc: 100, wanted_soc: 100 },
    reliability: { base_status: 'at_risk', expected_ready: now + 2 * H },
    plan: { blocks: [{ start: now + 0.5 * H, end: now + 2 * H, kwh: 12 }], notes: ['battery_care'], care: { soc: 80, target: 100, window_start: now + 0.4 * H } },
  });
  for (const x of [n({ want: 'charge', code: 'ready_guard', charging: false, power_w: 0 }), n()]) {
    const s = S(d, x);
    assert.equal(s.state, 'care_wait');
    assert.equal(s.color, 'amber');
    assert.equal(s.title, `Battery care · charging starts at ${fmt.hm(now + 0.5 * H)}`);
    assert.match(s.detail, /81% → 100% · the car stays at 80% until then/);
  }
  // Once the window has started (or the car is below the care level), the normal states again.
  assert.notEqual(S(plan({ ...d, plan: { ...d.plan, care: { ...d.plan.care, window_start: now - H } } }), n()).state, 'care_wait');
  assert.notEqual(S(plan({ ...d, vehicle: { soc: 60, car_data: { ok: true } } }), n()).state, 'care_wait');
});

check('The app wants to charge and the charger switch is on, but no power flows: say so, with the charger status (no advice)', () => {
  const d = plan({ vehicle: { soc: 81, car_data: { ok: true } }, car_limit: { value: 100, name: 'Charge limit' }, reliability: { base_status: 'at_risk', protect: true, reason: 'Ready Guard is protecting the departure target', expected_ready: now + 2 * H } });
  const sw = (since) => ({ entity_id: 'switch.eh123456_charger_enabled', name: 'EH123456 Charger enabled', state: 'on', on: true, since });
  const x = n({ want: 'charge', code: 'ready_guard', reason: 'Ready Guard is protecting the departure target', status: 'awaiting_start', switch_state: sw(now - 20 * 60000) });
  const s = S(d, x);
  assert.equal(s.state, 'no_power');
  assert.equal(s.color, 'orange');
  assert.equal(s.title, 'The charger is on, but the car takes no power');
  assert.match(s.detail, /Charger: awaiting_start \(a car is connected; charging has not started\) · on since Sun 08:40/);
  // The facts under "Why?".
  const f = Object.fromEntries(s.facts.map((y) => [y.label, y.value]));
  assert.match(f['The app wants'], /^charge · Ready Guard/);
  assert.match(f['EH123456 Charger enabled'], /^on \(charging allowed\) · since/);
  assert.match(f['Charger status'], /^awaiting_start · a car is connected/);
  assert.equal(f['Power now'], '0.0 kW');
  assert.match(f.Car, /plugged in · battery 81% · charge limit 100% · target 100%/);
  assert.ok(f['Ready Guard']);
  // Just switched on (less than a minute): still "Starting to charge".
  assert.equal(S(d, { ...x, switch_state: sw(now - 20000) }).state, 'starting');
});

check('Ready Guard and solar charging have their own title', () => {
  assert.equal(S(plan(), n({ charging: true, code: 'ready_guard', want: 'charge' })).title, 'Ready Guard charging');
  assert.equal(S(plan(), n({ charging: true, code: 'solar', want: 'charge' })).title, 'Charging on solar');
});

check('waiting for the plan is yellow, with the start time', () => {
  const s = S(plan(), n());
  assert.equal(s.state, 'waiting');
  assert.equal(s.color, 'amber');
  assert.equal(s.title, 'Not charging now · starts at 10:00');
});

check('a plan that starts after the latest safe start shows the Ready Guard start', () => {
  const s = S(plan({ reliability: { base_status: 'at_risk', latest_safe_start: now + H / 2, expected_ready: now + 2 * H } }), n());
  assert.equal(s.title, 'Not charging now · starts at 09:30');
  assert.match(s.detail, /Ready Guard starts early/);
});

check('ready is green', () => {
  const s = S(plan({ vehicle: { soc: 100, car_data: { ok: true } } }), n({ code: 'at_target', next_start: null }));
  assert.equal(s.state, 'ready');
  assert.equal(s.color, 'green');
});

check('the car\'s charge limit below the trip is orange (11 Oct 2026)', () => {
  const s = S(plan({
    planning: { target_soc: 80, wanted_soc: 100 },
    plan: { blocks: [], notes: ['already_at_target', 'car_limit'] },
    car_limit: { value: 80 },
    reliability: { base_status: 'action_needed', car_limit: { value: 80, wanted: 100 }, message: 'The car stops charging at 80%, but 100% is wanted.' },
  }), n({ code: 'at_target', next_start: null }));
  assert.equal(s.state, 'car_limit');
  assert.equal(s.color, 'orange');
  assert.match(s.title, /80%/);
});

check('problems are orange: charger offline, charger did not start, car not reachable, missing data', () => {
  assert.equal(S(plan(), n({ status: 'unavailable', code: 'status_invalid' })).state, 'charger_offline');
  assert.equal(S(plan(), n({ code: 'no_reaction', want: 'charge', error: 'no power after 5 minutes' })).state, 'no_reaction');
  assert.equal(S(plan({ vehicle: { soc: 60, car_data: { ok: false } } }), n()).state, 'car_unreachable');
  assert.equal(S(plan({ vehicle: { soc: null } }), n({ code: 'missing_data', next_start: null })).state, 'missing_data');
  for (const x of [n({ status: 'unavailable', code: 'status_invalid' }), n({ code: 'no_reaction', want: 'charge', error: 'x' })]) assert.equal(S(plan(), x).color, 'orange');
});

check('the charger reports a problem (an error, a fault): orange, with its own words', () => {
  const s = S(plan(), n({ status: 'Error Protective Earth', code: 'status_grace', plugged: null }));
  assert.equal(s.state, 'charger_problem');
  assert.equal(s.color, 'orange');
  assert.ok(s.detail.includes('Error Protective Earth'), s.detail);
});

check('starting, the sun and the other charger are yellow', () => {
  assert.equal(S(plan(), n({ want: 'charge', code: 'planned' })).state, 'starting');
  const sun = S(plan(), n({ code: 'solar_wait', reason: 'Waiting for solar surplus', next_start: null }));
  assert.equal(sun.state, 'solar_wait');
  assert.equal(sun.color, 'amber');
  assert.equal(S(plan(), n({ code: 'shared_wait', next_start: null })).color, 'amber');
});

check('not connected and nothing to do are grey; advice only is marked', () => {
  assert.equal(S(plan(), n({ plugged: false })).color, 'grey');
  assert.equal(S(plan({ plan: { blocks: [], notes: [] } }), n({ next_start: null, code: 'not_planned' })).color, 'grey');
  assert.equal(S(plan({ control_allowed: false }), n()).advice_only, true);
});

console.log('Charging status tests passed');

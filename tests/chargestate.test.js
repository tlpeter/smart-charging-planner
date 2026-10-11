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

'use strict';

// Forecast prices: recognised in sensor lists, read in the right time zone,
// and passed through the planner. Run: node tests/forecast.test.js

const path = require('path');
const app = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const { pricesFromAttributes, localDateTime } = require(path.join(app, 'prices.js'));
const { planCharging, periods } = require(path.join(app, 'planner.js'));

let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const tz = 'Europe/Amsterdam';

// A combined sensor: real prices and forecast entries, local times without offset.
const list = [];
for (let h = 0; h < 6; h++) list.push({ time: `2026-10-03 0${h}:00:00`, price: 0.3, source: 'anwb' });
for (let h = 0; h < 6; h++) list.push({ time: `2026-10-04 0${h}:00:00`, price: 0.2, source: 'forecast' });
const { prices } = pricesFromAttributes({ prices: list, friendly_name: 'x' }, tz);
check('12 prices parsed', prices.length === 12);
check('6 marked as forecast', prices.filter((p) => p.forecast).length === 6);
check('local time read in HA time zone', prices[0].start === localDateTime(tz, 2026, 10, 3, 0, 0));
check('real entries not marked', !prices.find((p) => p.start === localDateTime(tz, 2026, 10, 3, 1, 0)).forecast);

// Planner keeps the forecast flag on blocks and periods.
const H = 3600000;
const t0 = localDateTime(tz, 2026, 10, 3, 0, 0);
const blocks = [
  { start: t0, end: t0 + H, total: 0.3 },
  { start: t0 + H, end: t0 + 2 * H, total: 0.3 },
  { start: t0 + 2 * H, end: t0 + 3 * H, total: 0.2, forecast: true },
  { start: t0 + 3 * H, end: t0 + 4 * H, total: 0.2, forecast: true },
];
const plan = planCharging({ prices: blocks, now: t0, deadline: t0 + 4 * H, neededKwh: 10, powerKw: 10 });
check('plan picks the cheaper forecast hour', plan.blocks.length === 1 && plan.blocks[0].forecast === true);
check('period marked as forecast', periods(plan.blocks)[0].forecast === true);
const real = planCharging({ prices: blocks.slice(0, 2), now: t0, deadline: t0 + 4 * H, neededKwh: 10, powerKw: 10 });
check('without forecast: real hour, no flag', real.blocks.length === 1 && !real.blocks[0].forecast);

// Two goals: a minimum before a departure in between, the rest before the final one.
const { planStaged } = require(path.join(app, 'planner.js'));
const day = [];
for (let h = 0; h < 48; h++) day.push({ start: t0 + h * H, end: t0 + (h + 1) * H, total: h >= 30 && h < 34 ? 0.15 : h < 6 ? 0.25 : 0.35 });
const staged = planStaged({ prices: day, now: t0, firstDeadline: t0 + 7 * H, minKwh: 8, deadline: t0 + 40 * H, neededKwh: 40, powerKw: 10 });
const before = staged.blocks.filter((b) => b.start < t0 + 7 * H).reduce((a, b) => a + b.kwh, 0);
check('staged: minimum charged before the first departure', Math.abs(before - 8) < 0.01);
check('staged: total energy planned', Math.abs(staged.planned_kwh - 40) < 0.01);
check('staged: the rest in the cheap hours', staged.blocks.filter((b) => b.price === 0.15).reduce((a, b) => a + b.kwh, 0) > 39.9 - 8);
check('staged: cheaper than charging right away', staged.savings > 0);
const noMin = planStaged({ prices: day, now: t0, firstDeadline: t0 + 7 * H, minKwh: 0, deadline: t0 + 40 * H, neededKwh: 40, powerKw: 10 });
check('staged without minimum = normal plan', !noMin.stage && noMin.blocks.every((b) => b.start >= t0 + 30 * H));

check('staged: the minimum part is marked (min_kwh)', Math.abs(staged.blocks.reduce((a, b) => a + (b.min_kwh || 0), 0) - 8) < 0.01);

// Below the minimum: that part right away from now, the rest in the cheap hours.
const now2 = t0 + 10 * 60000;
const mn = planStaged({ prices: day, now: now2, firstDeadline: now2, minKwh: 12, deadline: t0 + 40 * H, neededKwh: 40, powerKw: 10, immediateFirst: true });
const minBlocks = mn.blocks.filter((b) => (b.min_kwh || 0) > 0.01);
check('minimum now: starts right away', minBlocks.length && Math.abs(minBlocks[0].start - now2) < 1000);
check('minimum now: 12 kWh marked as minimum', Math.abs(minBlocks.reduce((a, b) => a + b.min_kwh, 0) - 12) < 0.01);
check('minimum now: the rest in the cheap hours', Math.abs(mn.planned_kwh - 40) < 0.01 && mn.blocks.filter((b) => b.price === 0.15).reduce((a, b) => a + b.kwh, 0) > 27.9);

// Below the minimum with a maximum price: the minimum only in blocks at or
// below that price (here not now at 0.35, but from hour 30 at 0.15).
const now3 = t0 + 6 * H + 10 * 60000;
const mx = planStaged({ prices: day, now: now3, firstDeadline: now3, minKwh: 12, deadline: t0 + 40 * H, neededKwh: 40, powerKw: 10, immediateFirst: true, firstMaxPrice: 0.3 });
const mxMin = mx.blocks.filter((b) => (b.min_kwh || 0) > 0.01);
check('minimum with max price: not in expensive blocks', mxMin.length && mxMin.every((b) => b.price <= 0.3));
check('minimum with max price: waits for the first block at or below it', mxMin.length && mxMin[0].start >= t0 + 30 * H);
const mxAny = planStaged({ prices: day, now: now3, firstDeadline: now3, minKwh: 12, deadline: t0 + 40 * H, neededKwh: 40, powerKw: 10, immediateFirst: true, firstMaxPrice: null });
check('minimum without max price: right away, as before', Math.abs(mxAny.blocks.filter((b) => (b.min_kwh || 0) > 0.01)[0].start - now3) < 1000);

// Below the minimum with battery care: the minimum right away, then up to the
// care level whenever it is cheapest, and the part above it only in the window
// before the departure.
const win = t0 + 36 * H;
const cr = planStaged({ prices: day, now: now2, firstDeadline: now2, minKwh: 10, deadline: t0 + 40 * H, neededKwh: 50, powerKw: 10, immediateFirst: true,
  care: { windowStart: win, careKwh: 35 } });
const crMin = cr.blocks.filter((b) => (b.min_kwh || 0) > 0.01);
check('minimum + care: the minimum still right away', crMin.length && Math.abs(crMin[0].start - now2) < 1000);
check('minimum + care: all energy planned', Math.abs(cr.planned_kwh - 50) < 0.01);
check('minimum + care: the part above the care level only in the window', Math.abs(cr.blocks.filter((b) => b.start >= win).reduce((a, b) => a + b.kwh, 0) - 15) < 0.01);
check('minimum + care: care info kept for Home', cr.care && cr.care.top_kwh > 14.9);

// Look ahead: the minimum after a trip never runs past the next departure.
const until = t0 + H;
const cut = planStaged({ prices: day, now: t0, firstDeadline: t0, minKwh: 30, deadline: until, neededKwh: 30, powerKw: 10, immediateFirst: true, immediateUntil: until });
check('minimum stops at the next departure', cut.blocks.every((b) => b.end <= until + 1000) && cut.planned_kwh <= 10.01);
check('minimum stops at the next departure: says the minimum is not reached', cut.notes.includes('minimum_not_reached'));

// The plan table per block (Home): every block says its whole price block
// (block_start/block_end) and when it really charges (start/end). A partly
// used block sits right against the other planned blocks.
const part = planCharging({ prices: day.slice(0, 6), now: t0, deadline: t0 + 6 * H, neededKwh: 25, powerKw: 10, continuous: true });
const partly = part.blocks.filter((b) => b.end - b.start < b.block_end - b.block_start - 60000);
check('plan table: one block is partly used', partly.length === 1 && Math.abs(partly[0].kwh - 5) < 0.01);
check('plan table: the partly used block touches the others (no stop in between)', part.blocks.every((b, i) => i === 0 || Math.abs(b.start - part.blocks[i - 1].end) < 1000));

const assert = require('assert');
const { toPerKwh } = require(path.join(app, 'prices.js'));
for (const currency of ['EUR', 'SEK', 'NOK', 'JPY']) {
  for (const values of [[6, 7, 8, 9], [-6, -7, -8, -9], [0, 0, 0, 0]]) {
    const rows = values.map((price) => ({ price }));
    const warnings = [];
    check(currency + '/kWh preserves explicit prices ' + values.join(','), JSON.stringify(toPerKwh(rows, currency + '/kWh', warnings, currency).map((p) => p.price)) === JSON.stringify(values) && warnings.length === 0);
  }
}
check('explicit MWh converted once', toPerKwh([{ price: 7000 }], 'SEK/MWh', [], 'SEK')[0].price === 7);
check('explicit cents converted once', toPerKwh([{ price: 25 }], 'ct/kWh', [], 'EUR')[0].price === 0.25);
check('negative cents preserved', toPerKwh([{ price: -25 }], 'EURct/kWh', [], 'EUR')[0].price === -0.25);
for (const unit of [null, '', 'electricity', 'currency']) {
  let rejected = false;
  try { toPerKwh([{ price: 7000 }], unit, [], 'EUR'); } catch (e) { rejected = /unit/.test(e.message); }
  check('ambiguous unit requires correction: ' + unit, rejected);
}
let mismatch = false;
try { toPerKwh([{ price: 7 }], 'SEK/kWh', [], 'EUR'); } catch (e) { mismatch = /currency/.test(e.message); }
check('an explicit foreign currency is rejected instead of silently compared', mismatch);

// Nord Pool: Home Assistant's own integration has an action, the HACS
// integration (same platform name) only sensors with raw_today/raw_tomorrow (#17).
{
  const { detectPriceSources, unitHint } = require(path.join(app, 'prices.js'));
  const day = (d, h) => `2026-10-${d}T${String(h).padStart(2, '0')}:00:00+02:00`;
  const raw = (d) => Array.from({ length: 24 }, (_, h) => ({ start: day(d, h), end: day(d, h + 1 > 23 ? 23 : h + 1), value: 0.1 + h / 100 }));
  const entities = [{ entity_id: 'sensor.nordpool_kwh_se3_eur', platform: 'nordpool', config_entry_id: 'ce_np', device_id: null }];
  const states = [{ entity_id: 'sensor.nordpool_kwh_se3_eur', state: '0.12', attributes: { friendly_name: 'Nord Pool SE3', unit: 'kWh', currency: 'EUR', price_in_cents: false, unit_of_measurement: 'EUR/kWh', raw_today: raw(24), raw_tomorrow: raw(25) } }];
  const core = detectPriceSources(entities, [], states, tz, { nordpool: { get_prices_for_date: {} } });
  check('Core Nord Pool: the action is offered', core.some((c) => c.type === 'action' && c.domain === 'nordpool'));
  check('Core Nord Pool: its sensor is not offered twice', !core.some((c) => c.type === 'attribute'));
  const hacs = detectPriceSources(entities, [], states, tz, { nordpool: { yearly: {} } });
  const attr = hacs.find((c) => c.type === 'attribute');
  check('HACS Nord Pool: no action without get_prices_for_date', !hacs.some((c) => c.type === 'action'));
  check('HACS Nord Pool: the raw_today/raw_tomorrow sensor is offered', !!attr && attr.entity_id === 'sensor.nordpool_kwh_se3_eur' && /raw_today/.test(attr.detail));
  check('HACS Nord Pool: VAT included by default, with a note', attr && attr.price_type === 'market_incl_vat' && /VAT/.test(attr.note || ''));
  check('Unknown services: the action is offered as before', detectPriceSources(entities, [], states, tz, null).some((c) => c.type === 'action'));
  check('HACS unit from currency and unit', unitHint(states[0].attributes) === 'EUR/kWh');
  check('HACS unit in cents', unitHint({ currency: 'EUR', unit: 'kWh', price_in_cents: true, unit_of_measurement: 'c/kWh' }) === 'EURct/kWh');
  check('HACS cents converted once', toPerKwh([{ price: 25 }], unitHint({ currency: 'EUR', unit: 'kWh', price_in_cents: true }), [], 'EUR')[0].price === 0.25);
  check('HACS MWh converted once', toPerKwh([{ price: 80 }], unitHint({ currency: 'SEK', unit: 'MWh' }), [], 'SEK')[0].price === 0.08);
  check('Other sensors keep their unit_of_measurement', unitHint({ unit_of_measurement: '€/kWh' }) === '€/kWh');
}

// Tibber homes and Nord Pool areas: the chosen one, never silently the first (#16).
(async () => {
  const ha = require(path.join(app, 'ha.js'));
  const { fetchPrices, localMidnight, isoLocal, localDate } = require(path.join(app, 'prices.js'));
  const t0 = localMidnight(tz, 0);
  const rows = (price, key) => Array.from({ length: 24 }, (_, h) => ({ [key]: isoLocal(t0 + h * 3600000, tz), ...(key === 'start' ? { end: isoLocal(t0 + (h + 1) * 3600000, tz) } : {}), price }));
  const original = ha.callAction;
  const quiet = [ha.debug, ha.warn];
  ha.debug = () => {}; ha.warn = () => {};
  const fails = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message) && !!e.choice; } };
  try {
    // Nord Pool answers per date: today's prices, and an empty answer for
    // tomorrow (not yet published).
    ha.callAction = async (domain, service, data) => (domain === 'tibber'
      ? { prices: { 'Home A': rows(0.2, 'start_time'), 'Home B': rows(0.4, 'start_time') } }
      : data.date === localDate(t0, tz) ? { SE3: rows(500, 'start'), SE4: rows(900, 'start') } : {});
    const tibber = { id: 'action:tibber:ce', type: 'action', domain: 'tibber', config_entry: 'ce' };
    const np = { id: 'action:nordpool:ce', type: 'action', domain: 'nordpool', config_entry: 'ce' };
    check('Tibber, two homes, none chosen: a clear error listing both', await fails(() => fetchPrices(tibber, tz), /Home A, Home B/));
    const b = await fetchPrices({ ...tibber, select: 'Home B' }, tz);
    check('Tibber, Home B chosen: its prices, not those of Home A', b.prices.length === 24 && b.prices.every((p) => p.price === 0.4) && b.choice.key === 'Home B' && b.choice.keys.length === 2);
    check('Tibber, the chosen home is gone: a clear error, no other home', await fails(() => fetchPrices({ ...tibber, select: 'Old home' }, tz), /Old home.*not in the answer/));
    const se4 = await fetchPrices({ ...np, select: 'SE4' }, tz);
    check('Nord Pool, area SE4 chosen: its prices (per MWh → per kWh)', se4.prices.length === 24 && se4.prices.every((p) => Math.abs(p.price - 0.9) < 1e-9) && se4.choice.label === 'Area');
    check('Nord Pool, two areas, none chosen: a clear error', await fails(() => fetchPrices(np, tz), /more than one area \(SE3, SE4\)/));
    ha.callAction = async () => ({ prices: { 'Only home': rows(0.3, 'start_time') } });
    const one = await fetchPrices(tibber, tz);
    check('Tibber, one home: used without choosing, as before', one.prices.length === 24 && one.choice.key === 'Only home');
  } finally {
    ha.callAction = original; [ha.debug, ha.warn] = quiet;
  }
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})();

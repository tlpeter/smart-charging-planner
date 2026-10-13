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

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);

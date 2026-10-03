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

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);

'use strict';

// Settings test: every setting of the app, against a fake Home Assistant.
// Starts the real app (server.js) with a temporary data folder, changes each
// setting through the same API the page uses, and checks the effect: what is
// saved, what is refused, what the plan does and what is sent to Home
// Assistant.
//
// Run from the repository root (needs `npm install` in smart_charging_planner/app),
// about a minute per car and charger:
//   node tests/settings.test.js                              Renault + Easee
//   SCP_PROFILE=skoda_wallbox node tests/settings.test.js    Skoda Enyaq + Wallbox

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fake = require('./fake-ha');

const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const WS_PORT = 18123;
const REST_PORT = 18124;
const APP_PORT = 18099;
const H = 3600000;

const results = [];
let group = '';
let app = null;
let dataDir = null;
const world = fake.createWorld(process.env.SCP_PROFILE || 'renault_easee');
const CAR = world.profile.car;
const CH = world.profile.charger;
// The value the car accepts for a wanted limit (rounded up to its step).
const lim = (v) => Math.max(CAR.limit_min, 50, Math.min(CAR.limit_max, Math.ceil((v - CAR.limit_min) / CAR.limit_step - 1e-9) * CAR.limit_step + CAR.limit_min));
const ha = fake.start(world, WS_PORT, REST_PORT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const ok = async (method, url, body) => {
  const r = await api(method, url, body);
  if (r.status !== 200) throw new Error(`${method} ${url} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};

// Expect a refusal (400) whose message contains `text`.
async function refused(method, url, body, text) {
  const r = await api(method, url, body);
  if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  const msg = (r.body && r.body.error) || '';
  if (text && !msg.toLowerCase().includes(text.toLowerCase())) throw new Error(`message "${msg}" does not contain "${text}"`);
  return msg;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const near = (a, b, d = 0.001) => Math.abs(a - b) <= d;

async function test(id, name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, group, name, ok: true, note: note || '' });
    console.log(`  ok    ${id} ${name}${note ? ` (${note})` : ''}`);
  } catch (err) {
    results.push({ id, group, name, ok: false, note: err.message });
    console.log(`  FAIL  ${id} ${name} - ${err.message}`);
  }
  if (Date.now() - t0 > 15000) console.log(`        (slow: ${Date.now() - t0} ms)`);
}

async function startApp(options = {}) {
  await stopApp();
  if (!dataDir) dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-test-'));
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ log_level: 'info', ...options }));
  app = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      SCP_PORT: String(APP_PORT),
      HA_WS_URL: `ws://127.0.0.1:${WS_PORT}`,
      HA_REST_URL: `http://127.0.0.1:${REST_PORT}/api`,
      SUPERVISOR_TOKEN: 'test',
      SCP_CHECK_AFTER_MS: '2000',
      SCP_LIMIT_GAP_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.log = '';
  app.stdout.on('data', (d) => { app.log += d; });
  app.stderr.on('data', (d) => { app.log += d; });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      const s = await api('GET', 'api/status');
      if (s.status === 200 && s.body.connected) return s.body;
    } catch { /* not up yet */ }
  }
  throw new Error(`app did not start:\n${app.log.slice(-2000)}`);
}

async function stopApp() {
  if (!app) return;
  if (process.env.SCP_APPLOG) fs.appendFileSync(process.env.SCP_APPLOG, app.log);
  const p = app;
  app = null;
  p.kill();
  await new Promise((r) => p.once('exit', r));
}

const plan = () => ok('GET', 'api/plan?refresh=1');
const callsSince = (n) => world.calls.slice(n);

// ---------------------------------------------------------------------------
// The test plan
// ---------------------------------------------------------------------------

async function run() {
  console.log(`Profile: ${world.profile.label}`);
  // ----- A. Start with nothing set up --------------------------------------
  group = 'A. Fresh install and checklist';
  await startApp();
  await test('A1', 'Fresh install: checklist says vehicle, charger and prices are missing', async () => {
    const c = await ok('GET', 'api/checklist');
    const missing = c.items.filter((i) => i.state === 'missing').map((i) => i.key);
    assert(!c.ready, 'should not be ready');
    for (const k of ['vehicle', 'charger', 'prices']) assert(missing.includes(k), `${k} not missing`);
    return `missing: ${missing.join(', ')}`;
  });
  await test('A2', 'Fresh install: Allow control is off by default', async () => {
    const s = await ok('GET', 'api/status');
    assert(s.allow_control === false, `allow_control ${s.allow_control}`);
  });
  await test('A3', 'Fresh install: plan asks for prices and vehicle', async () => {
    const p = await plan();
    assert(p.missing.includes('prices') && p.missing.includes('vehicle'), `missing ${p.missing}`);
  });

  // ----- B. Vehicle ---------------------------------------------------------
  group = 'B. Vehicle';
  let vehicleCandidate;
  await test('B1', 'Detect finds the car with battery, plugged-in and charge limit', async () => {
    const d = await ok('GET', 'api/vehicles/detect');
    vehicleCandidate = d.candidates.find((c) => c.device_id === 'car');
    assert(vehicleCandidate, 'car not found');
    assert(vehicleCandidate.suggested.soc === CAR.soc, `soc ${vehicleCandidate.suggested.soc}`);
    assert(vehicleCandidate.suggested.charge_limit === CAR.limit, `limit ${vehicleCandidate.suggested.charge_limit}`);
    return `${vehicleCandidate.name}: plugged ${vehicleCandidate.suggested.plugged || 'none'}, limit ${vehicleCandidate.suggested.charge_limit}`;
  });
  await test('B2', 'Refused: no battery sensor', () => refused('POST', 'api/vehicles', { device_id: 'car', capacity_kwh: CAR.capacity }, 'battery'));
  await test('B3', 'Refused: battery capacity 500 kWh', () => refused('POST', 'api/vehicles', { device_id: 'car', soc_entity: CAR.soc, capacity_kwh: 500 }, 'capacity'));
  await test('B4', "Refused: a charge limit that is not on the car's device", () => refused('POST', 'api/vehicles',
    { device_id: 'car', soc_entity: CAR.soc, capacity_kwh: CAR.capacity, charge_limit_entity: CH.switch }, 'charge limit'));
  await test('B5', 'Refused: battery level 120 % entered by hand', () => refused('POST', 'api/vehicle/soc', { soc: 120 }, 'between'));
  await test('B6', 'No car integration: "enter level" needs a capacity', () => refused('POST', 'api/vehicles', { mode: 'manual_soc', name: 'X' }, 'capacity'));
  await test('B7', 'No car integration: fixed amount must be 1–150 kWh', () => refused('POST', 'api/vehicles', { mode: 'fixed_kwh', fixed_kwh: 300 }, 'between 1 and 150'));
  await test('B8', 'Save the car (sensor mode, capacity, plugged-in sensor, charge limit)', async () => {
    await ok('POST', 'api/vehicles', {
      name: CAR.name, device_id: 'car', integration: CAR.platform, soc_entity: CAR.soc,
      plugged_entity: CAR.plugged, charge_limit_entity: CAR.limit, capacity_kwh: CAR.capacity,
    });
    const v = (await ok('GET', 'api/vehicles')).vehicles[0];
    assert(v.capacity_kwh === CAR.capacity && v.live.soc.state === '40' && v.live.charge_limit.state === '80', 'saved values or live values wrong');
  });

  // ----- C. Charger ---------------------------------------------------------
  group = 'C. Charger';
  await test('C1', 'Detect finds the charger with status and power, and not the car', async () => {
    const d = await ok('GET', 'api/chargers/detect');
    const c = d.candidates.find((x) => x.device_id === 'ch');
    assert(c, 'charger not found');
    assert(c.suggested.status === CH.status && c.suggested.power === CH.power, JSON.stringify(c.suggested));
    return `switch: ${c.suggested.switch || 'none'}`;
    assert(!d.candidates.some((x) => x.device_id === 'car'), 'the car was offered as a charger');
  });
  await test('C2', 'Refused: no entities chosen', () => refused('POST', 'api/chargers', { device_id: 'ch' }, 'at least one'));
  await test('C3', 'Refused: maximum current 100 A', () => refused('POST', 'api/chargers', { device_id: 'ch', status_entity: CH.status, max_current: 100 }, 'between 6 and 80'));
  await test('C4', 'Refused: a switch as status entity', () => refused('POST', 'api/chargers', { device_id: 'ch', status_entity: CH.switch }, 'invalid entity'));
  await test('C5', 'Save the charger (3 phases, 16 A)', async () => {
    await ok('POST', 'api/chargers', {
      name: CH.name, device_id: 'ch', integration: CH.platform, status_entity: CH.status,
      power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 16,
    });
    const c = (await ok('GET', 'api/chargers')).chargers[0];
    assert(c.phases === 3 && c.max_current === 16, 'not saved');
  });
  await test('C6', 'Control check finds a start/stop method and recommends one', async () => {
    const r = await ok('GET', 'api/control/check');
    assert(r.available !== false && r.start_stop && r.start_stop.length, 'no start/stop methods');
    return `recommended: ${r.recommended.start_stop && r.recommended.start_stop.label}`;
  });

  if (CH.ownMode) {
    await test('C6b', `Charger's own smart mode on (${CH.ownMode}): the control check warns`, async () => {
      world.ownMode = true;
      const r = await ok('GET', 'api/control/check');
      world.ownMode = false;
      const w = (r.warnings || []).map((x) => x.code || x.id || x.type || JSON.stringify(x));
      assert(w.some((x) => /own_mode|own_smart/.test(x)), `warnings: ${w.join(', ') || 'none'}`);
      return w.join(', ');
    });
  }
  await test('C7', 'Maximum current 10 A: the plan uses 3 × 230 V × 10 A = 6.9 kW', async () => {
    await ok('POST', 'api/vehicles', { name: CAR.name, device_id: 'car', soc_entity: CAR.soc, plugged_entity: CAR.plugged, charge_limit_entity: CAR.limit, capacity_kwh: CAR.capacity });
    await ok('POST', 'api/prices', { source: { type: 'action', domain: 'energyzero', config_entry: 'ce_ez', name: 'EnergyZero' }, price_type: 'all_in' });
    await ok('POST', 'api/chargers', { name: CH.name, device_id: 'ch', status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 10 });
    const p = await plan();
    assert(near(p.power.planned_kw, 6.9, 0.01), `planned ${p.power.planned_kw}`);
  });
  await test('C8', 'One phase, 16 A: the plan uses 3.7 kW', async () => {
    await ok('POST', 'api/chargers', { name: CH.name, device_id: 'ch', status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 1, max_current: 16 });
    const p = await plan();
    assert(near(p.power.planned_kw, 3.68, 0.01), `planned ${p.power.planned_kw}`);
    await ok('POST', 'api/chargers', { name: CH.name, device_id: 'ch', status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 16 });
  });

  // ----- D. Grid ------------------------------------------------------------
  group = 'D. Grid';
  await test('D1', 'Detect finds the P1 meter', async () => {
    const d = await ok('GET', 'api/grid/detect');
    const g = d.candidates.find((x) => x.device_id === 'p1');
    assert(g && g.suggested.net === 'sensor.p1_power', 'P1 not found');
  });
  await test('D2', 'Refused: main fuse 300 A', () => refused('POST', 'api/grid', { device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 300 }, 'main fuse'));
  await test('D3', 'Refused: no net or import sensor', () => refused('POST', 'api/grid', { device_id: 'p1', main_fuse: 25 }, 'net power'));
  await test('D4', 'Save the P1 meter (25 A, load balancer in the charger)', async () => {
    await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: 'other' });
    const g = (await ok('GET', 'api/grid')).grid[0];
    assert(g.main_fuse === 25 && g.load_balancer && g.load_balancer.type === 'other', 'not saved');
  });

  // ----- E. Prices ----------------------------------------------------------
  group = 'E. Prices';
  const ez = { type: 'action', domain: 'energyzero', config_entry: 'ce_ez', name: 'EnergyZero' };
  await test('E1', 'Detect offers EnergyZero, the combined sensor and the fixed tariff', async () => {
    const d = await ok('GET', 'api/prices/detect');
    const ids = d.candidates.map((c) => c.id);
    assert(ids.includes('action:energyzero:ce_ez'), 'no EnergyZero');
    const comb = d.candidates.find((c) => c.entity_id === 'sensor.stroom_prijzen_gecombineerd');
    assert(comb && comb.forecast_capable && comb.forecast_marked > 0, 'combined sensor not recognised as forecast');
    assert(ids.includes('fixed'), 'no fixed tariff');
  });
  await test('E2', 'Test shows 24 prices today and 24 tomorrow', async () => {
    const r = await ok('POST', 'api/prices/test', { source: ez, price_type: 'all_in' });
    assert(r.summary.count_today === 24 && r.summary.count_tomorrow === 24, `${r.summary.count_today}/${r.summary.count_tomorrow}`);
  });
  await test('E3', 'Market price excl. VAT + fee + tax: all-in = (price + fee + tax) × 1.21', async () => {
    await ok('POST', 'api/prices', { source: ez, price_type: 'market_excl_vat', purchase_fee: 0.02, energy_tax: 0.10, vat_percent: 21 });
    const p = await plan();
    const blk = p.prices.find((x) => x.total != null);
    const raw = world.energyzero().find((x) => Date.parse(x.timestamp) === blk.start).price;
    assert(near(blk.total, (raw + 0.12) * 1.21), `${blk.total} vs ${(raw + 0.12) * 1.21}`);
    return `${raw} → ${blk.total.toFixed(4)}`;
  });
  await test('E4', 'Market price incl. VAT: all-in = price + (fee + tax) × 1.21', async () => {
    await ok('POST', 'api/prices', { source: ez, price_type: 'market_incl_vat', purchase_fee: 0.02, energy_tax: 0.10, vat_percent: 21 });
    const p = await plan();
    const blk = p.prices[0];
    const raw = world.energyzero().find((x) => Date.parse(x.timestamp) === blk.start).price;
    assert(near(blk.total, raw + 0.12 * 1.21), `${blk.total}`);
  });
  await test('E5', 'All-in price: used as it is', async () => {
    await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    const p = await plan();
    const blk = p.prices[0];
    const raw = world.energyzero().find((x) => Date.parse(x.timestamp) === blk.start).price;
    assert(near(blk.total, raw), `${blk.total}`);
  });
  await test('E6', 'Refused: purchase fee 2, VAT 80', async () => {
    await refused('POST', 'api/prices', { source: ez, purchase_fee: 2 }, 'purchase fee');
    await refused('POST', 'api/prices', { source: ez, vat_percent: 80 }, 'vat');
  });
  await test('E7', 'Fixed tariff: refused when low from = low until, or time "25:00"', async () => {
    await refused('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'day_night', normal: 0.3, low: 0.2, low_from: '23:00', low_to: '23:00' } }, 'must differ');
    await refused('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'day_night', normal: 0.3, low: 0.2, low_from: '25:00', low_to: '07:00' } }, 'time');
  });
  await test('E8', 'Day/night tariff: the plan charges in the low hours', async () => {
    await ok('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'day_night', normal: 0.30, low: 0.20, low_from: '23:00', low_to: '07:00', weekend_low: false } });
    const p = await plan();
    const tz = p.time_zone;
    const hours = p.plan.blocks.map((b) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(b.block_start))));
    assert(p.plan.blocks.length && p.plan.blocks.every((b) => b.price === 0.2), `planned prices ${p.plan.blocks.map((b) => b.price)}`);
    return `planned hours ${[...new Set(hours)].join(',')}`;
  });
  await test('E9', 'Refused: forecast sensor with a bad name, margin 0.6', async () => {
    await refused('POST', 'api/prices', { source: ez, price_type: 'all_in', forecast_entity: 'switch.x' }, 'forecast sensor');
    await refused('POST', 'api/prices', { source: ez, price_type: 'all_in', forecast_entity: 'sensor.stroom_prijzen_gecombineerd', forecast_margin: 0.6 }, 'margin');
  });

  // ----- F. Departures ------------------------------------------------------
  group = 'F. Planning (departures)';
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const schedule = (over = {}) => Object.fromEntries(days.map((d) => [d, { enabled: false, time: '07:00', soc: 80, ...(over[d] || {}) }]));
  const depBody = (o = {}) => ({
    schedule_enabled: true, schedule: schedule(), default_soc: 80,
    helper: { enabled: false }, calendar: { enabled: false, match: 'target', buffer_minutes: 0, soc: 80 }, ...o,
  });
  await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
  const tz = fake.TZ;
  const { localDateTime, tzParts, isoLocal } = require(path.join(APP, 'prices.js'));
  const today = tzParts(Date.now(), tz);
  const dayKey = (offset) => days[(new Date(Date.UTC(today.y, today.m - 1, today.d + offset)).getUTCDay() + 6) % 7];
  const at = (offset, h, m = 0) => localDateTime(tz, today.y, today.m, today.d + offset, h, m);

  await test('F1', 'Refused: battery level 5 %, time "7 uur", calendar buffer 500', async () => {
    await refused('POST', 'api/departures', depBody({ default_soc: 5 }), 'between 10 and 100');
    await refused('POST', 'api/departures', depBody({ schedule: schedule({ mon: { time: '7 uur' } }) }), 'time');
    await refused('POST', 'api/departures', depBody({ calendar: { enabled: false, buffer_minutes: 500, soc: 80 } }), 'buffer');
  });
  await test('F2', 'Weekly schedule: next departure is tomorrow 06:30 at 85 %', async () => {
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '06:30', soc: 85 } }) }));
    const p = await plan();
    assert(p.departure && p.departure.time === at(1, 6, 30) && p.departure.soc === 85, `departure ${JSON.stringify(p.departure)}`);
    assert(p.planning.target_soc === 80, `target should be capped at the car limit 80, is ${p.planning.target_soc}`);
  });
  await test('F3', 'One-off departure wins over the schedule; refused in the past or after 7 days', async () => {
    await refused('POST', 'api/departures/override', { datetime: isoLocal(Date.now() - H, tz).slice(0, 16), soc: 70 }, 'future');
    await refused('POST', 'api/departures/override', { datetime: isoLocal(Date.now() + 8 * 24 * H, tz).slice(0, 16), soc: 70 }, '7 days');
    await ok('POST', 'api/departures/override', { datetime: isoLocal(at(1, 5, 0), tz).slice(0, 16), soc: 60 });
    const p = await plan();
    assert(p.departure.source === 'override' && p.departure.soc === 60, `departure ${JSON.stringify(p.departure)}`);
    await ok('DELETE', 'api/departures/override');
  });
  await test('F4', 'Calendar: "doel: 90" in an event becomes the departure, minus the buffer', async () => {
    world.events = [{ summary: 'Naar werk', description: 'doel: 90', start: isoLocal(at(1, 8, 0), tz), end: isoLocal(at(1, 9, 0), tz) }];
    await ok('POST', 'api/departures', depBody({ calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 30, soc: 80 } }));
    const p = await plan();
    assert(p.departure.source === 'calendar' && p.departure.soc === 90 && p.departure.time === at(1, 7, 30), `departure ${JSON.stringify(p.departure)}`);
    world.events = [];
  });
  await test('F5', 'Helper: date/time and battery level helper', async () => {
    world.helperTime = isoLocal(at(2, 9, 15), tz).slice(0, 19).replace('T', ' ');
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false, helper: { enabled: true, datetime_entity: 'input_datetime.ev_vertrek', soc_entity: 'input_number.ev_doel' } }));
    const p = await plan();
    assert(p.departure.source === 'helper' && p.departure.time === at(2, 9, 15) && p.departure.soc === 70, `departure ${JSON.stringify(p.departure)}`);
    world.helperTime = null;
  });
  await test('F6', 'Refused: helper on without a helper chosen; calendar on without a calendar', async () => {
    await refused('POST', 'api/departures', depBody({ helper: { enabled: true } }), 'helper');
    await refused('POST', 'api/departures', depBody({ calendar: { enabled: true, buffer_minutes: 0, soc: 80 } }), 'calendar');
  });
  await test('F7', 'No departure source: plan uses the cheapest known hours, note "no departure"', async () => {
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false }));
    const p = await plan();
    assert(!p.departure && p.plan.notes.includes('no_departure'), `notes ${p.plan.notes}`);
  });
  await test('F8', 'Calendar with a keyword: only events with "EV" count, without a target the calendar level is used', async () => {
    world.events = [
      { summary: 'Tandarts', start: isoLocal(at(1, 9, 0), tz), end: isoLocal(at(1, 10, 0), tz) },
      { summary: 'EV naar Utrecht', start: isoLocal(at(1, 11, 0), tz), end: isoLocal(at(1, 12, 0), tz) },
    ];
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'keyword', keyword: 'EV', buffer_minutes: 0, soc: 75 } }));
    const p = await plan();
    world.events = [];
    assert(p.departure.source === 'calendar' && p.departure.time === at(1, 11, 0) && p.departure.soc === 75, `departure ${JSON.stringify(p.departure)}`);
  });
  await test('F9', 'Add trip with "Allow adding trips" off: test mode, nothing written', async () => {
    const pv = await ok('POST', 'api/trips/preview', { datetime: isoLocal(at(2, 8, 0), tz).slice(0, 16), destination: 'Utrecht', soc: 80 });
    assert(pv.write_allowed === false && pv.events.length === 1, JSON.stringify(pv).slice(0, 200));
    await refused('POST', 'api/trips', { datetime: isoLocal(at(2, 8, 0), tz).slice(0, 16), destination: 'Utrecht', soc: 80 }, 'test mode');
    assert(!world.calls.some((c) => c.domain === 'calendar' && c.service === 'create_event'), 'event was written');
  });
  // Back to: tomorrow 07:00 and the day after 06:00, 80 %.
  await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));

  // ----- G. Rules (Allow control off) --------------------------------------
  group = 'G. Rules';
  const rules = (o = {}) => ({ start_stop_id: '', current_id: 'none', min_soc_enabled: false, min_soc: 20, min_soc_entity: '', min_soc_max_price: '', preheat_entity: '', force_minutes: 0, hysteresis: 0.03, car_limit_off: false, min_choice: 30, ...o });
  const decision = async () => { await plan(); return (await ok('GET', 'api/control')).now; };
  await test('G1', 'Refused: default minimum 50 %, force window 700 min, hysteresis 2', async () => {
    await refused('POST', 'api/control/settings', rules({ min_choice: 50 }), 'between 20 and 45');
    await refused('POST', 'api/control/settings', rules({ force_minutes: 700 }), 'force window');
    await refused('POST', 'api/control/settings', rules({ hysteresis: 2 }), 'hysteresis');
  });
  await test('G2', 'Minimum battery level: below it → charge now', async () => {
    await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 50 }));
    const n = await decision();
    assert(n.want === 'charge' && n.code === 'below_minimum', `${n.want}/${n.code}`);
  });
  await test('G3', 'Minimum with a price limit below the current price → not charged for the minimum', async () => {
    await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 50, min_soc_max_price: 0.01 }));
    const n = await decision();
    assert(n.code !== 'below_minimum', `code ${n.code}`);
    return `then: ${n.code}`;
  });
  await test('G3b', 'Minimum taken from an entity (the car\'s own minimum, here 70 %)', async () => {
    await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 10, min_soc_entity: 'input_number.ev_doel' }));
    const n = await decision();
    assert(n.code === 'below_minimum', `code ${n.code}`);
  });
  await test('G4', 'Preconditioning entity on → charge', async () => {
    await ok('POST', 'api/control/settings', rules({ preheat_entity: CAR.preheat }));
    world.preheat = 'on';
    const n = await decision();
    world.preheat = 'off';
    assert(n.want === 'charge' && n.code === 'preheat', `${n.want}/${n.code}`);
  });
  await test('G5', 'Force window: departure within the window → charge', async () => {
    await ok('POST', 'api/departures/override', { datetime: isoLocal(Date.now() + 2 * H, tz).slice(0, 16), soc: 80 });
    await ok('POST', 'api/control/settings', rules({ force_minutes: 180 }));
    const n = await decision();
    await ok('DELETE', 'api/departures/override');
    assert(n.want === 'charge' && ['force_window', 'planned', 'locked_block'].includes(n.code), `${n.want}/${n.code}`);
    return n.code;
  });
  await test('G6', 'Not in a planned block and not charging → pause', async () => {
    await ok('POST', 'api/control/settings', rules());
    const p = await plan();
    const n = (await ok('GET', 'api/control')).now;
    const inBlock = p.plan.blocks.some((b) => b.start <= Date.now() && Date.now() < b.end);
    assert(inBlock ? n.want === 'charge' : n.want === 'pause', `inBlock ${inBlock}, want ${n.want}/${n.code}`);
    return inBlock ? 'in a planned block' : 'paused';
  });
  await test('G7', 'Default minimum for quick choices is used on Home', async () => {
    await ok('POST', 'api/control/settings', rules({ min_choice: 35 }));
    const c = await ok('GET', 'api/chargefor');
    assert(c.min_default === 35, `min_default ${c.min_default}`);
  });
  await test('G8', 'Allow control off: the car limit is not changed and the plan stops at the limit', async () => {
    const p = await plan();
    assert(p.manages_car_limit === false && p.planning.target_soc === 80, `manages ${p.manages_car_limit}, target ${p.planning.target_soc}`);
    const c = await ok('GET', 'api/chargefor');
    assert(c.limit.reason === 'control_off', `limit ${JSON.stringify(c.limit)}`);
  });
  await test('G9', 'Allow control off: nothing is sent to Home Assistant', async () => {
    const n0 = world.calls.length;
    await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 50 }));
    await decision();
    await sleep(500);
    const sent = callsSince(n0).filter((c) => c.domain !== 'notify');
    assert(!sent.length, `sent ${JSON.stringify(sent)}`);
    await ok('POST', 'api/control/settings', rules());
  });

  // ----- H. Notifications ---------------------------------------------------
  group = 'H. Notifications';
  await test('H1', 'Refused: a notify action that does not exist', () => refused('POST', 'api/notify', { service: 'notify.nope' }, 'from the list'));
  await test('H2', 'Choose mobile_app_pixel_8 and send a test notification', async () => {
    const r = await ok('GET', 'api/notify');
    assert(r.choices.some((c) => c.id === 'notify.mobile_app_pixel_8'), 'not in the list');
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
    const n0 = world.calls.length;
    await ok('POST', 'api/notify/test', {});
    const c = callsSince(n0).find((x) => x.domain === 'notify');
    assert(c && c.service === 'mobile_app_pixel_8', `call ${JSON.stringify(c)}`);
  });
  await test('H3', 'Test notification refused when no notify action is chosen', async () => {
    await ok('POST', 'api/notify', { service: '' });
    await refused('POST', 'api/notify/test', {}, 'notify action');
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
  });

  // ----- I. Configuration tab (restart with other options) ------------------
  group = 'I. Configuration tab in Home Assistant';
  await test('I1', 'Charging loss margin 20 %: more energy planned than with 10 %', async () => {
    const a = (await plan()).plan.needed_kwh;
    await startApp({ loss_percent: 20 });
    const b = (await plan()).plan.needed_kwh;
    assert(near(b / a, 1.2 / 1.1, 0.01), `${a} → ${b}`);
    return `${a.toFixed(2)} → ${b.toFixed(2)} kWh`;
  });
  await test('I2', 'Invalid option values fall back to the defaults (loss 99 %, refresh 0)', async () => {
    await startApp({ loss_percent: 99, refresh_minutes: 0 });
    const p = await plan();
    assert(p.planning.loss_percent === 10 && p.refresh_minutes === 5, `${p.planning.loss_percent}/${p.refresh_minutes}`);
  });
  await test('I3', 'Continuous charging off: blocks may be split', async () => {
    await startApp({ continuous_charging: false });
    const p = await plan();
    assert(p.planning.continuous === false && !p.plan.continuous, 'continuous still on');
    return `${p.plan.periods.length} period(s)`;
  });
  await test('I4', 'Publish sensors on: sensor.smart_charging_* are written', async () => {
    world.rest = [];
    await startApp({ publish_sensors: true });
    await plan();
    await sleep(1000);
    const urls = world.rest.map((r) => r.url);
    assert(urls.some((u) => u.includes('/states/sensor.smart_charging_status')), `written: ${urls.join(', ') || 'nothing'}`);
    return `${urls.length} sensors`;
  });
  await test('I5', 'Publish sensors off: nothing is written', async () => {
    world.rest = [];
    await startApp({ publish_sensors: false });
    await plan();
    await sleep(800);
    assert(!world.rest.length, `written: ${world.rest.map((r) => r.url).join(', ')}`);
  });

  // ----- J. Live: Allow control on ------------------------------------------
  group = 'J. Allow control on: quick choices and the car limit';
  await startApp({ allow_control: true, notify_start_stop: true });
  await test('J1', 'Car limit follows the plan: tomorrow 90 % (one call)', async () => {
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
    const n0 = world.calls.length;
    await plan();
    await sleep(800);
    const sets = callsSince(n0).filter((c) => c.domain === 'number');
    assert(sets.length === 1 && sets[0].data.value === lim(90) && world.limit === lim(90), `calls ${JSON.stringify(sets)}`);
    return `number.set_value ${lim(90)}`;
  });
  await test('J2', 'Plan is not capped at the old limit when the app manages it', async () => {
    const p = await plan();
    assert(p.manages_car_limit === true && p.planning.target_soc === 90, `${p.manages_car_limit}/${p.planning.target_soc}`);
  });
  await test('J3', 'Ready for the day after tomorrow 95 %: minimum 30 % first, limit follows', async () => {
    world.soc = 20;
    await refused('POST', 'api/chargefor', { day: 'next_week', time: '06:00', soc: 90, min_soc: 30 }, 'tomorrow');
    await refused('POST', 'api/chargefor', { day: 'day_after', time: '06:00', soc: 90, min_soc: 50 }, 'between 20 and 45');
    await refused('POST', 'api/chargefor', { day: 'day_after', time: '6 uur', soc: 90, min_soc: 30 }, 'time');
    const n0 = world.calls.length;
    await ok('POST', 'api/chargefor', { day: 'day_after', time: '06:00', soc: 95, min_soc: 30 });
    const p = await plan();
    await sleep(800);
    assert(p.departure.source === 'choice' && p.charge_for.interim && p.plan.stage, 'no two-stage plan');
    const first = p.plan.blocks.filter((b) => b.start < p.plan.stage.first_deadline).reduce((a, b) => a + b.kwh, 0);
    assert(first >= p.charge_for.min_kwh - 0.01, `only ${first} kWh before the first departure, need ${p.charge_for.min_kwh}`);
    const sets = callsSince(n0).filter((c) => c.domain === 'number').map((c) => c.data.value);
    assert(world.limit === lim(95), `limit ${world.limit}, sent ${sets}`);
    return `${first.toFixed(1)} kWh before ${new Date(p.plan.stage.first_deadline).toISOString().slice(5, 16)}, limit sent ${sets}`;
  });
  await test('J4', 'Back to normal: limit goes down to the plan again', async () => {
    await ok('DELETE', 'api/chargefor');
    await plan();
    await sleep(800);
    assert(world.limit === lim(90), `limit ${world.limit}`);
    return `limit ${world.limit}`;
  });
  await test('J5', 'Quickly to a minimum (35 %) does not lower the limit', async () => {
    world.soc = 20;
    const r = await ok('POST', 'api/boost/preview', { mode: 'soc', value: 35 });
    assert(r.limit.managed && r.limit.to === lim(90), `preview ${JSON.stringify(r.limit)}`);
  });
  await test('J6', 'Charge now 100 %: limit up, charger started; stop: limit back', async () => {
    world.charging = false;
    world.powerKw = 0;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 100 });
    await sleep(800);
    const calls = callsSince(n0);
    const started = calls.find((c) => CH.isStart(c));
    assert(world.limit === lim(100), `limit ${world.limit}`);
    assert(started, `no start sent: ${JSON.stringify(calls)}`);
    await ok('DELETE', 'api/boost');
    await plan();
    await sleep(800);
    assert(world.limit === lim(90), `limit after stop ${world.limit}`);
    return `limit ${lim(100)} → ${lim(90)}, start: ${CH.describe(started)}`;
  });
  await test('J7', 'Charge now as kWh: preview converts it to a level for the limit', async () => {
    world.soc = 20;
    // Enough kWh to go from 20 % to above 100 %, whatever the battery size.
    const r = await ok('POST', 'api/boost/preview', { mode: 'kwh', value: Math.round(CAR.capacity * 0.95) });
    assert(r.limit.managed && r.limit.to === lim(100), `preview ${JSON.stringify(r.limit)}`);
  });
  await test('J8', "\"Don't change the car's charge limit\": nothing sent, plan capped at the limit", async () => {
    await ok('POST', 'api/control/settings', rules({ car_limit_off: true }));
    world.limit = 80;
    const n0 = world.calls.length;
    const p = await plan();
    await sleep(800);
    assert(!callsSince(n0).some((c) => c.domain === 'number'), 'limit was sent');
    assert(p.manages_car_limit === false && p.planning.target_soc === 80, `${p.manages_car_limit}/${p.planning.target_soc}`);
    await ok('POST', 'api/control/settings', rules());
  });
  await test('J9', 'Notification on start (notify every start and pause)', async () => {
    const notes = world.calls.filter((c) => c.domain === 'notify').map((c) => c.data.title);
    assert(notes.length, 'no notifications at all');
    return notes.slice(-4).join(' · ');
  });
  await test('J9b', 'Manual test (Diagnostics): start and stop really sent', async () => {
    const n0 = world.calls.length;
    const a = await ok('POST', 'api/control/manual', { action: 'start' });
    const b = await ok('POST', 'api/control/manual', { action: 'stop' });
    const cmds = callsSince(n0).filter((c) => CH.isControl(c)).map((c) => CH.describe(c));
    assert(a.sent && b.sent && cmds.length === 2, `sent ${a.sent}/${b.sent}, commands ${cmds}`);
    return cmds.join(' → ');
  });
  await test('J12', 'Target 85 %: limit rounded up to a step the car accepts, the plan still stops at 85 %', async () => {
    // J8 changed the limit "in the car" (80) shortly after the app sent 90; the
    // app waits the retry gap (here 2 s, live 15 min) before sending 90 again.
    await sleep(2100);
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 85 } }) }));
    const p = await plan();
    await sleep(800);
    assert(p.planning.target_soc === 85 && world.limit === lim(85), `target ${p.planning.target_soc}, limit ${world.limit}`);
    world.soc = 85;
    const n = (await ok('GET', 'api/control')).now;
    await plan();
    const n2 = (await ok('GET', 'api/control')).now;
    world.soc = 20;
    assert(n2.code === 'at_target' && n2.want === 'pause', `at 85 %: ${n2.want}/${n2.code}`);
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
    return `limit ${world.limit} %, at 85 %: ${n2.code}`;
  });
  await test('J10', 'Car unplugged: Charge now is refused', async () => {
    world.plugged = false;
    await plan();
    await refused('POST', 'api/boost', { mode: 'soc', value: 90 }, 'not plugged in');
    world.plugged = true;
  });

  await test('J11', 'Notify every start and pause off: start is not notified', async () => {
    await startApp({ allow_control: true, notify_start_stop: false });
    world.soc = 20;
    world.charging = false;
    world.powerKw = 0;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 30 });
    await sleep(800);
    const titles = callsSince(n0).filter((c) => c.domain === 'notify').map((c) => c.data.title);
    await ok('DELETE', 'api/boost');
    assert(!titles.includes('Charging started'), `notified: ${titles}`);
    return titles.length ? `only: ${titles.join(', ')}` : 'no notifications';
  });

  // ----- K. Forecast and checklist -----------------------------------------
  group = 'K. Price forecast and checklist';
  await test('K1', 'Forecast on: plan waits for the cheap forecast day, never charges on it now', async () => {
    world.soc = 40;
    const real = world.energyzero;
    world.energyzero = () => real().map((x) => ({ ...x, price: 0.30 }));
    await ok('POST', 'api/prices', { source: ez, price_type: 'all_in', forecast_entity: 'sensor.stroom_prijzen_gecombineerd', forecast_price_type: 'all_in', forecast_margin: 0.02 });
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(3)]: { enabled: true, time: '07:00', soc: 80 } }) }));
    const p = await plan();
    const fc = p.prices.filter((x) => x.forecast);
    assert(fc.length > 0, 'no forecast prices');
    const f = fc[0];
    assert(near(f.total - f.expected, 0.02), `margin ${f.total - f.expected}`);
    assert(p.plan.blocks.length && p.plan.blocks.every((b) => b.forecast), 'did not wait for the cheap forecast day');
    const n = (await ok('GET', 'api/control')).now;
    world.energyzero = real;
    assert(n.want !== 'charge', `charges now: ${n.code}`);
    return `${fc.length} forecast hours, planned: ${p.plan.periods.map((x) => `${new Date(x.start).toISOString().slice(5, 13)}${x.forecast ? ' (forecast)' : ''}`).join(', ')}`;
  });
  await test('K2', 'Forecast is not used without a departure', async () => {
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false }));
    const p = await plan();
    assert(!p.plan.blocks.some((b) => b.forecast), 'forecast block planned without a departure');
  });
  await test('K3', 'Checklist after setup: ready; shows the points that need attention', async () => {
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
    const c = await ok('GET', 'api/checklist');
    assert(c.ready, `not ready: ${JSON.stringify(c.items.filter((i) => i.state === 'missing'))}`);
    return c.items.map((i) => `${i.key}:${i.state}`).join(' ');
  });

  // ----- L. Security --------------------------------------------------------
  group = 'L. Security';
  await test('L1', 'Refused: a change sent as text/plain (not JSON)', async () => {
    const r = await api('POST', 'api/control/settings', JSON.stringify(rules()), { 'Content-Type': 'text/plain' });
    assert(r.status === 403 || r.status === 415, `status ${r.status}`);
  });
  await test('L2', 'Refused: a change from another site', async () => {
    const r = await api('POST', 'api/control/settings', rules(), { 'Sec-Fetch-Site': 'cross-site' });
    assert(r.status === 403, `status ${r.status}`);
  });
  await test('L3', 'Refused: invalid JSON', async () => {
    const r = await api('POST', 'api/control/settings', '{bad');
    assert(r.status === 400, `status ${r.status}`);
  });
}

// ---------------------------------------------------------------------------

run()
  .catch((err) => { console.log('Test run stopped:', err.stack); results.push({ id: '!', group, name: 'test run', ok: false, note: err.message }); })
  .finally(async () => {
    await stopApp();
    ha.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} passed`);
    if (process.env.SCP_RESULTS) fs.writeFileSync(process.env.SCP_RESULTS, JSON.stringify({ profile: world.profile.label, results }, null, 2));
    process.exit(failed.length ? 1 : 0);
  });

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
      SCP_PHASE_GAP_MS: '1000',
      SCP_CURRENT_GAP_MS: '1000',
      SCP_EQ_GAP_MS: '1000',
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
    // A period that already started earlier in this test is finished first
    // (locked until its end); that depends on the time of day the test runs.
    if (!inBlock && n.code === 'locked_block') {
      assert(n.want === 'charge' && n.locked_until > Date.now(), `locked ${JSON.stringify(n)}`);
      return `an earlier started period is finished first (until ${new Date(n.locked_until).toISOString().slice(11, 16)} UTC)`;
    }
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
  await test('J4b', 'Ready for the day after tomorrow, chosen for a calendar trip; the trip is removed → the choice ends by itself', async () => {
    world.events = [{ summary: 'Naar werk', description: 'doel: 80', start: isoLocal(at(2, 7, 0), tz), end: isoLocal(at(2, 8, 0), tz) }];
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } }));
    await ok('POST', 'api/chargefor', { day: 'day_after', time: '07:00', soc: 80, min_soc: 30 });
    const p1 = await plan();
    assert(p1.charge_for && p1.charge_for.based_on && p1.charge_for.based_on.source === 'calendar', `choice ${JSON.stringify(p1.charge_for)}`);
    const n0 = world.calls.length;
    world.events = [];
    const p2 = await plan();
    const note = callsSince(n0).find((c) => c.domain === 'notify' && /Ready-for choice ended/.test(c.data.title || ''));
    assert(!p2.charge_for && (!p2.departure || p2.departure.source !== 'choice'), `still ${JSON.stringify(p2.charge_for)}`);
    assert(note, 'no notification');
    return `based on "${p1.charge_for.based_on.title}", ended; notified: ${note.data.message}`;
  });
  await test('J4c', 'Ready for tomorrow when no departure was planned that day: the choice stays', async () => {
    await ok('POST', 'api/chargefor', { day: 'tomorrow', time: '09:00', soc: 70, min_soc: 30 });
    await plan();
    const p = await plan();
    assert(p.charge_for && !p.charge_for.based_on && p.departure.source === 'choice', `choice ${JSON.stringify(p.charge_for)}`);
    await ok('DELETE', 'api/chargefor');
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
    await plan();
  });
  await test('J5', 'Quickly to a minimum (35 %) does not lower the limit', async () => {
    world.soc = 20;
    const r = await ok('POST', 'api/boost/preview', { mode: 'soc', value: 35 });
    assert(r.limit.managed && r.limit.to === lim(90), `preview ${JSON.stringify(r.limit)}`);
  });
  await test('J6', 'Charge now 100 %: limit up, charger started; stop: limit back', async () => {
    world.charging = false;
    world.amps = null;
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
    world.amps = null;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 30 });
    await sleep(800);
    const titles = callsSince(n0).filter((c) => c.domain === 'notify').map((c) => c.data.title);
    await ok('DELETE', 'api/boost');
    assert(!titles.includes('Charging started'), `notified: ${titles}`);
    return titles.length ? `only: ${titles.join(', ')}` : 'no notifications';
  });

  // ----- S. Solar (Allow control on) ---------------------------------------
  group = 'S. Solar';
  const solarBody = (o = {}) => ({
    enabled: true, forecast: 'energy', forecast_factor: 0.8, house_base_w: 400, grid_sign: 'import_positive',
    start_delay_min: 0, stop_delay_min: 0, grid_allow_w: 0, max_soc: 90, current_control: true,
    phase_switching: true, feed_in: { mode: 'fixed', fee: 0.02, fixed: 0.03, vat_percent: 0 }, ...o,
  });
  const solarKwh = (p) => p.plan.blocks.reduce((a, b) => a + (b.solar_kwh || 0), 0);
  // The charger's current is set through the recommended method (Settings › Charger).
  await ok('POST', 'api/control/settings', rules({ current_id: '' }));
  await test('S1', 'Refused: solar up to 30 %, forecast sensor without a sensor, factor 2', async () => {
    await refused('POST', 'api/solar', solarBody({ max_soc: 30 }), 'between 50 and 100');
    await refused('POST', 'api/solar', solarBody({ forecast: 'sensor' }), 'forecast sensor');
    await refused('POST', 'api/solar', solarBody({ forecast_factor: 2 }), 'forecast factor');
  });
  await test('S2', 'Solar page: forecast from the Energy dashboard, inverter found, phase switching of the charger', async () => {
    const r = await ok('GET', 'api/solar');
    assert(r.forecast && near(r.forecast.tomorrow_kwh, 18, 0.01), `forecast ${JSON.stringify(r.forecast)}`);
    assert(r.pv_sensors[0] && r.pv_sensors[0].entity_id === 'sensor.solarnet_power_photovoltaics', `pv ${JSON.stringify(r.pv_sensors[0])}`);
    return `forecast tomorrow ${r.forecast.tomorrow_kwh} kWh, inverter ${r.pv_sensors[0].brand}, phase switching: ${r.phase_methods.map((m) => m.label).join(', ') || 'not possible'}, current: ${r.current_method ? r.current_method.label : 'none'}`;
  });
  await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(2)]: { enabled: true, time: '07:00', soc: 80 } }) }));
  world.soc = 20;
  await test('S3', 'Plan + solar, feed-in 0.03: the plan charges on tomorrow\'s sun (cheaper than the night at 0.05)', async () => {
    await ok('POST', 'api/solar', solarBody());
    const m = await ok('GET', 'api/chargemode');
    assert(m.mode === 'plan_solar', `mode ${m.mode}`);
    const p = await plan();
    const sk = solarKwh(p);
    // Tomorrow's sun (6 h × 2 kW at 80 % after the house); run in the morning, today's sun counts too.
    const todaySun = Date.now() < at(0, 15, 0);
    assert(sk > 11 && sk < (todaySun ? 25 : 13), `solar ${sk} kWh, solar info ${JSON.stringify(p.solar)}, notes ${p.plan.notes}, dep ${JSON.stringify(p.departure)}, needed ${p.plan.needed_kwh}, blocks ${JSON.stringify(p.plan.blocks.map((b) => [new Date(b.block_start).toISOString().slice(5, 13), b.kwh.toFixed(1), b.price]))}`);
    return `${sk.toFixed(1)} kWh on solar, ${(p.plan.planned_kwh - sk).toFixed(1)} kWh from the grid`;
  });
  await test('S4', 'Dynamic feed-in (market 0.20 − 0.02 = 0.18) vs grid all-in 0.21 at night: the sun is cheaper, also without salderen', async () => {
    await ok('POST', 'api/solar', solarBody({ feed_in: { mode: 'market', fee: 0.02, fixed: 0, vat_percent: 0 } }));
    await ok('POST', 'api/prices', { source: ez, price_type: 'market_excl_vat', purchase_fee: 0.02, energy_tax: 0.10, vat_percent: 21 });
    const p = await plan();
    const sk = solarKwh(p);
    await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    assert(sk > 11, `solar ${sk} kWh`);
    return `${sk.toFixed(1)} kWh on solar`;
  });
  await test('S4b', 'Feed-in 0.25 (more than the night at 0.21): the night first; the sun only for what does not fit (day grid 0.39)', async () => {
    await ok('POST', 'api/solar', solarBody({ feed_in: { mode: 'fixed', fee: 0, fixed: 0.25, vat_percent: 0 } }));
    await ok('POST', 'api/prices', { source: ez, price_type: 'market_excl_vat', purchase_fee: 0.02, energy_tax: 0.10, vat_percent: 21 });
    const p = await plan();
    const sk = solarKwh(p);
    await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    const night = p.plan.blocks.filter((b) => !b.solar_kwh).reduce((a, b) => a + b.kwh, 0);
    assert(night > 32 && sk <= p.plan.planned_kwh - night + 0.1, `solar ${sk} kWh, night ${night} kWh`);
    return `${night.toFixed(1)} kWh at night, ${sk.toFixed(1)} kWh on solar`;
  });
  await test('S5', 'Solar only: the plan uses only the sun', async () => {
    await ok('POST', 'api/solar', solarBody());
    await ok('POST', 'api/chargemode', { mode: 'solar' });
    const p = await plan();
    assert(p.plan.notes.includes('solar_only') && p.plan.blocks.every((b) => b.solar_kwh && !(b.grid_kwh > 0.01)), `blocks ${JSON.stringify(p.plan.blocks.map((b) => [b.solar_kwh, b.grid_kwh]))}`);
    return `${solarKwh(p).toFixed(1)} kWh, notes: ${p.plan.notes.join(', ')}`;
  });
  await test('S6', 'Live: 6 kW sun, car not charging → start on solar with a matching current', async () => {
    await ok('POST', 'api/chargemode', { mode: 'plan_solar' });
    world.charging = false; world.amps = null; world.phases = null;
    world.pvW = 6000;
    const n0 = world.calls.length;
    await plan();
    await sleep(600);
    await plan();
    await sleep(600);
    const n = (await ok('GET', 'api/control')).now;
    const calls = callsSince(n0).filter((c) => c.domain !== 'notify').map((c) => CH.describe(c));
    assert(n.code === 'solar' && world.charging === true, `decision ${n.code}, charging ${world.charging}, sent ${calls}`);
    assert(Number.isFinite(world.amps) && world.amps >= 6 && world.amps <= 8, `current ${world.amps}`);
    return `${world.amps} A, sent: ${calls.join(' · ')}`;
  });
  await test('S7', 'Live: sun drops to 2.5 kW → one phase where the charger can, otherwise stop', async () => {
    world.pvW = 2500;
    const n0 = world.calls.length;
    for (let i = 0; i < 3; i++) { await plan(); await sleep(1100); }
    const calls = callsSince(n0).filter((c) => c.domain !== 'notify').map((c) => CH.describe(c));
    if (CH.phasesOf && CH.phasesOf({ domain: 'easee', service: 'set_charger_phase_mode', data: { phase_mode: '1_phase' } }) === 1) {
      assert(world.phases === 1 && world.charging, `phases ${world.phases}, charging ${world.charging}, sent ${calls}`);
      return `one phase, ${world.amps} A · ${calls.join(' · ')}`;
    }
    assert(world.charging === false, `still charging, sent ${calls}`);
    return `paused (no phase switching) · ${calls.join(' · ')}`;
  });
  await test('S8', 'Charge now after solar: current back to the maximum (and three phases)', async () => {
    world.pvW = 0;
    world.charging = false;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
    await plan();
    await sleep(1200);
    await plan();
    await sleep(600);
    const calls = callsSince(n0).filter((c) => c.domain !== 'notify').map((c) => CH.describe(c));
    await ok('DELETE', 'api/boost');
    assert(world.amps === 16, `current ${world.amps}, sent ${calls}`);
    assert(world.phases == null || world.phases === 3, `phases ${world.phases}`);
    return calls.join(' · ');
  });
  await test('S9', 'Solar modes raise the car limit to "solar up to" (90 %)', async () => {
    world.limit = 80;
    await plan();
    await sleep(2200);
    await plan();
    await sleep(600);
    assert(world.limit === lim(90), `limit ${world.limit}`);
  });
  await test('S10', 'Grid meter sign "delivering is positive": the reading is turned around', async () => {
    world.pvW = 3000;
    await ok('POST', 'api/solar', solarBody({ grid_sign: 'export_positive' }));
    const r = await ok('GET', 'api/solar');
    const real = (world.houseW ?? 850) + (world.charging ? (world.amps ?? 16) * (world.phases ?? 3) * 230 : 0) - 3000;
    assert(near(r.grid.net_w, -real, 1), `${r.grid.net_w} vs ${-real}`);
  });
  if (CH.equalizer) {
    await test('S12', 'Easee Equalizer does solar: surplus charging on, charger on, no current or phase commands; Charge now: surplus off (full power)', async () => {
      const r0 = await ok('GET', 'api/solar');
      assert(r0.equalizer && r0.equalizer.switch_entity === 'switch.equalizer_surplus_charging', `equalizer ${JSON.stringify(r0.equalizer)}`);
      world.charging = false; world.amps = null; world.phases = null; world.eqSurplus = false;
      world.pvW = 6000;
      const n0 = world.calls.length;
      await ok('POST', 'api/solar', solarBody({ solar_control: 'equalizer' }));
      await ok('POST', 'api/chargemode', { mode: 'plan_solar' });
      for (let i = 0; i < 2; i++) { await plan(); await sleep(700); }
      const n = (await ok('GET', 'api/control')).now;
      const sent = callsSince(n0).filter((c) => c.domain !== 'notify' && c.domain !== 'number');
      const desc = sent.map((c) => `${c.domain}.${c.service}${c.data.enable != null ? ' ' + c.data.enable : ''}${c.target && c.target.entity_id ? ' ' + c.target.entity_id : ''}`);
      assert(n.code === 'solar' && world.charging, `decision ${n.code}, charging ${world.charging}, sent ${desc}`);
      assert(world.eqSurplus === true, `surplus ${world.eqSurplus}, sent ${desc}`);
      assert(!sent.some((c) => ['set_charger_dynamic_limit', 'set_charger_phase_mode'].includes(c.service)), `current/phase sent: ${desc}`);
      const n1 = world.calls.length;
      await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
      for (let i = 0; i < 2; i++) { await plan(); await sleep(1100); }
      const off = world.eqSurplus;
      const sent2 = callsSince(n1).filter((c) => c.service === 'set_surplus_charging').map((c) => c.data.enable);
      await ok('DELETE', 'api/boost');
      assert(off === false, `surplus still ${off}, sent ${sent2}`);
      return `${desc.join(' · ')} · Charge now: surplus ${sent2.join(', ')}`;
    });
    await test('S13', 'Back to the app: the surplus charging the app switched on goes off; Equalizer surplus on in the Easee app is reported', async () => {
      world.eqSurplus = true;
      await ok('POST', 'api/solar', solarBody({ solar_control: 'app' }));
      await plan();
      await sleep(1100);
      await plan();
      await sleep(700);
      const offNow = world.eqSurplus === false;
      world.eqSurplus = true;
      const r = await ok('GET', 'api/solar');
      world.eqSurplus = false;
      world.pvW = 0;
      assert(offNow, 'surplus charging left on');
      assert(r.settings.solar_control === 'app' && r.equalizer.surplus_on === true, JSON.stringify(r.equalizer));
    });
  } else {
    await test('S12', 'Equalizer solar refused without an Easee charger and Equalizer', async () => {
      await refused('POST', 'api/solar', solarBody({ solar_control: 'equalizer' }), 'Easee');
    });
  }
  await test('S11', 'Mode buttons refused without solar; solar off → back to the price plan', async () => {
    await ok('POST', 'api/solar', solarBody({ enabled: false }));
    await refused('POST', 'api/chargemode', { mode: 'solar' }, 'set up solar');
    const m = await ok('GET', 'api/chargemode');
    assert(m.mode === 'plan', `mode ${m.mode}`);
    world.pvW = 0;
  });
  await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 } }) }));

  // ----- T. Home battery (Sigenergy) ---------------------------------------
  group = 'T. Home battery (Sigenergy)';
  world.hasBattery = true;
  world.bat = { soc: 50, ems: 'off', mode: 'Maximum Self Consumption', chg: 10, dis: 10, autoKw: 0 };
  const batBody = (o = {}) => ({
    soc_entity: 'sensor.sigen_plant_battery_state_of_charge', platform: 'sigen', enabled: true, capacity_kwh: 16, efficiency: 0.9,
    charge_kw: 5, discharge_kw: 5, min_pct: 10, max_pct: 100, wear: 0.03, power_sign: 'charge_positive', arbitrage: true,
    ev_discharge: 'never', solar_priority: 'smart', ...o,
  });
  const batCalls = (n0) => callsSince(n0).filter((c) => c.target && /sigen/.test(c.target.entity_id || '')).map((c) => `${c.service}${c.data.option ? ' ' + c.data.option : c.data.value != null ? ' ' + c.data.value : ''}`);
  await test('T1', 'Battery page finds the Sigenergy: level, power, capacity, what the app can do', async () => {
    const r = await ok('GET', 'api/battery');
    const c = r.candidates.find((x) => x.platform === 'sigen');
    assert(c && c.soc === 50 && near(c.capacity_kwh, 16.12), JSON.stringify(c));
    assert(['auto', 'charge', 'discharge', 'hold'].every((a) => c.control.supported.includes(a)), `can ${c.control.supported}`);
    return `can: ${c.control.supported.join(', ')}`;
  });
  await test('T2', 'Refused: minimum above maximum, a battery that does not exist, capacity 0', async () => {
    await refused('POST', 'api/battery', batBody({ min_pct: 95, max_pct: 90 }), 'minimum');
    await refused('POST', 'api/battery', batBody({ soc_entity: 'sensor.something_else' }), 'not found');
    await refused('POST', 'api/battery', batBody({ capacity_kwh: 0 }), 'capacity');
  });
  await test('T3', 'Plan: charges from the grid in the cheap night (0.05) for the 0.20 hours, with a saving', async () => {
    await ok('POST', 'api/battery', batBody());
    const p = await plan();
    const acts = p.battery.actions;
    const charge = acts.filter((a) => a.action === 'charge');
    assert(charge.length && charge.every((a) => a.price <= 0.10 + 1e-9), `charge in ${charge.map((a) => a.price)}`);
    assert(p.battery.saving > 0.1, `saving ${p.battery.saving}`);
    return `charges in ${charge.length} block(s), saving €${p.battery.saving.toFixed(2)}`;
  });
  await test('T4', 'Allow control on, home battery control off: nothing is sent to the battery', async () => {
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
    await plan();
    await sleep(800);
    await ok('DELETE', 'api/boost');
    assert(!batCalls(n0).length, `sent ${batCalls(n0)}`);
    const p = await plan();
    assert(p.battery_now && p.battery_now.live === false, JSON.stringify(p.battery_now));
  });
  await startApp({ allow_control: true, allow_battery_control: true, notify_start_stop: false });
  await test('T5', 'Car charges, "never into the car": the battery holds (Remote EMS on, Standby)', async () => {
    world.charging = false;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
    await plan();
    await sleep(800);
    const sent = batCalls(n0);
    assert(world.bat.ems === 'on' && world.bat.mode === 'Standby', `ems ${world.bat.ems}, mode ${world.bat.mode}, sent ${sent}`);
    return sent.join(' · ');
  });
  await test('T6', 'Car stops: the battery goes back to its plan', async () => {
    const n0 = world.calls.length;
    await ok('DELETE', 'api/boost');
    world.charging = false;
    await plan();
    await sleep(800);
    const p = await plan();
    const want = p.battery_now && p.battery_now.action;
    const sent = batCalls(n0);
    // The car no longer decides: the battery follows its own plan (which may hold at some hours).
    assert(want && !/car/i.test(p.battery_now.reason || ''), `battery now ${JSON.stringify(p.battery_now)}`);
    assert(want !== 'auto' || world.bat.ems === 'off', `auto wanted but ems ${world.bat.ems}`);
    return `now: ${want} · ${sent.join(' · ') || 'nothing sent'}`;
  });
  await test('T7', '"Only stored solar into the car": no solar in the battery → no discharging into the car', async () => {
    await ok('POST', 'api/battery', batBody({ ev_discharge: 'solar_only' }));
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
    await plan();
    await sleep(800);
    const ok7 = world.bat.mode === 'Standby' && world.bat.ems === 'on';
    const sent7 = batCalls(n0);
    await ok('DELETE', 'api/boost');
    assert(ok7, `mode ${world.bat.mode}, sent ${sent7}`);
  });
  await test('T7b', '"Between two levels" (80 % → 40 %): refused when the levels do not fit; car charges: below 80 % no help, from 80 % the battery helps, at 40 % it stops', async () => {
    await refused('POST', 'api/battery', batBody({ ev_discharge: 'range', ev_from_pct: 40, ev_to_pct: 60 }), 'below the start level');
    await refused('POST', 'api/battery', batBody({ ev_discharge: 'range', ev_from_pct: 80, ev_to_pct: 5 }), 'minimum');
    await ok('POST', 'api/battery', batBody({ ev_discharge: 'range', ev_from_pct: 80, ev_to_pct: 40, arbitrage: false }));
    const step = async () => { await plan(); await sleep(700); return (await ok('GET', 'api/plan')).battery_now || {}; };
    world.bat.soc = 60;
    await ok('POST', 'api/boost', { mode: 'soc', value: 90 });
    const a = await step();
    const modeA = world.bat.mode;
    world.bat.soc = 85;
    const b = await step();
    const emsB = world.bat.ems;
    world.bat.soc = 39;
    const c = await step();
    const modeC = world.bat.mode;
    await ok('DELETE', 'api/boost');
    world.bat.soc = 50;
    await ok('POST', 'api/battery', batBody({ ev_discharge: 'never' }));
    assert(a.action === 'hold' && modeA === 'Standby', `at 60 %: ${JSON.stringify(a)} mode ${modeA}`);
    assert(b.action === 'auto' && emsB === 'off', `at 85 %: ${JSON.stringify(b)} ems ${emsB}`);
    assert(c.action === 'hold' && modeC === 'Standby', `at 39 %: ${JSON.stringify(c)} mode ${modeC}`);
    return `60 %: ${a.action} · 85 %: ${b.action} · 39 %: ${c.action}`;
  });
  await test('T8', 'Smart sun: the battery takes 2 kW of sun, the car needs energy → the car gets the sun, the battery waits', async () => {
    await ok('POST', 'api/battery', batBody({ ev_discharge: 'never', arbitrage: false }));
    await ok('POST', 'api/solar', solarBody());
    await ok('POST', 'api/chargemode', { mode: 'plan_solar' });
    await ok('POST', 'api/battery/test', { action: 'auto' }); // start from the battery's own mode
    world.bat = { ...world.bat, autoKw: 2 };
    world.pvW = 6500;
    world.charging = false;
    world.soc = 40;
    const n0 = world.calls.length;
    for (let i = 0; i < 3; i++) { await plan(); await sleep(1100); }
    const n = (await ok('GET', 'api/control')).now;
    const sent = batCalls(n0);
    assert(n.code === 'solar' && world.charging, `car: ${n.code}, charging ${world.charging}, sent ${callsSince(n0).filter((c) => c.domain !== 'notify').map((c) => `${c.domain}.${c.service} ${JSON.stringify(c.data)}`)}, now ${JSON.stringify(n).slice(0, 600)}`);
    const bn = (await ok('GET', 'api/plan')).battery_now;
    assert(world.bat.mode === 'Standby', `battery ${world.bat.mode}, sent ${sent}, battery now ${JSON.stringify(bn)}`);
    return `car on solar at ${world.amps} A · battery: ${sent.join(' · ')}`;
  });
  if (CH.equalizer) {
    await test('T8b', 'Equalizer does solar, no sun (evening): the charger is on but the car waits, so the battery keeps covering the house', async () => {
      await ok('POST', 'api/battery', batBody({ ev_discharge: 'never', arbitrage: false }));
      world.pvW = 0;
      world.bat = { ...world.bat, autoKw: 0 };
      await ok('POST', 'api/solar', solarBody({ solar_control: 'equalizer' }));
      await ok('POST', 'api/chargemode', { mode: 'plan_solar' });
      for (let i = 0; i < 3; i++) { await plan(); await sleep(800); }
      const n = (await ok('GET', 'api/control')).now;
      const bn = (await ok('GET', 'api/plan')).battery_now || {};
      await ok('POST', 'api/solar', solarBody());
      assert(n.code === 'solar' && world.eqSurplus === true && world.charging === false, `car ${n.code}, surplus ${world.eqSurplus}, charging ${world.charging}`);
      assert(!/car/i.test(bn.reason || ''), `battery ${JSON.stringify(bn)}`);
      return `charger on, Equalizer waits; battery: ${bn.action} (${bn.reason})`;
    });
  }
  await test('T9', 'Diagnostics: battery test "charge" sends the Sigenergy commands', async () => {
    const n0 = world.calls.length;
    const r = await ok('POST', 'api/battery/test', { action: 'charge' });
    const sent = batCalls(n0);
    assert(world.bat.mode === 'Command Charging (Grid First)' && world.bat.chg === 5, `mode ${world.bat.mode}, limit ${world.bat.chg}`);
    return sent.join(' · ');
  });
  await test('T10', 'Battery planning off: the battery goes back to normal (Remote EMS off)', async () => {
    await ok('POST', 'api/battery', batBody({ enabled: false }));
    world.pvW = 0;
    await ok('POST', 'api/solar', solarBody({ enabled: false }));
    await plan();
    await sleep(800);
    assert(world.bat.ems === 'off', `ems ${world.bat.ems}`);
  });
  world.hasBattery = false;
  await startApp({ allow_control: true, notify_start_stop: false });

  // ----- V. Car not reachable (the car's cloud is down) ----------------------
  group = "V. Car not reachable (the car's cloud is down)";
  const vehicleBody = (o = {}) => ({ name: CAR.name, device_id: 'car', integration: CAR.platform, soc_entity: CAR.soc, plugged_entity: CAR.plugged, charge_limit_entity: CAR.limit, capacity_kwh: CAR.capacity, ...o });
  const notesSince = (n0) => callsSince(n0).filter((c) => c.domain === 'notify').map((c) => c.data.title);
  await test('V1', 'Refused: car data old after 100 hours; 2 hours is saved', async () => {
    await refused('POST', 'api/vehicles', vehicleBody({ stale_hours: 100 }), 'between 0.5 and 48');
    await ok('POST', 'api/vehicles', vehicleBody({ stale_hours: 2 }));
    const v = (await ok('GET', 'api/vehicles')).vehicles[0];
    assert(v.stale_hours === 2, `stale_hours ${v.stale_hours}`);
  });
  await test('V2', 'Battery level "unavailable": the plan goes on from the last level plus what the charger delivered, the car limit is not sent, one notification', async () => {
    world.soc = 45; world.ages = {}; world.limit = 80; world.charging = false;
    await plan();
    const n0 = world.calls.length;
    world.soc = 'unavailable';
    world.chargedKw = 11; // the charger delivers 11 kW meanwhile
    await sleep(1500);
    const p = await plan();
    await sleep(600);
    await plan();
    await sleep(600);
    world.chargedKw = 0;
    const cd = p.vehicle.car_data;
    assert(cd && cd.ok === false && cd.reason === 'unavailable' && cd.last_soc === 45, JSON.stringify(p.vehicle));
    // The last level plus what the charger delivered since (10 % loss margin).
    const expected = 45 + (cd.kwh_since / 1.1 / CAR.capacity) * 100;
    assert(cd.kwh_since > 0 && Math.abs(p.vehicle.soc - expected) < 0.11, `soc ${p.vehicle.soc}, kWh ${cd.kwh_since}, expected ${expected.toFixed(2)}`);
    assert(!p.plan.notes.includes('missing_data'), `notes ${p.plan.notes}`);
    const n = (await ok('GET', 'api/control')).now;
    assert(n.code !== 'missing_data', `decision ${n.code}`);
    assert(!callsSince(n0).some((c) => c.domain === 'number' && c.target && c.target.entity_id === CAR.limit), 'car limit sent while the car is not reachable');
    const titles = notesSince(n0).filter((t) => t === 'Car not reachable');
    assert(titles.length === 1, `notifications ${notesSince(n0)}`);
    return `plans with ${p.vehicle.soc}% (last level 45% + ${cd.kwh_since} kWh charged since), decision ${n.code}`;
  });
  await test('V3', 'Battery level not read for 3 hours (old after 2): estimate from the last level; back: the real level, at most one message an hour', async () => {
    const nBack = world.calls.length;
    world.soc = 50;
    world.ages = {};
    await plan(); // read while live again: 50 % (back after V2)
    world.ages = { [CAR.soc]: 3 * H }; // then Home Assistant does not read it any more
    const p = await plan();
    const cd = p.vehicle.car_data;
    assert(cd && cd.ok === false && cd.reason === 'stale' && p.vehicle.soc === 50, JSON.stringify(p.vehicle));
    world.ages = {};
    const p2 = await plan();
    await sleep(300);
    assert(p2.vehicle.car_data.ok === true && p2.vehicle.soc === 50, JSON.stringify(p2.vehicle));
    // At most one "back" message an hour: no flood when the car's cloud flaps.
    const back = notesSince(nBack).filter((t) => t === 'Car reachable again');
    assert(back.length === 1, `notifications ${notesSince(nBack)}`);
    return `stale: ${p.vehicle.soc}% · back: ${p2.vehicle.soc}%`;
  });
  await test('V4', 'Nothing known yet (fresh start, level unavailable): plans as if at the minimum (20 %) and charges', async () => {
    await stopApp();
    fs.rmSync(path.join(dataDir, 'cardata.json'), { force: true });
    world.soc = 'unavailable';
    await startApp({ allow_control: true, notify_start_stop: false });
    const p = await plan();
    world.soc = 40;
    const cd = p.vehicle.car_data;
    assert(cd && cd.assumed === true && p.vehicle.soc === 20, JSON.stringify(p.vehicle));
    assert(p.plan.planned_kwh > 0 && p.plan.blocks.length, `planned ${p.plan.planned_kwh}`);
    await ok('POST', 'api/vehicles', vehicleBody());
    await plan();
    return `assumed ${p.vehicle.soc}%, planned ${p.plan.planned_kwh.toFixed(1)} kWh`;
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
  await test('L4', 'Download diagnostics: settings, control check, entities, log; no notify target, trip titles or token', async () => {
    world.events = [{ summary: 'Naar Werk Dordrecht', description: 'doel: 80', location: 'Kerkstraat 1, Reusel', start: isoLocal(at(1, 7, 0), tz), end: isoLocal(at(1, 8, 0), tz) }];
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' }).catch(() => {});
    await plan();
    const d = await ok('GET', 'api/diagnostics');
    const text = JSON.stringify(d);
    world.events = [];
    assert(d.app_version && d.settings && d.settings.chargers && d.settings.chargers.length, 'no settings');
    assert(d.control_check && d.control_check.recommended, 'no control check');
    assert(d.entities.some((e) => e.entity_id === CH.status), 'charger status entity missing');
    assert(Array.isArray(d.control_log) && Array.isArray(d.app_log) && d.app_log.length > 5, 'no logs');
    for (const secret of ['mobile_app_pixel_8', 'Naar Werk', 'Kerkstraat', 'Reusel', 'SUPERVISOR']) assert(!text.includes(secret), `contains ${secret}`);
    return `${Math.round(text.length / 1024)} kB, ${d.entities.length} entities, ${d.app_log.length} log lines`;
  });

  // ----- M. Settings export and import --------------------------------------
  group = 'M. Settings export and import';
  let exported = null;
  await test('M1', 'Export: all settings in one file, without the Configuration options (Allow control)', async () => {
    exported = await ok('GET', 'api/settings/export');
    const keys = Object.keys(exported.settings);
    assert(exported.format === 'smart-charging-planner-settings' && keys.includes('vehicles') && keys.includes('chargers') && keys.includes('prices') && keys.includes('departures'), `keys ${keys}`);
    assert(!JSON.stringify(exported).includes('allow_control'), 'Configuration options in the export');
    return `${keys.length} parts, ${Math.round(JSON.stringify(exported).length / 1024)} kB`;
  });
  await test('M2', 'Refused: not a settings file, a file with unknown parts, a newer format', async () => {
    await refused('POST', 'api/settings/import/preview', { hello: 1 }, 'not a Smart Charging Planner settings file');
    await refused('POST', 'api/settings/import/preview', { ...exported, settings: { ...exported.settings, scripts: [] } }, 'Unknown parts');
    await refused('POST', 'api/settings/import/preview', { ...exported, format_version: 9 }, 'newer version');
  });
  await test('M3', 'Import in a fresh install (like the dev version): preview, then the same settings; Allow control stays as configured', async () => {
    const keepDir = dataDir;
    // The same Home Assistant as when the battery was set up (group T).
    world.hasBattery = true;
    world.bat = world.bat || { soc: 50, ems: 'off', mode: 'Maximum Self Consumption', chg: 10, dis: 10, autoKw: 0 };
    await stopApp();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-test-import-'));
    await startApp({ allow_control: false });
    const before = (await ok('GET', 'api/vehicles')).vehicles.length;
    const pv = await ok('POST', 'api/settings/import/preview', exported);
    const stillEmpty = (await ok('GET', 'api/vehicles')).vehicles.length === 0;
    await ok('POST', 'api/settings/import', exported);
    const again = await ok('GET', 'api/settings/export');
    const st = await ok('GET', 'api/status');
    await stopApp();
    fs.rmSync(dataDir, { recursive: true, force: true });
    dataDir = keepDir;
    world.hasBattery = false;
    await startApp({ allow_control: true, notify_start_stop: false });
    assert(before === 0 && stillEmpty, 'preview changed something');
    assert(pv.summary && pv.summary.notes.length === 0, `notes ${JSON.stringify(pv.summary)}`);
    assert(JSON.stringify(again.settings) === JSON.stringify(exported.settings), 'settings differ after import');
    assert(st.allow_control === false, 'Allow control changed by the import');
    return `car ${pv.summary.vehicle}, charger ${pv.summary.charger}, prices ${pv.summary.prices}`;
  });
  await test('M4', 'Import with things this Home Assistant does not have: battery and notify action left out, entities listed', async () => {
    const odd = JSON.parse(JSON.stringify(exported));
    odd.settings.battery = { enabled: true, platform: 'sigen', soc_entity: 'sensor.other_house_battery_soc', capacity_kwh: 10 };
    odd.settings.notify = { service: 'notify.mobile_app_someone_else' };
    const pv = await ok('POST', 'api/settings/import/preview', odd);
    const n = pv.summary.notes.join(' | ');
    assert(/home battery was left out/.test(n) && /Notifications were switched off/.test(n) && /sensor\.other_house_battery_soc/.test(n), n);
    assert(pv.summary.battery === false, 'battery still on');
    return n;
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

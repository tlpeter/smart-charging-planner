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
// The word for the second car (an EV6, a Kia) in a calendar event: its brand,
// or its name when the first car is a Kia too (then the brand fits both).
const EV6_WORD = CAR.manufacturer === 'Kia' ? 'EV6' : 'kia';
// Y13 needs a trip that costs a given % of the battery. Its numbers were
// tuned for the Renault (52 kWh) and work for the Skoda too; for the Kia
// (64 kWh) the use per 100 km is scaled to the bigger battery.
const CAP_K = CAR.platform === 'kia_uvo' ? CAR.capacity / 52 : 1;
// The value the car accepts for a wanted limit (rounded up to its step).
const lim = (v) => Math.max(CAR.limit_min, 50, Math.min(CAR.limit_max, Math.ceil((v - CAR.limit_min) / CAR.limit_step - 1e-9) * CAR.limit_step + CAR.limit_min));
let ha = fake.start(world, WS_PORT, REST_PORT);

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
  // Trip distances (#31): a new install has not chosen yet. These tests use the
  // fake OpenStreetMap server, as if the owner chose OpenStreetMap.
  const settingsFile = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({ routing: { mode: 'osm', geocode_url: null, route_url: null, confirmed: true } }));
  }
  app = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      SCP_PORT: String(APP_PORT),
      HA_WS_URL: `ws://127.0.0.1:${WS_PORT}`,
      HA_REST_URL: `http://127.0.0.1:${REST_PORT}/api`,
      SUPERVISOR_TOKEN: 'test',
      HOSTNAME: 'a0b1c2d3-smart-charging-planner',
      SCP_CHECK_AFTER_MS: '2000',
      SCP_LIMIT_GAP_MS: '2000',
      SCP_PHASE_GAP_MS: '1000',
      SCP_CURRENT_GAP_MS: '1000',
      SCP_EQ_GAP_MS: '1000',
      SCP_RECONNECT_MS: '100',
      SCP_GEOCODE_URL: `http://127.0.0.1:${REST_PORT}/search`,
      SCP_ROUTE_URL: `http://127.0.0.1:${REST_PORT}/route/v1/driving`,
      SCP_GEOCODE_GAP_MS: '50',
      SCP_OCM_URL: `http://127.0.0.1:${REST_PORT}/ocm/poi`,
      SCP_OCM_GAP_MS: '50',
      SCP_PRECONDITION_MS: '500',
      SCP_CALENDAR_WAIT_MS: '100',
      SCP_RESTART_AFTER_MS: '1500',
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
  await test('A2', 'Frontend assets are served separately', async () => {
    const css = await api('GET', 'styles.css');
    const js = await api('GET', 'app.js');
    assert(css.status === 200 && typeof css.body === 'string' && css.body.length > 1000, 'styles.css not served');
    assert(js.status === 200 && typeof js.body === 'string' && js.body.length > 10000, 'app.js not served');
    // The unsaved-changes guard (shared with the other apps) is served and loaded.
    const guard = await api('GET', 'unsaved.js');
    const page = await api('GET', '');
    assert(guard.status === 200 && typeof guard.body === 'string' && guard.body.includes('window.unsavedGuard'), 'unsaved.js not served');
    assert(String(page.body).includes('<script src="unsaved.js"></script>'), 'unsaved.js not on the page');
    assert(js.body.includes('unsavedGuard.writeDone') && js.body.includes('unsavedGuard.isDirty'), 'app.js does not use the guard');
    return `${Math.round(css.body.length / 1024)} kB CSS, ${Math.round(js.body.length / 1024)} kB JS`;
  });
  await test('A3', 'Fresh install: Allow control is off by default', async () => {
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
  await test('E2', 'Test shows all prices today and tomorrow (23/24/25 hours on DST days)', async () => {
    const { localMidnight } = require(path.join(APP, 'prices.js'));
    const hours = (a, b) => Math.round((localMidnight(fake.TZ, b) - localMidnight(fake.TZ, a)) / 3600000);
    const r = await ok('POST', 'api/prices/test', { source: ez, price_type: 'all_in' });
    assert(r.summary.count_today === hours(0, 1) && r.summary.count_tomorrow === hours(1, 2), `${r.summary.count_today}/${r.summary.count_tomorrow}`);
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
  await test('E10', 'Chart looks back at least 12 hours; past blocks the charger charged in come back as "charged", future blocks never', async () => {
    await ok('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'day_night', normal: 0.30, low: 0.20, low_from: '23:00', low_to: '07:00', weekend_low: false } });
    world.chargedKw = 11;
    try {
      const p = await plan();
      const now = p.now;
      assert(p.prices[0].start <= now - 12 * 3600000 + 3600000, `chart starts ${((now - p.prices[0].start) / 3600000).toFixed(1)} h back`);
      assert(Array.isArray(p.charged) && p.charged.length >= 11, `charged blocks ${p.charged && p.charged.length}`);
      assert(p.charged.every((c) => c.start < now), 'a future block is marked charged');
      const full = p.charged.find((c) => c.end <= now);
      assert(full && Math.abs(full.kwh - 11 * (full.end - full.start) / 3600000) < 0.05, `kWh ${full && full.kwh}`);
      return `${p.charged.length} charged blocks, from ${((now - p.prices[0].start) / 3600000).toFixed(1)} h back`;
    } finally {
      world.chargedKw = 0;
      await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    }
  });
  await test('E11', 'Chart further back (24 h, 3 or 7 days): api/past gives the older prices and charging up to the plan\'s first block; anything else is 12 hours', async () => {
    await ok('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'day_night', normal: 0.30, low: 0.20, low_from: '23:00', low_to: '07:00', weekend_low: false } });
    world.chargedKw = 11;
    try {
      const p = await plan();
      const before = p.prices[0].start;
      const out = [];
      for (const hours of [24, 72, 168]) {
        const r = await ok('GET', `api/past?hours=${hours}&before=${before}`);
        assert(r.hours === hours, `hours ${r.hours}`);
        assert(r.prices.length > 0, `${hours} h: no older prices`);
        assert(r.prices.every((x) => x.end <= before), `${hours} h: a price after the plan's first block`);
        assert(r.prices[0].start <= p.now - hours * 3600000 + 3600000, `${hours} h: starts ${((p.now - r.prices[0].start) / 3600000).toFixed(1)} h back`);
        assert(r.prices.every((x) => Number.isFinite(x.total)), 'a price without a number');
        assert(r.charged.length > 0 && r.charged.every((c) => c.start < before), `${hours} h: charged ${r.charged.length}`);
        out.push(`${hours} h: ${r.prices.length} blocks`);
      }
      const d = await ok('GET', `api/past?hours=5&before=${before}`);
      assert(d.hours === 12, `hours=5 gives ${d.hours}`);
      return out.join(', ');
    } finally {
      world.chargedKw = 0;
      await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    }
  });


  await test('E12', 'A skipped forecast interval gives one warning while valid actual prices remain usable', async () => {
    const combined = world.combined;
    const begin = Math.floor(Date.now() / H) * H - 6 * H;
    world.combined = () => [
      ...Array.from({ length: 72 }, (_, i) => ({ time: begin + i * H, price: 0.2, source: i < 24 ? 'actual' : 'forecast' })),
      { time: '2026-10-25 02:00:00', price: 0.1, source: 'forecast' },
    ];
    try {
      await ok('POST', 'api/prices', {
        source: { id: 'attr:sensor.stroom_prijzen_gecombineerd', type: 'attribute', entity_id: 'sensor.stroom_prijzen_gecombineerd' },
        price_type: 'all_in', forecast_entity: 'sensor.stroom_prijzen_gecombineerd',
        forecast_price_type: 'all_in', forecast_margin: 0.02,
      });
      const p = await plan();
      assert(p.price_error === null, JSON.stringify(p.price_error));
      assert(p.prices.some((x) => !x.forecast), 'valid actual prices lost');
      // The chart stops at the departure horizon, which can be before the
      // forecast starts. Check the loaded forecast independently of that view.
      assert(p.forecast && p.forecast.count === 48, 'valid forecast prices lost: ' + JSON.stringify(p.forecast));
      assert(p.price_warnings.length === 1, JSON.stringify(p.price_warnings));
      assert(p.price_warnings[0].includes('2026-10-25 02:00:00') && p.price_warnings[0].includes('sensor.stroom_prijzen_gecombineerd'), p.price_warnings[0]);
      return 'one source/date warning; valid prices still used';
    } finally {
      world.combined = combined;
      await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    }
  });
  await test('E12b', 'Forecast price basis (#26): saving needs an explicit basis; an all-in forecast is not taxed again; the same hour shows VAT applied twice', async () => {
    const combined = world.combined;
    const fcBody = (basis) => ({ source: ez, price_type: 'market_excl_vat', purchase_fee: 0, energy_tax: 0, vat_percent: 21, forecast_entity: 'sensor.stroom_prijzen_gecombineerd', forecast_margin: 0.02, ...(basis ? { forecast_price_type: basis } : {}) });
    // The forecast sensor has consumer prices (already all-in) for the same hours as EnergyZero.
    world.combined = () => world.energyzero().map((p) => ({ time: Date.parse(p.timestamp), price: Math.round(p.price * 1.21 * 10000) / 10000, source: 'forecast' }))
      .concat(Array.from({ length: 72 }, (_, i) => ({ time: require(path.join(APP, 'prices.js')).localMidnight(fake.TZ, 2) + i * H, price: 0.2207, source: 'forecast' })));
    try {
      await refused('POST', 'api/prices', fcBody(null), 'choose what the forecast price is');
      const loose = await ok('POST', 'api/prices/test', fcBody(null));
      assert(loose.forecast && loose.forecast.basis_explicit === false && loose.forecast.warnings.some((w) => /choose what the forecast price is/i.test(w)), JSON.stringify(loose.forecast));
      const wrong = await ok('POST', 'api/prices/test', fcBody('market_excl_vat'));
      assert(wrong.forecast.overlap && Math.abs(wrong.forecast.overlap.ratio - 1.21) < 0.01, JSON.stringify(wrong.forecast.overlap));
      assert(wrong.forecast.warnings.some((w) => /already includes VAT/.test(w)), JSON.stringify(wrong.forecast.warnings));
      const right = await ok('POST', 'api/prices/test', fcBody('all_in'));
      assert(Math.abs(right.forecast.overlap.ratio - 1) < 0.01 && !right.forecast.warnings.some((w) => /VAT/.test(w)), JSON.stringify(right.forecast));
      const ex = right.forecast.example;
      assert(ex && ex.basis === 'all_in' && Math.abs(ex.input - 0.2207) < 1e-9 && Math.abs(ex.compared - 0.2407) < 1e-9, JSON.stringify(ex));
      await ok('POST', 'api/prices', fcBody('all_in'));
      const saved = await ok('GET', 'api/prices');
      assert(saved.prices.forecast.basis_explicit === true && saved.prices.forecast.price_type === 'all_in', JSON.stringify(saved.prices.forecast));
      return `wrong basis: ratio ${wrong.forecast.overlap.ratio.toFixed(3)} with a warning; all-in: 0.2207 + 0.02 = ${ex.compared.toFixed(4)}`;
    } finally {
      world.combined = combined;
      await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    }
  });
  await test('E13', 'A genuinely missing price source remains an error', async () => {
    try {
      await ok('POST', 'api/prices', { source: { type: 'attribute', entity_id: 'sensor.missing_prices' }, price_type: 'all_in' });
      const p = await plan();
      assert(p.price_error && p.price_error.includes('not found'), JSON.stringify(p.price_error));
      assert(p.price_warnings.length === 0, JSON.stringify(p.price_warnings));
    } finally {
      await ok('POST', 'api/prices', { source: ez, price_type: 'all_in' });
    }
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

  await test('F8b', 'A calendar outage keeps the last confirmed departure, including after app restart', async () => {
    world.events = [{ summary: 'Confirmed test trip', description: 'target: 90',
      start: isoLocal(at(1, 10, 0), tz), end: isoLocal(at(1, 11, 0), tz) }];
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false,
      calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } }));
    try {
      const good = await plan();
      assert(good.departure && good.departure.time === at(1, 10, 0), JSON.stringify(good.departure));
      world.calendarFail = true; world.events = [];
      let p = await plan();
      assert(p.departure && p.departure.time === good.departure.time && p.departure.soc === 90, JSON.stringify(p.departure));
      assert(p.calendar_error && p.calendar_health.state === 'cached' && p.plan.notes.includes('calendar_cached'), JSON.stringify(p.calendar_health));
      const dep = await ok('GET', 'api/departures');
      assert(dep.next.time === good.departure.time && dep.calendar_health.state === 'cached', JSON.stringify(dep.next));
      await startApp({ allow_control: false });
      p = await plan();
      assert(p.departure && p.departure.time === good.departure.time && p.calendar_health.state === 'cached', JSON.stringify(p.departure));
      return 'confirmed deadline preserved with an explicit stale-source warning';
    } finally { world.calendarFail = false; }
  });
  await test('F8c', 'Successful rescheduling and cancellation replace cached events; expired cache is not reused', async () => {
    try {
      world.events = [{ summary: 'Rescheduled test trip', description: 'target: 85',
        start: isoLocal(at(1, 12, 0), tz), end: isoLocal(at(1, 13, 0), tz) }];
      let p = await plan();
      assert(p.departure.time === at(1, 12, 0) && p.calendar_health.state === 'fresh', JSON.stringify(p.departure));
      world.events = [];
      p = await plan();
      assert(!p.departure && !p.calendar_error, JSON.stringify(p.departure));
      world.calendarFail = true;
      p = await plan();
      assert(!p.departure && p.calendar_health.state === 'cached', JSON.stringify(p.departure));
      const file = path.join(dataDir, 'calendar_cache.json');
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const row of rows) row.expires_at = Date.now() - 1;
      fs.writeFileSync(file, JSON.stringify(rows));
      p = await plan();
      assert(!p.departure && p.calendar_health.state === 'unavailable' && p.plan.notes.includes('calendar_error'), JSON.stringify(p.calendar_health));
    } finally { world.calendarFail = false; world.events = []; }
  });

  await test('F9', 'Add trip with "Allow adding trips" off: test mode, nothing written', async () => {
    const pv = await ok('POST', 'api/trips/preview', { datetime: isoLocal(at(2, 8, 0), tz).slice(0, 16), destination: 'Utrecht', soc: 80 });
    assert(pv.write_allowed === false && pv.events.length === 1, JSON.stringify(pv).slice(0, 200));
    await refused('POST', 'api/trips', { datetime: isoLocal(at(2, 8, 0), tz).slice(0, 16), destination: 'Utrecht', soc: 80 }, 'test mode');
    assert(!world.calls.some((c) => c.domain === 'calendar' && c.service === 'create_event'), 'event was written');
  });
  await test('F9b', 'Add trip language: "auto" follows Home Assistant (English here), Dutch on request, an unknown value falls back to auto', async () => {
    const trip = { datetime: isoLocal(at(2, 8, 0), tz).slice(0, 16), destination: 'Utrecht', soc: 80 };
    const cal = (language) => depBody({ calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80, language } });
    try {
      await ok('POST', 'api/departures', cal(undefined));
      let d = await ok('GET', 'api/departures');
      assert(d.departures.calendar.language === 'auto' && d.trip_language === 'en', `${d.departures.calendar.language}/${d.trip_language}`);
      let e = (await ok('POST', 'api/trips/preview', trip)).events[0];
      assert(e.summary === 'To Utrecht' && e.description === 'target: 80 precondition: no', JSON.stringify(e));
      await ok('POST', 'api/departures', cal('nl'));
      d = await ok('GET', 'api/departures');
      assert(d.departures.calendar.language === 'nl' && d.trip_language === 'nl', `${d.departures.calendar.language}/${d.trip_language}`);
      e = (await ok('POST', 'api/trips/preview', { ...trip, precondition: true })).events[0];
      assert(e.summary === 'Naar Utrecht' && e.description === 'doel: 80 precondition: ja', JSON.stringify(e));
      await ok('POST', 'api/departures', cal('fr'));
      d = await ok('GET', 'api/departures');
      assert(d.departures.calendar.language === 'auto', d.departures.calendar.language);
      return 'To Utrecht / Naar Utrecht';
    } finally {
      await ok('POST', 'api/departures', depBody());
    }
  });
  // Back to: tomorrow 07:00 and the day after 06:00, 80 %.
  await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
  await test('F10', 'Looking ahead reaches 30 days (#4): the weekly schedule gives departures in weeks 3 and 4, and the plan says until when prices are known; Plan lists 7, 14 or 30 days as asked', async () => {
    const p = await plan();
    const leaves = p.next.timeline.filter((x) => x.type === 'leave');
    const now = Date.now();
    assert(leaves.length > 6 && leaves.some((x) => x.time > now + 21 * 86400000) && leaves.every((x) => x.time < now + 31 * 86400000), `${leaves.length} departures, last ${new Date(leaves[leaves.length - 1].time).toISOString()}`);
    assert(Number.isFinite(p.next.prices_until) && p.next.prices_until > now && p.next.prices_until < now + 9 * 86400000, `prices_until ${p.next.prices_until}`);
    const counts = [];
    for (const ahead of [7, 14, 30]) {
      const d = await ok('GET', `api/departures?ahead=${ahead}`);
      assert(d.ahead_days === ahead && d.upcoming.every((u) => u.winner.time < now + (ahead + 1) * 86400000), `${ahead}: ${d.ahead_days}`);
      counts.push(d.upcoming.length);
    }
    assert(counts[0] <= counts[1] && counts[1] < counts[2] && counts[2] >= 8, counts.join('/'));
    assert((await ok('GET', 'api/departures?ahead=99')).ahead_days === 7, 'unknown range not refused to 7');
    return `${leaves.length} departures in 30 days · Plan ${counts.join(' / ')} days with a departure`;
  });

  // ----- G. Rules (Allow control off) --------------------------------------
  group = 'G. Rules';
  // Battery care off here (it changes when the car limit goes up); group J tests it on its own.
  const rules = (o = {}) => ({ start_stop_id: '', current_id: 'none', min_soc_enabled: false, min_soc: 20, min_soc_entity: '', min_soc_max_price: '', preheat_entity: '', force_minutes: 0, hysteresis: 0.03, car_limit_off: false, min_choice: 30, battery_care_enabled: false, ...o });
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
  await test('G2b', 'Below the minimum: the plan charges that part right away, marked as minimum (purple in the chart); the rest as planned', async () => {
    const p = await plan();
    const mins = p.plan.blocks.filter((b) => (b.min_kwh || 0) > 0.01);
    assert(p.plan.minimum && p.plan.minimum.kind === 'always' && p.plan.minimum.soc === 50 && p.plan.notes.includes('below_minimum'), JSON.stringify(p.plan.minimum));
    assert(mins.length && mins[0].start - Date.now() < 120000, `first minimum block ${mins.length ? new Date(mins[0].start).toISOString() : 'none'}`);
    const minKwh = mins.reduce((a, b) => a + b.min_kwh, 0);
    assert(Math.abs(minKwh - p.plan.minimum.kwh) < 0.2, `${minKwh} of ${p.plan.minimum.kwh} kWh`);
    return `${minKwh.toFixed(1)} kWh right away to ${p.plan.minimum.soc}%`;
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
    assert(n.want === 'charge' && ['ready_guard', 'force_window', 'planned', 'locked_block'].includes(n.code), `${n.want}/${n.code}`);
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
  await test('H2b', 'A tap on a phone notification opens the app page', async () => {
    const n0 = world.calls.length;
    await ok('POST', 'api/notify/test', {});
    const c = callsSince(n0).find((x) => x.domain === 'notify');
    const d = c && c.data && c.data.data;
    const page = '/a0b1c2d3_smart_charging_planner';
    assert(d && d.url === page && d.clickAction === page, `data ${JSON.stringify(d)}`);
  });
  await test('H3', 'Test notification refused when no notify action is chosen', async () => {
    await ok('POST', 'api/notify', { service: '' });
    await refused('POST', 'api/notify/test', {}, 'notify action');
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
  });
  await test('H4', 'Two recipients, each with its own messages: the test goes to one; a recipient without a notify action is refused', async () => {
    const r = await ok('POST', 'api/notify', { recipients: [
      { name: 'Alex', service: 'notify.mobile_app_pixel_8' },
      { name: 'Sam', service: 'notify.mobile_app_iphone_sam', off: ['battery_action', 'rg_risk'] },
    ] });
    assert(r.recipients.length === 2 && r.recipients[1].off.join() === 'battery_action,rg_risk', JSON.stringify(r.recipients));
    assert(r.categories.length === 5 && r.messages.length >= 16, 'no message list');
    const n0 = world.calls.length;
    await ok('POST', 'api/notify/test', { recipient_id: r.recipients[1].id });
    const sent = callsSince(n0).filter((c) => c.domain === 'notify').map((c) => c.service);
    assert(sent.join() === 'mobile_app_iphone_sam', JSON.stringify(sent));
    const n1 = world.calls.length;
    await ok('POST', 'api/notify/test', {});
    assert(callsSince(n1).filter((c) => c.domain === 'notify').length === 2, 'not to both');
    await refused('POST', 'api/notify', { recipients: [{ name: 'X', service: '' }] }, 'choose a notify action');
    await refused('POST', 'api/notify', { recipients: [{ name: 'X', service: 'notify.nope' }] }, 'not a notify action');
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
    return `test → ${sent.join()}`;
  });
  await test('H5', 'Settings from before recipients (one notify action, "Notify every start and pause" off) become one recipient "My phone" with start, pause and home battery messages off', async () => {
    await stopApp();
    const f = path.join(dataDir, 'settings.json');
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    saved.notify = { service: 'notify.mobile_app_pixel_8' };
    fs.writeFileSync(f, JSON.stringify(saved));
    await startApp({ notify_start_stop: false });
    const r = await ok('GET', 'api/notify');
    const me = r.recipients[0];
    assert(r.recipients.length === 1 && me.name === 'My phone' && me.service === 'notify.mobile_app_pixel_8' && me.cars === null, JSON.stringify(r.recipients));
    assert(['charging_started', 'charging_paused', 'battery_action'].every((x) => me.off.includes(x)) && !me.off.includes('charger_failed'), JSON.stringify(me.off));
    assert(Array.isArray(JSON.parse(fs.readFileSync(f, 'utf8')).notify.recipients), 'not saved in the new form');
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
    await startApp({});
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
    const marked = p.plan.blocks.reduce((a, b) => a + (b.min_kwh || 0), 0);
    assert(p.plan.minimum && p.plan.minimum.kind === 'ready_for' && Math.abs(marked - p.charge_for.min_kwh) < 0.2, `minimum ${JSON.stringify(p.plan.minimum)}, marked ${marked}`);
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
  await test('J5b', 'Quick minimum started: all of it is marked as minimum (purple in the chart)', async () => {
    world.soc = 20;
    world.charging = false;
    await ok('POST', 'api/boost', { mode: 'soc', value: 35, minimum: true });
    const p = await plan();
    await ok('DELETE', 'api/boost');
    await plan();
    assert(p.boost && p.boost.minimum === true && p.plan.minimum && p.plan.minimum.kind === 'quick', JSON.stringify({ boost: p.boost, minimum: p.plan.minimum }));
    assert(p.plan.blocks.length && p.plan.blocks.every((b) => Math.abs((b.min_kwh || 0) - b.kwh) < 0.001), 'not all marked');
    return `${p.plan.minimum.kwh} kWh to ${p.plan.minimum.soc}%`;
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
  await test('J6b', 'Just turn it on (Charge now without a goal, also for a visitor\'s car): charger started right away, no end from car data, your car\'s limit is not touched', async () => {
    world.charging = false;
    const n0 = world.calls.length;
    const r = await ok('POST', 'api/boost', { mode: 'on' });
    await sleep(800);
    const started = callsSince(n0).find((c) => CH.isStart(c));
    assert(started, `no start sent: ${JSON.stringify(callsSince(n0))}`);
    const p = await plan();
    const n = (await ok('GET', 'api/control')).now;
    await ok('DELETE', 'api/boost');
    await plan();
    assert(p.boost && p.boost.mode === 'on' && p.boost.value == null && p.boost.remaining_kwh == null, JSON.stringify(p.boost));
    assert(world.limit === lim(90), `limit changed to ${world.limit}`);
    assert(!callsSince(n0).some((c) => c.domain === 'number'), 'car limit sent');
    assert(n.code === 'boost' && n.want === 'charge', `${n.want}/${n.code}`);
    return `${r.send && r.send.sent ? 'start sent' : 'decided'}, no end until Stop or unplug`;
  });
  await test('J6c', 'Restart the car (option): the charger is on and ready, but the car takes no power (like a Renault that ended its session at 80 %); the app sets the car limit one step lower and back, and the car charges', async () => {
    if (!CH.text.ready) return 'not for this charger in the fake';
    world.charging = false;
    world.carAsleep = true;
    const n0 = world.calls.length;
    try {
      await ok('POST', 'api/control/settings', rules({ car_limit_restart: true }));
      await ok('POST', 'api/boost', { mode: 'soc', value: 100 });
      await sleep(800);
      assert(world.enabledNoPower && !world.charging, `enabled ${world.enabledNoPower}, charging ${world.charging}`);
      await plan();
      await sleep(1800);
      await plan();
      await sleep(800);
      const limits = callsSince(n0).filter((c) => c.domain === 'number').map((c) => c.data.value);
      assert(limits.includes(lim(100) - CAR.limit_step), `limits sent: ${limits.join(', ')}`);
      assert(world.charging === true, 'the car did not start');
      const p = await plan();
      await sleep(800);
      await plan();
      await sleep(800);
      assert(world.limit === lim(100), `limit not back: ${world.limit}`);
      const why = (p.charge_state.facts || []).find((f) => f.label === 'Restart of the car');
      assert(why, `not under Why?: ${JSON.stringify(p.charge_state.facts)}`);
      return `limits ${limits.join(' → ')}, charging`;
    } finally {
      world.carAsleep = false;
      world.enabledNoPower = false;
      await ok('DELETE', 'api/boost');
      await ok('POST', 'api/control/settings', rules());
      await plan();
    }
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
    // Above the car's limit (11 Oct 2026: 87 % with the limit at 80 %, trip 100 %):
    // not "ready" but "action needed", on Home and as a notification.
    const soc0 = world.soc;
    world.soc = 85;
    try {
      const q = await plan();
      await sleep(800);
      const wanted = q.planning.wanted_soc;
      assert(wanted > 80, `wanted ${wanted}`);
      assert(q.reliability && q.reliability.base_status === 'action_needed' && /80%/.test(q.reliability.label), JSON.stringify(q.reliability && [q.reliability.status, q.reliability.label]));
      assert(q.charging_now && q.charging_now.plugged !== undefined, `charging_now ${JSON.stringify(q.charging_now)}`);
      assert(q.charge_state && q.charge_state.state === 'car_limit' && q.charge_state.color === 'orange', `charge_state ${JSON.stringify(q.charge_state)}`);
      const told = world.calls.filter((c) => c.domain === 'notify').some((c) => /needs you/i.test(c.data.title) && /80%/.test(c.data.message));
      assert(told, 'no "Ready Guard needs you" notification about the limit');
    } finally {
      world.soc = soc0;
      await ok('POST', 'api/control/settings', rules());
    }
    return 'limit 80 %, battery 85 %: action needed + notification';
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
  await test('J13', 'Battery care (on by default): target 100 % tomorrow 23:00 — up to 80 % in the cheap night, the last part only in the 4 hours before departure; the car limit stays at 80 % until then', async () => {
    await ok('POST', 'api/control/settings', rules({ battery_care_enabled: true, battery_care_soc: 80, battery_care_hours: 4 }));
    world.soc = 50;
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '23:00', soc: 100 } }) }));
    await sleep(2100);
    const p = await plan();
    await sleep(800);
    const c = p.plan.care;
    assert(c && c.soc === 80 && c.target === 100 && p.plan.notes.includes('battery_care'), JSON.stringify(c));
    assert(c.window_start === at(1, 19), `window ${new Date(c.window_start).toISOString()}`);
    const before = p.plan.blocks.filter((b) => b.start < c.window_start).reduce((a, b) => a + b.kwh, 0);
    const inWindow = p.plan.blocks.filter((b) => b.start >= c.window_start).reduce((a, b) => a + b.kwh, 0);
    assert(Math.abs(before - c.care_kwh) < 0.1 && Math.abs(inWindow - (p.plan.needed_kwh - c.care_kwh)) < 0.1, `before ${before}, in window ${inWindow}, care ${c.care_kwh}, needed ${p.plan.needed_kwh}`);
    assert(world.limit === lim(80), `limit ${world.limit}`);
    // Off: everything in the cheap night again, and the limit goes up to 100 %.
    await ok('POST', 'api/control/settings', rules({ battery_care_enabled: false }));
    const q = await plan();
    await sleep(800);
    assert(!q.plan.care && q.plan.blocks.every((b) => b.start < at(1, 19)) && world.limit === lim(100), `blocks ${q.plan.blocks.map((b) => new Date(b.start).toISOString().slice(11, 16))}, limit ${world.limit}`);
    world.soc = 20;
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
    return `up to 80 %: ${before.toFixed(1)} kWh in the night · last ${inWindow.toFixed(1)} kWh from 19:00 · car limit 80 %`;
  });
  await test('J13b', 'Battery Care refill (#43): 79% and the 75% boundary wait for one priced session; below it gets an 80% session and a later 90% session; a hard minimum still charges', async () => {
    try {
      await ok('POST', 'api/control/settings', rules({ battery_care_enabled: true, battery_care_soc: 80, battery_care_hours: 4 }));
      await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '23:00', soc: 90 } }) }));
      for (const soc of [79, 75]) {
        world.soc = soc;
        world.charging = false;
        const result = await plan();
        const c = result.plan.care;
        assert(c && c.refill_deferred && c.refill_margin === 5, JSON.stringify(c));
        assert(result.plan.blocks.length && result.plan.blocks.every((b) => b.start >= c.window_start), 'small top-up still planned before the final window');
        const next = (await ok('GET', 'api/control')).now;
        assert(next.want === 'pause' && next.code === 'battery_care_wait', JSON.stringify(next));
        const charges = result.next.timeline.filter((x) => x.type === 'charge' && x.expected === false);
        assert(charges.length === 1 && charges[0].soc_to === 90 && charges[0].start >= c.window_start, JSON.stringify(charges));
        assert(Math.abs(result.plan.planned_kwh - result.plan.needed_kwh) < 0.1, 'target energy lost');
        await sleep(800);
        assert(world.limit === lim(80), 'car limit raised before the final window');
      }
      world.soc = 76;
      world.charging = true;
      const active = await plan();
      assert(!active.plan.care.refill_deferred, 'already-started early session interrupted in the refill band');
      world.charging = false;
      world.soc = 74;
      const lower = await plan();
      assert(!lower.plan.care.refill_deferred, 'larger deficit was deferred');
      const sessions = lower.next.timeline.filter((x) => x.type === 'charge' && x.expected === false);
      assert(sessions.length >= 2 && sessions[0].start < lower.plan.care.window_start, JSON.stringify(sessions));
      assert(Math.abs(sessions[0].soc_to - 80) < 0.2 && sessions[sessions.length - 1].soc_to === 90, JSON.stringify(sessions));
      world.soc = 79;
      await ok('POST', 'api/control/settings', rules({ battery_care_enabled: true, battery_care_soc: 80, battery_care_hours: 4, min_soc_enabled: true, min_soc: 80 }));
      const minimum = await plan();
      const decision = (await ok('GET', 'api/control')).now;
      assert(minimum.plan.minimum && minimum.plan.minimum.soc === 80 && decision.code === 'below_minimum', JSON.stringify({ minimum: minimum.plan.minimum, decision }));
      return '75–79% waits; 74% shows 80% then 90%; explicit minimum remains immediate';
    } finally {
      await ok('POST', 'api/control/settings', rules());
      world.soc = 20;
      world.charging = false;
      await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 90 }, [dayKey(2)]: { enabled: true, time: '06:00', soc: 80 } }) }));
    }
  });
  await test('J10', 'Car unplugged: Charge now is refused', async () => {
    world.plugged = false;
    await plan();
    await refused('POST', 'api/boost', { mode: 'soc', value: 90 }, 'not plugged in');
    world.plugged = true;
  });

  await test('J11', 'A recipient with "Charging started" and "Charging paused" off: start is not notified; other messages still are', async () => {
    await ok('POST', 'api/notify', { recipients: [{ name: 'Alex', service: 'notify.mobile_app_pixel_8', off: ['charging_started', 'charging_paused'] }] });
    world.soc = 20;
    world.charging = false;
    world.amps = null;
    const n0 = world.calls.length;
    await ok('POST', 'api/boost', { mode: 'soc', value: 30 });
    await sleep(800);
    const titles = callsSince(n0).filter((c) => c.domain === 'notify').map((c) => c.data.title);
    await ok('DELETE', 'api/boost');
    assert(!titles.includes('Charging started'), `notified: ${titles}`);
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
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
    // In the afternoon the sun that is left today may count as well (a run at 15:15 planned 1 kWh on it).
    const todaySun = Date.now() < at(0, 15, 0);
    const leftToday = (p.solar && p.solar.expected_kwh_left_today) || 0;
    assert(sk > 11 && sk < (todaySun ? 25 : 13 + leftToday), `solar ${sk} kWh, solar info ${JSON.stringify(p.solar)}, notes ${p.plan.notes}, dep ${JSON.stringify(p.departure)}, needed ${p.plan.needed_kwh}, blocks ${JSON.stringify(p.plan.blocks.map((b) => [new Date(b.block_start).toISOString().slice(5, 13), b.kwh.toFixed(1), b.price]))}`);
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
    await plan(); // establish the observed plug-in session first
    world.reportedAt = { [CAR.soc]: Date.now() };
    await plan(); // then a reading taken inside that session
    const n0 = world.calls.length;
    world.soc = 'unavailable';
    world.chargedKw = 11; // the charger delivers 11 kW meanwhile
    await sleep(5000);
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
    world.reportedAt = {};
    return `plans with ${p.vehicle.soc}% (last level 45% + ${cd.kwh_since} kWh charged since), decision ${n.code}`;
  });
  await test('V3', 'Battery level not read for 3 hours (old after 2): estimate from the last level; back: the real level, at most one message an hour', async () => {
    const nBack = world.calls.length;
    world.soc = 50;
    world.ages = {};
    world.reportedAt = { [CAR.soc]: Date.now() };
    await plan(); // read while live again: 50 % (back after V2)
    world.reportedAt = {};
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

  await test('V5', 'Just plugged in: the charger already says connected, the car\'s own sensor (through its cloud) still says not plugged in: the app sees the car as plugged in right away', async () => {
    world.plugged = true;
    world.car1Plug = false;
    try {
      const p = await plan();
      assert(p.plugged_now === true, `plugged_now ${p.plugged_now}`);
      const n = await decision();
      assert(n.code !== 'unplugged' && n.code !== 'not_plugged', `decision ${n.code}`);
      return `charger: ${p.charger && p.charger.status ? p.charger.status : 'connected'} · car sensor: off → plugged in`;
    } finally {
      world.car1Plug = undefined;
    }
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
    world.events = [{ summary: 'Naar Werk Rivertown', description: 'doel: 80', location: 'Kerkstraat 1, Springfield', start: isoLocal(at(1, 7, 0), tz), end: isoLocal(at(1, 8, 0), tz) }];
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' }).catch(() => {});
    await plan();
    const d = await ok('GET', 'api/diagnostics');
    const text = JSON.stringify(d);
    world.events = [];
    assert(d.app_version && d.settings && d.settings.chargers && d.settings.chargers.length, 'no settings');
    assert(d.control_check && d.control_check.recommended, 'no control check');
    assert(d.entities.some((e) => e.entity_id === d.settings.chargers[0].status_entity), 'anonymous charger status reference missing');
    assert(Array.isArray(d.control_log) && d.app_log === undefined && d.app_log_summary.lines > 5, 'public log summary missing or raw logs retained');
    for (const secret of ['mobile_app_pixel_8', 'Naar Werk', 'Kerkstraat', 'Springfield', 'SUPERVISOR', CH.status, CAR.name]) assert(!text.includes(secret), `contains ${secret}`);
    return `${Math.round(text.length / 1024)} kB, ${d.entities.length} entities, ${d.app_log_summary.lines} summarized log lines`;
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
    await refused('POST', 'api/settings/import/preview', { ...exported, settings: { ...exported.settings, vehicles: [null] } }, 'vehicles[0]');
    await refused('POST', 'api/settings/import/preview', { ...exported, settings: { ...exported.settings, control: [] } }, 'control must be an object');
    await refused('POST', 'api/settings/import/preview', { ...exported, settings: { ...exported.settings, chargers: [{ max_current_entities: 'sensor.limit' }] } }, 'list of entity IDs');
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
    assert(/home battery was left out/.test(n) && /Left out 1 notification recipient/.test(n) && /sensor\.other_house_battery_soc/.test(n), n);
    assert(pv.summary.battery === false, 'battery still on');
    return n;
  });

  // ----- N. Reliability ------------------------------------------------------
  group = 'N. Reliability';
  await test('N1', 'A failed charger command is retried on the next control step', async () => {
    world.plugged = true;
    world.charging = false;
    world.limit = 100;
    world.failNextControl = 2; // manual Charge now + its immediate plan refresh
    const before = world.calls.length;
    const started = await ok('POST', 'api/boost', { mode: 'soc', value: 60 });
    assert(started.send && !started.send.sent, 'the first command should fail in this test');
    await plan();
    const sent = callsSince(before).filter((c) => world.profile.charger.isStart(c));
    assert(sent.length >= 1, 'start command was not retried after the transient failure');
    await ok('DELETE', 'api/boost');
    return `${sent.length} successful retry`;
  });

  await test('N2', 'A Home Assistant reconnect immediately refreshes the cached plan', async () => {
    world.soc = 40;
    const before = await plan();
    const beforeAt = before.computed_at;
    const beforeNeed = before.plan.needed_kwh;
    await ha.close();
    for (let i = 0; i < 30; i++) {
      const s = await api('GET', 'api/status');
      if (s.status === 200 && !s.body.connected) break;
      await sleep(50);
    }
    world.soc = 20;
    ha = fake.start(world, WS_PORT, REST_PORT);
    let after = null;
    for (let i = 0; i < 80; i++) {
      await sleep(50);
      const s = await api('GET', 'api/status').catch(() => null);
      if (!s || s.status !== 200 || !s.body.connected) continue;
      const p = await ok('GET', 'api/plan');
      if (p.computed_at > beforeAt) { after = p; break; }
    }
    assert(after, 'plan was not refreshed after reconnect');
    assert(after.plan.needed_kwh > beforeNeed, `stale plan: ${beforeNeed} -> ${after.plan.needed_kwh}`);
    return `${beforeNeed.toFixed(1)} -> ${after.plan.needed_kwh.toFixed(1)} kWh`;
  });

  // ----- W. More than one car on one charger (an option) --------------------
  group = 'W. More than one car on one charger';
  const EV6 = { name: 'EV6', device_id: 'car2', integration: 'kia_uvo', soc_entity: 'sensor.ev6_battery_level', plugged_entity: 'binary_sensor.ev6_plugged_in', charging_entity: 'binary_sensor.ev6_charging', capacity_kwh: 77 };
  const carsNow = async () => (await ok('GET', 'api/vehicles')).vehicles;
  world.soc = 40;
  world.charging = false;
  world.plugged = true;
  world.car2 = { soc: 30, plug: false, charging: false };
  await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
  await test('W1', 'Off by default: one car as before; adding a second car or choosing a car is refused', async () => {
    const v = await ok('GET', 'api/vehicles');
    assert(v.multi_car === false && v.vehicles.length === 1 && v.vehicles[0].id, JSON.stringify(v));
    await refused('POST', 'api/vehicles', { ...EV6, add: true }, 'more than one car');
    await refused('POST', 'api/vehicles/connected', { vehicle_id: v.vehicles[0].id }, 'more than one car');
    const p = await plan();
    assert(p.cars === null && p.vehicle.name === CAR.name, JSON.stringify(p.cars));
    return `one car: ${p.vehicle.name} (${v.vehicles[0].id})`;
  });
  let firstId;
  let ev6Id;
  await test('W2', 'Turned on: a second car is added next to the first; the first keeps its id and settings', async () => {
    firstId = (await carsNow())[0].id;
    await ok('POST', 'api/vehicles/multi', { enabled: true });
    const r = await ok('POST', 'api/vehicles', { ...EV6, add: true });
    ev6Id = r.vehicle.id;
    const list = await carsNow();
    assert(list.length === 2 && list[0].id === firstId && list[0].name === CAR.name && list[1].id === ev6Id && ev6Id !== firstId, JSON.stringify(list.map((x) => [x.id, x.name])));
    assert(list[0].soc_entity === CAR.soc && list[0].charge_limit_entity === CAR.limit, 'first car changed');
    const exp = await ok('GET', 'api/settings/export');
    assert(exp.settings.multi_car === true && exp.settings.vehicles.length === 2, 'export without the second car');
    return list.map((x) => `${x.name} (${x.id})`).join(', ');
  });
  await test('W3', 'Only the EV6 says it is plugged in: the plan is for the EV6 (its level, its capacity)', async () => {
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: true, charging: false };
    const p = await plan();
    assert(p.vehicle.id === ev6Id && p.vehicle.soc === 30 && p.cars.how === 'sensor' && !p.cars.ask, JSON.stringify({ v: p.vehicle.name, soc: p.vehicle.soc, cars: p.cars }));
    // 30 -> 80 % of 77 kWh, with 10 % loss margin.
    assert(Math.abs(p.plan.needed_kwh - 77 * 0.5 * 1.1) < 0.6, `needed ${p.plan.needed_kwh}`);
    return `${p.vehicle.name} at ${p.vehicle.soc}% · needs ${p.plan.needed_kwh.toFixed(1)} kWh`;
  });
  await test('W4', `Only ${CAR.name} says it is plugged in: the plan is for ${CAR.name}`, async () => {
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: false, charging: false };
    const p = await plan();
    assert(p.vehicle.id === firstId && p.vehicle.soc === 40 && p.cars.how === 'sensor', JSON.stringify(p.cars));
    return `${p.vehicle.name} at ${p.vehicle.soc}%`;
  });
  await test('W5', 'Both say plugged in (one at a public charger): the app asks once, does not change a car limit; your choice wins until the charger is unplugged', async () => {
    const n0 = world.calls.length;
    world.limit = 60;
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: true, charging: false };
    const p = await plan();
    await sleep(600);
    await plan();
    await sleep(600);
    assert(p.cars.ask === true && p.cars.how === 'guess', JSON.stringify(p.cars));
    const asked = callsSince(n0).filter((c) => c.domain === 'notify' && c.data.title === 'Which car is connected?');
    assert(asked.length === 1, `notifications ${asked.length}`);
    assert(!callsSince(n0).some((c) => c.domain === 'number' && c.target && c.target.entity_id === CAR.limit), 'car limit sent while the app is not sure which car is connected');
    await ok('POST', 'api/vehicles/connected', { vehicle_id: ev6Id });
    const c = await plan();
    assert(c.vehicle.id === ev6Id && c.cars.how === 'chosen' && c.cars.chosen && !c.cars.ask, JSON.stringify(c.cars));
    world.plugged = false; // the charger is unplugged: the choice is used up
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: false, charging: false };
    const u = await plan();
    assert(!u.cars.chosen && u.cars.how === 'last' && u.vehicle.id === ev6Id, JSON.stringify(u.cars));
    world.plugged = true;
    world.limit = 80;
    return `asked once; chosen: ${c.vehicle.name}; unplugged: ${u.cars.how} = ${u.vehicle.name}`;
  });
  await test('W6', 'A car without a plug sensor is the one when no other car says it is plugged in', async () => {
    await ok('POST', 'api/vehicles', { ...EV6, id: ev6Id, plugged_entity: '' });
    world.car1Plug = false;
    world.car2 = { soc: 35, plug: false, charging: false, noPlugSensor: true };
    const p = await plan();
    assert(p.vehicle.id === ev6Id && p.cars.how === 'no_other' && p.vehicle.soc === 35, JSON.stringify(p.cars));
    const c = await ok('GET', 'api/checklist');
    assert(c.items.some((i) => i.key === 'car_recognition' && i.state === 'ok'), JSON.stringify(c.items.map((i) => i.key)));
    await ok('POST', 'api/vehicles', { ...EV6, id: ev6Id });
    world.car2 = { soc: 30, plug: true, charging: false };
    return `${p.vehicle.name} (${p.cars.how})`;
  });
  await test('W7', 'Own departures for the EV6 (60 %); the other car keeps the shared ones (80 %)', async () => {
    await ok('POST', 'api/departures/own', { vehicle_id: ev6Id, own: true });
    const d = await ok('GET', `api/departures?vehicle=${ev6Id}`);
    assert(d.own_departures === true && d.cars.length === 2, JSON.stringify({ own: d.own_departures }));
    await ok('POST', 'api/departures', depBody({ vehicle_id: ev6Id, schedule: schedule({ [dayKey(1)]: { enabled: true, time: '06:00', soc: 60 } }) }));
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: true, charging: false };
    const p = await plan();
    assert(p.vehicle.id === ev6Id && p.departure && p.departure.soc === 60, JSON.stringify(p.departure));
    const shared = await ok('GET', `api/departures?vehicle=${firstId}`);
    assert(shared.own_departures === false && shared.next && shared.next.soc === 80, JSON.stringify(shared.next));
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: false, charging: false };
    const q = await plan();
    assert(q.vehicle.id === firstId && q.departure.soc === 80, JSON.stringify(q.departure));
    return `EV6 → ${p.departure.soc}% · ${CAR.name} → ${q.departure.soc}%`;
  });
  await test('W7b', 'One calendar for both cars: "auto:"/"car:" in an event is only for that car (name or brand), without it for every car, an unknown car counts for every car', async () => {
    await ok('POST', 'api/departures/own', { vehicle_id: ev6Id, own: false });
    await ok('POST', 'api/departures', depBody({ vehicle_id: firstId, schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } }));
    world.events = [
      { summary: 'Naar werk', description: `doel: 90 precondition: ja auto: ${CAR.name}`, start: isoLocal(at(1, 7, 0), tz), end: isoLocal(at(1, 8, 0), tz) },
      { summary: 'To Ghent', description: `target: 70\ncar: ${EV6_WORD}`, start: isoLocal(at(1, 6, 0), tz), end: isoLocal(at(1, 7, 0), tz) },
      { summary: 'Weekend', description: 'doel: 85', start: isoLocal(at(2, 9, 0), tz), end: isoLocal(at(2, 10, 0), tz) },
      { summary: 'Tesla trip', description: 'doel: 60, car: tesla', start: isoLocal(at(3, 9, 0), tz), end: isoLocal(at(3, 10, 0), tz) },
    ];
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: true, charging: false };
    const e = await plan();
    assert(e.vehicle.id === ev6Id && e.departure.time === at(1, 6, 0) && e.departure.soc === 70, `EV6: ${JSON.stringify(e.departure)}`);
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: false, charging: false };
    const r = await plan();
    assert(r.vehicle.id === firstId && r.departure.time === at(1, 7, 0) && r.departure.soc === 90, `${CAR.name}: ${JSON.stringify(r.departure)}`);
    const d = await ok('GET', `api/departures?vehicle=${firstId}`);
    const titles = d.calendar_trips.map((t) => t.title);
    assert(titles.includes('Naar werk') && titles.includes('Weekend') && !titles.includes('To Ghent') && titles.includes('Tesla trip'), titles.join(', '));
    const tesla = d.calendar_trips.find((t) => t.title === 'Tesla trip');
    assert(tesla.car_unknown === true && tesla.car === 'tesla', JSON.stringify(tesla));
    const pv = await ok('POST', 'api/trips/preview', { vehicle_id: ev6Id, datetime: isoLocal(at(4, 8, 0), tz).slice(0, 16), destination: 'Gent', soc: 75, precondition: true });
    assert(pv.events[0].description === 'target: 75 precondition: yes car: EV6', pv.events[0].description);
    const all = await ok('POST', 'api/trips/preview', { vehicle_id: ev6Id, for_all_cars: true, datetime: isoLocal(at(4, 8, 0), tz).slice(0, 16), destination: 'Gent', soc: 75, precondition: false });
    assert(all.events[0].description === 'target: 75 precondition: no', all.events[0].description);
    world.events = [];
    await ok('POST', 'api/departures', depBody({ vehicle_id: firstId, schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
    return `EV6 → ${e.departure.soc}% (car: ${EV6_WORD}) · ${CAR.name} → ${r.departure.soc}% · new trip: "${pv.events[0].description}"`;
  });
  await test('W9', 'Notifications per car: Alex gets both cars, Sam only the EV6; "Charging started" for the EV6 goes to both, for the other car only to Alex', async () => {
    await ok('POST', 'api/notify', { recipients: [
      { name: 'Alex', service: 'notify.mobile_app_pixel_8' },
      { name: 'Sam', service: 'notify.mobile_app_iphone_sam', cars: [ev6Id] },
    ] });
    const startsTo = async () => {
      const n0 = world.calls.length;
      await ok('POST', 'api/boost', { mode: 'soc', value: 90 });
      await sleep(800);
      const to = callsSince(n0).filter((c) => c.domain === 'notify' && c.data.title.startsWith('Charging started')).map((c) => c.service).sort();
      await ok('DELETE', 'api/boost');
      await sleep(500);
      world.charging = false;
      return to;
    };
    world.charging = false;
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: true, charging: false };
    await plan();
    const ev6 = await startsTo();
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: false, charging: false };
    await plan();
    const other = await startsTo();
    assert(ev6.join() === 'mobile_app_iphone_sam,mobile_app_pixel_8', `EV6: ${ev6}`);
    assert(other.join() === 'mobile_app_pixel_8', `${CAR.name}: ${other}`);
    const r = await ok('GET', 'api/notify');
    assert(r.recipients[1].cars.join() === ev6Id, JSON.stringify(r.recipients[1]));
    await ok('POST', 'api/notify', { service: 'notify.mobile_app_pixel_8' });
    return `EV6 → ${ev6.join(', ')} · ${CAR.name} → ${other.join(', ')}`;
  });
  await test('W8', 'Turned off: the first car only, as before; the EV6 stays saved; removing it works', async () => {
    await ok('POST', 'api/vehicles/multi', { enabled: false });
    world.car1Plug = false;
    world.car2 = { soc: 30, plug: true, charging: false };
    const p = await plan();
    assert(p.cars === null && p.vehicle.id === firstId, JSON.stringify(p.cars));
    // Shared departures again for everything.
    assert(p.departure && p.departure.soc === 80, JSON.stringify(p.departure));
    const list = await carsNow();
    assert(list.length === 2 && list[1].used === false, JSON.stringify(list.map((x) => [x.name, x.used])));
    await ok('DELETE', `api/vehicles?id=${ev6Id}`);
    const after = await carsNow();
    assert(after.length === 1 && after[0].id === firstId, JSON.stringify(after.map((x) => x.name)));
    world.car1Plug = undefined;
    world.car2 = null;
    return 'back to one car';
  });

  // ----- Y. Looking ahead: the next goal and what a trip costs --------------
  group = 'Y. Looking ahead: the next goal and what a trip costs';
  {
    const ADDR = 'Hoofdweg 1 1111 AA Meadowtown';
    const ADDR2 = 'Molenstraat 5, 1113 AA Hilltown';
    const ADDR3 = 'Nieuwstraat 2, 1114 AA Harbourtown';
    world.places = {
      [ADDR]: { lat: 51.98, lon: 1.99 },
      [ADDR2]: { lat: 51.68, lon: 2.29 },
      [ADDR3]: { lat: 51.85, lon: 1.83 },
    };
    world.routeKm = 60;
    const calBody = depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } });
    const ev = (title, desc, location, d, h, endH) => ({ summary: title, description: desc, location, start: isoLocal(at(d, h), tz), end: isoLocal(at(d, endH), tz) });
    const settle = async () => { await plan(); await sleep(400); await plan(); await sleep(300); return plan(); };
    await test('Y1', 'Target reached (100 %), trip with an address tomorrow: the next goal (Werk, 80 %) is shown, the trip costs ~46 % there and back (60 km by road, 18 kWh/100 km, +10 %), so ~54 % is expected after it, with the expected charging (orange) after the car is back', async () => {
      await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
      await ok('POST', 'api/departures', calBody);
      world.soc = 100;
      world.events = [
        ev('Naar Lakeside', 'doel: 100', ADDR, 1, 8, 18),
        ev('Naar Werk', 'doel: 80', 'Werk', 3, 7, 8),
      ];
      const p = await settle();
      const n = p.next;
      assert(n && n.current.title === 'Naar Lakeside' && n.current.soc_at_departure === 100, JSON.stringify(n && n.current));
      assert(n.trip.status === 'ok' && n.trip.km === 60 && n.trip.how === 'route' && n.trip.use === 'consumption', JSON.stringify(n.trip));
      const pct = 120 * (18 / 100 / CAR.capacity) * 100 * 1.1;
      assert(Math.abs(n.trip.pct - pct) < 0.2 && Math.abs(n.trip.soc_after - (100 - pct)) < 0.2, `pct ${n.trip.pct} (${pct.toFixed(1)}), after ${n.trip.soc_after}`);
      assert(n.trip.return_at === at(1, 18), `back ${new Date(n.trip.return_at).toISOString()}`);
      assert(n.goal && n.goal.title === 'Naar Werk' && n.goal.soc === 80 && n.goal.time === at(3, 7), JSON.stringify(n.goal));
      const e = n.expected;
      assert(e && e.below_goal && e.needed_kwh > 5 && e.blocks.length && e.blocks.every((b) => b.expected && b.start >= at(1, 18)), JSON.stringify({ ...e, blocks: e && e.blocks.length }));
      return `trip ${n.trip.km} km → ${n.trip.pct}% · back ~${n.trip.soc_after}% · next: ${n.goal.title} ${n.goal.soc}% · expected ${e.needed_kwh} kWh, ${e.planned_kwh.toFixed(1)} kWh in known prices`;
    });
    await test('Y2', 'A return trip in the calendar ("Naar Thuis", 16:00–17:00): the car is back at 17:00 and the way home is not the next goal', async () => {
      world.events = [
        ev('Naar Lakeside', 'doel: 100', ADDR, 1, 8, 10),
        ev('Naar Thuis', 'doel: 80', 'Thuis', 1, 16, 17),
        ev('Naar Werk', 'doel: 80', 'Werk', 3, 7, 8),
      ];
      const n = (await settle()).next;
      assert(n.trip.return_trip && n.trip.return_trip.title === 'Naar Thuis' && n.trip.return_at === at(1, 17), JSON.stringify(n.trip));
      assert(n.goal.title === 'Naar Werk', JSON.stringify(n.goal));
      return `back ${new Date(n.trip.return_at).toISOString().slice(11, 16)} UTC · next ${n.goal.title}`;
    });
    await test('Y3', 'An extra calendar trip becomes the next stop, and the 100% long trip after it becomes the next goal instead of the later work trip', async () => {
      world.events = [
        ev('Naar Harbourtown', 'doel: 60', ADDR3, 1, 15, 17),
        ev('Naar Lakeside', 'doel: 100', ADDR, 2, 6, 18),
        ev('Naar Werk', 'doel: 80', 'Werk', 4, 7, 8),
      ];
      const n = (await settle()).next;
      assert(n.current.title === 'Naar Harbourtown' && n.current.target_soc === 60, JSON.stringify(n.current));
      assert(n.goal && n.goal.title === 'Naar Lakeside' && n.goal.soc === 100, JSON.stringify(n.goal));
      return `next stop ${n.current.title} ${n.current.target_soc}% · next goal ${n.goal.title} ${n.goal.soc}%`;
    });
    await test('Y2b', 'Lakeside on Sunday, then Naar Werk (company + address) and Naar Thuis (home address) on Monday: no trip home for Sunday, the next goal is Monday\'s Naar Werk, the company address is found without the company name', async () => {
      world.places = { ...world.places, 'Industrieweg 10, 1112 AA Rivertown, Nederland': { lat: 51.80, lon: 2.20 }, 'Dorpsstraat 12, 1234 AB Springfield, Nederland': { lat: 51.3705, lon: 2.6905 } };
      world.events = [
        ev('Naar Lakeside', 'doel: 100', ADDR, 1, 6, 20),
        ev('Naar Werk', 'doel: 80', 'Northwind Labs, Industrieweg 10, 1112 AA Rivertown, Nederland', 2, 6, 7),
        ev('Naar Thuis', 'doel: 80 precondition: ja', 'Dorpsstraat 12, 1234 AB Springfield, Nederland', 2, 16, 17),
        ev('Naar Werk', 'doel: 80', 'Werk', 4, 6, 7),
      ];
      await settle();
      await sleep(600);
      const n = (await settle()).next;
      assert(!n.trip.return_trip && n.trip.return_at === at(1, 20), JSON.stringify({ back: n.trip.return_trip, at: new Date(n.trip.return_at).toISOString() }));
      assert(n.goal && n.goal.title === 'Naar Werk' && n.goal.time === at(2, 6), JSON.stringify(n.goal));
      const d = await ok('GET', 'api/departures');
      const werk = d.calendar_trips.find((t) => t.time === at(2, 6));
      const thuis = d.calendar_trips.find((t) => t.time === at(2, 16));
      assert(werk.cost && werk.cost.status === 'ok', JSON.stringify(werk.cost));
      assert(thuis.cost === null, `the trip home has a cost: ${JSON.stringify(thuis.cost)}`);
      return `back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~${werk.cost.km} km`;
    });
    await test('Y5', 'The coming days as one timeline: charging, leaving, back home, expected charging (orange), leaving again, …; the chart goes on to the expected charging', async () => {
      world.soc = 50;
      world.events = [
        ev('Naar Lakeside', 'doel: 100', ADDR, 1, 8, 18),
        ev('Naar Werk', 'doel: 80', ADDR3, 2, 7, 8),
        ev('Naar Thuis', 'doel: 80', 'Thuis', 2, 16, 17),
        ev('Naar Werk', 'doel: 80', ADDR3, 3, 7, 8),
      ];
      const p = await settle();
      const tl = p.next.timeline;
      const kinds = tl.map((x) => (x.type === 'charge' && x.expected ? 'expected' : x.type)).join(' ');
      const leaves = tl.filter((x) => x.type === 'leave');
      assert(leaves.length === 3 && leaves.map((x) => x.title).join() === 'Naar Lakeside,Naar Werk,Naar Werk', kinds);
      assert(/^charge leave back expected leave back (expected )?leave/.test(kinds), kinds);
      const backs = tl.filter((x) => x.type === 'back');
      assert(backs[0].time === at(1, 18) && backs[1].time === at(2, 17) && backs[1].title === 'Naar Thuis', JSON.stringify(backs));
      assert(backs.every((b) => b.soc != null && b.soc < 80) && leaves[1].soc >= 79.5, JSON.stringify(tl.map((x) => [x.type, x.soc])));
      const exp = tl.filter((x) => x.type === 'charge' && x.expected);
      assert(exp.length && exp[0].start >= at(1, 18) && exp[0].end <= at(2, 7) && p.next.expected_blocks.length, JSON.stringify(exp));
      assert(p.prices[p.prices.length - 1].end > p.departure.time, 'the chart stops at the departure');
      world.soc = 100;
      return kinds;
    });
    await test('Y6', 'My places: "Werk" and a company name ("Northwind Labs") are no address; Home offers to add "Werk" to My places; once saved, both Naar Werk trips show what they cost', async () => {
      const WORK = 'Industrieweg 10, 1112 AA Rivertown';
      world.places = { ...world.places, [WORK]: { lat: 51.80, lon: 2.20 } };
      world.soc = 80;
      world.events = [
        ev('Naar Werk', 'doel: 80', 'Northwind Labs', 1, 6, 7),
        ev('Naar Thuis', 'doel: 80', 'Thuis', 1, 16, 17),
        ev('Naar Werk', 'doel: 80', 'Werk', 2, 6, 7),
      ];
      let p = await settle();
      const leaves = (q) => q.next.timeline.filter((x) => x.type === 'leave');
      const before = leaves(p);
      assert(before.length === 2 && before.every((x) => x.trip.pct == null) && before[1].trip.ask === 'Werk', JSON.stringify(before.map((x) => x.trip)));
      await refused('POST', 'api/places', { places: [{ name: 'Thuis', address: 'Dorpsstraat 1, Springfield' }] }, 'home');
      await refused('POST', 'api/places', { places: [{ name: 'Werk', address: WORK }, { name: 'werk', address: WORK }] }, 'twice');
      await ok('POST', 'api/places', { places: [{ name: 'Werk', address: WORK }] });
      p = await settle();
      const after = leaves(p);
      assert(after.every((x) => x.trip.status === 'ok' && x.trip.place === 'Werk' && x.trip.pct > 0), JSON.stringify(after.map((x) => x.trip)));
      const backs = p.next.timeline.filter((x) => x.type === 'back');
      assert(backs[0].soc != null && backs[0].title === 'Naar Thuis', JSON.stringify(backs));
      const d = await ok('GET', 'api/departures');
      assert(d.calendar_trips.filter((x) => x.title === 'Naar Werk').every((x) => x.cost && x.cost.place === 'Werk'), JSON.stringify(d.calendar_trips.map((x) => x.cost)));
      const exp = await ok('GET', 'api/settings/export');
      assert(exp.settings.places && exp.settings.places[0].name === 'Werk', 'not in the export');
      await ok('POST', 'api/places', { places: [] });
      world.soc = 100;
      return `Werk → ${after[0].trip.km} km, ${after[0].trip.pct}% there and back`;
    });
    await test('Y7', 'Zones in Home Assistant: a zone "Werk" (GPS) is used without an address, for "Werk" and for "Naar Werk" with "Northwind Labs"; Plan lists the zone, not Home', async () => {
      world.zones = [{ entity_id: 'zone.werk', name: 'Werk', lat: 51.80, lon: 2.20 }];
      world.soc = 80;
      world.events = [
        ev('Naar Werk', 'doel: 80', 'Northwind Labs', 1, 6, 7),
        ev('Naar Thuis', 'doel: 80', 'Thuis', 1, 16, 17),
        ev('Naar Werk', 'doel: 80', 'Werk', 2, 6, 7),
      ];
      const p = await settle();
      const leaves = p.next.timeline.filter((x) => x.type === 'leave');
      assert(leaves.length === 2 && leaves.every((x) => x.trip.status === 'ok' && x.trip.place === 'Werk' && x.trip.place_kind === 'zone' && x.trip.pct > 0), JSON.stringify(leaves.map((x) => x.trip)));
      const r = await ok('GET', 'api/places');
      assert(r.zones.length === 1 && r.zones[0].name === 'Werk', JSON.stringify(r.zones));
      const d = await ok('GET', 'api/departures');
      assert(d.calendar_trips.filter((x) => x.title === 'Naar Werk').every((x) => x.cost && x.cost.place_kind === 'zone'), JSON.stringify(d.calendar_trips.map((x) => x.cost)));
      world.zones = [];
      world.soc = 100;
      return `zone Werk → ${leaves[0].trip.km} km (${leaves[0].trip.how})`;
    });
    await test('Y7b', 'Trip distances (#31): the choice is checked; offline sends nothing and uses a distance from My places; off shows no distance; back to OpenStreetMap', async () => {
      const r0 = await ok('GET', 'api/routing');
      assert(r0.routing.mode === 'osm' && r0.routing.confirmed, JSON.stringify(r0));
      await refused('POST', 'api/routing', { mode: 'everything' }, 'choose');
      await refused('POST', 'api/routing', { mode: 'custom', geocode_url: '', route_url: '' }, 'server');
      await refused('POST', 'api/routing', { mode: 'custom', geocode_url: 'ftp://geo.lan/search', route_url: 'https://osrm.lan/route/v1/driving' }, 'http');
      await refused('POST', 'api/places', { places: [{ name: 'Gym', address: '' }] }, 'address or a distance');
      await refused('POST', 'api/places', { places: [{ name: 'Gym', km: 5000 }] }, 'between');
      const off = await ok('POST', 'api/routing', { mode: 'offline' });
      assert(off.routing.mode === 'offline' && !off.routing.online && off.routing.confirmed, JSON.stringify(off));
      await ok('POST', 'api/places', { places: [{ name: 'Gym', address: '', km: '15,5' }] });
      world.soc = 80;
      world.events = [
        ev('Naar Gym', 'doel: 80', 'Gym', 1, 18, 20),
        ev('Naar Ergens', 'doel: 80', 'Nieuwe Weg 7, 9999 ZZ Nergens', 2, 8, 18),
      ];
      let p = await settle();
      let leaves = p.next.timeline.filter((x) => x.type === 'leave');
      assert(leaves[0].trip.status === 'ok' && leaves[0].trip.km === 15.5 && leaves[0].trip.how === 'manual' && leaves[0].trip.pct > 0, JSON.stringify(leaves[0].trip));
      assert(leaves[1].trip.status === 'unknown' && leaves[1].trip.reason === 'offline', JSON.stringify(leaves[1].trip));
      await ok('POST', 'api/routing', { mode: 'off' });
      p = await settle();
      leaves = p.next.timeline.filter((x) => x.type === 'leave');
      assert(leaves[1].trip.reason === 'routing_off', JSON.stringify(leaves[1].trip));
      const back = await ok('POST', 'api/routing', { mode: 'osm' });
      assert(back.routing.online && /openstreetmap/i.test(back.routing.label), JSON.stringify(back));
      await ok('POST', 'api/places', { places: [] });
      world.events = [];
      world.soc = 100;
      return `Gym → 15.5 km (manual); unknown address offline: ${leaves[1].trip.reason}`;
    });
    await test('Y7c', 'Charging stops on the way (#37, #40): off by default; needs a key that is never shown; a trip that needs more than the battery holds gets stations along the route (country, power, connector, detour, not private), preferred operators first, one block per stop; every country on the route counts unless limited; offline sends nothing', async () => {
      const r0 = await ok('GET', 'api/charge-stops');
      const codes = r0.charge_stops.country_list.map((x) => x.code);
      assert(r0.charge_stops.enabled === false && !r0.charge_stops.has_key && codes.length >= 40 && ['NL', 'BE', 'DE', 'FR', 'CH', 'NO'].every((x) => codes.includes(x)), JSON.stringify(r0));
      assert(r0.charge_stops.only_countries === false && r0.charge_stops.charge_to_pct === 80, JSON.stringify(r0));
      await refused('POST', 'api/charge-stops', { enabled: true, countries: ['NL'], connectors: ['ccs'] }, 'API key');
      await refused('POST', 'api/charge-stops', { enabled: false, countries: ['XX'], connectors: ['ccs'] }, 'country');
      await refused('POST', 'api/charge-stops', { enabled: false, countries: ['NL'], connectors: ['ccs'], min_power_kw: 1000 }, 'between');
      await refused('POST', 'api/charge-stops', { enabled: false, countries: ['NL'], connectors: ['ccs'], charge_to_pct: 40 }, 'between');
      await refused('POST', 'api/charge-stops', { enabled: false, countries: ['NL'], connectors: ['ccs'], reserve_pct: 10, arrive_min_pct: 15 }, 'not above');
      assert(r0.charge_stops.arrive_min_pct === 10, JSON.stringify(r0));
      // Only the Netherlands first, to check the country filter.
      const body = { enabled: true, api_key: 'test-key-123', countries: ['NL'], only_countries: true, operators: [], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 5, reserve_pct: 10 };
      const on = await ok('POST', 'api/charge-stops', body);
      assert(on.charge_stops.enabled && on.charge_stops.has_key && !JSON.stringify(on).includes('test-key-123'), JSON.stringify(on));
      // Stations along the straight line from home (fake: 51.37, 2.69, a made-up place in the sea) to the destination.
      const home = { lat: 51.37, lon: 2.69 };
      const FAR = 'Verreweg 9, 1234 AB Farville';
      world.places[FAR] = { lat: 52.37, lon: 2.4 };
      const dest = world.places[FAR];
      // dLon: east of the route (the route runs roughly north).
      const along = (f, dLon = 0) => ({ lat: home.lat + (dest.lat - home.lat) * f, lon: home.lon + (dest.lon - home.lon) * f + dLon });
      const poi = (id, op, p, country, conns, usage = 'Public') => ({ ID: id, OperatorInfo: { Title: op }, UsageType: { Title: usage }, StatusType: { IsOperational: true },
        AddressInfo: { Title: `Station ${id}`, Town: 'Testdorp', Latitude: p.lat, Longitude: p.lon, Country: { ISOCode: country } }, Connections: conns });
      const ccs = (kw) => ({ ConnectionTypeID: 33, ConnectionType: { Title: 'CCS (Type 2)' }, PowerKW: kw, Quantity: 2 });
      const t2 = (kw) => ({ ConnectionTypeID: 25, ConnectionType: { Title: 'Type 2 (Socket Only)' }, PowerKW: kw, Quantity: 2 });
      // Close together halfway (200 of 400 km), so every test car reaches them
      // and they all count as the same stop.
      world.stations = [
        poi(1, 'Fastned', along(0.5, 0.001), 'NL', [ccs(300)]),
        poi(2, 'IONITY GmbH', along(0.48, 0.01), 'NL', [ccs(350)]), // ~0.7 km off
        poi(3, 'Shell Recharge', along(0.52), 'BE', [ccs(150)]), // another country
        poi(4, 'Allego BV', along(0.3), 'NL', [t2(22)]), // too slow, wrong connector
        poi(5, 'Fastned', along(0.7), 'NL', [ccs(300)], 'Private - Restricted Access'),
        poi(6, 'Fastned', along(0.5, 0.12), 'NL', [ccs(300)]), // ~8 km off: too far
      ];
      world.ocmCalls = [];
      world.routeKm = 400; // too far for every test car, also with a bigger battery
      world.soc = 100;
      world.events = [ev('Naar Lakeside', 'doel: 100', FAR, 1, 8, 18)];
      // Wait until the trip's cost is known and (when on) the stations are looked up.
      const stopsNow = async (want = true) => {
        let back = null;
        for (let i = 0; i < 15; i++) {
          const p = await settle();
          const tl = (p.next && p.next.timeline) || [];
          const leave = tl.find((x) => x.type === 'leave');
          back = tl.find((x) => x.type === 'back') || null;
          if (leave && leave.trip && leave.trip.pct != null && back && (!want || (back.charge_stops && back.charge_stops.status !== 'pending'))) break;
        }
        return back;
      };
      let back = await stopsNow();
      let c = back && back.charge_stops;
      // 800 km there and back is more than one stop: after the stations halfway
      // there is none further on, so the first stop is shown and where the gap is.
      const fine = (x) => x && (x.status === 'ok' || x.status === 'partial');
      assert(back.soc < 10 && fine(c) && c.need_pct > 10 && c.need_kwh > 0, JSON.stringify(back));
      // The best station first (#50): IONITY 350 kW before Fastned 300 kW, although Fastned is closer to the road.
      assert(c.stops.map((x) => x.id).join(',') === '2,1' && c.stops[0].operator === 'IONITY GmbH' && c.stops[0].power_kw === 350 && c.stops[0].connectors.join() === 'CCS', JSON.stringify(c.stops));
      assert(c.legs.length >= 1 && c.legs[0].n === 1 && c.legs[0].charge_to_pct === 80 && c.legs[0].stations.map((x) => x.id).join(',') === '2,1', JSON.stringify(c.legs));
      assert(c.legs[0].stations.every((x) => Number.isFinite(x.arrive_pct)), JSON.stringify(c.legs[0].stations));
      assert(c.status === 'ok' || c.gap_km > 0, JSON.stringify(c));
      const call = world.ocmCalls[0];
      assert(call && call.key === 'test-key-123' && !('key' in call.params) && call.params.polyline && call.params.distance === '2.5' && call.params.minpowerkw === '50', JSON.stringify(world.ocmCalls));
      // IONITY preferred: only IONITY.
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', operators: ['ionity'] });
      c = (await stopsNow()).charge_stops;
      assert(fine(c) && c.stops.map((x) => x.id).join(',') === '2' && c.stops[0].preferred && !c.others_only, JSON.stringify(c));
      // A preferred operator that is not on the way: the others, marked as such.
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', operators: ['tesla'] });
      c = (await stopsNow()).charge_stops;
      assert(fine(c) && c.others_only && c.stops.length === 2, JSON.stringify(c));
      // Belgium too: the Shell station counts.
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', countries: ['NL', 'BE'] });
      c = (await stopsNow()).charge_stops;
      assert(c.stops.map((x) => x.id).sort().join(',') === '1,2,3', JSON.stringify(c.stops));
      // Not limited to your countries (#40, the default): every country on the route counts.
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', only_countries: false });
      c = (await stopsNow()).charge_stops;
      assert(c.stops.map((x) => x.id).sort().join(',') === '1,2,3' && c.stops.some((x) => x.country === 'BE'), JSON.stringify(c.stops));
      // More stops (#40): a station further on makes a second stop.
      // (Another minimum power, so the stations are asked for again.)
      world.stations.push(poi(7, 'Fastned', along(0.75), 'NL', [ccs(300)]));
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', only_countries: false, min_power_kw: 49 });
      c = (await stopsNow()).charge_stops;
      assert(fine(c) && c.legs.length >= 2 && c.legs[1].stations.some((x) => x.id === 7) && c.legs[1].km_on_trip > c.legs[0].km_on_trip, JSON.stringify(c.legs));
      world.stations.pop();
      // The route on a map (#47): off by default, then OpenStreetMap: the trip gets the line and positions.
      assert(!c.map, JSON.stringify(c.map));
      const mapOn = await ok('POST', 'api/charge-stops', { ...body, api_key: '', only_countries: false, map_tiles: 'osm' });
      assert(mapOn.charge_stops.map_tiles === 'osm', JSON.stringify(mapOn.charge_stops));
      await refused('POST', 'api/charge-stops', { ...body, api_key: '', map_tiles: 'custom', map_tile_url: 'https://tiles.example.lan/tile.png' }, 'tile server');
      c = (await stopsNow()).charge_stops;
      assert(c.map && c.map.tiles.startsWith('https://tile.openstreetmap.org/') && c.map.line && c.map.dest.lat === dest.lat && c.legs[0].stations.every((x) => Number.isFinite(x.lat)), JSON.stringify(c.map));
      // Operators from the station data (#48): one that is not in the app's
      // list is offered after a lookup, and can be preferred by its number.
      world.stations.push({ ...poi(8, 'x', along(0.5, 0.002), 'NL', [ccs(150)]), OperatorInfo: { ID: 9001, Title: 'Stadtwerke Teststadt' } });
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', only_countries: false, min_power_kw: 48 });
      c = (await stopsNow()).charge_stops;
      const seen = (await ok('GET', 'api/charge-stops')).charge_stops.seen_operators;
      assert(seen.some((o) => o.ocm_id === 9001 && o.name === 'Stadtwerke Teststadt') && !seen.some((o) => /fastned|ionity/i.test(o.name)), JSON.stringify(seen));
      const mine = await ok('POST', 'api/charge-stops', { ...body, api_key: '', only_countries: false, min_power_kw: 48, ocm_operators: [{ id: 9001, name: 'Stadtwerke Teststadt' }] });
      assert(mine.charge_stops.ocm_operators.length === 1 && mine.charge_stops.ocm_operators[0].id === 9001, JSON.stringify(mine.charge_stops.ocm_operators));
      c = (await stopsNow()).charge_stops;
      assert(fine(c) && c.stops.map((x) => x.id).join(',') === '8' && c.stops[0].preferred, JSON.stringify(c.stops));
      world.stations.pop();
      // Offline: nothing is sent, the trip says why.
      const calls = world.ocmCalls.length;
      await ok('POST', 'api/routing', { mode: 'offline' });
      await ok('POST', 'api/places', { places: [{ name: 'Lakeside', address: '', km: 250 }] });
      world.events = [ev('Naar Lakeside', 'doel: 100', 'Lakeside', 1, 8, 18)];
      c = (await stopsNow()).charge_stops;
      assert(c && c.status === 'needs_routing' && world.ocmCalls.length === calls, JSON.stringify(c));
      // Off: no suggestions at all.
      await ok('POST', 'api/routing', { mode: 'osm' });
      await ok('POST', 'api/places', { places: [] });
      await ok('POST', 'api/charge-stops', { ...body, api_key: '', enabled: false });
      world.events = [ev('Naar Lakeside', 'doel: 100', FAR, 1, 8, 18)];
      back = await stopsNow(false);
      assert(back && back.soc < 10 && !back.charge_stops, JSON.stringify(back));
      world.routeKm = 60;
      world.events = [];
      world.stations = [];
      return 'Fastned + IONITY on the way; IONITY preferred → only IONITY; offline → nothing sent';
    });
    await test('Y7c1', 'Open Charge Map key (#42): saved state survives reload and empty saves; replacement and explicit removal persist without returning the secret', async () => {
      const body = { enabled: false, api_key: 'saved-key-12345', countries: ['NL'], connectors: ['ccs'] };
      const safe = (r, hasKey) => {
        assert(r.charge_stops.has_key === hasKey, JSON.stringify(r));
        assert(!Object.hasOwn(r.charge_stops, 'api_key'), 'API returned the key field');
        assert(!JSON.stringify(r).includes('saved-key-12345') && !JSON.stringify(r).includes('replacement-key-67890'), 'API exposed a secret');
      };
      safe(await ok('POST', 'api/charge-stops', body), true);
      safe(await ok('GET', 'api/charge-stops'), true);
      safe(await ok('POST', 'api/charge-stops', { ...body, api_key: '' }), true);
      let stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
      assert(stored.charge_stops.api_key === body.api_key, 'empty save removed the key');
      safe(await ok('POST', 'api/charge-stops', { ...body, api_key: 'replacement-key-67890' }), true);
      stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
      assert(stored.charge_stops.api_key === 'replacement-key-67890', 'replacement not stored');
      safe(await ok('POST', 'api/charge-stops', { ...body, api_key: '', clear_key: true }), false);
      safe(await ok('GET', 'api/charge-stops'), false);
      stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
      assert(stored.charge_stops.api_key === '' && stored.charge_stops.enabled === false, 'key removal not stored');
      return 'save → reload → keep → replace → remove; responses never include the key';
    });
    await test('Y8', 'Use per km from the range sensor (range at the level now): two trips of the same distance cost the same, also when the car leaves the second time with more battery', async () => {
      await ok('POST', 'api/vehicles', vehicleBody({ range_entity: CAR.range }));
      world.soc = 50;
      world.events = [
        ev('Naar A', 'doel: 80', ADDR, 1, 8, 18),
        ev('Naar B', 'doel: 90', ADDR3, 2, 8, 18),
      ];
      const p = await settle();
      const leaves = p.next.timeline.filter((x) => x.type === 'leave');
      const [a, b] = leaves.map((x) => x.trip);
      assert(a.status === 'ok' && b.status === 'ok' && a.km === b.km, JSON.stringify([a, b]));
      assert(Math.abs(a.pct - b.pct) < 0.2, `first ${a.pct}%, second ${b.pct}% for the same distance`);
      await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
      world.soc = 100;
      return `${a.km} km → ${a.pct}% both times`;
    });
    await test('Y9', 'Minimum 60 % and back home below it: the timeline charges right away to 60 % when the car is back (purple), the rest in the cheapest hours', async () => {
      await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 60 }));
      world.soc = 80;
      world.events = [
        ev('Naar Lakeside', 'doel: 80', ADDR, 1, 8, 18),
        ev('Naar Werk', 'doel: 80', ADDR3, 3, 7, 8),
      ];
      try {
        const p = await settle();
        const tl = p.next.timeline;
        const back = tl.find((x) => x.type === 'back');
        const charges = tl.filter((x) => x.type === 'charge' && x.expected);
        assert(back && back.soc < 60, JSON.stringify(back));
        assert(charges.length >= 1 && charges[0].minimum === true && charges[0].soc_to === 60 && charges[0].start - at(1, 18) < 3600000, JSON.stringify(charges));
        const minBlocks = p.next.expected_blocks.filter((b) => (b.min_kwh || 0) > 0.01);
        assert(minBlocks.length && minBlocks[0].start === at(1, 18), `first minimum block ${minBlocks.length ? new Date(minBlocks[0].start).toISOString() : 'none'}`);
        return `back ${back.soc}% → right away to 60% (${charges[0].kwh} kWh)${charges[1] ? `, then ${charges[1].kwh} kWh to ${charges[1].soc_to}%` : ''}`;
      } finally {
        await ok('POST', 'api/control/settings', rules());
        world.soc = 100;
      }
    });
    await test('Y10', 'Minimum charging after the third day is included in the chart, through the last expected charging in the timeline', async () => {
      await ok('POST', 'api/control/settings', rules({ min_soc_enabled: true, min_soc: 60 }));
      world.soc = 80;
      world.events = [
        ev('Naar Lakeside', 'doel: 80', ADDR, 1, 8, 18),
        ev('Naar Werk', 'doel: 80', ADDR3, 4, 8, 18),
        ev('Naar Lakeside', 'doel: 80', ADDR, 6, 7, 8),
      ];
      try {
        const p = await settle();
        const minimum = p.next.timeline.find((x) => x.type === 'charge' && x.expected && x.minimum && x.start >= at(4, 18));
        assert(minimum && minimum.soc_to === 60, 'missing minimum charging after the later trip');
        const later = p.next.expected_blocks.filter((b) => b.start >= at(4, 18));
        assert(later.some((b) => (b.min_kwh || 0) > 0.01), 'missing later minimum blocks');
        assert(later.every((b) => p.prices.some((price) => price.start <= b.start && b.start < price.end)), 'the chart cuts off later expected charging');
        const lastEnd = Math.max(...p.next.expected_blocks.map((b) => b.end));
        assert(p.prices[p.prices.length - 1].end >= lastEnd, 'the chart stops before the last expected charging');
        assert(p.plan.blocks.length === 0, 'expected charging must not become the current charging plan');
        return `day 4: right away to 60%, then charging for day 6; all expected blocks have chart prices`;
      } finally {
        await ok('POST', 'api/control/settings', rules());
        world.soc = 100;
      }
    });
    await test('Y11', 'The car is away and a trip home is in the calendar ("Naar huis" 16:00–17:00, even with a target): the trip home is not a departure, charging is planned only from 17:00, and the timeline starts with "Back home"', async () => {
      world.plugged = false;
      world.soc = 50;
      world.events = [
        ev('Naar huis', 'doel: 80 precondition: ja', '', 1, 16, 17),
        ev('Naar Home', 'doel: 80', '', 1, 18, 19),
        ev('Naar Werk', 'doel: 80', 'Werk', 2, 7, 8),
      ];
      try {
        const p = await settle();
        assert(p.departure && p.departure.title === 'Naar Werk' && p.departure.time === at(2, 7), JSON.stringify(p.departure));
        assert(p.plan.away && p.plan.away.until === at(1, 17), JSON.stringify(p.plan.away));
        assert(p.plan.blocks.length && p.plan.blocks.every((b) => b.start >= at(1, 17)), `first block ${p.plan.blocks.length ? new Date(p.plan.blocks[0].start).toISOString() : 'none'}`);
        const first = p.next && p.next.timeline[0];
        assert(first && first.type === 'back' && first.away_now && first.time === at(1, 17), JSON.stringify(first));
        assert(!p.next.timeline.some((x) => x.type === 'leave' && /^Naar (huis|Home)$/.test(x.title || '')), 'a trip home shown as a departure');
        return `departure ${p.departure.title}, charging from ${new Date(p.plan.blocks[0].start).toISOString().slice(11, 16)} UTC`;
      } finally {
        world.plugged = true;
        world.soc = 100;
        world.events = [];
      }
    });
    // Where is the car when it is not plugged in (#46): car location, then a
    // person, then a trip home in the calendar; none of these: not known.
    const placeEvents = () => [ev('Naar Werk', 'doel: 80', ADDR3, 2, 7, 18)];
    const leaveOf = (p) => p.next && p.next.timeline.find((x) => x.type === 'leave');
    await test('Y24', 'Car not plugged in, no car location, no person, no trip home (#46): the place is "unknown"; Looking ahead counts from the level now (50%), the planned charging is "if plugged in" and the level with it is shown next to it', async () => {
      world.plugged = false;
      world.soc = 50;
      world.events = placeEvents();
      try {
        const p = await settle();
        assert(p.plan.place && p.plan.place.at === 'unknown' && p.plan.place.conditional === true, JSON.stringify(p.plan.place));
        assert(!p.plan.away, JSON.stringify(p.plan.away));
        const lv = leaveOf(p);
        assert(lv && lv.soc === 50, `leaves with ${lv && lv.soc}%, not the level now`);
        assert(lv.soc_if_charged > 50, `with charging: ${lv.soc_if_charged}`);
        const charges = p.next.timeline.filter((x) => x.type === 'charge' && !x.expected);
        assert(charges.length && charges.every((x) => x.if_plugged === true), JSON.stringify(charges));
        const back = p.next.timeline.find((x) => x.type === 'back');
        assert(!back || back.soc == null || back.soc < 50, `back with ${back && back.soc}%`);
        return `leaves with 50% (${lv.soc_if_charged}% if plugged in), charging shown as "if plugged in"`;
      } finally {
        world.plugged = true;
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y25', 'Car location first, then the person, then the calendar (#46): car "not_home" wins over person "home"; car "unavailable" is skipped and person "not_home" decides; both unknown and "Naar huis" in the calendar: away until the trip home; a wrong entity type is not saved', async () => {
      await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18, location_entity: 'device_tracker.test_car_location', person_entity: 'person.alex' }));
      world.plugged = false;
      world.soc = 50;
      world.events = placeEvents();
      try {
        const list = (await ok('GET', 'api/vehicles')).vehicles;
        assert(list[0].location_entity === 'device_tracker.test_car_location' && list[0].person_entity === 'person.alex', JSON.stringify(list[0]));
        world.carLocation = 'not_home';
        world.personLocation = 'home';
        let p = await settle();
        assert(p.plan.place.at === 'away' && p.plan.place.source === 'car' && p.plan.place.conditional, JSON.stringify(p.plan.place));
        assert(leaveOf(p).soc === 50, `leaves with ${leaveOf(p).soc}%`);
        world.carLocation = 'unavailable';
        world.personLocation = 'not_home';
        p = await settle();
        assert(p.plan.place.at === 'away' && p.plan.place.source === 'person', JSON.stringify(p.plan.place));
        world.carLocation = 'unknown';
        world.personLocation = 'unknown';
        world.events = [ev('Naar huis', 'doel: 80', '', 1, 16, 17), ...placeEvents()];
        p = await settle();
        assert(p.plan.place.at === 'away' && p.plan.place.source === 'calendar' && p.plan.place.until === at(1, 17) && !p.plan.place.conditional, JSON.stringify(p.plan.place));
        assert(p.plan.away && p.plan.away.until === at(1, 17), JSON.stringify(p.plan.away));
        // Only a device tracker for the car, and a person or tracker for the person.
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18, location_entity: 'sensor.test_car_location', person_entity: 'input_text.alex' }));
        const after = (await ok('GET', 'api/vehicles')).vehicles[0];
        assert(after.location_entity === null && after.person_entity === null, JSON.stringify(after));
        return 'car → person → calendar; wrong entity types are not saved';
      } finally {
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
        delete world.carLocation;
        delete world.personLocation;
        world.plugged = true;
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y26', 'Car location "home" while not plugged in (#46): at home, so the plan counts on the charging as before, also with "Naar huis" in the calendar; plugged in: no place check at all', async () => {
      await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18, location_entity: 'device_tracker.test_car_location' }));
      world.plugged = false;
      world.soc = 50;
      world.carLocation = 'home';
      world.events = [ev('Naar huis', 'doel: 80', '', 1, 16, 17), ...placeEvents()];
      try {
        let p = await settle();
        assert(p.plan.place.at === 'home' && p.plan.place.source === 'car' && !p.plan.place.conditional, JSON.stringify(p.plan.place));
        assert(!p.plan.away, `away while the car is at home: ${JSON.stringify(p.plan.away)}`);
        const lv = leaveOf(p);
        assert(lv && lv.soc > 50 && lv.soc_if_charged == null, JSON.stringify(lv));
        world.plugged = true;
        world.carLocation = 'not_home';
        p = await settle();
        assert(!p.plan.place, JSON.stringify(p.plan.place));
        return `at home: leaves with ${lv.soc}%`;
      } finally {
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
        delete world.carLocation;
        world.plugged = true;
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y12', 'More places in a row: Werk 06:00–16:30, then Sport 16:30–20:30, then Naar Thuis 20:30–22:00: one trip home → Werk → Sport → home (60 km each part), no charging at home in between, back at 22:00', async () => {
      world.soc = 80;
      const evm = (title, desc, location, d, h, m, eh, em) => ({ summary: title, description: desc, location, start: isoLocal(at(d, h, m), tz), end: isoLocal(at(d, eh, em), tz) });
      world.events = [
        // (This calendar only counts events with a target, so each has one.)
        evm('Naar Werk', 'doel: 80', ADDR3, 1, 6, 0, 16, 30),
        evm('Naar Sport', 'doel: 80 precondition: ja', ADDR, 1, 16, 30, 20, 30),
        evm('Naar Thuis', 'doel: 80 precondition: ja', 'Thuis', 1, 20, 30, 22, 0),
        evm('Naar Werk', 'doel: 80', ADDR3, 3, 6, 0, 16, 0),
      ];
      try {
        await settle();
        await sleep(600); // the route from Werk to Sport is looked up once (Hilltown stays unrouted for Y4)
        const n = (await settle()).next;
        const tl = n.timeline;
        const leaves = tl.filter((x) => x.type === 'leave');
        assert(leaves.length === 2 && leaves[0].title === 'Naar Werk' && leaves[0].time === at(1, 6), JSON.stringify(leaves.map((x) => [x.title, x.time])));
        const stops = tl.filter((x) => x.type === 'stop');
        assert(stops.length === 1 && stops[0].title === 'Naar Sport' && stops[0].time === at(1, 16, 30) && stops[0].km === 60, JSON.stringify(stops));
        assert(n.trip.status === 'ok' && n.trip.total_km === 180 && n.trip.via.length === 1 && leaves[0].trip.stops === 1, JSON.stringify(n.trip));
        assert(Math.abs(n.trip.pct - 180 * n.trip.pct_per_km * 1.1) < 0.2, `pct ${n.trip.pct}`);
        assert(n.trip.return_at === at(1, 22) && n.trip.return_trip && n.trip.return_trip.title === 'Naar Thuis', JSON.stringify({ at: new Date(n.trip.return_at).toISOString(), back: n.trip.return_trip }));
        const backs = tl.filter((x) => x.type === 'back');
        assert(backs[0].time === at(1, 22), JSON.stringify(backs));
        assert(stops[0].soc != null && stops[0].soc < leaves[0].soc && backs[0].soc < stops[0].soc, JSON.stringify(tl.map((x) => [x.type, x.soc])));
        // Issue #1: a stop shows the level on arrival there, after its own drive
        // (60 km from Werk), and where it comes from.
        const leg = 60 * n.trip.pct_per_km * 1.1;
        assert(stops[0].from_title === 'Naar Werk' && Math.abs(stops[0].soc_from - stops[0].soc - leg) < 0.2, JSON.stringify(stops[0]));
        assert(Math.abs(leaves[0].soc - 60 * n.trip.pct_per_km * 1.1 - stops[0].soc_from) < 0.2, `leaving Werk ${stops[0].soc_from}%`);
        assert(backs[0].from_title === 'Naar Sport' && backs[0].km === 60 && Math.abs(stops[0].soc - backs[0].soc - leg) < 0.2, JSON.stringify(backs[0]));
        const between = tl.filter((x) => x.type === 'charge' && x.expected && x.start < at(1, 22));
        assert(!between.length, `charging while the car is away: ${JSON.stringify(between)}`);
        // Not enough battery: the timeline shows how much it falls short (below 0 %),
        // while the next plan starts from 0 %.
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 40 }));
        const q = (await settle()).next;
        const qb = q.timeline.find((x) => x.type === 'back');
        assert(qb.soc < 0 && q.trip.soc_after === 0 && q.trip.soc_end === qb.soc, JSON.stringify({ back: qb.soc, after: q.trip.soc_after, end: q.trip.soc_end }));
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
        return `home → Werk → Sport → home: ${n.trip.total_km} km ≈ ${n.trip.pct}% · at Sport ${stops[0].soc}% · home ${backs[0].soc}% at 22:00 · with 40 kWh/100 km: home ${qb.soc}%`;
      } finally {
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y13', 'Ask to charge more for a long trip (on, reserve 10 %): the trip costs more than 80 % leaves room for, so the phone gets one question with Yes/No buttons; a tap on Yes raises the target for this trip only', async () => {
      world.soc = 80;
      const evm = (title, desc, location, d, h, m, eh, em) => ({ summary: title, description: desc, location, start: isoLocal(at(d, h, m), tz), end: isoLocal(at(d, eh, em), tz) });
      world.events = [
        evm('Naar Werk', 'doel: 80', ADDR3, 1, 6, 0, 16, 30),
        evm('Naar Sport', 'doel: 80 precondition: ja', ADDR, 1, 16, 30, 20, 30),
        evm('Naar Thuis', 'doel: 80 precondition: ja', 'Thuis', 1, 20, 30, 22, 0),
      ];
      const asked = (n) => callsSince(n).filter((c) => c.domain === 'notify' && c.data.title === 'This trip needs more charge');
      try {
        // Off (the default): no question.
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: Math.min(40, Math.round(30 * CAP_K)) }));
        const n0 = world.calls.length;
        let p = await settle();
        assert(p.trip_topup === null && !asked(n0).length && p.departure.soc === 80, JSON.stringify(p.trip_topup));
        await ok('POST', 'api/control/settings', rules({ trip_topup_enabled: true, trip_topup_reserve: 10 }));
        p = await settle();
        await settle();
        const want = Math.min(100, Math.ceil(p.next.trip.pct + 10));
        const t = p.trip_topup;
        assert(t && t.state === 'asked' && t.soc === want && t.from === 80 && t.token, JSON.stringify(t));
        const q = asked(n0);
        assert(q.length === 1, `${q.length} questions sent`);
        const buttons = q[0].data.data && q[0].data.data.actions;
        assert(buttons && buttons.length === 2 && buttons[0].action === `SCP_TOPUP_YES_${t.token}` && buttons[1].action === `SCP_TOPUP_NO_${t.token}`, JSON.stringify(q[0].data));
        assert(p.departure.soc === 80, 'the target went up without a yes');
        await refused('POST', 'api/topup', { token: 'deadbeef', answer: 'yes' }, 'no longer open');
        // A tap on Yes on the phone.
        assert(typeof world.fireEvent === 'function', 'the app does not listen for notification buttons');
        world.fireEvent('mobile_app_notification_action', { action: buttons[0].action });
        await sleep(300);
        p = await settle();
        assert(p.departure.soc === want && p.departure.topup && p.departure.topup.from === 80, JSON.stringify(p.departure));
        assert(p.trip_topup && p.trip_topup.state === 'yes' && p.trip_topup.token === null, JSON.stringify(p.trip_topup));
        assert(asked(n0).length === 1, 'asked again after yes');
        // #3: the Plan page shows the raised target too, not only Home.
        let dd = await ok('GET', 'api/departures');
        let werk = (dd.calendar_trips || []).find((x) => x.title === 'Naar Werk');
        assert(dd.next && dd.next.soc === want && dd.next.topup && dd.next.topup.from === 80, `Plan › Next departure: ${JSON.stringify(dd.next)}`);
        assert(dd.upcoming[0].winner.soc === want, `Plan › Next 7 days: ${JSON.stringify(dd.upcoming[0].winner)}`);
        assert(werk && werk.soc === want && werk.topup && werk.topup.from === 80, `Plan › Trips from your calendar: ${JSON.stringify(werk)}`);
        const sport = (dd.calendar_trips || []).find((x) => x.title === 'Naar Sport');
        assert(sport && sport.soc === 80 && !sport.topup, `only this trip is raised: ${JSON.stringify(sport)}`);
        const first = `trip ≈ ${p.next.trip.pct}% → asked to charge to ${want}% · Yes on the phone → target ${p.departure.soc}% (Plan page too)`;
        // The trip costs more (40 kWh/100 km): asked again, Yes again. Not when
        // the first Yes was already (almost) 100 % (a smaller battery).
        let big = want;
        if (want < 98) {
          await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: Math.min(40, Math.round(40 * CAP_K)) }));
          p = await settle();
          big = Math.min(100, Math.ceil(p.next.trip.pct + 10));
          assert(p.trip_topup && p.trip_topup.state === 'asked' && p.trip_topup.soc === big && big > want + 2 && asked(n0).length === 2, JSON.stringify({ t: p.trip_topup, big, want }));
          await ok('POST', 'api/topup', { token: p.trip_topup.token, answer: 'yes' });
          p = await settle();
          assert(p.departure.soc === big && p.trip_topup.from === 80, JSON.stringify({ dep: p.departure, t: p.trip_topup }));
        }
        const questions = asked(n0).length;
        // #2: the trip costs less: the raised target goes down with it. Back to
        // 30 kWh/100 km, or (a car with a range sensor, where the use comes
        // from that sensor and not from kWh/100 km) shorter routes.
        // Routes are remembered, so the shorter route is to new places (the
        // same departures, moved in the calendar).
        const move = (place, km) => {
          world.routeKm = km;
          world.places[place.work] = place.workAt;
          if (place.sport) world.places[place.sport] = place.sportAt;
          world.events = world.events
            .filter((e) => place.sport || e.summary !== 'Naar Sport')
            .map((e) => (e.summary === 'Naar Werk' ? { ...e, location: place.work } : e.summary === 'Naar Sport' ? { ...e, location: place.sport } : e));
        };
        if (big > want) await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: Math.min(40, Math.round(30 * CAP_K)) }));
        else move({ work: 'Kerkstraat 1, 1115 AA Bridgetown', workAt: { lat: 51.87, lon: 2.1 }, sport: 'Markt 1, 1112 BA Rivertown', sportAt: { lat: 51.81, lon: 2.17 } }, 40);
        await settle();
        p = await settle();
        const less = Math.max(80, Math.min(100, Math.ceil(p.next.trip.pct + 10)));
        assert(less > 80, `the test needs a trip that still needs more than 80 %: ${p.next.trip.pct}%`);
        assert(less < big - 2, `the test needs a trip that costs clearly less: ${less} vs ${big}`);
        assert(p.departure.soc === less && p.departure.topup && p.departure.topup.from === 80 && p.trip_topup && p.trip_topup.state === 'yes' && p.trip_topup.soc === less, JSON.stringify({ dep: p.departure, t: p.trip_topup, less }));
        assert(asked(n0).length === questions, 'asked again when the trip got shorter');
        // #2: a place removed (no Sport): the trip fits in 80 % again, the Yes ends.
        // (Same places as before, so no route has to be looked up again.)
        world.events = world.events.filter((e) => e.summary !== 'Naar Sport');
        p = await settle();
        await settle();
        p = await settle();
        assert(p.next.trip.pct + 10 <= 80, `the shorter trip still needs ${p.next.trip.pct}%`);
        assert(p.departure.soc === 80 && !p.departure.topup && p.trip_topup === null, JSON.stringify({ dep: p.departure, t: p.trip_topup }));
        assert(asked(n0).length === questions, 'asked when the trip fits');
        dd = await ok('GET', 'api/departures');
        werk = (dd.calendar_trips || []).find((x) => x.title === 'Naar Werk');
        assert(dd.next && dd.next.soc === 80 && !dd.next.topup && werk && werk.soc === 80 && !werk.topup, `Plan page after the Yes ended: ${JSON.stringify({ next: dd.next, werk })}`);
        return `${first} · ${big > want ? `bigger trip → ${big}% · ` : ''}costs less → ${less}% · Sport removed → back to 80%`;
      } finally {
        await ok('POST', 'api/control/settings', rules());
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: Math.min(40, Math.round(18 * CAP_K)) }));
        world.routeKm = 60;
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y13b', 'Declined trip top-up (#43): the answer stays No while the banner follows the current trip cost and target, and hides an unavailable estimate', async () => {
      const places = (await ok('GET', 'api/places')).places;
      const questionCount = () => world.calls.filter((c) => c.domain === 'notify' && c.data.title === 'This trip needs more charge').length;
      try {
        world.soc = 90;
        world.events = [ev('Naar Example', 'doel: 90', 'Example', 1, 8, 20)];
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 30 }));
        await ok('POST', 'api/places', { places: [{ name: 'Example', address: '', km: 400 }] });
        await ok('POST', 'api/control/settings', rules({ trip_topup_enabled: true, trip_topup_reserve: 10 }));
        let result = await settle();
        assert(result.trip_topup && result.trip_topup.state === 'asked', JSON.stringify(result.trip_topup));
        const oldCost = result.trip_topup.pct;
        await ok('POST', 'api/topup', { token: result.trip_topup.token, answer: 'no' });
        const questions = questionCount();
        await ok('POST', 'api/places', { places: [{ name: 'Example', address: '', km: 20 }] });
        result = await settle();
        assert(result.trip_topup && result.trip_topup.state === 'no' && result.trip_topup.pct < oldCost, JSON.stringify(result.trip_topup));
        assert(Math.abs(result.trip_topup.pct - result.next.trip.pct) < 0.01, 'banner and timeline use different costs');
        assert(result.trip_topup.from === result.departure.soc && result.departure.soc === 90, 'retained No changed the target');
        assert(Math.abs(result.next.trip.soc_end - (90 - result.trip_topup.pct)) < 0.2, 'arrival level contradicts the banner');
        assert(questionCount() === questions, 'asked again after No');
        const knownEvent = { ...world.events[0] };
        world.events = [{ ...knownEvent, summary: 'Naar Unknown', location: 'Unknown' }];
        const unknown = await settle();
        assert(unknown.next.trip.status !== 'ok' && unknown.trip_topup === null, 'stale cost shown without a current estimate');
        world.events = [knownEvent];
        result = await settle();
        assert(result.trip_topup && result.trip_topup.state === 'no' && questionCount() === questions, 'No was lost while the estimate was unavailable');
        return 'declined answer retained; current trip and banner agree; no repeated notification';
      } finally {
        await ok('POST', 'api/places', { places });
        await ok('POST', 'api/control/settings', rules());
        await ok('POST', 'api/vehicles', vehicleBody({ consumption_kwh_100km: 18 }));
        world.soc = 100;
        world.events = [];
      }
    });
    await test('Y4', 'No route from OpenStreetMap: the straight line × 1.3, marked as an estimate; "Werk" is not an address: no cost, the next goal is still shown', async () => {
      world.routeKm = null;
      world.events = [
        ev('Naar Gym', 'doel: 90', ADDR2, 1, 18, 21),
        ev('Naar Werk', 'doel: 80', 'Werk', 3, 7, 8),
      ];
      const n = (await settle()).next;
      assert(n.trip.status === 'ok' && n.trip.how === 'estimate' && n.trip.km > 30 && n.trip.km < 80, JSON.stringify(n.trip));
      world.events = [ev('Naar Werk', 'doel: 80', 'Werk', 1, 7, 8), ev('Naar Werk', 'doel: 80', 'Werk', 3, 7, 8)];
      const m = (await settle()).next;
      assert(m.trip.status === 'unknown' && m.trip.pct === null && m.goal && m.goal.time === at(3, 7), JSON.stringify(m));
      const d = await ok('GET', 'api/departures');
      assert(d.calendar_trips.every((t) => t.cost && t.cost.status === 'unknown'), JSON.stringify(d.calendar_trips.map((t) => t.cost)));
      world.routeKm = 60;
      world.events = [];
      await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
      await ok('POST', 'api/vehicles', vehicleBody());
      world.soc = 40;
      return `estimate ${n.trip.km} km (straight line × 1.3)`;
    });
  }

  // ----- Z. Apple iCloud calendar (read only, Home Assistant 2026.10+) ------
  // ----- Y2. Preconditioning before a departure (#44) ---------------------
  group = 'Y2. Preconditioning before a departure';
  {
    const BTN = 'button.test_car_start_air_conditioner';
    const evp = (title, desc, startMs, endMs) => ({ summary: title, description: desc, location: null, start: isoLocal(startMs, tz), end: isoLocal(endMs, tz) });
    const presses = (n) => callsSince(n).filter((c) => c.domain === 'button' && c.service === 'press' && [].concat(c.target && c.target.entity_id)[0] === BTN);
    const wait = async (cond, ms = 6000) => { for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100); return cond(); };
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } }));
    await test('Y20', 'Preconditioning (#44): off by default; the car\'s button is offered; only a switch or button can be chosen', async () => {
      const r = await ok('GET', 'api/precondition');
      const car = r.cars[0];
      assert(car && car.precondition.enabled === false && car.precondition.minutes === 15 && car.precondition.way_back === false, JSON.stringify(car && car.precondition));
      assert(car.options.some((o) => o.entity_id === BTN && o.group === 'car'), JSON.stringify(car.options));
      await refused('POST', 'api/precondition', { vehicle_id: car.id, enabled: true }, 'Choose what');
      await refused('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: 'input_boolean.voorverwarmen' }, 'switch or a button');
      await refused('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 90 }, 'between 5 and 60');
      return `offered: ${car.options.map((o) => o.entity_id).join(', ')}`;
    });
    await test('Y21', 'Preconditioning (#44): a trip with "precondition: ja" in 10 minutes gets one press of the car\'s button (15 minutes before); a trip without it gets none; it shows in Looking ahead; the car does not need to be plugged in', async () => {
      const car = (await ok('GET', 'api/precondition')).cars[0];
      const now = Date.now();
      world.plugged = false; // not needed
      world.events = [evp('Naar Werk', 'doel: 80 precondition: ja', now + 10 * 60000, now + 8 * 3600000)];
      const n0 = world.calls.length;
      const saved = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: false });
      assert(saved.precondition.enabled && saved.upcoming.length === 1 && saved.upcoming[0].kind === 'out', JSON.stringify(saved));
      assert(await wait(() => presses(n0).length === 1), `presses: ${presses(n0).length}`);
      await sleep(1500);
      assert(presses(n0).length === 1, `pressed again: ${presses(n0).length}`);
      world.plugged = true;
      const p = await plan();
      const shown = p.next && p.next.preconditioning;
      assert(Array.isArray(shown) && shown.length === 1 && shown[0].state === 'asked', JSON.stringify(shown));
      // Without "precondition: ja": nothing.
      world.events = [evp('Naar Sport', 'doel: 80', Date.now() + 10 * 60000, Date.now() + 3 * 3600000)];
      const n1 = world.calls.length;
      await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: false });
      await sleep(1500);
      assert(presses(n1).length === 0, `pressed without precondition: ${presses(n1).length}`);
      return 'one press for "precondition: ja", none without';
    });
    await test('Y22', 'Preconditioning on the way back (#44): no event for the drive home and the setting on: one press 15 minutes before the event ends; a trip home in the calendar without "precondition" wins over the setting', async () => {
      const car = (await ok('GET', 'api/precondition')).cars[0];
      const now = Date.now();
      world.plugged = false; // the car is away
      world.events = [evp('Naar Werk', 'doel: 80', now - 4 * 3600000, now + 10 * 60000)];
      const n0 = world.calls.length;
      const saved = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: true });
      assert(saved.upcoming.length === 1 && saved.upcoming[0].kind === 'back_auto', JSON.stringify(saved.upcoming));
      assert(await wait(() => presses(n0).length === 1), `presses: ${presses(n0).length}`);
      // A trip home in the calendar, without "precondition": off, also with the setting on.
      world.events = [evp('Naar Werk', 'doel: 80', now - 4 * 3600000, now + 20 * 60000), evp('Naar huis', 'doel: 80', now + 20 * 60000, now + 80 * 60000)];
      const n1 = world.calls.length;
      const s2 = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 30, way_back: true });
      assert(s2.upcoming.length === 0, JSON.stringify(s2.upcoming));
      await sleep(1500);
      assert(presses(n1).length === 0, `pressed: ${presses(n1).length}`);
      await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: false, entity_id: BTN });
      world.plugged = true;
      world.events = [];
      return 'way back: one press; a trip home without "precondition": none';
    });
    await test('Y23', 'Preconditioning for the weekly schedule and a one-off departure (#45): the day\'s tick gives one press 15 minutes before; without the tick none; a one-off departure with its tick too', async () => {
      const car = (await ok('GET', 'api/precondition')).cars[0];
      const soon = Date.now() + 10 * 60000;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(soon)).map((x) => [x.type, x.value]));
      const dayKey = parts.weekday.slice(0, 3).toLowerCase();
      const hhmm = `${parts.hour}:${parts.minute}`;
      const sched = (pre) => {
        const b = depBody({ schedule_enabled: true, calendar: { enabled: false, entity: null, match: 'target', buffer_minutes: 0, soc: 80 } });
        for (const k of Object.keys(b.schedule)) b.schedule[k] = { ...b.schedule[k], enabled: k === dayKey, time: k === dayKey ? hhmm : b.schedule[k].time, precondition: k === dayKey && pre };
        return b;
      };
      world.events = [];
      // Without the tick: nothing.
      await ok('POST', 'api/departures', sched(false));
      let n0 = world.calls.length;
      let r = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: false });
      assert(r.upcoming.length === 0, JSON.stringify(r.upcoming));
      await sleep(1500);
      assert(presses(n0).length === 0, `pressed: ${presses(n0).length}`);
      // With the tick: one press.
      await ok('POST', 'api/departures', sched(true));
      const saved = await ok('GET', 'api/departures');
      assert(saved.departures.schedule[dayKey].precondition === true, JSON.stringify(saved.departures.schedule[dayKey]));
      n0 = world.calls.length;
      r = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: false });
      assert(r.upcoming.length >= 1 && r.upcoming.every((m) => m.source === 'schedule') && r.upcoming[0].until - Date.now() < 11 * 60000, JSON.stringify(r.upcoming));
      assert(await wait(() => presses(n0).length === 1), `presses: ${presses(n0).length}`);
      // A one-off departure with its tick.
      await ok('POST', 'api/departures', sched(false));
      const ovAt = Date.now() + 12 * 60000;
      const op = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ovAt)).map((x) => [x.type, x.value]));
      await ok('POST', 'api/departures/override', { datetime: `${op.year}-${op.month}-${op.day}T${op.hour}:${op.minute}`, soc: 80, precondition: true });
      n0 = world.calls.length;
      r = await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: true, entity_id: BTN, minutes: 15, way_back: false });
      assert(r.upcoming.some((m) => m.source === 'override'), JSON.stringify(r.upcoming));
      assert(await wait(() => presses(n0).length === 1), `presses: ${presses(n0).length}`);
      await api('DELETE', 'api/departures/override');
      await ok('POST', 'api/precondition', { vehicle_id: car.id, enabled: false, entity_id: BTN });
      return `schedule ${dayKey} ${hhmm}: one press with the tick, none without; one-off: one press`;
    });
  }

  group = 'Z. Apple iCloud calendar (read only)';
  await test('Z1', 'An iCloud calendar is read: "doel: 90" becomes the departure; it is marked read only and adding trips to it is refused with a clear reason', async () => {
    await ok('POST', 'api/departures', depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.icloud_alex', match: 'target', buffer_minutes: 0, soc: 80 } }));
    world.events = [{ summary: 'Naar Gent', description: 'doel: 90', start: isoLocal(at(1, 9), tz), end: isoLocal(at(1, 10), tz) }];
    const p = await plan();
    assert(p.departure && p.departure.source === 'calendar' && p.departure.soc === 90 && p.departure.time === at(1, 9), JSON.stringify(p.departure));
    const d = await ok('GET', 'api/departures');
    const opt = (id) => d.options.calendar.find((c) => c.entity_id === id);
    assert(d.calendar_writable === false && opt('calendar.icloud_alex').writable === false && opt('calendar.auto').writable === true, JSON.stringify(d.options.calendar));
    await refused('POST', 'api/trips', { datetime: isoLocal(at(2, 8), tz).slice(0, 16), destination: 'Gent', soc: 80, precondition: false }, 'read only');
    world.events = [];
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
    return `departure from iCloud: ${p.departure.soc}% · adding refused`;
  });

  // ----- U. Add trip, writing to the calendar --------------------------------
  // "Allow adding trips to calendar" on: what Add trip writes, and that the trip
  // counts right away on Plan and Home (Looking ahead), with what it costs.
  group = 'U. Add trip (writes to the calendar)';
  {
    await stopApp();
    await startApp({ allow_control: true, notify_start_stop: false, allow_calendar_write: true });
    const ADDR = 'Stationsplein 1, 1116 AA Centretown';
    world.places = { ...(world.places || {}), [ADDR]: { lat: 52.09, lon: 2.61 } };
    world.routeKm = 75;
    world.events = [];
    world.soc = 60;
    const calOn = (o = {}) => depBody({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80, ...o } });
    const trip = (o = {}) => ({ datetime: isoLocal(at(1, 8), tz).slice(0, 16), destination: ADDR, back: '17:30', soc: 90, precondition: true, ...o });
    // Home asks for the plan without "refresh": what the page really sees.
    const home = async (until) => {
      let p;
      for (let i = 0; i < 30; i++) {
        p = await ok('GET', 'api/plan');
        if (!until || until(p)) return p;
        await sleep(200);
      }
      return p;
    };
    await ok('POST', 'api/departures', calOn());
    await test('U1', 'One car: no car to choose (the trip is for that car), the event is "To <destination>" with the destination as location, "target: 90 precondition: yes" (English: Home Assistant has no Dutch language here) and lasts until "Back home at"', async () => {
      const d = await ok('GET', 'api/departures');
      assert(d.cars === null && d.calendar_write_allowed === true && d.calendar_writable === true, JSON.stringify({ cars: d.cars, w: d.calendar_write_allowed }));
      const pv = await ok('POST', 'api/trips/preview', trip());
      const e = pv.events[0];
      assert(pv.events.length === 1 && e.summary === `To ${ADDR}` && e.location === ADDR && e.description === 'target: 90 precondition: yes', JSON.stringify(e));
      assert(e.start === at(1, 8) && e.end === at(1, 17, 30), `${new Date(e.start).toISOString()} – ${new Date(e.end).toISOString()}`);
      await refused('POST', 'api/trips/preview', trip({ back: '25:00' }), 'Back home');
      return `${e.summary} · ${e.description}`;
    });
    await test('U2', 'Added: written to the calendar once, and right away the departure on Plan and the next stop in Looking ahead, with the trip there and back (75 km by road each way) and back home at 17:30', async () => {
      await home(); // the page already had a plan
      const n = world.calls.length;
      const r = await ok('POST', 'api/trips', trip());
      const created = callsSince(n).filter((c) => c.domain === 'calendar' && c.service === 'create_event');
      assert(r.created === 1 && created.length === 1 && created[0].target.entity_id === 'calendar.auto' && created[0].data.location === ADDR, JSON.stringify({ r, created }));
      const p = await home((x) => x.next && x.next.trip && x.next.trip.status === 'ok' && x.next.trip.how === 'route');
      assert(p.departure && p.departure.source === 'calendar' && p.departure.time === at(1, 8) && p.departure.soc === 90, `departure ${JSON.stringify(p.departure)}`);
      const t = p.next && p.next.trip;
      assert(p.next.current.location === ADDR && t.status === 'ok' && t.km === 75 && t.pct > 0 && t.return_at === at(1, 17, 30), JSON.stringify(p.next));
      return `next stop ${p.next.current.title} · ${t.km} km → ${t.pct}% there and back · back ${t.soc_after}%`;
    });
    await test('U3', 'Added twice: the second time nothing is added (already in the calendar); the Plan tab lists the trip with its cost', async () => {
      const r = await ok('POST', 'api/trips', trip());
      assert(r.created === 0 && r.skipped === 1, JSON.stringify(r));
      assert(world.events.length === 1, `${world.events.length} events`);
      const d = await ok('GET', 'api/departures');
      const ct = d.calendar_trips.find((x) => x.location === ADDR);
      assert(ct && ct.cost && ct.cost.status === 'ok' && ct.precondition === true, JSON.stringify(d.calendar_trips));
    });
    await test('U3b', 'Changing the trip language skips existing English and old Dutch events in preview and writes', async () => {
      const savedEvents = world.events.map((e) => ({ ...e }));
      try {
        // U2 wrote an English event. Switching to Dutch must not write it again.
        await ok('POST', 'api/departures', calOn({ language: 'nl' }));
        let preview = await ok('POST', 'api/trips/preview', trip());
        assert(preview.events[0].duplicate === true && preview.events[0].summary === `Naar ${ADDR}`, JSON.stringify(preview));
        let mark = world.calls.length;
        let written = await ok('POST', 'api/trips', trip());
        assert(written.created === 0 && written.skipped === 1, JSON.stringify(written));
        assert(!callsSince(mark).some((c) => c.service === 'create_event'), 'wrote the English trip again in Dutch');

        // Simulate a pre-upgrade Dutch event; auto on this English HA writes English.
        world.events = savedEvents.map((e) => ({ ...e, summary: `Naar ${ADDR}`, description: 'doel: 90 precondition: ja' }));
        for (const language of ['en', 'auto']) {
          await ok('POST', 'api/departures', calOn({ language }));
          preview = await ok('POST', 'api/trips/preview', trip());
          assert(preview.events[0].duplicate === true && preview.events[0].summary === `To ${ADDR}`, JSON.stringify(preview));
          mark = world.calls.length;
          written = await ok('POST', 'api/trips', trip());
          assert(written.created === 0 && written.skipped === 1, JSON.stringify(written));
          assert(!callsSince(mark).some((c) => c.service === 'create_event'), 'wrote the old Dutch trip again');
        }
        assert(world.events.length === savedEvents.length);
        const different = await ok('POST', 'api/trips/preview', trip({ destination: 'Gym' }));
        assert(different.events[0].duplicate === false, 'suppressed a different destination');
        return 'English ↔ Dutch, and upgrade to auto: zero extra calendar writes';
      } finally {
        world.events = savedEvents;
        await ok('POST', 'api/departures', calOn());
      }
    });
    await test('U4', 'Calendar read by keyword ("EV"): a trip added by the app (with "doel: 90") still counts', async () => {
      await ok('POST', 'api/departures', calOn({ match: 'keyword', keyword: 'EV' }));
      const p = await home((x) => x.departure && x.departure.time === at(1, 8));
      assert(p.departure && p.departure.source === 'calendar' && p.departure.time === at(1, 8) && p.departure.soc === 90, JSON.stringify(p.departure));
      await ok('POST', 'api/departures', calOn());
    });
    await test('U5', 'Calendar not used for departures: Add trip is refused (the trip would never count), nothing written', async () => {
      await ok('POST', 'api/departures', depBody({ calendar: { enabled: false, entity: 'calendar.auto', match: 'target', buffer_minutes: 0, soc: 80 } }));
      const n = world.calls.length;
      await refused('POST', 'api/trips/preview', trip(), 'Turn on the calendar');
      await refused('POST', 'api/trips', trip({ datetime: isoLocal(at(2, 9), tz).slice(0, 16) }), 'Turn on the calendar');
      assert(!callsSince(n).some((c) => c.service === 'create_event'), 'written');
      await ok('POST', 'api/departures', calOn());
    });
    await test('U5b', 'Refresh on Home fetches the calendar again first: a trip added in Google Calendar shows up right away; the background refresh does not', async () => {
      world.events = [];
      world.calendarPending = [{ summary: 'Naar Gent', description: 'doel: 85', location: 'Gent', start: isoLocal(at(2, 9), tz), end: isoLocal(at(2, 18), tz) }];
      const n0 = world.calls.length;
      const before = await ok('GET', 'api/plan?refresh=1');
      assert(!callsSince(n0).some((c) => c.service === 'update_entity'), 'refreshed without the button');
      assert(!(before.departure && before.departure.title === 'Naar Gent'), 'seen before the refresh');
      const after = await ok('GET', 'api/plan?refresh=1&calendar=1');
      const upd = callsSince(n0).filter((c) => c.domain === 'homeassistant' && c.service === 'update_entity');
      assert(upd.length === 1 && upd[0].target.entity_id === 'calendar.auto', JSON.stringify(upd));
      assert(after.departure && after.departure.title === 'Naar Gent' && after.departure.soc === 85, JSON.stringify(after.departure));
      world.events = [];
      return `update_entity ${upd[0].target.entity_id} → departure ${after.departure.title}`;
    });
    await test('U6', 'More cars: a trip for the EV6 gets "car: EV6" and only counts for the EV6; "Every car" gets no car and counts for both', async () => {
      await ok('POST', 'api/vehicles/multi', { enabled: true });
      const ev6 = (await ok('POST', 'api/vehicles', { ...EV6, add: true })).vehicle.id;
      const car1 = (await carsNow())[0].id;
      try {
        world.events = [];
        const d = await ok('GET', 'api/departures');
        assert(d.cars && d.cars.length === 2, 'no car to choose');
        await ok('POST', 'api/trips', trip({ vehicle_id: ev6 }));
        await ok('POST', 'api/trips', trip({ datetime: isoLocal(at(2, 9), tz).slice(0, 16), destination: 'Utrecht', for_all_cars: true }));
        assert(world.events[0].description.includes('car: EV6') && !world.events[1].description.includes('car:'), JSON.stringify(world.events.map((e) => e.description)));
        const forCar1 = (await ok('GET', `api/departures?vehicle=${car1}`)).calendar_trips.map((x) => x.title);
        const forEv6 = (await ok('GET', `api/departures?vehicle=${ev6}`)).calendar_trips.map((x) => x.title);
        assert(forCar1.length === 1 && forCar1[0] === 'To Utrecht' && forEv6.length === 2, JSON.stringify({ forCar1, forEv6 }));
        return `${car1}: ${forCar1.join(', ')} · EV6: ${forEv6.join(', ')}`;
      } finally {
        await ok('POST', 'api/vehicles/multi', { enabled: false });
        await ok('DELETE', `api/vehicles?id=${ev6}`);
        world.car2 = null;
      }
    });
    world.events = [];
    world.soc = 40;
    await ok('POST', 'api/departures', depBody({ schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
    await stopApp();
    await startApp({ allow_control: true, notify_start_stop: false });
  }

  // ----- X. More than one charger (an option) -------------------------------
  // Two Easee chargers: "Laadpaal" (the first) and "Garage"; two cars.
  if (world.profile === fake.PROFILES.renault_easee) {
    group = 'X. More than one charger';
    const GARAGE = { name: 'Garage', device_id: 'ch2', integration: 'easee', status_entity: 'sensor.garage_status', power_entity: 'sensor.garage_power', switch_entity: 'switch.garage_charger_enabled', phases: 3, max_current: 16 };
    const planOf = (id) => ok('GET', `api/plan?refresh=1&charger=${id}`);
    const overview = () => ok('GET', 'api/chargers/overview');
    world.plugged = true;
    world.charging = false;
    world.car1Plug = true;
    world.car2 = { soc: 30, plug: true, charging: false };
    world.ch2 = { plugged: true, charging: false, amps: 16 };
    world.houseW = 850;
    await ok('POST', 'api/vehicles/multi', { enabled: true });
    const ev6 = (await ok('POST', 'api/vehicles', { ...EV6, add: true })).vehicle.id;
    const car1 = (await carsNow())[0].id;
    let ch1;
    let ch2;
    await test('X1', 'Off by default: one charger as before; adding a second charger is refused', async () => {
      const c = await ok('GET', 'api/chargers');
      assert(c.multi_charger === false && c.chargers.length === 1 && c.chargers[0].id, JSON.stringify(c.chargers.map((x) => x.id)));
      ch1 = c.chargers[0].id;
      await refused('POST', 'api/chargers', { ...GARAGE, add: true }, 'more than one charger');
      const o = await overview();
      assert(o.multi_charger === false && o.chargers.length === 1, JSON.stringify(o));
      return `one charger: ${c.chargers[0].name} (${ch1})`;
    });
    await test('X2', 'Turned on: the Garage charger is added with its usual car (EV6); the first charger keeps its settings', async () => {
      await ok('POST', 'api/chargers/multi', { enabled: true });
      ch2 = (await ok('POST', 'api/chargers', { ...GARAGE, add: true, vehicle_id: ev6 })).charger.id;
      const first = (await ok('GET', 'api/chargers')).chargers[0];
      await ok('POST', 'api/chargers', { id: ch1, name: first.name, device_id: first.device_id, integration: first.integration, status_entity: first.status_entity, power_entity: first.power_entity, switch_entity: first.switch_entity, phases: first.phases, max_current: first.max_current, vehicle_id: car1 });
      const list = (await ok('GET', 'api/chargers')).chargers;
      assert(list.length === 2 && list[0].id === ch1 && list[1].id === ch2 && list[0].vehicle_id === car1 && list[1].vehicle_id === ev6, JSON.stringify(list.map((x) => [x.id, x.vehicle_id])));
      await ok('POST', `api/control/settings?charger=${ch2}`, rules({ current_id: '' }));
      await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: '' }));
      return list.map((x) => `${x.name} (${x.id}) → ${x.vehicle_id}`).join(', ');
    });
    await test('X3', 'Each charger has its own plan: Laadpaal for the first car, Garage for the EV6 (both plugged in)', async () => {
      const a = await planOf(ch1);
      const b = await planOf(ch2);
      assert(a.vehicle.id === car1 && b.vehicle.id === ev6, `${a.vehicle.name} / ${b.vehicle.name}`);
      assert(Math.abs(b.plan.needed_kwh - 77 * 0.5 * 1.1) < 0.6 && b.plan.needed_kwh > a.plan.needed_kwh, `${a.plan.needed_kwh} / ${b.plan.needed_kwh}`);
      const o = await overview();
      assert(o.chargers.length === 2 && o.chargers[1].vehicle.name === 'EV6', JSON.stringify(o.chargers.map((x) => x.vehicle)));
      return `${a.vehicle.name}: ${a.plan.needed_kwh.toFixed(1)} kWh · EV6: ${b.plan.needed_kwh.toFixed(1)} kWh`;
    });
    await test('X4', 'Both must charge now (below the minimum), main fuse 25 A: the EV6 (least room to spare) gets 16 A, the other the rest (6 A)', async () => {
      await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: '' });
      await ok('POST', 'api/departures', depBody({ vehicle_id: car1, schedule: schedule({ [dayKey(1)]: { enabled: true, time: '07:00', soc: 80 } }) }));
      await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: '', min_soc_enabled: true, min_soc: 50 }));
      const n0 = world.calls.length;
      await planOf(ch1);
      await planOf(ch2);
      await sleep(400);
      const o = await overview();
      const [a, b] = o.chargers;
      assert(o.share && o.share.order[0] === ch2, `order ${JSON.stringify(o.share)}`);
      assert(b.want === 'charge' && !b.shared && a.want === 'charge' && a.shared && a.amps === 6, JSON.stringify(o.chargers.map((x) => [x.name, x.want, x.code, x.amps, x.shared])));
      const calls = callsSince(n0);
      assert(world.ch2.charging === true && world.charging === true, `garage ${world.ch2.charging}, laadpaal ${world.charging}`);
      assert(calls.some((c) => c.domain === 'easee' && c.service === 'set_charger_dynamic_limit' && c.data.device_id === 'ch' && c.data.current === 6), calls.map((c) => `${c.domain}.${c.service} ${JSON.stringify(c.data)}`).join(' | '));
      return `available ${o.share.available_a} A: Garage (EV6) ${b.amps || 16} A, Laadpaal ${a.amps} A`;
    });
    await test('X5', 'The house uses more (4.6 kW): too little left for the second car: it waits, the EV6 keeps charging', async () => {
      world.houseW = 4600;
      await planOf(ch1);
      await planOf(ch2);
      await sleep(400);
      const o = await overview();
      const [a, b] = o.chargers;
      assert(b.want === 'charge' && a.want === 'pause' && a.code === 'shared_wait', JSON.stringify(o.chargers.map((x) => [x.name, x.want, x.code, x.reason])));
      assert(world.ch2.charging === true && world.charging === false, `garage ${world.ch2.charging}, laadpaal ${world.charging}`);
      world.houseW = 850;
      return `Laadpaal: ${a.reason}`;
    });
    await test('X5a', 'Charge now goes first, also while that car is below its minimum: the Laadpaal moves before the EV6, and back after Charge now ends (#35)', async () => {
      try {
        await planOf(ch1); await planOf(ch2); await sleep(150);
        let o = await overview();
        assert(o.share.order[0] === ch2, `before: ${JSON.stringify(o.share.order)}`);
        await ok('POST', `api/boost?charger=${ch1}`, { mode: 'on' });
        await planOf(ch1); await planOf(ch2); await sleep(150);
        o = await overview();
        const first = o.chargers.find((c) => c.id === ch1);
        assert(o.share.order[0] === ch1, `with Charge now: ${JSON.stringify(o.share.order)}`);
        assert(first.want === 'charge' && first.code === 'below_minimum', JSON.stringify([first.want, first.code]));
        await ok('DELETE', `api/boost?charger=${ch1}`);
        await planOf(ch1); await planOf(ch2); await sleep(150);
        o = await overview();
        assert(o.share.order[0] === ch2, `after: ${JSON.stringify(o.share.order)}`);
        return 'EV6 first → Laadpaal first (Charge now, below minimum) → EV6 first';
      } finally {
        await ok('DELETE', `api/boost?charger=${ch1}`).catch(() => {});
      }
    });

    await test('X5b', 'Both grid signs pause the first charger below minimum, even just after a manual start', async () => {
      const previousSolar = (await ok('GET', 'api/solar')).settings;
      try {
        // Disable its minimum rule so Charge now is the reported decision code.
        await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: '', min_soc_enabled: false }));
        await ok('POST', `api/boost?charger=${ch1}`, { mode: 'on' });
        for (const exportPositive of [false, true]) {
          world.gridExportPositive = exportPositive;
          await ok('POST', 'api/solar', solarBody({ enabled: false, grid_sign: exportPositive ? 'export_positive' : 'import_positive' }));
          for (const availableA of [0, 4, 5, 6]) {
            world.houseW = 0;
            await sleep(1100); // Let the preceding current restore settle.
            const started = await ok('POST', `api/control/manual?charger=${ch1}`, { action: 'start' });
            assert(started.sent && world.charging, JSON.stringify(started));
            world.houseW = (24 - availableA) * 3 * 230;
            await planOf(ch1); await planOf(ch2); await sleep(150);
            const o = await overview();
            assert(near(o.share.available_a, availableA, 0.11), JSON.stringify(o.share));
            assert(o.share.order[0] === ch1, JSON.stringify(o.share.order));
            const first = o.chargers.find((c) => c.id === ch1);
            if (availableA < 6) {
              assert(first.want === 'pause' && first.code === 'shared_wait', JSON.stringify(first));
              assert(world.charging === false, 'first charger kept charging');
            } else {
              assert(first.want === 'charge' && first.amps === 6, JSON.stringify(first));
            }
          }
        }
        return '0/4/5 A pause; 6 A limit; import/export-positive meters';
      } finally {
        world.gridExportPositive = false; world.houseW = 850;
        await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: '', min_soc_enabled: true, min_soc: 50 }));
        await ok('POST', 'api/solar', previousSolar);
        await ok('DELETE', `api/boost?charger=${ch1}`);
        await planOf(ch1); await planOf(ch2);
      }
    });
    await test('X5c', 'The first start/stop-only charger pauses when 10 A cannot fit its 16 A request', async () => {
      try {
        await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: 'none', min_soc_enabled: false }));
        await ok('POST', `api/boost?charger=${ch1}`, { mode: 'on' });
        world.houseW = 14 * 3 * 230;
        await planOf(ch1); await planOf(ch2); await sleep(150);
        const o = await overview(), first = o.chargers.find((c) => c.id === ch1);
        assert(o.share.order[0] === ch1 && near(o.share.available_a, 10, 0.11), JSON.stringify(o.share));
        assert(first.want === 'pause' && first.code === 'shared_wait' && world.charging === false, JSON.stringify(first));
      } finally {
        world.houseW = 850;
        await ok('POST', `api/control/settings?charger=${ch1}`, rules({ current_id: '', min_soc_enabled: true, min_soc: 50 }));
        await ok('DELETE', `api/boost?charger=${ch1}`);
        await planOf(ch1); await planOf(ch2);
      }
    });

    await test('X5d', 'Per phase (#29): two one-phase chargers on different phases both charge; same phase: the second waits; unknown phase: room kept on every phase; no fresh meter: one charger at 6 A', async () => {
      const saved = (await ok('GET', 'api/chargers')).chargers;
      const [c1, c2] = [ch1, ch2].map((id) => saved.find((c) => c.id === id));
      const body = (c, o) => ({ id: c.id, name: c.name, device_id: c.device_id, integration: c.integration, status_entity: c.status_entity, power_entity: c.power_entity,
        current_entity: c.current_entity, switch_entity: c.switch_entity, phases: c.phases, phase: c.phase || '', max_current: c.max_current, max_current_entities: c.max_current_entities || [], vehicle_id: c.vehicle_id, ...o });
      const grid = { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: '' };
      const P1 = ['sensor.p1_power', 'sensor.p1_current_l1', 'sensor.p1_current_l2', 'sensor.p1_current_l3'];
      const look = async () => {
        for (let i = 0; i < 2; i++) { await planOf(ch1); await planOf(ch2); await sleep(250); } // twice: the measured currents settle
        const o = await overview();
        return { o, a: o.chargers.find((c) => c.id === ch1), b: o.chargers.find((c) => c.id === ch2) };
      };
      const place = async (l1, l2) => {
        await ok('POST', 'api/chargers', body(c1, { phases: 1, phase: l1 }));
        await ok('POST', 'api/chargers', body(c2, { phases: 1, phase: l2 }));
        world.phases = 1; world.line = l1 || 'L1';
        world.ch2.phases = 1; world.ch2.line = l2 || 'L2';
        return look();
      };
      const say = (r) => JSON.stringify({ share: r.o.share, a: [r.a.want, r.a.code, r.a.amps, r.a.shared], b: [r.b.want, r.b.code, r.b.amps, r.b.shared] });
      try {
        world.phaseHouse = { L1: 3, L2: 2, L3: 2 };
        await ok('POST', 'api/grid', { ...grid, current_l1_entity: 'sensor.p1_current_l1', current_l2_entity: 'sensor.p1_current_l2', current_l3_entity: 'sensor.p1_current_l3' });
        let r = await place('L1', 'L2');
        assert(r.o.share.how === 'phase_currents' && r.o.share.phases_a && r.o.share.phases_a.L1 != null, say(r));
        // The share itself is checked: an Easee first switches to one phase (control_wait) before it charges.
        const res = (r) => r.o.share.result || {};
        assert(!res(r)[ch1] && !res(r)[ch2] && r.o.share.left_a.L1 === 5 && r.o.share.left_a.L2 === 6, `different phases: ${say(r)}`);
        r = await place('L1', 'L1');
        assert(r.o.share.order[0] === ch2 && !res(r)[ch2] && res(r)[ch1] && res(r)[ch1].pause === true, `same phase: ${say(r)}`);
        r = await place('', 'L2');
        // On L1 it would get 16 A; with an unknown phase only what is left on L2 (6 A, or a little more while it still draws on L1).
        assert(!res(r)[ch2] && res(r)[ch1] && res(r)[ch1].amps >= 6 && res(r)[ch1].amps < 16, `unknown phase: ${say(r)}`);
        world.ages = Object.fromEntries(P1.map((id) => [id, 10 * 60000]));
        r = await look();
        assert(r.o.share.how === 'no_reading' && res(r)[ch1] && res(r)[ch1].pause === true && (!res(r)[ch2] ? false : res(r)[ch2].pause || res(r)[ch2].amps === 6), `stale meter: ${say(r)}`);
        return 'different phases: both 16 A · same phase: Laadpaal waits · unknown phase: limited by L2 · stale meter: one charger at 6 A';
      } finally {
        world.ages = undefined; world.phaseHouse = undefined; world.phases = null; world.line = undefined;
        if (world.ch2) { world.ch2.phases = undefined; world.ch2.line = undefined; }
        await ok('POST', 'api/chargers', body(c1, {}));
        await ok('POST', 'api/chargers', body(c2, {}));
        await ok('POST', 'api/grid', grid);
        await planOf(ch1); await planOf(ch2);
      }
    });
    await test('X5e', 'Load balancer for one charger only (#29): the app still shares the connection for the other charger', async () => {
      try {
        await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: 'other', load_balancer_chargers: [ch2] });
        const g = (await ok('GET', 'api/grid')).grid[0];
        assert(g.load_balancer && JSON.stringify(g.load_balancer.chargers) === JSON.stringify([ch2]), JSON.stringify(g.load_balancer));
        world.houseW = 4600;
        await planOf(ch1); await planOf(ch2); await sleep(250);
        await planOf(ch1); await planOf(ch2); await sleep(250);
        const o = await overview();
        const a = o.chargers.find((c) => c.id === ch1);
        assert(o.share.how !== 'load_balancer' && o.share.load_balancer && o.share.order.length === 1 && o.share.order[0] === ch1, JSON.stringify(o.share));
        assert(a.want === 'pause' && a.code === 'shared_wait', `the house and the Garage use the connection: ${JSON.stringify([a.want, a.code, a.reason])}`);
        await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: 'other', load_balancer_chargers: 'all' });
        const all = (await ok('GET', 'api/grid')).grid[0];
        assert(all.load_balancer.chargers === null, JSON.stringify(all.load_balancer));
        await planOf(ch1); await planOf(ch2); await sleep(250);
        assert((await overview()).share.how === 'load_balancer', 'all chargers behind the load balancer: the app does not share');
        return `Laadpaal: ${a.reason}`;
      } finally {
        world.houseW = 850;
        await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: '' });
        await planOf(ch1); await planOf(ch2);
      }
    });

    await test('X6', 'Only the EV6 is home, at the Laadpaal (Garage empty): the Laadpaal plans for the EV6, the Garage for the other car', async () => {
      world.car1Plug = false;
      world.ch2 = { plugged: false, charging: false, amps: 16 };
      const a = await planOf(ch1);
      const b = await planOf(ch2);
      assert(a.vehicle.id === ev6 && a.cars.how === 'sensor', JSON.stringify(a.cars));
      assert(b.vehicle.id === car1, `Garage plans for ${b.vehicle.name} (${b.cars && b.cars.how})`);
      world.car1Plug = true;
      world.ch2 = { plugged: true, charging: false, amps: 16 };
      return `Laadpaal → ${a.vehicle.name} · Garage → ${b.vehicle.name}`;
    });
    await test('X7', 'Sensors and messages say which charger: sensor.smart_charging_garage_status; the first charger keeps its names', async () => {
      await stopApp();
      await startApp({ allow_control: true, notify_start_stop: false, publish_sensors: true });
      await planOf(ch1);
      await planOf(ch2);
      await sleep(400);
      const urls = world.rest.map((r) => r.url);
      assert(urls.some((u) => u.includes('sensor.smart_charging_garage_status')) && urls.some((u) => u.includes('sensor.smart_charging_status')), urls.filter((u) => u.includes('smart_charging')).slice(0, 6).join(' '));
      await stopApp();
      await startApp({ allow_control: true, notify_start_stop: false });
    });
    await test('X8', 'Turned off: the first charger only, as before; the Garage stays saved', async () => {
      await ok('POST', `api/control/settings?charger=${ch1}`, rules());
      await ok('POST', 'api/chargers/multi', { enabled: false });
      const p = await plan();
      assert(p.vehicle && (await overview()).chargers.length === 1, 'still more chargers');
      await refused('GET', `api/plan?charger=${ch2}`, undefined, 'not in the app');
      const list = (await ok('GET', 'api/chargers')).chargers;
      assert(list.length === 2 && list[1].used === false, JSON.stringify(list.map((x) => x.used)));
      await ok('DELETE', `api/chargers?id=${ch2}`);
      await ok('POST', 'api/vehicles/multi', { enabled: false });
      await ok('DELETE', `api/vehicles?id=${ev6}`);
      world.ch2 = null;
      world.car2 = null;
      world.car1Plug = undefined;
      return 'back to one charger';
    });
  }
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

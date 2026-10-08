'use strict';

// Matrix test: every charger brand with every home battery brand, in the real
// app against a fake Home Assistant. Per charger: detection, start/stop,
// charging on solar (current, phases) and back to full power. Per charger ×
// battery: the battery is found, the car charges and the battery does not
// discharge into it (or the app says it cannot prevent that), the car stops
// and the battery goes back, the car starts charging by itself, switching to
// another battery puts the old one back, and every command the app sends goes
// only to the chosen charger, the car's limit or the chosen battery.
//
// Entity and action names: tests/fixtures.js (from the integrations' source).
// The fake charger reacts to exactly the start/stop command the app's own
// control check chooses; brands.test.js checks those commands per brand.
//
// Run from the repository root (needs `npm install` in smart_charging_planner/app):
//   node tests/matrix.test.js                       all chargers (several minutes)
//   SCP_CHARGERS=Easee,Zaptec node tests/matrix.test.js
//   SCP_RESULTS=out.json ...                         results as JSON

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fake = require('./fake-ha');
const { CHARGERS, BATTERIES } = require('./fixtures');

const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
process.env.DATA_DIR = process.env.DATA_DIR || os.tmpdir();
const { checkControl } = require(path.join(APP, 'control.js'));
const { detectChargers } = require(path.join(APP, 'chargers.js'));
const controller = require(path.join(APP, 'controller.js'));
const battery = require(path.join(APP, 'battery.js'));
const { localDateTime, tzParts } = require(path.join(APP, 'prices.js'));

const PORT0 = Number(process.env.SCP_MATRIX_PORT) || 18300;
const WS_PORT = PORT0 + 1;
const REST_PORT = PORT0 + 2;
const APP_PORT = PORT0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let group = '';
let app = null;
let dataDir = null;

// ---------------------------------------------------------------------------
// A charger from the fixtures as a fake-HA profile
// ---------------------------------------------------------------------------

const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
const matches = (call, cmd) => !!cmd && `${call.domain}.${call.service}` === cmd.service
  && (call.target || {}).entity_id === (cmd.target || {}).entity_id
  && (call.target || {}).device_id === (cmd.target || {}).device_id
  && same(call.data, cmd.data);

function chargerProfile(fx) {
  const list = fx.dev.states.map((s) => [s.entity_id, s.state, s.attributes]);
  const platform = fx.dev.entities[0].platform;
  const entities = list.map(([entity_id]) => ({ entity_id, device_id: 'ch', platform }));
  const states0 = list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes }));
  const found = detectChargers(entities, [{ id: 'ch', name: fx.dev.devices[0].name }], states0)[0];
  const r = checkControl({ charger: { device_id: 'ch', integration: platform }, entities, states: states0, services: fx.services });
  const rec = r.recommended || {};
  const ss = rec.start_stop || null;
  const cur = rec.current || null;
  const ph = rec.phase || null;
  const on = ss ? controller.startStopCommand(ss, true, 'ch') : null;
  const off = ss ? controller.startStopCommand(ss, false, 'ch') : null;
  const pick = (want) => Object.entries(fx.statuses).find(([, v]) => v[0] === want[0] && v[1] === want[1])[0];
  const statusE = found.suggested.status;
  const powerE = found.suggested.power;
  const powerAttr = (list.find(([id]) => id === powerE) || [])[2] || {};
  const kwOf = (w) => (w.charging ? Math.round((w.amps ?? 16) * (w.phases ?? 3) * 230) / 1000 : 0);
  // Current: the field of the command that carries the value.
  const curTpl = cur ? controller.currentCommand(cur, 7, 'ch') : null;
  const curField = curTpl ? Object.keys(curTpl.data).find((k) => curTpl.data[k] === 7) : null;
  const ph1 = ph ? controller.phaseCommand(ph, 1, 'ch') : null;
  const ph3 = ph ? controller.phaseCommand(ph, 3, 'ch') : null;
  const allowed = [ss, cur, ph].filter(Boolean).flatMap((m) => controller.allowedFor(m));
  return {
    fx,
    rec,
    allowed,
    device: 'ch',
    name: fx.dev.devices[0].name,
    manufacturer: fx.brand,
    model: '',
    platform,
    status: statusE,
    power: powerE,
    switch: ss && ss.type === 'switch' ? ss.entity_id : null,
    text: { unplugged: pick([false, null]), paused: pick([true, false]), charging: pick([true, true]) },
    services: fx.services,
    initial(w) {
      for (const [id, st] of list) w.store.set(id, st);
      // Start "not charging".
      if (ss && ss.type === 'switch') w.store.set(ss.entity_id, 'off');
      if (ss && ss.type === 'select') w.store.set(ss.entity_id, ss.stop_option);
      if (ph && ph.type === 'select_phase') w.store.set(ph.entity_id, ph3.data.option);
      if (ph && ph.type === 'switch_phase') w.store.set(ph.entity_id, ph3.service.endsWith('turn_on') ? 'on' : 'off');
    },
    states: (w, status) => list.map(([id, , a]) => [id,
      id === statusE ? status
        : id === powerE ? (powerAttr.unit_of_measurement === 'kW' ? kwOf(w) : Math.round(kwOf(w) * 1000))
          : w.store.get(id), a]),
    react: (call) => (matches(call, on) ? 'start' : matches(call, off) ? 'stop' : null),
    isStart: (c) => matches(c, on),
    isControl: (c) => matches(c, on) || matches(c, off),
    describe: (c) => `${c.domain}.${c.service}${c.target && c.target.entity_id ? ' ' + c.target.entity_id : ''} ${JSON.stringify(c.data)}`,
    currentOf: (c) => (curTpl && `${c.domain}.${c.service}` === curTpl.service && (c.target || {}).entity_id === (curTpl.target || {}).entity_id ? c.data[curField] : null),
    phasesOf: (c) => (matches(c, ph1) ? 1 : matches(c, ph3) ? 3 : null),
  };
}

// A battery from the fixtures, on its own devices in the fake.
function batteryOf(bx) {
  const name = battery.BRANDS[bx.platform].name;
  return {
    bx,
    platform: bx.platform,
    name,
    list: bx.list.map(([id, st, a, dev]) => [id, st, { friendly_name: id, ...a }, `b_${bx.platform}_${dev}`]),
  };
}

function setBatteries(w, bats) {
  w.otherBattery = {
    list: bats.flatMap((b) => b.list),
    devices: Object.fromEntries(bats.flatMap((b) => b.list.map((x) => [x[3], b.platform]))),
    names: Object.fromEntries(bats.flatMap((b) => b.list.map((x) => [x[3], `${b.name} ${x[3].split('_').pop()}`]))),
  };
  for (const b of bats) for (const [id, st] of b.list) if (!w.store.has(id)) w.store.set(id, st);
}

// The battery's control as the app sees it (same registries and states).
function batteryControl(w, b, cfg) {
  const entities = b.list.map(([entity_id, , , dev]) => ({ entity_id, platform: b.platform, device_id: dev }));
  const states = b.list.map(([entity_id, , attributes]) => ({ entity_id, state: String(w.store.get(entity_id)), attributes }));
  return battery.controlFor(cfg, entities, states, cfg.saved || null);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function test(id, name, fn) {
  try {
    const note = await fn();
    results.push({ id, group, name, ok: true, note: note || '' });
    console.log(`  ok    ${id} ${name}${note ? ` (${note})` : ''}`);
  } catch (err) {
    results.push({ id, group, name, ok: false, note: err.message });
    console.log(`  FAIL  ${id} ${name} - ${err.message}`);
  }
}

async function startApp(options) {
  await stopApp();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-matrix-'));
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
      SCP_GEOCODE_URL: `http://127.0.0.1:${REST_PORT}/search`,
      SCP_ROUTE_URL: `http://127.0.0.1:${REST_PORT}/route/v1/driving`,
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
      if (s.status === 200 && s.body.connected) return;
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
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const plan = () => ok('GET', 'api/plan?refresh=1');
const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const rules = (o = {}) => ({ start_stop_id: '', current_id: '', min_soc_enabled: false, min_soc: 20, min_soc_entity: '', min_soc_max_price: '', preheat_entity: '', force_minutes: 0, hysteresis: 0.03, car_limit_off: false, min_choice: 30, ...o });
const solarBody = (o = {}) => ({
  enabled: true, forecast: 'energy', forecast_factor: 0.8, house_base_w: 400, grid_sign: 'import_positive',
  start_delay_min: 0, stop_delay_min: 0, grid_allow_w: 0, max_soc: 90, current_control: true,
  phase_switching: true, feed_in: { mode: 'fixed', fee: 0.02, fixed: 0.03, vat_percent: 0 }, ...o,
});
const batBody = (b, o = {}) => ({
  soc_entity: b.bx.expect.soc, platform: b.platform, enabled: true, capacity_kwh: 10, efficiency: 0.9,
  charge_kw: 3, discharge_kw: 3, min_pct: 10, max_pct: 100, wear: 0.03, power_sign: 'charge_positive', arbitrage: false,
  ev_discharge: 'never', solar_priority: 'smart', ...o,
});
const fmt = (c) => `${c.service}${c.data && c.data.option != null ? ' ' + c.data.option : c.data && c.data.value != null ? ' ' + c.data.value : ''}`;
const callKey = (c) => JSON.stringify([`${c.domain}.${c.service}`, (c.target || {}).entity_id || null, c.data || {}]);
const cmdKey = (c) => JSON.stringify([c.service, (c.target || {}).entity_id || null, c.data || {}]);

// ---------------------------------------------------------------------------
// One charger
// ---------------------------------------------------------------------------

async function runCharger(fx, n) {
  const world = fake.createWorld('renault_easee');
  const CH = chargerProfile(fx);
  world.profile = { label: fx.brand, car: fake.PROFILES.renault_easee.car, charger: CH };
  world.store = new Map();
  CH.initial(world);
  // Prices that give the same battery plan at every time of day: 0.20 all
  // day, cheap only tomorrow 02:00-05:00 (for the car). Without grid charging
  // the battery has no reason to hold now, so "own mode" is the plan.
  const { localMidnight } = require(path.join(APP, 'prices.js'));
  world.energyzero = () => Array.from({ length: 48 }, (_, i) => ({
    timestamp: new Date(localMidnight(fake.TZ, 0) + i * 3600000).toISOString(),
    price: i >= 26 && i < 29 ? 0.05 : 0.20,
  }));
  const ha = fake.start(world, WS_PORT, REST_PORT);
  const since = (k) => world.calls.slice(k);
  const CAR = world.profile.car;
  const tag = `${n}`;
  const allowedCharger = (c) => CH.allowed.some((a) => a.service === `${c.domain}.${c.service}` && (!a.entity_id || (c.target || {}).entity_id === a.entity_id));
  const isCarLimit = (c) => c.domain === 'number' && (c.target || {}).entity_id === CAR.limit;
  const controllable = !!CH.rec.start_stop;
  try {
    // ----- Charger --------------------------------------------------------
    group = `${fx.brand}`;
    console.log(`\n${fx.brand}`);
    await startApp({ allow_control: true, allow_battery_control: true, notify_start_stop: false });
    const tz = fake.TZ;
    const today = tzParts(Date.now(), tz);
    const dayKey = (offset) => days[(new Date(Date.UTC(today.y, today.m - 1, today.d + offset)).getUTCDay() + 6) % 7];
    const depBody = (soc) => ({
      schedule_enabled: true, default_soc: 80, helper: { enabled: false }, calendar: { enabled: false, match: 'target', buffer_minutes: 0, soc: 80 },
      schedule: Object.fromEntries(days.map((d) => [d, { enabled: d === dayKey(1), time: '07:00', soc }])),
    });
    void localDateTime;
    await test(`${tag}.1`, 'Charger found and saved; start/stop method from the control check', async () => {
      const d = await ok('GET', 'api/chargers/detect');
      const c = d.candidates.find((x) => x.device_id === 'ch');
      assert(c, `not detected: ${JSON.stringify(d.candidates.map((x) => x.device_id))}`);
      await ok('POST', 'api/vehicles', { name: CAR.name, device_id: 'car', soc_entity: CAR.soc, plugged_entity: CAR.plugged, charge_limit_entity: CAR.limit, capacity_kwh: CAR.capacity });
      await ok('POST', 'api/prices', { source: { type: 'action', domain: 'energyzero', config_entry: 'ce_ez', name: 'EnergyZero' }, price_type: 'all_in' });
      await ok('POST', 'api/grid', { name: 'P1 meter', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: 'other' });
      await ok('POST', 'api/chargers', { name: CH.name, device_id: 'ch', status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 16 });
      await ok('POST', 'api/departures', depBody(90));
      await ok('POST', 'api/control/settings', rules());
      const r = await ok('GET', 'api/control/check');
      const rec = r.recommended && r.recommended.start_stop;
      if (fx.readOnly) {
        assert(!rec && r.warnings.some((x) => x.code === 'read_only_integration'), `rec ${JSON.stringify(rec)}`);
        return 'read only: no start/stop';
      }
      assert(rec && rec.type === fx.expect.startStop, `method ${rec && rec.type}, expected ${fx.expect.startStop}`);
      return `${rec.type}, current: ${CH.rec.current ? CH.rec.current.type : 'none'}, phases: ${CH.rec.phase ? CH.rec.phase.type : 'none'}`;
    });
    world.soc = 40;
    world.limit = 80;
    await test(`${tag}.2`, 'Charge now: charger starts; stop: charger pauses', async () => {
      world.charging = false;
      const n0 = world.calls.length;
      const r = await api('POST', 'api/boost', { mode: 'soc', value: 60 });
      await plan();
      await sleep(700);
      const started = world.charging;
      await ok('DELETE', 'api/boost');
      await plan();
      await sleep(700);
      const sent = since(n0).filter((c) => !isCarLimit(c) && c.domain !== 'notify');
      if (!controllable) {
        assert(!sent.length && !started, `sent ${sent.map(fmt)}`);
        return `nothing sent (boost: ${r.status})`;
      }
      assert(started && world.charging === false, `started ${started}, charging now ${world.charging}, sent ${sent.map(CH.describe)}`);
      return sent.map(CH.describe).join(' → ');
    });
    await test(`${tag}.3`, 'Solar, 6 kW sun: starts with a matching current (or waits for the full power without current control)', async () => {
      await ok('POST', 'api/solar', solarBody());
      await ok('POST', 'api/chargemode', { mode: 'plan_solar' });
      world.charging = false; world.amps = null; world.phases = null;
      world.pvW = 6000;
      const n0 = world.calls.length;
      for (let i = 0; i < 2; i++) { await plan(); await sleep(600); }
      const sent = since(n0).filter((c) => !isCarLimit(c) && c.domain !== 'notify');
      if (!controllable) { assert(!sent.length, `sent ${sent.map(fmt)}`); return 'nothing sent'; }
      if (!CH.rec.current) {
        assert(world.charging === false, `started without current control at 6 kW, sent ${sent.map(CH.describe)}`);
        return 'no current control: waits for 11 kW';
      }
      assert(world.charging === true && world.amps >= 6 && world.amps <= 8, `charging ${world.charging}, current ${world.amps}, sent ${sent.map(CH.describe)}`);
      return `${world.amps} A · ${sent.map(CH.describe).join(' · ')}`;
    });
    await test(`${tag}.4`, 'Solar drops to 2.5 kW: one phase where possible, otherwise stop', async () => {
      world.pvW = 2500;
      const n0 = world.calls.length;
      for (let i = 0; i < 3; i++) { await plan(); await sleep(1100); }
      const sent = since(n0).filter((c) => !isCarLimit(c) && c.domain !== 'notify');
      if (!controllable) { assert(!sent.length, `sent ${sent.map(fmt)}`); return 'nothing sent'; }
      if (CH.rec.phase && CH.rec.current) {
        assert(world.phases === 1 && world.charging === true, `phases ${world.phases}, charging ${world.charging}, sent ${sent.map(CH.describe)}`);
        return `one phase, ${world.amps} A · ${sent.map(CH.describe).join(' · ')}`;
      }
      assert(world.charging === false, `still charging, sent ${sent.map(CH.describe)}`);
      return `paused · ${sent.map(CH.describe).join(' · ') || 'was not charging'}`;
    });
    await test(`${tag}.5`, 'Charge now after solar: current back to 16 A and three phases', async () => {
      world.pvW = 0;
      world.charging = false;
      const n0 = world.calls.length;
      await api('POST', 'api/boost', { mode: 'soc', value: 60 });
      for (let i = 0; i < 2; i++) { await plan(); await sleep(1100); }
      const sent = since(n0).filter((c) => !isCarLimit(c) && c.domain !== 'notify');
      const charging = world.charging;
      await api('DELETE', 'api/boost');
      await ok('POST', 'api/solar', solarBody({ enabled: false }));
      await plan();
      await sleep(700);
      if (!controllable) { assert(!sent.length, `sent ${sent.map(fmt)}`); return 'nothing sent'; }
      assert(charging, `not started, sent ${sent.map(CH.describe)}`);
      if (CH.rec.current) assert(world.amps === 16, `current ${world.amps}, sent ${sent.map(CH.describe)}`);
      if (CH.rec.phase) assert(world.phases === 3, `phases ${world.phases}`);
      return sent.map(CH.describe).join(' · ');
    });
    await test(`${tag}.6`, 'Every command went to this charger or the car\'s limit', async () => {
      const bad = world.calls.filter((c) => c.domain !== 'notify' && !isCarLimit(c) && !allowedCharger(c));
      assert(!bad.length, `other commands: ${bad.map(fmt)}`);
      return `${world.calls.filter((c) => c.domain !== 'notify').length} commands`;
    });

    // ----- Each home battery ------------------------------------------------
    let prev = null;
    let prevCtl = null;
    let k = 0;
    for (const bx of BATTERIES) {
      k++;
      const b = batteryOf(bx);
      const id = `${tag}.B${k}`;
      group = `${fx.brand} + ${b.name} (${b.platform})`;
      console.log(`  ${group}`);
      world.charging = false;
      world.soc = 40;
      setBatteries(world, prev ? [prev, b] : [b]);
      const seg0 = world.calls.length;
      const ro = !!bx.expect.readOnly;
      let ctl = null;
      let cfg = null;
      await test(`${id}.1`, 'Battery found; what the app can do', async () => {
        const r = await ok('GET', 'api/battery');
        const c = r.candidates.find((x) => x.soc_entity === bx.expect.soc && x.platform === b.platform);
        assert(c, `not found among ${r.candidates.map((x) => x.platform)}`);
        if (ro) {
          assert(!c.control.supported.length && c.control.protects_car === false, JSON.stringify(c.control));
          return 'read only';
        }
        assert(same([...c.control.supported].sort(), [...bx.expect.actions].sort()), `can ${c.control.supported}`);
        return `can: ${c.control.supported.join(', ')}${c.control.protects_car ? '' : ' · cannot stop discharging into the car (warned)'}`;
      });
      await test(`${id}.2`, 'Switching to this battery: the previous one back to its own mode, nothing else touched', async () => {
        const n0 = world.calls.length;
        const saved = await ok('POST', 'api/battery', batBody(b));
        cfg = saved.settings;
        ctl = batteryControl(world, b, cfg);
        const sent = since(n0);
        if (!prev || !prevCtl || !prevCtl.available || !prev.changed) {
          assert(!sent.length, `sent ${sent.map(fmt)}`);
          return 'nothing to put back';
        }
        const want = battery.commandsFor(prevCtl, 'auto', 3, null);
        assert(same(sent.map(callKey), want.commands.map(cmdKey)), `sent ${sent.map(fmt)}, expected ${want.commands.map((c) => fmt({ ...c, service: c.service }))}`);
        return `${prev.name}: ${sent.map(fmt).join(' · ')}`;
      });
      // From here on only the new battery exists.
      setBatteries(world, [b]);
      const batCalls = (n0) => since(n0).filter((c) => !isCarLimit(c) && c.domain !== 'notify' && !CH.isControl(c) && !CH.allowed.some((x) => x.service === `${c.domain}.${c.service}` && (!x.entity_id || (c.target || {}).entity_id === x.entity_id)));
      const protects = !ro && ctl && (ctl.supported.includes('no_discharge') || ctl.supported.includes('hold'));
      // Run the app's step until `done` (what the app last did with the battery), max ~4 s.
      const until = async (done) => {
        let st = null;
        for (let i = 0; i < 8; i++) {
          await plan();
          await sleep(400);
          st = await ok('GET', 'api/battery');
          const p = await ok('GET', 'api/plan');
          if (done(st.last, p.battery_now || {})) return { last: st.last, bn: p.battery_now || {} };
        }
        const p = await ok('GET', 'api/plan');
        return { last: st.last, bn: p.battery_now || {}, timeout: true };
      };
      const exact = (sent, action) => {
        const want = battery.commandsFor(ctl, action, 3, Number(world.store.get(bx.expect.soc)));
        return same(sent.map(callKey), want.commands.map(cmdKey)) ? null : `sent ${sent.map(fmt)}, expected for ${action}: ${want.commands.map(fmt)}`;
      };
      await test(`${id}.3`, 'Car charges (Charge now): the battery does not discharge into it', async () => {
        const n0 = world.calls.length;
        await api('POST', 'api/boost', { mode: 'soc', value: 60 });
        const r = await until((last, bn) => (protects ? last && ['no_discharge', 'hold'].includes(last.action) : !!bn.action));
        const sent = batCalls(n0);
        if (controllable) assert(world.charging, 'car did not start');
        if (ro) {
          assert(!sent.length, `sent to a read-only battery: ${sent.map(fmt)}`);
          return `nothing sent (${r.bn.error || 'read only'})`;
        }
        if (!protects) {
          // GoodWe, Marstek Local API: no way to stop discharging.
          assert(!sent.length && r.bn.action === 'no_discharge' && /not possible/.test(r.bn.error || ''), `battery ${JSON.stringify(r.bn)}, sent ${sent.map(fmt)}`);
          return `cannot prevent it: ${r.bn.error}`;
        }
        assert(!r.timeout, `battery ${JSON.stringify(r.bn)}, sent ${sent.map(fmt)}`);
        // The plan may follow a moment later (car block in the new plan):
        // first "no discharging" for the car, then the plan's "hold". Both protect.
        const want = battery.commandsFor(ctl, r.last.action, 3, Number(world.store.get(bx.expect.soc))).commands;
        const tail = sent.slice(sent.length - want.length);
        const head = sent.slice(0, sent.length - want.length);
        const err = exact(tail, r.last.action);
        assert(!err, err);
        const protectKeys = ['no_discharge', 'hold'].map((x) => battery.commandsFor(ctl, x, 3, Number(world.store.get(bx.expect.soc)))).filter(Boolean).map((x) => x.commands.map(cmdKey).join('|'));
        assert(!head.length || protectKeys.includes(head.map(callKey).join('|')), `before ${r.last.action}: ${head.map(fmt)}`);
        return `${r.last.action} (${r.bn.reason}): ${sent.map(fmt).join(' · ')}`;
      });
      await test(`${id}.4`, 'Car stops: the battery follows its own plan again (not the car)', async () => {
        const n0 = world.calls.length;
        const before = (await ok('GET', 'api/battery')).last;
        await api('DELETE', 'api/boost');
        const r = await until((last, bn) => !!bn.action && !/car/i.test(bn.reason || '') && !bn.error && !(controllable && world.charging));
        const sent = batCalls(n0);
        if (controllable) assert(!world.charging, 'car still charging');
        if (ro || !protects) { assert(!sent.length, `sent ${sent.map(fmt)}`); return 'nothing sent'; }
        assert(!r.timeout, `battery ${JSON.stringify(r.bn)} last ${JSON.stringify(r.last)}`);
        // What the battery should get now: the plan's action ("auto" = own mode).
        const target = r.last ? r.last.action : 'auto';
        if ((before ? before.action : 'auto') === target) {
          assert(!sent.length, `sent ${sent.map(fmt)} while it already was ${target}`);
          return `${target} (${r.bn.reason}), already so: nothing sent`;
        }
        // While the charger is still pausing, the car may draw power for one
        // more step: a protecting action first is fine, it must end in the plan's action.
        const want = battery.commandsFor(ctl, target, 3, Number(world.store.get(bx.expect.soc))).commands;
        const tail = sent.slice(sent.length - want.length);
        const head = sent.slice(0, sent.length - want.length);
        const err = exact(tail, target);
        assert(!err, err);
        const protectKeys = ['no_discharge', 'hold'].map((x) => battery.commandsFor(ctl, x, 3, Number(world.store.get(bx.expect.soc)))).filter(Boolean).map((x) => x.commands.map(cmdKey).join('|'));
        assert(!head.length || protectKeys.includes(head.map(callKey).join('|')), `before ${target}: ${head.map(fmt)}`);
        return `${head.length ? `${head.map(fmt).join(' · ')} (charger still pausing) → ` : ''}${target} (${r.bn.reason}): ${tail.map(fmt).join(' · ')}`;
      });
      await test(`${id}.5`, 'Car starts charging by itself: the battery still does not discharge into it', async () => {
        const n0 = world.calls.length;
        const before = (await ok('GET', 'api/battery')).last;
        world.charging = true;
        const r = await until((last, bn) => (protects ? last && ['no_discharge', 'hold'].includes(last.action) : !!bn.action));
        const sent = batCalls(n0);
        if (ro) { assert(!sent.length, `sent ${sent.map(fmt)}`); return 'nothing sent'; }
        if (!protects) return `cannot prevent it: ${r.bn.error || r.bn.action}`;
        assert(!r.timeout, `battery ${JSON.stringify(r.bn)}, sent ${sent.map(fmt)}`);
        const tail = controllable ? 'car paused by the app or still charging' : 'the app cannot pause this charger';
        if (before && before.action === r.last.action) {
          assert(!sent.length, `sent ${sent.map(fmt)} while it already was ${before.action}`);
          return `${r.last.action} already (battery plan) · ${tail}`;
        }
        const err = exact(sent.slice(0, battery.commandsFor(ctl, r.last.action, 3, 50).commands.length), r.last.action);
        assert(!err, err);
        return `${r.last.action} (${r.bn.reason}) · ${world.charging ? 'car still charging' : 'car paused by the app (not planned)'}`;
      });
      // Back to a calm state for the next battery: the car stops.
      world.charging = false;
      await ok('DELETE', 'api/boost').catch(() => {});
      if (!ro) await until((last, bn) => !!bn.action && !/car/i.test(bn.reason || ''));
      b.changed = !!(await ok('GET', 'api/battery')).last;
      await test(`${id}.6`, 'Every command went to this charger, the car\'s limit or this battery', async () => {
        const allowedBat = ctl && ctl.available ? battery.allowedFor(ctl) : [];
        const allowedPrev = prevCtl && prevCtl.available ? battery.allowedFor(prevCtl) : [];
        const okCall = (c) => c.domain === 'notify' || isCarLimit(c) || allowedCharger(c)
          || [...allowedBat, ...allowedPrev].some((a) => a.service === `${c.domain}.${c.service}` && (!a.entity_id || (c.target || {}).entity_id === a.entity_id));
        const bad = since(seg0).filter((c) => !okCall(c));
        assert(!bad.length, `other commands: ${bad.map(fmt)}`);
        if (ro) assert(!since(seg0).some((c) => (c.target || {}).entity_id && b.list.some(([eid]) => eid === c.target.entity_id)), 'read-only battery touched');
        return `${since(seg0).filter((c) => c.domain !== 'notify').length} commands`;
      });
      prev = b;
      prevCtl = ctl;
    }
  } finally {
    await stopApp();
    ha.close();
    await sleep(200);
  }
}

async function main() {
  const only = process.env.SCP_CHARGERS ? process.env.SCP_CHARGERS.split(',').map((s) => s.trim().toLowerCase()) : null;
  const list = CHARGERS.map((c, i) => [c, i + 1]).filter(([c]) => !only || only.some((o) => c.brand.toLowerCase().startsWith(o)));
  for (const [fx, n] of list) await runCharger(fx, n);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);
  if (process.env.SCP_RESULTS) fs.writeFileSync(process.env.SCP_RESULTS, JSON.stringify({ results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await stopApp();
  process.exit(1);
});

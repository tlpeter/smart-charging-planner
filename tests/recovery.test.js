'use strict';

// The real app against fake HA: check command order and durable recovery,
// including failures before the charger is enabled.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fake = require('./fake-ha');
const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const WS_PORT = 19123, REST_PORT = 19124, PORT = 19099;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-recovery-'));
const world = fake.createWorld('renault_easee');
world.liveLimit = 16;
world.attempts = [];
world.hasBattery = true;
world.bat = { soc: 50, ems: 'off', mode: 'Maximum Self Consumption', chg: 10, dis: 10, autoKw: 0 };
const CAR = world.profile.car, CH = world.profile.charger;
const ha = fake.start(world, WS_PORT, REST_PORT);
let child;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, route, body) {
  const r = await fetch('http://127.0.0.1:' + PORT + '/' + route, { method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  assert.equal(r.status, 200, route + ': ' + JSON.stringify(data));
  return data;
}
const plan = () => api('GET', 'api/plan?refresh=1');
async function stop() {
  if (!child) return;
  const p = child; child = null;
  const exited = new Promise((r) => p.once('exit', r));
  p.kill();
  await exited;
}
async function start(control) {
  await stop();
  fs.writeFileSync(path.join(dir, 'options.json'), JSON.stringify({ allow_control: control, allow_battery_control: control, notify_start_stop: false }));
  child = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env,
    DATA_DIR: dir, SCP_PORT: String(PORT), HA_WS_URL: 'ws://127.0.0.1:' + WS_PORT,
    HA_REST_URL: 'http://127.0.0.1:' + REST_PORT + '/api', SUPERVISOR_TOKEN: 'test',
    SCP_PHASE_GAP_MS: '100', SCP_CURRENT_GAP_MS: '100', SCP_RECONNECT_MS: '100',
    SCP_GEOCODE_URL: 'http://127.0.0.1:' + REST_PORT + '/search',
    SCP_ROUTE_URL: 'http://127.0.0.1:' + REST_PORT + '/route/v1/driving',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  child.stdout.on('data', (s) => { if (child) child.log += s; });
  child.stderr.on('data', (s) => { if (child) child.log += s; });
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    try { if ((await api('GET', 'api/status')).connected) return; } catch {}
  }
  throw new Error('App did not start: ' + child.log);
}
async function check(name, fn) {
  try { await fn(); console.log('ok -', name); }
  catch (err) { console.error('not ok -', name); throw err; }
}
const solar = (enabled) => ({ enabled, forecast: 'none', forecast_factor: 0.8, house_base_w: 400,
  grid_sign: 'import_positive', start_delay_min: 0, stop_delay_min: 0, grid_allow_w: 0,
  max_soc: 90, current_control: true, phase_switching: true,
  feed_in: { mode: 'fixed', fee: 0, fixed: 0.03, vat_percent: 0 } });
async function steps(n = 4) { for (let i = 0; i < n; i++) { await plan(); await sleep(150); } }
async function run() {
  try {
    await start(false);
    await api('POST', 'api/vehicles', { name: CAR.name, device_id: 'car', integration: CAR.platform,
      soc_entity: CAR.soc, plugged_entity: CAR.plugged, charge_limit_entity: CAR.limit, capacity_kwh: CAR.capacity });
    await api('POST', 'api/chargers', { name: CH.name, device_id: 'ch', integration: CH.platform,
      status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 16,
      max_current_entities: ['sensor.laadpaal_live_limit'] });
    await api('POST', 'api/grid', { name: 'P1', device_id: 'p1', net_entity: 'sensor.p1_power', main_fuse: 25, phases: 3, load_balancer: '' });
    await api('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'single', normal: 0.2 } });
    await api('POST', 'api/departures', { schedule_enabled: false, default_soc: 80, schedule: Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map((day) => [day, { enabled: false, time: '07:00', soc: 80 }])), helper: { enabled: false }, calendar: { enabled: false } });
    world.plugged = true; world.charging = false; world.pvW = 2500; world.soc = 40;
    await api('POST', 'api/solar', solar(true));
    await api('POST', 'api/chargemode', { mode: 'solar' });
    world.failCommand = (c) => c.domain === 'easee' && c.service === 'set_charger_phase_mode';
    await start(true);
    await check('a failed phase change never enables charging or sends a one-phase current', async () => {
      world.attempts = [];
      await steps(2);
      assert(world.attempts.some((c) => c.service === 'set_charger_phase_mode'));
      assert(!world.attempts.some((c) => c.service === 'set_charger_dynamic_limit'));
      assert(!world.attempts.some(CH.isStart));
      assert.equal(world.charging, false);
    });
    await check('a failed current limit keeps the charger paused and is retried on the next step', async () => {
      world.failCommand = (c) => c.service === 'set_charger_dynamic_limit';
      await steps(3);
      assert.equal(world.charging, false);
      const mark = world.calls.length;
      world.failCommand = null;
      await steps(3);
      const sent = world.calls.slice(mark);
      const limit = sent.findIndex((c) => c.service === 'set_charger_dynamic_limit');
      const enable = sent.findIndex(CH.isStart);
      assert(limit >= 0 && enable > limit, JSON.stringify(sent));
      assert.equal(world.charging, true);
      assert.equal(world.phases, 1);
      assert(world.amps >= 6 && world.amps <= 8);
    });
    await check('a live zero or 4 A limit blocks Charge now as well as the plan', async () => {
      for (const cap of [0, 4]) {
        world.liveLimit = cap;
        const mark = world.calls.length;
        await api('POST', 'api/boost', { mode: 'on' });
        await steps(2);
        assert.equal(world.charging, false);
        assert(!world.calls.slice(mark).some(CH.isStart));
        const p = await plan();
        assert.equal(p.charger.max_current, cap);
        assert.equal(p.power.amps, cap);
        await api('DELETE', 'api/boost');
      }
      world.liveLimit = 16;
      await steps(4);
    });
    await check('restart restores app-owned one-phase/current settings after solar is disabled', async () => {
      await steps(4);
      assert.equal(world.phases, 1);
      const owned = JSON.parse(fs.readFileSync(path.join(dir, 'device_control.json'), 'utf8'));
      assert.equal(owned.phases.phases, 1);
      assert(owned.current.amps < 16);
      await stop();
      const file = path.join(dir, 'settings.json');
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg.solar.enabled = false;
      fs.writeFileSync(file, JSON.stringify(cfg));
      world.pvW = 0;
      await start(true);
      await api('POST', 'api/boost', { mode: 'on' });
      await steps(5);
      assert.equal(world.phases, 3);
      assert.equal(world.amps, 16);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'device_control.json'), 'utf8')).current, null);
      await api('DELETE', 'api/boost');
    });
    await check('a pre-trip SoC is not reused after unplugging and reconnecting', async () => {
      world.soc = 85;
      world.reportedAt = { [CAR.soc]: Date.now() };
      await plan();
      world.plugged = false;
      await plan();
      world.plugged = true; world.soc = 'unavailable'; world.reportedAt = {};
      const p = await plan();
      assert.equal(p.vehicle.car_data.session_uncertain, true);
      assert.equal(p.vehicle.car_data.kwh_since, 0);
      assert.equal(p.vehicle.soc, 20);
    });
    await check('a partial battery failure is retried without waiting for the normal refresh timeout', async () => {
      const d = await api('GET', 'api/battery');
      const b = d.candidates.find((x) => x.platform === 'sigen');
      const cfg = { enabled: true, platform: b.platform, soc_entity: b.soc_entity,
        capacity_kwh: 16.12, charge_kw: 3, discharge_kw: 3, min_pct: 10, max_pct: 90,
        efficiency: 0.9, wear: 0.03, arbitrage: false, ev_discharge: 'never',
        solar_priority: 'smart', power_sign: 'charge_positive' };
      await api('POST', 'api/battery', cfg);
      let failures = 1;
      world.failCommand = (c) => c.domain === 'select' && c.data.option === 'Standby' && failures-- > 0;
      await assert.rejects(() => api('POST', 'api/battery/test', { action: 'hold' }));
      world.failCommand = null;
      const mark = world.calls.length;
      await steps(2);
      assert(world.calls.slice(mark).some((c) => c.domain === 'select' && c.data.option === 'Standby'));
      assert.equal(world.bat.mode, 'Standby');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')).failed, undefined);
    });
    await check('a held home battery is released after restart with planning disabled', async () => {
      const d = await api('GET', 'api/battery');
      const b = d.candidates.find((x) => x.platform === 'sigen');
      assert(b, JSON.stringify(d));
      const cfg = { enabled: true, platform: b.platform, soc_entity: b.soc_entity,
        capacity_kwh: 16.12, charge_kw: 3, discharge_kw: 3, min_pct: 10, max_pct: 90,
        efficiency: 0.9, wear: 0.03, arbitrage: false, ev_discharge: 'never',
        solar_priority: 'smart', power_sign: 'charge_positive' };
      await api('POST', 'api/battery', cfg);
      await api('POST', 'api/battery/test', { action: 'hold' });
      assert.equal(world.bat.ems, 'on');
      await stop();
      const file = path.join(dir, 'settings.json');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.battery.enabled = false;
      fs.writeFileSync(file, JSON.stringify(saved));
      await start(true);
      await steps(2);
      assert.equal(world.bat.ems, 'off');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')), null);
    });
  } finally {
    await stop();
    await ha.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch((err) => { console.error(err.stack); process.exitCode = 1; });

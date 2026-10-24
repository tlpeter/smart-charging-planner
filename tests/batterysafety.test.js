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
const WS_PORT = 19323, REST_PORT = 19324, PORT = 19299;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-recovery-'));
const world = fake.createWorld('renault_easee');
world.liveLimit = 16;
world.attempts = [];
world.hasBattery = false;
world.store = new Map();
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

const { BATTERIES } = require('./fixtures');
const CFG = { enabled: true, capacity_kwh: 10, charge_kw: 3, discharge_kw: 3, min_pct: 10, max_pct: 100,
  efficiency: 0.9, wear: 0.03, arbitrage: false, ev_discharge: 'never', solar_priority: 'battery' };
async function configureBattery(platform, change = {}) {
  const fx = BATTERIES.find((x) => x.platform === platform);
  const list = fx.list.map(([id, st, attrs, dev]) => [id, st, attrs, 'fixture_' + platform + '_' + dev]);
  for (const row of list) {
    if (/maximum_charging_power/.test(row[0])) row[1] = '1200';
    if (/maximum_discharging_power|maxdischargepower/.test(row[0])) row[1] = '1700';
    if (/ess_mode/.test(row[0])) row[1] = 'SELF_CONSUMPTION';
    if (/operation_mode/.test(row[0]) && platform === 'teslemetry') row[1] = 'autonomous';
    if (/backup_reserve/.test(row[0])) row[1] = '0';
    world.store.set(row[0], row[1]);
  }
  world.otherBattery = { list, devices: Object.fromEntries(list.map((x) => [x[3], platform])), names: {} };
  const candidates = await api('GET', 'api/battery');
  const b = candidates.candidates.find((b) => b.platform === platform);
  assert(b, JSON.stringify(candidates));
  world.reportedAt = { [b.soc_entity]: Date.now() };
  await api('POST', 'api/battery', { ...CFG, platform, soc_entity: b.soc_entity, power_sign: b.power_sign, ...change });
  return { b, list };
}
async function disableOnDisk() {
  const file = path.join(dir, 'settings.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')); cfg.battery.enabled = false;
  fs.writeFileSync(file, JSON.stringify(cfg));
}
async function refused(route, body) {
  const r = await fetch('http://127.0.0.1:' + PORT + '/' + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, 400, JSON.stringify(data)); return data;
}
async function useSigen(change = {}) {
  world.otherBattery = null; world.hasBattery = true;
  world.bat = { soc: 50, ems: 'off', mode: 'Maximum Self Consumption', chg: 4.25, dis: 2.75, autoKw: 0 };
  const id = 'sensor.sigen_plant_battery_state_of_charge';
  world.reportedAt = { [id]: Date.now() }; world.ages = {};
  const cfg = { ...CFG, platform: 'sigen', soc_entity: id, power_sign: 'charge_positive', ...change };
  await api('POST', 'api/battery', cfg); return cfg;
}
async function run() {
  try {
    await start(false);
    await api('POST', 'api/vehicles', { name: CAR.name, device_id: 'car', integration: CAR.platform,
      soc_entity: CAR.soc, plugged_entity: CAR.plugged, capacity_kwh: CAR.capacity, charge_limit_entity: CAR.limit });
    await api('POST', 'api/chargers', { name: CH.name, device_id: 'ch', integration: CH.platform,
      status_entity: CH.status, power_entity: CH.power, switch_entity: CH.switch, phases: 3, max_current: 16 });
    await api('POST', 'api/prices', { source: { type: 'fixed' }, fixed: { mode: 'single', normal: 0.2 } });
    await api('POST', 'api/departures', { schedule_enabled: false, default_soc: 80,
      schedule: Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map((d) => [d, { enabled: false, time: '07:00', soc: 80 }])),
      helper: { enabled: false }, calendar: { enabled: false, match: 'target', buffer_minutes: 0, soc: 80 } });
    world.plugged = false; world.charging = false;
    await start(true);
    for (const platform of ['huawei_solar', 'victron', 'teslemetry']) {
      await check(platform + ' restores exact non-default settings after restart', async () => {
        const { list } = await configureBattery(platform);
        const original = Object.fromEntries(list.map(([id]) => [id, String(world.store.get(id))]));
        await api('POST', 'api/battery/test', { action: platform === 'huawei_solar' ? 'hold' : 'no_discharge' });
        const record = JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8'));
        assert(Object.keys(record.original).length > 0);
        await stop(); await disableOnDisk(); await start(true); await plan();
        for (const id of Object.keys(record.original)) assert.equal(String(world.store.get(id)), original[id], id);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')), null);
      });
    }
    await check('a failed restore retains its snapshot and succeeds on the next control step', async () => {
      await configureBattery('huawei_solar');
      await api('POST', 'api/battery/test', { action: 'hold' });
      world.failCommand = (c) => c.domain === 'number' && c.data.value === 1200;
      await stop(); await disableOnDisk(); await start(true); await plan();
      let record = JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8'));
      assert.equal(record.restoring, true); assert.equal(record.original['number.batteries_maximum_charging_power'].value, 1200);
      world.failCommand = null; await plan();
      assert.equal(Number(world.store.get('number.batteries_maximum_charging_power')), 1200);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')), null);
    });
    await check('a native reserve is kept while enabled and restored to its original zero on release', async () => {
      const { b } = await configureBattery('teslemetry', { min_pct: 30 });
      await plan();
      assert(Number(world.store.get('number.my_home_backup_reserve')) >= 30, 'the active reserve must protect at least the app minimum');
      const r = JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8'));
      assert.equal(r.original['number.my_home_backup_reserve'].value, 0);
      await api('POST', 'api/battery', { ...CFG, min_pct: 30, enabled: false, platform: b.platform, soc_entity: b.soc_entity, power_sign: b.power_sign });
      await plan(); assert.equal(Number(world.store.get('number.my_home_backup_reserve')), 0);
    });
    await check('live upper/lower bounds stop unsafe manual and ongoing charge actions', async () => {
      await useSigen({ max_pct: 80 });
      await api('POST', 'api/battery/test', { action: 'charge' });
      assert.equal(world.bat.mode, 'Command Charging (Grid First)');
      world.bat.soc = 79.5;
      const p = await plan();
      assert.equal(world.bat.mode, 'Standby');
      assert.equal(p.battery_now.code, 'battery_max');
      const mark = world.calls.length;
      await refused('api/battery/test', { action: 'charge' });
      assert(!world.calls.slice(mark).some((c) => c.data.option === 'Command Charging (Grid First)'));
      world.bat.soc = 10;
      await refused('api/battery/test', { action: 'discharge' });
      assert.notEqual(world.bat.mode, 'Command Discharging (ESS First)');
      world.bat.soc = 5;
      await api('POST', 'api/battery/test', { action: 'charge' });
      assert.equal(world.bat.mode, 'Command Charging (Grid First)');
      await api('POST', 'api/battery/test', { action: 'auto' });
    });
    await check('stale SoC blocks charging and holds instead; recovery waits for actual reported settings', async () => {
      const id = 'sensor.sigen_plant_battery_state_of_charge';
      world.bat.soc = 50; world.ages = { [id]: 16 * 60000 };
      await refused('api/battery/test', { action: 'charge' });
      assert.equal(world.bat.mode, 'Standby');
      world.ages = {};
      world.stateOverrides = { switch_sigen: 'unused', 'switch.sigen_plant_remote_ems': 'on' };
      // Use the actual EMS entity from the fixture.
      const ems = (await api('GET', 'api/battery')).last.original;
      const switchId = Object.keys(ems).find((k) => k.startsWith('switch.'));
      world.stateOverrides = { [switchId]: 'on' };
      await stop(); await disableOnDisk(); await start(true); await plan();
      assert(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')), 'snapshot cleared before device confirmation');
      world.stateOverrides = {}; await plan();
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'battery_control.json'), 'utf8')), null);
    });
    await check('legacy ownership without originals needs explicit manual recovery, with no guessed writes', async () => {
      await stop();
      fs.writeFileSync(path.join(dir, 'battery_control.json'), JSON.stringify({ identity: 'sensor.sigen_plant_battery_state_of_charge', action: 'hold', at: Date.now() }));
      await start(true); await plan();
      assert.equal((await api('GET', 'api/battery')).recovery.legacy, true);
      const mark = world.calls.length;
      await api('POST', 'api/battery/recovery', { action: 'confirm_manual_restore' });
      assert.equal(world.calls.length, mark);
      assert.equal((await api('GET', 'api/battery')).recovery.pending, false);
    });
    await check('site battery protection sees secondary and externally started charging, with both EV plans', async () => {
      await useSigen({ max_pct: 90, ev_discharge: 'never' });
      world.car2 = { soc: 30, plug: true, charging: false };
      world.ch2 = { plugged: true, charging: true, amps: 16 };
      world.plugged = false; world.car1Plug = false;
      await api('POST', 'api/vehicles/multi', { enabled: true });
      const car2 = await api('POST', 'api/vehicles', { add: true, name: 'Synthetic second car', device_id: 'car2', integration: 'kia_uvo',
        soc_entity: 'sensor.ev6_battery_level', plugged_entity: 'binary_sensor.ev6_plugged_in', capacity_kwh: 77 });
      const car1 = (await api('GET', 'api/vehicles')).vehicles[0];
      const first = (await api('GET', 'api/chargers')).chargers[0];
      await api('POST', 'api/chargers', { ...first, vehicle_id: car1.id });
      await api('POST', 'api/chargers/multi', { enabled: true });
      const second = await api('POST', 'api/chargers', { add: true, name: 'Second charger', device_id: 'ch2', integration: 'easee',
        status_entity: 'sensor.garage_status', power_entity: 'sensor.garage_power', switch_entity: 'switch.garage_charger_enabled',
        phases: 3, max_current: 16, vehicle_id: car2.vehicle.id });
      const p = await plan();
      assert.equal(world.bat.mode, 'Standby');
      assert.equal(p.battery.ev_plan_count, 2);
      const other = await api('GET', 'api/plan?charger=' + second.charger.id);
      const expected = [p, other].flatMap((x) => x.plan.blocks).reduce((a, b) => a + Math.max(0, b.kwh - (b.solar_kwh || 0)), 0);
      assert(Math.abs(p.battery.ev_planned_kwh - expected) < 0.1, JSON.stringify([p.battery.ev_planned_kwh, expected]));
      assert(p.battery_now.ev_chargers >= 1);
    });
  } finally { await stop(); await ha.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
run().catch((err) => { console.error(err.stack); process.exitCode = 1; });

'use strict';

// Release regressions: delivery-time ambiguity, current caps, persistent
// ownership and vehicle/session attribution. Each case describes user input
// that previously produced an incorrect decision.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-releaseguard-'));
process.env.DATA_DIR = dir;
const app = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const prices = require(path.join(app, 'prices'));
const planner = require(path.join(app, 'planner'));
const controller = require(path.join(app, 'controller'));
const cardata = require(path.join(app, 'cardata'));
const session = require(path.join(app, 'session'));
const scope = require(path.join(app, 'scope'));
const { evaluateReadyGuard } = require(path.join(app, 'reliability'));
const H = 3600000;
function check(name, fn) {
  try { fn(); console.log('ok -', name); }
  catch (err) { console.error('not ok -', name); throw err; }
}
try {
  check('release metadata matches both package version fields and the branch identity', () => {
    const root = path.join(__dirname, '..');
    const cfg = fs.readFileSync(path.join(root, 'smart_charging_planner', 'config.yaml'), 'utf8');
    const pkg = require(path.join(app, 'package.json'));
    const lock = require(path.join(app, 'package-lock.json'));
    const dev = cfg.split('\n').find((l) => l.startsWith('name:')).includes('(dev)');
    const version = cfg.split('\n').find((l) => l.startsWith('version:')).slice('version:'.length).trim().replaceAll('"', '');
    assert.equal(version, pkg.version + (dev ? '-dev' : ''));
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.equal(/^description:.*TEST VERSION:/m.test(cfg), dev);
  });

  check('partial price warnings render once without claiming a total load failure', () => {
    const vm = require('vm');
    const source = fs.readFileSync(path.join(app, 'public', 'app.js'), 'utf8');
    const begin = source.indexOf('    function priceMessagesHtml(d)');
    const end = source.indexOf('    function overviewHtml(d)', begin);
    assert(begin >= 0 && end > begin);
    const render = (input) => vm.runInNewContext(source.slice(begin, end) + '\npriceMessagesHtml(input)', { input, esc: (v) => String(v).replaceAll('<', '&lt;') });
    const warning = 'sensor.example: The price time 2026-10-25 02:00:00 is ambiguous';
    const html = render({ prices: [{ start: 1 }], price_error: null, price_warnings: [warning, warning] });
    assert(html.includes('Available prices are still used.'));
    assert.equal(html.split(warning).length - 1, 1);
    assert(!html.includes('Prices could not be loaded:'));
    assert(render({ prices: [], price_error: 'Sensor missing', price_warnings: [] }).includes('Prices could not be loaded: Sensor missing'));
    assert(render({ prices: [], price_warnings: ['Missing interval'] }).includes('No usable price intervals'));
  });


  check('SoC color follows the absolute level: empty red, middle yellow, full green', () => {
    const vm = require('vm');
    const source = fs.readFileSync(path.join(app, 'public', 'app.js'), 'utf8');
    const begin = source.indexOf('    function socBar(value)');
    const end = source.indexOf('    function readyGuardHtml(d)', begin);
    const bar = (value) => vm.runInNewContext(source.slice(begin, end) + '\n socBar(value)', { value });
    for (const level of [0, 20, 50, 80, 100]) {
      assert.equal(bar(level).level, level);
      assert(bar(level).color.startsWith('hsl(' + Math.round(level * 1.2) + ' '));
    }
    assert.equal(bar(-10).level, 0);
    assert.equal(bar(120).level, 100);
    for (const value of [null, undefined, '', ' ', false, NaN, 'unavailable']) assert.equal(bar(value), null);
  });
  check('confirmed calendar events survive restart but remain scoped and expire', () => {
    const cachePath = path.join(app, 'calendarcache');
    const cache = require(cachePath);
    const now = Date.UTC(2026, 0, 1, 8);
    const events = [{ summary: 'Synthetic trip', description: 'target: 80', start: new Date(now + 3600000).toISOString() }];
    cache.remember('calendar.test', 'Europe/Amsterdam', events, now, now + 15 * 86400000);
    delete require.cache[require.resolve(cachePath)];
    const again = require(cachePath);
    assert.equal(again.fallback('calendar.test', 'Europe/Amsterdam', now + 60000).health.state, 'cached');
    assert.deepEqual(again.fallback('calendar.test', 'Europe/Amsterdam', now + 60000).events, events);
    assert.equal(again.fallback('calendar.other', 'Europe/Amsterdam', now + 60000).events.length, 0);
    assert.equal(again.fallback('calendar.test', 'UTC', now + 60000).events.length, 0);
    scope.run('other-charger', () => assert.equal(again.fallback('calendar.test', 'Europe/Amsterdam', now + 60000).events.length, 0));
    assert.equal(again.fallback('calendar.test', 'Europe/Amsterdam', now + again.MAX_AGE_MS).events.length, 0);
    assert.equal(again.fallback('calendar.test', 'Europe/Amsterdam', now - 1).events.length, 0);
  });
  check('successful reschedules and cancellations replace the confirmed calendar immediately', () => {
    const cache = require(path.join(app, 'calendarcache'));
    const now = Date.UTC(2026, 0, 2, 8);
    const event = { summary: 'Synthetic trip', description: 'target: 80', start: new Date(now + 2 * 3600000).toISOString() };
    cache.remember('calendar.test', 'Europe/Amsterdam', [event], now, now + 15 * 86400000);
    const departure = require(path.join(app, 'departures'));
    const dep = departure.normalise({ schedule_enabled: false, calendar: { enabled: true, entity: 'calendar.test', match: 'target', buffer_minutes: 0, soc: 80 } });
    const cached = cache.fallback('calendar.test', 'Europe/Amsterdam', now + 60000).events;
    assert.equal(departure.calendarTrips(dep, cached, 'Europe/Amsterdam', now + 60000)[0].time, now + 2 * 3600000);
    assert.equal(departure.calendarTrips(dep, cached, 'Europe/Amsterdam', now + 3 * 3600000).length, 0);
    cache.remember('calendar.test', 'Europe/Amsterdam', [], now + 120000, now + 15 * 86400000);
    assert.equal(cache.fallback('calendar.test', 'Europe/Amsterdam', now + 180000).events.length, 0);
  });

  check('an offset-free repeated DST hour is rejected with an actionable warning', () => {
    const warnings = [];
    assert(Number.isNaN(prices.priceTime('2026-10-25 02:00:00', 'Europe/Amsterdam', warnings)));
    assert.match(warnings.join(' '), /offset/);
  });
  check('both offset-tagged repeated hours remain distinct delivery intervals', () => {
    const list = [
      { time: '2026-10-25T01:00:00+02:00', price: 0.2 },
      { time: '2026-10-25T02:00:00+02:00', price: 0.1 },
      { time: '2026-10-25T02:00:00+01:00', price: 0.3 },
      { time: '2026-10-25T03:00:00+01:00', price: 0.4 },
    ];
    const r = prices.pricesFromAttributes({ prices: list }, 'Europe/Amsterdam');
    assert.equal(r.prices.length, 4);
    assert.equal(r.prices[2].start - r.prices[1].start, H);
    assert.equal(r.warnings.length, 0);
  });
  check('a nonexistent spring clock hour is rejected, an ordinary local time is retained', () => {
    assert(Number.isNaN(prices.priceTime('2026-03-29 02:30:00', 'Europe/Amsterdam', [])));
    assert.equal(prices.priceTime('2026-10-24 02:30:00', 'Europe/Amsterdam', []), Date.parse('2026-10-24T02:30:00+02:00'));
  });
  for (const [day, hours] of [['2026-03-29', 23], ['2026-10-25', 25]]) {
    check('price coverage uses ' + hours + ' actual hours on ' + day, () => {
      const start = Date.parse(day + 'T00:00:00+0' + (hours === 23 ? '1' : '2') + ':00');
      const end = start + hours * H;
      const list = Array.from({ length: hours * 4 }, (_, i) => ({ start: start + i * H / 4, end: start + (i + 1) * H / 4, price: 0.2 }));
      const summary = (ps) => prices.summarise({ prices: ps, interval_minutes: 15, window: { start, tomorrow: end, end: end + 24 * H }, warnings: [] }, { price_type: 'all_in' }, start);
      assert.equal(summary(list).warnings.length, 0);
      const missing = list.filter((_, i) => i !== 8);
      assert(summary(missing).warnings.some((w) => /gap/.test(w)));
    });
  }
  check('missing price values do not become free slots; zero and negative prices remain valid', () => {
    const values = [null, '', ' ', false, 0, -0.1, 0.2, 0.3];
    const r = prices.pricesFromAttributes({ prices: values.map((price, i) => ({ time: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), price })) }, 'UTC');
    assert.deepEqual(r.prices.map((x) => x.price), [0, -0.1, 0.2, 0.3]);
    assert(r.warnings.length);
  });
  check('zero current remains zero planning power', () => assert.equal(planner.chargePowerKw(3, 0), 0));
  for (const amps of [0, 4, 5]) {
    check('a ' + amps + ' A cap blocks boost, minimum, preheat and Ready Guard', () => {
      const base = {
        now: Date.now(), phases: 3, actual: { plugged: true, charging: true, status_invalid: false },
        rules: { ...controller.DEFAULT_RULES, min_soc_enabled: true, min_soc: 30, preheat_entity: 'binary_sensor.preheat' },
        states: [{ entity_id: 'binary_sensor.preheat', state: 'on' }], boostActive: true,
        plan: { charger: { max_current: amps }, vehicle: { soc: 10 }, reliability: { protect: true }, plan: { blocks: [], periods: [], notes: [] }, planning: { target_soc: 80 } },
      };
      const d = controller.decide(base);
      assert.equal(d.want, 'pause');
      assert.equal(d.code, 'current_limit');
    });
  }
  check('an old locked charging period cannot exceed a lower live cap', () => {
    const now = Date.now();
    const d = controller.decide({ now, phases: 3, actual: { plugged: true, charging: true }, rules: controller.DEFAULT_RULES, states: [], lock: { end: now + H, amps: 16 }, plan: { charger: { max_current: 8 }, vehicle: { soc: 40 }, planning: { target_soc: 80 }, plan: { blocks: [], notes: [] } } });
    assert.equal(d.amps, 8);
  });
  check('device ownership survives a module reload and is isolated by charger and device', () => {
    const modulePath = path.join(app, 'controlmemory');
    let memory = require(modulePath);
    memory.setCharger('device-a', { current: { amps: 7, pending: true }, phases: { phases: 1 } });
    memory.setBattery({ identity: 'sensor.battery', action: 'hold', failed: true });
    delete require.cache[require.resolve(modulePath)];
    memory = require(modulePath);
    assert.equal(memory.charger('device-a').current.amps, 7);
    assert.equal(memory.charger('device-b').current, null);
    scope.run('charger2', () => assert.equal(memory.charger('device-a').current, null));
    assert.equal(memory.battery().action, 'hold');
    assert.equal(memory.battery().failed, true);
    memory.setCharger('device-a', { current: null });
    assert.equal(memory.charger('device-a').phases.phases, 1);
  });
  check('stale estimates only use energy from the same car, charger and observed session', () => {
    const sess = { id: 'session-a', vehicle_id: 'car-a', since: 1000 };
    const last = { soc: 80, at: 2000, vehicle_id: 'car-a', charger_id: 'charger1', session_id: 'session-a' };
    const ctx = { vehicleId: 'car-a', chargerId: 'charger1', plugged: true };
    assert(cardata.usable(last, sess, ctx));
    assert(!cardata.usable(last, { ...sess, id: 'new-session' }, ctx));
    assert(!cardata.usable(last, sess, { ...ctx, vehicleId: 'car-b' }));
    assert(!cardata.usable(last, sess, { ...ctx, chargerId: 'charger2' }));
    assert(!cardata.usable(last, sess, { ...ctx, plugged: false }));
    assert(!cardata.usable({ ...last, at: 500 }, sess, ctx));
  });
  check('a car change without a cable transition creates a new charging session', () => {
    const a = { ...session.update(true, 1000, 'car-a') };
    const b = session.update(true, 2000, 'car-b');
    assert.notEqual(a.id, b.id);
    assert.equal(b.vehicle_id, 'car-b');
    assert.equal(b.since, 2000);
  });
  check('a restart cannot assume cable continuity for stale SoC', () => {
    const old = { ...session.current() };
    delete require.cache[require.resolve(path.join(app, 'session'))];
    const fresh = require(path.join(app, 'session')).update(true, 3000, 'car-b');
    assert.notEqual(old.id, fresh.id);
    assert.equal(fresh.since_known, false);
  });
  check('Ready Guard never confirms Ready now from an estimated battery level', () => {
    const now = Date.now();
    const r = evaluateReadyGuard({ now, deadline: now + H, neededKwh: 0, powerKw: 11, controlAllowed: true, plugged: true, carData: { ok: false, assumed: true }, blocks: [] });
    assert.equal(r.status, 'action_needed');
    assert.notEqual(r.label, 'Ready now');
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

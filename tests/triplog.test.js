'use strict';

// Trip log (#61): drives from Home Assistant's hourly statistics (odometer,
// battery level, outside temperature), charged-on-the-way drives left out,
// kept up to date, the sensors found on the car, and the use per km and the
// cold correction learned from the log.
// Run: node tests/triplog.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-triplog-'));
const assert = require('assert/strict');
const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const tl = require(path.join(APP, 'triplog'));
const tc = require(path.join(APP, 'tripcost'));

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

const H = 3600000;
const T0 = Date.UTC(2026, 0, 5, 0); // a made-up Monday, 00:00 UTC

// A made-up history: per hour the odometer at the end of the hour, the battery
// level (min/max/mean) and the outside temperature.
function history(hours, plan) {
  const odo = []; const soc = []; const temp = [];
  let km = 12000; let level = 80;
  for (let i = 0; i < hours; i++) {
    const start = T0 + i * H;
    const p = plan(i) || {};
    const before = level;
    km += p.km || 0;
    level += p.soc || 0;
    odo.push({ start, end: start + H, state: km, sum: km - 12000 });
    soc.push({ start, end: start + H, mean: (before + level) / 2, min: Math.min(before, level, p.low ?? Infinity), max: Math.max(before, level, p.high ?? -Infinity) });
    temp.push({ start, end: start + H, mean: p.t ?? 10 });
  }
  return { odo, soc, temp };
}

(async () => {
  console.log('Trip log (#61)');

  await check('a drive over two hours: real km from the odometer, the battery used, kWh with the capacity, the mean temperature', () => {
    // 07:00–09:00: 40 + 50 km, 80 → 62 %, 4 and 6 °C.
    const rows = history(24, (i) => (i === 7 ? { km: 40, soc: -8, t: 4 } : i === 8 ? { km: 50, soc: -10, t: 6 } : null));
    const d = tl.drivesFrom(rows, { capacityKwh: 60, until: T0 + 24 * H });
    assert.equal(d.length, 1, JSON.stringify(d));
    const x = d[0];
    assert.equal(x.km, 90);
    assert.equal(x.soc_start, 80);
    assert.equal(x.soc_end, 62);
    assert.equal(x.pct, 18);
    assert.equal(x.kwh, 10.8);
    assert.equal(x.pct_100km, 20);
    assert.equal(x.kwh_100km, 12);
    assert.equal(x.temp, 5);
    assert.ok(x.used && x.start === T0 + 7 * H && x.end === T0 + 9 * H, JSON.stringify(x));
  });

  await check('two drives with parking in between are two drives; a short drive and a drive with charging on the way are listed but not used', () => {
    const rows = history(24, (i) => ({
      6: { km: 60, soc: -12 }, // there
      12: { km: 5, soc: -1 }, // a short drive at lunch
      16: { km: 30, soc: -6 }, 17: { km: 40, soc: 15, high: 90 }, 18: { km: 40, soc: -9 }, // charged on the way back
    })[i]);
    const d = tl.drivesFrom(rows, { capacityKwh: 60, until: T0 + 24 * H });
    assert.equal(d.length, 3, JSON.stringify(d.map((x) => x.km)));
    assert.ok(d[0].used && d[0].km === 60, JSON.stringify(d[0]));
    assert.ok(!d[1].used && d[1].why === 'short', JSON.stringify(d[1]));
    assert.ok(!d[2].used && d[2].charged && d[2].why === 'charged', JSON.stringify(d[2]));
  });

  await check('a drive still going on (or its hour after not known yet) waits; a gap in the statistics is not a drive', () => {
    const rows = history(10, (i) => (i === 8 ? { km: 50, soc: -10 } : null));
    assert.equal(tl.drivesFrom(rows, { until: T0 + 9 * H }).length, 0);
    assert.equal(tl.drivesFrom(rows, { until: T0 + 10 * H }).length, 1);
    // A missing hour: the km across it are not counted as a drive.
    const gap = history(10, () => null);
    gap.odo.splice(5, 1);
    gap.odo[5].state += 80;
    assert.equal(tl.drivesFrom(gap, { until: T0 + 10 * H }).length, 0);
  });

  await check('the odometer and an outside temperature are found on the car; the range sensor is never the odometer', () => {
    const vehicle = { id: 'car1', device_id: 'dev1', range_entity: 'sensor.testcar_range', mode: 'sensor', soc_entity: 'sensor.testcar_battery' };
    const entities = [
      { entity_id: 'sensor.testcar_range', device_id: 'dev1' },
      { entity_id: 'sensor.testcar_mileage', device_id: 'dev1' },
      { entity_id: 'sensor.testcar_outside_temperature', device_id: 'dev1' },
      { entity_id: 'sensor.other_mileage', device_id: 'dev2' },
    ];
    const states = [
      { entity_id: 'sensor.testcar_range', state: '250', attributes: { device_class: 'distance', state_class: 'measurement', unit_of_measurement: 'km' } },
      { entity_id: 'sensor.testcar_mileage', state: '12000', attributes: { device_class: 'distance', state_class: 'total_increasing', unit_of_measurement: 'km', friendly_name: 'Testcar Mileage' } },
      { entity_id: 'sensor.testcar_outside_temperature', state: 'unknown', attributes: { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'Testcar Outside temperature' } },
      { entity_id: 'sensor.garden_outdoor_temperature', state: '9.5', attributes: { device_class: 'temperature', state_class: 'measurement', unit_of_measurement: '°C' } },
    ];
    const s = tl.sensorsFor(vehicle, entities, states);
    assert.equal(s.odometer, 'sensor.testcar_mileage');
    assert.equal(s.soc, 'sensor.testcar_battery');
    // The car's own sensor reports no number: an outdoor sensor that does.
    assert.equal(s.temp, 'sensor.garden_outdoor_temperature');
    states[2].state = '7';
    assert.equal(tl.sensorsFor(vehicle, entities, states).temp, 'sensor.testcar_outside_temperature');
    // Chosen in Settings wins.
    assert.equal(tl.sensorsFor({ ...vehicle, odometer_entity: 'sensor.other_mileage' }, entities, states).odometer, 'sensor.other_mileage');
  });

  await check('refresh: the first time from the history in parts, then only the new hours; only reading statistics; nothing without an odometer', async () => {
    tl.reset();
    // 30 days: every weekday 07:00 there (60 km) and 17:00 back (60 km); colder later.
    const days = 30;
    const rows = history(days * 24, (i) => {
      const day = Math.floor(i / 24); const h = i % 24; const t = 14 - day * 0.5;
      const v = (0.2 * (1 + 0.02 * Math.max(0, 15 - t))) * 60; // % for 60 km
      if (h === 7 || h === 17) return { km: 60, soc: -v, t };
      if (h === 20) return { soc: 2 * v }; // charged at home
      return { t };
    });
    const calls = [];
    const call = async (m) => {
      calls.push(m);
      assert.equal(m.type, 'recorder/statistics_during_period');
      const from = Date.parse(m.start_time); const to = Date.parse(m.end_time);
      const pick = (list) => list.filter((r) => r.start >= from && r.start < to);
      return { 'sensor.testcar_mileage': pick(rows.odo), 'sensor.testcar_battery': pick(rows.soc), 'sensor.garden_outdoor_temperature': pick(rows.temp) };
    };
    const vehicle = { id: 'car1', name: 'Testcar', device_id: 'dev1', mode: 'sensor', soc_entity: 'sensor.testcar_battery', capacity_kwh: 60, odometer_entity: 'sensor.testcar_mileage', temperature_entity: 'sensor.garden_outdoor_temperature' };
    const now = T0 + days * 24 * H;
    let rec = await tl.refresh(vehicle, { call, entities: [], states: [], now });
    assert.equal(rec.status, 'ok');
    assert.ok(calls.length > 3, `asked in parts: ${calls.length}`);
    assert.ok(calls.every((m) => m.period === 'hour' && m.units.distance === 'km'), JSON.stringify(calls[0]));
    const n = rec.drives.length;
    assert.ok(n >= 2 * days - 2 && n <= 2 * days, `drives: ${n}`);
    // Again an hour later: only the last day asked, the same drives.
    calls.length = 0;
    rec = await tl.refresh(vehicle, { call, entities: [], states: [], now: now + H });
    assert.equal(calls.length, 1);
    assert.equal(rec.drives.length, n);
    // The use per km and the cold, learned from the log.
    const m = tl.model('car1');
    assert.ok(m && m.source === 'log' && m.trips === n && m.samples.length === n, JSON.stringify({ ...m, samples: undefined }));
    const fit = tc.fitCold(m);
    assert.ok(fit && Math.abs(fit.extra - 2) < 0.4, `extra per degree: ${fit && fit.extra}`);
    // Off for the car: not refreshed.
    assert.equal(await tl.refresh({ ...vehicle, trip_log: false }, { call, entities: [], states: [], now }), null);
    // No odometer: says so, no statistics asked.
    calls.length = 0;
    const none = await tl.refresh({ ...vehicle, id: 'car2', odometer_entity: null, device_id: 'nothing' }, { call, entities: [], states: [], now });
    assert.ok(none.status === 'no_odometer' && calls.length === 0, JSON.stringify(none));
  });

  await check('trip estimates use the log (the real km) instead of the planned-distance learning, also for the cold', () => {
    tc.setLogProvider((id) => tl.model(id));
    const car = { id: 'car1', capacity_kwh: 60, consumption_kwh_100km: 18, cold_correction: true, cold_extra_pct: 1.5 };
    const r = tc.pctPerKm(car, [], 50, 0);
    assert.ok(r.how === 'learned' && r.cold && r.cold.learned === true, JSON.stringify(r));
    // About 0.2 % per km at 15 °C and +2 % per degree: 0 °C → about 0.26.
    assert.ok(Math.abs(r.pct_per_km - 0.26) < 0.02, JSON.stringify(r));
    // A car without a log: as before (the use per 100 km).
    const other = tc.pctPerKm({ ...car, id: 'car9', cold_correction: false }, [], 50, 0);
    assert.ok(other.how === 'consumption' && Math.abs(other.pct_per_km - 0.3) < 1e-9, JSON.stringify(other));
    tc.setLogProvider(null);
  });

  await check('the page view: newest drive first, totals, the sensors used', () => {
    const v = tl.view('car1');
    assert.equal(v.status, 'ok');
    assert.ok(v.drives.length === v.total && v.drives[0].start > v.drives[v.drives.length - 1].start);
    assert.ok(v.km > 3000 && v.pct_100km > 15 && v.pct_100km < 35, JSON.stringify({ ...v, drives: undefined }));
    assert.equal(v.sensors.odometer, 'sensor.testcar_mileage');
  });

  await check('"Use more in the cold" is turned on once for cars saved before (#61); turned off again by you, it stays off', () => {
    const settings = require(path.join(APP, 'settings'));
    fs.writeFileSync(path.join(process.env.DATA_DIR, 'settings.json'), JSON.stringify({ vehicles: [{ id: 'car1', name: 'Testcar', cold_correction: false }] }));
    let s = settings.load();
    assert.ok(s.vehicles[0].cold_correction === true && s.cold_default_on === true, JSON.stringify(s.vehicles));
    s.vehicles[0].cold_correction = false;
    settings.save(s);
    s = settings.load();
    assert.equal(s.vehicles[0].cold_correction, false);
  });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll trip log checks passed');
  process.exit(failures ? 1 : 0);
})();

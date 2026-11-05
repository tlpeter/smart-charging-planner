'use strict';

// What a trip costs: which calendar locations are addresses, the use per km
// (range sensor, consumption, learned from trips) and learning from trips;
// using more in the cold, with the temperature from a weather forecast (#56).
// Run: node tests/tripcost.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-tripcost-'));
const assert = require('assert');
const t = require('../smart_charging_planner/app/tripcost');

let failures = 0;
function check(name, fn) {
  t.reset();
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

check('addresses and place names are looked up; "Werk", "Thuis" and empty are not', () => {
  assert.ok(t.looksLikePlace('Hoofdweg 1 1111 AA Meadowtown'));
  assert.ok(t.looksLikePlace('Molenstraat 5, 1113 AA Hilltown'));
  assert.ok(t.looksLikePlace('Nijmegen'));
  for (const x of ['Werk', 'werk', 'Thuis', 'Home', 'Gym', '', '  ']) assert.ok(!t.looksLikePlace(x), x);
  assert.ok(t.isHome('Thuis') && t.isHome('naar huis') && !t.isHome('Werk'));
  assert.ok(t.isHome('Home') && t.isHome('Naar Home') && t.isHome('to home') && !t.isHome('Homeoffice'));
});
check('use per km from the range sensor: 300 km at 75 % → 0.25 % per km', () => {
  const states = [{ entity_id: 'sensor.range', state: '300', attributes: { unit_of_measurement: 'km' } }];
  const r = t.pctPerKm({ id: 'a', range_entity: 'sensor.range', capacity_kwh: 52 }, states, 75);
  assert.strictEqual(r.how, 'range');
  assert.ok(Math.abs(r.pct_per_km - 0.25) < 1e-9);
});
check('range in miles is converted', () => {
  const states = [{ entity_id: 'sensor.range', state: '186.4', attributes: { unit_of_measurement: 'mi' } }];
  const r = t.pctPerKm({ id: 'a', range_entity: 'sensor.range' }, states, 75);
  assert.ok(Math.abs(r.pct_per_km - 75 / (186.4 * 1.609)) < 1e-9);
});
check('without a range sensor: the consumption (18 kWh/100 km default) and the capacity', () => {
  const r = t.pctPerKm({ id: 'a', capacity_kwh: 60 }, [], 50);
  assert.strictEqual(r.how, 'consumption');
  assert.ok(Math.abs(r.pct_per_km - 0.3) < 1e-9);
  const own = t.pctPerKm({ id: 'a', capacity_kwh: 60, consumption_kwh_100km: 15 }, [], 50);
  assert.ok(Math.abs(own.pct_per_km - 0.25) < 1e-9);
  assert.strictEqual(t.pctPerKm({ id: 'a' }, [], 50), null);
});
check('learned from trips: the battery level when leaving and when back, after two trips it is used', () => {
  const now = Date.now();
  t.tripStarted('a', 90, 100, now);
  assert.ok(Math.abs(t.tripEnded('a', 70, now + 5 * 3600000) - 0.2) < 1e-9);
  assert.strictEqual(t.pctPerKm({ id: 'a', capacity_kwh: 60 }, [], 70).how, 'consumption'); // one trip is not enough
  t.tripStarted('a', 80, 100, now);
  t.tripEnded('a', 50, now + 5 * 3600000);
  const r = t.pctPerKm({ id: 'a', capacity_kwh: 60 }, [], 50);
  assert.strictEqual(r.how, 'learned');
  assert.ok(Math.abs(r.pct_per_km - (0.2 * 0.7 + 0.3 * 0.3)) < 1e-9);
});
check('implausible trips are not learned: back after 3 days, charged on the way, or 3 % per km', () => {
  const now = Date.now();
  t.tripStarted('b', 90, 100, now);
  assert.strictEqual(t.tripEnded('b', 60, now + 72 * 3600000), null);
  t.tripStarted('b', 60, 100, now);
  assert.strictEqual(t.tripEnded('b', 80, now + 3600000), null);
  t.tripStarted('b', 90, 10, now);
  assert.strictEqual(t.tripEnded('b', 60, now + 3600000), null);
  assert.strictEqual(t.learned('b'), null);
});
check('distance: home is 0 km, a word that is not an address is unknown, a new address is looked up (pending)', () => {
  const home = { lat: 51.37, lon: 2.69 };
  assert.deepStrictEqual(t.distance('Thuis', home), { status: 'home', km: 0 });
  assert.strictEqual(t.distance('Werk', home).status, 'unknown');
  assert.strictEqual(t.distance('Hoofdweg 1 Meadowtown', null).status, 'no_home');
});
check('straight line: Springfield to Meadowtown is about 100 km', () => {
  const km = t.haversineKm({ lat: 51.36, lon: 2.66 }, { lat: 51.98, lon: 1.99 });
  assert.ok(km > 80 && km < 100, String(km));
});

check('My places: "Werk" (location or title "Naar Werk") uses its address; a real address in the location wins; unknown names are suggested', () => {
  t.setSavedPlaces([{ name: 'Werk', address: 'Industrieweg 10, 1112 AA Rivertown' }, { name: 'Northwind Labs', address: 'Industrieweg 10, Rivertown' }]);
  try {
    assert.deepStrictEqual(t.placeFor('Werk', 'Naar Werk'), { location: 'Industrieweg 10, 1112 AA Rivertown', place: 'Werk', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor('northwind labs', 'Naar kantoor'), { location: 'Industrieweg 10, Rivertown', place: 'Northwind Labs', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor(null, 'Naar Werk'), { location: 'Industrieweg 10, 1112 AA Rivertown', place: 'Werk', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor('Acme BV', 'Naar Werk'), { location: 'Industrieweg 10, 1112 AA Rivertown', place: 'Werk', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor('Stationsplein 1, Utrecht', 'Naar Werk'), { location: 'Stationsplein 1, Utrecht', place: null });
    assert.deepStrictEqual(t.placeFor('Gent', 'Naar Gent'), { location: 'Gent', place: null });
    assert.deepStrictEqual(t.placeFor('Thuis', 'Naar Thuis'), { location: 'Thuis', place: null });
    assert.strictEqual(t.askName('Northwind Labs', 'Naar Werk'), 'Werk');
    assert.strictEqual(t.askName('Werk', ''), 'Werk');
    assert.strictEqual(t.askName(null, 'Naar Thuis'), null);
  } finally {
    t.setSavedPlaces([]);
  }
});

check('Zones in Home Assistant: "Werk" (by name or by the title) is a point with GPS; the home zone is not a place; My places go first', () => {
  t.setZones([
    { entity_id: 'zone.home', attributes: { friendly_name: 'Thuis', latitude: 51.37, longitude: 2.69 } },
    { entity_id: 'zone.werk', attributes: { friendly_name: 'Werk', latitude: 51.80, longitude: 2.20 } },
    { entity_id: 'zone.sportschool_springfield', attributes: { friendly_name: 'Gym Club', latitude: 51.36, longitude: 2.67 } },
  ]);
  try {
    const w = t.placeFor('Werk', 'Naar Werk');
    assert.strictEqual(w.kind, 'zone');
    assert.deepStrictEqual(w.point, { lat: 51.8, lon: 2.2 });
    assert.strictEqual(t.placeFor('Northwind Labs', 'Naar Werk').kind, 'zone');
    assert.strictEqual(t.placeFor('sportschool springfield', '').place, 'Gym Club');
    assert.strictEqual(t.zoneList().length, 2);
    const d = t.pointDistance({ lat: 51.80, lon: 2.20 }, { lat: 51.37, lon: 2.69 });
    assert.ok(d.status === 'ok' && d.how === 'estimate' && d.km > 70 && d.km < 100, JSON.stringify(d));
    assert.strictEqual(t.pointDistance({ lat: 51.3701, lon: 2.6901 }, { lat: 51.37, lon: 2.69 }).status, 'home');
    t.setSavedPlaces([{ name: 'Werk', address: 'Industrieweg 10, Rivertown' }]);
    assert.strictEqual(t.placeFor('Werk', '').kind, 'saved');
  } finally {
    t.setZones([]);
    t.setSavedPlaces([]);
  }
});

// Use more in the cold (#56). Made-up car: 60 kWh, 18 kWh/100 km → 0.3 % per km.
const coldCar = (extra = {}) => ({ id: 'c', capacity_kwh: 60, consumption_kwh_100km: 18, cold_correction: true, cold_extra_pct: 1.5, weather_entity: 'weather.forecast_test', ...extra });
check('cold (#56) off: no correction, as before', () => {
  const r = t.pctPerKm(coldCar({ cold_correction: false }), [], 50, 0);
  assert.ok(Math.abs(r.pct_per_km - 0.3) < 1e-9 && !r.cold);
});
check('cold (#56): 3 °C and 1.5 % per degree → 12 degrees × 1.5 % = +18 %', () => {
  const r = t.pctPerKm(coldCar(), [], 50, 3);
  assert.ok(Math.abs(r.pct_per_km - 0.3 * 1.18) < 1e-9, String(r.pct_per_km));
  assert.deepStrictEqual(r.cold, { temp: 3, factor: 1.18, extra: 1.5, learned: false });
});
check('cold (#56): 15 °C or warmer, or no temperature: no extra; very cold is capped at +80 %', () => {
  assert.ok(Math.abs(t.pctPerKm(coldCar(), [], 50, 22).pct_per_km - 0.3) < 1e-9);
  const none = t.pctPerKm(coldCar(), [], 50, null);
  assert.ok(Math.abs(none.pct_per_km - 0.3) < 1e-9 && none.cold.temp === null);
  assert.strictEqual(t.coldFactor(5, -30), 1.8);
});
check('cold (#56): the range sensor is not corrected (it already includes the weather of now)', () => {
  const states = [{ entity_id: 'sensor.range', state: '300', attributes: { unit_of_measurement: 'km' } }];
  const r = t.pctPerKm(coldCar({ range_entity: 'sensor.range' }), states, 75, -5);
  assert.strictEqual(r.how, 'range');
  assert.ok(Math.abs(r.pct_per_km - 0.25) < 1e-9 && !r.cold);
});
check('cold (#56): a trip cost includes the correction', () => {
  t.setSavedPlaces([{ name: 'Exempelstad', km: 50 }]);
  try {
    const warm = t.tripCost({ location: 'Exempelstad', vehicle: coldCar(), states: [], soc: 80, temp: 20 });
    const cold = t.tripCost({ location: 'Exempelstad', vehicle: coldCar(), states: [], soc: 80, temp: 5 });
    assert.strictEqual(warm.status, 'ok');
    assert.ok(cold.pct > warm.pct && Math.abs(cold.pct / warm.pct - 1.15) < 0.02, `${warm.pct} → ${cold.pct}`);
    assert.strictEqual(cold.cold.temp, 5);
  } finally {
    t.setSavedPlaces([]);
  }
});
check('cold (#56): learning remembers the temperature; after 4 trips with 5+ degrees spread the extra use per degree is learned', () => {
  const now = Date.now();
  // 0.30 % per km at 15 °C, +2 % per degree colder: 10 °C → 0.33, 5 °C → 0.36, 0 °C → 0.39.
  const trips = [[15, 0.30], [10, 0.33], [5, 0.36], [0, 0.39]];
  trips.forEach(([temp, v], i) => {
    t.tripStarted('c', 80, 100, now + i * 86400000, temp);
    t.tripEnded('c', 80 - v * 100, now + i * 86400000 + 3600000, temp);
  });
  const l = t.learned('c');
  assert.strictEqual(l.samples.length, 4);
  assert.deepStrictEqual(l.samples.map((x) => x.t), [15, 10, 5, 0]);
  const fit = t.fitCold(l);
  assert.ok(fit && Math.abs(fit.extra - 2) < 0.01 && Math.abs(fit.base - 0.30) < 1e-6, JSON.stringify(fit));
  const r = t.pctPerKm(coldCar(), [], 50, 0);
  assert.ok(r.how === 'learned' && r.cold.learned === true && Math.abs(r.pct_per_km - 0.39) < 1e-6, JSON.stringify(r));
});
check('drive home (#62): the route\'s own drive time when known, else 70 km/h; nothing without a distance', () => {
  assert.deepStrictEqual(t.driveMinutes(60, 48), { min: 48, how: 'route' });
  assert.deepStrictEqual(t.driveMinutes(60), { min: 51, how: 'estimate' });
  assert.deepStrictEqual(t.driveMinutes(70, null), { min: 60, how: 'estimate' });
  assert.strictEqual(t.driveMinutes(0), null);
  assert.strictEqual(t.driveMinutes(null), null);
});
check('cold (#56): too little spread or too few trips: the setting is used', () => {
  const now = Date.now();
  [[10, 0.33], [9, 0.34], [8, 0.34], [11, 0.32]].forEach(([temp, v], i) => {
    t.tripStarted('c', 80, 100, now + i * 86400000, temp);
    t.tripEnded('c', 80 - v * 100, now + i * 86400000 + 3600000, temp);
  });
  assert.strictEqual(t.fitCold(t.learned('c')), null);
  assert.strictEqual(t.coldModel(coldCar()).extra, 1.5);
});

// The weather forecast (#56): only read, hourly first, then daily, then now.
(async () => {
  const ha = require('../smart_charging_planner/app/ha');
  const w = require('../smart_charging_planner/app/weather');
  const original = ha.callAction;
  const calls = [];
  const base = Date.parse('2026-11-04T06:00:00Z');
  ha.callAction = async (domain, service, data, target) => {
    calls.push(`${domain}.${service} ${data.type} ${target.entity_id}`);
    if (data.type === 'hourly') return { 'weather.forecast_test': { forecast: [0, 1, 2].map((h) => ({ datetime: new Date(base + h * 3600000).toISOString(), temperature: 2 + h })) } };
    return { 'weather.forecast_test': { forecast: [{ datetime: '2026-11-06T11:00:00+00:00', temperature: 9, templow: 1 }] } };
  };
  try {
    const states = [{ entity_id: 'weather.forecast_test', state: 'cloudy', attributes: { temperature: 7, temperature_unit: '°C' } }];
    await w.refresh('weather.forecast_test', states, base);
    await w.refresh('weather.forecast_test', states, base + 60000); // kept for 30 minutes
    const r = [
      ['hourly forecast at the time of the trip', w.tempAt('weather.forecast_test', base + 3600000, { states, tz: 'UTC', now: base }), 3],
      ['daily forecast further ahead: the middle of high and low', w.tempAt('weather.forecast_test', Date.parse('2026-11-06T08:00:00Z'), { states, tz: 'UTC', now: base }), 5],
      ['no forecast for that day: unknown', w.tempAt('weather.forecast_test', Date.parse('2026-11-09T08:00:00Z'), { states, tz: 'UTC', now: base }), null],
      ['°F is converted', w.celsius(41, '°F'), 5],
    ];
    for (const [name, got, want] of r) {
      if (got === want) console.log('  ok  ', `weather (#56): ${name}`);
      else { failures++; console.log('  FAIL', `weather (#56): ${name} - ${got} ≠ ${want}`); }
    }
    const once = calls.length === 2 && calls.every((c) => c.startsWith('weather.get_forecasts'));
    if (once) console.log('  ok  ', 'weather (#56): only weather.get_forecasts, fetched once per 30 minutes');
    else { failures++; console.log('  FAIL', 'weather (#56): calls', calls); }
  } finally {
    ha.callAction = original;
    w.reset();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();

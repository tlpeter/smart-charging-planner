'use strict';

// What a trip costs: which calendar locations are addresses, the use per km
// (range sensor, consumption, learned from trips) and learning from trips.
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
  assert.ok(t.looksLikePlace('Hoeksekade 141 2661 JL Bergschenhoek'));
  assert.ok(t.looksLikePlace('Stuivezandsestraat 50, 4921 XR Made'));
  assert.ok(t.looksLikePlace('Nijmegen'));
  for (const x of ['Werk', 'werk', 'Thuis', 'Home', 'Gym', '', '  ']) assert.ok(!t.looksLikePlace(x), x);
  assert.ok(t.isHome('Thuis') && t.isHome('naar huis') && !t.isHome('Werk'));
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
  const home = { lat: 51.37, lon: 5.19 };
  assert.deepStrictEqual(t.distance('Thuis', home), { status: 'home', km: 0 });
  assert.strictEqual(t.distance('Werk', home).status, 'unknown');
  assert.strictEqual(t.distance('Hoeksekade 141 Bergschenhoek', null).status, 'no_home');
});
check('straight line: Reusel to Bergschenhoek is about 100 km', () => {
  const km = t.haversineKm({ lat: 51.36, lon: 5.16 }, { lat: 51.98, lon: 4.49 });
  assert.ok(km > 80 && km < 100, String(km));
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

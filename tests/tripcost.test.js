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
  assert.ok(t.looksLikePlace('Hoofdweg 1 2661 AA Bergschenhoek'));
  assert.ok(t.looksLikePlace('Molenstraat 5, 4921 AA Made'));
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
  const home = { lat: 51.37, lon: 5.19 };
  assert.deepStrictEqual(t.distance('Thuis', home), { status: 'home', km: 0 });
  assert.strictEqual(t.distance('Werk', home).status, 'unknown');
  assert.strictEqual(t.distance('Hoofdweg 1 Bergschenhoek', null).status, 'no_home');
});
check('straight line: Springfield to Bergschenhoek is about 100 km', () => {
  const km = t.haversineKm({ lat: 51.36, lon: 5.16 }, { lat: 51.98, lon: 4.49 });
  assert.ok(km > 80 && km < 100, String(km));
});

check('My places: "Werk" (location or title "Naar Werk") uses its address; a real address in the location wins; unknown names are suggested', () => {
  t.setSavedPlaces([{ name: 'Werk', address: 'Industrieweg 10, 3316 AA Rivertown' }, { name: 'Northwind Labs', address: 'Industrieweg 10, Rivertown' }]);
  try {
    assert.deepStrictEqual(t.placeFor('Werk', 'Naar Werk'), { location: 'Industrieweg 10, 3316 AA Rivertown', place: 'Werk', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor('Northwind Labs', 'Naar kantoor'), { location: 'Industrieweg 10, Rivertown', place: 'Northwind Labs', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor(null, 'Naar Werk'), { location: 'Industrieweg 10, 3316 AA Rivertown', place: 'Werk', kind: 'saved' });
    assert.deepStrictEqual(t.placeFor('Acme BV', 'Naar Werk'), { location: 'Industrieweg 10, 3316 AA Rivertown', place: 'Werk', kind: 'saved' });
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
    { entity_id: 'zone.home', attributes: { friendly_name: 'Thuis', latitude: 51.37, longitude: 5.19 } },
    { entity_id: 'zone.werk', attributes: { friendly_name: 'Werk', latitude: 51.80, longitude: 4.70 } },
    { entity_id: 'zone.sportschool_springfield', attributes: { friendly_name: 'Basic-Fit', latitude: 51.36, longitude: 5.17 } },
  ]);
  try {
    const w = t.placeFor('Werk', 'Naar Werk');
    assert.strictEqual(w.kind, 'zone');
    assert.deepStrictEqual(w.point, { lat: 51.8, lon: 4.7 });
    assert.strictEqual(t.placeFor('Northwind Labs', 'Naar Werk').kind, 'zone');
    assert.strictEqual(t.placeFor('sportschool springfield', '').place, 'Basic-Fit');
    assert.strictEqual(t.zoneList().length, 2);
    const d = t.pointDistance({ lat: 51.80, lon: 4.70 }, { lat: 51.37, lon: 5.19 });
    assert.ok(d.status === 'ok' && d.how === 'estimate' && d.km > 70 && d.km < 100, JSON.stringify(d));
    assert.strictEqual(t.pointDistance({ lat: 51.3701, lon: 5.1901 }, { lat: 51.37, lon: 5.19 }).status, 'home');
    t.setSavedPlaces([{ name: 'Werk', address: 'Industrieweg 10, Rivertown' }]);
    assert.strictEqual(t.placeFor('Werk', '').kind, 'saved');
  } finally {
    t.setZones([]);
    t.setSavedPlaces([]);
  }
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

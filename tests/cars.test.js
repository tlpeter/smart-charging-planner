'use strict';

// Car integrations: with the real entity names of each integration
// (tests/fixtures.js, CARS), does the app find the car, and does it pick the
// right battery level, range, plug, charging and charge limit sensors? And
// does it read the plug sensor (on/off, or a text such as "connected")?
// Run: node tests/cars.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-cars-'));
const assert = require('assert');
const { detectVehicles, findChargeLimit } = require('../smart_charging_planner/app/vehicles');
const controller = require('../smart_charging_planner/app/controller');
const { CARS } = require('./fixtures');

let failures = 0;
function check(name, fn) {
  try {
    const note = fn();
    console.log('  ok  ', name, note ? `(${note})` : '');
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

// The registry and states Home Assistant gives for one car (and a phone, which is never a car).
function registry(car) {
  const entities = car.list.map(([entity_id, , , extra]) => ({ entity_id, device_id: 'car', platform: car.platform, ...(extra && extra.disabled ? { disabled_by: 'integration' } : {}) }));
  const states = car.list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes }));
  entities.push({ entity_id: 'sensor.pixel_8_battery_level', device_id: 'phone', platform: 'mobile_app' });
  states.push({ entity_id: 'sensor.pixel_8_battery_level', state: '80', attributes: { unit_of_measurement: '%', device_class: 'battery', friendly_name: 'Pixel 8 Battery level' } });
  return { entities, states, devices: [{ id: 'car', name: car.name, manufacturer: car.brand }, { id: 'phone', name: 'Pixel 8' }] };
}
const list = (x) => (x == null ? [] : [].concat(x));

for (const car of CARS) {
  const { entities, states, devices } = registry(car);
  check(`${car.brand}: found as a car, by its integration (${car.platform})`, () => {
    const found = detectVehicles(entities, devices, states);
    assert.strictEqual(found.length, 1, `found ${found.map((c) => c.name).join(', ')}`);
    assert.strictEqual(found[0].integration, car.platform);
    assert.strictEqual(found[0].detected_by, 'known_integration');
  });
  check(`${car.brand}: picks the battery level, range, plug, charging and charge limit`, () => {
    const s = detectVehicles(entities, devices, states)[0].suggested;
    const e = car.expect;
    const got = { soc: s.soc, range: s.range, plugged: s.plugged, charging: s.charging, limit: s.charge_limit };
    const want = { soc: e.soc, range: e.range, plugged: e.plugged, charging: e.charging, limit: e.limit };
    assert.deepStrictEqual(got, want);
    return `${s.soc} · ${s.plugged || 'no plug sensor'} · ${s.charge_limit}`;
  });
  check(`${car.brand}: entities that are off by default are not used`, () => {
    const c = detectVehicles(entities, devices, states)[0];
    const disabled = car.list.filter((x) => x[3] && x[3].disabled).map((x) => x[0]);
    const used = Object.values(c.options).flat().map((o) => o.entity_id);
    assert.deepStrictEqual(used.filter((id) => disabled.includes(id)), []);
  });
  check(`${car.brand}: the charge limit is found again for a car saved without it`, () => {
    assert.strictEqual(findChargeLimit(entities, states, 'car'), car.expect.limit);
  });
  if (car.dynamic.plug) {
    check(`${car.brand}: the plug sensor is read (plugged in and unplugged)`, () => {
      const plug = list(car.dynamic.plug)[0];
      const read = (value) => controller.readActual({
        vehicle: { plugged_entity: plug.id },
        charger: null,
        states: states.map((x) => (x.entity_id === plug.id ? { ...x, state: value } : x)),
      }).plugged;
      assert.strictEqual(read(plug.on), true, `"${plug.on}"`);
      assert.strictEqual(read(plug.off), false, `"${plug.off}"`);
      return `"${plug.on}" / "${plug.off}"`;
    });
  }
}

check('every car integration in the app has a test car, or is listed as untested here', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'vehicles.js'), 'utf8');
  const known = [...src.match(/KNOWN_VEHICLE_DOMAINS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const tested = new Set(CARS.map((c) => c.platform));
  const untested = known.filter((d) => !tested.has(d));
  return `tested: ${[...tested].join(', ')} · not tested yet: ${untested.join(', ')}`;
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll car checks passed');

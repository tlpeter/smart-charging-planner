'use strict';

// The charging stops on the Home Assistant map (#53): which sensors are
// written, only what changed, removed when no longer needed, and the safety
// checks (only the app's own map sensors; the popup only on one screen).
// A local server stands in for the Home Assistant REST API.
// Run: node tests/hamap.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-hamap-'));
process.env.DATA_DIR = DATA;
fs.writeFileSync(path.join(DATA, 'options.json'), JSON.stringify({ publish_sensors: false }));
const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');

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

async function main() {
  const rest = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { rest.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }); res.end('{}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.HA_REST_URL = `http://127.0.0.1:${server.address().port}/api`;
  const ha = require(path.join(APP, 'ha'));
  const hamap = require(path.join(APP, 'hamap'));

  // A plan with a trip that needs two stops (made-up places in the sea).
  const station = (id, name, lat, lon) => ({ id, name, operator: 'Fastned', power_kw: 300, points: 4, arrive_pct: 9, lat, lon, url: `https://map.openchargemap.io/?id=${id}` });
  const plan = (legs) => ({ next: { timeline: [
    { type: 'leave', time: 1 },
    { type: 'back', time: 2, charge_stops: { status: 'ok', dest: { lat: 55.5, lon: 3.5 }, legs } },
  ] } });
  const two = plan([
    { n: 1, km_on_trip: 200, charge_to_pct: 80, on_way_back: false, stations: [station(1, 'Stop A', 54.5, 3.1), station(2, 'Other', 54.4, 3.1)] },
    { n: 2, km_on_trip: 600, charge_to_pct: 40, on_way_back: true, stations: [station(3, 'Stop B', 54.9, 3.2)] },
  ]);
  const one = plan([{ n: 1, km_on_trip: 200, charge_to_pct: 50, on_way_back: false, stations: [station(1, 'Stop A', 54.5, 3.1)] }]);
  const writes = () => rest.filter((r) => r.method === 'POST').map((r) => r.url.split('/').pop());
  const removes = () => rest.filter((r) => r.method === 'DELETE').map((r) => r.url.split('/').pop());

  await check('the sensors of a trip: the recommended station of each stop with its position, and the destination', () => {
    const s = hamap.sensorsFor(hamap.tripOf(two));
    assert.deepEqual(s.map((x) => x.entity_id), ['sensor.smart_charging_stop_1', 'sensor.smart_charging_stop_2', 'sensor.smart_charging_trip_destination']);
    assert.equal(s[0].state, '1');
    assert.equal(s[0].attributes.latitude, 54.5);
    assert.equal(s[0].attributes.icon, 'mdi:ev-station');
    assert.match(s[0].attributes.friendly_name, /Charging stop 1: Stop A/);
    assert.equal(s[2].state, 'D');
    // No trip with stops: nothing.
    assert.deepEqual(hamap.sensorsFor(hamap.tripOf({ next: { timeline: [{ type: 'back', charge_stops: { status: 'pending', legs: [] } }] } })), []);
  });

  await check('written only when the option is on, only what changed; a stop that is gone is removed', async () => {
    rest.length = 0;
    assert.deepEqual(await hamap.sync(two, false), []);
    assert.equal(rest.length, 0, 'off: nothing written');
    await hamap.sync(two, true);
    assert.deepEqual(writes(), ['sensor.smart_charging_stop_1', 'sensor.smart_charging_stop_2', 'sensor.smart_charging_trip_destination']);
    rest.length = 0;
    await hamap.sync(two, true);
    assert.equal(rest.length, 0, 'unchanged: nothing written again');
    await hamap.sync(one, true);
    assert.deepEqual(writes(), ['sensor.smart_charging_stop_1'], 'stop 1 changed (charge to)');
    assert.deepEqual(removes(), ['sensor.smart_charging_stop_2']);
    // Switched off: everything removed, also without "Publish sensors".
    rest.length = 0;
    await hamap.sync(one, false);
    assert.deepEqual(removes().sort(), ['sensor.smart_charging_stop_1', 'sensor.smart_charging_trip_destination']);
  });

  await check('after a restart: map sensors Home Assistant still has are removed when no longer needed; after a new connection everything is written again', async () => {
    rest.length = 0;
    await hamap.sync(one, true, ['sensor.smart_charging_stop_7', 'sensor.smart_charging_status', 'sensor.other']);
    assert.ok(removes().includes('sensor.smart_charging_stop_7'), JSON.stringify(rest));
    assert.ok(!removes().includes('sensor.smart_charging_status') && !removes().includes('sensor.other'));
    hamap.forget();
    rest.length = 0;
    await hamap.sync(one, true);
    assert.deepEqual(writes(), ['sensor.smart_charging_stop_1', 'sensor.smart_charging_trip_destination']);
  });

  await check('safety: only the app\'s own map sensors, and only with the option on ("Publish sensors" is off here)', async () => {
    ha.setMapSensors(false);
    await assert.rejects(ha.setState('sensor.smart_charging_stop_1', '1', {}), /Publish sensors is off/);
    ha.setMapSensors(true);
    await assert.rejects(ha.setState('sensor.smart_charging_status', 'x', {}), /Publish sensors is off/);
    await assert.rejects(ha.setState('sensor.other_stop_1', 'x', {}), /Publish sensors is off|own sensors/);
    await assert.rejects(ha.removeState('sensor.smart_charging_status'), /map sensors/);
    await assert.rejects(ha.removeState('light.kitchen'), /map sensors/);
  });

  await check('safety: the popup only with a Browser ID (never every screen), only the map sensors and the home zone, only with the option on', async () => {
    ha.setMapSensors(true);
    await assert.rejects(ha.showMapPopup('', ['sensor.smart_charging_stop_1']), /Browser ID/);
    await assert.rejects(ha.showMapPopup('bad id!', ['sensor.smart_charging_stop_1']), /Browser ID/);
    await assert.rejects(ha.showMapPopup('abcd-1234', ['sensor.smart_charging_stop_1', 'camera.door']), /own map sensors/);
    await assert.rejects(ha.showMapPopup('abcd-1234', []), /own map sensors/);
    ha.setMapSensors(false);
    await assert.rejects(ha.showMapPopup('abcd-1234', ['sensor.smart_charging_stop_1']), /is off/);
  });

  server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

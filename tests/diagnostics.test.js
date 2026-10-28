'use strict';
const assert = require('assert/strict');
const diagnostics = require('../smart_charging_planner/app/diagnostics');
const fs = require('fs'), path = require('path'), vm = require('vm');
function check(name, fn) { try { fn(); console.log('ok -', name); } catch(e) { console.error('not ok -', name); throw e; } }
check('public diagnostics omit personal text across every exported branch', () => {
  const id = 'sensor.alex_home_battery';
  const secret = 'Alex Private House';
  const report = diagnostics.redact({
    app_version: '0.32.16', ha_version: '2026.10.3', time_zone: 'Europe/Amsterdam',
    settings: { vehicles: [{ id: 'alex_car', name: secret, calendar_name: secret, soc_entity: id }], chargers: [{ status_entity: id }],
      notify: { recipients: [{ id: 'alex_phone', name: secret, service: 'notify.mobile_app_alex_phone' }] },
      battery: { soc_entity: id, saved: { reserve: 20, original_mode: secret } }, secret_key: secret },
    entities: [{ entity_id: id, state: secret, attributes: { friendly_name: secret, options: [secret], unit_of_measurement: '%' } }],
    control_check: { recommended: { start_stop: { entity_id: id, label: secret } } },
    detected: { batteries: [{ platform: secret, soc_entity: id }] },
    plan: { share: { result: { [secret]: { amps: 6, reason: secret, code: 'shared_wait' } } }, battery: { error: secret } },
    now: { code: 'shared_wait', reason: secret, error: secret, commands: [{ service: 'script.alex_private', target: { entity_id: id }, data: { value: 6, private_name: secret } }] },
    control_log: [{ reason: secret, code: 'shared_wait', commands: [{ service: 'notify.mobile_app_alex_phone', data: { message: secret } }] }],
    app_log: [secret, 'Failed token=super-secret-token alex@example.test 51.12345, 5.12345'],
    access_token: 'super-secret-token', unknown: { [secret]: secret },
  });
  const json = JSON.stringify(report);
  for (const text of ['Alex', 'alex', 'Private', 'secret-token', '51.12345', '5.12345', 'example.test']) assert(!json.includes(text), text);
  assert.equal(report.schema_version, 2);
  assert.equal(report.settings.vehicles[0].soc_entity, report.entities[0].entity_id);
  assert.equal(report.entities[0].entity_id, report.settings.chargers[0].status_entity);
  assert.equal(report.now.code, 'shared_wait');
  assert.equal(report.app_log, undefined);
  assert.equal(report.app_log_summary.errors, 1);
  assert.equal(report.settings.battery.saved, undefined);
});
check('the route map (#47): no route line, positions or tile server in the public diagnostics; only whether a map is on', () => {
  const r = diagnostics.redact({
    settings: { charge_stops: { map_tiles: 'custom', map_tile_url: 'https://tiles.private-house.lan/{z}/{x}/{y}.png', reserve_pct: 10 } },
    plan: { next: { timeline: [{ type: 'back', charge_stops: { status: 'ok', map: { tiles: 'https://tiles.private-house.lan/{z}/{x}/{y}.png', line: 'abcSecretLine', home: { lat: 51.12345, lon: 2.54321 }, dest: { lat: 57.6789, lon: 11.9876 } },
      legs: [{ stations: [{ name: 'Private Stop', lat: 52.4321, lon: 3.1234 }] }] } }] } },
  });
  const json = JSON.stringify(r);
  for (const text of ['private-house', 'abcSecretLine', '51.12345', '2.54321', '57.6789', '11.9876', '52.4321', '3.1234', 'Private Stop']) assert(!json.includes(text), text);
  assert.equal(r.settings.charge_stops.map_tiles, 'custom');
});
check('unknown schema keys and identity maps fail closed', () => {
  const r = diagnostics.redact({ mystery: 'Private Person', settings: { arbitrary: { token: 'secret' } }, now: { reason: 'Private Person' } });
  assert.deepEqual(r.settings, {});
  assert.deepEqual(r.now, {});
  assert.equal(r.mystery, undefined);
});
check('identifier prefixes cannot retain a personal namespace', () => {
  const r = diagnostics.redact({ settings: { vehicles: [{ id: 'alex.private', soc_entity: 'sensor.alex_private' }] },
    plan: { result: { 'alex.private': { state: 'alex.private' } } } });
  assert(!JSON.stringify(r).includes('alex'));
  const id = r.settings.vehicles[0].id;
  assert.equal(r.plan.result[id].state, id);
  assert(r.settings.vehicles[0].soc_entity.startsWith('sensor.anonymous_'));
});
check('the diagnostic UI previews the same document before a separate download action', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'public', 'app.js'), 'utf8');
  const begin = src.indexOf("    $('diag-download').onclick = async () => {");
  const end = src.indexOf("    $('solar-form').addEventListener('change', syncSolar);", begin);
  assert(begin > 0 && end > begin);
  assert(src.slice(begin, end).includes('Public report preview'));
  assert(src.slice(begin, end).includes("$('diag-save').onclick"));
  // The actual event handler is exercised by the async case below.
});
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'public', 'app.js'), 'utf8');
  const begin = src.indexOf("    $('diag-download').onclick = async () => {"), end = src.indexOf("    $('solar-form').addEventListener('change', syncSolar);", begin);
  const preview = {}, elements = { 'diag-download': {}, 'diag-result': { querySelector: () => preview }, 'diag-save': {} };
  let clicks = 0, saved;
  const data = diagnostics.redact({ app_version: '0.32.16', settings: { chargers: [] }, app_log: [] });
  vm.runInNewContext(src.slice(begin, end), {
    $: (id) => elements[id], api: async () => data, esc: String, Blob,
    URL: { createObjectURL: (blob) => { saved = blob; return 'blob:test'; }, revokeObjectURL: () => {} },
    document: { createElement: () => ({ click: () => clicks++, remove: () => {} }), body: { appendChild: () => {} } },
    setTimeout: () => {}, Date,
  });
  await elements['diag-download'].onclick();
  assert.equal(clicks, 0);
  assert.equal(preview.textContent, JSON.stringify(data, null, 2));
  elements['diag-save'].onclick();
  assert.equal(clicks, 1);
  assert.equal(await saved.text(), preview.textContent);
  console.log('ok - preview and reviewed download use identical data');
})().catch((e) => { console.error(e); process.exitCode = 1; });

'use strict';

// Charger brand test: real entity and action names of the common Home
// Assistant charger integrations (taken from their source code), checked
// against detection, the control check and the status texts.
//
// Run: node tests/brands.test.js   (from the repository root)

process.env.DATA_DIR = process.env.DATA_DIR || require('os').tmpdir();
const assert = require('assert');
const { detectChargers } = require('../smart_charging_planner/app/chargers');
const { checkControl } = require('../smart_charging_planner/app/control');
const controller = require('../smart_charging_planner/app/controller');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}

const { CHARGERS } = require('./fixtures');
const BRANDS = CHARGERS.filter((c) => !c.readOnly);

for (const b of BRANDS) {
  console.log(b.brand);
  const { entities, devices, states } = b.dev;
  const found = detectChargers(entities, devices, states);
  check('detected as charger', () => assert.strictEqual(found.length, 1));
  const c = found[0];
  if (!c) continue;
  if (b.expect.status) check(`status sensor ${b.expect.status}`, () => assert.strictEqual(c.suggested.status, b.expect.status));
  if (b.expect.power) check(`power sensor ${b.expect.power}`, () => assert.strictEqual(c.suggested.power, b.expect.power));

  const r = checkControl({ charger: { device_id: 'd', integration: c.integration }, entities, states, services: b.services });
  const rec = r.recommended.start_stop;
  check(`start/stop method ${b.expect.startStop}`, () => assert.strictEqual(rec && rec.type, b.expect.startStop));
  if (b.expect.switchEntity) check(`uses ${b.expect.switchEntity}`, () => assert.strictEqual(rec.entity_id, b.expect.switchEntity));
  if (b.expect.start) check(`start = ${b.expect.start}`, () => assert.strictEqual(rec.start_value || rec.start_option, b.expect.start));
  if (b.expect.stop) check(`stop = ${b.expect.stop}`, () => assert.strictEqual(rec.stop_value || rec.stop_option, b.expect.stop));
  for (const key of ['warning', 'warning2']) {
    if (b.expect[key]) check(`warns ${b.expect[key]}`, () => assert.ok(r.warnings.some((w) => w.code === b.expect[key]), JSON.stringify(r.warnings)));
  }
  if (b.expect.noWarning) check(`no ${b.expect.noWarning}`, () => assert.ok(!r.warnings.some((w) => w.code === b.expect.noWarning), JSON.stringify(r.warnings)));

  // The start and stop commands are well formed and allowed by the guard.
  const on = controller.startStopCommand(rec, true, 'd');
  const off = controller.startStopCommand(rec, false, 'd');
  const allowed = controller.allowedFor(rec);
  check('start/stop commands allowed', () => {
    for (const cmd of [on, off]) {
      assert.ok(cmd && cmd.service, 'no command');
      const ok = allowed.some((a) => a.service === cmd.service && (!a.entity_id || (cmd.target && cmd.target.entity_id === a.entity_id)));
      assert.ok(ok, `${cmd.service} not allowed`);
    }
  });

  // Solar: charging current and switching between one and three phases.
  if ('current' in b.expect) {
    const cur = r.recommended.current;
    const got = cur ? `${cur.type}:${cur.type === 'number' ? cur.entity_id : cur.service}` : null;
    check(`solar current: ${b.expect.current || 'not possible'}`, () => assert.strictEqual(got, b.expect.current));
    if (cur) {
      const cmd = controller.currentCommand(cur, 10, 'd');
      const allowedCur = controller.allowedFor(cur);
      check('current command 10 A allowed', () => {
        assert.ok(cmd && allowedCur.some((a) => a.service === cmd.service && (!a.entity_id || cmd.target.entity_id === a.entity_id)), JSON.stringify(cmd));
        assert.ok(Object.values(cmd.data).includes(10), JSON.stringify(cmd.data));
      });
    }
  }
  if ('phase' in b.expect) {
    const ph = r.recommended.phase;
    const one = ph ? controller.phaseCommand(ph, 1, 'd') : null;
    const three = ph ? controller.phaseCommand(ph, 3, 'd') : null;
    const val = (c) => (c ? (c.data.option ?? Object.values(c.data)[0] ?? c.service.split('_').pop()) : null);
    const got = ph ? `${ph.type}:${val(one)}/${val(three)}` : null;
    check(`phase switching: ${b.expect.phase || 'not possible'}`, () => assert.strictEqual(got, b.expect.phase));
    if (ph) {
      const allowedPh = controller.allowedFor(ph);
      check('phase commands allowed', () => {
        for (const c of [one, three]) assert.ok(allowedPh.some((a) => a.service === c.service && (!a.entity_id || c.target.entity_id === a.entity_id)), JSON.stringify(c));
      });
    }
  }

  // Status texts: [plugged, charging]
  for (const [text, [plugged, charging]] of Object.entries(b.statuses)) {
    const st = states.map((s) => (s.entity_id === c.suggested.status ? { ...s, state: text, last_changed: new Date().toISOString() } : s));
    const a = controller.readActual({ vehicle: null, charger: { status_entity: c.suggested.status }, states: st });
    check(`status "${text}" → plugged ${plugged}, charging ${charging}`, () => {
      assert.strictEqual(a.plugged, plugged, `plugged ${a.plugged}`);
      if (charging !== null) assert.strictEqual(a.charging, charging, `charging ${a.charging}`);
    });
  }
}

// Tesla Wall Connector can only read.
console.log('Tesla Wall Connector');
{
  const { entities, states } = CHARGERS.find((c) => c.readOnly).dev;
  const r = checkControl({ charger: { device_id: 'd', integration: 'tesla_wall_connector' }, entities, states, services: {} });
  check('says it can only read', () => assert.ok(r.warnings.some((w) => w.code === 'read_only_integration')));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

'use strict';

// Home battery test, brand by brand: detection (level, power, capacity),
// which actions the app can do, the exact commands, and that the safety
// guard allows exactly those. Entity and option names from the integrations'
// own source code (see the notes per brand). Then the battery plan.
//
// Run: node tests/battery.test.js   (from the repository root)

process.env.DATA_DIR = process.env.DATA_DIR || require('os').tmpdir();
const assert = require('assert');
const path = require('path');
const app = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const battery = require(path.join(app, 'battery.js'));
const { planBattery } = require(path.join(app, 'batteryplan.js'));

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

const { BATTERIES: BRANDS } = require('./fixtures');

for (const b of BRANDS) {
  console.log(`${battery.BRANDS[b.platform].name} (${b.platform}) – ${b.note}`);
  const entities = b.list.map(([entity_id, , , dev]) => ({ entity_id, platform: b.platform, device_id: dev }));
  const devices = [...new Set(b.list.map((x) => x[3]))].map((id) => ({ id, name: `${battery.BRANDS[b.platform].name} ${id}` }));
  const states = b.list.map(([entity_id, state, attributes]) => ({ entity_id, state, attributes: { friendly_name: entity_id, ...attributes } }));
  const found = battery.detectBatteries(entities, devices, states);
  const c = found[0];
  check(`battery level ${b.expect.soc}`, () => assert.ok(c && c.soc_entity === b.expect.soc, JSON.stringify(found)));
  if (!c) continue;
  if (b.expect.power) check(`power ${b.expect.power}`, () => assert.strictEqual(c.power_entity, b.expect.power));
  if (b.expect.capacity) check(`capacity ${b.expect.capacity}`, () => assert.strictEqual(c.capacity_entity, b.expect.capacity));
  if (b.expect.kw != null) check(`power ${b.expect.kw} kW (positive = charging)`, () => assert.ok(Math.abs(battery.powerKw(c, states) - b.expect.kw) < 1e-9, `${battery.powerKw(c, states)}`));
  const ctl = battery.controlFor(c, entities, states);
  if (b.expect.readOnly) {
    check('read only, with the reason', () => assert.ok(!ctl.available && ctl.note, JSON.stringify(ctl)));
    continue;
  }
  check(`can: ${b.expect.actions.join(', ')}`, () => assert.deepStrictEqual([...ctl.supported].sort(), [...b.expect.actions].sort()));
  const allowed = battery.allowedFor(ctl);
  check('every command allowed by the guard, nothing else', () => {
    for (const a of ctl.supported) {
      const r = battery.commandsFor(ctl, a, 3, 75);
      assert.ok(r && r.commands.length, `no commands for ${a}`);
      for (const cmd of r.commands) {
        const ok = allowed.some((x) => x.service === cmd.service && (!x.entity_id || (cmd.target && cmd.target.entity_id === x.entity_id)));
        assert.ok(ok, `${a}: ${cmd.service} ${JSON.stringify(cmd.target)} not allowed`);
      }
    }
    assert.ok(!allowed.some((x) => x.entity_id && !states.find((s) => s.entity_id === x.entity_id)), 'guard allows unknown entities');
  });
  const fmt = (cmd) => (cmd.service.endsWith('select_option') ? `${cmd.service}:${cmd.data.option}` : cmd.service.endsWith('set_value') ? `${cmd.service}:${cmd.data.value}` : cmd.service);
  if (b.expect.charge) check(`charge: ${b.expect.charge}`, () => assert.ok(battery.commandsFor(ctl, 'charge', 3, 50).commands.map(fmt).includes(b.expect.charge)));
  if (b.expect.noDischarge) check(`no discharging: ${b.expect.noDischarge}`, () => assert.ok(battery.commandsFor(ctl, 'no_discharge', 3, 75).commands.map(fmt).includes(b.expect.noDischarge)));
  if (!ctl.supported.includes('no_discharge')) {
    check('no discharging falls back to hold (or is not possible)', () => {
      const r = battery.commandsFor(ctl, 'no_discharge', 3, 50);
      assert.ok(ctl.supported.includes('hold') ? r.action === 'hold' : r === null, JSON.stringify(r && r.action));
    });
  }
}

// ---------------------------------------------------------------------------
console.log('Battery plan');
const H = 3600000;
const day = (f) => Array.from({ length: 24 }, (_, h) => ({ start: h * H, end: (h + 1) * H, buy: 0.28, sell: 0.05, house_kw: 0.4, pv_kw: 0, ev_kw: 0, ...f(h) }));
const bat = { capacity_kwh: 10, soc_pct: 20, min_pct: 10, max_pct: 100, charge_kw: 5, discharge_kw: 5, efficiency: 0.9, wear: 0.02, actions: ['auto', 'hold', 'no_discharge', 'charge'] };
check('big spread (0.10 at night, 0.45 in the evening): charges at night, saves money', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.10 : h >= 17 && h < 22 ? 0.45 : 0.28, house_kw: h >= 17 && h < 22 ? 2 : 0.4 })), bat);
  assert.ok(r.actions.slice(0, 5).some((a) => a.action === 'charge'), r.actions.map((a) => a.action[0]).join(''));
  assert.ok(r.saving > 0.5, `saving ${r.saving}`);
});
check('small spread (0.27 vs 0.28): never charges from the grid (losses and wear)', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.27 : 0.28 })), bat);
  assert.ok(!r.actions.some((a) => a.action === 'charge'), r.actions.map((a) => a.action[0]).join(''));
});
check('grid charging off: no "charge" at all', () => {
  const r = planBattery(day((h) => ({ buy: h < 5 ? 0.10 : 0.45 })), { ...bat, actions: ['auto', 'hold', 'no_discharge'] });
  assert.ok(!r.actions.some((a) => a.action === 'charge'));
});
check('cheap morning, expensive evening: holds in the morning instead of emptying', () => {
  const r = planBattery(day((h) => ({ buy: h >= 6 && h < 12 ? 0.15 : h >= 17 && h < 22 ? 0.45 : 0.28, house_kw: 0.6 })), { ...bat, soc_pct: 80, actions: ['auto', 'hold', 'no_discharge'] });
  assert.ok(r.actions.slice(6, 12).every((a) => a.action !== 'auto'), r.actions.map((a) => a.action[0]).join(''));
});
check('car charging at night, "never": the battery does not discharge into it', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 11 : 0 })), { ...bat, soc_pct: 80, ev_discharge: 'never' });
  assert.ok(r.actions.slice(0, 4).every((a) => a.action !== 'auto' && a.discharge_kwh === 0), JSON.stringify(r.actions.slice(0, 4).map((a) => [a.action, a.discharge_kwh])));
});
check('car charging, "always": the battery may cover the car when that pays', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 11 : 0, buy: h < 4 ? 0.40 : 0.20 })), { ...bat, soc_pct: 90, ev_discharge: 'always' });
  assert.ok(r.actions.slice(0, 4).some((a) => a.discharge_kwh > 0.5), JSON.stringify(r.actions.slice(0, 4).map((a) => [a.action, a.discharge_kwh])));
});
check('car charging, "between 80 % and 40 %", battery at 90 %: covers the car, never below 40 %', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 3 : 0, buy: h < 4 ? 0.40 : 0.20 })), { ...bat, soc_pct: 90, ev_discharge: 'range', ev_from_pct: 80, ev_to_pct: 40 });
  const ev = r.actions.slice(0, 4);
  assert.ok(ev.some((a) => a.discharge_kwh > 0.5), JSON.stringify(ev.map((a) => [a.action, a.discharge_kwh])));
  assert.ok(ev.every((a) => a.soc_pct >= 40 - 1e-6), ev.map((a) => Math.round(a.soc_pct)).join(' '));
});
check('car charging, "between 80 % and 40 %", battery at 70 % (below the start level), no grid charging: no discharging into the car', () => {
  const r = planBattery(day((h) => ({ ev_kw: h < 4 ? 3 : 0, buy: h < 4 ? 0.40 : 0.20 })), { ...bat, soc_pct: 70, ev_discharge: 'range', ev_from_pct: 80, ev_to_pct: 40, actions: ['auto', 'hold', 'no_discharge'] });
  assert.ok(r.actions.slice(0, 4).every((a) => a.action !== 'auto' && a.discharge_kwh === 0), JSON.stringify(r.actions.slice(0, 4).map((a) => [a.action, a.discharge_kwh])));
});
check('"between 80 % and 40 %": at 60 % after it stopped (off), it does not start again; still on from before, it may continue to 40 %', () => {
  const blocks = day((h) => ({ ev_kw: h < 3 ? 3 : 0, buy: h < 3 ? 0.40 : 0.20 }));
  const opts = { ...bat, soc_pct: 60, ev_discharge: 'range', ev_from_pct: 80, ev_to_pct: 40, actions: ['auto', 'hold', 'no_discharge'] };
  const off = planBattery(blocks, { ...opts, ev_range_active: false });
  assert.ok(off.actions.slice(0, 3).every((a) => a.discharge_kwh === 0), JSON.stringify(off.actions.slice(0, 3).map((a) => [a.action, a.discharge_kwh])));
  const on = planBattery(blocks, { ...opts, ev_range_active: true });
  assert.ok(on.actions.slice(0, 3).some((a) => a.discharge_kwh > 0.5) && on.actions.slice(0, 3).every((a) => a.soc_pct >= 40 - 1e-6), JSON.stringify(on.actions.slice(0, 3).map((a) => [a.action, a.discharge_kwh, Math.round(a.soc_pct)])));
});
check('sun: fills from solar surplus, never above the maximum', () => {
  const r = planBattery(day((h) => ({ pv_kw: h >= 10 && h < 16 ? 4 : 0 })), { ...bat, max_pct: 90 });
  assert.ok(Math.max(...r.actions.map((a) => a.soc_pct)) <= 90.01 && r.actions[15].soc_pct > 80, r.actions.map((a) => Math.round(a.soc_pct)).join(' '));
});
check('short first block, the same price later: no needless "hold" (small discharges are not rounded up to a whole step)', () => {
  const blocks = day((h) => ({ buy: h >= 2 && h < 5 ? 0.05 : 0.20 })).slice(8);
  blocks[0] = { ...blocks[0], start: blocks[0].start + 35 * 60000 };
  const r = planBattery(blocks, { ...bat, capacity_kwh: 16, soc_pct: 50 });
  assert.strictEqual(r.actions[0].action, 'auto', r.actions.map((a) => a.action[0]).join(''));
  assert.ok(!r.actions.slice(-6).some((a) => a.action === 'hold'), r.actions.map((a) => a.action[0]).join(''));
});
check('never below the minimum', () => {
  const r = planBattery(day((h) => ({ house_kw: 2, buy: 0.5 })), { ...bat, soc_pct: 50, min_pct: 20 });
  assert.ok(Math.min(...r.actions.map((a) => a.soc_pct)) >= 19.99, r.actions.map((a) => Math.round(a.soc_pct)).join(' '));
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

'use strict';

// Preconditioning before a departure (#44): which drives get it, when, what
// is sent, one attempt and one retry, write-ahead after a restart, and the
// release of a switch when the car did not leave.
// Run: node tests/precondition.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-precondition-'));
const assert = require('assert/strict');
const p = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'precondition'));

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
const M = 60000;
const T0 = Date.UTC(2026, 10, 2, 0, 0); // a Monday, 00:00 UTC
const at = (h, m = 0) => T0 + h * H + m * M;
// A calendar trip as departures.calendarTrips gives it.
const trip = (title, h1, h2, pre = null, m1 = 0) => ({ time: at(h1, m1), event_start: at(h1, m1), event_end: h2 == null ? null : at(h2), title, precondition: pre, source: 'calendar' });
const isReturn = (t) => /^(naar huis|naar thuis|to home)/i.test(t.title || '');
const on = (extra = {}) => ({ enabled: true, entity_id: 'button.car_start_air_conditioner', minutes: 15, way_back: false, ...extra });
const kinds = (list) => list.map((m) => `${m.kind}@${new Date(m.at).toISOString().slice(11, 16)}`);

async function main() {
  await check('off: nothing is planned', () => {
    assert.deepEqual(p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: { ...on(), enabled: false }, isReturn }), []);
  });

  await check('from home: only with "precondition: yes", 15 minutes before', () => {
    assert.deepEqual(kinds(p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: on(), isReturn })), ['out@05:45']);
    assert.deepEqual(p.schedule({ trips: [trip('Werk', 6, 16, null)], cfg: on(), isReturn }), []);
    assert.deepEqual(p.schedule({ trips: [trip('Werk', 6, 16, false)], cfg: on(), isReturn }), []);
  });

  await check('a trip home in the calendar decides the way back: with yes on, without off (the setting does not count then)', () => {
    const yes = p.schedule({ trips: [trip('Werk', 6, 16, null), trip('Naar huis', 16, 17, true, 30)], cfg: on({ way_back: true }), isReturn });
    assert.deepEqual(kinds(yes), ['back@16:15']);
    const no = p.schedule({ trips: [trip('Werk', 6, 16, null), trip('Naar huis', 16, 17, null, 30)], cfg: on({ way_back: true }), isReturn });
    assert.deepEqual(no, []);
  });

  await check('no event for the drive home: the setting decides, 15 minutes before the event ends', () => {
    assert.deepEqual(kinds(p.schedule({ trips: [trip('Werk', 6, 16, null)], cfg: on({ way_back: true }), isReturn })), ['back_auto@15:45']);
    assert.deepEqual(p.schedule({ trips: [trip('Werk', 6, 16, null)], cfg: on({ way_back: false }), isReturn }), []);
    // No end time known: no moment for the way back.
    assert.deepEqual(p.schedule({ trips: [trip('Werk', 6, null, null)], cfg: on({ way_back: true }), isReturn }), []);
  });

  await check('more places in a row: the next event decides each drive; the setting only for the last drive home', () => {
    const trips = [trip('Werk', 6, 16, true), trip('Sport', 16, 20, true), trip('Zwemmen', 20, 21, null)];
    // 06:00 out (yes), 16:00 next (yes), 20:00 next (no), way back after Zwemmen (setting on).
    assert.deepEqual(kinds(p.schedule({ trips, cfg: on({ way_back: true }), isReturn })), ['out@05:45', 'next@15:45', 'back_auto@20:45']);
  });

  await check('a later trip from home the next day is not a "next event": the car is home in between', () => {
    const trips = [trip('Werk', 6, 16, null), trip('Werk', 30, 40, null)];
    assert.deepEqual(kinds(p.schedule({ trips, cfg: on({ way_back: true }), isReturn })), ['back_auto@15:45', 'back_auto@15:45']);
  });

  await check('weekly schedule, helper and one-off (#45): only a departure with its tick, 15 minutes before; no way back; nothing when off', () => {
    const deps = [
      { time: at(7), source: 'schedule', precondition: true },
      { time: at(31), source: 'schedule', precondition: false },
      { time: at(9), source: 'helper', precondition: true },
      { time: at(12), source: 'override', precondition: true },
      { time: at(8), source: 'calendar', precondition: true }, // the calendar rules handle these
    ];
    assert.deepEqual(p.fromDepartures({ departures: deps, cfg: on({ way_back: true }) }).map((m) => `${m.source}@${new Date(m.at).toISOString().slice(11, 16)}`), ['schedule@06:45', 'helper@08:45', 'override@11:45']);
    assert.ok(p.fromDepartures({ departures: deps, cfg: on() }).every((m) => m.kind === 'out' && m.until - m.at === 15 * M));
    assert.deepEqual(p.fromDepartures({ departures: deps, cfg: { ...on(), enabled: false } }), []);
  });

  await check('settings check: 5–60 minutes, only a switch or button, an entity when on', () => {
    assert.deepEqual(p.clean({ enabled: true, entity_id: 'button.car_start_air_conditioner', minutes: '20', way_back: true }), { enabled: true, entity_id: 'button.car_start_air_conditioner', minutes: 20, way_back: true });
    assert.equal(p.clean({}).minutes, 15);
    assert.throws(() => p.clean({ minutes: 2 }), /between 5 and 60/);
    assert.throws(() => p.clean({ enabled: true }), /Choose what/);
    for (const bad of ['input_boolean.voorverwarmen', 'script.preheat', 'climate.car_hvac', 'automation.x']) {
      assert.throws(() => p.clean({ enabled: true, entity_id: bad }), /switch or a button/, bad);
    }
  });

  const car = (cfg = on()) => ({ id: 'car1', name: 'Car', plugged_entity: 'binary_sensor.car_plug', precondition: cfg });
  const run = async (now, { live = true, sendFn = async () => {}, plugged = () => true, vehicles = [car()] } = {}) => {
    const sent = [];
    const done = await p.step({ vehicles, now, live, send: async (c) => { sent.push(`${c.service} ${c.target.entity_id}`); return sendFn(c); }, plugged, log: () => {} });
    return { done, sent };
  };

  await check('the moment comes: the button is pressed once, not again the next minute; nothing before or after the window', async () => {
    p.reset();
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: on(), isReturn }));
    assert.deepEqual((await run(at(5, 44))).sent, []);
    assert.deepEqual((await run(at(5, 45))).sent, ['button.press button.car_start_air_conditioner']);
    assert.deepEqual((await run(at(5, 46))).sent, []);
    assert.equal(p.active('car1', at(5, 50)), true);
    assert.equal(p.active('car1', at(7, 0)), false);
    assert.deepEqual((await run(at(6, 1))).sent, []); // after the departure: no release for a button
  });

  await check('"Allow control" off: nothing is sent, the plan shows it as advice', async () => {
    p.reset();
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: on(), isReturn }));
    const r = await run(at(5, 50), { live: false });
    assert.deepEqual(r.sent, []);
    assert.equal(p.upcoming('car1', at(5, 50))[0].state, 'would');
    assert.equal(p.active('car1', at(5, 50)), false);
  });

  await check('a failed command is tried once more, then not again', async () => {
    p.reset();
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: on(), isReturn }));
    const fail = async () => { throw new Error('car offline'); };
    assert.equal((await run(at(5, 45), { sendFn: fail })).sent.length, 1);
    assert.equal((await run(at(5, 46), { sendFn: fail })).sent.length, 1);
    assert.equal((await run(at(5, 47), { sendFn: fail })).sent.length, 0);
    assert.equal(p.upcoming('car1', at(5, 47))[0].state, 'failed');
  });

  await check('restart while asking: not sent again (a second press could switch it off)', async () => {
    p.reset();
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: on(), isReturn }));
    // The command is on its way when the app stops: the record says "asking".
    const pending = run(at(5, 45), { sendFn: () => new Promise(() => {}) });
    await new Promise((r) => setTimeout(r, 20));
    const file = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'precondition.json'), 'utf8'));
    assert.equal(Object.values(file.records)[0].state, 'asking');
    p.reset();
    // A new start reads the file again.
    delete require.cache[require.resolve(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'precondition'))];
    const p2 = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'precondition'));
    p2.recover();
    const sent = [];
    await p2.step({ vehicles: [car()], now: at(5, 46), live: true, send: async (c) => { sent.push(c.service); }, plugged: () => true });
    assert.deepEqual(sent, []);
    void pending;
  });

  await check('a switch is turned off again only when the car did not leave (still plugged in, from home)', async () => {
    p.reset();
    const sw = on({ entity_id: 'switch.car_climate' });
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: sw, isReturn }));
    assert.deepEqual((await run(at(5, 45), { vehicles: [car(sw)] })).sent, ['switch.turn_on switch.car_climate']);
    assert.deepEqual((await run(at(6, 10), { vehicles: [car(sw)] })).sent, []); // not yet: 15 min after departure
    assert.deepEqual((await run(at(6, 15), { vehicles: [car(sw)] })).sent, ['switch.turn_off switch.car_climate']);
    assert.deepEqual((await run(at(6, 16), { vehicles: [car(sw)] })).sent, []);
    // The car left (unplugged): left alone.
    p.reset();
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, true)], cfg: sw, isReturn }));
    await run(at(5, 45), { vehicles: [car(sw)] });
    assert.deepEqual((await run(at(6, 20), { vehicles: [car(sw)], plugged: () => false })).sent, []);
    // On the way back: never turned off (the car is driving).
    p.reset();
    const back = { ...sw, way_back: true };
    p.setSchedule('car1', p.schedule({ trips: [trip('Werk', 6, 16, null)], cfg: back, isReturn }));
    assert.deepEqual((await run(at(15, 45), { vehicles: [car(back)] })).sent, ['switch.turn_on switch.car_climate']);
    assert.deepEqual((await run(at(16, 30), { vehicles: [car(back)] })).sent, []);
  });

  console.log(failures ? `\n${failures} failed` : '\nAll preconditioning checks passed');
  process.exit(failures ? 1 : 0);
}

main();

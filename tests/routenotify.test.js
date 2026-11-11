'use strict';

// "Send the route to my phone before a trip" (#66): which trips get a message
// (a location, not a trip home), when, the Google Maps link, once per trip
// (also after a restart), one retry when it failed, nothing afterwards when
// the moment was missed.
// Run: node tests/routenotify.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-route-'));
const assert = require('assert/strict');
const MOD = path.join(__dirname, '..', 'smart_charging_planner', 'app', 'routenotify');
let r = require(MOD);

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

const M = 60000;
const H = 60 * M;
const T0 = Date.UTC(2030, 0, 7, 7, 30); // a departure
const trip = (o) => ({ time: T0, event_start: T0, title: 'To Rivertown', location: 'Market 1, 1234 AB Rivertown', car_id: null, ...o });
const isReturn = (t) => /^to home/i.test(t.title || '');

(async () => {
  await check('the Google Maps link: the location encoded, by car', () => {
    assert.equal(r.mapsUrl(' Market 1, 1234 AB Rivertown '), 'https://www.google.com/maps/dir/?api=1&destination=Market%201%2C%201234%20AB%20Rivertown&travelmode=driving');
    assert.equal(r.mapsUrl('Café & Co'), 'https://www.google.com/maps/dir/?api=1&destination=Caf%C3%A9%20%26%20Co&travelmode=driving');
  });

  await check('which trips: with a location only, not a trip home, one message for a trip of every car', () => {
    const list = r.schedule({
      trips: [
        trip(),
        trip({ car_id: 'car2' }), // the same trip, seen by a second car
        trip({ time: T0 + 2 * H, event_start: T0 + 2 * H, title: 'To Sport', location: '' }),
        trip({ time: T0 + 9 * H, event_start: T0 + 9 * H, title: 'To home', location: 'Home' }),
      ],
      minutes: 30,
      isReturn,
    });
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.equal(list[0].at, T0 - 30 * M);
    assert.equal(list[0].until, T0);
    assert.equal(list[0].url, r.mapsUrl('Market 1, 1234 AB Rivertown'));
  });

  await check('sent once in the window, not before, not again', async () => {
    r.setSchedule(r.schedule({ trips: [trip()], minutes: 30, isReturn }));
    const sent = [];
    const send = async (m) => { sent.push(m); return { sent: true }; };
    await r.step({ now: T0 - 31 * M, send });
    assert.equal(sent.length, 0, 'sent too early');
    await r.step({ now: T0 - 30 * M, send });
    await r.step({ now: T0 - 29 * M, send });
    assert.equal(sent.length, 1, `sent ${sent.length} times`);
    assert.equal(r.upcoming(T0 - 20 * M)[0].sent, true);
  });

  await check('after a restart: not sent again', async () => {
    delete require.cache[require.resolve(MOD)];
    r = require(MOD);
    r.setSchedule(r.schedule({ trips: [trip()], minutes: 30, isReturn }));
    let n = 0;
    await r.step({ now: T0 - 10 * M, send: async () => { n++; return { sent: true }; } });
    assert.equal(n, 0);
  });

  await check('a failed message is tried once more, then left', async () => {
    const t = trip({ time: T0 + 24 * H, event_start: T0 + 24 * H });
    r.setSchedule(r.schedule({ trips: [t], minutes: 30, isReturn }));
    let n = 0;
    const send = async () => { n++; throw new Error('phone not reachable'); };
    for (let i = 0; i < 4; i++) await r.step({ now: t.time - (20 - i) * M, send });
    assert.equal(n, r.MAX_TRIES);
  });

  await check('no recipient wants it: done, not tried again', async () => {
    const t = trip({ time: T0 + 48 * H, event_start: T0 + 48 * H });
    r.setSchedule(r.schedule({ trips: [t], minutes: 30, isReturn }));
    let n = 0;
    const send = async () => { n++; return { sent: false, reason: 'no_recipient' }; };
    await r.step({ now: t.time - 20 * M, send });
    await r.step({ now: t.time - 19 * M, send });
    assert.equal(n, 1);
  });

  await check('the moment was missed (the app was off): nothing after the departure', async () => {
    const t = trip({ time: T0 + 72 * H, event_start: T0 + 72 * H });
    r.setSchedule(r.schedule({ trips: [t], minutes: 30, isReturn }));
    let n = 0;
    await r.step({ now: t.time + M, send: async () => { n++; return { sent: true }; } });
    assert.equal(n, 0);
  });

  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll route checks passed');
})();

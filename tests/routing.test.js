'use strict';

// Trip distances and privacy (#31): what is sent where for each choice.
// A local server stands in for Nominatim and OSRM and records every request.
// Run: node tests/routing.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-routing-'));
process.env.DATA_DIR = DATA;
process.env.SCP_GEOCODE_GAP_MS = '5';
const assert = require('assert/strict');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Two fake servers: "public" (the default addresses) and "own" (custom).
  const hits = { public: [], own: [] };
  const serve = (who) => http.createServer((req, res) => {
    hits[who].push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/search')) {
      // An address abroad (#49) is only found without the country limit.
      const u = new URL(req.url, 'http://x');
      const abroad = /Exempelgatan|Göteborg/.test(u.searchParams.get('q') || '');
      if (abroad) res.end(JSON.stringify(u.searchParams.get('countrycodes') ? [] : [{ lat: '57.70', lon: '11.97' }]));
      else res.end(JSON.stringify([{ lat: '51.60', lon: '5.30' }]));
    }
    else res.end(JSON.stringify({ routes: [{ distance: 42000 }] }));
  });
  const pub = serve('public');
  const own = serve('own');
  await new Promise((r) => pub.listen(0, '127.0.0.1', r));
  await new Promise((r) => own.listen(0, '127.0.0.1', r));
  process.env.SCP_GEOCODE_URL = `http://127.0.0.1:${pub.address().port}/search`;
  process.env.SCP_ROUTE_URL = `http://127.0.0.1:${pub.address().port}/route/v1/driving`;
  const OWN = `http://127.0.0.1:${own.address().port}`;

  const ha = require(path.join(APP, 'ha'));
  ha.state.home = { lat: 51.5, lon: 5.2 };
  const t = require(path.join(APP, 'tripcost'));
  let routing = { mode: null };
  t.setRouting(() => routing);
  const vehicle = { id: 'car', capacity_kwh: 50 };
  const cost = (location, title = null) => t.tripCost({ location, title, vehicle, states: [], soc: 80 });
  const settle = async () => { for (let i = 0; i < 200 && !t.idle(); i++) await sleep(5); await sleep(10); };
  const reset = () => { t.reset(); hits.public.length = 0; hits.own.length = 0; };

  await check('not chosen yet: nothing is sent, the trip says to choose', async () => {
    reset();
    routing = { mode: null };
    const r = cost('Markt 1, 5211 Dorp');
    await settle();
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'routing_not_chosen');
    assert.equal(hits.public.length + hits.own.length, 0);
  });

  await check('off: nothing is sent and no distance, not even for a zone', async () => {
    reset();
    routing = { mode: 'off' };
    t.setZones([{ entity_id: 'zone.werk', attributes: { friendly_name: 'Werk', latitude: 51.6, longitude: 5.3 } }]);
    assert.equal(cost('Markt 1, 5211 Dorp').reason, 'routing_off');
    assert.equal(cost('Werk').reason, 'routing_off');
    await settle();
    assert.equal(hits.public.length + hits.own.length, 0);
    t.setZones([]);
  });

  await check('offline: a zone gives the straight line × 1.3, nothing is sent', async () => {
    reset();
    routing = { mode: 'offline' };
    t.setZones([{ entity_id: 'zone.werk', attributes: { friendly_name: 'Werk', latitude: 51.6, longitude: 5.3 } }]);
    const r = cost('Werk');
    await settle();
    assert.equal(r.status, 'ok');
    assert.equal(r.how, 'estimate');
    const straight = t.haversineKm(ha.state.home, { lat: 51.6, lon: 5.3 });
    assert.ok(Math.abs(r.km - Math.round(straight * 1.3 * 10) / 10) < 0.05);
    assert.equal(hits.public.length + hits.own.length, 0);
    t.setZones([]);
  });

  await check('offline: an address is not looked up; a distance in My places is used', async () => {
    reset();
    routing = { mode: 'offline' };
    const r = cost('Markt 1, 5211 Dorp');
    assert.equal(r.reason, 'offline');
    t.setSavedPlaces([{ name: 'Gym', address: '', km: 12.5 }]);
    const g = cost(null, 'To Gym');
    await settle();
    assert.equal(g.status, 'ok');
    assert.equal(g.km, 12.5);
    assert.equal(g.how, 'manual');
    assert.equal(hits.public.length + hits.own.length, 0);
    t.setSavedPlaces([]);
  });

  await check('OpenStreetMap: the address goes to the address search, the coordinates to the router', async () => {
    reset();
    routing = { mode: 'osm' };
    assert.equal(cost('Markt 1, 5211 Dorp').status, 'pending');
    await settle();
    cost('Markt 1, 5211 Dorp');
    await settle();
    const r = cost('Markt 1, 5211 Dorp');
    assert.equal(r.status, 'ok');
    assert.equal(r.km, 42);
    assert.ok(hits.public.some((u) => u.startsWith('/search') && u.includes('Markt')), 'address search was asked');
    assert.ok(hits.public.some((u) => u.startsWith('/route/') && u.includes('5.2,51.5')), 'router got home coordinates');
    assert.equal(hits.own.length, 0);
  });

  await check('an address abroad (#49): first in the home country, then without the country limit; an address at home is asked once', async () => {
    reset();
    routing = { mode: 'osm' };
    const before = ha.state.country;
    ha.state.country = 'NL';
    try {
      // At home: found in the home country, one request, with the limit.
      cost('Markt 1, 5211 Dorp');
      await settle();
      const home = hits.public.filter((u) => u.startsWith('/search'));
      assert.equal(home.length, 1, JSON.stringify(home));
      assert.ok(home[0].includes('countrycodes=nl'), home[0]);
      // Abroad: every try in the Netherlands finds nothing, then anywhere finds it.
      hits.public.length = 0;
      const where = 'Exempelgatan 7, 411 01 Göteborg, Zweden';
      assert.equal(cost(where).status, 'pending');
      await settle();
      const search = hits.public.filter((u) => u.startsWith('/search'));
      const limited = search.filter((u) => u.includes('countrycodes=nl'));
      const free = search.filter((u) => !u.includes('countrycodes'));
      assert.ok(limited.length >= 1 && free.length === 1, JSON.stringify(search));
      assert.ok(search.indexOf(free[0]) > search.indexOf(limited[limited.length - 1]), 'the home country is asked first');
      assert.ok(decodeURIComponent(free[0].replace(/\+/g, ' ')).includes('Exempelgatan 7'), free[0]);
      cost(where);
      await settle();
      const r = cost(where);
      assert.equal(r.status, 'ok', JSON.stringify(r));
      assert.equal(r.km, 42);
    } finally {
      ha.state.country = before;
    }
  });

  await check('own servers: everything goes to your servers, nothing to the public ones', async () => {
    reset();
    routing = { mode: 'custom', geocode_url: `${OWN}/search`, route_url: `${OWN}/route/v1/driving` };
    cost('Markt 1, 5211 Dorp');
    await settle();
    cost('Markt 1, 5211 Dorp');
    await settle();
    assert.equal(cost('Markt 1, 5211 Dorp').km, 42);
    assert.equal(hits.public.length, 0);
    assert.ok(hits.own.length >= 2);
  });

  await check('a place looked up before keeps its distance offline, without asking again', async () => {
    // The cache from the previous check (own servers) is still there.
    hits.public.length = 0; hits.own.length = 0;
    routing = { mode: 'offline' };
    const r = cost('Markt 1, 5211 Dorp');
    await settle();
    assert.equal(r.status, 'ok');
    assert.equal(r.km, 42);
    assert.equal(hits.public.length + hits.own.length, 0);
  });

  await check('a lookup that was waiting is dropped when you switch to offline', async () => {
    reset();
    routing = { mode: 'osm' };
    cost('Kerkstraat 9, 1234 Ergens'); // starts right away
    cost('Dorpsweg 3, 4321 Elders'); // waits in line
    routing = { mode: 'offline' };
    await settle();
    assert.equal(hits.public.filter((u) => u.includes('Dorpsweg')).length, 0, 'the waiting lookup was sent');
    assert.ok(hits.public.length <= 1);
  });

  pub.close();
  own.close();

  // Settings: an existing install keeps OpenStreetMap (unconfirmed); a new one has not chosen.
  const migrate = (dir) => spawnSync(process.execPath, ['-e', "const s=require('./settings').load(); process.stdout.write(JSON.stringify(s.routing))"], {
    cwd: APP, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8',
  });
  await check('settings from before the choice keep OpenStreetMap, but unconfirmed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-routing-old-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ vehicles: [], places: [] }));
    const r = migrate(dir);
    assert.deepEqual(JSON.parse(r.stdout), { mode: 'osm', geocode_url: null, route_url: null, confirmed: false });
  });
  await check('a new install has not chosen: nothing is looked up', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-routing-new-'));
    const r = migrate(dir);
    assert.equal(JSON.parse(r.stdout).mode, null);
  });

  const { validateImportSettings } = require(path.join(APP, 'importschema'));
  await check('an imported settings file can only hold a known choice and http(s) addresses', async () => {
    validateImportSettings({ routing: { mode: 'custom', geocode_url: 'https://geo.lan/search', route_url: 'http://osrm.lan/route/v1/driving' } });
    assert.throws(() => validateImportSettings({ routing: { mode: 'everything' } }));
    assert.throws(() => validateImportSettings({ routing: { mode: 'custom', geocode_url: 'file:///etc/passwd', route_url: 'https://x/route' } }));
    assert.throws(() => validateImportSettings({ routing: { mode: 'custom', geocode_url: 'https://user:pw@geo.lan/search', route_url: 'https://x/route' } }));
    assert.throws(() => validateImportSettings({ routing: { mode: 'custom' } }));
  });

  console.log(failures ? `\n${failures} failed` : '\nAll routing checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

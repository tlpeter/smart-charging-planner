'use strict';

// Charging stops on the way (#37): the route line, which stations count, the
// settings check, and what is sent to Open Charge Map.
// A local server stands in for OSRM and Open Charge Map and records every request.
// Run: node tests/chargestops.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-chargestops-'));
process.env.DATA_DIR = DATA;
process.env.SCP_OCM_GAP_MS = '5';
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
  const hits = [];
  let ocmStatus = 0;
  let stations = [];
  let line = '';
  let extra = {};
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), key: req.headers['x-api-key'] || null });
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname.startsWith('/route/')) {
      // Via a station (start;station;end): 100 km plus that station's detour
      // by road (extra, by its latitude; default 0.2 km).
      const pts = u.pathname.split('/').pop().split(';');
      const mid = pts.length === 3 ? Number(pts[1].split(',')[1]).toFixed(4) : null;
      const km = 100 + (mid ? extra[mid] ?? 0.2 : 0);
      return res.end(JSON.stringify({ routes: [{ distance: km * 1000, ...(mid ? {} : { geometry: line }) }] }));
    }
    if (ocmStatus) { res.statusCode = ocmStatus; return res.end('{}'); }
    return res.end(JSON.stringify(stations));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.SCP_ROUTE_URL = `${base}/route/v1/driving`;
  process.env.SCP_OCM_URL = `${base}/ocm/poi`;

  const t = require(path.join(APP, 'tripcost'));
  const cs = require(path.join(APP, 'chargestops'));
  let routing = { mode: 'osm' };
  t.setRouting(() => routing);
  let cfg = {};
  cs.setConfig(() => cfg);
  const settle = async () => { for (let i = 0; i < 200 && !cs.idle(); i++) await sleep(5); await sleep(10); };

  // A route of ~100 km straight north from home.
  const home = { lat: 51.0, lon: 5.0 };
  const dest = { lat: 51.9, lon: 5.0 };
  const pts = [];
  for (let k = 0; k <= 90; k++) pts.push({ lat: 51.0 + k * 0.01, lon: 5.0 });
  line = cs.encodePolyline(pts);
  const poi = (id, op, lat, lon, conns, extra = {}) => ({ ID: id, OperatorInfo: { Title: op }, UsageType: { Title: 'Public - Membership Required' }, StatusType: { IsOperational: true },
    AddressInfo: { Title: `S${id}`, Town: 'T', Latitude: lat, Longitude: lon, Country: { ISOCode: 'NL' } }, Connections: conns, ...extra });
  const ccs = (kw) => ({ ConnectionTypeID: 33, ConnectionType: { Title: 'CCS (Type 2)' }, PowerKW: kw, Quantity: 4 });
  const input = { home, dest, socLeave: 50, socEnd: -20, pctPerKm: 0.4, capacityKwh: 60 };

  await check('polyline: encode and decode give the same points (5 decimals)', () => {
    const p = [{ lat: 51.12345, lon: 4.98765 }, { lat: 51.2, lon: -0.5 }, { lat: -33.9, lon: 151.2 }];
    const back = cs.decodePolyline(cs.encodePolyline(p));
    assert.deepEqual(back, p);
    // The example from Google's documentation.
    assert.deepEqual(cs.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [{ lat: 38.5, lon: -120.2 }, { lat: 40.7, lon: -120.95 }, { lat: 43.252, lon: -126.453 }]);
  });

  await check('a long route line is thinned to at most 250 points, start and end kept', () => {
    const many = [];
    for (let k = 0; k < 2000; k++) many.push({ lat: 50 + k * 0.001, lon: 5 });
    const thin = cs.thin(many);
    assert.ok(thin.length <= 250 && thin.length > 100, String(thin.length));
    assert.deepEqual(thin[0], many[0]);
    assert.deepEqual(thin[thin.length - 1], many[many.length - 1]);
  });

  await check('where a station is: km along the route and km off it', () => {
    const r = cs.onRoute(pts, { lat: 51.45, lon: 5.0143 }); // ~1 km east of the route, halfway
    assert.ok(Math.abs(r.along - 50) < 1, `along ${r.along}`);
    assert.ok(Math.abs(r.off - 1) < 0.05, `off ${r.off}`);
    assert.ok(Math.abs(r.total - 100) < 1, `total ${r.total}`);
  });

  await check('operators: Open Charge Map names are matched (Allego BV, Tesla Motors, IONITY GmbH, Shell Recharge Solutions)', () => {
    assert.equal(cs.operatorOf('Allego BV'), 'allego');
    assert.equal(cs.operatorOf('Tesla Motors (Worldwide)'), 'tesla');
    assert.equal(cs.operatorOf('IONITY GmbH'), 'ionity');
    assert.equal(cs.operatorOf('Shell Recharge Solutions'), 'shell');
    assert.equal(cs.operatorOf('Vattenfall InCharge'), 'vattenfall');
    assert.equal(cs.operatorOf('Unknown Operator'), null);
    assert.equal(cs.operatorOf(null), null);
    // Every operator is in a supported country, and ids are unique.
    assert.equal(new Set(cs.OPERATORS.map((o) => o.id)).size, cs.OPERATORS.length);
    assert.ok(cs.OPERATORS.every((o) => o.countries.every((c) => cs.COUNTRIES[c])));
  });

  await check('connectors: CCS is not counted as Type 2, CHAdeMO by id', () => {
    assert.equal(cs.connectorOf({ ConnectionTypeID: 33, ConnectionType: { Title: 'CCS (Type 2)' } }), 'ccs');
    assert.equal(cs.connectorOf({ ConnectionType: { Title: 'CCS (Type 2)' } }), 'ccs');
    assert.equal(cs.connectorOf({ ConnectionTypeID: 25, ConnectionType: { Title: 'Type 2 (Socket Only)' } }), 'type2');
    assert.equal(cs.connectorOf({ ConnectionTypeID: 2 }), 'chademo');
    assert.equal(cs.connectorOf({ ConnectionTypeID: 1, ConnectionType: { Title: 'Type 1 (J1772)' } }), null);
  });

  await check('stations that are not used: out of order, private, no known connector, no position', () => {
    assert.equal(cs.shortStation(poi(1, 'X', 51, 5, [ccs(50)], { StatusType: { IsOperational: false } })), null);
    assert.equal(cs.shortStation(poi(2, 'X', 51, 5, [ccs(50)], { UsageType: { Title: 'Private - Restricted Access' } })), null);
    assert.equal(cs.shortStation(poi(3, 'X', 51, 5, [{ ConnectionTypeID: 1 }])), null);
    assert.equal(cs.shortStation(poi(4, 'X', null, null, [ccs(50)])), null);
    const ok = cs.shortStation(poi(5, 'Fastned', 51, 5, [ccs(300), ccs(50), { ConnectionTypeID: 33, PowerKW: 150, Quantity: 2, StatusType: { IsOperational: false } }]));
    assert.deepEqual(ok.connectors, { ccs: { kw: 300, count: 8 } });
    assert.equal(ok.operator_id, 'fastned');
  });

  await check('settings check: a key is needed when on, is kept when the page sends none, and has a safe form', () => {
    assert.throws(() => cs.clean({ enabled: true, countries: ['NL'], connectors: ['ccs'] }, {}), /API key/);
    const kept = cs.clean({ enabled: true, api_key: '', countries: ['NL'], connectors: ['ccs'] }, { api_key: 'abc-12345' });
    assert.equal(kept.api_key, 'abc-12345');
    assert.equal(cs.clean({ enabled: false, clear_key: true, countries: ['NL'], connectors: ['ccs'] }, { api_key: 'abc-12345' }).api_key, '');
    assert.throws(() => cs.clean({ api_key: 'abc 123 ?&x=1', countries: ['NL'], connectors: ['ccs'] }, {}), /letters/);
    assert.throws(() => cs.clean({ countries: ['FR'], connectors: ['ccs'] }, {}), /country/);
    assert.throws(() => cs.clean({ countries: ['NL'], connectors: [] }, {}), /connector/);
    assert.throws(() => cs.clean({ countries: ['NL'], connectors: ['ccs'], max_detour_km: 0 }, {}), /between/);
    const c = cs.clean({ countries: ['NL', 'BE', 'NL'], operators: ['fastned', 'nope'], connectors: ['ccs', 'type2'], min_power_kw: '22,5' }, {});
    assert.deepEqual(c.countries, ['NL', 'BE']);
    assert.deepEqual(c.operators, ['fastned']);
    assert.equal(c.min_power_kw, 22.5);
    // The page never gets the key back.
    cfg = { enabled: true, api_key: 'abc-12345' };
    assert.ok(!JSON.stringify(cs.view()).includes('abc-12345'));
    assert.equal(cs.view().has_key, true);
  });

  await check('off, or the trip has enough: no suggestion and nothing sent', async () => {
    cs.reset();
    hits.length = 0;
    cfg = { enabled: false, api_key: 'abc-12345' };
    assert.equal(cs.suggest(input), null);
    cfg = { enabled: true, api_key: 'abc-12345', reserve_pct: 10 };
    assert.equal(cs.suggest({ ...input, socEnd: 12 }), null);
    await settle();
    assert.equal(hits.length, 0);
  });

  await check('offline trip distances or no key: nothing is sent, the trip says why', async () => {
    cs.reset();
    hits.length = 0;
    routing = { mode: 'offline' };
    cfg = { enabled: true, api_key: 'abc-12345' };
    assert.equal(cs.suggest(input).status, 'needs_routing');
    routing = { mode: 'osm' };
    cfg = { enabled: true, api_key: '' };
    assert.equal(cs.suggest(input).status, 'no_key');
    cfg = { enabled: true, api_key: 'abc-12345' };
    assert.equal(cs.suggest({ ...input, dest: null }).status, 'no_position');
    await settle();
    assert.equal(hits.length, 0);
  });

  await check('the route and then the stations: the key goes in a header, the route as a line; only reachable stations', async () => {
    cs.reset();
    hits.length = 0;
    cfg = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10 };
    stations = [
      poi(1, 'Fastned', 51.2, 5.0, [ccs(300)]), // 22 km
      poi(2, 'Allego BV', 51.6, 5.01, [ccs(150)]), // 67 km, 0.7 km off the route
      poi(3, 'IONITY GmbH', 51.85, 5.0, [ccs(350)]), // 94 km: beyond the reach (~91 km)
      poi(4, 'Tesla Motors', 51.3, 5.05, [ccs(250)]), // 3.5 km off: detour 7 km > 4
    ];
    assert.equal(cs.suggest(input).status, 'pending');
    await settle();
    assert.equal(cs.suggest(input).status, 'pending'); // the route is known, the stations are being looked up
    await settle();
    assert.equal(cs.suggest(input).status, 'pending'); // the real detours by road are being looked up
    await settle();
    const r = cs.suggest(input);
    assert.equal(r.status, 'ok', JSON.stringify(r));
    // 50 % - 10 % reserve = 40 %, at 0.4 × 1.1 %/km: ~91 km reach.
    assert.equal(r.reach_km, 91);
    assert.equal(r.need_pct, 30);
    assert.equal(r.need_kwh, 18);
    assert.deepEqual(r.stops.map((x) => x.id), [1, 2]);
    const ocm = hits.find((h) => h.path === '/ocm/poi');
    assert.equal(ocm.key, 'abc-12345');
    assert.ok(!('key' in ocm.params) && ocm.params.polyline && ocm.params.distance === '2' && ocm.params.distanceunit === 'km');
    const route = hits.find((h) => h.path.startsWith('/route/'));
    assert.equal(route.params.geometries, 'polyline');
    // Less battery: the far station drops out.
    assert.deepEqual(cs.suggest({ ...input, socLeave: 30 }).stops.map((x) => x.id), [1]);
    // Remembered: no new requests.
    const n = hits.length;
    cs.suggest(input);
    await settle();
    assert.equal(hits.length, n);
  });

  await check('the other side of the motorway (#41): its real detour by road counts; shown only when nothing else fits, marked as a longer detour', async () => {
    cs.reset();
    cfg = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10 };
    // Both right next to the route line; station 10 is for the other direction.
    extra = { '51.4000': 15, '51.4500': 0.3 };
    stations = [poi(10, 'Fastned', 51.4, 5.0005, [ccs(300)]), poi(11, 'Allego BV', 51.45, 5.0005, [ccs(150)])];
    const run = async () => { for (let i = 0; i < 4; i++) { cs.suggest(input); await settle(); } return cs.suggest(input); };
    let r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.deepEqual(r.stops.map((x) => [x.id, x.detour_km]), [[11, 0.3]]);
    assert.ok(!r.longer_only && !r.stops[0].longer_detour);
    // Only the other side: shown, with its real detour, marked.
    cs.reset();
    stations = [poi(10, 'Fastned', 51.4, 5.0005, [ccs(300)])];
    r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.ok(r.longer_only && r.stops[0].longer_detour && r.stops[0].detour_km === 15, JSON.stringify(r.stops));
    // Too far even for that: none.
    cs.reset();
    extra = { '51.4000': 40 };
    r = await run();
    assert.equal(r.status, 'none', JSON.stringify(r));
    extra = {};
  });

  await check('enough to get there, short on the way back (#41): the stop is on the way back, its detour asked from the destination', async () => {
    cs.reset();
    hits.length = 0;
    cfg = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10 };
    stations = [poi(12, 'Fastned', 51.2, 5.0005, [ccs(300)])];
    const there = { ...input, socLeave: 95, socEnd: -0.5 }; // 95 % - 44 % = 51 % at the destination
    for (let i = 0; i < 4; i++) { cs.suggest(there); await settle(); }
    const r = cs.suggest(there);
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.ok(r.on_way_back, JSON.stringify(r));
    const via = hits.find((h) => h.path.split(';').length === 3);
    assert.ok(via && via.path.split('/').pop().startsWith('5,51.9;'), via && via.path);
  });

  await check('a key Open Charge Map does not accept: the trip says so', async () => {
    cs.reset();
    hits.length = 0;
    ocmStatus = 401;
    cs.suggest(input);
    await settle();
    cs.suggest(input);
    await settle();
    assert.equal(cs.suggest(input).status, 'bad_key');
    ocmStatus = 0;
  });

  server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1); // also stops the fake server
});

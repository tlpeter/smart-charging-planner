'use strict';

// Charging stops on the way (#37): the route line, which stations count, the
// settings check, and what is sent to Open Charge Map.
// A local server stands in for OSRM and Open Charge Map and records every request.
// Run: node tests/chargestops.test.js   (from the repository root)

const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

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
  let routeKm = 100;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), key: req.headers['x-api-key'] || null });
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname.startsWith('/route/')) {
      // Via a station (start;station;end): 100 km plus that station's detour
      // by road (extra, by its latitude; default 0.2 km).
      const pts = u.pathname.split('/').pop().split(';');
      const mid = pts.length === 3 ? Number(pts[1].split(',')[1]).toFixed(4) : null;
      const km = routeKm + (mid ? extra[mid] ?? 0.2 : 0);
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
    // The rest of Europe (#40); a name that contains another one goes to the right operator.
    assert.equal(cs.operatorOf('EnBW Energie Baden-Württemberg AG'), 'enbw');
    assert.equal(cs.operatorOf('Aral pulse'), 'aral');
    assert.equal(cs.operatorOf('IZIVIA'), 'izivia');
    assert.equal(cs.operatorOf('Atlante S.r.l.'), 'atlante');
    assert.equal(cs.operatorOf('Circle K Norge AS'), 'circlek');
    assert.equal(cs.operatorOf('Recharge AS'), 'recharge');
    assert.equal(cs.operatorOf('Shell Recharge'), 'shell');
    assert.equal(cs.operatorOf('Mer Germany GmbH'), 'mer');
    assert.equal(cs.operatorOf('E.ON Drive'), 'eon');
    assert.equal(cs.operatorOf('Electra'), 'electra');
    assert.equal(cs.operatorOf('Electrify America'), null);
    // Every European country the issue names is there.
    for (const code of ['NL', 'BE', 'DE', 'FR', 'LU', 'AT', 'CH', 'IT', 'ES', 'DK', 'NO', 'SE']) assert.ok(cs.COUNTRIES[code], code);
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
    assert.throws(() => cs.clean({ countries: ['XX'], connectors: ['ccs'] }, {}), /country/);
    // All of Europe, more than one at a time (#40).
    assert.deepEqual(cs.clean({ countries: ['NL', 'DE', 'FR', 'CH'], connectors: ['ccs'] }, {}).countries, ['NL', 'DE', 'FR', 'CH']);
    // Every country on the route counts unless you limit it; charge to 80 % at a stop.
    const d = cs.clean({ countries: ['NL'], connectors: ['ccs'] }, {});
    assert.equal(d.only_countries, false);
    assert.equal(d.charge_to_pct, 80);
    assert.equal(cs.clean({ countries: ['NL'], connectors: ['ccs'], only_countries: true }, {}).only_countries, true);
    assert.throws(() => cs.clean({ countries: ['NL'], connectors: ['ccs'], charge_to_pct: 101 }, {}), /between/);
    assert.throws(() => cs.clean({ countries: ['NL'], connectors: ['ccs'], reserve_pct: 45, charge_to_pct: 60 }, {}), /20%/);
    // The lowest level to arrive with at a charger: the same as the level for a stop by default, never above it.
    assert.equal(d.arrive_min_pct, 10);
    assert.equal(cs.clean({ countries: ['NL'], connectors: ['ccs'], reserve_pct: 5 }, {}).arrive_min_pct, 5);
    assert.equal(cs.clean({ countries: ['NL'], connectors: ['ccs'], arrive_min_pct: 3 }, {}).arrive_min_pct, 3);
    assert.throws(() => cs.clean({ countries: ['NL'], connectors: ['ccs'], reserve_pct: 10, arrive_min_pct: 15 }, {}), /not above/);
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


  await check('saved-key display (#42): reload, replacement, failed save, removal and discard never expose the key', async () => {
    const source = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
    const start = source.indexOf('    // ---------- Charging stops on the way (#37) ----------');
    const end = source.indexOf('    // "Charge more for this trip?"', start);
    assert.ok(start >= 0 && end > start, 'charging-stops UI section not found');
    const elements = new Map();
    const el = (id) => {
      assert.ok(html.includes('id="' + id + '"'), 'missing UI element: ' + id);
      if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; }, appendChild() {} });
      return elements.get(id);
    };
    let saved = cs.clean({ enabled: true, api_key: 'stored-secret-12345', countries: ['NL'], connectors: ['ccs'] }, {});
    let fail = false;
    let writes = 0;
    let dirty = false;
    const context = vm.createContext({
      $: el, esc: String, loadDepartures() {},
      unsavedGuard: { markDirty() { dirty = true; } },
      document: {
        querySelectorAll(selector) { return selector.includes('countries') ? [{ value: 'NL' }] : selector.includes('connectors') ? [{ value: 'ccs' }] : []; },
        createElement() { return { innerHTML: '', lastChild: { innerHTML: '' } }; },
      },
      api: async (method, route, body) => {
        assert.equal(method, 'POST');
        assert.equal(route, 'api/charge-stops');
        writes++;
        if (fail) throw new Error('Save failed');
        saved = cs.clean(body, saved);
        return { charge_stops: cs.view(saved) };
      },
    });
    vm.runInContext(source.slice(start, end), context);
    const reload = () => context.showCstops(cs.view(saved));
    const click = (id) => el(id).listeners.click();
    const type = (value) => { el('cstops-key').value = value; el('cstops-key').listeners.input(); };
    const noLeak = () => {
      const display = [...elements.values()].map((x) => [x.value, x.placeholder, x.textContent, x.innerHTML].join(' ')).join(' ');
      assert.ok(!display.includes(saved.api_key || 'impossible-empty-key'), 'saved key exposed by the UI');
      assert.equal(el('cstops-key').value, '');
    };
    reload();
    assert.match(el('cstops-key-state').textContent, /Key saved/);
    assert.match(el('cstops-key').placeholder, /Key saved/);
    assert.equal(el('cstops-key-remove').hidden, false);
    noLeak();
    // Empty means keep: saving unrelated settings must retain the real key.
    await click('cstops-save');
    assert.equal(saved.api_key, 'stored-secret-12345');
    reload();
    assert.match(el('cstops-key-state').textContent, /Key saved/);
    // A replacement is only called saved after the server accepts it.
    type('replacement-key-67890');
    assert.match(el('cstops-key-state').textContent, /not saved/);
    fail = true;
    await click('cstops-save');
    assert.equal(saved.api_key, 'stored-secret-12345');
    assert.equal(el('cstops-error').hidden, false);
    assert.match(el('cstops-key-state').textContent, /not saved/);
    fail = false;
    await click('cstops-save');
    assert.equal(saved.api_key, 'replacement-key-67890');
    noLeak();
    // Remove is a draft: no request until Save; Discard restores the saved state.
    const beforeRemove = writes;
    click('cstops-key-remove');
    assert.equal(writes, beforeRemove);
    assert.equal(dirty, true);
    assert.equal(el('cstops-enabled').checked, false);
    assert.match(el('cstops-key-state').textContent, /Removal pending/);
    assert.match(el('cstops-key-note').textContent, /Save to remove/);
    const discard = source.match(/onDiscard: \(group\) => \{ if \(group.id === 'cstops-card' && cstopsNow\) showCstops\(cstopsNow\); \}/);
    assert.ok(discard, 'discard must restore the saved charging-stop settings');
    vm.runInContext('({' + discard[0] + "}).onDiscard({ id: 'cstops-card' })", context);
    assert.match(el('cstops-key-state').textContent, /Key saved/);
    assert.equal(el('cstops-enabled').checked, true);
    assert.equal(saved.api_key, 'replacement-key-67890');
    click('cstops-key-remove');
    fail = true;
    await click('cstops-save');
    assert.equal(saved.api_key, 'replacement-key-67890');
    assert.match(el('cstops-key-state').textContent, /Removal pending/);
    fail = false;
    await click('cstops-save');
    assert.equal(saved.api_key, '');
    assert.equal(saved.enabled, false);
    reload();
    assert.equal(el('cstops-key-state').textContent, 'No key saved');
    assert.equal(el('cstops-key-remove').hidden, true);
    // Entering a replacement after Remove cancels the pending clear.
    saved = cs.clean({ enabled: false, api_key: 'restored-key-12345', countries: ['NL'], connectors: ['ccs'] }, {});
    reload();
    click('cstops-key-remove');
    type('next-key-67890');
    await click('cstops-save');
    assert.equal(saved.api_key, 'next-key-67890');
    noLeak();
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
    // One stop is enough when it is far enough along: station 1 (22 km) would
    // leave too much of the trip after charging to 80 %; station 2 (67 km) not.
    assert.deepEqual(r.stops.map((x) => x.id), [2]);
    assert.equal(r.legs.length, 1);
    // Station 2 is the last stop: charge only what the rest needs, not 80 %.
    assert.ok(r.legs[0].charge_to_pct < 80 && r.legs[0].charge_to_pct > 10 + 133 * 0.44, JSON.stringify(r.legs[0]));
    const ocm = hits.find((h) => h.path === '/ocm/poi');
    assert.equal(ocm.key, 'abc-12345');
    assert.ok(!('key' in ocm.params) && ocm.params.polyline && ocm.params.distance === '2' && ocm.params.distanceunit === 'km');
    // Only stations with enough power; no country in the request (#40).
    assert.equal(ocm.params.minpowerkw, '50');
    assert.equal(ocm.params.maxresults, '300');
    assert.ok(!('countrycode' in ocm.params));
    const route = hits.find((h) => h.path.startsWith('/route/'));
    assert.equal(route.params.geometries, 'polyline');
    // Less battery (#40): two stops. First the only station in reach, then
    // from there one after which the rest of the trip fits.
    const less = { ...input, socLeave: 30 };
    for (let i = 0; i < 6 && cs.suggest(less).status === 'pending'; i++) await settle();
    const two = cs.suggest(less);
    assert.equal(two.status, 'ok', JSON.stringify(two));
    assert.equal(two.legs.length, 2, JSON.stringify(two.legs));
    assert.deepEqual(two.legs[0].stations.map((x) => x.id), [1]);
    assert.equal(two.legs[0].charge_to_pct, 80);
    assert.equal(two.legs[0].arrive_pct, 20); // 30 % - 22 km × 0.44
    assert.ok(two.legs[1].km_on_trip > two.legs[0].km_on_trip);
    assert.ok(two.legs[1].charge_to_pct <= 80);
    // A station once per stop, also when it fits on the way there and back.
    const ids = two.legs[1].stations.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, JSON.stringify(two.legs[1].stations));
    assert.deepEqual(two.stops.map((x) => x.id), [1]); // the first stop, as before
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
    const there = { ...input, socLeave: 95, socEnd: 7 }; // 95 % - 44 % = 51 % at the destination, 7 % back
    for (let i = 0; i < 4; i++) { cs.suggest(there); await settle(); }
    const r = cs.suggest(there);
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.ok(r.on_way_back, JSON.stringify(r));
    const via = hits.find((h) => h.path.split(';').length === 3);
    assert.ok(via && via.path.split('/').pop().startsWith('5,51.9;'), via && via.path);
  });

  await check('a route across a border (#40): stations in every country on the route count, unless you limit it to your countries', async () => {
    cs.reset();
    hits.length = 0;
    // Home in the Netherlands, the station 67 km along the route in Germany.
    const station = (id, op, lat, country) => ({ ...poi(id, op, lat, 5.0, [ccs(300)]), AddressInfo: { Title: `S${id}`, Town: 'T', Latitude: lat, Longitude: 5.0, Country: { ISOCode: country } } });
    stations = [station(20, 'Fastned', 51.2, 'NL'), station(21, 'EnBW Energie Baden-Württemberg AG', 51.6, 'DE')];
    cfg = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10 };
    const run = async () => { for (let i = 0; i < 8; i++) { cs.suggest(input); await settle(); } return cs.suggest(input); };
    let r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.deepEqual(r.legs.map((l) => l.stations.map((x) => [x.id, x.country])), [[[21, 'DE']]]);
    // The stations are asked for along the whole line, not per country.
    assert.ok(hits.filter((h) => h.path === '/ocm/poi').every((h) => !('countrycode' in h.params)));
    // Only your countries: the German station drops out, so it takes two stops in the Netherlands.
    cfg = { ...cfg, only_countries: true };
    r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.ok(r.legs.length === 2 && r.legs.every((l) => l.stations.every((x) => x.country === 'NL')), JSON.stringify(r.legs));
    assert.ok(!r.legs[0].on_way_back && r.legs[1].on_way_back, JSON.stringify(r.legs));
    // Germany ticked too: one stop again.
    cfg = { ...cfg, countries: ['NL', 'DE'] };
    r = await run();
    assert.deepEqual(r.legs.map((l) => l.stations.map((x) => x.id)), [[21]]);
  });

  await check('arrive at a charger with at least (#40): below the level for a stop the car may drive on to a station where it arrives nearly empty, which comes first', async () => {
    cs.reset();
    // Charge to 50 % at a stop, so one stop is not enough. A: 67 km, the
    // smallest detour; B: 93 km, a bigger detour, beyond the reach down to 10 %.
    extra = { '51.6000': 0.1, '51.8400': 1.0 };
    stations = [poi(30, 'Fastned', 51.6, 5.0, [ccs(300)]), poi(31, 'IONITY GmbH', 51.84, 5.0, [ccs(350)])];
    const base = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10, charge_to_pct: 50 };
    const run = async () => { let r = cs.suggest(input); for (let i = 0; i < 8 && r.status === 'pending'; i++) { await settle(); r = cs.suggest(input); } return r; };
    // The same as the level for a stop (the default): only A is in reach.
    cfg = { ...base };
    let r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.equal(r.legs[0].stations[0].id, 30);
    assert.ok(r.legs[0].arrive_pct >= 10, JSON.stringify(r.legs[0]));
    // At least 5 %: B is in reach, and the car arrives there between 5 and 10 %, so B comes first.
    cfg = { ...base, arrive_min_pct: 5 };
    r = await run();
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.equal(r.arrive_min_pct, 5);
    assert.equal(r.reach_km, Math.round(45 / 0.44));
    assert.deepEqual(r.legs[0].stations.map((x) => x.id), [31], JSON.stringify(r.legs[0]));
    assert.ok(r.legs[0].arrive_pct >= 5 && r.legs[0].arrive_pct < 10, JSON.stringify(r.legs[0]));
    // Back home the level stays above the level for a stop.
    const l = r.legs[r.legs.length - 1];
    assert.ok(l.charge_to_pct - (200 - l.km_on_trip) * 0.44 >= 10 - 1, JSON.stringify(r.legs));
    extra = {};
  });

  await check('a long trip (#40): more than eight stops, each in reach of the one before, as far along as the battery allows', async () => {
    cs.reset();
    hits.length = 0;
    // 1000 km straight north, a station every 25 km; there and back 2000 km.
    const far = { lat: 45.0, lon: 5.0 };
    const end = { lat: 45.0 + 1000 / 110.57, lon: 5.0 };
    const longLine = [];
    for (let k = 0; k <= 400; k++) longLine.push({ lat: far.lat + (end.lat - far.lat) * (k / 400), lon: 5.0 });
    const saved = line;
    line = cs.encodePolyline(longLine);
    routeKm = 1000;
    stations = [];
    for (let k = 1; k < 40; k++) stations.push(poi(100 + k, k % 2 ? 'IONITY GmbH' : 'Fastned', far.lat + (end.lat - far.lat) * (k / 40), 5.0, [ccs(300)]));
    cfg = { enabled: true, api_key: 'abc-12345', countries: ['NL'], connectors: ['ccs'], min_power_kw: 50, max_detour_km: 4, reserve_pct: 10, charge_to_pct: 80 };
    const trip = { home: far, dest: end, socLeave: 90, socEnd: -790, pctPerKm: 0.4, capacityKwh: 60 };
    let r = cs.suggest(trip);
    for (let i = 0; i < 40 && r.status === 'pending'; i++) { await settle(); r = cs.suggest(trip); }
    try {
      assert.equal(r.status, 'ok', JSON.stringify({ ...r, legs: undefined }));
      // 80 % - 10 % = 70 % per stop at 0.44 %/km: ~159 km between stops, so about 12 stops.
      assert.ok(r.legs.length > 8 && r.legs.length < cs.MAX_STOPS, String(r.legs.length));
      let x = 0;
      let soc = 90;
      for (const l of r.legs) {
        // Every stop is reached before the reserve, and further along than the one before.
        assert.ok(l.km_on_trip > x, JSON.stringify(l));
        assert.ok(l.arrive_pct >= 10 - 1 && l.arrive_pct <= soc, JSON.stringify(l));
        assert.ok(l.stations.length >= 1 && l.stations.length <= 3);
        x = l.km_on_trip;
        soc = l.charge_to_pct;
      }
      // After the last stop the rest of the trip fits.
      assert.ok(soc - (2000 - x) * 0.44 >= 10 - 1, JSON.stringify(r.legs[r.legs.length - 1]));
      assert.ok(r.legs.some((l) => l.on_way_back) && r.legs.some((l) => !l.on_way_back));
      // A longer route asks Open Charge Map for more stations.
      assert.equal(hits.find((h) => h.path === '/ocm/poi').params.maxresults, '3000');
    } finally {
      line = saved;
      routeKm = 100;
    }
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

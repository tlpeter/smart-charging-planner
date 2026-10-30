'use strict';

// The page (#51): what you opened stays open when Home reloads every minute,
// and a reload that changes nothing leaves the page as it is.
// Run: node tests/page.test.js   (from the repository root)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const src = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');

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

check('a part that opens and closes keeps its state across a reload: closed by default, open after you open it, closed again after you close it', () => {
  const start = src.indexOf('    const keptOpen = new Map();');
  const end = src.indexOf('\n', src.indexOf('    const keep = (key, dflt = false)'));
  assert.ok(start > 0 && end > start, 'keep() not found');
  const listeners = [];
  const ctx = vm.createContext({
    esc: (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    document: { addEventListener: (type, fn) => listeners.push([type, fn]) },
  });
  vm.runInContext(src.slice(start, end) + '\nthis.keep = keep;', ctx);
  const toggle = (key, open) => listeners.filter(([t]) => t === 'toggle').forEach(([, fn]) => fn({ target: { dataset: { keep: key }, open } }));
  assert.equal(ctx.keep('day:2026-10-29'), ' data-keep="day:2026-10-29"');
  toggle('day:2026-10-29', true);
  assert.equal(ctx.keep('day:2026-10-29'), ' data-keep="day:2026-10-29" open');
  assert.equal(ctx.keep('day:2026-10-30'), ' data-keep="day:2026-10-30"'); // another day stays closed
  toggle('day:2026-10-29', false);
  assert.equal(ctx.keep('day:2026-10-29'), ' data-keep="day:2026-10-29"');
  // Open by default, closed by you: stays closed.
  assert.equal(ctx.keep('x', true), ' data-keep="x" open');
  toggle('x', false);
  assert.equal(ctx.keep('x', true), ' data-keep="x"');
  // Something without a name is not kept.
  listeners.filter(([t]) => t === 'toggle').forEach(([, fn]) => fn({ target: { dataset: {}, open: true } }));
});

check('the days in Looking ahead, Plan details, the plan table and the next days on Plan keep their state', () => {
  assert.match(src, /<details class="tl-day[^`]*\$\{keep\(`day:\$\{day\.key\}`\)\}>/);
  assert.match(src, /<details class="card plan-details"\$\{keep\('plan-details'\)\}>/);
  assert.match(src, /<details class="table-details"\$\{keep\('plan-table'\)\}>/);
  assert.match(src, /<details\$\{keep\('dep-next-days'\)\}>/);
});

check('the route map (#47): the zoom fits every point, the tiles cover the map, the route line is decoded; nothing is drawn while the map is closed', () => {
  const start = src.indexOf('    function decodeLine(str) {');
  const end = src.indexOf('    function renderMap(el) {');
  assert.ok(start > 0 && end > start, 'map helpers not found');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end) + '\nthis.decodeLine = decodeLine; this.mapLayout = mapLayout; this.tileSrc = tileSrc;', ctx);
  // The example from Google's documentation.
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.decodeLine('_p~iF~ps|U_ulLnnqC_mqNvxq`@'))), [{ lat: 38.5, lon: -120.2 }, { lat: 40.7, lon: -120.95 }, { lat: 43.252, lon: -126.453 }]);
  // Made-up points in the sea, about 300 km apart.
  const pts = [{ lat: 54.0, lon: 3.0 }, { lat: 56.5, lon: 4.5 }, { lat: 55.2, lon: 3.6 }];
  for (const [w, h] of [[1200, 440], [360, 260]]) {
    const L = ctx.mapLayout(pts, w, h);
    for (const p of pts) {
      const q = L.at(p);
      assert.ok(q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h, `${w}: point outside the map ${JSON.stringify(q)}`);
    }
    // The tiles cover the whole map, without gaps (laid out before enlarging).
    assert.ok(L.scale >= 1 && L.scale <= 2, String(L.scale));
    assert.ok(L.tiles.some((t) => t.left <= 0 && t.top <= 0), 'top left not covered');
    assert.ok(L.tiles.some((t) => t.left + 256 >= w / L.scale && t.top + 256 >= h / L.scale), 'bottom right not covered');
    // The route fills the map: at least half of the width or the height.
    const xs = pts.map((p) => L.at(p).x);
    const ys = pts.map((p) => L.at(p).y);
    assert.ok(Math.max(...xs) - Math.min(...xs) >= (w - 56) / 2 - 1 || Math.max(...ys) - Math.min(...ys) >= (h - 56) / 2 - 1, `${w}: route too small`);
    assert.ok(L.tiles.every((t) => t.z === L.z && t.x >= 0 && t.y >= 0 && t.x < 2 ** L.z && t.y < 2 ** L.z));
    assert.ok(L.tiles.length <= 40, String(L.tiles.length));
  }
  // A phone gets a lower zoom than a computer for the same route.
  assert.ok(ctx.mapLayout(pts, 360, 260).z <= ctx.mapLayout(pts, 1200, 440).z);
  // A short route gets a closer zoom than a long one.
  assert.ok(ctx.mapLayout([{ lat: 54.0, lon: 3.0 }, { lat: 54.1, lon: 3.1 }], 360, 260).z > ctx.mapLayout(pts, 360, 260).z);
  assert.equal(ctx.tileSrc('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { z: 7, x: 66, y: 41 }), 'https://tile.openstreetmap.org/7/66/41.png');
  // No map image in the page until the map is opened: the tiles are only made in renderMap.
  const html = src.slice(src.indexOf('      function chargeStopsHtml(c) {'), src.indexOf('      // One line per day; tap a day for all its details'));
  assert.ok(html.includes('class="cstops-map"') && !html.includes('<img'), 'the trip block must not contain map images');
});

check('the map icon in Looking ahead (#47): only for a trip with a route map; opens the big map in one click without opening the day; no map images before that', () => {
  const start = src.indexOf('    function mapDataOf(c) {');
  const end = src.indexOf('\n    }\n', start) + 7;
  assert.ok(start > 0 && end > start, 'mapDataOf not found');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end) + '\nthis.mapDataOf = mapDataOf;', ctx);
  const station = (name, lat) => ({ name, lat, lon: 3.0 });
  const c = { map: { tiles: 't/{z}/{x}/{y}', line: 'abc', home: { lat: 54, lon: 3 }, dest: { lat: 56, lon: 3 } },
    legs: [{ n: 1, stations: [station('A', 54.5), station('B', 54.6)] }, { n: 2, stations: [] }] };
  const d = JSON.parse(JSON.stringify(ctx.mapDataOf(c)));
  assert.deepEqual(d.stops, [{ n: 1, stations: [{ lat: 54.5, lon: 3, name: 'A' }, { lat: 54.6, lon: 3, name: 'B' }] }]);
  assert.equal(ctx.mapDataOf({ ...c, map: undefined }), null); // no route map chosen: no icon
  assert.equal(ctx.mapDataOf({ ...c, legs: [{ n: 1, stations: [] }] }), null); // no station position: no icon
  // The icon is in the day's line, only when there is map data.
  assert.match(src, /const mapBtn = md \? ` <button type="button" class="tl-map" data-route-map=/);
  // One click: the day does not open or close, and the map is drawn in the window.
  const click = src.slice(src.indexOf("closest('[data-route-map]')"), src.indexOf("window.addEventListener('resize', drawMapDialog);"));
  assert.ok(click.includes('e.preventDefault()') && click.includes('e.stopPropagation()') && click.includes('openMapDialog('), 'the click must not toggle the day');
  // No map images in the page until the window is opened: only drawMap makes tiles.
  assert.ok(!src.slice(src.indexOf('    function mapDialog() {'), src.indexOf('    function drawMapDialog() {')).includes('<img'));
});

check('Leaflet (#54): shipped with the app unchanged (1.9.4, with its license), served by the app, loaded only when a map opens; the fixed map when it cannot load', () => {
  const crypto = require('crypto');
  const dir = path.join(APP, 'public', 'vendor', 'leaflet');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  // The files of the npm package leaflet@1.9.4, unchanged.
  assert.equal(sha('leaflet.js'), 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a');
  assert.equal(sha('leaflet.css'), 'a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6');
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /BSD 2-Clause/);
  // Served by the app itself: no other site is asked for it.
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(server, /\['\/vendor\/leaflet\/leaflet\.js', \['vendor\/leaflet\/leaflet\.js', 'application\/javascript/);
  assert.match(server, /\['\/vendor\/leaflet\/leaflet\.css', \['vendor\/leaflet\/leaflet\.css', 'text\/css/);
  const html = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
  assert.ok(!html.includes('leaflet'), 'the page must not load Leaflet before a map opens');
  assert.ok(src.includes("js.src = 'vendor/leaflet/leaflet.js'") && !/https?:\/\/[^'"`]*leaflet/i.test(src), 'Leaflet only from the app');
  // The fixed map is drawn only when Leaflet does not load (no map images twice).
  const draw = src.slice(src.indexOf('    function drawMap(box, m, w, h'), src.indexOf('    function drawStaticMap('));
  assert.ok(draw.includes('loadLeaflet().then') && draw.includes('.catch(') && draw.includes('drawStaticMap('), 'fallback missing');
  assert.ok(draw.indexOf('drawStaticMap(') > draw.indexOf('.catch('), 'the fixed map only in the fallback');
  // In the page: the mouse wheel and one finger still scroll the page; in the big window: zoom and drag.
  assert.match(src, /scrollWheelZoom: !inline, dragging: !inline \|\| !touch/);
});

check('the reload every minute leaves Home as it is when nothing changed', () => {
  const from = src.indexOf('    async function loadOverview(');
  const body = src.slice(from, src.indexOf("    window.addEventListener('resize'", from));
  const skip = body.indexOf('if (auto && html === overviewHtmlNow');
  const write = body.indexOf("$('overview-body').innerHTML = html;");
  assert.ok(skip > 0 && write > skip, 'the unchanged check must come before the page is rebuilt');
  assert.ok(body.indexOf('drawChart(d)') > write, 'the chart is only drawn again when the page was rebuilt');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;

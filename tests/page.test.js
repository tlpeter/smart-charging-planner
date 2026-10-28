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

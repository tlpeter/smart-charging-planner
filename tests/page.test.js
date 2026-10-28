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

check('the reload every minute leaves Home as it is when nothing changed', () => {
  const body = src.slice(src.indexOf('    async function loadOverview('), src.indexOf("    window.addEventListener('resize'"));
  const skip = body.indexOf('if (auto && html === overviewHtmlNow');
  const write = body.indexOf("$('overview-body').innerHTML = html;");
  assert.ok(skip > 0 && write > skip, 'the unchanged check must come before the page is rebuilt');
  assert.ok(body.indexOf('drawChart(d)') > write, 'the chart is only drawn again when the page was rebuilt');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;

'use strict';

// The Home Assistant theme (#63): the app copies the theme that is active in
// Home Assistant, for every user, and builds all its colours from it.
// Run: node tests/theme.test.js   (from the repository root)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const PUBLIC = path.join(__dirname, '..', 'smart_charging_planner', 'app', 'public');
const themeSrc = fs.readFileSync(path.join(PUBLIC, 'theme.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

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

// A CSS style declaration with custom properties.
function styleMap(values = {}) {
  const props = new Map(Object.entries(values));
  return {
    props,
    setProperty: (k, v) => props.set(k, v),
    removeProperty: (k) => props.delete(k),
    getPropertyValue: (k) => (props.has(k) ? ` ${props.get(k)}` : ''),
  };
}

// '#rrggbb' -> 'rgb(r, g, b)', as the browser reports a colour.
function toRgb(value) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value).trim());
  if (!m) return '';
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
}

// Runs theme.js in a page inside a fake Home Assistant page.
// parent: 'ha' (readable), 'blocked' (the browser refuses) or 'none' (opened on its own).
function load({ parent = 'ha', haVars = {}, prefersDark = false, sheets = [] } = {}) {
  const observers = [];
  const root = { style: styleMap(), dataset: {} };
  const head = { children: [], appendChild: (el) => head.children.push(el) };
  const document = {
    documentElement: root,
    head,
    body: { appendChild() {} },
    readyState: 'complete',
    hidden: false,
    addEventListener() {},
    createElement: () => {
      const el = { style: {}, remove() {}, textContent: '', id: '' };
      let color = '';
      Object.defineProperty(el.style, 'color', { get: () => color, set: (v) => { color = toRgb(v) ? v : ''; } });
      return el;
    },
  };
  const haRoot = { style: styleMap(haVars) };
  const haDoc = {
    documentElement: haRoot,
    head: {},
    baseURI: 'http://ha.local:8123/lovelace/0',
    styleSheets: sheets,
    defaultView: { getComputedStyle: (el) => el.style },
  };
  const window = {
    matchMedia: () => ({ matches: prefersDark, addEventListener() {} }),
  };
  if (parent === 'ha') window.parent = { document: haDoc };
  else if (parent === 'blocked') window.parent = { get document() { throw new Error('SecurityError'); } };
  else window.parent = window;
  const ctx = vm.createContext({
    window,
    document,
    getComputedStyle: (el) => ({ color: toRgb(el.style.color) }),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe() {}
    },
    URL,
  });
  window.MutationObserver = ctx.MutationObserver;
  vm.runInContext(themeSrc, ctx);
  return {
    root, haRoot, head,
    vars: () => Object.fromEntries(root.style.props),
    change: (values) => { haRoot.style = styleMap(values); observers.forEach((o) => o.fn([])); },
  };
}

check('a custom Home Assistant theme is copied onto the page: primary colour, background, cards, text, energy colours', () => {
  const page = load({ haVars: {
    '--primary-color': '#8bc34a',
    '--primary-background-color': '#fafafa',
    '--card-background-color': '#ffffff',
    '--primary-text-color': '#212121',
    '--energy-solar-color': '#ffeb3b',
    '--energy-battery-out-color': '#00bcd4',
    '--success-color': '#2e7d32',
    '--ha-card-border-radius': '16px',
  } });
  const v = page.vars();
  assert.equal(v['--primary-color'], '#8bc34a');
  assert.equal(v['--energy-solar-color'], '#ffeb3b');
  assert.equal(v['--energy-battery-out-color'], '#00bcd4');
  assert.equal(v['--ha-card-border-radius'], '16px');
  assert.equal(page.root.dataset.scheme, 'light');
  assert.equal(page.root.dataset.theme, 'home-assistant');
  // A variable the theme does not set is left to the fallback in styles.css.
  assert.equal(v['--purple-color'], undefined);
});

check('light or dark follows Home Assistant, not the browser: Home Assistant dark, browser light gives dark (and the other way round)', () => {
  assert.equal(load({ haVars: { '--primary-background-color': '#111111' }, prefersDark: false }).root.dataset.scheme, 'dark');
  assert.equal(load({ haVars: { '--primary-background-color': '#fafafa' }, prefersDark: true }).root.dataset.scheme, 'light');
});

check('a theme change in Home Assistant is applied right away, and a variable the new theme does not set is removed again', () => {
  const page = load({ haVars: { '--primary-color': '#8bc34a', '--accent-color': '#ff4081', '--primary-background-color': '#fafafa' } });
  assert.equal(page.vars()['--accent-color'], '#ff4081');
  page.change({ '--primary-color': '#e91e63', '--primary-background-color': '#111111' });
  assert.equal(page.vars()['--primary-color'], '#e91e63');
  assert.equal(page.vars()['--accent-color'], undefined);
  assert.equal(page.root.dataset.scheme, 'dark');
});

check('every user gets their own theme: two users with different themes see different colours', () => {
  const a = load({ haVars: { '--primary-color': '#8bc34a', '--primary-background-color': '#fafafa' } });
  const b = load({ haVars: { '--primary-color': '#673ab7', '--primary-background-color': '#111111' } });
  assert.notEqual(a.vars()['--primary-color'], b.vars()['--primary-color']);
  assert.notEqual(a.root.dataset.scheme, b.root.dataset.scheme);
});

check('when the Home Assistant page cannot be read (blocked, or the app opened on its own): no error, the default theme, light or dark as the browser prefers', () => {
  for (const parent of ['blocked', 'none']) {
    const dark = load({ parent, prefersDark: true });
    assert.deepEqual(dark.vars(), {});
    assert.equal(dark.root.dataset.theme, 'default');
    assert.equal(dark.root.dataset.scheme, 'dark');
    assert.equal(load({ parent, prefersDark: false }).root.dataset.scheme, 'light');
  }
});

check('the fonts of Home Assistant are loaded on the page, with full addresses', () => {
  const sheets = [
    { href: 'http://ha.local:8123/static/fonts/roboto.css', cssRules: [
      { type: 5, cssText: '@font-face { font-family: Roboto; src: url("roboto/Roboto-Regular.woff2") format("woff2"); }' },
      { type: 1, cssText: 'body { margin: 0; }' },
    ] },
    { href: 'https://cdn.example/other.css', get cssRules() { throw new Error('SecurityError'); } },
  ];
  const page = load({ sheets });
  const style = page.head.children.find((el) => el.id === 'ha-fonts');
  assert.ok(style, 'no font style added');
  assert.match(style.textContent, /url\("http:\/\/ha\.local:8123\/static\/fonts\/roboto\/Roboto-Regular\.woff2"\)/);
  assert.doesNotMatch(style.textContent, /margin/);
});

check('every Home Assistant variable that styles.css has a fallback for is copied by theme.js', () => {
  const copied = new Set(vm.runInNewContext(`(${/const VARS = (\[[\s\S]*?\]);/.exec(themeSrc)[1]})`));
  const declared = [...css.matchAll(/^\s*(--[a-z0-9_-]+):/gm)].map((m) => m[1]);
  const own = /^--(bg|card|surface|text|muted|border|accent|accent-text|good|bad|warning|solar|battery|minimum|care|expected|charged|chip|bar|grid|c-[a-z]+|soc-[a-z]+|radius|card-border|shadow|font|range-[a-z]+|range-pos|section-color|c)$/;
  const ha = [...new Set(declared.filter((n) => !own.test(n)))];
  const missing = ha.filter((n) => !copied.has(n) && /color|font|card/.test(n));
  assert.deepEqual(missing, []);
});

check('all colours come from the theme: no fixed colours in styles.css outside the fallbacks, none in app.js', () => {
  // Remove the blocks with Home Assistant's default values (the fallbacks).
  const body = css.replace(/:root(\[data-scheme=dark\])?\s*\{[^}]*\}/g, '');
  const fixed = body.match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert.deepEqual(fixed, [], 'fixed colours in styles.css');
  assert.doesNotMatch(body, /--rgb-|hsl\(/);
  // Only black shadows and overlays may use a fixed colour.
  const rgb = (body.match(/rgba?\([^)]*\)/g) || []).filter((c) => !/^rgba\(0,\s*0,\s*0,\s*[.0-9]+\)$/.test(c.replace(/\s+/g, ' ').replace(/ /g, '')));
  assert.deepEqual(rgb, [], 'fixed rgb colours in styles.css');
  assert.doesNotMatch(appSrc, /#[0-9a-f]{6}\b|--rgb-|hsl\(/i);
});

check('light or dark does not follow the browser in styles.css; the page loads theme.js in the head, before the app', () => {
  assert.doesNotMatch(css, /prefers-color-scheme/);
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="theme.js"></script>'), 'theme.js not in the head');
  assert.ok(html.indexOf('theme.js') < html.indexOf('app.js'));
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

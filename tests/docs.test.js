'use strict';

// The Markdown files keep up with the code (AGENTS.md › Documentation).
// On dev (a version ending in -dev):
//  - README.md: "The current development candidate is **X.Y.Z-dev** (stable is A.B.C)"
//    has the same X.Y as config.yaml;
//  - RELEASE.md: "## Current candidate: X.Y.Z-dev" has the same X.Y;
//  - every issue in the changelog since the stable version, "(#123)", is in
//    README › "Implemented on dev, awaiting a stable release" and in the
//    RELEASE.md candidate section.
// On main (no -dev) these dev-only parts are not checked.
// Run: node tests/docs.test.js   (from the repository root)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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

// "0.35.1-dev" → [0, 35, 1]
const parts = (v) => String(v).replace(/-dev$/, '').split('.').map(Number);
const minor = (v) => parts(v).slice(0, 2).join('.');
const newer = (a, b) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// The text from a heading to the next heading of the same or a higher level.
function section(text, heading) {
  const i = text.indexOf(heading);
  if (i < 0) return null;
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(i + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

const version = (read('smart_charging_planner/config.yaml').match(/^version:\s*"?([^"\s]+)"?/m) || [])[1];
const readme = read('README.md');
const release = read('RELEASE.md');
const changelog = read('smart_charging_planner/CHANGELOG.md');

check('config.yaml has a version', () => {
  if (!version || !/^\d+\.\d+\.\d+(-dev)?$/.test(version)) throw new Error(`version "${version}"`);
});

if (/-dev$/.test(version || '')) {
  const cand = readme.match(/development candidate is \*\*(\d+\.\d+\.\d+)-dev\*\* \(stable is (\d+\.\d+\.\d+)\)/);
  const stable = cand ? cand[2] : null;

  check(`README: development candidate has the same X.Y as config.yaml (${version})`, () => {
    if (!cand) throw new Error('README needs: The current development candidate is **X.Y.Z-dev** (stable is A.B.C)');
    if (minor(cand[1]) !== minor(version)) throw new Error(`README says ${cand[1]}-dev, config.yaml ${version}`);
  });

  const relHead = release.match(/^## Current candidate: (\d+\.\d+\.\d+)-dev\s*$/m);
  check(`RELEASE: current candidate has the same X.Y as config.yaml (${version})`, () => {
    if (!relHead) throw new Error('RELEASE.md needs: ## Current candidate: X.Y.Z-dev');
    if (minor(relHead[1]) !== minor(version)) throw new Error(`RELEASE.md says ${relHead[1]}-dev, config.yaml ${version}`);
  });

  // Issues in the changelog since the stable version.
  const issues = new Set();
  if (stable) {
    let current = null;
    for (const line of changelog.split('\n')) {
      const h = line.match(/^## (\d+\.\d+\.\d+)(-dev)?\b/);
      if (h) {
        current = h[1];
        continue;
      }
      if (current && newer(current, stable)) {
        // "(#37)" or "(#12, #13)": the issues an entry belongs to.
        for (const m of line.matchAll(/\((#\d+(?:,\s*#\d+)*)\)/g)) {
          for (const n of m[1].matchAll(/#(\d+)/g)) issues.add(n[1]);
        }
      }
    }
  }
  const has = (text, n) => !!text && new RegExp(`#${n}(?!\\d)`).test(text);

  check(`README: every issue since ${stable || '?'} is under "Implemented on dev" (${[...issues].map((n) => `#${n}`).join(', ') || 'none'})`, () => {
    const part = section(readme, '### Implemented on dev, awaiting a stable release');
    if (!part) throw new Error('README needs the section: ### Implemented on dev, awaiting a stable release');
    const missing = [...issues].filter((n) => !has(part, n));
    if (missing.length) throw new Error(`missing: ${missing.map((n) => `#${n}`).join(', ')}`);
  });

  check(`RELEASE: every issue since ${stable || '?'} is in the candidate scope`, () => {
    const part = relHead ? section(release, relHead[0].trim()) : null;
    if (!part) throw new Error('no candidate section');
    const missing = [...issues].filter((n) => !has(part, n));
    if (missing.length) throw new Error(`missing: ${missing.map((n) => `#${n}`).join(', ')}`);
  });

  check('changelog: the newest heading is the version in config.yaml', () => {
    const first = changelog.match(/^## (\S+)/m);
    if (!first || first[1] !== version) throw new Error(`changelog starts with ${first && first[1]}, config.yaml ${version}`);
  });
}

console.log(failures ? `\n${failures} failed` : '\nAll documentation checks passed');
process.exitCode = failures ? 1 : 0;

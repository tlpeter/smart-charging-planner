'use strict';

// Writes tests/TESTPLAN.md from the results of the last test run, so the test
// plan always shows what is tested and whether it passed. GitHub runs this
// after every push (see .github/workflows/tests.yml) and saves the new file.
//
//   node tests/testplan.js unit <dir>     run the unit tests, save their output in <dir>
//   node tests/testplan.js write <dir>    write tests/TESTPLAN.md from the results in <dir>
//   node tests/testplan.js all            run everything here (several minutes) and write
//
// <dir> holds: settings-*.json and matrix-*.json (SCP_RESULTS of
// settings.test.js and matrix.test.js) and unit-*.json (from "unit").

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLAN = path.join(__dirname, 'TESTPLAN.md');

const UNIT = [
  ['brands', 'Chargers per brand: detection, start/stop, current, phase switching, status texts'],
  ['solar', 'Inverters, solar forecasts, the value of own solar power, charging on surplus'],
  ['battery', 'Home batteries: detection, commands, the guard, the battery plan'],
  ['forecast', 'Price forecast: reading it and planning with it'],
  ['reliability', 'Ready Guard: is the car ready in time, and what happens when it is not'],
  ['activecar', 'More than one car: which car is connected; car, target and precondition in the calendar'],
  ['sharing', 'More than one charger: who charges first and how the connection is shared'],
  ['tripcost', 'Look ahead: which calendar locations are addresses, the use per km, learning from trips'],
  ['persistence', 'Saving settings safely (a crash while saving loses nothing)'],
];

const NOT_COVERED = [
  'House load, learned charging power and Savings: they need long-term statistics, which the fake Home Assistant does not have.',
  'The real cars, chargers and inverters: response time of the car\'s cloud (Renault, MySkoda), the charger and the solar forecast. The fake reacts immediately.',
  'Phase switching on a real charger: some chargers pause the session while switching.',
  'Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.',
  'Look ahead with the real OpenStreetMap: the test uses a fake address search and route; real addresses can be found differently or not at all.',
  'Two real chargers on one connection: the test checks the decisions, not how fast real chargers follow a lower current.',
  'Adding trips with "Allow adding trips to calendar" on (only test mode is tested).',
  'The page itself (buttons, forms): checked with screenshots during development, not in this test.',
];

// ---------------------------------------------------------------- running

function runUnit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let failed = 0;
  for (const [name] of UNIT) {
    const r = spawnSync(process.execPath, [path.join(__dirname, `${name}.test.js`)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { SCP_GEOCODE_URL: 'http://127.0.0.1:9/search', ...process.env },
      timeout: 5 * 60000,
    });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const code = r.status == null ? 1 : r.status;
    fs.writeFileSync(path.join(dir, `unit-${name}.json`), JSON.stringify({ name, code, output }, null, 2));
    process.stdout.write(`\n== ${name}.test.js (exit ${code})\n${output}`);
    if (code !== 0) failed++;
  }
  return failed;
}

function runAll() {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scp-testplan-'));
  let failed = runUnit(dir);
  for (const profile of ['renault_easee', 'skoda_wallbox']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'settings.test.js')], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, SCP_PROFILE: profile, SCP_RESULTS: path.join(dir, `settings-${profile}.json`) },
    });
    if (r.status !== 0) failed++;
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, 'matrix.test.js')], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, SCP_RESULTS: path.join(dir, 'matrix-all.json') },
  });
  if (r.status !== 0) failed++;
  write(dir);
  return failed;
}

// ---------------------------------------------------------------- reading

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const files = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : []);

// The unit tests print "ok name", "ok - name", "FAIL name - why" or
// "not ok - name"; a line without that (and not a log line) starts a group.
function parseUnit(u) {
  const checks = [];
  let group = '';
  for (const raw of u.output.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\d{4}-\d\d-\d\dT/.test(line)) continue;
    let m;
    if ((m = line.match(/^\s*not ok\s*-?\s*(.*)$/))) checks.push({ group, name: m[1], ok: false, note: '' });
    else if ((m = line.match(/^\s*ok\s*-?\s+(.*)$/))) checks.push({ group, name: m[1], ok: true, note: '' });
    else if ((m = line.match(/^\s*FAIL\s+(.*)$/))) {
      const [name, ...why] = m[1].split(' - ');
      checks.push({ group, name, ok: false, note: why.join(' - ') });
    } else if (/check\(s\) failed$|checks passed$|tests passed$/i.test(line.trim())) continue;
    else if (!/^\s/.test(line) && !/^\s*(at |Error|AssertionError)/.test(line)) group = line.trim();
  }
  if (!checks.length && u.code === 0) checks.push({ group: '', name: 'all checks', ok: true, note: '' });
  if (u.code !== 0 && checks.every((c) => c.ok)) checks.push({ group: '', name: 'the test stopped with an error', ok: false, note: `exit ${u.code}` });
  return checks;
}

// ---------------------------------------------------------------- writing

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const mark = (r) => (!r ? '–' : r.ok ? '✓' : '✗ FAIL');
const cell = (r, max = 0) => {
  if (!r) return '– (not for this set-up)';
  let note = esc(r.note);
  if (max && note.length > max) note = `${note.slice(0, max)}…`;
  return `${mark(r)}${note ? ` ${note}` : ''}`;
};

function version() {
  const m = fs.readFileSync(path.join(ROOT, 'smart_charging_planner', 'config.yaml'), 'utf8').match(/^version:\s*"?([^"\n]+)"?/m);
  return m ? m[1] : '?';
}

function settingsPart(sets) {
  const ver = version();
  const letters = 'AB';
  const labels = sets.map((s, i) => `**${letters[i] || i + 1}**: ${s.profile || s.file}`);
  let md = '# Test plan\n\n';
  md += 'This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (several minutes).\n\n';
  md += 'Three kinds of tests:\n\n';
  md += '1. **Settings**: every setting, against a fake Home Assistant (`tests/fake-ha.js`). The real app starts with an empty data folder and is used through the same API as the page: what is saved, what is refused, what the plan does and what is sent to Home Assistant.\n';
  md += '2. **Unit tests**: one part of the app at a time, without Home Assistant (brands, solar, batteries, price forecast, Ready Guard, more cars, more chargers, look ahead, saving).\n';
  md += '3. **Matrix**: every charger brand with every home battery brand.\n\n';
  md += 'A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core.\n\n';
  md += '## Summary\n\n| Test | Passed |\n|---|---|\n';
  for (const [i, s] of sets.entries()) {
    const p = s.results.filter((r) => r.ok).length;
    md += `| Settings ${letters[i] || i + 1}: ${esc(s.profile)} | ${p} of ${s.results.length}${p === s.results.length ? ' ✓' : ' ✗'} |\n`;
  }
  return { md, ver, labels };
}

function settingsTables(sets) {
  if (!sets.length) return '\n# Settings\n\nNo results in this run.\n';
  const letters = 'AB';
  let md = '\n# Settings\n\n';
  md += `Set-ups, with entity names taken from the integrations' own source code:\n\n${sets.map((s, i) => `- **${letters[i] || i + 1}**: ${s.profile}`).join('\n')}\n\n`;
  md += 'Both also have a P1 meter, a Fronius inverter, EnergyZero prices, a price sensor with a 7-day forecast, a solar forecast in the Energy dashboard, a Sigenergy home battery, a second car and charger, calendars (also a read-only iCloud calendar), helpers and notify actions.\n\n';
  md += 'Run one yourself (from the repository root, after `npm install` in `smart_charging_planner/app`), about a minute each:\n\n```\nnode tests/settings.test.js\nSCP_PROFILE=skoda_wallbox node tests/settings.test.js\n```\n';
  const order = [];
  const ids = {};
  for (const s of sets) {
    for (const r of s.results) {
      if (!ids[r.group]) { ids[r.group] = []; order.push(r.group); }
      if (!ids[r.group].includes(r.id)) ids[r.group].push(r.id);
    }
  }
  const head = `| # | What is tested | ${sets.map((s, i) => `${letters[i] || i + 1}: ${esc(s.profile)}`).join(' | ')} |\n|---|---|${sets.map(() => '---|').join('')}\n`;
  for (const g of order) {
    md += `\n## ${g}\n\n${head}`;
    for (const id of ids[g]) {
      const first = sets.map((s) => s.results.find((r) => r.id === id)).find(Boolean);
      md += `| ${id} | ${esc(first.name)} | ${sets.map((s) => cell(s.results.find((r) => r.id === id))).join(' | ')} |\n`;
    }
  }
  return md;
}

function unitPart(units) {
  let md = '\n# Unit tests\n\nEach file runs on its own without Home Assistant: `node tests/<name>.test.js`.\n\n| File | What | Passed |\n|---|---|---|\n';
  const parsed = [];
  for (const [name, what] of UNIT) {
    const u = units.find((x) => x.name === name);
    if (!u) { md += `| ${name}.test.js | ${what} | not run |\n`; continue; }
    const checks = parseUnit(u);
    const p = checks.filter((c) => c.ok).length;
    md += `| [${name}.test.js](#${name}) | ${what} | ${p} of ${checks.length}${p === checks.length ? ' ✓' : ' ✗'} |\n`;
    parsed.push({ name, what, checks });
  }
  for (const { name, what, checks } of parsed) {
    const failed = checks.filter((c) => !c.ok);
    md += `\n## ${name}\n\n${what}.\n\n`;
    md += failed.length ? '<details open>' : '<details>';
    md += `<summary>${checks.length - failed.length} of ${checks.length} passed – show every check</summary>\n\n`;
    const grouped = checks.some((c) => c.group);
    md += grouped ? '| Part | Check | Result |\n|---|---|---|\n' : '| Check | Result |\n|---|---|\n';
    let last = null;
    for (const c of checks) {
      const part = c.group === last ? '' : esc(c.group);
      last = c.group;
      const res = `${mark(c)}${c.note ? ` ${esc(c.note)}` : ''}`;
      md += grouped ? `| ${part} | ${esc(c.name)} | ${res} |\n` : `| ${esc(c.name)} | ${res} |\n`;
    }
    md += '\n</details>\n';
  }
  return md;
}

function matrixPart(all) {
  let md = '\n# Matrix: every charger with every home battery\n\n';
  md += '`node tests/matrix.test.js` (several minutes; `SCP_CHARGERS=Easee,Zaptec` for a part). The real app against a fake Home Assistant with a Renault, one charger brand and, one after the other, every home battery brand from `tests/fixtures.js`. The fake charger reacts to exactly the start/stop command the app\'s control check chooses; `tests/brands.test.js` checks those commands per brand.\n\n';
  if (!all.length) return `${md}No results in this run.\n`;
  const chargerRows = all.filter((r) => /^\d+\.\d$/.test(r.id));
  const nums = [...new Set(chargerRows.map((r) => Number(r.id.split('.')[0])))].sort((a, b) => a - b);
  md += '## Per charger\n\n| Charger | Method | Charge now | Solar 6 kW | Solar 2.5 kW | Back to full power | Only own commands | Batteries |\n|---|---|---|---|---|---|---|---|\n';
  for (const n of nums) {
    const get = (k) => all.find((r) => r.id === `${n}.${k}`);
    const bs = all.filter((r) => r.id.startsWith(`${n}.B`));
    const name = (get(1) || chargerRows.find((r) => r.id.startsWith(`${n}.`))).group;
    const bp = bs.filter((r) => r.ok).length;
    md += `| ${esc(name)} | ${[1, 2, 3, 4, 5, 6].map((k) => cell(get(k), 140)).join(' | ')} | ${bp} of ${bs.length}${bp === bs.length ? ' ✓' : ' ✗'} |\n`;
  }
  const ref = nums[0];
  const bnums = [...new Set(all.filter((r) => new RegExp(`^${ref}\\.B\\d+\\.`).test(r.id)).map((r) => Number(r.id.split('.')[1].slice(1))))].sort((a, b) => a - b);
  const refName = (all.find((r) => r.id === `${ref}.1`) || {}).group || '';
  md += `\n## Per battery (the same with every charger; notes from the run with ${esc(refName)})\n\n`;
  md += 'Per battery: 1 found, 2 switching from the previous battery puts that one back in its own mode, 3 car charges → no discharging into it, 4 car stops → back to its own mode, 5 car starts charging by itself → no discharging into it, 6 only commands to this charger, the car\'s limit or this battery.\n\n';
  md += '| Battery | Can | Car charges | Car stops | Car charges by itself | All chargers |\n|---|---|---|---|---|---|\n';
  for (const k of bnums) {
    const e = (t) => all.find((r) => r.id === `${ref}.B${k}.${t}`);
    const every = all.filter((r) => new RegExp(`^\\d+\\.B${k}\\.`).test(r.id));
    const name = String((e(1) || {}).group || `Battery ${k}`).replace(/^.*? \+ /, '');
    const p = every.filter((r) => r.ok).length;
    md += `| ${esc(name)} | ${cell(e(1))} | ${cell(e(3))} | ${cell(e(4))} | ${cell(e(5))} | ${p} of ${every.length}${p === every.length ? ' ✓' : ' ✗'} |\n`;
  }
  md += '\nGoodWe and Marstek (Local API) cannot be told to stop discharging from Home Assistant: the app says so on Settings › Battery. The read-only brands are never sent anything.\n';
  const fails = all.filter((r) => !r.ok);
  if (fails.length) md += `\n## Failed\n\n${fails.map((r) => `- ${r.id} ${esc(r.group)}: ${esc(r.name)} – ${esc(r.note)}`).join('\n')}\n`;
  return md;
}

function write(dir) {
  const sets = files(dir, /^settings-.*\.json$/).map((f) => ({ file: path.basename(f), ...readJson(f) })).filter((s) => Array.isArray(s.results));
  // Renault + Easee first, as before.
  sets.sort((a, b) => (/renault/i.test(a.profile) ? -1 : /renault/i.test(b.profile) ? 1 : 0));
  const units = files(dir, /^unit-.*\.json$/).map(readJson).filter(Boolean);
  const matrix = files(dir, /^matrix-.*\.json$/).flatMap((f) => (readJson(f) || {}).results || []);
  const seen = new Set();
  const all = matrix.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));

  const { md: top, ver } = settingsPart(sets);
  let md = top;
  const unitChecks = units.flatMap(parseUnit);
  if (units.length) {
    const p = unitChecks.filter((c) => c.ok).length;
    md += `| Unit tests (${units.length} files) | ${p} of ${unitChecks.length}${p === unitChecks.length ? ' ✓' : ' ✗'} |\n`;
  }
  if (all.length) {
    const p = all.filter((r) => r.ok).length;
    const nCh = new Set(all.map((r) => r.id.split('.')[0])).size;
    md += `| Matrix (${nCh} chargers × all batteries) | ${p} of ${all.length}${p === all.length ? ' ✓' : ' ✗'} |\n`;
  }
  md += `\nVersion: ${ver}.\n`;
  md += settingsTables(sets);
  md += '\n## Not covered by these tests\n\n' + NOT_COVERED.map((l) => `- ${l}`).join('\n') + '\n';
  md += unitPart(units);
  md += matrixPart(all);
  fs.writeFileSync(PLAN, md);

  const total = sets.reduce((n, s) => n + s.results.length, 0) + unitChecks.length + all.length;
  const passed = sets.reduce((n, s) => n + s.results.filter((r) => r.ok).length, 0) + unitChecks.filter((c) => c.ok).length + all.filter((r) => r.ok).length;
  const summary = md.slice(md.indexOf('## Summary'), md.indexOf('\n# Settings'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(`TESTPLAN.md written: ${passed} of ${total} checks passed`);
  return total - passed;
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === 'unit' && dir) process.exit(runUnit(dir) ? 1 : 0);
  else if (cmd === 'write' && dir) { write(dir); process.exit(0); }
  else if (cmd === 'all') process.exit(runAll() ? 1 : 0);
  else {
    console.log('Use: node tests/testplan.js unit <dir> | write <dir> | all');
    process.exit(2);
  }
}

module.exports = { parseUnit, write, runUnit };

'use strict';

// The compatibility matrix (#28): what the app can do per integration, built
// from the test fixtures (tests/fixtures.js) and the physical test status
// (tests/physical.json). So the matrix only claims what a test checks.
//   node tests/compat.js         prints it
//   node tests/compat.js write   writes COMPATIBILITY.md
// tests/compat.test.js fails when COMPATIBILITY.md is not up to date.

const fs = require('fs');
const path = require('path');
const { CHARGERS, BATTERIES, CARS } = require('./fixtures');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'COMPATIBILITY.md');
const PHYSICAL = path.join(__dirname, 'physical.json');

const YES = 'yes';
const NO = '–';
const START_STOP = { switch: 'switch', buttons: 'buttons', select: 'select', service: 'action' };
const ACTION = { charge: 'grid charge', discharge: 'discharge', hold: 'hold', no_discharge: 'no discharge' };
const STATUS = { verified: 'verified', partly: 'partly', problem: 'problem' };

function physical() {
  try {
    return JSON.parse(fs.readFileSync(PHYSICAL, 'utf8'));
  } catch {
    return { chargers: {}, cars: {}, batteries: {} };
  }
}

// "verified (note)", or "not yet".
function phys(list, key) {
  const p = list && list[key];
  if (!p || !STATUS[p.status]) return 'not yet';
  return `${STATUS[p.status]}${p.note ? ` (${String(p.note).replace(/\|/g, '/')})` : ''}`;
}

const platformOf = (c) => (c.dev && c.dev.entities[0] ? c.dev.entities[0].platform : '?');
const row = (cells) => `| ${cells.join(' | ')} |`;

function chargers(ph) {
  const out = [
    row(['Charger', 'Integration', 'Status read', 'Start / stop', 'Current', 'Phase switching', 'Physical test']),
    row(['---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const c of CHARGERS) {
    const e = c.expect || {};
    const ro = c.readOnly === true;
    out.push(row([
      `${c.brand}${ro ? ' **(read only)**' : ''}`,
      `\`${platformOf(c)}\``,
      c.statuses ? YES : NO,
      ro ? NO : e.startStop ? START_STOP[e.startStop] || e.startStop : NO,
      ro ? NO : e.current ? YES : NO,
      ro ? NO : e.phase ? YES : NO,
      phys(ph.chargers, c.brand),
    ]));
  }
  return out.join('\n');
}

function cars(ph) {
  const out = [
    row(['Car integration', 'Integration', 'Battery level', 'Plugged in', 'Charging', 'AC charge limit', 'Entity names from', 'Physical test']),
    row(['---', '---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const c of CARS) {
    const e = c.expect || {};
    out.push(row([
      c.brand,
      `\`${c.platform}\``,
      e.soc ? YES : NO,
      e.plugged ? YES : NO,
      e.charging ? YES : NO,
      e.limit ? (e.writable ? 'read and write' : 'read only') : NO,
      c.source ? `\`${c.source}\`` : NO,
      phys(ph.cars, c.platform),
    ]));
  }
  return out.join('\n');
}

function batteries(ph) {
  const out = [
    row(['Home battery', 'Battery level', 'Steering', 'Notes', 'Physical test']),
    row(['---', '---', '---', '---', '---']),
  ];
  for (const b of BATTERIES) {
    const e = b.expect || {};
    const ro = e.readOnly === true;
    const acts = (e.actions || []).filter((a) => ACTION[a]).map((a) => ACTION[a]);
    out.push(row([
      `\`${b.platform}\`${ro ? ' **(read only)**' : ''}`,
      e.soc ? YES : NO,
      ro ? 'advice only' : acts.length ? acts.join(', ') : NO,
      String(b.note || '').replace(/\|/g, '/'),
      phys(ph.batteries, b.platform),
    ]));
  }
  return out.join('\n');
}

function build() {
  const ph = physical();
  return `# Compatibility

What Smart Charging Planner can do per integration. **This file is generated** from the test fixtures (\`tests/fixtures.js\`) and the physical test status (\`tests/physical.json\`) by \`node tests/compat.js write\`; a test fails when it is out of date. Do not edit it by hand.

## What the columns mean

- **yes**: the app finds and uses it, checked in the automated tests with the entity, option and action names of that integration (taken from its source code). These tests run against a fake Home Assistant; a separate check starts a real Home Assistant Core and the app against it.
- **–**: not available through that integration, or not supported by the app.
- **read only**: the app shows the data and gives advice, but never steers that device.
- **Physical test**: whether it was checked on real hardware. *not yet* means only the automated tests above. Fixture-tested is not the same as physically verified: firmware, cloud delays and car wake-up behaviour can differ.

Detected is not the same as controllable: check the suggested sensors and the control method during setup, and run the manual test in Settings › Diagnostics.

## Chargers

${chargers(ph)}

Start / stop: *switch* turns a switch on and off (Easee: the "Charger enabled" switch, never pause/resume), *buttons* presses start and stop buttons, *select* chooses a mode. Every charger is also tested with every home battery (\`tests/matrix.test.js\`).

## Cars

${cars(ph)}

The car's own charge limit is only changed when it can be written and "Don't change the car's charge limit" is off.

## Home batteries

${batteries(ph)}

Home battery steering needs both "Allow control" and "Allow home battery control", a fresh battery level and the needed stop and limit controls of that model; otherwise it stays advice only.

## Help test on real hardware

Did you use the app with one of these on real hardware? Report it with the issue form **Beta test report** (Issues › New issue). Leave out names, addresses and entity ids. The physical test column is updated from those reports.
`;
}

if (require.main === module) {
  const text = build();
  if (process.argv[2] === 'write') {
    fs.writeFileSync(FILE, text);
    console.log(`Written ${path.relative(ROOT, FILE)}`);
  } else {
    process.stdout.write(text);
  }
}

module.exports = { build, FILE };

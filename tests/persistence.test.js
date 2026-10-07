'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-persistence-'));
process.env.DATA_DIR = dir;

const boost = require('../smart_charging_planner/app/boost');
const cardata = require('../smart_charging_planner/app/cardata');
const chargefor = require('../smart_charging_planner/app/chargefor');
const mode = require('../smart_charging_planner/app/mode');

boost.start({ mode: 'soc', value: 70 }, 1000);
cardata.remember('sensor.car_soc', 42, 1000);
chargefor.set({ day: 'tomorrow', until: Date.now() + 3600000, soc: 80, min_soc: 30 }, 1000);
mode.set('solar');

const expected = {
  'boost.json': (v) => v.mode === 'soc' && v.value === 70,
  'cardata.json': (v) => v.entities['sensor.car_soc'].soc === 42,
  'chargefor.json': (v) => v.day === 'tomorrow' && v.soc === 80,
  'mode.json': (v) => v.mode === 'solar',
};
for (const [file, check] of Object.entries(expected)) {
  const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.ok(check(value), `unexpected ${file}: ${JSON.stringify(value)}`);
}
assert.deepStrictEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), [], 'temporary files left behind');
fs.rmSync(dir, { recursive: true, force: true });
console.log('Atomic persistence checks passed');

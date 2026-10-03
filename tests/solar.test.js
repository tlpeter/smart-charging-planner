'use strict';

// Solar test, brand by brand: inverters (solar power now), solar forecasts,
// the value of a kWh of own solar power and charging on surplus.
//
// Run: node tests/solar.test.js   (from the repository root)

process.env.DATA_DIR = process.env.DATA_DIR || require('os').tmpdir();
const assert = require('assert');
const path = require('path');
const app = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const solar = require(path.join(app, 'solar.js'));
const solarctl = require(path.join(app, 'solarctl.js'));

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

const W = { unit_of_measurement: 'W', device_class: 'power' };
const KW = { unit_of_measurement: 'kW', device_class: 'power' };

// Inverters: [entity_id, state, attributes]. "verified" = names from the
// integration's own source code; the others from documentation and examples.
const INVERTERS = [
  { brand: 'SolarEdge', platform: 'solaredge', verified: true, expect: ['sensor.solaredge_current_power', 'sensor.solaredge_solar_power'], list: [
    ['sensor.solaredge_current_power', '3200', W], ['sensor.solaredge_solar_power', '3200', W],
    ['sensor.solaredge_grid_power', '-1500', W], ['sensor.solaredge_power_consumption', '1700', W], ['sensor.solaredge_storage_power', '0', W],
  ] },
  { brand: 'Enphase', platform: 'enphase_envoy', verified: true, expect: ['sensor.envoy_122_current_power_production'], list: [
    ['sensor.envoy_122_current_power_production', '2.4', KW], ['sensor.envoy_122_current_power_consumption', '0.9', KW],
  ] },
  { brand: 'SMA', platform: 'sma', verified: true, expect: ['sensor.sn_3012345678_pv_power'], list: [
    ['sensor.sn_3012345678_pv_power', '4100', W], ['sensor.sn_3012345678_grid_power', '3900', W], ['sensor.sn_3012345678_metering_power_supplied', '2000', W],
  ] },
  { brand: 'Fronius', platform: 'fronius', verified: true, expect: ['sensor.solarnet_power_photovoltaics'], list: [
    ['sensor.solarnet_power_photovoltaics', '3600', W], ['sensor.solarnet_power_grid', '-1200', W], ['sensor.solarnet_power_load', '-2400', W], ['sensor.solarnet_power_battery', '0', W],
  ] },
  { brand: 'GoodWe', platform: 'goodwe', verified: true, expect: ['sensor.pv_power'], list: [
    ['sensor.pv_power', '3100', W], ['sensor.active_power', '-900', W], ['sensor.house_consumption', '2200', W], ['sensor.battery_power', '0', W],
  ] },
  { brand: 'Huawei', platform: 'huawei_solar', verified: false, expect: ['sensor.inverter_input_power'], list: [
    ['sensor.inverter_input_power', '3300', W], ['sensor.inverter_active_power', '3200', W], ['sensor.power_meter_active_power', '1400', W], ['sensor.battery_charge_discharge_power', '0', W],
  ] },
  { brand: 'Sigenergy', platform: 'sigen', verified: false, expect: ['sensor.sigen_plant_pv_power'], list: [
    ['sensor.sigen_plant_pv_power', '3.2', KW], ['sensor.sigen_plant_grid_active_power', '-1.1', KW], ['sensor.sigen_plant_battery_power', '0.5', KW],
  ] },
  { brand: 'APsystems', platform: 'apsystems', verified: false, expect: ['sensor.ez1_total_power'], list: [
    ['sensor.ez1_total_power', '600', W], ['sensor.ez1_power_of_p1', '300', W],
  ] },
];

for (const inv of INVERTERS) {
  console.log(`${inv.brand} (${inv.platform})${inv.verified ? '' : ' – names from documentation'}`);
  const entities = inv.list.map(([entity_id]) => ({ entity_id, platform: inv.platform, device_id: 'inv' }));
  const states = inv.list.map(([entity_id, state, a]) => ({ entity_id, state, attributes: { friendly_name: entity_id, ...a } }));
  const found = solar.detectPvSensors(entities, states);
  check(`solar power sensor: ${inv.expect.join(' or ')}`, () => assert.ok(found[0] && inv.expect.includes(found[0].entity_id), found.map((f) => f.entity_id).join(', ') || 'none'));
  check('not the grid, house or battery', () => assert.ok(!found.some((f) => /grid|consumption|load|battery|meter|storage/.test(f.entity_id)), found.map((f) => f.entity_id).join(', ')));
  if (found[0]) check('brand recognised, power in W', () => {
    assert.strictEqual(found[0].brand, inv.brand);
    assert.ok(found[0].power_w > 100, `${found[0].power_w}`);
  });
}

// Forecasts
console.log('Forecast.Solar / Solcast / Open-Meteo through the Energy dashboard');
{
  const ha = require(path.join(app, 'ha.js'));
  const orig = ha.call;
  ha.call = async (msg) => {
    assert.strictEqual(msg.type, 'energy/solar_forecast');
    return {
      forecast_solar_1: { wh_hours: { '2026-10-04T10:00:00+00:00': 1000, '2026-10-04T11:00:00+00:00': 1500 } },
      solcast_2: { wh_hours: { '2026-10-04T10:00:00+00:00': 500, '2026-10-04T10:30:00+00:00': 200 } },
    };
  };
  solar.energyForecast().then((r) => {
    check('two forecast integrations summed per hour', () => {
      assert.strictEqual(r.entries, 2);
      assert.strictEqual(r.hours.get(Date.parse('2026-10-04T10:00:00Z')), 1700);
      assert.strictEqual(r.hours.get(Date.parse('2026-10-04T11:00:00Z')), 1500);
    });
    ha.call = orig;
    rest();
  }).catch((err) => { failures++; console.log('  FAIL energy forecast -', err.message); rest(); });
}

function rest() {
  console.log('Solcast sensor (detailedHourly)');
  {
    const s = { entity_id: 'sensor.solcast_pv_forecast_forecast_tomorrow', state: '18.2', attributes: {
      detailedHourly: [
        { period_start: '2026-10-04T10:00:00+02:00', pv_estimate: 2.5, pv_estimate10: 1.2, pv_estimate90: 3.1 },
        { period_start: '2026-10-04T11:00:00+02:00', pv_estimate: 3.0 },
      ],
    } };
    const r = solar.sensorForecast(s);
    check('kW per hour read as Wh', () => assert.strictEqual(r.hours.get(Date.parse('2026-10-04T08:00:00Z')), 2500));
  }
  console.log('Open-Meteo Solar Forecast sensor (watts)');
  {
    const s = { entity_id: 'sensor.energy_production_tomorrow', state: '15', attributes: { watts: { '2026-10-04T12:00:00+02:00': 2800, '2026-10-04T12:15:00+02:00': 3000 } } };
    const r = solar.sensorForecast(s);
    check('watts per time read (highest in the hour)', () => assert.strictEqual(r.hours.get(Date.parse('2026-10-04T10:00:00Z')), 3000));
  }

  console.log('Value of a kWh of own solar power (no more salderen from 2027)');
  check('dynamic: market price excl. VAT minus feed-in costs', () => assert.ok(Math.abs(solar.feedInValue(0.08, 'market_excl_vat', { mode: 'market', fee: 0.02 }) - 0.06) < 1e-9));
  check('dynamic with 21 % VAT on the feed-in', () => assert.ok(Math.abs(solar.feedInValue(0.10, 'market_excl_vat', { mode: 'market', fee: 0.02, vat_percent: 21 }) - 0.101) < 1e-9));
  check('negative market price: exporting costs money', () => assert.ok(solar.feedInValue(-0.05, 'market_excl_vat', { mode: 'market', fee: 0.02 }) < 0));
  check('fixed amount', () => assert.strictEqual(solar.feedInValue(0.30, 'market_excl_vat', { mode: 'fixed', fixed: 0.07 }), 0.07));
  check('all-in price source: the fixed amount is used', () => assert.strictEqual(solar.feedInValue(0.30, 'all_in', { mode: 'market', fixed: 0.05, fee: 0.02 }), 0.05));

  console.log('Grid meter');
  const grid = { net_entity: 'sensor.p1' };
  const st = (v, u = 'W') => [{ entity_id: 'sensor.p1', state: String(v), attributes: { unit_of_measurement: u } }];
  check('import positive (P1, HomeWizard)', () => assert.strictEqual(solar.gridNetW(grid, st(-1500)), -1500));
  check('kW converted', () => assert.strictEqual(solar.gridNetW(grid, st(-1.5, 'kW')), -1500));
  check('export positive turned around', () => assert.strictEqual(solar.gridNetW(grid, st(1500), 'export_positive'), -1500));
  check('import and export sensors', () => assert.strictEqual(solar.gridNetW({ import_entity: 'sensor.i', export_entity: 'sensor.e' },
    [{ entity_id: 'sensor.i', state: '0', attributes: {} }, { entity_id: 'sensor.e', state: '2000', attributes: {} }]), -2000));

  console.log('Charging on surplus (3 phases, max 16 A, start and stop after 5 minutes)');
  const t0 = 0;
  const M = 60000;
  const base = { max_soc: 90, soc: 50, phases_now: 3, max_amps: 16, start_delay_ms: 5 * M, stop_delay_ms: 5 * M };
  let s0 = solarctl.initialState();
  const stepAt = (min, w, extra = {}) => { const r = solarctl.step(s0, { ...base, ...extra, now: t0 + min * M, available_w: w }); s0 = r.state; return r; };
  check('5 kW surplus: waits 5 minutes before starting', () => assert.strictEqual(stepAt(0, 5000).charge, false));
  check('then charges at 7 A on 3 phases', () => { const r = stepAt(5, 5000); assert.ok(r.charge && r.amps === 7 && r.phases === 3, JSON.stringify(r)); });
  check('a short cloud (1 kW): keeps going at 6 A', () => { const r = stepAt(6, 1000); assert.ok(r.charge && r.amps === 6, JSON.stringify(r)); });
  check('too little for 5 minutes: stops', () => { const r = stepAt(11, 1000); assert.ok(!r.charge, JSON.stringify(r)); });
  check('11 kW+ surplus: capped at 16 A', () => { stepAt(20, 12000); const r = stepAt(25, 12000); assert.ok(r.amps === 16, JSON.stringify(r)); });
  check('at "solar up to" (90 %): no solar charging', () => assert.strictEqual(stepAt(30, 12000, { soc: 90 }).charge, false));
  s0 = solarctl.initialState();
  check('with phase switching: 2.5 kW → one phase, 10 A', () => { stepAt(0, 2500, { can_switch_phases: true }); const r = stepAt(5, 2500, { can_switch_phases: true }); assert.ok(r.charge && r.phases === 1 && r.amps === 10, JSON.stringify(r)); });
  check('back to three phases only after 10 minutes', () => {
    assert.strictEqual(stepAt(6, 6000, { can_switch_phases: true }).phases, 1);
    assert.strictEqual(stepAt(16, 6000, { can_switch_phases: true }).phases, 3);
  });
  s0 = solarctl.initialState();
  check('without current control: only from the full 11 kW', () => {
    stepAt(0, 8000, { min_amps: 16 });
    assert.strictEqual(stepAt(5, 8000, { min_amps: 16 }).charge, false);
    stepAt(6, 11500, { min_amps: 16 });
    assert.strictEqual(stepAt(11, 11500, { min_amps: 16 }).charge, true);
  });
  check('no grid meter reading: nothing on solar', () => assert.strictEqual(solarctl.step(null, { ...base, now: 0, available_w: null }).charge, false));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

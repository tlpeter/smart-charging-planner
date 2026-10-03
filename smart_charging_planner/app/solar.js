'use strict';

// Solar: what the app needs to charge with your own solar power.
//
//   - Forecast: the solar forecast of Home Assistant's Energy dashboard
//     (energy/solar_forecast: Forecast.Solar, Solcast, Open-Meteo Solar
//     Forecast and others), or a sensor with an hourly list (Solcast).
//   - Surplus now: from the grid meter (Settings › Grid): what you export.
//   - Solar power now (optional, for display): the PV power sensor of the
//     inverter, found by brand.
//   - Value of a kWh of your own solar power: what you would get for exporting
//     it. The Netherlands stops "salderen" on 1 January 2027; after that an
//     exported kWh earns the feed-in compensation, not the purchase price.

const ha = require('./ha');

// ---------------------------------------------------------------------------
// Inverters (for showing the solar power now)
// ---------------------------------------------------------------------------

// Integrations of inverters and solar systems.
const INVERTER_DOMAINS = new Map([
  ['solaredge', 'SolarEdge'], ['solaredge_modbus', 'SolarEdge'], ['solaredge_modbus_multi', 'SolarEdge'],
  ['enphase_envoy', 'Enphase'], ['sma', 'SMA'], ['fronius', 'Fronius'], ['huawei_solar', 'Huawei'],
  ['growatt_server', 'Growatt'], ['goodwe', 'GoodWe'], ['solax', 'SolaX'], ['sungrow', 'Sungrow'],
  ['solis', 'Solis'], ['solis_cloud', 'Solis'], ['sigen', 'Sigenergy'], ['sigenergy', 'Sigenergy'],
  ['apsystems', 'APsystems'], ['foxess', 'FoxESS'], ['solarman', 'Deye / Solarman'], ['victron', 'Victron'],
  ['zonneplan_one', 'Zonneplan'], ['omnik_inverter', 'Omnik'], ['hoymiles_wifi', 'Hoymiles'],
]);

const PV_NAME = /\bpv\b|pv.?power|ppv|photovoltaic|solar.?power|power.?production|production|input.?power|current.?power/;
const NOT_PV = /grid|load|consum|battery|batt|meter|house|export|import|feed|charge|discharge|backup|reactive|apparent/;

function powerW(s) {
  const n = Number(s && s.state);
  if (!Number.isFinite(n)) return null;
  const u = (s.attributes && s.attributes.unit_of_measurement) || 'W';
  return u === 'kW' ? n * 1000 : u === 'MW' ? n * 1e6 : n;
}

// PV power sensors, best first. Known inverter integrations first.
function detectPvSensors(entities, states) {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const out = [];
  for (const e of entities) {
    if (!e.entity_id.startsWith('sensor.')) continue;
    const s = byId.get(e.entity_id);
    const a = (s && s.attributes) || {};
    if (a.device_class !== 'power' && !['W', 'kW'].includes(a.unit_of_measurement)) continue;
    const name = `${e.entity_id} ${a.friendly_name || ''}`.toLowerCase();
    const brand = INVERTER_DOMAINS.get(e.platform) || null;
    let score = 0;
    if (PV_NAME.test(name) && !NOT_PV.test(name)) score = 60;
    else if (brand && /total.?power|output.?power|ac.?power/.test(name) && !NOT_PV.test(name)) score = 40;
    if (!score) continue;
    if (brand) score += 30;
    if (/pv.?power|photovoltaic|ppv|production/.test(name)) score += 10;
    out.push({ entity_id: e.entity_id, name: a.friendly_name || e.entity_id, brand, platform: e.platform, power_w: powerW(s), score });
  }
  return out.sort((x, y) => y.score - x.score);
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

// Hourly forecast in Wh per hour start (ms), summed over all forecast
// integrations in the Energy dashboard.
async function energyForecast() {
  const r = await ha.call({ type: 'energy/solar_forecast' });
  const hours = new Map();
  let entries = 0;
  for (const entry of Object.values(r || {})) {
    if (!entry || !entry.wh_hours) continue;
    entries++;
    for (const [iso, wh] of Object.entries(entry.wh_hours)) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || !Number.isFinite(Number(wh))) continue;
      const h = Math.floor(t / 3600000) * 3600000;
      hours.set(h, (hours.get(h) || 0) + Number(wh));
    }
  }
  return { entries, hours };
}

// A sensor with a list of periods, e.g. Solcast "detailedHourly":
// [{ period_start, pv_estimate (kW) }]. Also accepts {time, value/watts}.
function sensorForecast(state) {
  const hours = new Map();
  const a = (state && state.attributes) || {};
  const lists = Object.values(a).filter((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
  for (const list of lists) {
    for (const x of list) {
      const t = Date.parse(x.period_start || x.time || x.start || x.datetime);
      let kw = Number(x.pv_estimate ?? x.estimate ?? x.kw);
      if (!Number.isFinite(kw) && Number.isFinite(Number(x.watts ?? x.value ?? x.w))) kw = Number(x.watts ?? x.value ?? x.w) / 1000;
      if (!Number.isFinite(t) || !Number.isFinite(kw)) continue;
      const h = Math.floor(t / 3600000) * 3600000;
      // Half-hour periods: average over the hour.
      const step = list.length > 1 ? Math.abs(Date.parse(list[1].period_start || list[1].time || list[1].start) - t) : 3600000;
      hours.set(h, (hours.get(h) || 0) + kw * 1000 * Math.min(1, (step || 3600000) / 3600000));
    }
    if (hours.size) break;
  }
  // Open-Meteo Solar Forecast: { "2026-10-04T12:00:00+02:00": watts } in "watts".
  if (!hours.size && a.watts && typeof a.watts === 'object') {
    for (const [iso, w] of Object.entries(a.watts)) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || !Number.isFinite(Number(w))) continue;
      const h = Math.floor(t / 3600000) * 3600000;
      hours.set(h, Math.max(hours.get(h) || 0, Number(w)));
    }
  }
  return { entries: hours.size ? 1 : 0, hours };
}

async function forecast(cfg, states) {
  if (!cfg || cfg.forecast === 'none') return { source: 'none', hours: new Map() };
  if (cfg.forecast === 'sensor') {
    const s = (states || []).find((x) => x.entity_id === cfg.forecast_entity);
    if (!s) throw new Error(`Forecast sensor ${cfg.forecast_entity} not found`);
    return { source: 'sensor', ...sensorForecast(s) };
  }
  return { source: 'energy', ...(await energyForecast()) };
}

// The Energy dashboard's solar set-up: which forecast integrations are in it.
async function energyPrefs() {
  try {
    const p = await ha.call({ type: 'energy/get_prefs' });
    const solar = (p && p.energy_sources || []).filter((x) => x.type === 'solar');
    return {
      solar_sources: solar.length,
      forecast_entries: [...new Set(solar.flatMap((x) => x.config_entry_solar_forecast || []))],
    };
  } catch (err) {
    return { solar_sources: 0, forecast_entries: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Surplus now
// ---------------------------------------------------------------------------

// Net grid power in W, positive = import. From Settings › Grid.
function gridNetW(grid, states, sign = 'import_positive') {
  if (!grid) return null;
  const get = (id) => powerW((states || []).find((x) => x.entity_id === id));
  let net = null;
  if (grid.net_entity) net = get(grid.net_entity);
  else if (grid.import_entity) {
    const imp = get(grid.import_entity);
    const exp = grid.export_entity ? get(grid.export_entity) : 0;
    if (imp != null) net = imp - (exp || 0);
  }
  if (net == null) return null;
  return sign === 'export_positive' && grid.net_entity ? -net : net;
}

// ---------------------------------------------------------------------------
// Value of a kWh of your own solar power
// ---------------------------------------------------------------------------

// What exporting a kWh would earn at this price block. `raw` is the source
// price per kWh (market price, or all-in), `priceType` how it was entered.
function feedInValue(raw, priceType, feedIn) {
  const f = feedIn || {};
  if (f.mode === 'fixed' || priceType === 'all_in' || !Number.isFinite(raw)) return Number(f.fixed) || 0;
  const vat = 1 + (f.vat_percent ? Number(f.vat_percent) / 100 : 0);
  const market = priceType === 'market_incl_vat' ? raw : raw * vat;
  return market - (Number(f.fee) || 0);
}

module.exports = {
  INVERTER_DOMAINS, detectPvSensors, powerW,
  forecast, energyForecast, sensorForecast, energyPrefs,
  gridNetW, feedInValue,
};

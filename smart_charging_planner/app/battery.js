'use strict';

// Home batteries: find them per brand, read them, and know how to steer them.
//
// The app uses five actions:
//   auto          the battery's own normal mode (self-consumption)
//   charge        charge from the grid (at a power, when the brand allows)
//   discharge     discharge to cover the house (at a power, when the brand allows)
//   hold          neither charge nor discharge
//   no_discharge  may charge from solar, never discharge (e.g. not into the car)
//
// Per brand only the actions that are verified in the integration's own
// source code are offered. Where a brand cannot do "no_discharge", "hold" is
// used instead. Entities are found by what they are (select options, names,
// units), not by exact entity ids, because those depend on the device name.

const BRANDS = {
  sigen: { name: 'Sigenergy', integration: 'Sigenergy Local Modbus (sigen)', power_sign: 'charge_positive' },
  huawei_solar: { name: 'Huawei LUNA2000', integration: 'Huawei Solar (huawei_solar)', power_sign: 'charge_positive', sign_verified: false },
  solaredge_modbus_multi: { name: 'SolarEdge', integration: 'SolarEdge Modbus Multi', power_sign: 'charge_positive' },
  victron: { name: 'Victron', integration: 'Victron (sfstar/hass-victron)', power_sign: 'charge_positive', sign_verified: false },
  goodwe: { name: 'GoodWe', integration: 'GoodWe (core)', power_sign: 'discharge_positive' },
  teslemetry: { name: 'Tesla Powerwall', integration: 'Teslemetry', power_sign: 'discharge_positive', sign_verified: false },
  tesla_fleet: { name: 'Tesla Powerwall', integration: 'Tesla Fleet', power_sign: 'discharge_positive', sign_verified: false },
  powerwall: { name: 'Tesla Powerwall', integration: 'Tesla Powerwall (local)', power_sign: 'discharge_positive', sign_verified: false },
  homewizard: { name: 'HomeWizard Plug-In Battery', integration: 'HomeWizard (core)', power_sign: 'charge_positive' },
  marstek_modbus: { name: 'Marstek Venus', integration: 'Marstek Venus Modbus', power_sign: 'charge_positive', sign_verified: false },
  marstek_local_api: { name: 'Marstek Venus', integration: 'Marstek Local API', power_sign: 'charge_positive' },
  sessy: { name: 'Sessy', integration: 'Sessy', power_sign: 'discharge_positive' },
  zonneplan_one: { name: 'Zonneplan Nexus', integration: 'Zonneplan ONE', power_sign: 'charge_positive', sign_verified: false },
  growatt_server: { name: 'Growatt', integration: 'Growatt (cloud)', power_sign: 'separate' },
  anker_solix: { name: 'Anker Solix', integration: 'Anker Solix', power_sign: 'charge_positive' },
  ecoflow_cloud: { name: 'EcoFlow', integration: 'EcoFlow Cloud', power_sign: 'charge_positive' },
};

// Why some brands can only be read.
const READ_ONLY_REASON = {
  zonneplan_one: 'Zonneplan steers the Nexus itself (dynamic charging); the integration offers no charge or discharge command.',
  growatt_server: 'Growatt cloud only offers time segments in %, not commands; not supported yet.',
  anker_solix: 'Anker Solix is steered with schedules and presets, not with charge or discharge commands; not supported yet.',
  ecoflow_cloud: 'EcoFlow offers no charge or discharge command in Home Assistant.',
  powerwall: 'The local Powerwall integration can only read the battery; use Teslemetry or Tesla Fleet to steer it.',
};

const lower = (x) => String(x || '').toLowerCase();
// Entity id and names in lower case, with _ and . as spaces (so \b works).
const nameOf = (e, s) => lower(`${e.entity_id} ${(s && s.attributes && s.attributes.friendly_name) || ''} ${e.original_name || ''} ${e.translation_key || ''}`).replace(/[_.]/g, ' ');
const optionsOf = (s) => ((s && s.attributes && Array.isArray(s.attributes.options)) ? s.attributes.options.map(String) : []);

// Find entities of the battery's integration.
function finder(entities, states) {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  return {
    // deviceId: prefer entities of that device (same battery), then any.
    find(domain, test, deviceId) {
      const list = deviceId ? [...entities.filter((e) => e.device_id === deviceId), ...entities.filter((e) => e.device_id !== deviceId)] : entities;
      for (const e of list) {
        if (!e.entity_id.startsWith(`${domain}.`)) continue;
        const s = byId.get(e.entity_id);
        if (test(nameOf(e, s), s, e)) return { entity_id: e.entity_id, state: s, entry: e };
      }
      return null;
    },
    state: (id) => byId.get(id),
  };
}

// ---------------------------------------------------------------------------
// Detection: one candidate per brand with its entities and possible actions
// ---------------------------------------------------------------------------

function sensors(f) {
  const soc = f.find('sensor', (n, s) => s && s.attributes && s.attributes.unit_of_measurement === '%' &&
    (/state.?of.?charge|statement.?of.?charge|state.?of.?capacity|state.?of.?energy|battery.?soc|\bsoc\b|percentage.?charged|battery.?level|\bpercentage\b|bpsoc/.test(n) || /^sensor \w+ charge\b/.test(n)) &&
    !/cut.?off|backup|reserve|limit|min|max|target|depth/.test(n));
  const dev = soc && soc.entry.device_id;
  const power = f.find('sensor', (n, s) => s && s.attributes && ['W', 'kW'].includes(s.attributes.unit_of_measurement) &&
    /battery.?power|ess.?power|charge.?discharge.?power|pbattery|bppwr|\bpower\b|dc.?power/.test(n) &&
    !/\bpv\b|\bsolar\b|\bgrid\b|\bload\b|\bhouse\b|inverter active|\bmax|limit|setpoint|target|\bmeter\b|inverted/.test(n), dev);
  const capacity = f.find('sensor', (n, s) => s && s.attributes && ['kWh', 'Wh'].includes(s.attributes.unit_of_measurement) &&
    /rated.?(energy.?)?capacity|maximum.?energy|battery.?capacity|total.?energy|design.?cap/.test(n), dev);
  return { soc, power, capacity };
}

// Each brand: how to find the controls, and the commands per action.
// A command: { service, data, target } (target.entity_id or target.device_id).
const ADAPTERS = {
  // Sigenergy: Remote EMS on + control mode; power limits in kW.
  sigen(f) {
    const ems = f.find('switch', (n) => /remote.?ems/.test(n));
    const mode = f.find('select', (n, s) => optionsOf(s).includes('Maximum Self Consumption') && optionsOf(s).includes('Standby'));
    const chg = f.find('number', (n) => /ess.?max.?charging.?limit|max(imum)?.?charging.?limit/.test(n) && !/discharg/.test(n));
    const dis = f.find('number', (n) => /ess.?max.?discharging.?limit|max(imum)?.?discharging.?limit/.test(n));
    if (!ems || !mode) return { missing: 'Remote EMS switch or control mode select (enable them in Home Assistant: they are disabled by default)' };
    const sel = (option) => ({ service: 'select.select_option', data: { option }, target: { entity_id: mode.entity_id } });
    const on = { service: 'switch.turn_on', data: {}, target: { entity_id: ems.entity_id } };
    const kw = (n, v) => (n ? [{ service: 'number.set_value', data: { value: Math.round(v * 1000) / 1000 }, target: { entity_id: n.entity_id } }] : []);
    return {
      entities: [ems, mode, chg, dis].filter(Boolean).map((x) => x.entity_id),
      actions: {
        auto: () => [{ service: 'switch.turn_off', data: {}, target: { entity_id: ems.entity_id } }],
        charge: (kwPower) => [on, ...kw(chg, kwPower), sel('Command Charging (Grid First)')],
        discharge: (kwPower) => [on, ...kw(dis, kwPower), sel('Command Discharging (ESS First)')],
        hold: () => [on, sel('Standby')],
      },
      power_unit: 'kW',
    };
  },

  // Huawei: forcible charge/discharge services on the "Batteries" device;
  // limits (W) for no-discharge and hold.
  huawei_solar(f, ctx) {
    const dev = ctx.deviceId;
    const maxChg = f.find('number', (n) => /maximum.?charging.?power/.test(n));
    const maxDis = f.find('number', (n) => /maximum.?discharging.?power/.test(n));
    const restore = (n) => (n ? [{ service: 'number.set_value', data: { value: Number(n.state && n.state.attributes && n.state.attributes.max) || 5000 }, target: { entity_id: n.entity_id } }] : []);
    const zero = (n) => (n ? [{ service: 'number.set_value', data: { value: 0 }, target: { entity_id: n.entity_id } }] : []);
    const svc = (name, data = {}) => ({ service: `huawei_solar.${name}`, data: { device_id: dev, ...data }, target: null });
    const actions = {
      auto: () => [svc('stop_forcible_charge'), ...restore(maxChg), ...restore(maxDis)],
      charge: (kwPower) => [...restore(maxChg), svc('forcible_charge', { power: Math.round(kwPower * 1000), duration: 60 })],
      discharge: (kwPower) => [...restore(maxDis), svc('forcible_discharge', { power: Math.round(kwPower * 1000), duration: 60 })],
    };
    if (maxDis) actions.no_discharge = () => [svc('stop_forcible_charge'), ...restore(maxChg), ...zero(maxDis)];
    if (maxDis && maxChg) actions.hold = () => [svc('stop_forcible_charge'), ...zero(maxChg), ...zero(maxDis)];
    return { entities: [maxChg, maxDis].filter(Boolean).map((x) => x.entity_id), services: ['huawei_solar.forcible_charge', 'huawei_solar.forcible_discharge', 'huawei_solar.stop_forcible_charge'], actions, power_unit: 'W', refresh_minutes: 30 };
  },

  // SolarEdge Modbus Multi: storage control mode "Remote Control" + command mode.
  solaredge_modbus_multi(f) {
    const ctl = f.find('select', (n, s) => optionsOf(s).includes('Remote Control') && optionsOf(s).includes('Maximize Self Consumption'));
    const cmd = f.find('select', (n, s) => optionsOf(s).includes('Charge from Solar Power and Grid') && /command/.test(n));
    const chg = f.find('number', (n) => /storage.?charge.?limit/.test(n));
    const dis = f.find('number', (n) => /storage.?discharge.?limit/.test(n));
    const timeout = f.find('number', (n) => /command.?timeout/.test(n));
    if (!ctl || !cmd) return { missing: 'Storage Control Mode and Storage Command Mode (turn on "advanced storage control" in the integration)' };
    const sel = (e, option) => ({ service: 'select.select_option', data: { option }, target: { entity_id: e.entity_id } });
    const num = (e, value) => (e ? [{ service: 'number.set_value', data: { value }, target: { entity_id: e.entity_id } }] : []);
    const remote = [sel(ctl, 'Remote Control'), ...num(timeout, 3600)];
    return {
      entities: [ctl, cmd, chg, dis, timeout].filter(Boolean).map((x) => x.entity_id),
      actions: {
        auto: () => [sel(ctl, 'Maximize Self Consumption')],
        charge: (kwPower) => [...remote, ...num(chg, Math.round(kwPower * 1000)), sel(cmd, 'Charge from Solar Power and Grid')],
        discharge: (kwPower) => [...remote, ...num(dis, Math.round(kwPower * 1000)), sel(cmd, 'Discharge to Minimize Import')],
        hold: () => [...remote, sel(cmd, 'Solar Power Only (Off)')],
        no_discharge: () => [...remote, sel(cmd, 'Charge from Solar Power')],
      },
      power_unit: 'W',
      refresh_minutes: 30,
    };
  },

  // Victron (sfstar): ESS mode select; max discharge power (W) for no-discharge.
  victron(f) {
    const mode = f.find('select', (n, s) => optionsOf(s).includes('KEEP_CHARGED') && optionsOf(s).includes('SELF_CONSUMPTION_WITH_BATTERY_LIFE'));
    const maxDis = f.find('number', (n) => /ess.?maxdischargepower|max.?discharge.?power/.test(n));
    if (!mode) return { missing: 'ESS mode select (turn on the advanced options of the integration)' };
    const sel = (option) => ({ service: 'select.select_option', data: { option }, target: { entity_id: mode.entity_id } });
    const actions = {
      auto: () => [sel('SELF_CONSUMPTION_WITH_BATTERY_LIFE'), ...(maxDis ? [{ service: 'number.set_value', data: { value: Number(maxDis.state && maxDis.state.attributes && maxDis.state.attributes.max) || 10000 }, target: { entity_id: maxDis.entity_id } }] : [])],
      charge: () => [sel('KEEP_CHARGED')],
    };
    if (maxDis) actions.no_discharge = () => [sel('SELF_CONSUMPTION_WITH_BATTERY_LIFE'), { service: 'number.set_value', data: { value: 0 }, target: { entity_id: maxDis.entity_id } }];
    return { entities: [mode, maxDis].filter(Boolean).map((x) => x.entity_id), actions, power_unit: null };
  },

  // GoodWe (core): operation mode select; eco charge/discharge at full power.
  goodwe(f) {
    const mode = f.find('select', (n, s) => optionsOf(s).includes('general') && optionsOf(s).includes('eco_charge'));
    if (!mode) return { missing: 'Inverter operation mode select' };
    const sel = (option) => [{ service: 'select.select_option', data: { option }, target: { entity_id: mode.entity_id } }];
    const actions = { auto: () => sel('general'), charge: () => sel('eco_charge') };
    if (optionsOf(mode.state).includes('eco_discharge')) actions.discharge = () => sel('eco_discharge');
    return { entities: [mode.entity_id], actions, power_unit: null, note: 'GoodWe charges and discharges at full power (the integration has no power setting).' };
  },

  // Tesla (Teslemetry / Tesla Fleet): operation mode + backup reserve.
  teslemetry(f, ctx) {
    const mode = f.find('select', (n, s) => optionsOf(s).includes('self_consumption') && optionsOf(s).includes('autonomous'));
    const reserve = f.find('number', (n) => /backup.?reserve/.test(n));
    if (!mode || !reserve) return { missing: 'Operation mode and backup reserve' };
    const setReserve = (v) => ({ service: 'number.set_value', data: { value: v }, target: { entity_id: reserve.entity_id } });
    const original = ctx.saved && Number.isFinite(ctx.saved.reserve) ? ctx.saved.reserve : Number(reserve.state && reserve.state.state) || 20;
    return {
      entities: [mode.entity_id, reserve.entity_id],
      actions: {
        auto: () => [setReserve(original)],
        // Reserve at the current level: the Powerwall does not go lower.
        no_discharge: (_, soc) => [{ service: 'select.select_option', data: { option: 'self_consumption' }, target: { entity_id: mode.entity_id } }, setReserve(Math.min(100, Math.ceil(Number(soc) || 100)))],
      },
      remember: { reserve: Number(reserve.state && reserve.state.state) },
      power_unit: null,
      note: 'Tesla can only be kept from discharging (backup reserve at the current level); forced charging is not possible in Home Assistant.',
    };
  },

  // HomeWizard Plug-In Battery: battery group mode on the P1 meter.
  homewizard(f) {
    const mode = f.find('select', (n, s) => optionsOf(s).includes('zero') && optionsOf(s).includes('standby') && optionsOf(s).includes('to_full'));
    if (!mode) return { missing: 'Battery group charging strategy (on the P1 meter)' };
    const opts = optionsOf(mode.state);
    const sel = (option) => [{ service: 'select.select_option', data: { option }, target: { entity_id: mode.entity_id } }];
    const actions = { auto: () => sel('zero'), charge: () => sel('to_full'), hold: () => sel('standby') };
    if (opts.includes('zero_charge_only')) actions.no_discharge = () => sel('zero_charge_only');
    return { entities: [mode.entity_id], actions, power_unit: null, note: 'HomeWizard charges to full at its own power; discharging is done by "net zero" (auto).' };
  },

  // Marstek Venus (Modbus): RS485 control + force mode + power in W.
  marstek_modbus(f) {
    const rs = f.find('switch', (n) => /rs485/.test(n));
    const force = f.find('select', (n, s) => optionsOf(s).includes('standby') && optionsOf(s).includes('charge') && optionsOf(s).includes('discharge'));
    const chg = f.find('number', (n) => /set.?charge.?power/.test(n));
    const dis = f.find('number', (n) => /set.?discharge.?power/.test(n));
    if (!rs || !force) return { missing: 'RS485 control mode switch and force mode select' };
    const on = { service: 'switch.turn_on', data: {}, target: { entity_id: rs.entity_id } };
    const sel = (option) => ({ service: 'select.select_option', data: { option }, target: { entity_id: force.entity_id } });
    const num = (e, w) => (e ? [{ service: 'number.set_value', data: { value: Math.min(2500, Math.round(w / 50) * 50) }, target: { entity_id: e.entity_id } }] : []);
    return {
      entities: [rs, force, chg, dis].filter(Boolean).map((x) => x.entity_id),
      actions: {
        auto: () => [{ service: 'switch.turn_off', data: {}, target: { entity_id: rs.entity_id } }],
        charge: (kwPower) => [on, ...num(chg, kwPower * 1000), sel('charge')],
        discharge: (kwPower) => [on, ...num(dis, kwPower * 1000), sel('discharge')],
        hold: () => [on, sel('standby')],
      },
      power_unit: 'W',
    };
  },

  // Marstek Venus (local API): passive mode with power (negative = charge).
  marstek_local_api(f, ctx) {
    const autoBtn = f.find('button', (n) => /auto.?mode|\bauto\b/.test(n));
    const svc = (power) => ({ service: 'marstek_local_api.set_passive_mode', data: { device_id: ctx.deviceId, power, duration: 3600 }, target: null });
    const actions = {
      charge: (kwPower) => [svc(-Math.round(kwPower * 1000))],
      discharge: (kwPower) => [svc(Math.round(kwPower * 1000))],
    };
    if (autoBtn) actions.auto = () => [{ service: 'button.press', data: {}, target: { entity_id: autoBtn.entity_id } }];
    else return { missing: 'Auto mode button' };
    return { entities: [autoBtn.entity_id], services: ['marstek_local_api.set_passive_mode'], actions, power_unit: 'W', refresh_minutes: 30 };
  },

  // Sessy: power strategy select; idle for hold.
  sessy(f, ctx) {
    const strat = f.find('select', (n, s) => optionsOf(s).includes('idle') && optionsOf(s).includes('nom'));
    if (!strat) return { missing: 'Power Strategy select' };
    const original = ctx.saved && ctx.saved.strategy && ctx.saved.strategy !== 'idle' ? ctx.saved.strategy : (strat.state && strat.state.state !== 'idle' ? strat.state.state : 'nom');
    const sel = (option) => [{ service: 'select.select_option', data: { option }, target: { entity_id: strat.entity_id } }];
    return {
      entities: [strat.entity_id],
      actions: { auto: () => sel(original), hold: () => sel('idle') },
      remember: { strategy: strat.state && strat.state.state },
      power_unit: null,
      note: 'Sessy: only "idle" (hold) is used. Charging and discharging with a setpoint is not verified (the sign of the setpoint is not documented in the code).',
    };
  },
};
ADAPTERS.tesla_fleet = ADAPTERS.teslemetry;

// All battery candidates found in Home Assistant.
function detectBatteries(entities, devices, states) {
  const out = [];
  const byPlatform = new Map();
  for (const e of entities) {
    if (!BRANDS[e.platform]) continue;
    if (!byPlatform.has(e.platform)) byPlatform.set(e.platform, []);
    byPlatform.get(e.platform).push(e);
  }
  for (const [platform, ents] of byPlatform) {
    const f = finder(ents, states);
    const s = sensors(f);
    if (!s.soc) continue; // no battery level: not a battery (e.g. HomeWizard without battery)
    const deviceId = s.soc.entry.device_id || null;
    const dev = devices.find((d) => d.id === deviceId);
    out.push({
      platform,
      brand: BRANDS[platform].name,
      integration: BRANDS[platform].integration,
      device_id: deviceId,
      name: (dev && (dev.name_by_user || dev.name)) || BRANDS[platform].name,
      soc_entity: s.soc.entity_id,
      power_entity: s.power ? s.power.entity_id : null,
      capacity_entity: s.capacity ? s.capacity.entity_id : null,
      power_sign: BRANDS[platform].power_sign,
      sign_verified: BRANDS[platform].sign_verified !== false,
    });
  }
  return out;
}

// What the app can do with this battery: actions and their commands.
function controlFor(battery, entities, states, saved = null) {
  const platform = battery && battery.platform;
  if (!platform || !BRANDS[platform]) return { available: false, reason: 'unknown' };
  if (READ_ONLY_REASON[platform] || !ADAPTERS[platform]) return { available: false, reason: 'read_only', note: READ_ONLY_REASON[platform] || 'Not supported yet.' };
  // Controls can sit on another device of the same integration (inverter, P1 meter).
  const ents = entities.filter((e) => e.platform === platform);
  const a = ADAPTERS[platform](finder(ents, states), { deviceId: battery.device_id, saved });
  if (a.missing) return { available: false, reason: 'missing', note: `Not found: ${a.missing}.` };
  return { available: true, ...a, supported: Object.keys(a.actions) };
}

// The commands for an action; "no_discharge" falls back to "hold".
function commandsFor(control, action, kwPower, soc) {
  if (!control || !control.available) return null;
  let act = action;
  if (act === 'no_discharge' && !control.actions.no_discharge) act = control.actions.hold ? 'hold' : null;
  if (act === 'hold' && !control.actions.hold) act = control.actions.no_discharge ? 'no_discharge' : null;
  if (!act || !control.actions[act]) return null;
  return { action: act, commands: control.actions[act](kwPower, soc) };
}

// Only these exact entities and services may be sent for this battery.
function allowedFor(control) {
  if (!control || !control.available) return [];
  const out = [];
  for (const id of control.entities || []) {
    const d = id.split('.')[0];
    const svc = { switch: ['turn_on', 'turn_off'], select: ['select_option'], number: ['set_value'], button: ['press'] }[d] || [];
    for (const s of svc) out.push({ service: `${d}.${s}`, entity_id: id });
  }
  for (const s of control.services || []) out.push({ service: s });
  return out;
}

// Battery power in kW, positive = charging.
function powerKw(battery, states) {
  const s = (states || []).find((x) => x.entity_id === battery.power_entity);
  const n = Number(s && s.state);
  if (!Number.isFinite(n)) return null;
  const unit = (s.attributes && s.attributes.unit_of_measurement) || 'W';
  const kw = unit === 'kW' ? n : n / 1000;
  return battery.power_sign === 'discharge_positive' ? -kw : kw;
}

module.exports = { BRANDS, READ_ONLY_REASON, ADAPTERS, detectBatteries, controlFor, commandsFor, allowedFor, powerKw };

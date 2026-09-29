'use strict';

// Control dry run: at every refresh, decide what the app WOULD do with the
// charger and log it. Nothing is ever sent from here.
//
// Decision order (first match wins):
//   1. car not plugged in                         -> nothing to do
//   2. charger status invalid for a short while   -> leave as it is
//      ... and for longer than the grace period   -> pause
//   3. battery below the minimum (and price ok)   -> charge
//   4. preconditioning active                     -> charge
//   5. battery at the target                      -> pause
//   6. within the force window before departure   -> charge
//   7. inside a locked (already started) block    -> keep charging
//   8. inside a planned block                     -> charge (and lock it)
//   9. already charging and price close enough    -> keep charging (hysteresis)
//  10. otherwise                                  -> pause

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const LOG_FILE = path.join(DATA_DIR, 'control_log.json');
const STATE_FILE = path.join(DATA_DIR, 'control_state.json');
const KEEP = 500;
const VOLTAGE = 230;
const MIN_CURRENT = 6;
const GRACE_MS = 120000;

const UNPLUGGED = /disconnected|not_connected|unplugged|^available$|idle|standby/;
const CHARGING = /^charging$|^charge$|in_progress|^on$/;
const INVALID = new Set(['unknown', 'unavailable', '', 'none', 'error', 'offline']);

const DEFAULT_RULES = {
  start_stop_id: null, // null = recommended by the control check
  current_id: null,
  min_soc_enabled: false,
  min_soc: 20,
  min_soc_entity: null, // e.g. the car's own minimum charge level
  min_soc_max_price: null, // null = any price
  preheat_entity: null,
  force_minutes: 0,
  hysteresis: 0.03,
};

let log = null;
let state = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function loadLog() {
  if (!log) log = readJson(LOG_FILE, []);
  return log;
}

function loadState() {
  if (!state) state = readJson(STATE_FILE, { lock: null });
  return state;
}

function findState(states, id) {
  return id ? states.find((x) => x.entity_id === id) || null : null;
}

// Plugged in? Charging? Is the charger status valid?
function readActual({ vehicle, charger, states, now = Date.now() }) {
  const plug = vehicle && vehicle.plugged_entity ? findState(states, vehicle.plugged_entity) : null;
  const statusObj = charger && charger.status_entity ? findState(states, charger.status_entity) : null;
  const status = statusObj ? String(statusObj.state) : null;
  const powerObj = charger && charger.power_entity ? findState(states, charger.power_entity) : null;
  let powerW = null;
  if (powerObj && Number.isFinite(Number(powerObj.state))) {
    const unit = (powerObj.attributes && powerObj.attributes.unit_of_measurement) || 'W';
    powerW = Number(powerObj.state) * (unit === 'kW' ? 1000 : 1);
  }

  const statusInvalid = !!charger && !!charger.status_entity && (status == null || INVALID.has(status.toLowerCase()));
  const invalidFor = statusInvalid && statusObj && statusObj.last_changed ? now - Date.parse(statusObj.last_changed) : statusInvalid ? Infinity : 0;

  let plugged = null;
  if (plug && (plug.state === 'on' || plug.state === 'off')) plugged = plug.state === 'on';
  else if (status && !statusInvalid) plugged = !UNPLUGGED.test(status.toLowerCase());

  let charging = null;
  if (status && CHARGING.test(status.toLowerCase())) charging = true;
  else if (powerW != null) charging = powerW > 500;
  else if (status && !statusInvalid) charging = false;

  return { plugged, charging, status, power_w: powerW, status_invalid: statusInvalid, invalid_for: invalidFor };
}

function ampsFor(powerKw, phases, maxAmps) {
  const a = powerKw ? Math.floor((powerKw * 1000) / (VOLTAGE * (phases || 3))) : maxAmps;
  return Math.max(MIN_CURRENT, Math.min(maxAmps || a || 16, a || 16));
}

// What the app would want right now.
function decide(ctx) {
  const { plan, actual, rules, now, phases, states } = ctx;
  const p = plan && plan.plan;
  const maxAmps = (plan && plan.charger && plan.charger.max_current) || 16;
  const lock = ctx.lock && ctx.lock.end > now ? ctx.lock : null;
  const priceNow = plan && plan.prices ? (plan.prices.find((x) => x.start <= now && now < x.end) || {}).total : undefined;
  const soc = plan && plan.vehicle ? plan.vehicle.soc : null;
  const target = plan && plan.planning ? plan.planning.target_soc : null;
  const departure = plan && plan.departure ? plan.departure.time : null;
  const charge = (reason, code, extra = {}) => ({ want: 'charge', amps: extra.amps || maxAmps, reason, code, ...extra });
  const pause = (reason, code, extra = {}) => ({ want: 'pause', reason, code, ...extra });

  // 1. Not plugged in (a plugged-in sensor that says "off" is trusted first).
  if (actual.plugged === false) return { want: 'none', reason: 'Car is not plugged in', code: 'unplugged', clear_lock: true };
  if (actual.status_invalid) {
    // 2. Status briefly invalid (restart, hiccup): keep things as they are.
    if (actual.invalid_for <= GRACE_MS) return { want: 'leave', reason: 'Charger status briefly invalid, waiting', code: 'status_grace', keep_lock: true };
    return pause('Charger status invalid for more than 2 minutes', 'status_invalid');
  }
  if (actual.plugged == null) return { want: 'none', reason: 'Cannot tell whether the car is plugged in', code: 'unknown_plug' };
  if (!p) return { want: 'leave', reason: 'No plan yet', code: 'no_plan' };

  // 3. Below the minimum battery level.
  if (rules.min_soc_enabled && Number.isFinite(soc)) {
    let min = Number(rules.min_soc);
    const ent = findState(states, rules.min_soc_entity);
    if (ent && Number.isFinite(Number(ent.state))) min = Number(ent.state);
    const priceOk = rules.min_soc_max_price == null || rules.min_soc_max_price === '' ||
      (Number.isFinite(priceNow) && priceNow <= Number(rules.min_soc_max_price));
    if (soc < min && priceOk) return charge(`Battery ${soc}% is below the minimum ${min}%`, 'below_minimum');
  }

  // 4. Preconditioning: keep the charger on so the car uses grid power.
  const pre = findState(states, rules.preheat_entity);
  if (pre && pre.state === 'on') return charge('Preconditioning is active', 'preheat');

  // Charge now, started by the user: charge until its goal is reached.
  if (plan.boost && plan.boost.active) {
    const blk = p.blocks.find((x) => x.start <= now && now < x.end);
    return charge('Charge now, started by you', 'boost', { amps: blk ? ampsFor(blk.power_kw, phases, maxAmps) : maxAmps, clear_lock: true });
  }

  // 5. At the target.
  if (p.notes.includes('already_at_target') || (Number.isFinite(soc) && Number.isFinite(target) && soc >= target)) {
    return pause('Battery is at the target', 'at_target', { clear_lock: true });
  }
  if (p.notes.includes('missing_data')) return { want: 'leave', reason: 'Plan is missing data (battery level or capacity)', code: 'missing_data' };

  // 6. Force window just before the departure.
  const force = Number(rules.force_minutes) || 0;
  if (force > 0 && departure && departure > now && departure - now <= force * 60000) {
    return charge(`Less than ${force} minutes to departure`, 'force_window');
  }

  // 7. Locked block: once a planned period has started, finish it even if a
  // new calculation would move it.
  if (lock) return charge('Finishing the planned period that already started', 'locked_block', { amps: lock.amps || maxAmps, block_end: lock.end });

  // 8. Inside a planned block: charge, and lock the whole period.
  const block = p.blocks.find((b) => b.start <= now && now < b.end);
  if (block) {
    const period = (p.periods || []).find((x) => x.start <= now && now < x.end) || { start: block.start, end: block.end };
    const amps = ampsFor(block.power_kw, phases, maxAmps);
    return charge('Planned charging block', 'planned', { amps, block_end: period.end, new_lock: { start: period.start, end: period.end, amps } });
  }

  // 9. Hysteresis: already charging and the price is close to the planned ones.
  const hyst = Number(rules.hysteresis) || 0;
  if (actual.charging === true && hyst > 0 && Number.isFinite(priceNow) && p.blocks.length) {
    const maxPlanned = Math.max(...p.blocks.map((b) => b.price));
    if (priceNow <= maxPlanned + hyst) return charge(`Already charging and the price is within ${hyst.toFixed(2)} of the planned price`, 'hysteresis');
  }

  const next = p.blocks.find((b) => b.start > now);
  return pause(next ? 'Not a planned block' : 'No more charging planned before the departure', 'not_planned', { next_start: next ? next.start : null });
}

// The commands the app would send for a decision, with the chosen methods.
function commandsFor(decision, actual, methods, deviceId) {
  if (!methods) return [];
  const out = [];
  const ss = methods.start_stop;
  const cur = methods.current;
  const describe = (m, on) => {
    if (!m) return null;
    const dev = deviceId ? { device_id: deviceId } : null;
    switch (m.type) {
      case 'action_choice': return { service: `${m.domain}.${m.service}`, data: { [m.field]: on ? m.start_value : m.stop_value }, target: dev };
      case 'action_pair': return { service: `${m.domain}.${on ? m.start_service : m.stop_service}`, data: {}, target: dev };
      case 'buttons': return { service: 'button.press', data: {}, target: { entity_id: on ? m.start_entity : m.stop_entity } };
      case 'switch': return { service: `switch.turn_${on ? 'on' : 'off'}`, data: {}, target: { entity_id: m.entity_id } };
      default: return null;
    }
  };
  if (decision.want === 'charge') {
    if (cur && decision.amps) {
      if (cur.type === 'number') out.push({ what: `set current to ${decision.amps} A`, service: 'number.set_value', data: { value: decision.amps }, target: { entity_id: cur.entity_id } });
      else if (cur.type === 'action_current') out.push({ what: `set current to ${decision.amps} A`, service: `${cur.domain}.${cur.service}`, data: { [cur.field]: decision.amps, ...(cur.ttl_field ? { [cur.ttl_field]: 30 } : {}) }, target: deviceId ? { device_id: deviceId } : null });
    }
    if (actual.charging !== true) {
      const c = describe(ss, true);
      if (c) out.push({ what: 'start charging', ...c });
    }
  } else if (decision.want === 'pause' && actual.charging !== false) {
    const c = describe(ss, false);
    if (c) out.push({ what: 'pause charging', ...c });
  }
  return out;
}

// One dry-run step. Logs only when something changes.
function dryRun({ plan, vehicle, charger, states, methods, deviceId, rules, now = Date.now(), controlAllowed }) {
  const r = { ...DEFAULT_RULES, ...(rules || {}) };
  const st = loadState();
  const actual = readActual({ vehicle, charger, states, now });
  const decision = decide({ plan, actual, rules: r, now, phases: charger ? charger.phases : 3, states, lock: st.lock });

  // Keep the lock up to date.
  let lock = st.lock && st.lock.end > now ? st.lock : null;
  if (decision.clear_lock) lock = null;
  if (decision.new_lock) lock = decision.new_lock;
  if (JSON.stringify(lock) !== JSON.stringify(st.lock)) {
    st.lock = lock;
    writeJson(STATE_FILE, st);
  }

  const commands = commandsFor(decision, actual, methods, deviceId);
  const agrees = decision.want === 'charge' ? actual.charging === true
    : decision.want === 'pause' ? actual.charging !== true
      : true;
  const entry = {
    time: now,
    plugged: actual.plugged,
    charging: actual.charging,
    status: actual.status,
    power_w: actual.power_w,
    want: decision.want,
    code: decision.code,
    amps: decision.amps || null,
    reason: decision.reason,
    next_start: decision.next_start || null,
    block_end: decision.block_end || null,
    locked_until: lock ? lock.end : null,
    commands: commands.map((c) => ({ what: c.what, service: c.service, data: c.data, target: c.target })),
    agrees,
    sent: false, // dry run: never sent
    control_allowed: !!controlAllowed,
  };
  const entries = loadLog();
  const last = entries[entries.length - 1];
  const key = (e) => JSON.stringify([e.plugged, e.charging, e.want, e.code, e.amps, e.commands.map((c) => c.what)]);
  if (!last || key(last) !== key(entry)) {
    entries.push(entry);
    log = entries.slice(-KEEP);
    writeJson(LOG_FILE, log);
  }
  return entry;
}

function recentLog(limit = 100) {
  return loadLog().slice(-limit).reverse();
}

function clearLock() {
  const st = loadState();
  st.lock = null;
  writeJson(STATE_FILE, st);
}

module.exports = { dryRun, recentLog, readActual, decide, commandsFor, clearLock, DEFAULT_RULES };

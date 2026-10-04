'use strict';

// Control: at every refresh, decide what the app wants the charger to do and
// log it. Nothing is sent from here: when "Allow control" is on, the server
// sends the start/stop command through ha.sendControl().
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

// Charger status texts of the common integrations (lower case):
//   Easee: disconnected, awaiting_start, charging, completed, ready_to_charge
//   Zaptec: disconnected, connected_requesting, connected_charging, connected_finished
//   Alfen: Available, Cable connected, Charging Normal, Suspended…, Finish Wait…
//   Wallbox: Charging, Paused, Ready, Disconnected, Waiting for car demand
//   go-e: Idle, Charging, Wait for car, Complete / "Charger ready, no vehicle"
//   Peblar: charging, suspended, no_ev_connected
//   OCPP: Available, Preparing, Charging, SuspendedEV, SuspendedEVSE, Finishing
//   Ohme: unplugged, plugged_in, charging, paused, finished
const UNPLUGGED = /disconnected|not_connected|no_ev_connected|no vehicle|unplugged|^available$|^ready$|^idle$|standby/;
const CHARGING = /^charging|connected_charging|^charge$|in_progress|^on$/;
const NOT_CHARGING = /finish|complete|wait|pause|suspend|requesting/;
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
  car_limit_off: false, // true: never change the car's own charge limit
  min_choice: 30, // default minimum (%) for the quick choices on Home
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
  if (status && CHARGING.test(status.toLowerCase()) && !NOT_CHARGING.test(status.toLowerCase())) charging = true;
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
  // The live state counts, not the (possibly older) plan: Charge now
  // overrules the plan, the target and the departure.
  if (ctx.boostActive === true || (ctx.boostActive === undefined && plan.boost && plan.boost.active)) {
    const blk = p.blocks.find((x) => x.start <= now && now < x.end);
    return charge('Charge now, started by you', 'boost', { amps: blk ? ampsFor(blk.power_kw, phases, maxAmps) : maxAmps, clear_lock: true });
  }

  // Solar: charge on surplus (live, ctx.solar from solarctl). In "plan and
  // solar" a planned block with grid power goes first (full power); in
  // "solar only" nothing is charged from the grid by the plan.
  const sol = ctx.solar;
  const solarOnlyBlock = (b) => b.solar_kwh > 0.001 && !(b.grid_kwh > 0.01);
  const gridBlockNow = p.blocks.find((b) => b.start <= now && now < b.end && !b.forecast && !solarOnlyBlock(b));
  if (sol && (sol.mode === 'plan_solar' || sol.mode === 'solar')) {
    if (sol.charge && !(sol.mode === 'plan_solar' && gridBlockNow)) {
      return charge(sol.reason, 'solar', { amps: sol.amps, phases: sol.phases, solar: true });
    }
    if (sol.mode === 'solar') return pause(sol.reason || 'Waiting for solar surplus', 'solar_wait', { clear_lock: true });
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

  // 8. Inside a planned block: charge, and lock the whole period. Never on a
  // forecast price: by then the real price should be known.
  const block = p.blocks.find((b) => b.start <= now && now < b.end && !b.forecast && !solarOnlyBlock(b));
  if (block) {
    const period = (p.periods || []).find((x) => x.start <= now && now < x.end) || { start: block.start, end: block.end };
    const amps = ampsFor(block.power_kw, phases, maxAmps);
    return charge('Planned charging block', 'planned', { amps, block_end: period.end, new_lock: { start: period.start, end: period.end, amps } });
  }

  // 9. Hysteresis: already charging and the price is close to the planned ones.
  const hyst = Number(rules.hysteresis) || 0;
  // Only to keep a planned session going, not after charging on solar.
  const keepGoing = !ctx.prevCode || ['planned', 'locked_block', 'hysteresis', 'force_window'].includes(ctx.prevCode);
  if (actual.charging === true && hyst > 0 && keepGoing && Number.isFinite(priceNow) && p.blocks.length) {
    const maxPlanned = Math.max(...p.blocks.map((b) => b.price));
    if (priceNow <= maxPlanned + hyst) return charge(`Already charging and the price is within ${hyst.toFixed(2)} of the planned price`, 'hysteresis');
  }

  const next = p.blocks.find((b) => b.start > now);
  return pause(next ? 'Not a planned block' : 'No more charging planned before the departure', 'not_planned', { next_start: next ? next.start : null });
}

// The start or stop command for a start/stop method.
// An integration action for the charger's device: the device as a text field
// in the data when the action has a device_id field (Easee), otherwise as target.
function forDevice(m, data, deviceId) {
  if (m.device_field) return { data: deviceId ? { [m.device_field]: String(deviceId), ...data } : data, target: null };
  return { data, target: deviceId ? { device_id: deviceId } : null };
}

function startStopCommand(m, on, deviceId) {
  if (!m) return null;
  switch (m.type) {
    case 'action_choice': return { service: `${m.domain}.${m.service}`, ...forDevice(m, { [m.field]: on ? m.start_value : m.stop_value }, deviceId) };
    case 'action_pair': return { service: `${m.domain}.${on ? m.start_service : m.stop_service}`, ...forDevice(m, {}, deviceId) };
    case 'buttons': return { service: 'button.press', data: {}, target: { entity_id: on ? m.start_entity : m.stop_entity } };
    case 'switch': return { service: `switch.turn_${on ? 'on' : 'off'}`, data: {}, target: { entity_id: m.entity_id } };
    case 'select': return { service: 'select.select_option', data: { option: on ? m.start_option : m.stop_option }, target: { entity_id: m.entity_id } };
    default: return null;
  }
}

// What sendControl() may send for a start/stop method: exactly its own
// action(s) or entities, nothing else.
function allowedFor(m) {
  if (!m) return [];
  switch (m.type) {
    case 'action_choice': return [{ service: `${m.domain}.${m.service}` }];
    case 'action_pair': return [{ service: `${m.domain}.${m.start_service}` }, { service: `${m.domain}.${m.stop_service}` }];
    case 'buttons': return [{ service: 'button.press', entity_id: m.start_entity }, { service: 'button.press', entity_id: m.stop_entity }];
    case 'switch': return [{ service: 'switch.turn_on', entity_id: m.entity_id }, { service: 'switch.turn_off', entity_id: m.entity_id }];
    case 'select': return [{ service: 'select.select_option', entity_id: m.entity_id }];
    // Charging current (solar) and phase switching.
    case 'number': return [{ service: 'number.set_value', entity_id: m.entity_id }];
    case 'action_current': return [{ service: `${m.domain}.${m.service}` }];
    case 'action_phase': return [{ service: `${m.domain}.${m.service}` }];
    case 'select_phase': return [{ service: 'select.select_option', entity_id: m.entity_id }];
    case 'switch_phase': return [{ service: 'switch.turn_on', entity_id: m.entity_id }, { service: 'switch.turn_off', entity_id: m.entity_id }];
    default: return [];
  }
}

// The command for a charging current (A).
function currentCommand(m, amps, deviceId) {
  if (!m || !Number.isFinite(amps)) return null;
  if (m.type === 'number') return { what: `set current to ${amps} A`, service: 'number.set_value', data: { value: amps }, target: { entity_id: m.entity_id } };
  if (m.type === 'action_current') {
    return { what: `set current to ${amps} A`, service: `${m.domain}.${m.service}`, ...forDevice(m, { [m.field]: amps, ...(m.ttl_field ? { [m.ttl_field]: 30 } : {}) }, deviceId) };
  }
  return null;
}

// The command to switch to one or three phases.
function phaseCommand(m, phases, deviceId) {
  if (!m) return null;
  const one = phases === 1;
  const what = `switch to ${one ? 'one phase' : 'three phases'}`;
  if (m.type === 'action_phase') return { what, service: `${m.domain}.${m.service}`, ...forDevice(m, { [m.field]: one ? m.one_value : m.three_value }, deviceId) };
  if (m.type === 'select_phase') return { what, service: 'select.select_option', data: { option: one ? m.one_value : m.three_value }, target: { entity_id: m.entity_id } };
  if (m.type === 'switch_phase') return { what, service: `switch.turn_${one ? 'on' : 'off'}`, data: {}, target: { entity_id: m.entity_id } };
  return null;
}

// Log a command that was really sent (or refused / failed).
function logSent(entry) {
  const entries = loadLog();
  entries.push({ commands: [], ...entry });
  log = entries.slice(-KEEP);
  writeJson(LOG_FILE, log);
}

// The commands the app would send for a decision, with the chosen methods.
function commandsFor(decision, actual, methods, deviceId) {
  if (!methods) return [];
  const out = [];
  const ss = methods.start_stop;
  const cur = methods.current;
  const describe = (m, on) => startStopCommand(m, on, deviceId);
  if (decision.want === 'charge') {
    if (cur && decision.amps) {
      if (cur.type === 'number') out.push({ what: `set current to ${decision.amps} A`, service: 'number.set_value', data: { value: decision.amps }, target: { entity_id: cur.entity_id } });
      else if (cur.type === 'action_current') out.push(currentCommand(cur, decision.amps, deviceId));
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
function dryRun({ plan, vehicle, charger, states, methods, deviceId, rules, now = Date.now(), controlAllowed, live = false, boostActive, solar }) {
  const r = { ...DEFAULT_RULES, ...(rules || {}) };
  const st = loadState();
  const actual = readActual({ vehicle, charger, states, now });
  const prev = loadLog().slice(-1)[0];
  const decision = decide({ plan, actual, rules: r, now, phases: charger ? charger.phases : 3, states, lock: st.lock, boostActive, solar, prevCode: prev ? prev.code : null });

  // Keep the lock up to date.
  let lock = st.lock && st.lock.end > now ? st.lock : null;
  if (decision.clear_lock) lock = null;
  if (decision.new_lock) lock = decision.new_lock;
  if (JSON.stringify(lock) !== JSON.stringify(st.lock)) {
    st.lock = lock;
    writeJson(STATE_FILE, st);
  }

  // Live: only start/stop, never the current. With a switch as start/stop
  // method, its own on/off state tells whether a command is needed.
  let cmdActual = actual;
  const ss = methods && methods.start_stop;
  if (ss && ss.type === 'switch') {
    const sw = findState(states, ss.entity_id);
    if (sw && (sw.state === 'on' || sw.state === 'off')) cmdActual = { ...actual, charging: sw.state === 'on' };
  }
  if (ss && ss.type === 'select') {
    const sel = findState(states, ss.entity_id);
    if (sel && sel.state === ss.start_option) cmdActual = { ...actual, charging: true };
    else if (sel && sel.state === ss.stop_option) cmdActual = { ...actual, charging: false };
  }
  const commands = live
    ? commandsFor(decision, cmdActual, methods ? { start_stop: ss, current: null } : null, deviceId)
    : commandsFor(decision, actual, methods, deviceId);
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
    phases: decision.phases || null,
    solar: !!decision.solar,
    reason: decision.reason,
    next_start: decision.next_start || null,
    block_end: decision.block_end || null,
    locked_until: lock ? lock.end : null,
    commands: commands.map((c) => ({ what: c.what, service: c.service, data: c.data, target: c.target })),
    agrees,
    sent: false, // this line is the decision; a sent command gets its own log line
    live: !!live,
    control_allowed: !!controlAllowed,
  };
  const entries = loadLog();
  const last = entries[entries.length - 1];
  const key = (e) => JSON.stringify([e.plugged, e.charging, e.want, e.code, e.amps, e.commands.map((c) => c.what)]);
  if (!last || key(last) !== key(entry)) {
    // A copy: the server marks the live entry as sent afterwards, and that
    // gets its own log line.
    entries.push({ ...entry, commands: entry.commands.map((c) => ({ ...c })) });
    log = entries.slice(-KEEP);
    writeJson(LOG_FILE, log);
  }
  return entry;
}

function recentLog(limit = 100) {
  return loadLog().slice(-limit).reverse();
}

function clearLog() {
  log = [];
  writeJson(LOG_FILE, log);
}

function clearLock() {
  const st = loadState();
  st.lock = null;
  writeJson(STATE_FILE, st);
}

module.exports = { dryRun, recentLog, readActual, decide, commandsFor, startStopCommand, allowedFor, currentCommand, phaseCommand, logSent, clearLog, clearLock, DEFAULT_RULES };

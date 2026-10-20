'use strict';

// The charging status on top of Home: one state, one colour, one line.
// Colours (chosen by the owner): ready green, charging red, waiting yellow,
// anything in the way orange, nothing to do grey.
//
// d: the plan result (as /api/plan returns it); n: what the charger does
// now (the check every minute); fmt: { hm(ms), dayHm(ms) } in local time.

function num(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
}

// What a charger status text means, in plain words (from the integrations).
const STATUS_MEANING = {
  awaiting_start: 'a car is connected; charging has not started',
  ready_to_charge: 'the charger is ready; the car does not ask for power',
  completed: 'the charger says the charging session is finished',
  awaiting_authorization: 'the charger waits for authorisation',
  awaiting_load_balancing: 'the charger waits for load balancing',
  awaiting_smart_start: 'the charger waits for its own smart start',
  connected_requesting: 'a car is connected and asks for power',
  connected_finished: 'the charger says the car is finished',
  'waiting for car demand': 'the charger waits until the car asks for power',
  paused: 'the charger is paused',
  suspendedev: 'the car does not take power',
  suspendedevse: 'the charger holds back power',
  'wait for car': 'the charger waits for the car',
  'waiting for vehicle': 'the charger waits for the car',
  plugged_in: 'a car is plugged in, not charging',
  pending_approval: 'the charger waits for approval',
};
function meaning(status) {
  return status ? STATUS_MEANING[String(status).toLowerCase()] || null : null;
}

// The facts behind the status, for "Why?" on Home: what the app wants, what
// the charger and the car say, and what holds charging back. Only facts.
function facts(d, n, fmt) {
  const out = [];
  const add = (label, value) => { if (value) out.push({ label, value }); };
  const v = d.vehicle || {};
  const p = d.plan || {};
  const pct = (x) => (Number.isFinite(Number(x)) && x !== null ? `${Math.round(Number(x))}%` : null);
  const want = { charge: 'charge', pause: 'pause', leave: 'leave as it is', none: 'nothing' }[n.want] || n.want;
  add('The app wants', want ? `${want}${n.reason ? ` · ${n.reason}` : ''}` : null);
  if (n.switch_state) add(n.switch_state.name || 'Charger switch', `${n.switch_state.state}${n.switch_state.on ? ' (charging allowed)' : ' (charging not allowed)'}${n.switch_state.since ? ` · since ${fmt.dayHm(n.switch_state.since)}` : ''}`);
  if (n.status) add('Charger status', `${n.status}${meaning(n.status) ? ` · ${meaning(n.status)}` : ''}`);
  add('Power now', Number.isFinite(Number(n.power_w)) && n.power_w !== null ? `${(Number(n.power_w) / 1000).toFixed(1)} kW` : null);
  add('Car', [n.plugged === true ? 'plugged in' : n.plugged === false ? 'not plugged in' : null, pct(v.soc) ? `battery ${pct(v.soc)}` : null,
    d.car_limit && d.car_limit.value != null ? `charge limit ${pct(d.car_limit.value)}` : null,
    d.planning && d.planning.target_soc != null ? `target ${pct(d.planning.target_soc)}` : null].filter(Boolean).join(' · '));
  const care = p.care;
  if (care && care.window_start) {
    add('Battery care', (n.at || Date.now()) < care.window_start
      ? `holds the car at ${pct(care.soc)} until ${fmt.dayHm(care.window_start)}`
      : `not holding back: up to ${pct(care.target)} allowed since ${fmt.dayHm(care.window_start)}`);
  }
  const r = d.reliability;
  if (r && r.protect) add('Ready Guard', r.reason || r.message || 'charging now to be ready in time');
  if (d.boost) add('Charge now', 'on, started by you');
  const next = (p.blocks || []).find((b) => b.start > (n.at || Date.now()));
  if (next && n.want !== 'charge') add('Next planned charging', fmt.dayHm(next.start));
  return out;
}

function chargeState(d, n, fmt) {
  const s = chargeStateOnly(d, n, fmt);
  if (s) s.facts = facts(d, n, fmt);
  return s;
}

function chargeStateOnly(d, n, fmt) {
  if (!d || !n) return null;
  const v = d.vehicle || {};
  const soc = num(v.soc);
  const planning = d.planning || {};
  const target = num(planning.target_soc);
  const wanted = num(planning.wanted_soc) ?? target;
  const r = d.reliability || {};
  const p = d.plan || {};
  const blocks = p.blocks || [];
  const notes = p.notes || [];
  const lastEnd = blocks.length ? blocks[blocks.length - 1].end : null;
  const readyAt = d.boost && lastEnd ? lastEnd : (r.expected_ready || lastEnd);
  const kw = num(n.power_w) > 0 ? `${(n.power_w / 1000).toFixed(1)} kW` : null;
  const level = soc != null && target != null ? `${soc}% → ${target}%` : (soc != null ? `${soc}%` : null);
  const lim = d.car_limit;
  const limitLow = r.car_limit || (notes.includes('car_limit') && lim && num(lim.value) != null && wanted > num(lim.value) ? { value: num(lim.value), wanted } : null);
  const join = (a) => a.filter(Boolean).join(' · ');
  const ready = readyAt ? `ready around ${fmt.dayHm(readyAt)}` : null;
  const st = (state, color, icon, title, detail) => ({ state, color, icon, title, detail: detail || '', advice_only: !d.control_allowed, at: n.at });
  const offline = n.status === 'unavailable' || n.status === 'unknown' || ['status_grace', 'status_invalid'].includes(n.code);
  const carUnknown = v.car_data && v.car_data.ok === false;

  if (n.plugged === false) {
    return st('not_connected', 'grey', 'plugOff', 'Car not connected', d.departure ? `Plug in to be ready by ${fmt.dayHm(d.departure.time)}.` : 'Plug in the car to charge.');
  }
  // The charger itself reports a problem (an error, a fault, an update).
  const unreachable = !n.status || ['unavailable', 'unknown', 'offline', 'none'].includes(String(n.status).toLowerCase());
  if (offline && !unreachable) {
    return st('charger_problem', 'orange', 'alert', 'Charger reports a problem', `The charger says "${n.status}". Check the charger and its integration; the app pauses charging after 2 minutes.`);
  }
  if (offline) {
    return st('charger_offline', 'orange', 'alert', 'Charger not reachable', `Home Assistant does not get the charger's status${n.status ? ` (${n.status})` : ''}. Check the charger and its integration.`);
  }
  if (n.charging === true || (num(n.power_w) || 0) > 500) {
    // What it charges to right now: Charge now or Quick minimum (their goal),
    // your minimum (the part below it is charged first), or the plan's target.
    const b = d.boost;
    const minPlan = p.minimum && !b ? p.minimum : null;
    const minBlocks = blocks.filter((x) => (num(x.min_kwh) || 0) > 0.01);
    const forMinimum = n.code === 'below_minimum' || (minPlan && minBlocks.length && minBlocks[0].start <= n.at + 5 * 60000);
    let goal = target;
    let until = readyAt;
    let why = null;
    if (b) {
      if (b.mode === 'soc' && num(b.value) != null) goal = num(b.value);
      if (b.end) until = b.end;
      why = b.minimum ? 'Quick minimum' : b.mode === 'on' ? 'Charge now: on until you press Stop or unplug' : 'Charge now';
      if (b.mode === 'on') { goal = null; until = null; }
    } else if (forMinimum && minPlan && num(minPlan.soc) != null) {
      goal = num(minPlan.soc);
      if (minBlocks.length) until = minBlocks[minBlocks.length - 1].end;
      why = 'your minimum first, then the plan';
    }
    const lvl = soc != null && goal != null ? `${soc}% → ${goal}%` : b && b.mode === 'on' ? null : level;
    const title = n.code === 'ready_guard' ? 'Ready Guard charging'
      : n.code === 'solar' ? 'Charging on solar'
        : forMinimum && !b ? 'Charging to your minimum'
          : 'Charging now';
    return st('charging', 'red', 'bolt', title, join([kw, lvl, until ? `ready around ${fmt.dayHm(until)}` : null, why, n.code === 'ready_guard' ? 'to be ready in time' : null]));
  }
  if (limitLow && soc != null && soc >= limitLow.value) {
    return st('car_limit', 'orange', 'alert', `Not charging: the car's charge limit is ${limitLow.value}%`, r.message || `The car stops at ${limitLow.value}%, but ${limitLow.wanted}% is wanted. Raise it in the car.`);
  }
  // Battery care: the car stays at the care level (e.g. 80 %) until the last
  // hours before the departure, so it does not take power now, even when the
  // charger is on. Say when the rest really starts.
  const care = p.care;
  const at = n.at || Date.now();
  if (care && !d.boost && soc != null && num(care.soc) != null && soc >= num(care.soc) - 0.5
    && target != null && soc < target && num(care.window_start) != null && at < care.window_start) {
    const top = blocks.find((x) => x.end > care.window_start);
    const start = top ? Math.max(top.start, care.window_start) : care.window_start;
    return st('care_wait', 'amber', 'clock', `Battery care · charging starts at ${fmt.hm(start)}`,
      join([`${soc}% → ${target}%`, `the car stays at ${num(care.soc)}% until then`, readyAt ? `ready around ${fmt.dayHm(readyAt)}` : null]));
  }
  if (n.code === 'no_reaction' || (n.error && n.want === 'charge')) {
    return st('no_reaction', 'orange', 'alert', 'The charger did not start', n.error || n.reason || 'The app turned the charger on, but it does not charge.');
  }
  // The app wants to charge and the charger allows it, but no power flows:
  // say so, with what the charger reports.
  // (In the first minute after the charger was switched on, that is normal.)
  const sw = n.switch_state;
  const onFor = sw && sw.since ? (n.at || Date.now()) - sw.since : Infinity;
  if (n.want === 'charge' && sw && sw.on && onFor > 60000 && !((num(n.power_w) || 0) > 500)) {
    const m = meaning(n.status);
    return st('no_power', 'orange', 'alert', 'The charger is on, but the car takes no power',
      join([n.status ? `Charger: ${n.status}${m ? ` (${m})` : ''}` : null, sw.since ? `on since ${fmt.dayHm(sw.since)}` : null, level, n.reason]));
  }
  if (n.want === 'charge') {
    return st('starting', 'amber', 'bolt', 'Starting to charge', 'The app turned the charger on; the car should start within a minute.');
  }
  if (carUnknown) {
    return st('car_unreachable', 'orange', 'alert', 'Car not reachable', join([soc != null ? `battery about ${soc}% (last known)` : 'battery level unknown', "the car's cloud does not answer"]));
  }
  if (soc != null && target != null && soc >= target) {
    return st('ready', 'green', 'check', 'Ready', join([`${soc}%`, `at the target (${target}%)`, 'the charger is off']));
  }
  if (n.code === 'solar_wait') {
    return st('solar_wait', 'amber', 'sun', 'Waiting for the sun', join([level, n.reason || 'solar only: charging starts when there is enough surplus']));
  }
  if (n.code === 'shared_wait') {
    return st('shared_wait', 'amber', 'clock', 'Waiting for the other charger', join([level, n.reason]));
  }
  if (n.code === 'missing_data' || notes.includes('missing_data')) {
    return st('missing_data', 'orange', 'alert', 'Cannot plan', 'The battery level or the battery size is missing. Check Settings › Vehicle.');
  }
  if (n.next_start) {
    const early = r.base_status === 'at_risk' && r.latest_safe_start && r.latest_safe_start < n.next_start;
    const start = early ? r.latest_safe_start : n.next_start;
    return st('waiting', 'amber', 'clock', `Not charging now · starts at ${fmt.hm(start)}`, join([level, ready, early ? 'Ready Guard starts early for the safety margin' : 'in the cheapest hours before you leave']));
  }
  return st('idle', 'grey', 'pause', 'Not charging now', n.reason || '');
}

module.exports = { chargeState };

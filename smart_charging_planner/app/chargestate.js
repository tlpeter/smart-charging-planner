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

function chargeState(d, n, fmt) {
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

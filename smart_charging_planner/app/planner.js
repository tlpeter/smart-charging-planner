'use strict';

// Charging planner: picks the cheapest price blocks before the deadline.
// Pure functions only: no Home Assistant calls, so it is easy to test.

const DEFAULT_CURRENT = 16; // A, used when the charger has no maximum set
const VOLTAGE = 230;

// Charging power in kW from phases and current.
function chargePowerKw(phases, maxCurrent) {
  return ((phases === 1 ? 1 : 3) * VOLTAGE * (maxCurrent || DEFAULT_CURRENT)) / 1000;
}

// Energy to add in kWh, including a margin for charging losses.
function energyNeededKwh(socNow, socTarget, capacityKwh, lossPercent) {
  if (!(capacityKwh > 0) || !Number.isFinite(socNow)) return null;
  const pct = Math.max(0, socTarget - socNow);
  return (pct / 100) * capacityKwh * (1 + (lossPercent || 0) / 100);
}

// Next moment the clock shows hh:mm in the time zone, after `now`.
// localTimeOn(tz, dayOffset, hour, minute, now) comes from prices.js.
function nextDeadline(readyBy, tz, now, localTimeOn) {
  const [h, m] = String(readyBy || '07:00').split(':').map(Number);
  for (const day of [0, 1, 2]) {
    const t = localTimeOn(tz, day, h || 0, m || 0, now);
    if (t > now) return t;
  }
  return null;
}

// Cheapest single uninterrupted run of blocks that delivers the energy.
// The one partly used block may sit at the start or at the end of the run.
function bestContiguous(usable, neededKwh) {
  let best = null;
  const consider = (chosen) => {
    const got = chosen.reduce((s, b) => s + b.kwh, 0);
    if (got < neededKwh - 1e-6) return;
    const cost = chosen.reduce((s, b) => s + b.kwh * b.total, 0);
    if (!best || cost < best.cost - 1e-9) best = { cost, chosen };
  };
  const touching = (a, b) => Math.abs(a.end - b.start) < 1000;
  for (let i = 0; i < usable.length; i++) {
    // Forward from block i: full blocks, the last one partly.
    let left = neededKwh;
    const fwd = [];
    for (let k = i; k < usable.length && left > 1e-9; k++) {
      if (k > i && !touching(usable[k - 1], usable[k])) break;
      const kwh = Math.min(left, usable[k].hours * usable[k].power);
      fwd.push({ ...usable[k], kwh });
      left -= kwh;
    }
    consider(fwd);
    // Backward ending at block i: full blocks, the first one partly.
    left = neededKwh;
    const back = [];
    for (let k = i; k >= 0 && left > 1e-9; k--) {
      if (k < i && !touching(usable[k], usable[k + 1])) break;
      const kwh = Math.min(left, usable[k].hours * usable[k].power);
      back.unshift({ ...usable[k], kwh });
      left -= kwh;
    }
    consider(back);
  }
  return best;
}

// prices: [{start, end, total, power_kw?}] sorted, now: ms, deadline: ms.
// power_kw per block overrides powerKw (e.g. less room when the house uses more).
// continuous: prefer one uninterrupted period unless splitting saves at least
// minSplitSaving (in currency).
// immediate: charge right away from now (for "Charge now").
function planCharging({ prices, now, deadline, neededKwh, powerKw, continuous = false, minSplitSaving = 0, immediate = false }) {
  const notes = [];
  const result = {
    needed_kwh: neededKwh,
    power_kw: powerKw,
    deadline,
    blocks: [],
    planned_kwh: 0,
    cost: null,
    reference_cost: null,
    savings: null,
    notes,
  };
  if (neededKwh == null) {
    notes.push('missing_data');
    return result;
  }
  if (neededKwh <= 0.01) {
    notes.push('already_at_target');
    return result;
  }

  // Usable part of each block: from now until the deadline.
  const usable = prices
    .map((p) => {
      const start = Math.max(p.start, now);
      const end = Math.min(p.end, deadline);
      const power = Number.isFinite(p.power_kw) ? p.power_kw : powerKw;
      return { start, end, total: p.total, power, hours: (end - start) / 3600000 };
    })
    .filter((b) => b.hours > 0 && b.power > 0);

  const lastKnown = prices.length ? prices[prices.length - 1].end : now;
  if (lastKnown < deadline) notes.push('prices_incomplete');

  const capacity = usable.reduce((s, b) => s + b.hours * b.power, 0);
  if (capacity < neededKwh) notes.push(lastKnown < deadline ? 'not_enough_known_time' : 'not_enough_time');

  // Plan: cheapest blocks first. Reference: charge right away until full.
  const fill = (ordered) => {
    let left = neededKwh;
    const chosen = [];
    for (const b of ordered) {
      if (left <= 1e-9) break;
      const kwh = Math.min(left, b.hours * b.power);
      chosen.push({ ...b, kwh });
      left -= kwh;
    }
    return chosen;
  };

  const cost = (list) => list.reduce((s, b) => s + b.kwh * b.total, 0);
  let planned = fill([...usable].sort((a, b) => a.total - b.total || a.start - b.start));
  const reference = fill([...usable].sort((a, b) => a.start - b.start));

  if (immediate) planned = reference.map((b) => ({ ...b }));

  // One uninterrupted period, unless splitting saves enough.
  if (continuous && !immediate) {
    const one = bestContiguous(usable, neededKwh);
    if (one) {
      const extra = one.cost - cost(planned);
      const splitNeeded = extra > 1e-6;
      result.continuous = {
        preferred: true,
        used: !splitNeeded || extra < minSplitSaving,
        split_saving: extra,
        threshold: minSplitSaving,
      };
      if (result.continuous.used) planned = one.chosen.map((b) => ({ ...b }));
    }
  }

  // A partly used block is placed against its planned neighbour, so charging
  // runs in one go instead of stopping and starting again.
  planned.sort((a, b) => a.start - b.start);
  const starts = new Set(planned.map((b) => b.start));
  result.blocks = planned.map((b) => {
    const duration = (b.kwh / (b.hours * b.power)) * (b.end - b.start);
    const nextPlanned = starts.has(b.end);
    const start = nextPlanned ? b.end - duration : b.start;
    return { start, end: start + duration, block_start: b.start, block_end: b.end, kwh: b.kwh, price: b.total, power_kw: b.power };
  });
  result.planned_kwh = planned.reduce((s, b) => s + b.kwh, 0);
  result.cost = cost(planned);
  result.reference_cost = cost(reference);
  result.savings = result.reference_cost - result.cost;
  return result;
}

// Merge touching blocks into periods for display.
function periods(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - b.start) < 1000) {
      last.end = b.end;
      last.kwh += b.kwh;
      last.cost += b.kwh * b.price;
    } else {
      out.push({ start: b.start, end: b.end, kwh: b.kwh, cost: b.kwh * b.price });
    }
  }
  return out.map((p) => ({ start: p.start, end: p.end, kwh: p.kwh, avg_price: p.cost / p.kwh }));
}

module.exports = { chargePowerKw, energyNeededKwh, nextDeadline, planCharging, periods };

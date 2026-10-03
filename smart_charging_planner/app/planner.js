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
// A block can have two parts at the same time: solar (at its own value) and
// grid. They are grouped per start time; within a group the cheapest part is
// used first.
function bestContiguous(usable, neededKwh) {
  const groups = [];
  for (const u of [...usable].sort((a, b) => a.start - b.start || a.total - b.total)) {
    const g = groups[groups.length - 1];
    if (g && g.start === u.start) g.parts.push(u);
    else groups.push({ start: u.start, end: u.end, parts: [u] });
  }
  for (const g of groups) g.parts.sort((a, b) => a.total - b.total);
  const take = (g, want) => {
    const out = [];
    let left = want;
    for (const part of g.parts) {
      if (left <= 1e-9) break;
      const kwh = Math.min(left, part.hours * part.power);
      out.push({ ...part, kwh });
      left -= kwh;
    }
    return out;
  };
  const cap = (g) => g.parts.reduce((s, x) => s + x.hours * x.power, 0);
  let best = null;
  const consider = (chosen) => {
    const got = chosen.reduce((s, b) => s + b.kwh, 0);
    if (got < neededKwh - 1e-6) return;
    const cost = chosen.reduce((s, b) => s + b.kwh * b.total, 0);
    if (!best || cost < best.cost - 1e-9) best = { cost, chosen };
  };
  const touching = (a, b) => Math.abs(a.end - b.start) < 1000;
  for (let i = 0; i < groups.length; i++) {
    // Forward from group i: full groups, the last one partly.
    let left = neededKwh;
    const fwd = [];
    for (let k = i; k < groups.length && left > 1e-9; k++) {
      if (k > i && !touching(groups[k - 1], groups[k])) break;
      const kwh = Math.min(left, cap(groups[k]));
      fwd.push(...take(groups[k], kwh));
      left -= kwh;
    }
    consider(fwd);
    // Backward ending at group i: full groups, the first one partly.
    left = neededKwh;
    const back = [];
    for (let k = i; k >= 0 && left > 1e-9; k--) {
      if (k < i && !touching(groups[k], groups[k + 1])) break;
      const kwh = Math.min(left, cap(groups[k]));
      back.unshift(...take(groups[k], kwh));
      left -= kwh;
    }
    consider(back);
  }
  return best;
}

// Merge the solar and grid parts of the same block into one planned block.
function mergeParts(list) {
  const by = new Map();
  for (const b of list) {
    const m = by.get(b.start);
    if (!m) {
      by.set(b.start, { ...b, cost: b.kwh * b.total, solar_kwh: b.solar ? b.kwh : 0, solar_power: b.solar ? b.power : 0, grid: !b.solar, parts: 1 });
      continue;
    }
    m.parts++;
    m.kwh += b.kwh;
    m.cost += b.kwh * b.total;
    if (b.solar) { m.solar_kwh += b.kwh; m.solar_power = b.power; } else m.grid = true;
    m.forecast = m.forecast || b.forecast;
  }
  // With grid power the charger runs at full power; on solar alone it runs
  // as fast as the sun allows, so the block lasts longer.
  return [...by.values()].map((m) => ({
    ...m,
    power: m.grid || !m.solar_power ? (m.full_power || m.power) : m.solar_power,
    total: m.parts > 1 && m.kwh > 0 ? m.cost / m.kwh : m.total,
  }));
}

// A partly used block is placed against its planned neighbour, so charging
// runs in one go instead of stopping and starting again.
// planned: [{start, end, power, kwh, total, forecast}] (start/end: usable part).
function placeBlocks(planned) {
  const list = [...planned].sort((a, b) => a.start - b.start);
  const starts = new Set(list.map((b) => b.start));
  return list.map((b) => {
    const duration = Math.min(b.end - b.start, (b.kwh / b.power) * 3600000);
    const nextPlanned = starts.has(b.end);
    const start = nextPlanned ? b.end - duration : b.start;
    const solar = b.solar_kwh > 0.001 ? { solar_kwh: b.solar_kwh, grid_kwh: Math.max(0, b.kwh - b.solar_kwh) } : {};
    return { start, end: start + duration, block_start: b.start, block_end: b.end, kwh: b.kwh, price: b.total, power_kw: b.power, ...(b.forecast ? { forecast: true } : {}), ...solar };
  });
}

// Two goals: at least minKwh before firstDeadline (a departure in between),
// and neededKwh in total before the final deadline. The minimum is planned
// first in the cheapest blocks before the first deadline; the rest in the
// cheapest capacity that is left before the final deadline.
function planStaged({ prices, now, firstDeadline, minKwh, deadline, neededKwh, powerKw, continuous = false, minSplitSaving = 0, solarOnly = false }) {
  const opts = { powerKw, continuous, minSplitSaving, solarOnly };
  const whole = planCharging({ prices, now, deadline, neededKwh, ...opts });
  if (!(minKwh > 0.01) || !(firstDeadline > now) || firstDeadline >= deadline || neededKwh == null || neededKwh <= 0.01) return whole;
  const first = planCharging({ prices, now, deadline: firstDeadline, neededKwh: Math.min(minKwh, neededKwh), ...opts });
  // Capacity left in each block after the first stage.
  const used = new Map(first.blocks.map((b) => [b.block_start, b]));
  const rest = prices.map((p) => {
    const start = Math.max(p.start, now);
    const power = Number.isFinite(p.power_kw) ? p.power_kw : powerKw;
    const u = used.get(start);
    if (!u) return p;
    const hours = (Math.min(p.end, deadline) - start) / 3600000;
    const left = Math.max(0, hours * power - u.kwh);
    const out = { ...p, power_kw: hours > 0 ? left / hours : 0 };
    if (Number.isFinite(p.solar_kw) && hours > 0) out.solar_kw = Math.max(0, p.solar_kw - (u.solar_kwh || 0) / hours);
    return out;
  });
  const second = planCharging({ prices: rest, now, deadline, neededKwh: Math.max(0, neededKwh - first.planned_kwh), ...opts });
  // Merge both stages per block.
  const byStart = new Map();
  const add = (b, stage) => {
    const prev = byStart.get(b.block_start);
    if (prev) {
      prev.total = (prev.total * prev.kwh + b.price * b.kwh) / (prev.kwh + b.kwh);
      prev.kwh += b.kwh;
      prev.solar_kwh += b.solar_kwh || 0;
      return;
    }
    const src = prices.find((p) => Math.max(p.start, now) === b.block_start);
    const power = src && Number.isFinite(src.power_kw) ? src.power_kw : powerKw;
    byStart.set(b.block_start, {
      start: b.block_start, end: stage === 1 ? b.block_end : Math.min(src ? src.end : b.block_end, deadline),
      power, kwh: b.kwh, total: b.price, forecast: !!b.forecast, solar_kwh: b.solar_kwh || 0,
    });
  };
  first.blocks.forEach((b) => add(b, 1));
  second.blocks.forEach((b) => add(b, 2));
  const merged = placeBlocks([...byStart.values()]);
  const notes = [...new Set([...first.notes.filter((n) => n !== 'already_at_target'), ...second.notes.filter((n) => n !== 'already_at_target')])];
  if (first.planned_kwh < Math.min(minKwh, neededKwh) - 0.05) notes.push('minimum_not_reached');
  const cost = first.cost + (second.cost || 0);
  return {
    ...whole,
    blocks: merged,
    planned_kwh: first.planned_kwh + second.planned_kwh,
    cost,
    savings: whole.reference_cost - cost,
    notes,
    stage: { first_deadline: firstDeadline, min_kwh: minKwh, first_kwh: first.planned_kwh },
    continuous: undefined,
  };
}

// prices: [{start, end, total, power_kw?}] sorted, now: ms, deadline: ms.
// power_kw per block overrides powerKw (e.g. less room when the house uses more).
// continuous: prefer one uninterrupted period unless splitting saves at least
// minSplitSaving (in currency).
// immediate: charge right away from now (for "Charge now").
// Solar: a block with solar_kw (expected surplus) and solar_price (what a kWh
// of own solar power is worth) gets a solar part next to the grid part.
// solarOnly: only the solar parts (mode "Solar only").
function planCharging({ prices, now, deadline, neededKwh, powerKw, continuous = false, minSplitSaving = 0, immediate = false, solarOnly = false }) {
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
    .flatMap((p) => {
      const start = Math.max(p.start, now);
      const end = Math.min(p.end, deadline);
      const power = Number.isFinite(p.power_kw) ? p.power_kw : powerKw;
      const base = { start, end, hours: (end - start) / 3600000, forecast: !!p.forecast, full_power: power };
      const solarKw = Number.isFinite(p.solar_kw) && Number.isFinite(p.solar_price) ? Math.max(0, Math.min(power, p.solar_kw)) : 0;
      const parts = [];
      if (solarKw > 0.01) parts.push({ ...base, total: p.solar_price, power: solarKw, solar: true });
      if (!solarOnly) parts.push({ ...base, total: p.total, power: power - solarKw });
      return parts;
    })
    .filter((b) => b.hours > 0 && b.power > 0.001);

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
  const reference = fill([...usable].sort((a, b) => a.start - b.start || a.total - b.total));

  if (immediate) planned = reference.map((b) => ({ ...b }));

  // One uninterrupted period, unless splitting saves enough.
  // Charging on the sun is never held back by this: the solar parts the
  // cheapest plan uses stay, and only the grid part is kept in one period.
  if (continuous && !immediate) {
    const solarChosen = planned.filter((b) => b.solar);
    const solarKwh = solarChosen.reduce((s, b) => s + b.kwh, 0);
    const rest = neededKwh - solarKwh;
    const gridOne = rest > 1e-6 ? bestContiguous(usable.filter((b) => !b.solar), rest) : { cost: 0, chosen: [] };
    const one = gridOne ? { chosen: [...solarChosen, ...gridOne.chosen], cost: cost(solarChosen) + gridOne.cost } : null;
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

  result.blocks = placeBlocks(mergeParts(planned));
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
      last.forecast = last.forecast || !!b.forecast;
      last.solar_kwh += b.solar_kwh || 0;
    } else {
      out.push({ start: b.start, end: b.end, kwh: b.kwh, cost: b.kwh * b.price, forecast: !!b.forecast, solar_kwh: b.solar_kwh || 0 });
    }
  }
  return out.map((p) => ({ start: p.start, end: p.end, kwh: p.kwh, avg_price: p.cost / p.kwh, ...(p.forecast ? { forecast: true } : {}), ...(p.solar_kwh > 0.001 ? { solar_kwh: p.solar_kwh } : {}) }));
}

module.exports = { chargePowerKw, energyNeededKwh, nextDeadline, planCharging, planStaged, placeBlocks, periods };

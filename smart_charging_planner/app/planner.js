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

// prices: [{start, end, total}] sorted, now: ms, deadline: ms.
function planCharging({ prices, now, deadline, neededKwh, powerKw }) {
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
      return { start, end, total: p.total, hours: (end - start) / 3600000 };
    })
    .filter((b) => b.hours > 0);

  const lastKnown = prices.length ? prices[prices.length - 1].end : now;
  if (lastKnown < deadline) notes.push('prices_incomplete');

  const capacity = usable.reduce((s, b) => s + b.hours * powerKw, 0);
  if (capacity < neededKwh) notes.push(lastKnown < deadline ? 'not_enough_known_time' : 'not_enough_time');

  // Plan: cheapest blocks first. Reference: charge right away until full.
  const fill = (ordered) => {
    let left = neededKwh;
    const chosen = [];
    for (const b of ordered) {
      if (left <= 1e-9) break;
      const kwh = Math.min(left, b.hours * powerKw);
      chosen.push({ ...b, kwh });
      left -= kwh;
    }
    return chosen;
  };

  const planned = fill([...usable].sort((a, b) => a.total - b.total || a.start - b.start));
  const reference = fill([...usable].sort((a, b) => a.start - b.start));
  const cost = (list) => list.reduce((s, b) => s + b.kwh * b.total, 0);

  result.blocks = planned
    .sort((a, b) => a.start - b.start)
    .map((b) => ({
      start: b.start,
      // A partly used block ends early.
      end: b.start + (b.kwh / powerKw) * 3600000,
      block_end: b.end,
      kwh: b.kwh,
      price: b.total,
    }));
  result.planned_kwh = planned.reduce((s, b) => s + b.kwh, 0);
  result.cost = cost(planned);
  result.reference_cost = cost(reference);
  result.savings = result.reference_cost - result.cost;
  return result;
}

// Merge adjacent blocks into periods for display.
function periods(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.block_end - b.start) < 1000 && last.end === last.block_end) {
      last.end = b.end;
      last.block_end = b.block_end;
      last.kwh += b.kwh;
      last.cost += b.kwh * b.price;
    } else {
      out.push({ start: b.start, end: b.end, block_end: b.block_end, kwh: b.kwh, cost: b.kwh * b.price });
    }
  }
  return out.map((p) => ({ start: p.start, end: p.end, kwh: p.kwh, avg_price: p.cost / p.kwh }));
}

module.exports = { chargePowerKw, energyNeededKwh, nextDeadline, planCharging, periods };

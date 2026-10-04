'use strict';

// Home battery plan: per price block one action, chosen by dynamic
// programming over the battery level, so the battery is charged from the
// grid when that pays off later (after losses and wear), saved for expensive
// hours, and filled with solar power in between.
//
// Actions per block:
//   auto          own self-consumption: takes solar surplus, covers the house
//   hold          neither charge nor discharge (save the energy for later)
//   no_discharge  takes solar surplus, does not discharge (e.g. not into the car)
//   charge        charges from solar and grid at full power
// Pure function, no Home Assistant calls.

const STEP_KWH = 0.25;

// blocks: [{ start, end, buy, sell, house_kw, pv_kw, ev_kw }]
//   buy: all-in price of a kWh from the grid; sell: what an exported kWh earns
// bat: { capacity_kwh, soc_pct, min_pct, max_pct, charge_kw, discharge_kw,
//        efficiency (round trip, 0.9), wear (per kWh discharged),
//        actions: ['auto','hold','no_discharge','charge'], ev_discharge: 'never'|'solar_only'|'always' }
function planBattery(blocks, bat) {
  const cap = Number(bat.capacity_kwh) || 0;
  const result = { actions: [], saving: 0, cost: 0, baseline_cost: 0, notes: [] };
  if (!(cap > 0) || !blocks.length) { result.notes.push('no_battery_data'); return result; }
  const minK = cap * (Number(bat.min_pct) || 0) / 100;
  const maxK = cap * (Number.isFinite(Number(bat.max_pct)) ? Number(bat.max_pct) : 100) / 100;
  const eff = Math.min(1, Math.max(0.5, Number(bat.efficiency) || 0.9));
  const ec = Math.sqrt(eff);
  const ed = Math.sqrt(eff);
  const wear = Number(bat.wear) || 0;
  const allowed = new Set(bat.actions && bat.actions.length ? bat.actions : ['auto']);
  allowed.add('auto');
  const n = Math.round(cap / STEP_KWH);
  const startK = Math.max(0, Math.min(cap, cap * (Number(bat.soc_pct) || 0) / 100));
  const evAllowed = bat.ev_discharge === 'always';

  // One block, one action, from `soc` kWh: { soc: new kWh, grid (+import), cost, d, c }
  const stepOf = (b, soc, action) => {
    const h = (b.end - b.start) / 3600000;
    const house = Math.max(0, (b.house_kw || 0)) * h;
    const ev = Math.max(0, (b.ev_kw || 0)) * h;
    const pv = Math.max(0, (b.pv_kw || 0)) * h;
    const demand = house + ev - pv; // + import need, - surplus
    // What the battery may cover: the house, and the car only when allowed.
    const coverable = Math.max(0, house - pv) + (evAllowed ? ev : 0);
    const room = Math.max(0, maxK - soc);
    const chgCap = Math.max(0, (bat.charge_kw || 0) * h);
    const disCap = Math.max(0, (bat.discharge_kw || 0) * h);
    let c = 0; // energy into the battery (from the AC side)
    let d = 0; // energy out of the battery (to the AC side)
    if (action === 'auto' || action === 'no_discharge') c = Math.min(Math.max(0, -demand), chgCap, room / ec);
    if (action === 'auto') d = Math.min(Math.min(coverable, Math.max(0, demand)), disCap, Math.max(0, soc - minK) * ed);
    if (action === 'charge') c = Math.min(chgCap, room / ec);
    const grid = demand + c - d;
    const cost = (grid > 0 ? grid * b.buy : grid * (Number.isFinite(b.sell) ? b.sell : 0)) + d * wear;
    const next = Math.max(0, Math.min(cap, soc + c * ec - d / ed));
    return { soc: next, grid, cost, d, c };
  };

  // Value tables per level, read between two levels (no rounding: a small
  // discharge must not count as a whole step).
  const valueAt = (W, kwh) => {
    const x = Math.max(0, Math.min(n, kwh / STEP_KWH));
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    return n === 0 ? W[0] : W[i] * (1 - f) + W[i + 1] * f;
  };

  // Energy left at the end is worth what it saves later: an average price.
  const avgBuy = blocks.reduce((s, b) => s + b.buy, 0) / blocks.length;
  const endValue = Math.max(0, avgBuy * ed - wear);
  const endWorth = (kwh) => Math.max(0, kwh - minK) * endValue;
  const T = blocks.length;
  const ACTIONS = ['auto', 'hold', 'no_discharge', 'charge'];
  const choices = (t) => {
    const b = blocks[t];
    // With the car charging and no discharging into it, "auto" is not allowed.
    const evNow = (b.ev_kw || 0) > 0.05 && !evAllowed;
    return ACTIONS.filter((a) => allowed.has(a) && !(a === 'auto' && evNow && (allowed.has('hold') || allowed.has('no_discharge'))));
  };
  // Best action from `soc` in block t, with the values of block t+1.
  const best = (t, soc, Vnext) => {
    let v = Infinity;
    let act = 'auto';
    let res = null;
    for (const a of choices(t)) {
      const r = stepOf(blocks[t], soc, a);
      const val = r.cost + valueAt(Vnext, r.soc);
      // Prefer "auto" on (near) ties: no needless commands.
      if (val < v - 1e-6 || (Math.abs(val - v) <= 1e-6 && a === 'auto')) { v = val; act = a; res = r; }
    }
    return { v, act, r: res };
  };
  // V[t][k]: lowest cost from block t with k steps of energy.
  const V = new Array(T + 1);
  V[T] = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) V[T][k] = -endWorth(k * STEP_KWH);
  for (let t = T - 1; t >= 0; t--) {
    V[t] = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) V[t][k] = best(t, k * STEP_KWH, V[t + 1]).v;
  }

  // Forward from the real level: the chosen actions and the expected level.
  let soc = startK;
  let cost = 0;
  for (let t = 0; t < T; t++) {
    const { act, r } = best(t, soc, V[t + 1]);
    result.actions.push({ start: blocks[t].start, end: blocks[t].end, action: act, soc_pct: (r.soc / cap) * 100, grid_kwh: r.grid, charge_kwh: r.c, discharge_kwh: r.d, price: blocks[t].buy });
    cost += r.cost;
    soc = r.soc;
  }
  // Baseline: always "auto" (what the battery does on its own).
  let sb = startK;
  let base = 0;
  for (let t = 0; t < T; t++) {
    const r = stepOf(blocks[t], sb, 'auto');
    base += r.cost;
    sb = r.soc;
  }
  // Compare fairly: count the energy left at the end.
  result.cost = cost - endWorth(soc);
  result.baseline_cost = base - endWorth(sb);
  result.saving = result.baseline_cost - result.cost;
  return result;
}

module.exports = { planBattery, STEP_KWH };

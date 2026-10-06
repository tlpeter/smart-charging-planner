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
//        actions: ['auto','hold','no_discharge','charge'], ev_discharge: 'never'|'solar_only'|'always'|'range',
//        ev_from_pct, ev_to_pct (range: start into the car from this level, stop at that one) }
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
  const evMode = bat.ev_discharge;
  const evAlways = evMode === 'always';
  // "Between two levels": the battery may charge the car from ev_from_pct
  // down to ev_to_pct, and only again after it was back at ev_from_pct. The
  // plan keeps that "on/off" as part of its state, like the live control.
  const evRange = evMode === 'range';
  const fromK = cap * Math.min(100, Math.max(0, Number(bat.ev_from_pct) || 80)) / 100;
  const toK = cap * Math.min(100, Math.max(0, Number(bat.ev_to_pct) || 40)) / 100;
  const isEv = (b) => (b && b.ev_kw || 0) > 0.05;
  // on: the range is switched on. At the start of a block: on from the start
  // level, off at the stop level.
  const onAt = (soc, on) => (evRange ? (soc >= fromK - 1e-9 ? 1 : soc <= toK + 1e-9 ? 0 : on) : 0);
  const evOkAt = (soc, on) => evAlways || (evRange && onAt(soc, on) === 1);

  // One block, one action, from `soc` kWh: { soc: new kWh, grid (+import), cost, d, c, on }
  const stepOf = (b, soc, action, on) => {
    const h = (b.end - b.start) / 3600000;
    const house = Math.max(0, (b.house_kw || 0)) * h;
    const ev = Math.max(0, (b.ev_kw || 0)) * h;
    const pv = Math.max(0, (b.pv_kw || 0)) * h;
    const demand = house + ev - pv; // + import need, - surplus
    const evOk = evOkAt(soc, on);
    // What the battery may cover: the house, and the car only when allowed.
    const coverable = Math.max(0, house - pv) + (evOk ? ev : 0);
    // While the car charges in "between two levels": not below the stop level.
    const floor = evRange && evOk && ev > 0 ? Math.max(minK, toK) : minK;
    const room = Math.max(0, maxK - soc);
    const chgCap = Math.max(0, (bat.charge_kw || 0) * h);
    const disCap = Math.max(0, (bat.discharge_kw || 0) * h);
    let c = 0; // energy into the battery (from the AC side)
    let d = 0; // energy out of the battery (to the AC side)
    if (action === 'auto' || action === 'no_discharge') c = Math.min(Math.max(0, -demand), chgCap, room / ec);
    if (action === 'auto') d = Math.min(Math.min(coverable, Math.max(0, demand)), disCap, Math.max(0, soc - floor) * ed);
    if (action === 'charge') c = Math.min(chgCap, room / ec);
    const grid = demand + c - d;
    const cost = (grid > 0 ? grid * b.buy : grid * (Number.isFinite(b.sell) ? b.sell : 0)) + d * wear;
    const next = Math.max(0, Math.min(cap, soc + c * ec - d / ed));
    return { soc: next, grid, cost, d, c, on: onAt(next, onAt(soc, on)) };
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
  const choices = (t, soc, on) => {
    // With the car charging and no discharging into it, "auto" is not allowed.
    const evNow = isEv(blocks[t]) && !evOkAt(soc, on);
    return ACTIONS.filter((a) => allowed.has(a) && !(a === 'auto' && evNow && (allowed.has('hold') || allowed.has('no_discharge'))));
  };
  // Best action from `soc` (and range on/off) in block t, with the values of block t+1.
  const best = (t, soc, on, Vnext) => {
    let v = Infinity;
    let act = 'auto';
    let res = null;
    for (const a of choices(t, soc, on)) {
      const r = stepOf(blocks[t], soc, a, on);
      const val = r.cost + valueAt(Vnext[r.on], r.soc);
      // Prefer "auto" on (near) ties: no needless commands.
      if (val < v - 1e-6 || (Math.abs(val - v) <= 1e-6 && a === 'auto')) { v = val; act = a; res = r; }
    }
    return { v, act, r: res };
  };
  // V[t][on][k]: lowest cost from block t with k steps of energy.
  const layers = evRange ? [0, 1] : [0];
  const V = new Array(T + 1);
  V[T] = [new Float64Array(n + 1), new Float64Array(n + 1)];
  for (const on of layers) for (let k = 0; k <= n; k++) V[T][on][k] = -endWorth(k * STEP_KWH);
  for (let t = T - 1; t >= 0; t--) {
    V[t] = [new Float64Array(n + 1), new Float64Array(n + 1)];
    for (const on of layers) for (let k = 0; k <= n; k++) V[t][on][k] = best(t, k * STEP_KWH, on, V[t + 1]).v;
  }

  // Forward from the real level: the chosen actions and the expected level.
  const on0 = evRange && (bat.ev_range_active === true || startK >= fromK - 1e-9) ? 1 : 0;
  let soc = startK;
  let on = on0;
  let cost = 0;
  for (let t = 0; t < T; t++) {
    const { act, r } = best(t, soc, on, V[t + 1]);
    result.actions.push({ start: blocks[t].start, end: blocks[t].end, action: act, soc_pct: (r.soc / cap) * 100, grid_kwh: r.grid, charge_kwh: r.c, discharge_kwh: r.d, price: blocks[t].buy });
    cost += r.cost;
    soc = r.soc;
    on = r.on;
  }
  // Baseline: always "auto" (what the battery does on its own).
  let sb = startK;
  let ob = on0;
  let base = 0;
  for (let t = 0; t < T; t++) {
    const r = stepOf(blocks[t], sb, 'auto', ob);
    base += r.cost;
    sb = r.soc;
    ob = r.on;
  }
  // Compare fairly: count the energy left at the end.
  result.cost = cost - endWorth(soc);
  result.baseline_cost = base - endWorth(sb);
  result.saving = result.baseline_cost - result.cost;
  return result;
}

module.exports = { planBattery, STEP_KWH };

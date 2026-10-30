'use strict';

// More chargers, one connection: who may charge, and with how much current?
//
// 1. Order: Charge now (and other choices you made) first, then a car below
//    its minimum or preconditioning, then the car with the least room to
//    spare: the earliest "latest safe start" (Ready Guard: the energy it
//    needs, the time until it leaves and a margin). A car that leaves early
//    but needs little, waits for a car that leaves later but needs a lot.
//    Without a departure: last.
// 2. The first car gets what it wants if it fits. Otherwise lower its current
//    to at least 6 A, or pause it if that is not possible.
// 3. What is left is shared fairly by the others. A charger that can only
//    start and stop gets its full current or waits; a charger whose current
//    can be set gets at least 6 A or waits.
//
// Per phase (#29): the connection has a budget for L1, L2 and L3. A charger
// uses the phases it is wired to: a three-phase charger all three, a
// one-phase charger only its own phase. When that phase is not known, the
// app reserves the current on every phase (the safe side).
//
// Changes take time: a charger that is told to charge less still draws its
// old current for a while. So a charger may only go up as far as the others
// have already come down: per phase, max(now, new) of every charger and the
// home battery must fit. The rest follows in the next step.
//
// Home battery: it charges from the grid only with what is left after the
// chargers (the cars go first).
//
// Solar: only the first car charges on the sun (two chargers that both follow
// the same surplus would fight over it).

const MIN_A = 6;
const LINES = ['L1', 'L2', 'L3'];

const FIRST = { boost: 0, below_minimum: 1, preheat: 1, ready_guard: 2 };

function rank(c) {
  const p = c.priority || {};
  const group = FIRST[p.code] ?? (p.protect ? 2 : 3);
  const lss = Number.isFinite(p.latest_safe_start) ? p.latest_safe_start : Infinity;
  const dep = Number.isFinite(p.departure) ? p.departure : Infinity;
  return [group, lss, dep, c.order || 0];
}

function compare(a, b) {
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// The phases a charger or battery draws from. phases: how many it uses now
// (1 or 3); phase: 'L1' | 'L2' | 'L3' for one phase, or null when not known.
// gridPhases 1: a one-phase connection has only L1.
function linesOf({ phases = 3, phase = null, gridPhases = 3 } = {}) {
  if (gridPhases === 1) return ['L1'];
  if (phases !== 1) return LINES.slice();
  return LINES.includes(phase) ? [phase] : LINES.slice();
}

// Amps per phase from power (W) on the given number of phases.
function ampsOf(powerW, phases) {
  const w = Number(powerW);
  return Number.isFinite(w) && w > 0 ? w / 230 / (phases === 1 ? 1 : 3) : 0;
}

function asCapacity(cap) {
  if (cap == null) return null;
  if (typeof cap === 'number') return Object.fromEntries(LINES.map((l) => [l, cap]));
  return Object.fromEntries(Object.entries(cap).filter(([l, v]) => LINES.includes(l) && Number.isFinite(v)));
}

// chargers: [{ id, name, want: 'charge' | …, amps (wanted), can_set_current,
//              solar, priority: { code, protect, latest_safe_start, departure }, order,
//              lines: ['L1', …] (default all), measured_a: amps per phase now (default 0) }]
// capacity: amps per phase the chargers (and battery) may use together:
//   a number (the same on every phase), { L1, L2, L3 }, or null (unknown: no limit).
// battery: { lines, need_a (grid charging, per phase), measured_a } or null.
// Returns { order: [ids], result: { [id]: { amps, pause, reason } },
//           battery: { fits, reason } | null, left: { L1, … } | null }.
function share(chargers, capacity, { battery = null } = {}) {
  const wanting = chargers.filter((c) => c.want === 'charge').sort(compare);
  const result = {};
  const order = wanting.map((c) => c.id);
  const cap = asCapacity(capacity);
  const lines = (c) => (c.lines && c.lines.length ? c.lines : LINES).filter((l) => !cap || l in cap);
  const first = wanting[0];

  // Solar: only the first car.
  for (const c of wanting.slice(1)) {
    if (c.solar) result[c.id] = { amps: null, pause: true, reason: `Waiting: the sun goes to ${first.name} first` };
  }
  if (!cap) return { order, result, battery: null, left: null };

  const left = Object.fromEntries(Object.entries(cap).map(([l, v]) => [l, Math.max(0, v)]));
  const room = (c) => Math.min(...lines(c).map((l) => left[l]));
  const take = (c, amps) => { for (const l of lines(c)) left[l] -= amps; };
  const alloc = {};

  if (first) {
    const fa = Number(first.amps);
    const free = room(first);
    if (!Number.isFinite(fa) || fa < MIN_A || (fa > free && (!first.can_set_current || free < MIN_A))) {
      result[first.id] = { amps: null, pause: true, reason: 'Waiting: not enough connection capacity for this charger' };
    } else if (fa > free) {
      const amps = Math.floor(free);
      result[first.id] = { amps, pause: false, reason: `Sharing the connection: ${amps} A` };
      take(first, amps); alloc[first.id] = amps;
    } else {
      take(first, fa); alloc[first.id] = fa;
    }
  }

  // Fair share of what is left, in priority order, per phase.
  const todo = wanting.slice(1).filter((c) => !result[c.id]);
  while (todo.length) {
    const c = todo.shift();
    const fair = Math.min(...lines(c).map((l) => left[l] / (1 + todo.filter((o) => lines(o).includes(l)).length)));
    const free = room(c);
    const want = Number(c.amps) || 0;
    let amps;
    if (!c.can_set_current) amps = want <= free ? want : 0;
    else amps = Math.min(want, Math.floor(fair) >= MIN_A ? Math.floor(fair) : (free >= MIN_A ? MIN_A : 0));
    if (!Number.isFinite(amps) || amps < MIN_A) {
      result[c.id] = { amps: null, pause: true, reason: `Waiting: the connection is in use, ${first.name} goes first` };
      continue;
    }
    if (amps < want) result[c.id] = { amps, pause: false, reason: `Sharing the connection: ${amps} A` };
    take(c, amps); alloc[c.id] = amps;
  }

  // Changes take time: per phase, max(now, new) of everyone must fit.
  const measured = (c) => Math.max(0, Number(c.measured_a) || 0);
  const used = Object.fromEntries(Object.keys(cap).map((l) => [l, 0]));
  const add = (ls, amps) => { for (const l of ls) if (l in used) used[l] += amps; };
  for (const c of chargers) add(lines(c), Math.max(measured(c), alloc[c.id] || 0));
  const bLines = battery ? (battery.lines && battery.lines.length ? battery.lines : LINES).filter((l) => l in cap) : [];
  const bNow = battery ? Math.max(0, Number(battery.measured_a) || 0) : 0;
  add(bLines, bNow);
  // The battery is checked against what the chargers want, not against their
  // slower ramp: the cars go first, also when the battery is charging now.
  const wanted = { ...used };
  const over = (ls) => Math.max(0, ...ls.map((l) => used[l] - cap[l]));
  for (const c of wanting.slice().reverse()) {
    const a = alloc[c.id] || 0;
    const m = measured(c);
    const cut = over(lines(c));
    if (!(a > m) || !(cut > 0)) continue;
    const lower = Math.max(m, a - cut);
    const amps = Math.floor(lower + 1e-9);
    if (!c.can_set_current || amps < MIN_A) {
      if (m >= MIN_A && c.can_set_current) continue; // keeps charging at about its current level
      add(lines(c), m - a); // back to what it draws now (nothing, once paused)
      alloc[c.id] = 0;
      result[c.id] = { amps: null, pause: true, reason: 'Waiting: another charger is lowering its current first' };
      continue;
    }
    add(lines(c), Math.max(m, amps) - a);
    alloc[c.id] = amps;
    result[c.id] = { amps, pause: false, reason: `Sharing the connection: ${amps} A for now, more once the others have come down` };
  }

  let bat = null;
  if (battery) {
    const need = Math.max(0, Number(battery.need_a) || 0);
    const fits = bLines.every((l) => wanted[l] - bNow + Math.max(bNow, need) <= cap[l] + 1e-9);
    bat = { fits, reason: fits ? null : 'Waiting: the chargers use the connection; the battery does not charge from the grid now' };
  }
  const leftAfter = Object.fromEntries(Object.keys(cap).map((l) => [l, Math.round(Math.max(0, cap[l] - used[l]) * 10) / 10]));
  return { order, result, battery: bat, left: leftAfter };
}

// Amps per phase the chargers may use together: the main fuse minus what the
// house uses now (the grid meter minus the chargers and battery), minus a margin.
// phaseA: { L1, L2, L3 } fresh phase currents of the grid meter, or null;
// gridW: net power of the grid meter (W), or null.
// consumers: [{ lines, measured_a, power_w }] what the chargers and battery draw now.
// Returns { L1, L2, L3 } (one phase: { L1 }), or null without a main fuse.
// With no reading at all: the safe side, only the minimum current (6 A).
function capacity({ mainFuse, phases = 3, phaseA = null, gridW = null, consumers = [], margin = 1 }) {
  if (!(mainFuse > 0)) return null;
  const ls = phases === 1 ? ['L1'] : LINES;
  const out = {};
  if (phaseA && ls.every((l) => Number.isFinite(phaseA[l]))) {
    for (const l of ls) {
      const mine = consumers.reduce((a, c) => a + ((c.lines || LINES).includes(l) ? Math.max(0, Number(c.measured_a) || 0) : 0), 0);
      out[l] = Math.max(0, mainFuse - Math.max(0, phaseA[l] - mine) - margin);
    }
  } else if (Number.isFinite(gridW)) {
    const w = consumers.reduce((a, c) => a + Math.max(0, Number(c.power_w) || 0), 0);
    const houseA = (gridW - w) / 230 / ls.length;
    for (const l of ls) out[l] = Math.max(0, mainFuse - Math.max(0, houseA) - margin);
  } else {
    for (const l of ls) out[l] = Math.min(MIN_A, mainFuse);
  }
  return out;
}

// Older form, one number: the lowest phase. Kept for the overview and tests.
function available({ mainFuse, phases = 3, gridA = null, gridW = null, chargersW = 0, chargersA = 0, margin = 1 }) {
  if (!(mainFuse > 0)) return null;
  let houseA;
  if (Number.isFinite(gridA)) houseA = gridA - chargersA;
  else if (Number.isFinite(gridW)) houseA = (gridW - chargersW) / 230 / (phases === 1 ? 1 : 3);
  else houseA = 0;
  return Math.max(0, mainFuse - Math.max(0, houseA) - margin);
}

module.exports = { share, available, capacity, linesOf, ampsOf, compare, MIN_A, LINES };

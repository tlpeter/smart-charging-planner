'use strict';

// More chargers, one connection: who may charge, and with how much current?
//
// 1. Order: Charge now (and other choices you made) first, then a car below
//    its minimum or preconditioning, then the car with the least room to
//    spare: the earliest "latest safe start" (Ready Guard: the energy it
//    needs, the time until it leaves and a margin). A car that leaves early
//    but needs little, waits for a car that leaves later but needs a lot.
//    Without a departure: last.
// 2. The first car gets what it wants (less only when even that does not fit
//    and its charger can lower the current).
// 3. What is left is shared fairly by the others. A charger that can only
//    start and stop gets its full current or waits; a charger whose current
//    can be set gets at least 6 A or waits.
//
// Solar: only the first car charges on the sun (two chargers that both follow
// the same surplus would fight over it).

const MIN_A = 6;

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

// chargers: [{ id, name, want: 'charge' | …, amps (wanted), can_set_current,
//              solar, priority: { code, protect, latest_safe_start, departure }, order }]
// availableA: amps per phase the chargers may use together (null: unknown).
// Returns { order: [ids], result: { [id]: { amps, pause, reason } } }.
function share(chargers, availableA) {
  const wanting = chargers.filter((c) => c.want === 'charge').sort(compare);
  const result = {};
  const order = wanting.map((c) => c.id);
  if (!wanting.length) return { order, result };
  const first = wanting[0];

  // Solar: only the first car.
  for (const c of wanting.slice(1)) {
    if (c.solar) result[c.id] = { amps: null, pause: true, reason: `Waiting: the sun goes to ${first.name} first` };
  }
  const rest = wanting.slice(1).filter((c) => !result[c.id]);
  if (availableA == null) return { order, result };

  let left = availableA;
  const fa = Number(first.amps) || 0;
  if (fa > left && first.can_set_current && left >= MIN_A) {
    result[first.id] = { amps: Math.floor(left), pause: false, reason: `Sharing the connection: ${Math.floor(left)} A` };
    left = 0;
  } else {
    left -= fa;
  }

  // Fair share of what is left, in priority order.
  let todo = rest.slice();
  while (todo.length) {
    const fair = left / todo.length;
    const c = todo.shift();
    const want = Number(c.amps) || 0;
    let amps;
    if (!c.can_set_current) amps = want <= left ? want : 0;
    else amps = Math.min(want, Math.floor(fair) >= MIN_A ? Math.floor(fair) : (left >= MIN_A ? MIN_A : 0));
    if (amps <= 0) {
      result[c.id] = { amps: null, pause: true, reason: `Waiting: the connection is in use, ${first.name} goes first` };
      continue;
    }
    if (amps < want) result[c.id] = { amps, pause: false, reason: `Sharing the connection: ${amps} A` };
    left -= amps;
  }
  return { order, result };
}

// Amps per phase the chargers may use together: the main fuse minus what the
// house uses now (the grid meter minus the chargers), minus a margin.
// gridA: the highest phase current of the grid meter, or null; gridW: net
// power of the grid meter (W), or null; chargersW: what the chargers draw now.
function available({ mainFuse, phases = 3, gridA = null, gridW = null, chargersW = 0, chargersA = 0, margin = 1 }) {
  if (!(mainFuse > 0)) return null;
  let houseA;
  if (Number.isFinite(gridA)) houseA = gridA - chargersA;
  else if (Number.isFinite(gridW)) houseA = (gridW - chargersW) / 230 / (phases === 1 ? 1 : 3);
  else houseA = 0;
  return Math.max(0, mainFuse - Math.max(0, houseA) - margin);
}

module.exports = { share, available, compare, MIN_A };

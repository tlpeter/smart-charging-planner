'use strict';

// Charging on solar surplus, live. Pure logic: the server measures, this
// decides, the controller and the server send.
//
// available_w: what the car could use now without importing from the grid:
//   car power now + export now (+ the grid import you allow) - a small margin.
// Start only after the surplus held for start_delay, stop only after it was
// too low for stop_delay, so a passing cloud does not switch the charger on
// and off. Below 6 A on three phases the charger can switch to one phase, when
// it supports that and you allow it; back to three phases when there is
// enough for three phases again. Phases change at most every 10 minutes.

const VOLTAGE = 230;
const MIN_AMPS = 6;
const PHASE_GAP_MS = Number(process.env.SCP_PHASE_GAP_MS) || 10 * 60000; // SCP_PHASE_GAP_MS: tests only
const MARGIN_W = 100;

const minPower = (phases) => phases * VOLTAGE * MIN_AMPS;

function initialState() {
  return { active: false, since: null, below_since: null, phases: null, phase_at: null };
}

// input: { now, available_w, soc, max_soc, phases_now (charger set-up), max_amps,
//          can_switch_phases, start_delay_ms, stop_delay_ms }
// returns: { charge, amps, phases, reason, state }
function step(prev, input) {
  const st = { ...initialState(), ...(prev || {}) };
  const now = input.now;
  const fixedPhases = input.phases_now === 1 ? 1 : 3;
  let phases = st.phases || fixedPhases;
  if (!input.can_switch_phases) phases = fixedPhases;
  const avail = Number.isFinite(input.available_w) ? input.available_w - MARGIN_W : null;
  const maxAmps = input.max_amps || 16;
  // Without control over the current, the charger takes its maximum.
  const minA = Math.min(maxAmps, input.min_amps || MIN_AMPS);
  const need = (ph) => ph * VOLTAGE * minA;

  const out = (charge, reason, amps = null) => ({ charge, reason, amps, phases, state: st });
  if (avail == null) {
    st.active = false; st.since = null; st.below_since = null;
    return out(false, 'No grid meter reading, so the solar surplus is not known');
  }
  if (Number.isFinite(input.soc) && Number.isFinite(input.max_soc) && input.soc >= input.max_soc) {
    st.active = false; st.since = null; st.below_since = null;
    return out(false, `Battery at ${input.max_soc}%, the most to charge with solar`);
  }

  // Phases: one phase when there is not enough for three, three when there is.
  if (input.can_switch_phases && (st.phase_at == null || now - st.phase_at >= PHASE_GAP_MS)) {
    let want = phases;
    if (phases === 3 && avail < need(3) && avail >= need(1)) want = 1;
    if (phases === 1 && avail >= need(3) + 300) want = 3;
    if (want !== phases) {
      phases = want;
      st.phases = want;
      st.phase_at = now;
    }
  }
  st.phases = phases;

  const amps = Math.min(maxAmps, Math.floor(avail / (VOLTAGE * phases)));
  const enough = amps >= minA;
  if (!st.active) {
    if (!enough) {
      st.since = null;
      return out(false, `Solar surplus ${Math.max(0, Math.round(avail))} W, less than the ${need(phases)} W needed to charge (${phases} phase${phases > 1 ? 's' : ''} × ${minA} A)`);
    }
    if (st.since == null) st.since = now;
    if (now - st.since < (input.start_delay_ms || 0)) {
      return out(false, `Solar surplus ${Math.round(avail)} W, waiting until it lasts ${Math.round((input.start_delay_ms || 0) / 60000)} minutes`);
    }
    st.active = true;
    st.below_since = null;
  }
  if (enough) {
    st.below_since = null;
    return out(true, `Charging with solar surplus (${Math.round(avail)} W)`, amps);
  }
  if (st.below_since == null) st.below_since = now;
  if (now - st.below_since >= (input.stop_delay_ms || 0)) {
    st.active = false;
    st.since = null;
    return out(false, `Solar surplus too low for ${Math.round((input.stop_delay_ms || 0) / 60000)} minutes`);
  }
  // A short dip: keep charging at the minimum.
  return out(true, `Solar surplus dropped to ${Math.max(0, Math.round(avail))} W; keeps charging at ${minA} A for now`, minA);
}

module.exports = { step, initialState, minPower, VOLTAGE, MIN_AMPS, PHASE_GAP_MS };

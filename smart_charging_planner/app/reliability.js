'use strict';

// Ready Guard turns a cost-optimised plan into a best-effort promise.
// It deliberately uses less than the measured/planned power and keeps a
// separate time margin. That makes the status honest when charging slows down.

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const MIN_MARGIN_MS = 30 * MINUTE;
const POWER_CONFIDENCE = 0.90;
const EPSILON_KWH = 0.05;
// Missing known capacity is a real readiness risk. A missing optional
// forecast is only a warning when the real price horizon already covers the
// required energy.
const PRICE_RISK = ['not_enough_known_time'];
const PRICE_WARNING = ['not_enough_known_time', 'forecast_error', 'prices_incomplete'];

const finite = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v) => Number.isFinite(v) ? v : null;
const round = (v, digits = 1) => Number.isFinite(v) ? Number(v.toFixed(digits)) : null;

// Readable duration: "45 min", "3 h 20 min", "3 d 14 h".
function duration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const rest = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function evaluateReadyGuard(input = {}) {
  const now = finite(input.now) ?? Date.now();
  const deadline = finite(input.deadline);
  const neededKwh = finite(input.neededKwh);
  const plannedKwh = finite(input.plannedKwh) ?? 0;
  const nominalPowerKw = finite(input.powerKw);
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const notes = Array.isArray(input.notes) ? input.notes : [];
  const controlAllowed = input.controlAllowed === true;
  const enabled = input.enabled !== false;
  const requestedMargin = Math.max(30, finite(input.marginMinutes) ?? 30);
  const conservativePowerKw = nominalPowerKw > 0 ? nominalPowerKw * POWER_CONFIDENCE : null;
  const factors = [];

  factors.push({
    key: 'connected',
    state: input.plugged === true ? 'good' : input.plugged === false ? 'bad' : 'warn',
    label: input.plugged === true ? 'Car connected' : input.plugged === false ? 'Car not connected' : 'Connection unknown',
  });
  factors.push({
    key: 'car_data',
    state: input.carData && input.carData.ok === false ? 'warn' : 'good',
    label: input.carData && input.carData.ok === false ? 'Battery level estimated' : 'Battery data current',
  });
  factors.push({
    key: 'power',
    state: conservativePowerKw ? 'good' : 'bad',
    label: conservativePowerKw ? `Conservative power ${round(conservativePowerKw)} kW` : 'Charging power unknown',
  });
  const forecastPlan = blocks.some((b) => b && b.forecast);
  factors.push({
    key: 'prices',
    // Prices not yet known up to the departure is normal (tomorrow's prices
    // come around 13:00): shown, but it does not change the status.
    state: PRICE_WARNING.some((n) => notes.includes(n)) ? 'warn' : 'good',
    label: forecastPlan ? 'Plan partly uses forecast prices'
      : notes.includes('prices_incomplete') ? 'Prices not yet known up to departure'
        : notes.includes('forecast_error') ? 'Price forecast unavailable; real prices are sufficient'
          : 'Known prices cover the plan',
  });

  const base = {
    enabled,
    status: enabled ? 'no_goal' : 'off',
    base_status: 'no_goal',
    label: 'No ready time set',
    message: 'Set a departure to let Ready Guard protect a target.',
    reason: 'No departure set for Ready Guard',
    protect: false,
    control_allowed: controlAllowed,
    deadline: iso(deadline),
    needed_kwh: round(neededKwh),
    planned_kwh: round(plannedKwh),
    conservative_power_kw: round(conservativePowerKw),
    latest_safe_start: null,
    expected_ready: null,
    planned_ready: null,
    continuous_ready: null,
    safety_margin_minutes: null,
    buffer_minutes: null,
    shortfall_kwh: null,
    guard_until: null,
    factors,
  };
  if (!enabled) return {
    ...base,
    base_status: 'off',
    label: 'Ready Guard is off',
    message: 'Turn it on in Settings › Rules to protect departure targets.',
    reason: 'Ready Guard is disabled',
  };
  if (!deadline) return base;

  if (neededKwh == null || !conservativePowerKw) {
    return {
      ...base,
      status: controlAllowed ? 'action_needed' : 'advice_only',
      base_status: 'action_needed',
      label: controlAllowed ? 'Action needed' : 'Advice only · check setup',
      message: 'Ready Guard cannot calculate a safe start without battery and charging-power data.',
      reason: 'Ready Guard is missing battery or charging-power data',
    };
  }

  if (neededKwh <= EPSILON_KWH) {
    return {
      ...base,
      status: 'on_track',
      base_status: 'on_track',
      label: 'Ready now',
      message: 'The target is already reached.',
      reason: 'Ready Guard target is already reached',
      needed_kwh: 0,
      expected_ready: now,
      planned_ready: now,
      continuous_ready: now,
      buffer_minutes: Math.max(0, Math.round((deadline - now) / MINUTE)),
      shortfall_kwh: 0,
    };
  }

  const chargeMs = (neededKwh / conservativePowerKw) * HOUR;
  const safetyMs = Math.max(MIN_MARGIN_MS, requestedMargin * MINUTE, chargeMs * 0.15);
  const latestSafeStart = deadline - chargeMs - safetyMs;
  // "Expected ready" describes the plan the user sees, so use the end of
  // its final charging block when that plan contains all required energy.
  // Keep the uninterrupted estimate separate: Ready Guard needs that value
  // when it overrides the price plan and starts charging continuously.
  const continuousReady = now + chargeMs;
  const plannedReady = blocks.length ? Math.max(...blocks.map((b) => finite(b.end) || 0)) || null : null;
  const maxPossibleKwh = Math.max(0, (deadline - now) / HOUR) * conservativePowerKw;
  const shortfallKwh = Math.max(0, neededKwh - maxPossibleKwh);
  const planShort = plannedKwh + EPSILON_KWH < neededKwh;
  const expectedReady = !planShort && plannedReady ? plannedReady : continuousReady;
  const dataRisk = !!(input.carData && input.carData.ok === false);
  const priceRisk = PRICE_RISK.some((n) => notes.includes(n));
  const noBuffer = now >= latestSafeStart;
  let baseStatus = 'on_track';
  let label = 'On track';
  let message = plannedReady
    ? `The plan reaches the target with ${duration((deadline - plannedReady) / MINUTE)} to spare.`
    : 'The target fits before departure.';
  let reason = 'Ready Guard confirms the plan is on track';
  let protect = false;

  if (input.plugged === false) {
    baseStatus = 'action_needed';
    label = 'Plug in the car';
    message = 'The target cannot be protected until the car is connected.';
    reason = 'Ready Guard needs the car to be plugged in';
  } else if (input.plugged == null) {
    baseStatus = 'action_needed';
    label = 'Check the connection';
    message = 'Ready Guard cannot confirm that the car is connected.';
    reason = 'Ready Guard cannot confirm the car is plugged in';
  } else if (deadline <= now || shortfallKwh > EPSILON_KWH) {
    baseStatus = 'not_achievable';
    label = 'Target no longer achievable';
    message = `Even continuous charging is about ${round(shortfallKwh)} kWh short. Ready Guard charges as much as possible.`;
    reason = 'Ready Guard: too little time remains, charging continuously';
    protect = true;
  } else if (noBuffer) {
    baseStatus = 'at_risk';
    label = input.charging === true ? 'Ready Guard active' : 'Ready Guard starts charging';
    message = 'The safety buffer is used up. Cheap hours and solar-only mode are temporarily overridden.';
    reason = 'Ready Guard: latest safe start reached';
    protect = true;
  } else if (planShort || dataRisk || priceRisk) {
    baseStatus = 'at_risk';
    label = 'Watch this plan';
    message = planShort
      ? 'The known plan does not yet contain all required energy. Ready Guard will take over at the latest safe start.'
      : dataRisk
        ? 'The battery level is estimated. Ready Guard keeps extra time available.'
        : 'Part of the plan depends on incomplete price data. Ready Guard keeps extra time available.';
    reason = 'Ready Guard is monitoring a plan risk';
  }

  const status = !controlAllowed && protect ? 'advice_only' : baseStatus;
  if (!controlAllowed && protect) {
    label = `Advice only · ${label}`;
    message += ' Turn on Allow control to let the app act automatically.';
  }
  return {
    ...base,
    status,
    base_status: baseStatus,
    label,
    message,
    reason,
    protect,
    latest_safe_start: latestSafeStart,
    expected_ready: expectedReady,
    planned_ready: plannedReady,
    continuous_ready: continuousReady,
    safety_margin_minutes: Math.round(safetyMs / MINUTE),
    buffer_minutes: plannedReady ? Math.round((deadline - plannedReady) / MINUTE) : null,
    shortfall_kwh: round(shortfallKwh),
    guard_until: Math.min(deadline, continuousReady),
  };
}

module.exports = { evaluateReadyGuard, duration, POWER_CONFIDENCE, MIN_MARGIN_MS };

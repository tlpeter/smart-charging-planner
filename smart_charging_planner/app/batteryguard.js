'use strict';

// App-level bounds complement the battery's native protections. They cannot
// guarantee an exact physical cutoff while HA/the app/device is unavailable.
const MAX_AGE_MS = 15 * 60000;
const RESPONSE_MS = 2 * 60000;
const finite = (v) => v != null && typeof v !== 'boolean' && String(v).trim() !== '' && Number.isFinite(Number(v));
function reading(cfg, states, now = Date.now()) {
  const s = (states || []).find((x) => x.entity_id === cfg.soc_entity);
  const soc = s && finite(s.state) ? Number(s.state) : null;
  const at = s ? Date.parse(s.last_reported || s.last_updated || '') : NaN;
  const ok = soc != null && soc >= 0 && soc <= 100 && Number.isFinite(at) && at <= now + 60000 && now - at <= MAX_AGE_MS;
  return { ok, soc: ok ? soc : null, age_ms: Number.isFinite(at) ? Math.max(0, now - at) : null };
}
function constrain(want, cfg, control, states, now = Date.now()) {
  const r = reading(cfg, states, now);
  const limits = control.soc_limits || {};
  const lower = !!(control.actions.no_discharge || control.actions.hold || limits.min);
  const upper = !!(control.actions.hold || limits.max);
  const block = (code, reason, side) => ({
    action: side === 'lower' && control.actions.no_discharge ? 'no_discharge'
      : control.actions.hold ? 'hold' : 'release',
    code, reason, blocked: true, soc: r.soc,
  });
  if (!r.ok) return block('battery_soc_unknown', 'Battery control waits for a recent, valid battery level', 'both');
  if (cfg.min_pct > 0 && !lower) return { ...want, blocked: true, action: 'release', code: 'battery_min_unsupported', reason: 'The minimum level cannot be protected by this integration; automatic control is not possible with these limits' };
  if (cfg.max_pct < 100 && !upper) return { ...want, blocked: true, action: 'release', code: 'battery_max_unsupported', reason: 'This integration cannot safely stop charging at the chosen maximum; automatic charging is not possible with this limit' };
  const cap = Number(cfg.capacity_kwh);
  const hours = ((r.age_ms || 0) + RESPONSE_MS) / 3600000;
  const margin = (kw) => cap > 0 ? Math.max(0, Number(kw) || 0) * hours / cap * 100 : Infinity;
  const power = require('./battery').powerKw(cfg, states) || 0;
  const chargeEdge = (want.action === 'charge' || power > 0.05)
    && r.soc + margin(Math.max(Number(cfg.charge_kw) || 0, power)) >= cfg.max_pct;
  const dischargeEdge = want.action !== 'charge' && (['auto', 'discharge'].includes(want.action) || power < -0.05)
    && r.soc - margin(Math.max(Number(cfg.discharge_kw) || 0, -power)) <= cfg.min_pct;
  if (chargeEdge) return block('battery_max', 'Charging stopped before the configured maximum battery level', 'upper');
  if (dischargeEdge) return block('battery_min', 'Discharging stopped before the configured minimum battery level', 'lower');
  return { ...want, soc: r.soc, code: want.code || 'battery_plan' };
}
// Capture each writable entity before its first write, not from a guessed
// factory maximum. Preserve the original across partial failures and restarts.
function capture(commands, states, original = {}) {
  const out = { ...original };
  for (const c of commands) {
    const id = c.target && c.target.entity_id;
    if (!id || out[id] || c.service === 'button.press') continue;
    const st = states.find((s) => s.entity_id === id);
    const value = st && st.state;
    if (c.service === 'number.set_value') {
      if (!finite(value)) throw new Error('Cannot save the original battery number before changing it');
      out[id] = { service: c.service, value: Number(value) };
    } else if (c.service === 'select.select_option') {
      if (!st || !Array.isArray(st.attributes && st.attributes.options) || !st.attributes.options.includes(value)) throw new Error('Cannot save the original battery mode before changing it');
      out[id] = { service: c.service, value };
    } else if (['switch.turn_on', 'switch.turn_off'].includes(c.service)) {
      if (!['on', 'off'].includes(value)) throw new Error('Cannot save the original battery switch before changing it');
      out[id] = { service: value === 'on' ? 'switch.turn_on' : 'switch.turn_off', value };
    }
  }
  return out;
}
function restore(control, original) {
  if (!original || typeof original !== 'object') throw new Error('Original battery settings were not saved by the older version; restore the battery manually before releasing control');
  const cleanup = control.actions.auto ? control.actions.auto().filter((c) => !c.target || !c.target.entity_id || c.service === 'button.press') : [];
  const values = Object.entries(original).map(([id, item]) => ({
    service: item.service,
    data: item.service === 'number.set_value' ? { value: item.value } : item.service === 'select.select_option' ? { option: item.value } : {},
    target: { entity_id: id },
  }));
  const rank = (c) => c.service === 'number.set_value' ? 0 : c.service === 'select.select_option' ? 1 : 2;
  return [...cleanup, ...values.sort((a, b) => rank(a) - rank(b))];
}
function nativeLimits(control, cfg, states, original = {}) {
  const commands = [];
  for (const side of ['min', 'max']) {
    const id = control.soc_limits && control.soc_limits[side];
    if (!id) continue;
    const st = states.find((s) => s.entity_id === id);
    const baseline = original[id] ? original[id].value : st && st.state;
    if (!finite(baseline)) throw new Error('The original native battery level limit is unavailable');
    const attrs = st && st.attributes || {};
    const step = Number(attrs.step) > 0 ? Number(attrs.step) : 1;
    const requested = side === 'min' ? Math.max(Number(baseline), cfg.min_pct) : Math.min(Number(baseline), cfg.max_pct);
    const value = (side === 'min' ? Math.ceil(requested / step) : Math.floor(requested / step)) * step;
    if (value < Number(attrs.min ?? 0) || value > Number(attrs.max ?? 100)) throw new Error('The requested battery bound is outside the native control range');
    if (value !== Number(baseline)) commands.push({ service: 'number.set_value', data: { value }, target: { entity_id: id } });
  }
  return commands;
}
function merge(commands, bounds, control) {
  const out = commands.map((c) => ({ ...c, data: { ...c.data } }));
  for (const c of bounds) {
    const id = c.target.entity_id, existing = out.findLast((x) => x.service === 'number.set_value' && x.target && x.target.entity_id === id);
    if (existing) existing.data.value = id === control.soc_limits.min ? Math.max(existing.data.value, c.data.value) : Math.min(existing.data.value, c.data.value);
    else out.push(c);
  }
  // A restore followed by a stricter native bound writes only the final value.
  return out.filter((c, i) => !c.target || !c.target.entity_id || !out.slice(i + 1).some((x) => x.service === c.service && x.target && x.target.entity_id === c.target.entity_id));
}
module.exports = { reading, constrain, capture, restore, nativeLimits, merge, MAX_AGE_MS, RESPONSE_MS };

'use strict';

// Control check: find out HOW a charger can be controlled, without doing it.
//
// Sources (all read-only):
//   - the actions (services) of the charger's integration, from get_services,
//     with their fields and choices
//   - the charger device's own entities: number (current in A), switch, button
//
// Result: the possible methods for start/stop and for the charging current,
// a recommended method for each, and warnings about things that would fight
// with the app (for example the charger's own smart charging being on).

const START_WORDS = ['resume', 'start'];
const STOP_WORDS = ['pause', 'stop'];

function words(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// Walk fields, including fields grouped in collapsible sections.
function flatFields(fields) {
  const out = [];
  for (const [key, f] of Object.entries(fields || {})) {
    if (f && f.fields && !f.selector) out.push(...flatFields(f.fields));
    else out.push({ key, ...(f || {}) });
  }
  return out;
}

function selectOptions(field) {
  const sel = field.selector && field.selector.select;
  if (!sel || !Array.isArray(sel.options)) return [];
  return sel.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean).map(String);
}

function numberRange(field) {
  const n = field.selector && field.selector.number;
  return n ? { min: n.min ?? null, max: n.max ?? null, unit: n.unit_of_measurement || null } : null;
}

function targetKind(service) {
  const t = service.target || {};
  if (t.device) return 'device';
  if (t.entity) return 'entity';
  return null;
}

// Actions of the charger's integration(s).
// Options that mean one phase / three phases, e.g. Easee "1_phase" / "3_phase",
// go-e phase switch mode (psm) "1" / "2".
const ONE_PHASE = /^(1|1_phase|one_phase|single|single_phase|1p|phase_1)$/i;
const THREE_PHASE = /^(3|3_phase|three_phase|three|3p|phase_3)$/i;

function actionMethods(domains, services) {
  const startStop = [];
  const current = [];
  const phase = [];
  for (const domain of domains) {
    const svcs = services[domain] || {};
    for (const [name, svc] of Object.entries(svcs)) {
      const fields = flatFields(svc.fields);
      const label = svc.name || name;
      // The device as a field of the action (Easee: device_id must be a text
      // in the data, a target device would arrive as a list and is refused).
      const deviceField = fields.some((f) => f.key === 'device_id') ? 'device_id' : null;

      // One action with a choice that includes pause/resume or start/stop.
      for (const f of fields) {
        const opts = selectOptions(f);
        const on = START_WORDS.find((w) => opts.includes(w));
        const off = STOP_WORDS.find((w) => opts.includes(w));
        if (on && off) {
          // Prefer pause/resume: it keeps the session and authorisation.
          const pair = opts.includes('pause') && opts.includes('resume') ? ['resume', 'pause'] : [on, off];
          startStop.push({
            type: 'action_choice', domain, service: name, label, field: f.key,
            start_value: pair[0], stop_value: pair[1], target: targetKind(svc), device_field: deviceField,
            score: pair[0] === 'resume' ? 100 : 90,
          });
        }
      }

      // A pair of separate actions, e.g. start_charging / stop_charging.
      if (/^(resume|start)(_charg(e|ing))?$/.test(name)) {
        const stopName = Object.keys(svcs).find((n) => /^(pause|stop)(_charg(e|ing))?$/.test(n));
        if (stopName) {
          startStop.push({
            type: 'action_pair', domain, start_service: name, stop_service: stopName,
            label: `${name} / ${stopName}`, target: targetKind(svc), device_field: deviceField, score: 80,
          });
        }
      }

      // An action that switches between one and three phases.
      if (/phase/.test(name)) {
        for (const f of fields) {
          const opts = selectOptions(f);
          const one = opts.find((o) => ONE_PHASE.test(o));
          const three = opts.find((o) => THREE_PHASE.test(o));
          if (one && three) {
            phase.push({ type: 'action_phase', domain, service: name, label, field: f.key, one_value: one, three_value: three, target: targetKind(svc), device_field: deviceField, score: 90 });
          }
        }
      }

      // An action with a current field.
      const text = words(name, svc.name, svc.description);
      if (/circuit|offline|surplus|cost|access|phase_mode|ocpp|operator|plan/.test(name)) continue;
      const cf = fields.find((f) => {
        const r = numberRange(f);
        return r && (r.unit === 'A' || /current|amp|limit/.test(words(f.key, f.name, f.description)));
      });
      if (cf && /limit|current|amp/.test(text)) {
        const r = numberRange(cf);
        const ttlField = fields.find((f) => /ttl|time_to_live|duration|minutes/.test(words(f.key, f.name)));
        const dynamic = /dynamic/.test(text);
        current.push({
          type: 'action_current', domain, service: name, label, field: cf.key,
          min: r.min, max: r.max, ttl_field: ttlField ? ttlField.key : null,
          dynamic, target: targetKind(svc), device_field: deviceField,
          // Temporary (dynamic) limits are safest: they fall back by themselves.
          score: (dynamic ? 100 : 60) + (ttlField ? 10 : 0),
        });
      }
    }
  }
  return { startStop, current, phase };
}

// A select (choice list) that starts and stops charging, e.g.
//   go-e "Force state" (frc): 0 Neutral, 1 Don't charge, 2 Charge
//   Ohme "Charge mode": smart_charge, max_charge, paused
//   Alfen "Socket 1 operation mode": Operative, In-operative (turns the socket off)
const SELECT_START = ['2', 'charge', 'max_charge', 'on', 'operative'];
const SELECT_STOP = ['1', "don't charge", 'dont_charge', 'paused', 'pause', 'off', 'in-operative', 'inoperative'];
function selectMethod(e, s) {
  const a = (s && s.attributes) || {};
  const opts = Array.isArray(a.options) ? a.options.map(String) : [];
  const name = words(e.entity_id, a.friendly_name);
  if (!/frc|force.?state|charge.?mode|operation.?mode/.test(name)) return null;
  const find = (list) => opts.find((o) => list.includes(o.toLowerCase()));
  const on = find(SELECT_START);
  const off = find(SELECT_STOP);
  if (!on || !off || on === off) return null;
  const blunt = /operation.?mode/.test(name); // takes the whole socket out of service
  return { type: 'select', entity_id: e.entity_id, label: a.friendly_name || e.entity_id, start_option: on, stop_option: off, blunt, score: blunt ? 25 : 75 };
}

// The charger's own smart modes that would fight with the app. Values that
// mean "off / let others decide" are fine.
const NEUTRAL_MODES = new Set(['off', 'default', 'disable', 'disabled', 'normal', 'none', '3', 'manual']);
function ownModeWarning(e, s, domain) {
  if (!s) return null;
  const a = s.attributes || {};
  const name = words(e.entity_id, a.friendly_name);
  if (e.entity_id.startsWith('select.')) {
    // Wallbox Eco-Smart, Peblar smart charging, go-e logic mode, Alfen solar, Ohme charge mode
    if (!/ecosmart|eco.?smart|smart.?charging|solar.?charging|charging.?mode|charge.?mode|logic.?mode|_lmo\b/.test(name)) return null;
    const v = String(s.state || '').toLowerCase();
    if (!v || v === 'unavailable' || v === 'unknown' || NEUTRAL_MODES.has(v)) return null;
    if (/charge.?mode/.test(name) && ['max_charge', 'paused'].includes(v)) return null; // Ohme, controlled by the app
    return { code: 'own_mode_on', entity_id: e.entity_id, name: a.friendly_name || e.entity_id, state: s.state };
  }
  return null;
}

// Entities on the charger device.
function entityMethods(deviceEntities, states, domains = []) {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const startStop = [];
  const current = [];
  const phase = [];
  const warnings = [];
  const buttons = deviceEntities.filter((e) => e.entity_id.startsWith('button.'));
  // Whole words only, so "restart" is not "start".
  const tok = (e) => new Set(e.entity_id.toLowerCase().split(/[^a-z0-9]+/));
  const startBtn = buttons.find((e) => ['resume', 'start'].some((w) => tok(e).has(w)));
  const stopBtn = buttons.find((e) => ['pause', 'stop'].some((w) => tok(e).has(w)));
  if (startBtn && stopBtn) {
    startStop.push({ type: 'buttons', start_entity: startBtn.entity_id, stop_entity: stopBtn.entity_id, label: 'Buttons', score: 70 });
  }
  for (const e of deviceEntities) {
    const s = byId.get(e.entity_id);
    const a = (s && s.attributes) || {};
    const name = words(e.entity_id, a.friendly_name);
    if (e.entity_id.startsWith('number.') && a.unit_of_measurement === 'A' && !/circuit|offline/.test(name)) {
      current.push({ type: 'number', entity_id: e.entity_id, label: a.friendly_name || e.entity_id, min: a.min ?? null, max: a.max ?? null, score: /dynamic|charg/.test(name) ? 85 : 75 });
    }
    if (e.entity_id.startsWith('switch.')) {
      // Compare whole words, so "enabled" does not look like "led".
      const tokens = new Set(name.split(/[^a-z0-9]+/));
      const has = (...w) => w.some((x) => tokens.has(x));
      // Easee's "Smart charging" switch only changes the LED colour.
      const easeeLed = domains.includes('easee') && has('smart') && !has('schedule', 'plan');
      if (has('smart', 'schedule', 'plan', 'eco', 'solar', 'pv', 'surplus', 'fup') && s && s.state === 'on' && !easeeLed) {
        warnings.push({ code: 'own_smart_charging_on', entity_id: e.entity_id, name: a.friendly_name || e.entity_id });
      }
      // Peblar "Force single phase": on = one phase, off = three phases.
      if ((has('single') && has('phase')) || /1.?phase|one.?phase/.test(name)) {
        phase.push({ type: 'switch_phase', entity_id: e.entity_id, label: a.friendly_name || e.entity_id, score: 70 });
      }
      const other = has('smart', 'schedule', 'plan', 'eco', 'cable', 'lock', 'light', 'led', 'idle', 'current', 'phase', 'ocpp');
      if (!other && has('charging', 'charger', 'charge', 'enabled', 'enable', 'pause', 'start')) {
        // A switch that turns the whole charger off is a blunt tool.
        const blunt = has('enabled', 'enable');
        startStop.push({ type: 'switch', entity_id: e.entity_id, label: a.friendly_name || e.entity_id, blunt, score: blunt ? 30 : 60 });
      }
    }
    if (e.entity_id.startsWith('select.') && /\bpsm\b|_psm\b|phase/.test(name)) {
      const opts = Array.isArray(a.options) ? a.options.map(String) : [];
      // go-e psm: 0 = auto, 1 = one phase, 2 = three phases.
      const goe = /\bpsm\b|_psm\b/.test(name) && opts.includes('1') && opts.includes('2');
      const one = goe ? '1' : opts.find((o) => ONE_PHASE.test(o));
      const three = goe ? '2' : opts.find((o) => THREE_PHASE.test(o));
      if (one && three) phase.push({ type: 'select_phase', entity_id: e.entity_id, label: a.friendly_name || e.entity_id, one_value: one, three_value: three, score: 80 });
    }
    if (e.entity_id.startsWith('select.')) {
      const m = selectMethod(e, s);
      if (m) startStop.push(m);
      const w = ownModeWarning(e, s);
      if (w) warnings.push(w);
    }
  }
  return { startStop, current, phase, warnings };
}

function checkControl({ charger, entities, states, services }) {
  if (!charger) return { available: false, reason: 'no_charger' };
  const deviceEntities = charger.device_id ? entities.filter((e) => e.device_id === charger.device_id && !e.disabled_by) : [];
  const domains = [...new Set([charger.integration, ...deviceEntities.map((e) => e.platform)].filter(Boolean))];

  const a = actionMethods(domains, services || {});
  const e = entityMethods(deviceEntities, states, domains);
  const withId = (m) => ({ ...m, id: `${m.type}:${m.service || m.start_service || m.entity_id || m.start_entity}${m.domain ? '@' + m.domain : ''}` });
  const startStop = [...a.startStop, ...e.startStop].map(withId).sort((x, y) => y.score - x.score);
  const current = [...a.current, ...e.current].map(withId).sort((x, y) => y.score - x.score);
  const phase = [...a.phase, ...e.phase].map(withId).sort((x, y) => y.score - x.score);

  const warnings = [...e.warnings];
  if (!startStop.length) warnings.push({ code: 'no_start_stop' });
  if (!current.length) warnings.push({ code: 'no_current' });
  if (startStop[0] && startStop[0].blunt) warnings.push({ code: 'blunt_switch', entity_id: startStop[0].entity_id });
  if (!charger.device_id) warnings.push({ code: 'no_device' });
  // Integrations that can only read, not control.
  if (domains.includes('tesla_wall_connector') && !startStop.length) warnings.push({ code: 'read_only_integration', integration: 'Tesla Wall Connector' });
  if (domains.includes('alfen_wallbox')) warnings.push({ code: 'alfen_single_login' });
  if (domains.includes('ocpp')) warnings.push({ code: 'ocpp_backend' });

  return {
    available: true,
    domains,
    device_id: charger.device_id || null,
    start_stop: startStop,
    current,
    phase,
    recommended: { start_stop: startStop[0] || null, current: current[0] || null, phase: phase[0] || null },
    warnings,
  };
}

module.exports = { checkControl, flatFields, selectOptions };

'use strict';

// Notifications to your phones and the app's own sensors in Home Assistant.
// Recipients are chosen in the app (Settings › Notifications): each with its
// notify action, its cars and which messages it gets. "Publish sensors" (write
// sensor.smart_charging_* for dashboards) is set in the app's Configuration tab.

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');
const scope = require('./scope');

// More chargers: which charger a message or sensor is about. Set by the
// server: () => null (one charger) or { name, slug, primary }.
let chargerContext = () => null;
function setChargerContext(fn) {
  chargerContext = fn;
}

// What the app can send, in five groups. Each recipient chooses per message
// (Settings › Notifications); a message that is new in a later version is on.
const CATEGORIES = [
  { id: 'problems', name: 'Problems', text: 'Something did not work: the charger, the Equalizer or the car\'s charge limit.' },
  { id: 'action', name: 'Action needed', text: 'Ready Guard and questions only you can answer.' },
  { id: 'car', name: 'Car', text: 'The car\'s cloud, its charge limit and your Ready-for choice.' },
  { id: 'startstop', name: 'Start and pause', text: 'Every time charging starts or pauses.' },
  { id: 'battery', name: 'Home battery', text: 'What the home battery does.' },
];
const MESSAGES = [
  { id: 'charger_failed', category: 'problems', name: 'Charger command failed' },
  { id: 'charger_no_react', category: 'problems', name: 'Charger did not start or pause' },
  { id: 'equalizer_failed', category: 'problems', name: 'Easee Equalizer command failed' },
  { id: 'carlimit_failed', category: 'problems', name: 'Car charge limit not changed' },
  { id: 'rg_risk', category: 'action', name: 'Ready Guard: target at risk' },
  { id: 'rg_active', category: 'action', name: 'Ready Guard takes over' },
  { id: 'rg_needs_you', category: 'action', name: 'Ready Guard needs you (plug in, allow control)' },
  { id: 'which_car', category: 'action', name: 'Which car is connected?' },
  { id: 'car_offline', category: 'car', name: 'Car not reachable' },
  { id: 'car_online', category: 'car', name: 'Car reachable again' },
  { id: 'carlimit_changed', category: 'car', name: 'Car charge limit changed' },
  { id: 'chargefor_gone', category: 'car', name: 'Ready-for choice ended' },
  { id: 'charging_started', category: 'startstop', name: 'Charging started' },
  { id: 'charging_paused', category: 'startstop', name: 'Charging paused' },
  { id: 'battery_action', category: 'battery', name: 'Home battery: what it does now' },
  { id: 'battery_failed', category: 'battery', name: 'Home battery command failed' },
];
const MESSAGE = Object.fromEntries(MESSAGES.map((m) => [m.id, m]));
const MAX_RECIPIENTS = 10;

// More cars: which car a message is about. Set by the server: () => vehicle id or null.
let vehicleContext = () => null;
function setVehicleContext(fn) {
  vehicleContext = fn;
}

// The recipients: [{ id, name, service, cars: null (all) | [vehicle ids], off: [message ids] }].
// Settings from before more recipients ({ service }) become one recipient,
// "My phone", with the same messages as before ("Notify every start and
// pause" off: start, pause and home battery messages off).
function fromOld(n) {
  if (!n || !n.service) return [];
  const off = options.notify_start_stop === false ? ['charging_started', 'charging_paused', 'battery_action'] : [];
  return [{ id: 'r1', name: 'My phone', service: ha.normaliseNotify(n.service), cars: null, off }];
}
function recipients() {
  const s = settings.load();
  const n = s.notify || {};
  const list = Array.isArray(n.recipients) ? n.recipients : fromOld(n);
  if (!Array.isArray(n.recipients) && list.length) {
    // Save the new form once, so it does not depend on the old option any more.
    try { settings.save({ ...s, notify: { recipients: list } }); } catch { /* read-only: again next time */ }
  }
  ha.setNotifyTargets(list.map((r) => r.service));
  return list;
}
// Kept for the checklist and old callers: the first recipient's action.
function target() {
  const r = recipients();
  return r.length ? r[0].service : '';
}
function wants(r, messageId, vehicleId) {
  if ((r.off || []).includes(messageId)) return false;
  if (vehicleId && Array.isArray(r.cars) && !r.cars.includes(vehicleId)) return false;
  return true;
}

const lastSentByKey = new Map(); // key -> time, to avoid repeating the same message
let lastNotification = null; // { at, title, message, sent, error, to }
const lastByRecipient = new Map(); // recipient id -> { at, title, sent, error }

// messageId: one of MESSAGES (or 'test'). key + minGapMs: do not repeat the
// same message too often. vehicleId: the car it is about (default: the car of
// this charger); a recipient that chose other cars does not get it.
// only: send to this recipient only (test).
async function notify(messageId, title, message, { key = null, minGapMs = 0, vehicleId, only = null } = {}) {
  const list = recipients();
  if (!list.length) return { sent: false, reason: 'off' };
  const m = MESSAGE[messageId];
  const car = m && m.category !== 'battery' ? (vehicleId !== undefined ? vehicleId : vehicleContext()) : null;
  const to = list.filter((r) => (only ? r.id === only : messageId === 'test' || wants(r, messageId, car)));
  if (!to.length) return { sent: false, reason: 'no_recipient' };
  const ctx = chargerContext();
  if (ctx) {
    title = `${title} · ${ctx.name}`;
    if (key) key = `${key}@${scope.id()}`;
  }
  if (key) {
    const at = lastSentByKey.get(key);
    if (at && Date.now() - at < minGapMs) return { sent: false, reason: 'repeat' };
    lastSentByKey.set(key, Date.now());
  }
  const results = await Promise.all(to.map(async (r) => {
    try {
      await ha.sendNotification(r.service, title, message);
      lastByRecipient.set(r.id, { at: Date.now(), title, sent: true, error: null });
      return { id: r.id, sent: true };
    } catch (err) {
      lastByRecipient.set(r.id, { at: Date.now(), title, sent: false, error: err.message });
      ha.warn(`Notification to ${r.name} failed:`, err.message);
      return { id: r.id, sent: false, error: err.message };
    }
  }));
  const sent = results.some((x) => x.sent);
  const error = results.filter((x) => !x.sent).map((x) => x.error).join('; ') || null;
  lastNotification = { at: Date.now(), title, message, sent, error, to: to.map((r) => r.name) };
  return sent ? { sent: true, results } : { sent: false, error, results };
}

// Check and tidy a list of recipients from the page. services: the notify
// actions that exist; cars: the ids of the app's cars.
function cleanRecipients(list, services, cars) {
  if (!Array.isArray(list)) throw Object.assign(new Error('Send a list of recipients'), { status: 400 });
  if (list.length > MAX_RECIPIENTS) throw Object.assign(new Error(`At most ${MAX_RECIPIENTS} recipients`), { status: 400 });
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const used = new Set();
  return list.map((r, i) => {
    const name = String((r && r.name) || '').trim().replace(/\s+/g, ' ').slice(0, 40) || `Device ${i + 1}`;
    const service = ha.normaliseNotify(r && r.service);
    if (!service) throw bad(`${name}: choose a notify action`);
    if (!services.includes(service)) throw bad(`${name}: ${service} is not a notify action in Home Assistant; choose one from the list`);
    let id = String((r && r.id) || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 20);
    if (!id || used.has(id)) { let k = i + 1; while (used.has(`r${k}`)) k++; id = `r${k}`; }
    used.add(id);
    const carList = r && Array.isArray(r.cars) ? r.cars.map(String).filter((c) => cars.includes(c)) : null;
    const off = r && Array.isArray(r.off) ? [...new Set(r.off.map(String).filter((x) => MESSAGE[x]))] : [];
    return { id, name, service, cars: carList, off };
  });
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

const published = new Map(); // entity_id -> JSON of what was last written
let lastPublish = null; // { at, count, error }

// Home Assistant forgets these sensors when it restarts; write them all again
// after every (re)connect.
ha.onConnect(() => published.clear());

const iso = (ms) => (ms ? new Date(ms).toISOString() : 'unknown');
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 'unknown');

function sensorsFor(d, n, extra = {}) {
  const p = (d && d.plan) || { periods: [], blocks: [], notes: [] };
  const now = Date.now();
  const next = (p.periods || []).find((x) => x.end > now) || null;
  const currency = (d && d.currency) || 'EUR';
  const want = n ? { charge: 'charging', pause: 'paused', leave: 'waiting', none: 'idle' }[n.want] || n.want : 'unknown';
  const dep = d && d.departure;
  return [
    ['sensor.smart_charging_status', want, {
      friendly_name: 'Smart Charging status',
      icon: 'mdi:ev-station',
      reason: n ? n.reason : null,
      live: !!(d && d.control_allowed),
      charge_now: !!(d && d.boost),
      last_command: extra.lastCommand || null,
      vehicle: d && d.vehicle ? d.vehicle.name : null,
      vehicle_how: d && d.cars ? d.cars.how : null,
    }],
    ['sensor.smart_charging_next_start', next ? iso(next.start) : 'unknown', {
      friendly_name: 'Smart Charging next start', device_class: 'timestamp', icon: 'mdi:clock-start',
      end: next ? iso(next.end) : null,
      energy_kwh: next ? round(next.kwh, 1) : null,
      forecast: next ? !!next.forecast : null,
    }],
    ['sensor.smart_charging_next_end', next ? iso(next.end) : 'unknown', {
      friendly_name: 'Smart Charging next end', device_class: 'timestamp', icon: 'mdi:clock-end',
    }],
    ['sensor.smart_charging_planned_energy', round(p.planned_kwh, 1), {
      friendly_name: 'Smart Charging planned energy', unit_of_measurement: 'kWh', icon: 'mdi:battery-charging',
    }],
    ['sensor.smart_charging_planned_cost', round(p.cost, 2), {
      friendly_name: 'Smart Charging planned cost', unit_of_measurement: currency, device_class: 'monetary',
    }],
    ['sensor.smart_charging_saving', round(p.savings, 2), {
      friendly_name: 'Smart Charging saving', unit_of_measurement: currency, device_class: 'monetary',
    }],
    ['sensor.smart_charging_departure', dep ? iso(dep.time) : 'unknown', {
      friendly_name: 'Smart Charging departure', device_class: 'timestamp', icon: 'mdi:car-clock',
      target_soc: dep ? dep.soc : null,
      source: dep ? dep.source : null,
      title: dep ? dep.title || null : null,
    }],
    ['binary_sensor.smart_charging_charge_now', d && d.boost ? 'on' : 'off', {
      friendly_name: 'Smart Charging charge now', icon: 'mdi:lightning-bolt',
    }],
    ['sensor.smart_charging_ready_guard', d && d.reliability ? d.reliability.status : 'unknown', {
      friendly_name: 'Smart Charging Ready Guard',
      icon: 'mdi:shield-check',
      base_status: d && d.reliability ? d.reliability.base_status : null,
      message: d && d.reliability ? d.reliability.message : null,
      protecting: !!(d && d.reliability && d.reliability.protect),
      latest_safe_start: d && d.reliability ? iso(d.reliability.latest_safe_start) : null,
      expected_ready: d && d.reliability ? iso(d.reliability.expected_ready) : null,
      safety_margin_minutes: d && d.reliability ? d.reliability.safety_margin_minutes : null,
      shortfall_kwh: d && d.reliability ? d.reliability.shortfall_kwh : null,
    }],
  ];
}

// Write the sensors that changed.
async function publishSensors(d, n, extra) {
  if (options.publish_sensors !== true || !d) return;
  let count = 0;
  // More chargers: the first charger keeps sensor.smart_charging_*; another
  // gets sensor.smart_charging_<charger>_*.
  const ctx = chargerContext();
  const rename = (id) => (ctx && !ctx.primary ? id.replace(/^(\w+\.smart_charging)_/, `$1_${ctx.slug}_`) : id);
  try {
    for (const [rawId, state, rawAttrs] of sensorsFor(d, n, extra)) {
      const id = rename(rawId);
      const attrs = ctx ? { ...rawAttrs, friendly_name: `${rawAttrs.friendly_name} (${ctx.name})`, charger: ctx.name } : rawAttrs;
      const json = JSON.stringify([state, attrs]);
      if (published.get(id) === json) continue;
      await ha.setState(id, state, attrs);
      published.set(id, json);
      count++;
    }
    lastPublish = { at: Date.now(), count, error: null };
  } catch (err) {
    lastPublish = { at: Date.now(), count, error: err.message };
    ha.warn('Publishing sensors failed:', err.message);
  }
}

function status() {
  const list = recipients();
  return {
    notify_service: list.length ? list[0].service : null,
    recipients: list.map((r) => ({ ...r, last: lastByRecipient.get(r.id) || null })),
    categories: CATEGORIES,
    messages: MESSAGES,
    last_notification: lastNotification,
    publish_sensors: options.publish_sensors,
    last_publish: lastPublish,
  };
}

module.exports = { notify, publishSensors, sensorsFor, status, target, recipients, cleanRecipients, setChargerContext, setVehicleContext, CATEGORIES, MESSAGES };

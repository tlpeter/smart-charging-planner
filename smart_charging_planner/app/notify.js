'use strict';

// Notifications to your phone and the app's own sensors in Home Assistant.
// The notify action is chosen in the app (Settings › Status); the rest is set
// in the app's Configuration tab:
//   - notify_start_stop: also notify every start and pause (problems always)
//   - publish_sensors: write sensor.smart_charging_* for dashboards

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');

// The chosen notify action (Settings › Status in the app).
function target() {
  const s = settings.load();
  const t = ha.normaliseNotify((s.notify && s.notify.service) || '');
  ha.setNotifyTarget(t);
  return t;
}

const lastSentByKey = new Map(); // key -> time, to avoid repeating the same message
let lastNotification = null; // { at, title, message, sent, error }

// kind: 'startstop' (can be switched off) or 'problem' (always, when a notify
// action is set). key + minGapMs: do not repeat the same message too often.
async function notify(kind, title, message, { key = null, minGapMs = 0 } = {}) {
  if (!target()) return { sent: false, reason: 'off' };
  if (kind === 'startstop' && !options.notify_start_stop) return { sent: false, reason: 'start_stop_off' };
  if (key) {
    const at = lastSentByKey.get(key);
    if (at && Date.now() - at < minGapMs) return { sent: false, reason: 'repeat' };
    lastSentByKey.set(key, Date.now());
  }
  lastNotification = { at: Date.now(), title, message, sent: false, error: null };
  try {
    await ha.sendNotification(title, message);
    lastNotification.sent = true;
    return { sent: true };
  } catch (err) {
    lastNotification.error = err.message;
    ha.warn('Notification failed:', err.message);
    return { sent: false, error: err.message };
  }
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
  ];
}

// Write the sensors that changed.
async function publishSensors(d, n, extra) {
  if (options.publish_sensors !== true || !d) return;
  let count = 0;
  try {
    for (const [id, state, attrs] of sensorsFor(d, n, extra)) {
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
  const s = settings.load();
  return {
    notify_service: target() || null,
    notify_source: s.notify && s.notify.service ? 'app' : null,
    notify_start_stop: options.notify_start_stop,
    last_notification: lastNotification,
    publish_sensors: options.publish_sensors,
    last_publish: lastPublish,
  };
}

module.exports = { notify, publishSensors, sensorsFor, status, target };

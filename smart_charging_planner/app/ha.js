'use strict';

// Home Assistant WebSocket client.
// Connects through the Supervisor, authenticates, and lets the rest of the app
// send commands and wait for their result.

const WebSocket = require('ws');

const HA_WS_URL = process.env.HA_WS_URL || 'ws://supervisor/core/websocket';
const TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';

const state = {
  connected: false,
  version: null,
  timeZone: 'UTC',
  currency: 'EUR',
  lastError: null,
};

let socket = null;
let nextId = 1;
const pending = new Map();
const connectListeners = [];

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
const { options } = require('./options');
const threshold = LEVELS[options.log_level] || LEVELS.info;

function logAt(level, args) {
  if (LEVELS[level] < threshold) return;
  const line = [new Date().toISOString(), level.toUpperCase(), ...args];
  (level === 'error' || level === 'warning' ? console.error : console.log)(...line);
}

function log(...args) { logAt('info', args); }
function debug(...args) { logAt('debug', args); }
function warn(...args) { logAt('warning', args); }

// SAFETY: WebSocket commands the app may send. All of them only read.
const READ_ONLY_COMMANDS = new Set([
  'get_states',
  'get_config',
  'config/entity_registry/list',
  'config/device_registry/list',
  'recorder/statistics_during_period',
  'history/history_during_period',
  'get_services',
  'search/related', // which automations and scripts use an entity (to warn about conflicts)
  'energy/solar_forecast', // the solar forecast of the Energy dashboard
  'energy/get_prefs', // which solar forecasts are in the Energy dashboard
]);
const ACTION_TOKEN = Symbol('read-only action');
const CALENDAR_WRITE_TOKEN = Symbol('calendar write');
const CONTROL_TOKEN = Symbol('charger control');
const NOTIFY_TOKEN = Symbol('notification');
const REST_URL = process.env.HA_REST_URL || 'http://supervisor/core/api';

// Send a command to Home Assistant and wait for its result.
function call(message, timeoutMs = 20000, token = null) {
  return new Promise((resolve, reject) => {
    const allowed = READ_ONLY_COMMANDS.has(message.type) ||
      (message.type === 'call_service' && token === ACTION_TOKEN) ||
      // The only write: adding a calendar event, and only when the user
      // switched on "Allow adding trips to calendar".
      (message.type === 'call_service' && token === CALENDAR_WRITE_TOKEN &&
        message.domain === 'calendar' && message.service === 'create_event' &&
        options.allow_calendar_write === true) ||
      // Starting or stopping the charger, only when "Allow control" is on
      // and only through sendControl() below.
      (message.type === 'call_service' && token === CONTROL_TOKEN && options.allow_control === true) ||
      // Sending a notification, only to the notify action set in the
      // Configuration tab.
      (message.type === 'call_service' && token === NOTIFY_TOKEN && message.domain === 'notify' &&
        !!notifyTarget && `notify.${message.service}` === notifyTarget);
    if (!allowed) {
      warn('Refused command', message.type, '- it is not on the read-only list');
      reject(new Error(`Command ${message.type} is not allowed: the app only reads data`));
      return;
    }
    if (!state.connected) {
      reject(new Error('Not connected to Home Assistant'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, ...message }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Timeout waiting for Home Assistant'));
      }
    }, timeoutMs);
  });
}

// SAFETY: the app may only call actions on this list. They all just return
// data and change nothing. Any other action is refused, even if some other
// part of the code asks for it. Controlling devices will get its own, separate
// path that also requires "Allow control" in the Configuration tab.
const READ_ONLY_ACTIONS = new Set([
  'energyzero.get_energy_prices',
  'easyenergy.get_energy_usage_prices',
  'tibber.get_prices',
  'nordpool.get_prices_for_date',
  'calendar.get_events',
]);

// Call an action (service) that returns data, e.g. energyzero.get_energy_prices.
async function callAction(domain, service, serviceData, target = null) {
  const name = `${domain}.${service}`;
  if (!READ_ONLY_ACTIONS.has(name)) {
    warn('Refused action', name, '- it is not on the read-only list');
    throw new Error(`Action ${name} is not allowed: the app only reads data`);
  }
  debug('Calling read-only action', name);
  const message = {
    type: 'call_service',
    domain,
    service,
    service_data: serviceData,
    return_response: true,
  };
  if (target) message.target = target;
  const result = await call(message, 20000, ACTION_TOKEN);
  return result && result.response;
}

// Add one event to a calendar. Refused unless "Allow adding trips to calendar"
// is on in the Configuration tab.
async function createCalendarEvent(calendarEntity, data) {
  if (options.allow_calendar_write !== true) {
    warn('Refused calendar.create_event - "Allow adding trips to calendar" is off');
    throw new Error('Adding trips is switched off (test mode). Turn on "Allow adding trips to calendar" in the app\'s Configuration tab.');
  }
  if (!String(calendarEntity || '').startsWith('calendar.')) throw new Error('No calendar chosen');
  log('Adding calendar event to', calendarEntity, '-', data.summary, data.start_date_time);
  return call({
    type: 'call_service',
    domain: 'calendar',
    service: 'create_event',
    service_data: data,
    target: { entity_id: calendarEntity },
  }, 20000, CALENDAR_WRITE_TOKEN);
}

// SAFETY: domains the app never controls, whatever method is chosen. This
// keeps your automations, scripts, helpers and settings untouched.
const NEVER_CONTROL_DOMAINS = new Set([
  'automation', 'script', 'scene', 'homeassistant', 'hassio', 'input_boolean', 'input_number',
  'input_select', 'input_text', 'input_datetime', 'input_button', 'recorder', 'system_log',
  'logger', 'persistent_notification', 'notify', 'shell_command', 'rest_command', 'python_script',
  'pyscript', 'calendar', 'counter', 'timer', 'zone', 'person', 'update', 'backup', 'frontend',
  'lovelace', 'schedule', 'climate', 'lock', 'alarm_control_panel', 'cover', 'light', 'media_player',
]);

const CONTROL_DOMAINS = new Set(['switch', 'button', 'select', 'number']);
const { KNOWN_CHARGER_DOMAINS } = require('./chargers');

// Start or stop the charger. Refused unless "Allow control" is on, and only
// for the exact action or entity of the start/stop method the user chose.
// allowed: [{ service: 'switch.turn_on', entity_id: 'switch.x' }, ...]
async function sendControl(command, allowed) {
  if (options.allow_control !== true) {
    warn('Refused', command.service, '- "Allow control" is off');
    throw new Error('Allow control is off in the app\'s Configuration tab, so nothing was sent');
  }
  const [domain, service] = String(command.service || '').split('.');
  // Only entity types a charger or car uses, or a charger integration's own actions.
  const allowedDomain = CONTROL_DOMAINS.has(domain) || KNOWN_CHARGER_DOMAINS.has(domain);
  if (!domain || !service || NEVER_CONTROL_DOMAINS.has(domain) || !allowedDomain) {
    warn('Refused', command.service, '- this domain is never controlled');
    throw new Error(`${command.service} is never sent by this app`);
  }
  const target = command.target || {};
  const ok = (allowed || []).some((a) => a.service === command.service &&
    (!a.entity_id || target.entity_id === a.entity_id));
  if (!ok) {
    warn('Refused', command.service, '- not the chosen start/stop method');
    throw new Error(`${command.service} is not the chosen start/stop method`);
  }
  log('SENDING to charger:', command.service, JSON.stringify(command.data || {}), JSON.stringify(target));
  const message = { type: 'call_service', domain, service, service_data: command.data || {} };
  if (command.target) message.target = command.target;
  return call(message, 20000, CONTROL_TOKEN);
}

// Steer the home battery. Refused unless both "Allow control" and "Allow
// home battery control" are on, and only for the exact entities and actions
// of the chosen battery. allowed: [{ service, entity_id? }]
const BATTERY_SERVICE_DOMAINS = new Set(['huawei_solar', 'marstek_local_api']);
async function sendBattery(command, allowed) {
  if (options.allow_control !== true || options.allow_battery_control !== true) {
    warn('Refused', command.service, '- home battery control is off');
    throw new Error('Allow control and Allow home battery control must both be on in the app\'s Configuration tab');
  }
  const [domain, service] = String(command.service || '').split('.');
  const allowedDomain = CONTROL_DOMAINS.has(domain) || BATTERY_SERVICE_DOMAINS.has(domain);
  if (!domain || !service || NEVER_CONTROL_DOMAINS.has(domain) || !allowedDomain) {
    warn('Refused', command.service, '- this domain is never controlled');
    throw new Error(`${command.service} is never sent by this app`);
  }
  const target = command.target || {};
  const ok = (allowed || []).some((a) => a.service === command.service && (!a.entity_id || target.entity_id === a.entity_id));
  if (!ok) {
    warn('Refused', command.service, '- not a control of the chosen battery');
    throw new Error(`${command.service} is not a control of the chosen battery`);
  }
  log('SENDING to battery:', command.service, JSON.stringify(command.data || {}), JSON.stringify(target));
  const message = { type: 'call_service', domain, service, service_data: command.data || {} };
  if (command.target) message.target = command.target;
  return call(message, 20000, CONTROL_TOKEN);
}

// "mobile_app_pixel" or "notify.mobile_app_pixel" -> "notify.mobile_app_pixel"
function normaliseNotify(v) {
  const x = String(v || '').trim();
  if (!x) return '';
  return x.startsWith('notify.') ? x : `notify.${x}`;
}

// The one notify action the app may use, chosen in the app (Settings › Notifications).
let notifyTarget = '';
function setNotifyTarget(v) {
  notifyTarget = normaliseNotify(v);
}

async function sendNotification(title, message) {
  const full = notifyTarget;
  if (!full) throw new Error('No notify action chosen');
  const service = full.slice('notify.'.length);
  if (!/^[a-z0-9_]+$/.test(service)) throw new Error(`"${full}" is not a valid notify action`);
  debug('Notification:', title, '-', message);
  return call({ type: 'call_service', domain: 'notify', service, service_data: { title, message } }, 20000, NOTIFY_TOKEN);
}

// SAFETY: the app may only write the states of its own sensors, and only
// when "Publish sensors" is on. These sensors are not stored by Home
// Assistant between restarts; the app writes them again at every refresh.
const OWN_SENSOR = /^(sensor|binary_sensor)\.smart_charging_[a-z0-9_]+$/;

async function setState(entityId, state, attributes) {
  if (options.publish_sensors !== true) throw new Error('Publish sensors is off');
  if (!OWN_SENSOR.test(entityId)) {
    warn('Refused to write', entityId, '- not one of the app\'s own sensors');
    throw new Error(`${entityId} is not one of the app's own sensors`);
  }
  const res = await fetch(`${REST_URL}/states/${entityId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: String(state), attributes: attributes || {} }),
  });
  if (!res.ok) throw new Error(`Writing ${entityId} failed: HTTP ${res.status}`);
  return true;
}

function onConnect(fn) {
  connectListeners.push(fn);
}

function connect() {
  if (!TOKEN) {
    state.lastError = 'No SUPERVISOR_TOKEN found. Is homeassistant_api enabled?';
    log(state.lastError);
    return;
  }

  log('Connecting to Home Assistant at', HA_WS_URL);
  socket = new WebSocket(HA_WS_URL);

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'auth_required') {
      socket.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    } else if (msg.type === 'auth_ok') {
      state.connected = true;
      state.version = msg.ha_version;
      state.lastError = null;
      log('Connected to Home Assistant', state.version);
      try {
        const config = await call({ type: 'get_config' });
        state.timeZone = config.time_zone || 'UTC';
        state.currency = config.currency || 'EUR';
      } catch (err) {
        log('Could not read HA config:', err.message);
      }
      for (const fn of connectListeners) fn();
    } else if (msg.type === 'auth_invalid') {
      state.lastError = 'Authentication failed: ' + (msg.message || 'invalid token');
      log(state.lastError);
      socket.close();
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
    }
  });

  socket.on('error', (err) => {
    state.lastError = err.message;
    log('WebSocket error:', err.message);
  });

  socket.on('close', () => {
    if (state.connected) log('Connection to Home Assistant closed');
    state.connected = false;
    for (const { reject } of pending.values()) reject(new Error('Connection closed'));
    pending.clear();
    setTimeout(connect, 10000);
  });
}

module.exports = { state, call, callAction, createCalendarEvent, sendControl, sendBattery, sendNotification, setNotifyTarget, setState, normaliseNotify, onConnect, connect, log, debug, warn };

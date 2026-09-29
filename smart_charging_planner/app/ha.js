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
]);
const ACTION_TOKEN = Symbol('read-only action');
const CALENDAR_WRITE_TOKEN = Symbol('calendar write');

// Send a command to Home Assistant and wait for its result.
function call(message, timeoutMs = 20000, token = null) {
  return new Promise((resolve, reject) => {
    const allowed = READ_ONLY_COMMANDS.has(message.type) ||
      (message.type === 'call_service' && token === ACTION_TOKEN) ||
      // The only write: adding a calendar event, and only when the user
      // switched on "Allow adding trips to calendar".
      (message.type === 'call_service' && token === CALENDAR_WRITE_TOKEN &&
        message.domain === 'calendar' && message.service === 'create_event' &&
        options.allow_calendar_write === true);
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

module.exports = { state, call, callAction, createCalendarEvent, onConnect, connect, log, debug, warn };

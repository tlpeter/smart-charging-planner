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

// Send a command to Home Assistant and wait for its result.
function call(message, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
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

// Call an action (service) that returns data, e.g. energyzero.get_energy_prices.
async function callAction(domain, service, serviceData) {
  const result = await call({
    type: 'call_service',
    domain,
    service,
    service_data: serviceData,
    return_response: true,
  });
  return result && result.response;
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

module.exports = { state, call, callAction, onConnect, connect, log, debug, warn };

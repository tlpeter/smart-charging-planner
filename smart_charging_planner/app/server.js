'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8099;
const HA_WS_URL = process.env.HA_WS_URL || 'ws://supervisor/core/websocket';
const TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';

// ---------------------------------------------------------------------------
// Home Assistant WebSocket client
// ---------------------------------------------------------------------------

const ha = {
  connected: false,
  version: null,
  entityCount: null,
  lastError: null,
  socket: null,
  nextId: 1,
  pending: new Map(),
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function haCall(message) {
  return new Promise((resolve, reject) => {
    if (!ha.connected) {
      reject(new Error('Not connected to Home Assistant'));
      return;
    }
    const id = ha.nextId++;
    ha.pending.set(id, { resolve, reject });
    ha.socket.send(JSON.stringify({ id, ...message }));
    setTimeout(() => {
      if (ha.pending.has(id)) {
        ha.pending.delete(id);
        reject(new Error('Timeout waiting for Home Assistant'));
      }
    }, 15000);
  });
}

async function refreshEntityCount() {
  try {
    const states = await haCall({ type: 'get_states' });
    ha.entityCount = states.length;
  } catch (err) {
    ha.lastError = err.message;
  }
}

function connectHA() {
  if (!TOKEN) {
    ha.lastError = 'No SUPERVISOR_TOKEN found. Is homeassistant_api enabled?';
    log(ha.lastError);
    return;
  }

  log('Connecting to Home Assistant at', HA_WS_URL);
  const socket = new WebSocket(HA_WS_URL);
  ha.socket = socket;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'auth_required') {
      socket.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    } else if (msg.type === 'auth_ok') {
      ha.connected = true;
      ha.version = msg.ha_version;
      ha.lastError = null;
      log('Connected to Home Assistant', ha.version);
      refreshEntityCount();
    } else if (msg.type === 'auth_invalid') {
      ha.lastError = 'Authentication failed: ' + (msg.message || 'invalid token');
      log(ha.lastError);
      socket.close();
    } else if (msg.type === 'result' && ha.pending.has(msg.id)) {
      const { resolve, reject } = ha.pending.get(msg.id);
      ha.pending.delete(msg.id);
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
    }
  });

  socket.on('error', (err) => {
    ha.lastError = err.message;
    log('WebSocket error:', err.message);
  });

  socket.on('close', () => {
    if (ha.connected) log('Connection to Home Assistant closed');
    ha.connected = false;
    for (const { reject } of ha.pending.values()) reject(new Error('Connection closed'));
    ha.pending.clear();
    setTimeout(connectHA, 10000);
  });
}

// ---------------------------------------------------------------------------
// Web server (served through Home Assistant ingress)
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, 'public');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/status') {
    if (ha.connected) await refreshEntityCount();
    sendJson(res, 200, {
      app_version: require('./package.json').version,
      connected: ha.connected,
      ha_version: ha.version,
      entity_count: ha.entityCount,
      error: ha.lastError,
    });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  log(`Smart Charging Planner listening on port ${PORT}`);
  connectHA();
});

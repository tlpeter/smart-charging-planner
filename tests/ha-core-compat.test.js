'use strict';

// Compatibility smoke test against a real Home Assistant Core container.
// GitHub Actions pins the container to HA_CORE_VERSION. The test creates a
// throw-away owner account, checks the WebSocket contracts used by the app,
// then starts the real Smart Charging Planner against that Core instance.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'smart_charging_planner', 'app', 'node_modules', 'ws'));

const HA_URL = process.env.HA_URL || 'http://127.0.0.1:8123';
const HA_WS_URL = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
const EXPECTED_VERSION = process.env.HA_CORE_VERSION || '2026.10.0';
const APP = path.join(__dirname, '..', 'smart_charging_planner', 'app');
const APP_PORT = Number(process.env.SCP_PORT) || 18099;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function responseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForHomeAssistant() {
  let last = 'not started';
  for (let i = 0; i < 180; i++) {
    try {
      return await responseJson(`${HA_URL}/api/onboarding`);
    } catch (err) {
      last = err.message;
      await sleep(1000);
    }
  }
  throw new Error(`Home Assistant did not become ready: ${last}`);
}

async function onboard() {
  const clientId = `${HA_URL}/`;
  const user = await responseJson(`${HA_URL}/api/onboarding/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      name: 'Compatibility test',
      username: 'scp_compat',
      password: 'scp-compatibility-only-2026.10',
      language: 'en',
    }),
  });
  assert.ok(user.auth_code, 'Home Assistant onboarding did not return an auth code');
  const token = await responseJson(`${HA_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: user.auth_code,
      client_id: clientId,
    }),
  });
  assert.ok(token.access_token, 'Home Assistant did not return an access token');
  return token.access_token;
}

async function waitForCoreComponents(token) {
  const required = ['energy', 'recorder', 'search', 'websocket_api'];
  let last = [];
  for (let i = 0; i < 90; i++) {
    const config = await responseJson(`${HA_URL}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    last = Array.isArray(config.components) ? config.components : [];
    if (required.every((component) => last.includes(component))) return;
    await sleep(1000);
  }
  throw new Error(`Home Assistant did not finish loading: missing ${required.filter((component) => !last.includes(component)).join(', ')}`);
}

function websocketContract(token) {
  const commands = [
    { type: 'get_config' },
    { type: 'get_states' },
    { type: 'get_services' },
    { type: 'config/entity_registry/list' },
    { type: 'config/device_registry/list' },
    { type: 'energy/get_prefs' },
    { type: 'energy/solar_forecast' },
    { type: 'search/related', item_type: 'entity', item_id: 'sensor.smart_charging_compatibility_probe' },
  ];
  return new Promise((resolve, reject) => {
    // A clean Core install has no Energy dashboard preferences yet. That
    // command is compatible when it returns the documented `not_found`; an
    // unknown/removed command still fails this test.
    const acceptedErrors = new Map([['energy/get_prefs', 'not_found']]);
    const socket = new WebSocket(HA_WS_URL);
    const pending = new Map();
    let nextId = 1;
    let version = null;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out while checking Home Assistant WebSocket contracts'));
    }, 30000);
    const fail = (err) => {
      clearTimeout(timeout);
      socket.terminate();
      reject(err);
    };
    socket.on('error', fail);
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        return;
      }
      if (message.type === 'auth_invalid') {
        fail(new Error(`WebSocket authentication failed: ${message.message || 'invalid token'}`));
        return;
      }
      if (message.type === 'auth_ok') {
        version = message.ha_version;
        for (const command of commands) {
          const id = nextId++;
          pending.set(id, command.type);
          socket.send(JSON.stringify({ id, ...command }));
        }
        return;
      }
      if (message.type !== 'result' || !pending.has(message.id)) return;
      const command = pending.get(message.id);
      pending.delete(message.id);
      if (!message.success && acceptedErrors.get(command) !== (message.error && message.error.code)) {
        fail(new Error(`${command} failed on Home Assistant ${version}: ${JSON.stringify(message.error)}`));
        return;
      }
      if (!pending.size) {
        clearTimeout(timeout);
        socket.close();
        resolve(version);
      }
    });
  });
}

async function waitForApp() {
  let last = 'not started';
  for (let i = 0; i < 100; i++) {
    try {
      const status = await responseJson(`http://127.0.0.1:${APP_PORT}/api/status`);
      if (status.connected) return status;
      last = JSON.stringify(status);
    } catch (err) {
      last = err.message;
    }
    await sleep(200);
  }
  throw new Error(`Smart Charging Planner did not connect: ${last}`);
}

async function run() {
  await waitForHomeAssistant();
  const token = await onboard();
  await waitForCoreComponents(token);
  const wsVersion = await websocketContract(token);
  assert.equal(wsVersion, EXPECTED_VERSION, `WebSocket connected to unexpected Home Assistant version ${wsVersion}`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-ha-core-'));
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ log_level: 'info' }));
  const app = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      SCP_PORT: String(APP_PORT),
      HA_WS_URL,
      HA_REST_URL: `${HA_URL}/api`,
      SUPERVISOR_TOKEN: token,
      SCP_RECONNECT_MS: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  app.stdout.on('data', (chunk) => { log += chunk; });
  app.stderr.on('data', (chunk) => { log += chunk; });
  try {
    const status = await waitForApp();
    assert.equal(status.ha_version, EXPECTED_VERSION);
    assert.equal(status.time_zone, 'Europe/Amsterdam');
    assert.ok(Number.isInteger(status.entity_count));

    for (const endpoint of [
      'api/vehicles/detect',
      'api/chargers/detect',
      'api/grid/detect',
      'api/prices/detect',
      'api/control/check',
      'api/solar',
    ]) {
      await responseJson(`http://127.0.0.1:${APP_PORT}/${endpoint}`);
    }
    console.log(`ok - Smart Charging Planner connected to Home Assistant Core ${status.ha_version}`);
    console.log('ok - WebSocket configuration, state, service, registry, energy and related-item contracts');
    console.log('ok - vehicle, charger, grid, price, control and solar discovery routes');
  } catch (err) {
    throw new Error(`${err.message}\n\nSmart Charging Planner log:\n${log.slice(-5000)}`);
  } finally {
    if (app.exitCode === null && app.signalCode === null) {
      const exited = new Promise((resolve) => app.once('exit', resolve));
      app.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});

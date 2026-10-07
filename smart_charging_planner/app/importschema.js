'use strict';

function bad(message) {
  const err = new Error(`Invalid settings file: ${message}`);
  err.status = 400;
  throw err;
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function objectAt(value, path, nullable = false) {
  if (nullable && value == null) return;
  if (!plain(value)) bad(`${path} must be an object`);
}

function walk(value, path = 'settings', depth = 0, count = { value: 0 }) {
  if (++count.value > 2500) bad('contains too many values');
  if (depth > 10) bad(`${path} is nested too deeply`);
  if (typeof value === 'string' && value.length > 10000) bad(`${path} is too long`);
  if (Array.isArray(value)) {
    if (value.length > 200) bad(`${path} contains too many items`);
    value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1, count));
    return;
  }
  if (!plain(value)) return;
  const keys = Object.keys(value);
  if (keys.length > 100) bad(`${path} contains too many fields`);
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') bad(`${path} contains a reserved field`);
    walk(value[key], `${path}.${key}`, depth + 1, count);
  }
}

function objectList(settings, key) {
  const value = settings[key];
  if (value == null) return;
  if (!Array.isArray(value)) bad(`${key} must be a list`);
  if (value.length > 20) bad(`${key} contains too many entries`);
  value.forEach((item, i) => objectAt(item, `${key}[${i}]`));
}

function nestedObject(parent, key, path) {
  if (parent && parent[key] != null) objectAt(parent[key], `${path}.${key}`);
}

function validateImportSettings(settings) {
  objectAt(settings, 'settings');
  walk(settings);

  for (const key of ['vehicles', 'chargers', 'grid']) objectList(settings, key);
  for (const key of ['prices', 'planning', 'departures', 'control', 'notify', 'solar', 'battery']) {
    if (settings[key] != null) objectAt(settings[key], key);
  }

  nestedObject(settings.prices, 'source', 'prices');
  nestedObject(settings.prices, 'fixed', 'prices');
  nestedObject(settings.prices, 'forecast', 'prices');
  for (const key of ['schedule', 'helper', 'calendar', 'override']) nestedObject(settings.departures, key, 'departures');
  for (const key of ['feed_in', 'equalizer']) nestedObject(settings.solar, key, 'solar');
  nestedObject(settings.battery, 'saved', 'battery');

  for (const [i, vehicle] of (settings.vehicles || []).entries()) {
    nestedObject(vehicle, 'departures', `vehicles[${i}]`);
    for (const key of ['schedule', 'helper', 'calendar', 'override']) nestedObject(vehicle.departures, key, `vehicles[${i}].departures`);
    if (vehicle.id != null && (typeof vehicle.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(vehicle.id))) bad(`vehicles[${i}].id must be a short id`);
  }

  for (const [i, charger] of (settings.chargers || []).entries()) {
    if (charger.max_current_entities != null) {
      if (!Array.isArray(charger.max_current_entities) ||
          charger.max_current_entities.some((id) => typeof id !== 'string')) {
        bad(`chargers[${i}].max_current_entities must be a list of entity IDs`);
      }
    }
  }

  if (settings.notify && settings.notify.service != null && typeof settings.notify.service !== 'string') {
    bad('notify.service must be text');
  }
  return settings;
}

module.exports = { validateImportSettings };

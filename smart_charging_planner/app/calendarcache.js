'use strict';

// Last confirmed events are local app data, scoped per charger and calendar.
// A successful empty response replaces the cache; failures never extend its age.
const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const scope = require('./scope');
const FILE = path.join(process.env.DATA_DIR || '/data', 'calendar_cache.json');
const MAX_AGE_MS = 24 * 3600000;
function records() {
  const rows = readJson(scope.file(FILE), []);
  return Array.isArray(rows) ? rows : [];
}
function remember(entity, tz, events, now, until) {
  const row = { entity, tz, events, confirmed_at: now, expires_at: Math.min(now + MAX_AGE_MS, until) };
  const keep = records().filter((r) => r && r.entity !== entity && r.expires_at > now);
  writeJsonAtomic(scope.file(FILE), [...keep.slice(-11), row]);
  return row;
}
function fallback(entity, tz, now) {
  const r = records().find((x) => x && x.entity === entity && x.tz === tz);
  const usable = r && Array.isArray(r.events) && Number.isFinite(r.confirmed_at)
    && Number.isFinite(r.expires_at) && r.confirmed_at <= now && now < r.expires_at
    && now - r.confirmed_at < MAX_AGE_MS;
  return {
    events: usable ? r.events : [],
    health: { state: usable ? 'cached' : 'unavailable', source: entity,
      confirmed_at: r && Number.isFinite(r.confirmed_at) ? r.confirmed_at : null,
      expires_at: r && Number.isFinite(r.expires_at) ? r.expires_at : null },
  };
}
module.exports = { remember, fallback, MAX_AGE_MS };

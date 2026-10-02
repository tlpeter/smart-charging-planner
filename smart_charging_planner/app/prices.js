'use strict';

// Price sources.
//
// Every source ends up in the same internal format: a list of
// { start, end, price } with start/end in milliseconds (UTC) and the price
// in currency per kWh, for today and tomorrow.
//
// Two kinds of sources:
//   - action: an integration action that returns prices (EnergyZero,
//     easyEnergy, Tibber, Nord Pool). Found through the entity registry.
//   - attribute: a sensor that keeps a list of prices in its attributes
//     (ENTSO-e, Nord Pool custom, EPEX Spot, Frank Energie, Zonneplan and
//     others). Found by scanning attributes, so unknown integrations work too.

const ha = require('./ha');
const history = require('./pricehistory');

// ---------------------------------------------------------------------------
// Time zone helpers ("today" means today in Home Assistant's time zone)
// ---------------------------------------------------------------------------

function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// A clock time (hh:mm) on a local day, dayOffset days from today.
function localTimeOn(tz, dayOffset, hour, minute, now = Date.now()) {
  const p = tzParts(now, tz);
  return localDateTime(tz, p.y, p.m, p.d + dayOffset, hour, minute);
}

// A local date and time in the time zone, as milliseconds (UTC).
function localDateTime(tz, y, m, d, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(y, m - 1, d, hour, minute, second);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

// Parse a date-time string. Without an offset it is read as local time.
function parseLocal(value, tz) {
  const str = String(value || '').trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return Date.parse(str.replace(' ', 'T'));
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return localDateTime(tz, +m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}

// Start of the local day, dayOffset days from today.
function localMidnight(tz, dayOffset = 0, now = Date.now()) {
  return localTimeOn(tz, dayOffset, 0, 0, now);
}

function isoLocal(ms, tz) {
  const p = tzParts(ms, tz);
  const off = tzOffsetMs(ms, tz) / 60000;
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function localDate(ms, tz) {
  return isoLocal(ms, tz).slice(0, 10);
}

function parseTime(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  return Date.parse(String(v).trim().replace(' ', 'T'));
}

// ---------------------------------------------------------------------------
// Action sources
// ---------------------------------------------------------------------------

const ACTION_SOURCES = {
  energyzero: {
    name: 'EnergyZero',
    price_type: 'market_excl_vat',
    unit: 'kWh',
    async fetch(entry, win, tz) {
      const call = (end) => ha.callAction('energyzero', 'get_energy_prices', {
        config_entry: entry, incl_vat: false, start: isoLocal(win.start, tz), end: isoLocal(end, tz),
      });
      let r;
      try {
        r = await call(win.end - 1000);
      } catch (err) {
        ha.debug('EnergyZero: today + tomorrow failed, trying today only:', err.message);
        r = await call(win.tomorrow - 1000);
      }
      return (r.prices || []).map((p) => ({ start: parseTime(p.timestamp), price: Number(p.price) }));
    },
  },
  easyenergy: {
    name: 'easyEnergy',
    price_type: 'market_excl_vat',
    unit: 'kWh',
    async fetch(entry, win, tz) {
      const call = (end) => ha.callAction('easyenergy', 'get_energy_usage_prices', {
        config_entry: entry, incl_vat: false, start: isoLocal(win.start, tz), end: isoLocal(end, tz),
      });
      let r;
      try {
        r = await call(win.end - 1000);
      } catch (err) {
        ha.debug('easyEnergy: today + tomorrow failed, trying today only:', err.message);
        r = await call(win.tomorrow - 1000);
      }
      return (r.prices || []).map((p) => ({ start: parseTime(p.timestamp), price: Number(p.price) }));
    },
  },
  tibber: {
    name: 'Tibber',
    price_type: 'all_in',
    unit: 'kWh',
    async fetch(entry, win, tz) {
      const data = { start: isoLocal(win.start, tz), end: isoLocal(win.end, tz) };
      let r;
      try {
        r = await ha.callAction('tibber', 'get_prices', data);
      } catch (err) {
        ha.debug('Tibber: retrying with config_entry:', err.message);
        r = await ha.callAction('tibber', 'get_prices', { ...data, config_entry: entry });
      }
      const homes = Object.values((r && r.prices) || {});
      const list = homes[0] || [];
      return list.map((p) => ({ start: parseTime(p.start_time), price: Number(p.price) }));
    },
  },
  nordpool: {
    name: 'Nord Pool',
    price_type: 'market_excl_vat',
    unit: 'MWh',
    async fetch(entry, win, tz) {
      const out = [];
      for (const day of [win.start, win.tomorrow]) {
        try {
          const r = await ha.callAction('nordpool', 'get_prices_for_date', {
            config_entry: entry, date: localDate(day, tz),
          });
          const areas = Object.values(r || {});
          for (const p of areas[0] || []) {
            out.push({ start: parseTime(p.start), end: parseTime(p.end), price: Number(p.price) });
          }
        } catch (err) {
          // Tomorrow's prices are published around 13:00; before that this fails.
          ha.debug('Nord Pool: no prices for', localDate(day, tz), '-', err.message);
          if (day === win.start) throw err;
        }
      }
      return out;
    },
  },
};

// ---------------------------------------------------------------------------
// Attribute sources
// ---------------------------------------------------------------------------

const TIME_KEYS = ['start', 'start_time', 'startsAt', 'starts_at', 'time', 'from', 'datetime', 'timestamp', 'date', 'hour'];
const END_KEYS = ['end', 'end_time', 'endsAt', 'ends_at', 'till', 'to', 'until'];
const PRICE_KEYS = ['price', 'value', 'price_per_kwh', 'electricity_price', 'total', 'market_price', 'marketprice', 'energy_price', 'price_incl_vat'];

// Integrations whose attribute prices are known to be all-in.
const ALL_IN_DOMAINS = new Set(['frank_energie', 'zonneplan_one']);

function parseList(list) {
  if (!Array.isArray(list) || list.length < 4) return null;
  const first = list.find((x) => x && typeof x === 'object');
  if (!first) return null;
  const tKey = TIME_KEYS.find((k) => k in first);
  const pKey = PRICE_KEYS.find((k) => k in first);
  if (!tKey || !pKey) return null;
  const eKey = END_KEYS.find((k) => k in first);
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const start = parseTime(x[tKey]);
    const price = Number(x[pKey]);
    if (!Number.isFinite(start) || !Number.isFinite(price)) continue;
    out.push({ start, end: eKey ? parseTime(x[eKey]) : undefined, price });
  }
  return out.length >= 4 ? out : null;
}

function pricesFromAttributes(attributes) {
  const merged = new Map();
  const keys = [];
  for (const [key, value] of Object.entries(attributes || {})) {
    const parsed = parseList(value);
    if (!parsed) continue;
    keys.push(key);
    for (const p of parsed) if (!merged.has(p.start)) merged.set(p.start, p);
  }
  return { keys, prices: [...merged.values()] };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function detectPriceSources(entities, devices, states) {
  const candidates = [];
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  // Action sources: one per config entry of a known integration.
  const seen = new Set();
  for (const e of entities) {
    const def = ACTION_SOURCES[e.platform];
    if (!def || !e.config_entry_id || seen.has(e.config_entry_id)) continue;
    seen.add(e.config_entry_id);
    const device = e.device_id && deviceById.get(e.device_id);
    candidates.push({
      id: `action:${e.platform}:${e.config_entry_id}`,
      type: 'action',
      domain: e.platform,
      config_entry: e.config_entry_id,
      name: def.name,
      detail: device ? device.name_by_user || device.name : null,
      price_type: def.price_type,
    });
  }

  // Attribute sources: any sensor with a list of timed prices.
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  for (const s of states) {
    if (!s.entity_id.startsWith('sensor.')) continue;
    if (/gas/.test(s.entity_id)) continue;
    const { keys, prices } = pricesFromAttributes(s.attributes);
    if (!keys.length) continue;
    const reg = regById.get(s.entity_id);
    const domain = reg ? reg.platform : null;
    if (domain && ACTION_SOURCES[domain]) continue; // already offered as action
    candidates.push({
      id: `attr:${s.entity_id}`,
      type: 'attribute',
      domain,
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      detail: `${s.entity_id} · ${keys.join(', ')} · ${prices.length} prices`,
      price_type: domain && ALL_IN_DOMAINS.has(domain) ? 'all_in' : 'market_excl_vat',
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Fetching and normalising
// ---------------------------------------------------------------------------

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

// Convert to currency per kWh. Uses the stated unit first, then the size of
// the numbers as a fallback (reported as a warning so the user can check).
function toPerKwh(prices, unitHint, warnings) {
  const unit = String(unitHint || '').toLowerCase();
  let factor = 1;
  if (unit.includes('mwh')) factor = 1 / 1000;
  else if (/ct|cent/.test(unit)) factor = 1 / 100;
  else {
    const m = Math.abs(median(prices.map((p) => p.price)));
    if (m > 100000) {
      factor = 1e-7;
      warnings.push('Prices looked very large; assumed units of 0.0000001 per kWh. Please check the values.');
    } else if (m > 5) {
      factor = 1 / 1000;
      warnings.push('Prices looked like per MWh; converted to per kWh. Please check the values.');
    }
  }
  return prices.map((p) => ({ ...p, price: p.price * factor }));
}

function finalise(prices, win) {
  const sorted = prices.filter((p) => Number.isFinite(p.start)).sort((a, b) => a.start - b.start);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].start - sorted[i - 1].start;
    if (d > 0 && d < step) step = d;
  }
  if (!Number.isFinite(step)) step = 3600000;
  return {
    interval_minutes: Math.round(step / 60000),
    prices: sorted
      .map((p) => ({ start: p.start, end: Number.isFinite(p.end) ? p.end : p.start + step, price: p.price }))
      .filter((p) => p.start >= win.start && p.start < win.end),
  };
}

// A fixed tariff, or a day/night (peak/off-peak) tariff, for people without
// a dynamic contract. Prices are all-in per kWh, as on the energy bill.
// source: { mode: 'single'|'day_night', normal, low, low_from: 'HH:MM',
//           low_to: 'HH:MM', weekend_low: bool }
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
}

function fixedTariff(source, win, tz) {
  const from = minutesOf(source.low_from);
  const to = minutesOf(source.low_to);
  const quarter = from % 60 !== 0 || to % 60 !== 0;
  const step = (quarter ? 15 : 60) * 60000;
  const inLow = (min) => (from <= to ? min >= from && min < to : min >= from || min < to);
  const out = [];
  for (let t = win.start; t < win.end; t += step) {
    const p = tzParts(t, tz);
    let low = false;
    if (source.mode === 'day_night') {
      const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
      low = (source.weekend_low && (weekday === 0 || weekday === 6)) || inLow(p.h * 60 + p.mi);
    }
    out.push({ start: t, end: t + step, price: low ? Number(source.low) : Number(source.normal) });
  }
  return out;
}

async function fetchPrices(source, tz) {
  const win = {
    start: localMidnight(tz, 0),
    tomorrow: localMidnight(tz, 1),
    end: localMidnight(tz, 2),
  };
  const warnings = [];
  let raw;
  let unit;

  if (source.type === 'fixed') {
    // Nothing to fetch and nothing to store: the tariff is the same every day.
    const prices = fixedTariff(source, win, tz);
    return { prices, interval_minutes: Math.round((prices[0] ? prices[0].end - prices[0].start : 3600000) / 60000), window: win, warnings };
  }

  if (source.type === 'action') {
    const def = ACTION_SOURCES[source.domain];
    if (!def) throw new Error(`Unknown price integration: ${source.domain}`);
    raw = await def.fetch(source.config_entry, win, tz);
    unit = def.unit;
  } else if (source.type === 'attribute') {
    const states = await ha.call({ type: 'get_states' });
    const s = states.find((x) => x.entity_id === source.entity_id);
    if (!s) throw new Error(`Sensor ${source.entity_id} not found`);
    raw = pricesFromAttributes(s.attributes).prices;
    unit = s.attributes && s.attributes.unit_of_measurement;
  } else {
    throw new Error('Unknown source type');
  }

  ha.debug('Price source', source.id, 'returned', raw.length, 'prices; unit hint:', unit);
  const { interval_minutes, prices } = finalise(toPerKwh(raw, unit, warnings), win);
  try {
    history.record(source.id, prices);
  } catch (err) {
    ha.warn('Could not store price history:', err.message);
  }
  return { prices, interval_minutes, window: win, warnings };
}

// Past days for action sources (they can look back); stored in the history.
// dayRanges: [[startMs, endMs], ...] of local days.
async function backfill(source, dayRanges, tz) {
  if (source.type !== 'action') return 0;
  const def = ACTION_SOURCES[source.domain];
  if (!def) return 0;
  let filled = 0;
  for (const [start, end] of history.missingDays(source.id, dayRanges)) {
    try {
      const raw = await def.fetch(source.config_entry, { start, tomorrow: end, end }, tz);
      const { prices } = finalise(toPerKwh(raw, def.unit, []), { start, end });
      history.record(source.id, prices);
      filled += prices.length ? 1 : 0;
    } catch (err) {
      ha.debug('Backfill failed for', localDate(start, tz), '-', err.message);
    }
  }
  return filled;
}

// All-in price per kWh from the source price and the user's surcharges.
function totalPrice(raw, cfg) {
  const fee = Number(cfg.purchase_fee) || 0;
  const tax = Number(cfg.energy_tax) || 0;
  const vat = 1 + (Number(cfg.vat_percent ?? 21) || 0) / 100;
  if (cfg.price_type === 'all_in') return raw;
  if (cfg.price_type === 'market_incl_vat') return raw + (fee + tax) * vat;
  return (raw + fee + tax) * vat;
}

function summarise(result, cfg, now = Date.now()) {
  const { prices, window: win, interval_minutes, warnings } = result;
  const withTotal = prices.map((p) => ({ ...p, total: totalPrice(p.price, cfg) }));
  const today = withTotal.filter((p) => p.start < win.tomorrow);
  const tomorrow = withTotal.filter((p) => p.start >= win.tomorrow);
  const current = withTotal.find((p) => p.start <= now && now < p.end) || null;
  const pick = (list, fn) => (list.length ? list.reduce((a, b) => (fn(b.total, a.total) ? b : a)) : null);
  const expected = Math.round((24 * 60) / interval_minutes);
  if (today.length && today.length < expected - 1) {
    warnings.push(`Only ${today.length} of ${expected} prices found for today.`);
  }
  return {
    interval_minutes,
    count_today: today.length,
    count_tomorrow: tomorrow.length,
    tomorrow_available: tomorrow.length > 0,
    current,
    lowest_today: pick(today, (a, b) => a < b),
    highest_today: pick(today, (a, b) => a > b),
    average_today: today.length ? today.reduce((s, p) => s + p.total, 0) / today.length : null,
    warnings,
  };
}

module.exports = {
  fixedTariff,
  detectPriceSources, fetchPrices, backfill, summarise, totalPrice,
  localMidnight, localTimeOn, localDateTime, parseLocal, tzParts, isoLocal, localDate,
  pricesFromAttributes, ACTION_SOURCES,
};

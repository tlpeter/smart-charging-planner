'use strict';

// "Download diagnostics": one file that helps to find a problem, to attach
// to a bug report on GitHub. Personal details are removed: names and titles
// (calendar trips, devices), the notify target, places and free text. Tokens
// are never part of the settings, and the Supervisor token is never included.

const REDACT_KEYS = /^(title|summary|description|location|message|name|name_by_user|friendly_name|address|email|notify|service_name|calendar_title|destination|keyword)$/i;
// Text values that look like personal data even under other keys.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const COORD = /-?\d{1,2}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g;

function redact(value, key = '') {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.test(k) && (typeof v === 'string' || v == null)) out[k] = v == null ? v : '[removed]';
      else out[k] = redact(v, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Notify actions name a phone (notify.mobile_app_pixel_8).
    return value
      .replace(/notify\.[a-z0-9_]+/g, 'notify.[removed]')
      .replace(/mobile_app_[a-z0-9_]+/g, 'mobile_app_[removed]')
      .replace(EMAIL, '[email removed]')
      .replace(COORD, '[place removed]');
  }
  return value;
}

// Log lines: keep the technical part, drop quoted titles.
function redactLine(line) {
  // Quoted text with a space is a title or a name ("Naar Werk"); ids and keys stay.
  return redact(String(line)).replace(/"[^"]*"/g, (m) => (/\s/.test(m) ? '"[text removed]"' : m));
}

module.exports = { redact, redactLine };

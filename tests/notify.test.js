'use strict';

// Notifications: a message that reached no phone is not counted as sent, so
// it is tried again next time instead of waiting for hours.
// Run: node tests/notify.test.js

process.env.DATA_DIR = process.env.DATA_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'scp-notify-'));
const assert = require('assert');
const ha = require('../smart_charging_planner/app/ha');
const settings = require('../smart_charging_planner/app/settings');

// Two phones; no Home Assistant: the sending is faked here.
let failing = true;
const sent = [];
ha.sendNotification = async (service, title) => {
  if (failing) throw new Error('phone not reachable');
  sent.push({ service, title });
};
ha.setNotifyTargets = () => {};
ha.warn = () => {};
settings.load = () => ({ notify: { recipients: [
  { id: 'r1', name: 'Alex', service: 'notify.mobile_app_pixel_8', cars: null, off: [] },
  { id: 'r2', name: 'Sam', service: 'notify.mobile_app_iphone_sam', cars: null, off: [] },
] } });
const notifier = require('../smart_charging_planner/app/notify');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('ok -', name);
  } catch (err) {
    failed++;
    console.error('not ok -', name, '-', err.message);
  }
}

(async () => {
  const send = () => notifier.notify('rg_risk', 'Ready Guard: target at risk', 'Test', { key: 'ready:test', minGapMs: 6 * 3600000 });

  await check('reached no phone: not sent', async () => {
    const r = await send();
    assert.strictEqual(r.sent, false);
  });
  await check('then it is tried again right away (not held back for 6 hours)', async () => {
    failing = false;
    const r = await send();
    assert.strictEqual(r.sent, true, JSON.stringify(r));
    assert.strictEqual(sent.length, 2, `${sent.length} phones`);
  });
  await check('once it reached a phone, the same message waits its time', async () => {
    const r = await send();
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.reason, 'repeat');
    assert.strictEqual(sent.length, 2);
  });
  await check('one phone fails, the other gets it: counted as sent', async () => {
    let n = 0;
    ha.sendNotification = async (service, title) => {
      if (n++ === 0) throw new Error('phone not reachable');
      sent.push({ service, title });
    };
    const r = await notifier.notify('rg_active', 'Ready Guard active', 'Test', { key: 'ready:test2', minGapMs: 6 * 3600000 });
    assert.strictEqual(r.sent, true);
    const again = await notifier.notify('rg_active', 'Ready Guard active', 'Test', { key: 'ready:test2', minGapMs: 6 * 3600000 });
    assert.strictEqual(again.reason, 'repeat');
  });

  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})();

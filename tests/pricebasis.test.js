'use strict';

// How a price is built (#26): input → fee and tax → VAT → margin, for each basis.
// Run: node tests/pricebasis.test.js   (from the repository root)

const assert = require('assert/strict');
const { priceBreakdown, totalPrice } = require('../smart_charging_planner/app/prices');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL', name, '-', err.message);
  }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const costs = { purchase_fee: 0.02, energy_tax: 0.10, vat_percent: 21 };

check('an all-in forecast of 0.2207 with a 0.02 margin is compared as 0.2407 (not 0.287047)', () => {
  const b = priceBreakdown(0.2207, { ...costs, price_type: 'all_in' }, 0.02);
  assert.ok(near(b.total, 0.2207) && near(b.compared, 0.2407), JSON.stringify(b));
  assert.equal(b.vat_percent, 0);
  const twice = priceBreakdown(0.2207, { price_type: 'market_excl_vat', purchase_fee: 0, energy_tax: 0, vat_percent: 21 }, 0.02);
  assert.ok(near(twice.compared, 0.287047), 'the old path for comparison');
});
check('market excl. VAT: (price + fee + tax) × 1.21', () => {
  const b = priceBreakdown(0.10, { ...costs, price_type: 'market_excl_vat' });
  assert.ok(near(b.total, (0.10 + 0.12) * 1.21));
  assert.equal(b.vat_on, 'price, fee and tax');
});
check('market incl. VAT: price + (fee + tax) × 1.21', () => {
  const b = priceBreakdown(0.10, { ...costs, price_type: 'market_incl_vat' });
  assert.ok(near(b.total, 0.10 + 0.12 * 1.21));
  assert.equal(b.vat_on, 'fee and tax only');
});
check('the breakdown total is always the price the plan uses', () => {
  for (const price_type of ['market_excl_vat', 'market_incl_vat', 'all_in']) {
    for (const raw of [-0.05, 0, 0.1234]) {
      assert.ok(near(priceBreakdown(raw, { ...costs, price_type }).total, totalPrice(raw, { ...costs, price_type })), `${price_type} ${raw}`);
    }
  }
});

console.log(failures ? `\n${failures} failed` : '\nAll price basis checks passed');
process.exit(failures ? 1 : 0);

const test = require('node:test');
const assert = require('node:assert/strict');
const CPC = require('../src/unitprice.js');
const Compare = require('../src/comparison.js');
const item = (title, unit = '$0.10/fluid ounce', price = 39.60) => Compare.classify({ title, price, amazonUnit: CPC.parseAmazonUnit(`(${unit})`) }, 'mineral water');
const title = 'Acqua Panna Natural Spring Water, Plastic Water Bottles (12 Count) 405.6 fl oz';

test('case total is cross-checked against rounded Amazon pricing instead of multiplied twice', () => {
  const result = item(title);
  assert.equal(result.quantity, 405.6);
  assert.match(result.unit.source, /Title total/);
  assert.ok(Math.abs(item('Spring Water 16.9 fl oz (12 Count)', '$0.20/fluid ounce', 40.56).quantity - 202.8) < 1e-8);
});
test('explicit per-bottle/pack conventions retain multiplication when Amazon ignores the pack', () => {
  const result = item('Mineral Water 16.9 fl oz, Pack of 12', '$2.34/fluid ounce');
  assert.ok(Math.abs(result.quantity - 202.8) < 1e-8);
});

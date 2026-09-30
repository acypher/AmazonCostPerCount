// Run with:  node --test tests/
// Fixtures are real titles / prices / unit-price snippets captured from amazon.com search pages (Sep 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const CPC = require('../src/unitprice.js');

function up(title, price, snippet) {
  return CPC.computeUnitPrice({ title, price: CPC.parsePrice(price), amazonUnit: CPC.parseAmazonUnit(snippet) });
}
const close = (a, b, tol = 0.002) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

test('parseAmazonUnit', () => {
  assert.deepEqual(CPC.parseAmazonUnit('($0.94$0.94/ounce)'), { value: 0.94, per: 1, unitText: 'ounce' });
  assert.deepEqual(CPC.parseAmazonUnit('( $1.40 $1.40/count)'), { value: 1.4, per: 1, unitText: 'count' });
  assert.deepEqual(CPC.parseAmazonUnit('($2.11/100 g)'), { value: 2.11, per: 100, unitText: 'g' });
  assert.equal(CPC.parseAmazonUnit('(1,234)'), null);
});

test('Amazon per-ounce price is trusted and refined with the title', () => {
  const r = up('SKIPPY Creamy Peanut Butter, Plant Based Protein, 16.3oz x8', '$14.91', '($0.11$0.11/ounce)');
  assert.equal(r.group, 'oz'); close(r.value, 14.91 / 130.4); assert.equal(r.corrected, false);
  const r2 = up('Once Again Organic Creamy Peanut Butter, 16oz - Glass Jar - Case of 6', '$48.95', '($0.51$0.51/ounce)');
  close(r2.value, 48.95 / 96);
  const r3 = up('TEDDIE PEANUT BUTTER Smooth Peanut Butter 2pk, 26 OZ', '$17.28', '($0.33$0.33/ounce)');
  close(r3.value, 17.28 / 52);
  const r4 = up('Jif Extra Crunchy Peanut Butter, 7g Protein (7% DV), 12 (16 Oz.) Jars', '$23.96', '($0.12$0.12/ounce)');
  close(r4.value, 23.96 / 192);
});

test('Misused "/count" on a single jar -> per ounce from title', () => {
  const r = up('Jif Creamy Peanut Butter, 7g Protein (7% DV), 16 Oz. Jar', '$2.98', '($2.98$2.98/count)');
  assert.equal(r.group, 'oz'); assert.equal(r.corrected, true); close(r.value, 2.98 / 16);
});

test('Amazon $/fl oz that ignored the pack count is corrected', () => {
  const bloom = up('Bloom Nutrition Sparkling Energy Drink Minis, Raspberry Lemon & Strawberry Watermelon, 7.5oz 12 Pack', '$17.98', '($2.40$2.40/fluid ounce)');
  assert.equal(bloom.corrected, true); close(bloom.value, 17.98 / 90); assert.equal(bloom.unitLabel, 'fl oz');
  const heywell = up('heywell Energy Adaptogenic Sparkling Water, Strawberry Lemon, 12 oz (12 Pk)', '$39.99', '($3.33$3.33/fluid ounce)');
  assert.equal(heywell.corrected, true); close(heywell.value, 39.99 / 144);
  const mv = up('Mountain Valley Sparkling Water, 333 mL Glass Bottles (Pack of 24)', '$52.95', '($4.69$4.69/fluid ounce)');
  assert.equal(mv.corrected, true); close(mv.value, 52.95 / (24 * 333 / 29.5735), 0.003);
});

test('Correct fluid-ounce listings are left alone', () => {
  const r = up('CHI FOREST White Peach Sparkling Water (11.16 oz* 24)', '$28.98', '($0.11$0.11/fluid ounce)');
  assert.equal(r.corrected, false); close(r.value, 28.98 / (11.16 * 24));
  const s = up('S.Pellegrino Sparkling Natural Mineral Water, 33.8 fl oz. Plastic Bottles (Pack of 12)', '$26.99', '($0.07$0.07/fluid ounce)');
  assert.equal(s.corrected, false); close(s.value, 26.99 / (33.8 * 12));
  const i = up('Sparkling Ice Blue Variety Pack, Zero Sugar Sparkling Water, 17 fl oz, 12 count', '$12.47', '($0.06$0.06/fluid ounce)');
  assert.equal(i.corrected, false); close(i.value, 12.47 / 204);
});

test('Genuine counts stay per count (trash bags: "13 Gallon" is capacity, not contents)', () => {
  const r = up('Amazon Basics Trash Bags, Tall Kitchen Drawstring, Unscented, 13 Gallon, 120 Count, Pack of 1', '$13.63', '($0.11$0.11/count)');
  assert.equal(r.group, 'count'); close(r.value, 13.63 / 120);
  const p = up('Nespresso Capsules Vertuo, Variety Pack, 30 Count Coffee Pods, Brews 7.8 oz.', '$42.00', '($1.40$1.40/count)');
  assert.equal(p.group, 'count'); close(p.value, 1.4);
});

test('Per-count multi-pack of cans becomes per ounce', () => {
  const r = up('Soda, 12 Fl Oz Cans (Pack of 24)', '$12.00', '($0.50$0.50/count)');
  assert.equal(r.group, 'oz'); close(r.value, 12 / 288);
});

test('No Amazon unit price -> title', () => {
  const a = up('Peter Pan Creamy Peanut Butter, 56 OZ', '$9.00', null);
  assert.equal(a.group, 'oz'); close(a.value, 9 / 56);
  const b = up('Widget refills, 50 Count', '$10.00', null);
  assert.equal(b.group, 'count'); close(b.value, 0.2);
  assert.equal(up('Mystery item', '$10.00', null), null);
  assert.equal(up('No price', null, null), null);
});

test('Metric Amazon units convert to per ounce', () => {
  const r = up('Olive oil 500 ml', '$10.00', '($2.00/100 ml)');
  assert.equal(r.group, 'oz'); close(r.value, 10 / (500 / 29.5735));
});

test('Sorting: oz group first, then count, then other units, then unknown', () => {
  const mk = (id, unit) => ({ id, unit });
  const items = [
    mk('unk', null),
    mk('c2', { group: 'count', value: 0.5 }),
    mk('o2', { group: 'oz', value: 0.3 }),
    mk('sheet', { group: 'sheet', value: 0.01 }),
    mk('c1', { group: 'count', value: 0.1 }),
    mk('o1', { group: 'oz', value: 0.1 }),
  ];
  assert.deepEqual(CPC.sortKeyed(items).map((x) => x.id), ['o1', 'o2', 'c1', 'c2', 'sheet', 'unk']);
});

test('Title helpers', () => {
  assert.equal(CPC._packMultiplier('Creamy Peanut Butter, 4-Pound Can'), 1);
  assert.equal(CPC._packMultiplier('WiO Creamy Peanut Butter - 4 Pack 12oz'), 4);
  assert.equal(CPC._packMultiplier('SKIPPY 40oz x2'), 2);
  assert.equal(CPC._packMultiplier('6 x 12 oz bottles'), 6);
  const s = CPC._pickSize(CPC._findSizes('PB2 Pure Peanut Butter Powder - [2 lb/32 oz Jar] - 6g of Plant-Based Protein'));
  assert.equal(s.oz, 32);
  const s2 = CPC._pickSize(CPC._findSizes('Jif Creamy, 3/4 oz Plastic Portion Control Cup, 200 Count Case'));
  assert.equal(s2.oz, 0.75);
  assert.equal(CPC._findCount('Reli. 13 Gallon Trash Bags | 1,000 Count Bulk'), 1000);
});

test('Servings are not a pack count (Amazon $/oz already correct)', () => {
  const r = up('Organic Powdered Peanut Butter - 45 Servings 24 Ounce (Pack of 1)', '$23.49', '($0.98$0.98/ounce)');
  assert.equal(r.corrected, false); close(r.value, 23.49 / 24);
});

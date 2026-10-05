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

test('Sorting follows the selected leading unit, then other units and unknowns', () => {
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
  assert.deepEqual(CPC.sortKeyed(items, 'count').map((x) => x.id), ['c1', 'c2', 'o1', 'o2', 'sheet', 'unk']);
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

function measures(title, price, snippet) {
  return CPC.computeUnitPrices({ title, price, amazonUnit: CPC.parseAmazonUnit(snippet) });
}

test('each listing can have ounce, count, and ounces-per-count prices', () => {
  const staples = measures('50Pcs Landscape Fabric Pins, 6 Inch Garden Staples', 12.99, '($0.52/ounce)');
  close(staples.perOunce.value, 0.52);
  close(staples.perCount.value, 12.99 / 50);
  close(staples.ouncesPerCount, (12.99 / 0.52) / 50);
  assert.equal(staples.countBasis, 'title-items');

  const cans = measures('Soda, 12 Fl Oz Cans (Pack of 24)', 12, '($0.50/count)');
  close(cans.perOunce.value, 12 / 288);
  close(cans.perCount.value, 12 / 24);
  close(cans.ouncesPerCount, 12);
});

test('inner item count wins over a two- or five-package count', () => {
  const two = measures('2 packs of 20 staples, 10 oz each', 20, '($10.00/count)');
  assert.equal(two.countQuantity, 40);
  close(two.perCount.value, 0.5);
  assert.equal(two.perCount.corrected, true);

  const five = measures('20 Count, Pack of 5', 25, '($5.00/count)');
  assert.equal(five.countQuantity, 100);
  close(five.perCount.value, 0.25);
  assert.equal(CPC._findCount('2 packs of 24 oz'), null);
  const perPack = measures('2 Pack, 20 items per pack', 20, '($10.00/count)');
  assert.equal(perPack.countQuantity, 40);
  assert.equal(measures('5 x 20 Count', 20, null).countQuantity, 100);
  assert.equal(measures('20 Count x 5', 20, null).countQuantity, 100);
  const choiceList = measures('25/50/100/150/200 Pack Garden Staples (50 Pack)', 8.99, '($0.18/count)');
  assert.equal(choiceList.countQuantity, 50);
  close(choiceList.perCount.value, 8.99 / 50);
  assert.equal(choiceList.perCount.corrected, false);
  const rounded = measures('500 Pack Garden Staples', 32.29, '($0.06/count)');
  assert.equal(rounded.perCount.corrected, false);
});

test('result mix chooses the leading unit instead of always putting ounces first', () => {
  const count = (n) => ({ measures: measures(`${n} Count Staples`, 10, null) });
  const ounce = () => ({ measures: measures('16 Oz Peanut Butter', 10, null) });
  const countHeavy = [count(50), count(100), count(200), ounce()];
  const ounceHeavy = [count(50), ounce(), ounce(), ounce()];
  assert.equal(CPC.preferredUnit(countHeavy), 'count');
  assert.equal(CPC.preferredUnit(ounceHeavy), 'oz');
  const selected = countHeavy.map((it) => ({ ...it, unit: CPC.selectUnit(it.measures, 'count', null) }));
  assert.equal(CPC.sortKeyed(selected, 'count')[0].unit.group, 'count');
});

test('large ounces-per-count ratio prevents a small package count from leading', () => {
  const normal = [
    measures('20 Count, 20 Oz', 20, '($1.00/ounce)'),
    measures('30 Count, 30 Oz', 30, '($1.00/ounce)'),
    measures('40 Count, 40 Oz', 40, '($1.00/ounce)'),
  ];
  const packages = measures('5 Pack, 10 Oz each', 50, '($1.00/ounce)');
  const items = [...normal, packages].map((m) => ({ measures: m }));
  const reference = CPC.ouncePerCountReference(items);
  assert.equal(reference, 1);
  assert.equal(packages.ouncesPerCount, 10);
  assert.equal(CPC.selectUnit(packages, 'count', reference).group, 'oz');
  assert.equal(CPC.preferredUnit(items, reference), 'count');
});

test('a container capacity is not treated as saleable ounces', () => {
  const bags = measures('13 Gallon Trash Bags, 120 Count, Pack of 1', 13.63, '($0.11/count)');
  assert.equal(bags.perOunce, null);
  close(bags.perCount.value, 13.63 / 120);
  assert.equal(bags.ouncesPerCount, null);
});

test('page means compare count and ounce prices separately', () => {
  const prices = [1, 1, 1, 4];
  const items = prices.map((price) => ({ measures: {
    perCount: { group: 'count', value: price },
    perOunce: { group: 'oz', value: price / 2 },
    countBasis: 'title-items',
  } }));
  const stats = CPC.pageUnitStats(items);
  close(stats.perCount.mean, 1.75);
  close(stats.perOunce.mean, 0.875);
  assert.equal(stats.perCount.count, 4);
  assert.equal(CPC.priceOutlier(items[3].measures.perCount, stats.perCount), 'cost is far more than usual');
  assert.equal(CPC.priceOutlier(items[0].measures.perCount, stats.perCount), null);
});

test('an unusually low unit price is flagged; small samples are not', () => {
  const items = [1, 4, 4, 4].map((price) => ({ measures: {
    perCount: { group: 'count', value: price }, countBasis: 'title-items',
  } }));
  const stats = CPC.pageUnitStats(items);
  assert.equal(CPC.priceOutlier(items[0].measures.perCount, stats.perCount), 'cost is far less than usual');
  assert.equal(CPC.priceOutlier(items[1].measures.perCount, stats.perCount), null);
  assert.equal(CPC.priceOutlier(items[0].measures.perCount, CPC.pageUnitStats(items.slice(0, 3)).perCount), null);
});

test('package counts excluded from count mean but ounces still included', () => {
  const normal = [1, 1, 1].map(() => ({ measures: {
    perCount: { group: 'count', value: 1 }, perOunce: { group: 'oz', value: 0.5 },
    countBasis: 'title-items', countQuantity: 20, ouncesPerCount: 2,
  } }));
  const packageItem = { measures: {
    perCount: { group: 'count', value: 20 }, perOunce: { group: 'oz', value: 0.5 },
    countBasis: 'title-pack', countQuantity: 2, ouncesPerCount: 20,
  } };
  const stats = CPC.pageUnitStats([...normal, packageItem], 2);
  assert.equal(stats.perCount.count, 3);
  close(stats.perCount.mean, 1);
  assert.equal(stats.perOunce.count, 4);
});

test('max order size choices reflect the current page and include exact cutoffs', () => {
  const items = [10, 50, 100, 500, 560].map((n) => ({ measures: measures(`${n} Pack Garden Staples`, 20, null) }));
  const options = CPC.maxOrderSizeOptions(items);
  assert.deepEqual(options.filter((o) => o.unit === 'count').map((o) => o.value), [500, 100, 50, 25, 10]);
  assert.equal(options.some((o) => o.unit === 'oz'), false);
  assert.equal(CPC.matchesMaxOrderSize(items[3].measures, { unit: 'count', value: 500 }), true);
  assert.equal(CPC.matchesMaxOrderSize(items[4].measures, { unit: 'count', value: 500 }), false);
  assert.equal(CPC.matchesMaxOrderSize(null, { unit: 'count', value: 50 }), false);
  assert.equal(CPC.matchesMaxOrderSize(null, null), true);
  assert.deepEqual(CPC.maxOrderSizeOptions(items, { unit: 'oz', value: 16 }).at(-1),
    { unit: 'oz', value: 16, matches: 0 });
});

test('max ounce size uses the whole order including multipacks', () => {
  const items = [
    measures('Single 4 oz jar', 4, null),
    measures('16 oz jar', 8, null),
    measures('12 fl oz cans, pack of 12', 18, null),
    measures('5 lb bag', 25, null),
  ];
  close(items[2].ounceQuantity, 144);
  assert.equal(CPC.matchesMaxOrderSize(items[2], { unit: 'oz', value: 80 }), false);
  assert.equal(CPC.matchesMaxOrderSize(items[3], { unit: 'oz', value: 80 }), true);
  const options = CPC.maxOrderSizeOptions(items.map((measures) => ({ measures })));
  assert.deepEqual(options.filter((o) => o.unit === 'oz').map((o) => o.value), [80, 16, 4]);
});

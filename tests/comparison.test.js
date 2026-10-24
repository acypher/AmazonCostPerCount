const test = require('node:test');
const assert = require('node:assert/strict');
const CPC = require('../src/unitprice.js');
const Compare = require('../src/comparison.js');
const item = (title, price = 12, snippet = null) => {
  const amazonUnit = CPC.parseAmazonUnit(snippet);
  return { title, price, amazonUnit, measures: CPC.computeUnitPrices({ title, price, amazonUnit }) };
};
const classify = (title, price = 12, snippet = null, query = '') => Compare.classify(item(title, price, snippet), query);
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test('water compares total fluid volume, never containers or Amazon count', () => {
  const water = classify('Mineral water, 16.9 Fl Oz, 24 Count', 24, '($1/count)', 'mineral water');
  assert.equal(water.key, 'volume');
  assert.equal(water.unit.unitLabel, 'fl oz');
  close(water.quantity, 405.6);
  close(water.unit.value, 24 / 405.6);
  const double = classify('Mineral water, 16.9 Fl Oz, 24 Count, Pack of 24', 24);
  close(double.quantity, 405.6);
  const shorthand = classify('Sparkling Water, 12 oz, 12 Pack', 12);
  assert.equal(shorthand.key, 'volume');
  assert.equal(shorthand.unit.unitLabel, 'fl oz');
  close(shorthand.quantity, 144);
});

test('discrete razor refills ignore architecture and weight', () => {
  const refills = classify("Gillette 5-Blade Razor Refills, 8 Cartridges, 5 Ounce", 16, '($3.20/ounce)', 'razor blades');
  assert.equal(refills.key, 'count');
  assert.equal(refills.quantity, 8);
  assert.equal(refills.unit.unitLabel, 'refill');
  close(refills.unit.value, 2);
  const safety = classify('Safety Razor Blades 100 Count, 100 Pack, 4 oz', 10);
  assert.equal(safety.quantity, 100);
  assert.equal(safety.unit.unitLabel, 'blade');
  close(safety.unit.value, 0.1);
  assert.equal(classify('Razor with 5-Blade Design', 10).unit, null);
});

test('razor quantities and multipacks count purchased items once', () => {
  assert.equal(classify('Mach3 15 Razor Blade Refills', 37.97, '($2.53/count)').quantity, 15);
  assert.equal(classify('Single Edge Razor Blades, 200 Count, 200 Pack', 10).quantity, 200);
  assert.equal(classify('Safety Razor Blades, 20 Count, Pack of 5', 10).quantity, 100);
  assert.equal(classify('Safety Razor Blades, 5 x 20 Count', 10).quantity, 100);
  assert.equal(classify('2 packs of 20 Safety Razor Blades', 10).quantity, 40);
});

test('detergent pods, liquid and powder have separate comparison dimensions', () => {
  const pods = classify('Dishwasher Pods, 60 Count, Liquid-Filled, 30 Ounce', 18, '($0.60/ounce)');
  assert.equal(pods.key, 'count');
  close(pods.unit.value, 0.3);
  const gel = classify('Finish Gel Dishwasher Detergent Liquid, 75oz, 2 Pack', 9.74, '($4.87/count)');
  assert.equal(gel.key, 'volume');
  assert.equal(gel.quantity, 150);
  assert.equal(gel.unit.unitLabel, 'fl oz');
  const powder = classify('Cascade Complete Powder Dishwasher Detergent, 75 oz', 6.99);
  assert.equal(powder.key, 'weight');
  assert.equal(powder.unit.unitLabel, 'oz');
  assert.equal(powder.quantity, 75);
  assert.equal(classify('Dishwasher Powder, 80 Loads, 40 Ounce', 20, '($0.25/load)').quantity, 40);
});

test('pods alternative is a powder rather than a count, and loads are not pods', () => {
  const powder = classify('Pronounce Dishwasher Detergent Powder, Dishwasher Pods Alternative (80 Loads), 32 Ounce', 20);
  assert.equal(powder.key, 'weight');
  assert.equal(powder.quantity, 32);
  const unknownQuantity = classify('Dishwasher Detergent Powder, 80 Loads', 20, '($0.25/load)');
  assert.equal(unknownQuantity.key, 'weight');
  assert.equal(unknownQuantity.unit, null);
  assert.equal(unknownQuantity.quantity, null);
});

test('coffee output and bag capacity are not product quantities', () => {
  const coffee = classify('Nespresso Coffee Pods, 30 Count, Brews 7.8 oz', 30);
  assert.equal(coffee.key, 'count');
  assert.equal(coffee.quantity, 30);
  const beans = classify('Whole Bean Coffee, 2 lb Bag', 20);
  assert.equal(beans.key, 'weight');
  assert.equal(beans.quantity, 32);
  const bags = classify('Trash Bags, 13 Gallon, 120 Count', 12);
  assert.equal(bags.key, 'count');
  assert.equal(bags.quantity, 120);
});

test('accessories, empty containers and unknown roll sizing remain unclassified', () => {
  for (const title of ['Reusable Water Bottle 32 fl oz', 'Empty Glass Bottles 16 fl oz, 6 Pack',
    'Razor Blades Scraper Set, 2 PCS, With 20 Blades', 'Dishwasher Detergent Dispenser 16 oz',
    'Water Filter Cartridge, 2 Count', 'Topo Clone Sparkling Water Minerals Kit, 5 Gallon Output', 'Paper Towels 6 Mega Rolls', 'Toilet Paper 12 Rolls', 'Mystery Item']) {
    assert.equal(classify(title, 12, '($1/count)').key, null, title);
  }
});

test('query gives context without overriding contrary product evidence', () => {
  assert.equal(classify('Dishwasher Detergent Powder, 40 oz', 12, null, 'dishwasher pods').key, 'weight');
  assert.equal(classify('Liquid-Filled Dishwasher Pods, 50 Count', 12, null, 'liquid dishwasher detergent').key, 'count');
  assert.equal(classify('Whole Bean Coffee, 12 oz', 12, null, 'coffee pods').key, 'weight');
  assert.equal(classify('Dishwasher Cleaner Tablets 6 Count', 12, null, 'dishwasher detergent').key, null);
  assert.equal(classify('Dishwasher Rinse Aid Liquid 16 fl oz', 12, null, 'dishwasher detergent').key, null);
});

test('metric volume and mass stay distinct, missing price preserves known form', () => {
  const volume = classify('Olive oil 500 ml, Pack of 2', 20);
  assert.equal(volume.key, 'volume');
  close(volume.quantity, 1000 / 29.5735295625);
  const weight = classify('Coffee Beans 1 kg', 20);
  assert.equal(weight.key, 'weight');
  close(weight.quantity, 35.27396195);
  const missing = classify('Dishwasher Pods 60 Count', NaN);
  assert.equal(missing.key, 'count');
  assert.equal(missing.quantity, 60);
  assert.equal(missing.unit, null);
});

test('choice labels distinguish product forms and count valid prices only', () => {
  const classifications = [classify('Dishwasher Pods 60 Count'), classify('Dishwasher Gel Liquid 75 oz'),
    classify('Dishwasher Powder 40 oz'), classify('Dishwasher Pods 90 Count', NaN), classify('Unknown product')];
  const choices = Compare.choices(classifications);
  assert.deepEqual(choices.map(c => c.key), ['count', 'volume', 'weight']);
  assert.deepEqual(choices.map(c => c.count), [1, 1, 1]);
  assert.match(choices[0].label, /Pods\/tablets/);
  assert.match(choices[1].label, /Liquid\/gel/);
  assert.match(choices[2].label, /Powder/);
  assert.equal(Compare.choices([classify('Mineral water 16.9 fl oz 12 Pack')])[0].key, 'volume');
});


test('whole-order volume totals use their associated size instead of an earlier bottle size', () => {
  const water = classify('Mineral water 12 fl oz bottles, 12 pack, Total volume 144 fl oz', 12);
  assert.equal(water.quantity, 144);
  const gel = classify('Dishwasher Gel 75 oz, 2 Pack, Total 150 oz', 10);
  assert.equal(gel.quantity, 150);
  const suffix = classify('Mineral water, 12 Pack, 144 fl oz Total, 12 fl oz bottles', 12);
  assert.equal(suffix.quantity, 144);
  const perPack = classify('Dishwasher Gel, Net Weight 75 oz, 2 Pack', 10);
  assert.equal(perPack.quantity, 150);
});

test('whole-order counts take precedence over inner count and outer pack quantities', () => {
  assert.equal(classify('Finish Dishwasher Pods 60 Count, Pack of 2, 120 Count Total', 20).quantity, 120);
  assert.equal(classify('Dishwasher Pods, 2 Pack of 60 Count, Total 120 Count', 20).quantity, 120);
  assert.equal(classify('Safety Razor Blades 100 Count, 2 Pack, 200 Blades in Total', 20).quantity, 200);
});

test('durable empty water bottles are excluded without excluding bottled water in aluminum packaging', () => {
  assert.equal(classify('Water Bottles 16 oz Stainless Steel 2 Pack', 20, null, 'mineral water').key, null);
  assert.equal(classify('Aluminum Water Bottle 16 oz', 20, null, 'mineral water').key, null);
  const water = classify('Pure Life Purified Bottled Water, Aluminum Bottles, 20 fl oz', 2, null, 'mineral water');
  assert.equal(water.key, 'volume');
  assert.equal(water.quantity, 20);
});

test('liquid and powder pod alternatives retain the actual product form', () => {
  assert.equal(classify('Liquid Dishwasher Detergent, Pods Alternative, 75 oz', 10, null, 'dishwasher detergent').key, 'volume');
  assert.equal(classify('Dishwasher Detergent Powder, Pods Alternative, 32 oz', 10, null, 'dishwasher detergent').key, 'weight');
  assert.equal(classify('Liquid-Filled Dishwasher Pods 60 Count, 30 oz', 10).key, 'count');
});


test('ambiguous detergent ounce labels do not turn liquid bottles into powder comparisons', () => {
  assert.equal(classify('CASCADE CMPLT FRSH 60OZ', 10, '($0.17/ounce)', 'dishwasher detergent').key, null);
  assert.equal(classify('Dishwasher Detergent 75oz', 10, '($0.13/ounce)', 'dishwasher detergent').key, null);
  assert.equal(classify('Laundry Detergent 80 oz', 10, '($0.13/ounce)', 'laundry detergent').key, null);
  const fluid = classify('Dishwasher Detergent 75 fl oz', 10, '($0.13/ounce)', 'dishwasher detergent');
  assert.equal(fluid.key, 'volume');
  assert.equal(fluid.quantity, 75);
  const amazonFluid = classify('CASCADE CMPLT FRSH 60OZ', 10, '($0.17/fluid ounce)', 'dishwasher detergent');
  assert.equal(amazonFluid.key, 'volume');
  assert.equal(amazonFluid.quantity, 60);
  assert.equal(classify('Dishwasher Detergent Powder 75 oz', 10, null, 'dishwasher detergent').key, 'weight');
  assert.equal(classify('Dishwasher Detergent Gel 75 oz', 10, null, 'dishwasher detergent').key, 'volume');
  assert.equal(classify('Dishwasher Pods 60 Count', 10, null, 'dishwasher detergent').key, 'count');
});


test('drinking-water searches keep supplements and additives out of comparison choices', () => {
  for (const query of ['mineral water', 'spring water', 'sparkling water', 'bottled water', 'purified water', 'water']) {
    for (const title of ['Mineral Supplement Tablets, 120 Count', 'Mineral Capsules 60 Count',
      'Hydration Electrolyte Powder Packets, 30 Count, 3.5 Ounce',
      'Trace Minerals Mineral Drops, 4 fl oz', 'Mineral Water Drops, Electrolyte Liquid Concentrate, 2 fl oz']) {
      assert.equal(classify(title, 12, null, query).key, null, `${query}: ${title}`);
    }
  }
  const water = classify('Purified Bottled Water with Electrolytes, 16.9 fl oz (12 Count)', 12, null, 'mineral water');
  assert.equal(water.key, 'volume');
  close(water.quantity, 202.8);
  assert.deepEqual(Compare.choices([water, classify('Mineral Tablets 120 Count', 12, null, 'mineral water')])
    .map(choice => choice.key), ['volume']);
  assert.equal(classify('Hydration Electrolyte Powder 3.5 Ounce', 12, null, 'mineral water powder').key, 'weight');
});

test('razor blade and refill searches do not offer ounces for incidental shaving products', () => {
  for (const query of ['razor blades', 'razor refills']) {
    for (const title of ['Shaving Cream 6 oz', 'Shaving Gel 7 fl oz', 'Straight Edge Safety Razor 4 oz']) {
      assert.equal(classify(title, 12, null, query).key, null, `${query}: ${title}`);
    }
    const kit = classify('Gillette 5-Blade Razor, 1 Handle + 4 Blade Refills', 12, null, query);
    assert.equal(kit.key, 'count');
    assert.equal(kit.quantity, 4);
    const refills = classify('Razor Refills 15 Count, 5 oz', 12, null, query);
    assert.equal(refills.key, 'count');
    assert.equal(refills.quantity, 15);
    assert.deepEqual(Compare.choices([kit, refills]).map(choice => choice.key), ['count']);
  }
});

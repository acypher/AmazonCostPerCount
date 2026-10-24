const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CPC = require('../src/unitprice.js');
const Compare = require('../src/comparison.js');
const Photo = require('../src/photo.js');
const item = (title, unit = '$0.10/fluid ounce', price = 39.60) => Compare.classify({ title, price, amazonUnit: CPC.parseAmazonUnit(`(${unit})`) }, 'mineral water');
const title = 'Acqua Panna Natural Spring Water, Plastic Water Bottles (12 Count) 405.6 fl oz';

test('case total is cross-checked against rounded Amazon pricing instead of multiplied twice', () => {
  const result = item(title);
  assert.equal(result.quantity, 405.6);
  assert.ok(result.quantityEvidence.needsImageCheck);
  assert.match(result.unit.source, /Title total/);
  assert.ok(Math.abs(item('Spring Water 16.9 fl oz (12 Count)', '$0.20/fluid ounce', 40.56).quantity - 202.8) < 1e-8);
  assert.equal(item('Spring Water 16.9 fl oz (12 Count)', '$0.20/fluid ounce', 40.56).quantityEvidence.needsImageCheck, false);
});
test('explicit per-bottle/pack conventions retain multiplication when Amazon ignores the pack', () => {
  const result = item('Mineral Water 16.9 fl oz, Pack of 12', '$2.34/fluid ounce');
  assert.ok(Math.abs(result.quantity - 202.8) < 1e-8);
  assert.ok(result.quantityEvidence.needsImageCheck);
  assert.equal(Photo.resolve(result, [{ text: '12 x 1L', confidence: 95 }]), null);
});
test('clear photo evidence resolves rounded title quantity and normalized unit price', () => {
  const resolved = Photo.resolve(item(title), [{ text: '12x 1L', confidence: 79 }]);
  assert.ok(Math.abs(resolved.quantity - 405.7682724) < 1e-6);
  assert.ok(Math.abs(resolved.unit.value - 39.6 / 405.7682724) < 1e-10);
  assert.match(resolved.unit.source, /Package photo: 12 × 1 L/);
  assert.equal(resolved.unit.corrected, true);
});
test('unreadable units, low confidence, wrong packs, wrong dimensions and variant collages cannot correct prices', () => {
  for (const lines of [[], [{ text: '12 x 11', confidence: 95 }], [{ text: '12x 1L', confidence: 74 }],
    [{ text: '6x 1L', confidence: 99 }], [{ text: '12x 1kg', confidence: 99 }],
    [{ text: '12x 1L', confidence: 90 }, { text: '12x 500ml', confidence: 95 }],
    [{ text: '12x 1L', confidence: 90 }, { text: '6x 2L', confidence: 95 }]]) {
    assert.equal(Photo.resolve(item(title), lines), null, JSON.stringify(lines));
  }
});
test('photo parsing converts printed fluid and weight units without interpreting bare ounces as water', () => {
  for (const [text, key, amount] of [['24 × 16.9 fl. oz', 'volume', 405.6], ['24X16.9FLOZ', 'volume', 405.6], ['12x1000ml', 'volume', 405.7682724], ['4x250g', 'weight', 35.27396], ['6x2lb', 'weight', 192]]) {
    const parsed = Photo.quantities([{ text, confidence: 90 }])[0];
    assert.equal(parsed.key, key); assert.ok(Math.abs(parsed.quantity - amount) < 0.001);
  }
  assert.equal(Photo.resolve(item(title), [{ text: '24x16.9 oz', confidence: 99 }]), null);
});
test('image requests are limited to original public Amazon product images', () => {
  assert.equal(Photo.imageURL('https://m.media-amazon.com/images/I/81iQjBqnrEL._AC_UL320_.jpg?x=1'), 'https://m.media-amazon.com/images/I/81iQjBqnrEL.jpg');
  for (const url of ['http://m.media-amazon.com/images/I/test.jpg', 'https://m.media-amazon.com.evil.test/images/I/test.jpg', 'https://user:pass@m.media-amazon.com/images/I/test.jpg', 'https://m.media-amazon.com:123/images/I/test.jpg', 'https://m.media-amazon.com/images/S/test.jpg', 'data:image/png;base64,a', 'https://example.com/test.jpg']) assert.equal(Photo.imageURL(url), null);
});
test('photo client caches exact signatures, caps checks and resets the budget for navigation', async () => {
  const context = vm.createContext({ CPCPhoto: Photo, URL, location: { href: 'https://www.amazon.com/s?k=water' },
    chrome: { runtime: { getURL: name => 'chrome-extension://test/' + name } },
    Promise, setTimeout: () => 1, clearTimeout() {}, crypto: { randomUUID: () => 'token' },
    window: { addEventListener() {} }, document: { createElement: () => ({ setAttribute() {}, addEventListener() {} }), documentElement: { append() {} } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/photo-client.js'), 'utf8'), context);
  const client = context.CPCPhotoClient, url = 'https://m.media-amazon.com/images/I/test.jpg';
  const first = client.check('one', url); assert.ok(first);
  assert.equal(client.check('one', url), first);
  for (let i = 0; i < 5; i++) assert.ok(client.check('more' + i, url));
  assert.equal(client.check('seventh', url), null);
  assert.equal(client.check('bad', 'https://example.com/test.jpg'), null);
  context.location.href = 'https://www.amazon.com/s?k=water&page=2';
  assert.ok(client.check('page2', url));
});

test('OCR host independently rejects non-product URLs and messages from other origins or windows', async () => {
  let listener;
  const parent = { postMessage() {} };
  const context = vm.createContext({ URL, location: { href: 'chrome-extension://test/ocr/host.html' }, parent,
    window: { addEventListener(type, fn) { listener = fn; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../ocr/host.js'), 'utf8'), context);
  for (const url of ['https://example.com/a.jpg', 'https://m.media-amazon.com/images/S/test.jpg',
    'https://m.media-amazon.com/images/I/test.jpg?secret=anything', 'https://u:p@m.media-amazon.com/images/I/test.jpg']) {
    context.url = url; assert.equal(vm.runInContext('safeURL(url)', context), false);
  }
  context.url = 'https://m.media-amazon.com/images/I/test.jpg';
  assert.equal(vm.runInContext('safeURL(url)', context), true);
  await listener({ origin: 'https://example.com', source: parent, data: { type: 'cpc-photo-init', token: 'untrusted' } });
  assert.equal(vm.runInContext('token', context), undefined);
  await listener({ origin: 'https://www.amazon.com', source: {}, data: { type: 'cpc-photo-init', token: 'wrong-window' } });
  assert.equal(vm.runInContext('token', context), undefined);
  await listener({ origin: 'https://www.amazon.com', source: parent, data: { type: 'cpc-photo-init', token: 'trusted' } });
  assert.equal(vm.runInContext('token', context), 'trusted');
});

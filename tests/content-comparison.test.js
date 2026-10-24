const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const CPC = require('../src/unitprice.js');

const source = fs.readFileSync(require.resolve('../src/content.js'), 'utf8');
const water = (id, ounces, packs, price) => ({ id, title: `Mineral Water, ${ounces} Fl Oz Bottles, Pack of ${packs}`, price, unit: `$${(price / (ounces * packs)).toFixed(3)}/fluid ounce` });
const pods = (id, count, price = count * 0.2) => ({ id, title: `Dishwasher Pods, ${count} Count`, price, unit: `$${(price / count).toFixed(2)}/count` });
const liquid = (id, size, price) => ({ id, title: `Dishwasher Detergent Liquid Gel, ${size} Fl Oz`, price, unit: `$${(price / size).toFixed(2)}/fluid ounce` });
const powder = (id, size, price) => ({ id, title: `Dishwasher Detergent Powder, ${size} Ounce`, price, unit: `$${(price / size).toFixed(2)}/ounce` });
const mixed = () => [liquid('B000000001', 75, 6), pods('B000000002', 60), powder('B000000003', 40, 8), pods('B000000004', 30), liquid('B000000005', 30, 3), pods('B000000006', 90), { id: 'B000000007', title: 'Dishwasher Cleaner Accessory Handle', price: 4 }];
function markup(item) {
  return `<div data-component-type="s-search-result" data-asin="${item.id}" class="${item.classes || ''}" ${item.hidden ? 'data-nsp-hidden' : ''} ${item.retained ? 'data-nsp-retained' : ''}>
    <div data-cy="title-recipe"><h2>${item.title}</h2></div>
    <div data-cy="price-recipe"><span class="a-price"><span class="a-offscreen">$${item.price.toFixed(2)}</span></span>${item.unit ? ` ($${item.unit.replace(/^\$/, '')})` : ''}</div>
    ${item.image ? `<img class="s-image" src="${item.image}">` : ''}
    ${item.retained || item.hidden ? '<span>Sponsored</span>' : ''}</div>`;
}

function fixture(items, { query = 'dishwasher detergent', storage = new Map(), page = 1, nsp = false, active = true, photoClient = null } = {}) {
  const { document, window } = parseHTML(`<html><body>${nsp ? '<style id="nsp-style"></style>' : ''}<input id="twotabsearchtextbox" value="original search"><div id="search"><select id="s-result-sort-select"><option value="relevance">Featured</option></select><aside id="s-refinements"></aside><div class="s-main-slot">${items.map(markup).join('')}</div></div></body></html>`);
  // linkedom has no form validation or numeric-value implementation; supply those browser primitives.
  window.HTMLInputElement.prototype.setCustomValidity = function (value) { this.validationMessage = value; };
  Object.defineProperty(window.HTMLInputElement.prototype, 'valueAsNumber', { configurable: true, get() { return this.value === '' ? NaN : Number(this.value); } });
  window.HTMLElement.prototype.reportValidity = function () { return !this.querySelector('input')?.validationMessage; };
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { const choices = [...this.querySelectorAll('option')]; return (choices.find(o => o.hasAttribute('selected')) || choices[0])?.getAttribute('value') || ''; },
    set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.getAttribute('value') === String(value)); },
  });
  const url = new URL(`https://www.amazon.com/s?k=${encodeURIComponent(query)}&page=${page}`);
  const location = { get href() { return url.href; }, get pathname() { return url.pathname; }, get search() { return url.search; }, reload() {} };
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  if (active && !storage.has('cpcSortState')) storage.set('cpcSortState', JSON.stringify({ k: query, s: '' }));
  const timers = new Map(); const observers = []; const warnings = []; let nextTimer = 1;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    takeRecords() { return []; }
    disconnect() {}
  }
  const context = vm.createContext({
    document, window, location, sessionStorage, CPC, CPCCompare: require('../src/comparison.js'),
    CPCPhoto: require('../src/photo.js'), CPCPhotoClient: photoClient,
    URLSearchParams, Event: window.Event, Element: window.Element, HTMLInputElement: window.HTMLInputElement,
    MutationObserver: Observer,
    getComputedStyle: node => ({ display: node.style?.display === 'none' || node.hidden || node.hasAttribute('data-nsp-hidden') || node.classList.contains('cpc-size-excluded') ? 'none' : 'block' }),
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => 1,
    console: { warn: (...args) => warnings.push(args.join(' ')), log() {} },
  });
  vm.runInContext(source, context, { filename: 'content.js', timeout: 2000 });
  function flush() { let runs = 0; while (timers.size) { if (++runs > 10) throw new Error('content script scheduled a continuing update loop'); const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); } }
  function change(selector) { const input = document.querySelector(selector); assert.ok(input, selector); input.checked = true; input.dispatchEvent(new window.Event('change', { bubbles: true })); flush(); return input; }
  function mutate(fn) { fn(); for (const observer of observers) observer.callback([{ type: 'childList' }]); flush(); }
  function state() { return JSON.parse(storage.get('cpcSortState') || 'null'); }
  function cards() { return [...document.querySelector('.s-main-slot').children].filter(el => el.matches('[data-component-type="s-search-result"]')); }
  assert.deepEqual(warnings, [], 'content script initialization should not warn');
  return { document, window, storage, timers, warnings, change, mutate, flush, state, cards };
}

function units(h) { return [...h.document.querySelectorAll('[aria-label="Custom maximum unit"] option')].map(o => o.value); }
function applyLimit(h, value) {
  const input = h.document.querySelector('#cpc-custom-max-size');
  input.value = String(value);
  input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  h.document.querySelector('.cpc-custom-size').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  h.flush();
}

test('mineral water offers volume only across comparison, badges and maximum size controls', () => {
  const h = fixture([water('B000000001', 16.9, 12, 12), water('B000000002', 33.8, 6, 15), water('B000000003', 11.15, 24, 18)], { query: 'mineral water' });
  assert.equal(h.state().comparisonKey, 'volume');
  assert.equal(h.document.querySelector('option[value="cpc-unit-price-asc"]').textContent, 'Price per fl oz');
  assert.equal(h.document.querySelectorAll('[name="cpc-comparison"]').length, 0);
  assert.match(h.document.querySelector('#cpc-comparison-note').textContent, /fl oz/i);
  assert.deepEqual(units(h), ['volume']);
  for (const badge of h.document.querySelectorAll('.cpc-badge')) { assert.match(badge.textContent, /\/fl oz/); assert.doesNotMatch(badge.textContent, /count|\|/); }
  for (const input of h.document.querySelectorAll('[name="cpc-max-order-size"][data-unit]')) assert.equal(input.dataset.unit, 'volume');
  assert.doesNotMatch(h.document.querySelector('#cpc-banner').textContent, /\/count/);
});

test('razor refills offer count only even when shipping weight is present', () => {
  const h = fixture([
    { id: 'B000000001', title: 'Safety Razor Blades, 100 Count, 5 Ounce', price: 10, unit: '$0.10/count' },
    { id: 'B000000002', title: "Men's 5-Blade Razor, 15 Blade Refills", price: 30, unit: '$2.00/count' },
  ], { query: 'razor blades' });
  assert.equal(h.state().comparisonKey, 'count');
  assert.equal(h.document.querySelector('option[value="cpc-unit-price-asc"]').textContent, 'Price per count');
  assert.equal(h.document.querySelectorAll('[name="cpc-comparison"]').length, 0);
  assert.deepEqual(units(h), ['count']);
  for (const badge of h.document.querySelectorAll('.cpc-badge')) assert.doesNotMatch(badge.textContent, /\/oz|\/fl oz|\|/);
});

test('mixed forms expose radios, selected group first, separate other headings and one relevant mean', () => {
  const h = fixture(mixed());
  assert.equal(h.state().comparisonKey, 'count');
  assert.deepEqual([...h.document.querySelectorAll('[name="cpc-comparison"]')].map(i => i.value).sort(), ['count', 'volume', 'weight']);
  assert.deepEqual(h.cards().slice(0, 3).map(el => el.dataset.asin).sort(), ['B000000002', 'B000000004', 'B000000006']);
  assert.ok([...h.document.querySelectorAll('.cpc-group-heading')].some(el => /Other product forms/.test(el.textContent)));
  assert.ok([...h.document.querySelectorAll('.cpc-group-heading')].some(el => /Other results/.test(el.textContent)));
  const banner = h.document.querySelector('#cpc-banner').textContent;
  assert.match(banner, /\/count/);
  assert.doesNotMatch(banner, /\/fl oz|\$[\d.]+\/oz/);
  for (const badge of h.document.querySelectorAll('.cpc-badge')) assert.doesNotMatch(badge.textContent, /\|/);
  assert.equal(h.cards().filter(el => !el.classList.contains('cpc-size-excluded')).length, 7);
});

test('manual comparison and per-unit limits persist without filtering other forms', () => {
  const h = fixture(mixed());
  applyLimit(h, 30);
  assert.equal(h.state().comparisonKey, 'count');
  assert.deepEqual(h.state().maxSize, { unit: 'count', value: 30 });
  for (const id of ['B000000001', 'B000000003', 'B000000005', 'B000000007']) assert.equal(h.document.querySelector(`[data-asin="${id}"]`).classList.contains('cpc-size-excluded'), false);
  h.change('[name="cpc-comparison"][value="volume"]');
  assert.equal(h.state().comparisonKey, 'volume');
  assert.equal(h.state().maxSize, null);
  assert.deepEqual(units(h), ['volume']);
  applyLimit(h, 40);
  assert.deepEqual(h.state().maxSize, { unit: 'volume', value: 40 });
  h.change('[name="cpc-comparison"][value="count"]');
  assert.deepEqual(h.state().maxSize, { unit: 'count', value: 30 });
  h.change('[name="cpc-comparison"][value="volume"]');
  assert.deepEqual(h.state().maxSize, { unit: 'volume', value: 40 });
  assert.deepEqual(h.warnings, []);
});

test('lazy arrivals, repeated updates and pagination do not reset comparison or text being typed', () => {
  const h = fixture(mixed());
  h.change('[name="cpc-comparison"][value="volume"]');
  const input = h.document.querySelector('#cpc-custom-max-size');
  input.value = '123.5';
  const search = h.document.querySelector('#twotabsearchtextbox'); search.value = 'new search being typed';
  h.mutate(() => h.document.querySelector('.s-main-slot').insertAdjacentHTML('beforeend', Array.from({ length: 8 }, (_, i) => markup(pods(`B0000001${String(i).padStart(2, '0')}`, 100))).join('')));
  assert.equal(h.state().comparisonKey, 'volume');
  assert.equal(input.value, '123.5');
  assert.equal(search.value, 'new search being typed');
  h.mutate(() => {});
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.warnings, []);
  const next = fixture(mixed(), { storage: h.storage, page: 2 });
  assert.equal(next.state().comparisonKey, 'volume');
  assert.ok(next.document.querySelector('[name="cpc-comparison"][value="volume"]').checked);
});

test('retained sponsored products count while hidden duplicate products do not', () => {
  const h = fixture([
    { ...pods('B000000001', 2), classes: 'AdHolder', retained: true },
    { ...pods('B000000002', 3), classes: 'AdHolder', hidden: true },
    pods('B000000003', 10),
  ], { nsp: true });
  assert.equal(h.document.querySelector('[data-asin="B000000001"]').classList.contains('cpc-size-excluded'), false);
  const labels = h.document.querySelector('#cpc-max-size').textContent;
  assert.match(labels, /Up to 2 count\s*\(1\)/);
  assert.doesNotMatch(labels, /Up to 3 count/);
});

test('repeated deliberate comparison switches do not trigger the reorder safety brake', () => {
  const h = fixture(mixed());
  const classifier = require('../src/comparison.js');
  const originals = new Map(mixed().map(item => [item.id, item]));
  for (let index = 0; index < 12; index++) {
    const key = ['volume', 'weight', 'count'][index % 3];
    h.change(`[name="cpc-comparison"][value="${key}"]`);
    assert.equal(h.state().comparisonKey, key);
    const first = originals.get(h.cards()[0].dataset.asin);
    const info = { ...first, amazonUnit: CPC.parseAmazonUnit(first.unit), measures: CPC.computeUnitPrices({ ...first, amazonUnit: CPC.parseAmazonUnit(first.unit) }) };
    assert.equal(classifier.classify(info, 'dishwasher detergent').key, key);
  }
  assert.deepEqual(h.warnings, []);
});

test('No Sponsored updates refresh available results without replacing the comparison choice', () => {
  const item = { ...pods('B000000008', 2), classes: 'AdHolder', hidden: true };
  const h = fixture([...mixed(), item], { nsp: true });
  h.change('[name="cpc-comparison"][value="volume"]');
  const ad = h.document.querySelector('[data-asin="B000000008"]');
  ad.removeAttribute('data-nsp-hidden');
  ad.setAttribute('data-nsp-retained', '');
  h.document.dispatchEvent(new h.window.Event('nsp:updated'));
  h.flush();
  assert.equal(h.state().comparisonKey, 'volume');
  assert.ok(ad.querySelector('.cpc-badge'));
  assert.equal(ad.classList.contains('cpc-size-excluded'), false);
  h.change('[name="cpc-comparison"][value="count"]');
  assert.match(h.document.querySelector('#cpc-max-size').textContent, /Up to 2 count\s*\(1\)/);
});


test('product widgets move intact below comparable cards without absorbing page furniture', () => {
  const h = fixture(mixed(), { nsp: true });
  const slot = h.document.querySelector('.s-main-slot');
  const widget = h.document.createElement('div');
  widget.id = 'test-carousel';
  widget.className = 's-widget AdHolder';
  widget.setAttribute('data-nsp-retained', '');
  widget.innerHTML = '<h2>Featured pods</h2><span class="s-widget-sponsored-label-text">Sponsored</span><ul><li class="a-carousel-card"><div data-asin="B000001001">Unique pod product</div></li><li class="a-carousel-card" data-nsp-hidden><div data-asin="B000001002">Organic duplicate product</div></li></ul>';
  const entry = widget.querySelector('.a-carousel-card');
  const second = h.document.createElement('div');
  second.id = 'test-featured'; second.className = 's-widget';
  second.innerHTML = '<a href="/dp/B000001003">Featured product link</a>';
  const hidden = h.document.createElement('div');
  hidden.id = 'test-hidden-widget'; hidden.className = 's-widget'; hidden.style.display = 'none';
  hidden.innerHTML = '<div data-asin="B000001004">Hidden product</div>';
  const pagination = h.document.createElement('div'); pagination.id = 'test-pagination'; pagination.textContent = 'Next page';
  const suggestions = h.document.createElement('div'); suggestions.id = 'test-suggestions'; suggestions.className = 's-widget';
  suggestions.innerHTML = '<h2>Related searches</h2><a href="/s?k=detergent">More detergent</a>';
  h.mutate(() => { slot.prepend(widget, second, hidden); slot.append(pagination, suggestions); });
  function check() {
    assert.ok(h.document.querySelector('#test-carousel') === widget, 'original widget node must survive');
    assert.ok(widget.querySelector('.a-carousel-card') === entry, 'original carousel entry must survive');
    assert.equal(widget.querySelector('.s-widget-sponsored-label-text').textContent, 'Sponsored');
    assert.ok(widget.hasAttribute('data-nsp-retained'));
    assert.equal(widget.querySelectorAll('.a-carousel-card[data-nsp-hidden]').length, 1);
    const children = [...slot.children];
    const lastCard = h.cards().at(-1);
    assert.ok(children.indexOf(widget) > children.indexOf(lastCard));
    assert.ok(children.indexOf(second) > children.indexOf(widget));
    assert.ok(children.indexOf(pagination) > children.indexOf(second));
    assert.ok(children.indexOf(suggestions) > children.indexOf(pagination));
    assert.ok(children.indexOf(hidden) < children.indexOf(lastCard), 'hidden widget is not relocated');
    assert.equal(slot.querySelectorAll(':scope > .cpc-additional-heading').length, 1);
    assert.match(slot.querySelector('.cpc-additional-heading').textContent, /Additional product sections/);
    assert.ok(widget.previousElementSibling.classList.contains('cpc-additional-heading'));
  }
  check();
  for (const key of ['volume', 'weight', 'count']) { h.change(`[name="cpc-comparison"][value="${key}"]`); check(); }
  const additionalHeading = slot.querySelector('.cpc-additional-heading');
  h.mutate(() => {}); check();
  h.mutate(() => {}); check();
  assert.ok(slot.querySelector('.cpc-additional-heading') === additionalHeading, 'unchanged update should reuse the heading');
  assert.deepEqual(h.warnings, []);
});

test('all-unknown results remain visible with no comparison radios or usable size controls', () => {
  const h = fixture([
    { id: 'B000000001', title: 'Dishwasher Cleaner Accessory Handle', price: 4 },
    { id: 'B000000002', title: 'Razor Stand and Holder', price: 8 },
  ]);
  assert.equal(h.document.querySelectorAll('[name="cpc-comparison"]').length, 0);
  assert.equal(h.document.querySelector('#cpc-max-size').hidden, true);
  assert.match(h.document.querySelector('#cpc-banner').textContent, /No reliable unit comparison found/);
  assert.ok(h.cards().every(card => !card.classList.contains('cpc-size-excluded')));
  assert.match(h.document.querySelector('.cpc-group-heading').textContent, /Other results/);
  assert.deepEqual(h.warnings, []);
});

const photoWater = (unit = '') => ({ id: 'B006O38N0Q', title: 'Acqua Panna Natural Spring Water, Plastic Water Bottles (12 Count) 405.6 fl oz', price: 39.60, unit, image: 'https://m.media-amazon.com/images/I/81iQjBqnrEL._AC_UL320_.jpg' });
test('photo correction updates ordering, mean and size filters together, without resetting typed text', async () => {
  let finish, calls = 0;
  const photoClient = { check() { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const h = fixture([photoWater(), water('B000000001', 10, 10, 8), water('B000000002', 10, 10, 12)], { query: 'mineral water', photoClient });
  assert.equal(h.cards()[0].dataset.asin, 'B006O38N0Q');
  applyLimit(h, 500);
  const card = h.document.querySelector('[data-asin="B006O38N0Q"]');
  assert.equal(card.dataset.cpcPhotoStatus, 'checking');
  assert.equal(card.classList.contains('cpc-size-excluded'), true);
  const input = h.document.querySelector('#cpc-custom-max-size'); input.value = '450';
  finish([{ text: '12x 1L', confidence: 79 }]);
  await Promise.resolve(); h.flush();
  assert.equal(card.dataset.cpcPhotoStatus, 'confirmed');
  assert.equal(card.classList.contains('cpc-size-excluded'), false);
  assert.equal(h.cards()[0].dataset.asin, 'B000000001');
  assert.match(card.querySelector('.cpc-badge').textContent, /\$0.098\/fl oz/);
  assert.match(card.querySelector('.cpc-badge').title, /Package photo: 12 × 1 L/);
  assert.match(h.document.querySelector('#cpc-banner').textContent, /Mean price: \$0.099\/fl oz \(3 products\)/);
  assert.equal(input.value, '450');
  h.mutate(() => {}); assert.equal(calls, 1);
});
test('failed photo check keeps title/Amazon cross-check and does not retry on page mutations', async () => {
  let calls = 0;
  const h = fixture([photoWater('$0.10/fluid ounce')], { query: 'mineral water', photoClient: { check() { calls++; return Promise.resolve([]); } } });
  await Promise.resolve(); h.flush();
  const card = h.cards()[0];
  assert.equal(card.dataset.cpcPhotoStatus, 'unconfirmed');
  assert.match(card.querySelector('.cpc-badge').textContent, /\$0.098\/fl oz/);
  assert.match(card.querySelector('.cpc-badge').title, /could not confirm/);
  h.mutate(() => {}); assert.equal(calls, 1);
});
test('photo response for an old title/price is not applied to a changed listing', async () => {
  const requests = [];
  const h = fixture([photoWater()], { query: 'mineral water', photoClient: { check() { return new Promise(resolve => requests.push(resolve)); } } });
  h.mutate(() => { h.cards()[0].querySelector('h2').textContent = 'Mineral Water 16.9 Fl Oz Bottles Pack of 6'; });
  requests[0]([{ text: '12x 1L', confidence: 79 }]); await Promise.resolve(); h.flush();
  assert.match(h.cards()[0].querySelector('.cpc-badge').title, /16.9 Fl Oz × 6 packages/);
  assert.doesNotMatch(h.cards()[0].querySelector('.cpc-badge').title, /Package photo:/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CPC = require('../src/unitprice.js');

// Run the actual content-script predicate with browser visibility supplied by the fixture.
const content = fs.readFileSync(require.resolve('../src/content.js'), 'utf8');
const predicate = content.slice(content.indexOf('  function isAvailableResult('), content.indexOf('  function sortSlot('));
function fixture(noSponsored = true) {
  const context = vm.createContext({
    CARD_SEL: '[data-component-type="s-search-result"]',
    document: { getElementById: () => noSponsored ? {} : null },
    getComputedStyle: node => ({ display: node.display || 'block' }),
  });
  return vm.runInContext(`${predicate}\nisAvailableResult`, context);
}
function card(classes = [], parentElement = null) {
  return {
    matches: () => true,
    classList: { contains: name => classes.includes(name) },
    closest: () => classes.includes('data-nsp-hidden') || (classes.includes('AdHolder') && !classes.includes('data-nsp-retained')) ? {} : null,
    parentElement, hidden: false, display: 'block',
  };
}

test('hidden sponsored two-count scraper does not create a phantom filter option', () => {
  const eligible = fixture();
  const ad = Object.assign(card(['AdHolder', 'cpc-size-excluded']), { display: 'none' });
  const organic = card();
  const items = [{ el: ad, measures: { countQuantity: 2 } },
    { el: organic, measures: { countQuantity: 10 } },
    { el: card(), measures: { countQuantity: 100 } }].filter(it => eligible(it.el));
  assert.deepEqual(CPC.maxOrderSizeOptions(items).map(o => o.value), [10]);
  assert.equal(items.length, 2);
});

test('own size exclusions remain available when a limit is relaxed', () => {
  assert.equal(fixture()(Object.assign(card(['cpc-size-excluded']), { display: 'none' })), true);
  assert.equal(fixture()(card(['data-nsp-hidden'])), false);
});

test('external hidden rows and ancestors are excluded; visible ads count with No Sponsored absent', () => {
  const eligible = fixture(false);
  assert.equal(eligible(Object.assign(card(), { display: 'none' })), false);
  assert.equal(eligible(Object.assign(card(), { hidden: true })), false);
  assert.equal(eligible(card([], Object.assign(card(), { display: 'none' }))), false);
  assert.equal(eligible(card(['AdHolder'])), true);
});


test('unique sponsored results retained by No Sponsored participate in size choices', () => {
  const eligible = fixture();
  const unique = card(['AdHolder', 'data-nsp-retained']);
  assert.equal(eligible(unique), true);
  const filtered = Object.assign(card(['AdHolder', 'data-nsp-retained', 'cpc-size-excluded']), { display: 'none' });
  assert.equal(eligible(filtered), true);
  assert.equal(eligible(card(['AdHolder', 'data-nsp-retained', 'data-nsp-hidden'])), false);
  const items = [{el: unique, measures: {countQuantity: 2}},
    {el: card(), measures: {countQuantity: 10}}].filter(it => eligible(it.el));
  assert.deepEqual(CPC.maxOrderSizeOptions(items).map(o => o.value), [2]);
});

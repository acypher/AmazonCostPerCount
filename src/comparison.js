/* Local product-form classification. Arithmetic availability alone does not make
 * a unit meaningful: bottles are packaging, pods and refills are discrete items. */
(function (root) {
  'use strict';
  const CPC = root.CPC || (typeof require === 'function' ? require('./unitprice.js') : null);
  const unknown = () => ({ key: null, unit: null, quantity: null, form: 'unknown' });
  const quantityNumber = value => Number(String(value).replace(/,/g, ''));

  function countQuantity(title, item) {
    const countNoun = '(?:count|ct|cnt|pcs?|pieces?|pods?|tablets?|refills?|cartridges?|blades?)';
    const totalBefore = title.match(new RegExp('\\btotal\\s*(?:count|quantity|of)?\\s*[:\\-]?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)\\s*' + countNoun + '(?![a-z])', 'i'));
    const totalAfter = title.match(new RegExp('(?<![\\w.])(\\d{1,3}(?:,\\d{3})+|\\d+)\\s*' + countNoun + '\\s*(?:in\\s+)?total\\b', 'i'));
    if (totalBefore || totalAfter) return quantityNumber((totalBefore || totalAfter)[1]);
    const mentions = [];
    const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)\s*-?\s*(?:count|ct|cnt|pcs?|pieces?|pods?|k-?cups?|capsules?|tablets?|tabs|softgels?|gummies|sheets?|wipes|bags|packets|sachets|(?:razor\s+)?(?:blade\s+)?refills?|cartridges?|(?:razor\s+)?blades?)(?![a-z])/gi;
    let match;
    while ((match = re.exec(title))) {
      // A five-blade cartridge describes its design, not five purchased refills.
      if (/\d\s*-\s*(?:razor\s+)?blades?\b/i.test(match[0])) continue;
      const value = quantityNumber(match[1]);
      if (value > 0) mentions.push(value);
    }
    const nested = title.match(/\b(\d+)\s*packs?\s+of\s+(\d+)\b/i);
    if (nested) return Number(nested[1]) * Number(nested[2]);
    const n = mentions.length ? Math.max(...mentions) : null;
    const multiplier = CPC._packMultiplier(title);
    if (n) {
      // "200 Count ... 200 Pack" is the same count repeated, not 40,000 items.
      return n * (multiplier > 1 && multiplier !== n ? multiplier : 1);
    }
    if (multiplier > 1) return multiplier;
    const au = item.amazonUnit;
    if (au && /^(?:count|ct|each|units?|items?|pieces?)$/i.test(au.unitText || '') && item.price > 0) {
      const inferred = Math.round(item.price / (au.value / au.per));
      if (inferred >= 1 && Number.isSafeInteger(inferred)) return inferred;
    }
    return null;
  }

  const fluidUnit = text => /^(?:fl\.?\s*oz|fluid\s*ounces?|fl\.?\s*ounces?|ml|millilit(?:er|re)s?|l|lt|ltr|ltrs|lit(?:er|re)s?|gal|gallons?|qt|quarts?|pt|pints?)$/i.test((text || '').trim());
  const weightUnit = text => /^(?:oz\.?|ounces?|onzas?|lb|lbs|pounds?|g|gr|grams?|grammes?|kg|kgs|kilograms?)$/i.test((text || '').trim());
  const conversion = text => {
    const t = (text || '').toLowerCase().replace(/\./g, '').trim();
    if (/^(?:fl\s*oz|fluid\s*ounces?|fl\s*ounces?|oz|ounces?|onzas?)$/.test(t)) return 1;
    if (/^(?:ml|millilit(?:er|re)s?)$/.test(t)) return 1 / 29.5735295625;
    if (/^(?:l|lt|ltr|ltrs|lit(?:er|re)s?)$/.test(t)) return 33.8140227;
    if (/^(?:gal|gallons?)$/.test(t)) return 128;
    if (/^(?:qt|quarts?)$/.test(t)) return 32;
    if (/^(?:pt|pints?)$/.test(t)) return 16;
    if (/^(?:lb|lbs|pounds?)$/.test(t)) return 16;
    if (/^(?:kg|kgs|kilograms?)$/.test(t)) return 35.27396195;
    if (/^(?:g|gr|grams?|grammes?)$/.test(t)) return 1 / 28.349523125;
    return null;
  };

  function commodityQuantity(title, item, key) {
    const all = CPC._findSizes(title);
    // A liquid title often abbreviates fluid ounces as "oz". Mass-specific
    // units (lb/g/kg) are never reinterpreted as volume.
    const compatible = all.filter(s => key === 'volume' ? s.fluid || s.unit === 'oz' : !s.fluid);
    // Associate Total with its own size mention, not an earlier bottle size.
    const totalSizes = compatible.filter(size =>
      /\btotal\s*(?:weight|volume|contents?)?\s*[:\-]?\s*$/i.test(title.slice(0, size.index)) ||
      /^\s*(?:in\s+)?total\b/i.test(title.slice(size.index + size.text.length)));
    const size = CPC._pickSize(totalSizes.length ? totalSizes : compatible);
    const au = item.amazonUnit;
    const auCompatible = au && (key === 'volume' ? fluidUnit(au.unitText) : weightUnit(au.unitText));
    const unitValue = auCompatible ? au.value / (au.per * conversion(au.unitText)) : null;
    if (size) {
      let mult = CPC._packMultiplier(title);
      // "16.9 fl oz, 24 count" counts bottles despite not spelling out Pack.
      if (key === 'volume' && mult === 1) {
        const count = CPC._findCount(title);
        if (count > 1) mult = count;
      }
      // Explicit whole-order totals take precedence over repeated pack metadata.
      const totalSize = totalSizes.includes(size);
      const quantity = size.oz * (totalSize ? 1 : mult);
      return { quantity, source: `Title: ${size.text.trim()}${mult > 1 && !totalSize ? ` × ${mult} packages` : ''}`,
        corrected: !!(unitValue && item.price > 0 && Math.abs(item.price / quantity - unitValue) > 0.0051 + unitValue * 0.03) };
    }
    if (unitValue > 0 && item.price > 0) return { quantity: item.price / unitValue, source: 'Amazon unit price', corrected: false };
    return { quantity: null, source: 'Quantity unavailable', corrected: false };
  }

  function classify(item, query = '') {
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return unknown();
    const t = title.toLowerCase();
    const q = String(query || '').toLowerCase();
    const waterAdditive = /\b(?:supplements?|powders?|drops?|concentrat(?:e|ed|es)|tablets?|capsules?)\b/;
    const drinkingWaterSearch = (/\b(?:mineral|spring|sparkling|bottled|purified)\s+water\b/.test(q) || q.trim() === 'water') &&
      !waterAdditive.test(q);
    // Additives are not bottled drinking water, even when their own quantity is
    // perfectly measurable. Electrolytes already present in water are fine.
    if (drinkingWaterSearch && waterAdditive.test(t)) return unknown();
    // Accessories and empty reusable containers are not quantities of consumable.
    if (/\b(?:scrapers?|dispensers?|measuring\s+cups?|storage\s+containers?|replacement\s+parts?|bottle\s+brush(?:es)?|water\s+filters?|filter\s+cartridges?|razor\s+stands?|razor\s+holders?)\b/.test(t) ||
        /\b(?:empty|reusable|insulated|vacuum|sports?|travel)\b.{0,25}\b(?:water\s+)?bottles?\b/.test(t) ||
        /\b(?:paper\s+towels?|toilet\s+paper)\b/.test(t)) return unknown();
    if (/\bwater\s+bottles?\b/.test(t) &&
        /\b(?:stainless(?:[ -]+steel)?|titanium|silicone|aluminum|tritan|collapsible)\b/.test(t)) return unknown();
    if (/\b(?:minerals?\s+kit|mineral\s+balls?)\b|\bwater\b.{0,30}\benhancers?\b/.test(t)) return unknown();
    if (/\bdishwasher\s+detergent\b/.test(q) && /\b(?:rinse\s+aid|dishwasher\s+cleaner|machine\s+cleaner)\b/.test(t) && !/\bdetergent\b/.test(t)) return unknown();
    const podMention = /\b(?:pods?|tablets?|k-?cups?|capsules?|actionpacs?|pacs?)\b/.test(t);
    const podAlternative = /\b(?:pod|tablet|capsule)[ -]free\b|\b(?:pods?|tablets?|capsules?)\s+(?:alternative|replacement)s?\b|\b(?:alternative\s+to|instead\s+of)\s+(?:pods?|tablets?|capsules?)\b/.test(t);
    const genuinePods = podMention && !podAlternative;
    const bladeProduct = /\b(?:razor\s+blades?|blade\s+refills?|razor\s+refills?|cartridges?|safety\s+blades?|double\s+edge\s+blades?|single\s+edge\s+blades?)\b/.test(t) ||
      (/razor\s+blades?/.test(q) && /\b(?:refills?|blades?)\b/.test(t));
    const individual = /\b(?:trash\s+bags?|garbage\s+bags?|drawstring\s+bags?|wipes?|staples?|fabric\s+pins?|batteries|battery|tablets?|capsules?|softgels?|gummies)\b/.test(t);
    let key, form, unitLabel;
    if (genuinePods) { key = 'count'; form = /\b(?:coffee|k-?cups?|nespresso)\b/.test(t + ' ' + q) ? 'coffee-pods' : 'pods'; unitLabel = 'count'; }
    else if (bladeProduct) { key = 'count'; form = 'refills'; unitLabel = /\b(?:refills?|cartridges?)\b/.test(t) ? 'refill' : 'blade'; }
    else if (individual) { key = 'count'; form = 'items'; unitLabel = 'count'; }
    else if (/\b(?:powder(?:ed)?|ground\s+coffee|coffee\s+grounds?|whole\s+beans?|coffee\s+beans?)\b/.test(t)) {
      key = 'weight'; form = /\b(?:coffee|beans?)\b/.test(t) ? 'coffee' : 'powder'; unitLabel = 'oz';
    } else if (/\b(?:liquid|gel|juice|soda|milk|beverages?|drinks?|olive\s+oil|cooking\s+oil|shampoo|conditioner|mouthwash|body\s+wash)\b/.test(t) ||
      /\b(?:mineral|sparkling|spring|purified|distilled|alkaline|drinking|electrolyte|still|bottled)\s+water\b/.test(t) ||
      (/\bwater\b/.test(t) && /\bwater\b/.test(q) && !/\b(?:balls?|enhancers?|minerals?\s+kit|bottles?\s+only)\b/.test(t))) {
      key = 'volume'; form = /\bwater\b/.test(t) ? 'water' : 'liquid'; unitLabel = 'fl oz';
    } else {
      const sizes = CPC._findSizes(title);
      const au = item.amazonUnit;
      // Explicit dimensional labels can establish commodity quantity, but a bare
      // bottle/package count cannot. Unknown count-only products need item nouns.
      if (sizes.some(s => s.fluid) || (au && fluidUnit(au.unitText))) { key = 'volume'; form = 'liquid'; unitLabel = 'fl oz'; }
      // Detergent is sold as pods, liquid and powder. A bare "oz" may be an
      // abbreviated liquid label, so it cannot establish powder form here.
      else if (/\b(?:dishwasher|laundry)\b/.test(q) && /\bdetergent\b/.test(q)) return unknown();
      else if (sizes.length || (au && weightUnit(au.unitText))) { key = 'weight'; form = 'bulk'; unitLabel = 'oz'; }
      else if (/\b(?:refills?)\b|\b\d+\s*(?:pieces?|pcs?|items?)\b/.test(t)) { key = 'count'; form = 'items'; unitLabel = 'count'; }
      else return unknown();
    }
    // Shaving liquids and weighted handles occasionally appear in blade searches;
    // they must not introduce an irrelevant ounce comparison. Refill kits that
    // include a handle still reach the discrete-item branch above.
    if (/\brazor\s+(?:blades?|refills?)\b/.test(q) && key !== 'count') return unknown();
    let quantity, source, corrected = false;
    if (key === 'count') {
      quantity = countQuantity(title, item);
      source = quantity ? `Item count: ${quantity}` : 'Item count unavailable';
      const au = item.amazonUnit;
      if (quantity && au && /^(?:count|ct|each|unit|units|item|items|piece|pieces)$/i.test(au.unitText)) {
        const price = item.price / quantity, given = au.value / au.per;
        corrected = !!(item.price > 0 && Math.abs(price - given) > 0.0051 + given * 0.03);
      }
    } else ({quantity, source, corrected} = commodityQuantity(title, item, key));
    const valid = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(item.price) && item.price > 0;
    return { key, form, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      unit: valid ? { group: key, value: item.price / quantity, unitLabel, source, corrected } : null };
  }

  function choices(classifications) {
    return ['count', 'volume', 'weight'].flatMap(key => {
      const entries = classifications.filter(c => c?.key === key && c.unit?.value > 0);
      if (!entries.length) return [];
      const forms = new Set(entries.map(c => c.form));
      const label = key === 'volume' ? (forms.size === 1 && forms.has('water') ? 'Water — per fl oz' : 'Liquid/gel — per fl oz') :
        key === 'weight' ? (forms.size === 1 && forms.has('coffee') ? 'Coffee — per oz' : forms.has('powder') ? 'Powder — per oz' : 'Weight — per oz') :
        forms.size === 1 && forms.has('pods') ? 'Pods/tablets — per count' :
        forms.size === 1 && forms.has('coffee-pods') ? 'Coffee pods — per count' :
        forms.size === 1 && forms.has('refills') ? 'Blades/refills — per count' : 'Items — per count';
      return [{ key, label, unitLabel: key === 'volume' ? 'fl oz' : key === 'weight' ? 'oz' : 'count', count: entries.length }];
    });
  }
  const api = { classify, choices };
  root.CPCCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

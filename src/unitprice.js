/*
 * Unit-price logic for "Price per oz/count" sorting.
 *
 * Pure functions (no DOM) so they can be unit-tested in Node.
 *
 * Policy (per Allen):
 *   - Prefer price per OUNCE (weight oz and fluid oz are merged into one "oz" group).
 *   - Otherwise price per COUNT.
 *   - Amazon's own unit price is used when it is trustworthy, but it is cross-checked
 *     against the size/pack info in the title because Amazon often:
 *       (a) labels a single package as "/count" (so $/count == full price) when the
 *           item really has a weight/volume (e.g. "Jif, 16 Oz. Jar ... ($2.98/count)");
 *       (b) computes $/oz from ONE can/bottle, ignoring "Pack of 12".
 */
(function (root) {
  'use strict';

  // ---------- units ----------
  const OZ_PER = {
    // weight -> oz
    oz: 1, lb: 16, g: 1 / 28.349523125, kg: 35.27396195,
    // volume -> fl oz
    floz: 1, ml: 1 / 29.5735295625, l: 33.8140227, gal: 128, qt: 32, pt: 16,
  };
  const FLUID = new Set(['floz', 'ml', 'l', 'gal', 'qt', 'pt']);

  function canonicalUnit(raw) {
    const u = String(raw || '').toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    if (/^(fl\.? ?oz|fluid ?ounces?|fl\.? ?ounces?)$/.test(u)) return 'floz';
    if (/^(oz|ounces?|onzas?)$/.test(u)) return 'oz';
    if (/^(lbs?|pounds?)$/.test(u)) return 'lb';
    if (/^(g|gr|grams?|grammes?)$/.test(u)) return 'g';
    if (/^(kgs?|kilos?|kilograms?)$/.test(u)) return 'kg';
    if (/^(ml|milliliters?|millilitres?)$/.test(u)) return 'ml';
    if (/^(l|lt|ltr|ltrs|liters?|litres?)$/.test(u)) return 'l';
    if (/^(gal|gallons?)$/.test(u)) return 'gal';
    if (/^(qt|quarts?)$/.test(u)) return 'qt';
    if (/^(pt|pints?)$/.test(u)) return 'pt';
    return null;
  }

  // ---------- numbers ----------
  const NUM = String.raw`(\d+\s*\/\s*\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.\d+|\d+)`;

  function parseNum(s) {
    if (s == null) return NaN;
    s = String(s).trim();
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
    return parseFloat(s.replace(/,/g, ''));
  }

  function parsePrice(text) {
    if (text == null) return NaN;
    const m = String(text).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : NaN;
  }

  // ---------- title parsing ----------
  const SIZE_UNIT = String.raw`(fl\.?\s*oz\.?|fluid\s*ounces?|fl\.?\s*ounces?|ounces?|oz\.?|onzas?|pounds?|lbs?\.?|kilograms?|kilos?|kgs?|grams?|gr?|milliliters?|millilitres?|ml|liters?|litres?|ltrs?|lt|l|gallons?|gal|quarts?|qt|pints?|pt)`;
  const SIZE_RE = new RegExp(String.raw`(?<![\w.])` + NUM + String.raw`\s*-?\s*` + SIZE_UNIT + String.raw`(?![a-z])`, 'gi');
  // "7g Protein", "5 g of sugar" etc. are nutrition facts, not package size
  const NUTRITION_AFTER = /^\s*(?:of\s+)?(?:plant[- ]based\s+)?(?:protein|fib(?:er|re)|sugars?|carbs?|net\s+carbs?|fat|sodium|caffeine|collagen|per\b)/i;

  /** All size mentions in a title, converted to ounces (weight or fluid). */
  function findSizes(title) {
    const out = [];
    const t = String(title || '');
    let m;
    SIZE_RE.lastIndex = 0;
    while ((m = SIZE_RE.exec(t))) {
      const unit = canonicalUnit(m[2].replace(/\s+/g, ' '));
      const qty = parseNum(m[1]);
      if (!unit || !(qty > 0)) continue;
      const after = t.slice(m.index + m[0].length);
      if ((unit === 'g' || unit === 'kg') && NUTRITION_AFTER.test(after)) continue;
      if (/^\s*(?:%|\bdv\b)/i.test(after)) continue;
      out.push({ qty, unit, oz: qty * OZ_PER[unit], fluid: FLUID.has(unit), index: m.index, text: m[0] });
    }
    return out;
  }

  /** Pick the most plausible package size. Imperial units first (US listings), then metric. */
  function pickSize(sizes) {
    if (!sizes.length) return null;
    const rank = (s) => (['oz', 'floz', 'lb'].includes(s.unit) ? 0 : ['ml', 'l', 'g', 'kg'].includes(s.unit) ? 1 : 2);
    return sizes.slice().sort((a, b) => rank(a) - rank(b) || a.index - b.index)[0];
  }

  /**
   * Explicit multi-pack multipliers: "Pack of 12", "12-Pack", "6pk", "x8", "* 24",
   * "Case of 6", "6 x 12 oz", "12 (16 Oz.) Jars", "24 cans".
   * Deliberately NOT "120 Count" — that usually counts items (bags, pods), not packs.
   */
  function findPackMultipliers(title) {
    const t = String(title || '');
    const found = [];
    const add = (re) => { let m; re.lastIndex = 0; while ((m = re.exec(t))) { const n = parseNum(m[1]); if (n >= 1 && n <= 1000 && Number.isInteger(n)) found.push(n); } };
    add(/\b(?:pack|case|set|box|carton|tray)\s+of\s+(\d+)\b/gi);
    add(/(?<![\w.])(\d+)\s*-?\s*(?:packs?|pks?|pck|pk\.)(?![a-z])/gi);
    add(/(?<=\d\s*(?:fl\.?\s*oz|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|litres?|gallons?)\.?\s*)[x×*]\s*(\d+)\b/gi);
    add(/(?<![\w.])(\d+)\s*[x×]\s*\d*\.?\d+\s*-?\s*(?:fl\.?\s*oz|oz|ounces?|lbs?|g|grams?|ml|l|liters?)(?![a-z])/gi);
    add(/(?<![\w.])(\d+)\s*\(\s*\d*\.?\d+\s*-?\s*(?:fl\.?\s*oz|oz|ounces?|lbs?|g|ml|l)\.?\s*\)/gi);
    add(/(?<![\w.])(\d+)\s+(?:cans|bottles|jars|pouches|cartons|tubs|boxes|packets|sachets)\b/gi);
    return found;
  }

  function packMultiplier(title) {
    const f = findPackMultipliers(title);
    return f.length ? Math.max(...f) : 1;
  }

  /** Item counts: "120 Count", "80ct", "30 pods", "100 K-Cups". */
  function findCount(title) {
    const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)\s*-?\s*(?:count|ct|cnt|pcs?|pieces?|pods?|k-?cups?|capsules?|caps|tablets?|tabs|softgels?|gummies|sheets?|rolls?|wipes|bags|packets|sachets)(?![a-z])/gi;
    let m; const out = [];
    while ((m = re.exec(String(title || '')))) { const n = parseNum(m[1]); if (n > 0) out.push(n); }
    return out.length ? Math.max(...out) : null;
  }

  // ---------- Amazon's displayed unit price ----------
  /**
   * Parse Amazon's unit-price snippet, e.g. "($0.94$0.94/ounce)", "($1.40/count)",
   * "($2.11/100 g)", "($0.05/Fl Oz)". Returns {value, per, unitText} or null.
   */
  function parseAmazonUnit(text) {
    if (!text) return null;
    const m = String(text).replace(/\s+/g, ' ').match(/\(\s*\$\s*([\d,]*\.?\d+)(?:\s*\$\s*[\d,]*\.?\d+)?\s*\/\s*([^)]+?)\s*\)/);
    if (!m) return null;
    const value = parseFloat(m[1].replace(/,/g, ''));
    let unitText = m[2].trim();
    let per = 1;
    const q = unitText.match(/^(\d[\d,.]*)\s+(.*)$/);
    if (q) { per = parseNum(q[1]); unitText = q[2]; }
    if (!(value > 0) || !(per > 0)) return null;
    return { value, per, unitText };
  }

  function normalizeCountish(unitText) {
    const u = unitText.toLowerCase().trim();
    if (/^(count|ct|each|unit|units|item|items|piece|pieces)$/.test(u)) return 'count';
    return u.replace(/(?<=[a-z]{3})s$/, ''); // sheets -> sheet, loads -> load
  }

  // ---------- main ----------
  const near = (a, b, absTol, relTol) => Math.abs(a - b) <= absTol + relTol * Math.abs(b);
  // Does exact price/qty agree with Amazon's (rounded-to-the-cent) unit price?
  const agrees = (price, qty, amazonPerUnit) => near(price / qty, amazonPerUnit, 0.0051, 0.03);

  /**
   * @param {{title:string, price:number, amazonUnit?:{value:number, per:number, unitText:string}|null}} item
   * @returns {null | {group:string, value:number, unitLabel:string, source:string, corrected:boolean}}
   *   value = dollars per 1 unitLabel (per 1 oz / 1 fl oz / 1 count / 1 sheet ...)
   */
  function computeUnitPrice(item) {
    const title = item.title || '';
    const price = item.price;
    if (!(price > 0)) return null;

    const sizes = findSizes(title);
    const size = pickSize(sizes);
    const mult = packMultiplier(title);
    const count = findCount(title);
    const au = item.amazonUnit || null;

    const ozResult = (totalOz, source, corrected) => ({
      group: 'oz', value: price / totalOz, unitLabel: size && size.fluid ? 'fl oz' : 'oz', source, corrected: !!corrected,
    });

    if (au) {
      const auUnit = canonicalUnit(au.unitText);

      // ---- Amazon gave a weight/volume unit price ----
      if (auUnit) {
        const perOz = au.value / (au.per * OZ_PER[auUnit]);
        const label = FLUID.has(auUnit) ? 'fl oz' : 'oz';
        if (size) {
          // Candidate totals from the title, most specific first.
          const cands = [];
          if (mult > 1) cands.push(size.oz * mult);
          if (count && count > 1) cands.push(size.oz * count);
          for (const T of cands) {
            if (agrees(price, T, perOz)) return { group: 'oz', value: price / T, unitLabel: label, source: 'Amazon unit price (refined with title size)', corrected: false };
          }
          if (agrees(price, size.oz, perOz)) {
            // Amazon priced ONE can/bottle and ignored an explicit "Pack of N".
            // (Only an explicit pack triggers this; "45 servings" / "36 ct" alone do not.)
            if (mult > 1) return { group: 'oz', value: price / (size.oz * mult), unitLabel: label, source: `Corrected: Amazon's $/${label} ignored the pack of ${mult}`, corrected: true };
            return { group: 'oz', value: price / size.oz, unitLabel: label, source: 'Amazon unit price (refined with title size)', corrected: false };
          }
        }
        return { group: 'oz', value: perOz, unitLabel: label, source: 'Amazon unit price', corrected: false };
      }

      const cu = normalizeCountish(au.unitText);
      if (cu === 'count') {
        const perCount = au.value / au.per;
        const impliedCount = price / perCount;

        // (a) Misused "/count": the whole package counted as 1.
        if (near(impliedCount, 1, 0.05, 0.02)) {
          if (size) return ozResult(size.oz * mult, "Corrected: Amazon's $/count was the whole package; used the size in the title", true);
          const n = (count || 1) * (count ? mult : 1);
          if (n > 1) return { group: 'count', value: price / n, unitLabel: 'count', source: "Corrected: Amazon's $/count was the whole package; used the count in the title", corrected: true };
          return { group: 'count', value: perCount, unitLabel: 'count', source: 'Amazon unit price (single item)', corrected: false };
        }

        // (b) Real count, but it is a count of cans/jars in a multi-pack with a known size.
        if (size && mult > 1 && agrees(price, mult, perCount)) {
          return ozResult(size.oz * mult, `Per ounce: ${mult} × ${size.text.trim()} (Amazon listed it per count)`, false);
        }

        // (c) Genuine per-count price. Refine precision when the title count agrees.
        for (const n of [count, mult, count && mult > 1 ? count * mult : null]) {
          if (n && n > 1 && agrees(price, n, perCount)) return { group: 'count', value: price / n, unitLabel: 'count', source: 'Amazon unit price (refined with title count)', corrected: false };
        }
        return { group: 'count', value: perCount, unitLabel: 'count', source: 'Amazon unit price', corrected: false };
      }

      // Other units (sheet, load, foot, sq ft ...): keep Amazon's, grouped by that unit.
      return { group: cu, value: au.value / au.per, unitLabel: cu, source: 'Amazon unit price', corrected: false };
    }

    // ---- No Amazon unit price: derive from the title ----
    if (size && (mult > 1 || !(count > 1))) {
      return ozResult(size.oz * mult, 'Computed from title size', false);
    }
    if (count && count > 0) {
      return { group: 'count', value: price / (count * mult), unitLabel: 'count', source: 'Computed from title count', corrected: false };
    }
    if (mult > 1) {
      return { group: 'count', value: price / mult, unitLabel: 'count', source: 'Computed from title pack size', corrected: false };
    }
    return null;
  }

  /**
   * Order: "oz" group first, then "count", then any other unit groups (largest first),
   * then items with no unit price. Stable within ties.
   */
  function sortKeyed(items) {
    const groupSizes = {};
    for (const it of items) if (it.unit) groupSizes[it.unit.group] = (groupSizes[it.unit.group] || 0) + 1;
    const rankOf = (g) => (g === 'oz' ? 0 : g === 'count' ? 1 : 2);
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const ua = a.it.unit, ub = b.it.unit;
        if (!ua || !ub) return (ua ? 0 : 1) - (ub ? 0 : 1) || a.i - b.i;
        const ra = rankOf(ua.group), rb = rankOf(ub.group);
        if (ra !== rb) return ra - rb;
        if (ua.group !== ub.group) return (groupSizes[ub.group] - groupSizes[ua.group]) || ua.group.localeCompare(ub.group);
        return ua.value - ub.value || a.i - b.i;
      })
      .map((x) => x.it);
  }

  function formatUnitPrice(u) {
    if (!u) return '';
    const v = u.value;
    const s = v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4);
    return `$${s}/${u.unitLabel}`;
  }

  const api = {
    computeUnitPrice, parseAmazonUnit, parsePrice, sortKeyed, formatUnitPrice,
    // exposed for tests
    _findSizes: findSizes, _pickSize: pickSize, _packMultiplier: packMultiplier, _findCount: findCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CPC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

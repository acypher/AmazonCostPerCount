/*
 * Unit-price logic for "Price per oz/count" sorting.
 *
 * Pure functions (no DOM) so they can be unit-tested in Node.
 *
 * Calculate price per ounce and per count independently when the listing supplies
 * enough information. The mix of results on the page determines which leads.
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
    // A slash list such as "25/50/100/200 Pack ... (50 Pack)" is a choice list;
    // the number attached to Pack in the list is not the selected quantity.
    add(/(?<![\w./])(\d+)\s*-?\s*(?:packs?|pks?|pck|pk\.)(?![a-z])/gi);
    add(/(?<![\w.])(\d+)\s*[x×]\s*\d+\s*-?\s*(?:count|ct|pcs?|pieces?)(?![a-z])/gi);
    add(/\b\d+\s*-?\s*(?:count|ct|pcs?|pieces?)\s*[x×*]\s*(\d+)\b/gi);
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
    // "2 packs of 20" describes 20 items in each pack, even without "20 count".
    const packsOf = String(title || '').match(/\b\d+\s*-?\s*packs?\s+of\s+(\d+)\b(?!\s*(?:fl\.?\s*oz|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|liters?|litres?)\b)/i);
    if (packsOf) out.push(parseNum(packsOf[1]));
    const perPack = String(title || '').match(/\b(\d+)\s+(?:items?\s+)?(?:per|in\s+each)\s+(?:pack|package|bag|box)\b/i);
    if (perPack) out.push(parseNum(perPack[1]));
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

  /** All usable measures for a listing. A missing measure stays null. */
  function computeUnitPrices(item) {
    const price = item.price;
    if (!(price > 0)) return { perOunce: null, perCount: null, ouncesPerCount: null, ounceQuantity: null, countQuantity: null, countBasis: null, other: null };

    const title = item.title || '';
    const count = findCount(title);
    const mult = packMultiplier(title);
    const primary = computeUnitPrice(item);
    const au = item.amazonUnit || null;
    const amazonCount = au && normalizeCountish(au.unitText) === 'count' ? price / (au.value / au.per) : null;

    let countQuantity = null;
    let countBasis = null;
    if (count) {
      countQuantity = count * mult;
      countBasis = 'title-items';
    } else if (mult > 1) {
      countQuantity = mult;
      countBasis = 'title-pack';
    } else if (amazonCount > 1 && Number.isFinite(amazonCount)) {
      countQuantity = amazonCount;
      countBasis = 'amazon';
    }

    let perCount = null;
    if (countQuantity) {
      // Compare the displayed unit price at cent precision. Inferring a count
      // from a rounded $0.06/count can be far from the real count of 500.
      const amazonPerCount = au && normalizeCountish(au.unitText) === 'count' ? au.value / au.per : null;
      const corrected = !!(amazonPerCount && !agrees(price, countQuantity, amazonPerCount));
      perCount = {
        group: 'count', value: price / countQuantity, unitLabel: 'count',
        source: countBasis === 'title-items' ? `Title: ${count} items${mult > 1 ? ` × ${mult} packs` : ''}` :
          countBasis === 'title-pack' ? `Title: ${mult} packages; inner item count unknown` : 'Amazon unit price',
        corrected,
      };
    }

    // The existing ounce calculation checks Amazon's unit price against the title
    // and fixes known pack mistakes. Do not turn a capacity (such as 13-gallon
    // trash bags or a pod that brews 7.8 oz) into a product weight.
    const perOunce = primary?.group === 'oz' ? primary : null;
    const other = primary && primary.group !== 'oz' && primary.group !== 'count' ? primary : null;
    const ounceQuantity = perOunce?.value > 0 ? price / perOunce.value : null;
    const ouncesPerCount = ounceQuantity && countQuantity ? ounceQuantity / countQuantity : null;
    return { perOunce, perCount, ouncesPerCount, ounceQuantity, countQuantity, countBasis, other };
  }

  // Offer only cutoffs that separate the known order sizes on this page. Keeping
  // the active cutoff lets a selection survive pagination with a different range.
  const SIZE_CUTOFFS = {
    count: [500, 100, 50, 25, 10],
    oz: [1280, 80, 16, 4, 1],
  };
  function maxOrderSizeOptions(items, selected = null) {
    return Object.entries(SIZE_CUTOFFS).flatMap(([unit, cutoffs]) => {
      const sizes = items.map((it) => it.measures?.[unit === 'count' ? 'countQuantity' : 'ounceQuantity'])
        .filter((size) => Number.isFinite(size) && size > 0);
      return cutoffs.filter((value) =>
        (sizes.some((size) => size <= value) && sizes.some((size) => size > value)) ||
        (selected?.unit === unit && selected.value === value))
        .map((value) => ({ unit, value, matches: sizes.filter((size) => size <= value).length }));
    });
  }

  function matchesMaxOrderSize(measures, selected) {
    if (!selected) return true;
    const size = measures?.[selected.unit === 'count' ? 'countQuantity' : 'ounceQuantity'];
    return Number.isFinite(size) && size > 0 && size <= selected.value;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** A small package count can masquerade as a count of individual items. */
  function isPackageCountOutlier(measures, referenceOzPerCount) {
    return !!(referenceOzPerCount && measures.countBasis !== 'title-items' &&
      measures.countQuantity <= 5 && measures.ouncesPerCount > 4 * referenceOzPerCount);
  }

  /** Use title item counts to establish the normal ounces per item on this page. */
  function ouncePerCountReference(items) {
    const ratios = items.map((it) => it.measures).filter((m) =>
      m?.countBasis === 'title-items' && m.ouncesPerCount > 0).map((m) => m.ouncesPerCount);
    return ratios.length >= 3 ? median(ratios) : null;
  }

  /** "Lots" means at least 60% of listings with a usable ounce or count price. */
  function preferredUnit(items, referenceOzPerCount = ouncePerCountReference(items)) {
    const comparable = items.filter((it) => it.measures?.perCount || it.measures?.perOunce);
    if (!comparable.length) return 'oz';
    const countEntries = comparable.filter((it) => it.measures.perCount &&
      !isPackageCountOutlier(it.measures, referenceOzPerCount)).length;
    return countEntries / comparable.length >= 0.6 ? 'count' : 'oz';
  }

  function selectUnit(measures, preferred, referenceOzPerCount) {
    if (!measures) return null;
    const count = isPackageCountOutlier(measures, referenceOzPerCount) ? null : measures.perCount;
    return preferred === 'count' ? count || measures.perOunce || measures.other :
      measures.perOunce || count || measures.other;
  }

  /** Page averages use only comparable, positive unit prices. */
  function pageUnitStats(items, referenceOzPerCount = ouncePerCountReference(items)) {
    const summarize = (values) => {
      if (!values.length) return null;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      return { mean, deviation, count: values.length };
    };
    const measures = items.map((item) => item.measures).filter(Boolean);
    const ounces = measures.map((m) => m.perOunce?.value).filter((value) => Number.isFinite(value) && value > 0);
    const counts = measures.filter((m) => !isPackageCountOutlier(m, referenceOzPerCount))
      .map((m) => m.perCount?.value).filter((value) => Number.isFinite(value) && value > 0);
    return { perOunce: summarize(ounces), perCount: summarize(counts) };
  }

  /** Require both a twofold price difference and a one-standard-deviation gap. */
  function priceOutlier(unit, stats) {
    if (!unit || !stats || stats.count < 4 || !(unit.value > 0)) return null;
    const gap = Math.abs(unit.value - stats.mean);
    if (gap <= stats.deviation) return null;
    if (unit.value < stats.mean / 2) return 'cost is far less than usual';
    if (unit.value > stats.mean * 2) return 'cost is far more than usual';
    return null;
  }

  /** Preferred unit first, then the other usable units, then unknowns. */
  function sortKeyed(items, preferred = 'oz') {
    const groupSizes = {};
    for (const it of items) if (it.unit) groupSizes[it.unit.group] = (groupSizes[it.unit.group] || 0) + 1;
    const secondary = preferred === 'count' ? 'oz' : 'count';
    const rankOf = (g) => (g === preferred ? 0 : g === secondary ? 1 : 2);
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
    computeUnitPrice, computeUnitPrices, preferredUnit, ouncePerCountReference,
    selectUnit, pageUnitStats, priceOutlier, sortKeyed, parseAmazonUnit, parsePrice, formatUnitPrice,
    maxOrderSizeOptions, matchesMaxOrderSize,
    // exposed for tests
    _findSizes: findSizes, _pickSize: pickSize, _packMultiplier: packMultiplier, _findCount: findCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CPC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

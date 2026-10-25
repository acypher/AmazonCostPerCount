/*
 * Content script for amazon.com search results (/s?k=...).
 * Adds "Price per oz/count" to the "Sort by:" pulldown and, when chosen,
 * groups comparable product forms and sorts by their meaningful unit on this page.
 */
(() => {
  'use strict';
  if (location.pathname !== '/s' && !location.pathname.startsWith('/s/')) return;

  const CPC = globalThis.CPC;
  const Compare = globalThis.CPCCompare;
  const OPTION_VALUE = 'cpc-unit-price-asc';
  const OPTION_LABEL = 'Price per oz/count';
  const STATE_KEY = 'cpcSortState';
  const CARD_SEL = '[data-component-type="s-search-result"]';

  // ---------------- state (per tab, survives pagination) ----------------
  const qs = () => new URLSearchParams(location.search);
  const pageKey = () => ({ k: qs().get('k') || '', s: qs().get('s') || '' });

  function readState() { try { return JSON.parse(sessionStorage.getItem(STATE_KEY)); } catch { return null; } }
  function writeState(v) { try { v ? sessionStorage.setItem(STATE_KEY, JSON.stringify(v)) : sessionStorage.removeItem(STATE_KEY); } catch { /* ignore */ } }

  function computeActive() {
    const st = readState();
    const key = pageKey();
    if (st && st.k === key.k && st.s === key.s) return true;
    if (st) writeState(null); // new search, or one of Amazon's own sorts was chosen
    return false;
  }

  let active = computeActive();
  let view = null;
  const mergeState = fields => writeState({ ...readState(), ...pageKey(), ...fields });

  // State lives only in sessionStorage (never in the URL: Amazon builds its other sort
  // links from the URL it served, so an extra parameter would leak into them).
  function activate() {
    writeState(pageKey());
    location.reload(); // like Amazon's own sort options; the reloaded page sorts itself
  }

  // ---------------- comparison and max order size ----------------
  const fallbackChoice = key => ({ key, label: key === 'count' ? 'Count — individual items' :
    key === 'volume' ? 'Liquid — per fl oz' : 'Weight — per oz', unitLabel: key === 'count' ? 'count' : key === 'volume' ? 'fl oz' : 'oz', count: 0 });
  function sizeLabel(option) {
    return `${option.value} ${option.unit === 'count' ? 'count' : option.unit === 'volume' ? 'fl oz' : 'oz'}`;
  }
  function setSize(maxSize) {
    const limits = { ...readState()?.limits, [view.key]: maxSize };
    mergeState({ maxSize, limits });
    apply();
  }
  function ensureComparison(choices) {
    const sidebar = document.querySelector('#s-refinements');
    if (!sidebar) return;
    let panel = document.getElementById('cpc-compare');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'cpc-compare';
      panel.className = 'cpc-max-size';
      panel.addEventListener('change', e => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.name !== 'cpc-comparison') return;
        const choice = choicesForPage.find(c => c.key === input.value);
        if (!choice) return;
        mergeState({ comparisonKey: choice.key, comparisonLabel: choice.label, comparisonUnitLabel: choice.unitLabel,
          maxSize: readState()?.limits?.[choice.key] || null });
        gaveUp = false;
        reorderTimes.length = 0;
        apply();
      });
      sidebar.prepend(panel);
    }
    const signature = JSON.stringify({ choices, key: view.key });
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    if (choices.length <= 1) {
      const note = document.createElement('p');
      note.id = 'cpc-comparison-note';
      note.textContent = view.key ? `Comparing ${view.label.toLowerCase()}` : 'Comparison unavailable for these results';
      panel.replaceChildren(note);
      return;
    }
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Compare';
    fieldset.append(legend);
    for (const choice of choices) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'cpc-comparison';
      input.value = choice.key;
      input.checked = choice.key === view.key;
      label.append(input, document.createTextNode(`${choice.label} (${choice.count})`));
      fieldset.append(label);
    }
    panel.replaceChildren(fieldset);
  }
  function ensureSizeFacet(items, selected) {
    const sidebar = document.querySelector('#s-refinements');
    if (!sidebar) return;
    const key = view.key;
    const measureKey = key === 'count' ? 'countQuantity' : 'ounceQuantity';
    const sizes = items.filter(it => it.comparison.key === key && it.comparison.unit)
      .map(it => ({ measures: { [measureKey]: it.comparison.quantity } }));
    const sizeUnit = key === 'count' ? 'count' : 'oz';
    const options = key ? CPC.maxOrderSizeOptions(sizes, selected && { unit: sizeUnit, value: selected.value })
      .filter(o => o.unit === sizeUnit).map(o => ({ ...o, unit: key })) : [];
    let facet = document.getElementById('cpc-max-size');
    if (!facet) {
      facet = document.createElement('div');
      facet.id = 'cpc-max-size';
      facet.className = 'cpc-max-size';
      facet.addEventListener('change', e => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.name !== 'cpc-max-order-size') return;
        setSize(input.value === 'any' ? null : { unit: view.key, value: Number(input.value) });
      });
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = 'Max order size';
      const choices = document.createElement('div');
      choices.className = 'cpc-size-options';
      const form = document.createElement('form');
      form.className = 'cpc-custom-size';
      const label = document.createElement('label');
      label.htmlFor = 'cpc-custom-max-size';
      label.textContent = 'Custom maximum';
      const row = document.createElement('div');
      row.className = 'cpc-custom-size-row';
      const input = document.createElement('input');
      input.id = 'cpc-custom-max-size';
      input.type = 'number';
      input.min = '0';
      input.required = true;
      input.placeholder = 'Enter limit';
      const unit = document.createElement('select');
      unit.setAttribute('aria-label', 'Custom maximum unit');
      const button = document.createElement('button');
      button.type = 'submit';
      button.textContent = 'Apply';
      row.append(input, unit, button);
      form.append(label, row);
      form.addEventListener('input', () => input.setCustomValidity(''));
      form.addEventListener('submit', e => {
        e.preventDefault();
        const value = input.valueAsNumber;
        const valid = Number.isFinite(value) && value > 0 &&
          (view.key !== 'count' || Number.isSafeInteger(value));
        input.setCustomValidity(valid ? '' : view.key === 'count' ?
          'Enter a positive whole number for count.' : 'Enter a number greater than zero.');
        if (!form.reportValidity()) return;
        setSize({ unit: view.key, value });
      });
      const note = document.createElement('p');
      fieldset.append(legend, choices, form, note);
      facet.append(fieldset);
      const compare = document.getElementById('cpc-compare');
      if (compare) compare.after(facet); else sidebar.prepend(facet);
    }
    facet.hidden = !key;
    const signature = JSON.stringify({ options, selected, key });
    if (facet.dataset.signature === signature) return;
    facet.dataset.signature = signature;
    const labels = [];
    const addRadio = (text, value, checked) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'cpc-max-order-size';
      input.value = value;
      input.dataset.unit = key || '';
      input.checked = checked;
      label.append(input, document.createTextNode(text));
      labels.push(label);
    };
    for (const option of options) addRadio(`Up to ${sizeLabel(option)} (${option.matches})`, String(option.value), selected?.value === option.value);
    addRadio('Any size', 'any', !selected);
    facet.querySelector('.cpc-size-options').replaceChildren(...labels);
    const selection = JSON.stringify({ selected, key });
    if (facet.dataset.selection !== selection) {
      facet.dataset.selection = selection;
      const input = facet.querySelector('#cpc-custom-max-size');
      const unit = facet.querySelector('select');
      const option = document.createElement('option');
      option.value = key || '';
      option.textContent = key === 'count' ? 'count' : key === 'volume' ? 'fl oz' : 'oz';
      unit.replaceChildren(option);
      unit.value = key || '';
      input.step = key === 'count' ? '1' : 'any';
      input.value = selected ? String(selected.value) : '';
      input.setCustomValidity('');
    }
    facet.querySelector('p').textContent = 'Applies to the selected comparison. Other product forms remain below.';
  }

  // ---------------- the Sort-by pulldown ----------------
  const sortLabel = () => active && view?.key ? `Price per ${view.unitLabel}` : OPTION_LABEL;
  function ensureOption() {
    const label = sortLabel();
    const sel = document.getElementById('s-result-sort-select');
    if (!sel) return;
    let opt = sel.querySelector(`option[value="${OPTION_VALUE}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = OPTION_VALUE;
      opt.textContent = label;
      sel.appendChild(opt);
      // Keyboard / native-select path.
      sel.addEventListener('change', (e) => {
        if (sel.value === OPTION_VALUE) { e.stopImmediatePropagation(); activate(); }
        else writeState(null);
      }, true);
    }
    if (opt.textContent !== label) opt.textContent = label;
    opt.dataset.url = location.pathname + location.search; // harmless fallback if Amazon navigates itself
    if (active) {
      for (const o of sel.options) o.selected = o === opt;
      const prompt = sel.closest('.a-dropdown-container')?.querySelector('.a-dropdown-prompt');
      if (prompt && prompt.textContent !== label) prompt.textContent = label;
    }
  }

  const isOurLink = (a) => !!a && (a.dataset.cpc === '1' || (a.getAttribute('data-value') || '').includes(OPTION_VALUE));

  // Amazon renders the open pulldown as a popover list; make sure our item is in it.
  function ensurePopoverItem() {
    const anyLink = document.querySelector('a[id^="s-result-sort-select_"]');
    if (!anyLink) return;
    const ul = anyLink.closest('ul');
    if (!ul) return;
    const links = [...ul.querySelectorAll('a')];
    let ours = links.find(isOurLink);
    if (!ours) {
      const templateLi = anyLink.closest('li');
      const li = templateLi.cloneNode(true);
      ours = li.querySelector('a');
      ours.id = 's-result-sort-select_cpc';
      ours.dataset.cpc = '1';
      ours.setAttribute('data-value', JSON.stringify({ stringVal: OPTION_VALUE }));
      ours.textContent = sortLabel();
      li.setAttribute('aria-labelledby', ours.id);
      ul.appendChild(li);
    }
    if (ours.textContent !== sortLabel()) ours.textContent = sortLabel();
    if (active) for (const a of ul.querySelectorAll('a')) a.classList.toggle('a-active', a === ours);
    else ours.classList.remove('a-active');
  }

  // Capture-phase so we win over Amazon's own delegated handlers.
  window.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a) return;
    if (isOurLink(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      activate();
    } else if (a.id && a.id.startsWith('s-result-sort-select_')) {
      writeState(null); // user picked one of Amazon's own sorts
    }
  }, true);

  // ---------------- reading a result card ----------------
  // Amazon lazily renders the lower ("More results") cards: until a card scrolls near the
  // viewport it is an empty shell with only data-asin, and it can be emptied again later.
  // Remember what each product looked like once seen, so an empty shell keeps its place
  // instead of dropping to the bottom (which caused an endless re-sort loop).
  const infoCache = new Map(); // asin -> info

  function readCard(card) {
    const titleEl = card.querySelector('[data-cy="title-recipe"]') || card.querySelector('h2');
    const h2 = card.querySelector('h2');
    let title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = h2?.getAttribute('aria-label');
    if (aria && aria.length > title.length) title = aria;
    title = title.replace(/^Sponsored Ad\s*-\s*/i, '');

    const priceScope = card.querySelector('[data-cy="price-recipe"]') || card;
    const priceEl = [...priceScope.querySelectorAll('.a-price:not(.a-text-price)')].find((el) => el.getAttribute('data-a-strike') !== 'true');
    const price = CPC.parsePrice(priceEl?.querySelector('.a-offscreen')?.textContent);

    let amazonUnit = CPC.parseAmazonUnit(priceScope.textContent);
    if (!amazonUnit && priceScope !== card) amazonUnit = CPC.parseAmazonUnit(card.textContent);

    return { title, price, amazonUnit, measures: CPC.computeUnitPrices({ title, price, amazonUnit }) };
  }

  function cardInfo(card) {
    const asin = card.dataset.asin || '';
    const cached = asin ? infoCache.get(asin) : null;
    const rendered = !!(card.querySelector('[data-cy="title-recipe"]') || card.querySelector('h2'));
    if (!rendered) return cached || { title: '', price: NaN, amazonUnit: null, measures: null, pending: true };
    const info = readCard(card);
    if (!info.measures?.perOunce && !info.measures?.perCount && cached &&
        (cached.measures?.perOunce || cached.measures?.perCount)) return cached; // partially rendered
    if (asin) infoCache.set(asin, info);
    return info;
  }

  function badge(card, info, stats) {
    let b = card.querySelector('.cpc-badge');
    const unit = info.comparison.unit;
    const noPrice = !(info.price > 0);
    const outlier = unit && info.comparison.key === view.key ? CPC.priceOutlier(unit, stats) : null;
    const text = unit ? CPC.formatUnitPrice(unit) + (outlier ? ' *' : '') : noPrice ? 'no price shown' : 'comparison unavailable';
    const tip = unit ? `${CPC.formatUnitPrice(unit)}: ${unit.source}` +
      (unit.corrected ? '\nQuantity was clarified; this price was recomputed.' : '') +
      (outlier ? `\n${outlier}` : '') : noPrice ? 'Amazon shows no price for this item on the results page' :
      'Could not confidently identify a comparable product type and quantity';
    if (b && b.textContent === text && b.title === tip) return;
    if (!b) {
      b = document.createElement('div');
      b.className = 'cpc-badge';
      const anchor = card.querySelector('[data-cy="price-recipe"]') || card.querySelector('[data-cy="title-recipe"]');
      if (anchor) anchor.after(b); else return;
    }
    b.textContent = text;
    b.title = tip;
    b.classList.toggle('cpc-badge--corrected', !!unit?.corrected);
    b.classList.toggle('cpc-badge--none', !unit);
  }

  // ---------------- sorting ----------------
  let applying = false;

  // Safety brake: if something keeps undoing our order, stop fighting instead of flickering.
  const reorderTimes = [];
  let gaveUp = false;

  // Keep our own size-filtered cards in the source set so limits can be relaxed.
  // Exclude rows hidden by No Sponsored or another page/extension rule.
  function isAvailableResult(card) {
    if (!card.matches(CARD_SEL)) return false;
    if (document.getElementById('nsp-style') && card.closest('[data-nsp-hidden], .AdHolder:not([data-nsp-retained])')) return false;
    for (let node = card; node; node = node.parentElement) {
      if (node.hidden) return false;
      if (!node.classList.contains('cpc-size-excluded') && getComputedStyle(node).display === 'none') return false;
    }
    return true;
  }

  function sortSlot(slot, ordered, stats, maxSize) {
    const cards = [...slot.children].filter(isAvailableResult);
    const items = cards.map(el => ordered.find(it => it.el === el)).filter(Boolean);
    for (const it of items) {
      it.el.classList.toggle('cpc-size-excluded', !matchesLimit(it, maxSize));
      if (!it.pending) badge(it.el, it, stats);
    }
    const sorted = ordered.filter(it => it.el.parentElement === slot);
    const needsSort = sorted.some((it, i) => it.el !== cards[i]);
    if (needsSort && !gaveUp) {
      const now = Date.now();
      reorderTimes.push(now);
      while (reorderTimes.length && now - reorderTimes[0] > 10000) reorderTimes.shift();
      if (reorderTimes.length > 6) {
        gaveUp = true;
        console.warn('[cost-per-count] The page keeps changing the order; pausing re-sorting until the next page load.');
      } else {
        const holders = cards.map(el => { const c = document.createComment('cpc'); el.before(c); return c; });
        sorted.forEach((it, i) => holders[i].replaceWith(it.el));
      }
    }
    // Reconcile headings without rewriting unchanged nodes (avoids observer feedback).
    const desired = [];
    let lastGroup = null;
    for (const it of [...slot.children].map(el => items.find(item => item.el === el)).filter(Boolean)) {
      if (!matchesLimit(it, maxSize)) continue;
      const key = it.comparison.unit ? it.comparison.key : 'unknown';
      if (key === lastGroup) continue;
      lastGroup = key;
      const choice = choicesForPage.find(c => c.key === key) || fallbackChoice(key);
      const text = key === 'unknown' ? 'Other results — comparison unavailable' : key === view.key ?
        choice.label : `Other product forms — ${choice.label}`;
      desired.push({ el: it.el, text });
    }
    const old = [...slot.querySelectorAll(':scope > .cpc-group-heading:not(.cpc-additional-heading)')];
    desired.forEach(({ el, text }, i) => {
      let heading = old[i];
      if (!heading) {
        heading = document.createElement('div');
        heading.className = 'cpc-group-heading s-flex-full-width';
        const h = document.createElement('h2');
        heading.append(h);
      }
      if (heading.firstElementChild.textContent !== text) heading.firstElementChild.textContent = text;
      if (el.previousElementSibling !== heading) el.before(heading);
    });
    old.slice(desired.length).forEach(el => el.remove());
  }
  function moveProductSections(slot) {
    const cards = [...slot.children].filter(el => el.matches(CARD_SEL));
    let heading = slot.querySelector(':scope > .cpc-additional-heading');
    const rows = [...slot.children].filter(el => {
      if (el.matches(CARD_SEL) || !el.matches('.s-widget, [data-nsp-retained]') ||
          el.hasAttribute('data-nsp-hidden') || getComputedStyle(el).display === 'none') return false;
      const identified = [...el.querySelectorAll('[data-asin]')].some(n => /^[a-z0-9]{10}$/i.test(n.dataset.asin || ''));
      const linked = [...el.querySelectorAll('a[href]')].some(a => /\/(?:dp|gp\/product|sspa\/click)(?:\/|\?)/.test(a.getAttribute('href')));
      return identified || linked;
    });
    if (!cards.length || !rows.length) { if (heading) heading.remove(); return; }
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'cpc-additional-heading cpc-group-heading s-flex-full-width';
      const h = document.createElement('h2');
      h.textContent = 'Additional product sections';
      heading.append(h);
    }
    let anchor = cards[cards.length - 1];
    if (anchor.nextElementSibling !== heading) anchor.after(heading);
    anchor = heading;
    for (const row of rows) {
      if (anchor.nextElementSibling !== row) anchor.after(row);
      anchor = row;
    }
  }
  let choicesForPage = [];
  function matchesLimit(item, maxSize) {
    if (!maxSize || item.comparison.key !== view.key || !item.comparison.unit || item.pending) return true;
    return item.comparison.quantity > 0 && item.comparison.quantity <= maxSize.value;
  }
  function summarize(items) {
    const values = items.filter(it => it.comparison.key === view.key && it.comparison.unit)
      .map(it => it.comparison.unit.value).filter(n => Number.isFinite(n) && n > 0);
    if (!values.length) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { count: values.length, mean, deviation: Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) };
  }
  function banner(stats, maxSize, selectedCount, otherCount) {
    const slot = document.querySelector('.s-main-slot');
    if (!slot) return;
    let d = document.getElementById('cpc-banner');
    if (!d) {
      d = document.createElement('div');
      d.id = 'cpc-banner';
      d.className = 'cpc-banner';
      slot.before(d);
    }
    const average = stats ? ` Mean price: ${CPC.formatUnitPrice({ value: stats.mean, unitLabel: view.unitLabel })} (${stats.count} products).` : '';
    const limit = maxSize ? ` Max order size: ${sizeLabel(maxSize)}.` : '';
    const message = view.key ? `${view.label}, lowest unit price first.${average}${limit} ` +
      `${selectedCount} comparable products; ${otherCount} other results below. ` +
      '* marks a price far less or far more than usual within this comparison; hover for details. Amber marks a corrected price.' :
      'No reliable unit comparison found. Results remain visible below.';
    if (d.textContent !== message) d.textContent = message;
  }
  function apply() {
    if (applying) return;
    applying = true;
    try {
      ensureOption();
      ensurePopoverItem();
      if (active) {
        const slots = [...document.querySelectorAll('.s-main-slot')];
        const items = slots.flatMap(slot => [...slot.children].filter(isAvailableResult).map(el => {
          const info = cardInfo(el);
          const comparison = Compare.classify(info, qs().get('k') || '');
          return { el, ...info, comparison };
        }));
        const choices = Compare.choices(items.map(it => it.comparison));
        const state = readState() || {};
        const key = ['count', 'volume', 'weight'].includes(state.comparisonKey) ? state.comparisonKey :
          choices.slice().sort((a, b) => b.count - a.count)[0]?.key || null;
        view = choices.find(c => c.key === key) || { ...fallbackChoice(key),
          label: state.comparisonLabel || fallbackChoice(key).label,
          unitLabel: state.comparisonUnitLabel || fallbackChoice(key).unitLabel };
        if (!key) view.key = null;
        if (key && !state.comparisonKey) mergeState({ comparisonKey: key, comparisonLabel: view.label,
          comparisonUnitLabel: view.unitLabel, maxSize: state.maxSize?.unit === key ? state.maxSize : null });
        choicesForPage = choices.slice();
        if (key && !choices.some(c => c.key === key)) choicesForPage.push(view);
        const maxSize = readState()?.maxSize?.unit === key ? readState().maxSize : null;
        const shown = items.filter(it => matchesLimit(it, maxSize));
        const stats = summarize(shown);
        const selectedCount = shown.filter(it => it.comparison.key === key && it.comparison.unit).length;
        const ranks = new Map([key, ...choicesForPage.map(c => c.key).filter(k => k !== key)].map((k, i) => [k, i]));
        const ordered = items.map((it, index) => ({ ...it, index })).sort((a, b) => {
          const ar = a.comparison.unit ? ranks.get(a.comparison.key) ?? 99 : 100;
          const br = b.comparison.unit ? ranks.get(b.comparison.key) ?? 99 : 100;
          return ar - br || (ar < 100 ? a.comparison.unit.value - b.comparison.unit.value : 0) || a.index - b.index;
        });
        ensureOption();
        ensurePopoverItem();
        ensureComparison(choicesForPage);
        ensureSizeFacet(items, maxSize);
        slots.forEach(slot => {
          sortSlot(slot, ordered, stats, maxSize);
          moveProductSections(slot);
        });
        banner(stats, maxSize, selectedCount, shown.length - selectedCount);
      } else {
        document.querySelectorAll('#cpc-banner, .cpc-badge, #cpc-max-size, #cpc-compare, .cpc-group-heading').forEach(el => el.remove());
        document.querySelectorAll('.cpc-size-excluded').forEach(el => el.classList.remove('cpc-size-excluded'));
      }
    } catch (err) {
      console.warn('[cost-per-count]', err);
    } finally {
      observer.takeRecords();
      applying = false;
    }
  }

  // Amazon re-renders parts of the page (pagination, filters, lazy widgets, the popover).
  let timer = null;
  document.addEventListener('nsp:updated', () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 0);
  });
  const observer = new MutationObserver(() => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Keep the state right when Amazon swaps the URL without a full reload.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; active = computeActive(); gaveUp = false; reorderTimes.length = 0; apply(); }
  }, 500);

  apply();
})();

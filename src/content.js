/*
 * Content script for amazon.com search results (/s?k=...).
 * Adds "Price per oz/count" to the "Sort by:" pulldown and, when chosen,
 * reorders the result cards on the current page. The available counts on that
 * page determine whether count or ounce leads.
 */
(() => {
  'use strict';
  if (location.pathname !== '/s' && !location.pathname.startsWith('/s/')) return;

  const CPC = globalThis.CPC;
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
  const selectedSize = () => readState()?.maxSize || null;

  // State lives only in sessionStorage (never in the URL: Amazon builds its other sort
  // links from the URL it served, so an extra parameter would leak into them).
  function activate() {
    writeState(pageKey());
    location.reload(); // like Amazon's own sort options; the reloaded page sorts itself
  }

  // ---------------- max order size facet ----------------
  function sizeLabel(option) {
    if (option.unit === 'count') return `${option.value} count`;
    return option.value >= 80 && option.value % 16 === 0 ?
      `${option.value / 16} lb` : `${option.value} oz`;
  }

  function ensureSizeFacet(items, selected, preferred) {
    const sidebar = document.querySelector('#s-refinements');
    if (!sidebar) return;
    const options = CPC.maxOrderSizeOptions(items, selected);
    let facet = document.getElementById('cpc-max-size');
    if (!facet) {
      facet = document.createElement('div');
      facet.id = 'cpc-max-size';
      facet.className = 'cpc-max-size';
      facet.addEventListener('change', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.name !== 'cpc-max-order-size') return;
        const maxSize = input.value === 'any' ? null : { unit: input.dataset.unit, value: Number(input.value) };
        writeState({ ...pageKey(), maxSize });
        apply();
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
      for (const value of ['count', 'oz']) {
        const option = document.createElement('option');
        option.value = option.textContent = value;
        unit.appendChild(option);
      }
      const button = document.createElement('button');
      button.type = 'submit';
      button.textContent = 'Apply';
      row.append(input, unit, button);
      form.append(label, row);
      form.addEventListener('input', () => input.setCustomValidity(''));
      unit.addEventListener('change', () => {
        input.step = unit.value === 'count' ? '1' : 'any';
        input.setCustomValidity('');
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.valueAsNumber;
        const valid = Number.isFinite(value) && value > 0 &&
          (unit.value !== 'count' || Number.isSafeInteger(value));
        input.setCustomValidity(valid ? '' : unit.value === 'count' ?
          'Enter a positive whole number for count.' : 'Enter a number greater than zero.');
        if (!form.reportValidity()) return;
        writeState({ ...pageKey(), maxSize: { unit: unit.value, value } });
        apply();
      });
      const note = document.createElement('p');
      fieldset.append(legend, choices, form, note);
      facet.appendChild(fieldset);
      sidebar.prepend(facet);
    }
    const signature = JSON.stringify({ options, selected, preferred });
    if (facet.dataset.signature === signature) return;
    facet.dataset.signature = signature;
    const choices = facet.querySelector('.cpc-size-options');
    const labels = [];
    const addRadio = (labelText, value, unit, checked) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'cpc-max-order-size';
      input.value = value;
      if (unit) input.dataset.unit = unit;
      input.checked = checked;
      label.append(input, document.createTextNode(labelText));
      labels.push(label);
    };
    for (const option of options) {
      addRadio(`Up to ${sizeLabel(option)} (${option.matches})`, String(option.value), option.unit,
        selected?.unit === option.unit && selected.value === option.value);
    }
    addRadio('Any size', 'any', null, !selected);
    choices.replaceChildren(...labels);
    // Update controls only when the applied limit changes. Lazy-loaded results
    // can refresh the choices without discarding a custom value being typed.
    const selection = JSON.stringify(selected);
    if (facet.dataset.selection !== selection) {
      facet.dataset.selection = selection;
      const input = facet.querySelector('#cpc-custom-max-size');
      const unit = facet.querySelector('select');
      unit.value = selected?.unit || preferred;
      input.step = unit.value === 'count' ? '1' : 'any';
      input.value = selected ? String(selected.value) : '';
      input.setCustomValidity('');
    }
    const note = facet.querySelector('p');
    note.textContent = `Filters this page’s 'per ${preferred === 'count' ? 'count' : 'oz'}' results`;
  }

  // ---------------- the Sort-by pulldown ----------------
  function ensureOption() {
    const sel = document.getElementById('s-result-sort-select');
    if (!sel) return;
    let opt = sel.querySelector(`option[value="${OPTION_VALUE}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = OPTION_VALUE;
      opt.textContent = OPTION_LABEL;
      sel.appendChild(opt);
      // Keyboard / native-select path.
      sel.addEventListener('change', (e) => {
        if (sel.value === OPTION_VALUE) { e.stopImmediatePropagation(); activate(); }
        else writeState(null);
      }, true);
    }
    opt.dataset.url = location.pathname + location.search; // harmless fallback if Amazon navigates itself
    if (active) {
      for (const o of sel.options) o.selected = o === opt;
      const prompt = sel.closest('.a-dropdown-container')?.querySelector('.a-dropdown-prompt');
      if (prompt && prompt.textContent !== OPTION_LABEL) prompt.textContent = OPTION_LABEL;
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
      ours.textContent = OPTION_LABEL;
      li.setAttribute('aria-labelledby', ours.id);
      ul.appendChild(li);
    }
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

  function badge(card, info, stats, referenceOzPerCount) {
    let b = card.querySelector('.cpc-badge');
    const noPrice = !(info.price > 0);
    const m = info.measures;
    const usableCount = CPC.selectUnit(m, 'count', referenceOzPerCount)?.group === 'count' ? m.perCount : null;
    const alternate = info.unit?.group === 'count' ? m?.perOunce : usableCount;
    const describe = (unit) => {
      const comparison = CPC.priceOutlier(unit, unit.group === 'count' ? stats.perCount :
        unit.group === 'oz' ? stats.perOunce : null);
      return { text: CPC.formatUnitPrice(unit) + (comparison ? ' *' : ''), comparison };
    };
    const lead = info.unit && describe(info.unit);
    const second = alternate && describe(alternate);
    const text = lead ? lead.text + (second ? ` | ${second.text}` : '') : noPrice ? 'no price shown' : 'no unit price';
    const tip = info.unit ? [
      `${CPC.formatUnitPrice(info.unit)}: ${info.unit.source}${lead.comparison ? `; ${lead.comparison}` : ''}`,
      info.unit.corrected ? 'Amazon’s unit price disagreed with the title; this price was recomputed.' : null,
      alternate ? `${CPC.formatUnitPrice(alternate)}: ${alternate.source}${second.comparison ? `; ${second.comparison}` : ''}` : null,
      alternate?.corrected ? 'Amazon’s alternate unit price disagreed with the title; this price was recomputed.' : null,
      m?.ouncesPerCount ? `${m.ouncesPerCount.toFixed(2)} oz/count` : null,
    ].filter(Boolean).join('\n') : noPrice ? 'Amazon shows no price for this item on the results page' : 'Could not find a size or count for this item';
    if (b && b.textContent === text && b.title === tip) return;
    if (!b) {
      b = document.createElement('div');
      b.className = 'cpc-badge';
      const anchor = card.querySelector('[data-cy="price-recipe"]') || card.querySelector('[data-cy="title-recipe"]');
      if (anchor) anchor.after(b); else return;
    }
    b.textContent = text;
    b.title = tip;
    b.classList.toggle('cpc-badge--corrected', !!(info.unit?.corrected || alternate?.corrected));
    b.classList.toggle('cpc-badge--none', !info.unit);
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
    if (document.getElementById('nsp-style') && card.closest('.AdHolder, [data-nsp-hidden]')) return false;
    for (let node = card; node; node = node.parentElement) {
      if (node.hidden) return false;
      if (!node.classList.contains('cpc-size-excluded') && getComputedStyle(node).display === 'none') return false;
    }
    return true;
  }

  function sortSlot(slot, preferred, referenceOzPerCount, stats, maxSize) {
    const cards = [...slot.children].filter(isAvailableResult);
    if (!cards.length) return;
    const items = cards.map((el) => {
      const info = cardInfo(el);
      return { el, ...info, unit: CPC.selectUnit(info.measures, preferred, referenceOzPerCount) };
    });
    for (const it of items) {
      // Empty lazy-load shells must stay visible long enough for Amazon to fill
      // them; then the next mutation can decide whether their size matches.
      it.el.classList.toggle('cpc-size-excluded', !it.pending && !CPC.matchesMaxOrderSize(it.measures, maxSize));
      if (!it.pending) badge(it.el, it, stats, referenceOzPerCount);
    }
    if (cards.length < 2) return;
    const sorted = CPC.sortKeyed(items, preferred);
    if (sorted.every((it, i) => it.el === cards[i])) return; // already in order
    if (gaveUp) return;
    const now = Date.now();
    reorderTimes.push(now);
    while (reorderTimes.length && now - reorderTimes[0] > 10000) reorderTimes.shift();
    if (reorderTimes.length > 6) {
      gaveUp = true;
      console.warn('[cost-per-count] The page keeps changing the result order; pausing re-sorting until the next page load.');
      return;
    }
    // Swap cards into the slots the cards occupied, leaving Amazon's widgets where they were.
    const holders = cards.map((el) => { const c = document.createComment('cpc'); el.before(c); return c; });
    sorted.forEach((it, i) => holders[i].replaceWith(it.el));
  }

  function banner(preferred, stats, maxSize, shown, total) {
    const slot = document.querySelector('.s-main-slot');
    if (!slot) return;
    let d = document.getElementById('cpc-banner');
    if (!d) {
      d = document.createElement('div');
      d.id = 'cpc-banner';
      d.className = 'cpc-banner';
      slot.before(d);
    }
    const filterText = maxSize ? ` Max order size: ${sizeLabel(maxSize)}; showing ${shown} of ${total} results on this page.` : '';
    const message = `${CPC.bannerUnitSummary(preferred, stats, filterText)} ` +
      '* marks a cost far less or far more than usual; hover for which. Amber means Amazon’s unit price disagreed with the title.';
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
        const items = slots.flatMap((slot) => [...slot.children].filter(isAvailableResult).map((el) => cardInfo(el)));
        const maxSize = selectedSize();
        const shownItems = items.filter((it) => it.pending || CPC.matchesMaxOrderSize(it.measures, maxSize));
        const reference = CPC.ouncePerCountReference(shownItems);
        const preferred = maxSize?.unit === 'count' ? 'count' : maxSize?.unit === 'oz' ? 'oz' : CPC.preferredUnit(shownItems, reference);
        ensureSizeFacet(items, maxSize, preferred);
        const stats = CPC.pageUnitStats(shownItems, reference);
        slots.forEach((slot) => sortSlot(slot, preferred, reference, stats, maxSize));
        banner(preferred, stats, maxSize, shownItems.length, items.length);
      } else {
        // Amazon switches sorts without a full reload sometimes; drop our leftovers.
        document.querySelectorAll('#cpc-banner, .cpc-badge, #cpc-max-size').forEach((el) => el.remove());
        document.querySelectorAll('.cpc-size-excluded').forEach((el) => el.classList.remove('cpc-size-excluded'));
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

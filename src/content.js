/*
 * Content script for amazon.com search results (/s?k=...).
 * Adds "Price per oz/count: Low to High" to the "Sort by:" pulldown and, when chosen,
 * reorders the result cards on the current page and badges each with its unit price.
 */
(() => {
  'use strict';
  if (location.pathname !== '/s' && !location.pathname.startsWith('/s/')) return;

  const CPC = globalThis.CPC;
  const OPTION_VALUE = 'cpc-unit-price-asc';
  const OPTION_LABEL = 'Price per oz/count: Low to High';
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

  // State lives only in sessionStorage (never in the URL: Amazon builds its other sort
  // links from the URL it served, so an extra parameter would leak into them).
  function activate() {
    writeState(pageKey());
    location.reload(); // like Amazon's own sort options; the reloaded page sorts itself
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
  function cardInfo(card) {
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

    return { title, price, amazonUnit, unit: CPC.computeUnitPrice({ title, price, amazonUnit }) };
  }

  function badge(card, info) {
    let b = card.querySelector('.cpc-badge');
    const noPrice = !(info.price > 0);
    const text = info.unit ? CPC.formatUnitPrice(info.unit) + (info.unit.corrected ? ' *' : '') : noPrice ? 'no price shown' : 'no unit price';
    const tip = info.unit ? info.unit.source : noPrice ? 'Amazon shows no price for this item on the results page' : 'Could not find a size or count for this item';
    if (b && b.textContent === text) return;
    if (!b) {
      b = document.createElement('div');
      b.className = 'cpc-badge';
      const anchor = card.querySelector('[data-cy="price-recipe"]') || card.querySelector('[data-cy="title-recipe"]');
      if (anchor) anchor.after(b); else return;
    }
    b.textContent = text;
    b.title = tip;
    b.classList.toggle('cpc-badge--corrected', !!(info.unit && info.unit.corrected));
    b.classList.toggle('cpc-badge--none', !info.unit);
  }

  // ---------------- sorting ----------------
  let applying = false;

  function sortSlot(slot) {
    const cards = [...slot.children].filter((el) => el.matches(CARD_SEL));
    if (cards.length < 2) return;
    const items = cards.map((el) => ({ el, ...cardInfo(el) }));
    for (const it of items) badge(it.el, it);
    const sorted = CPC.sortKeyed(items);
    if (sorted.every((it, i) => it.el === cards[i])) return; // already in order
    // Swap cards into the slots the cards occupied, leaving Amazon's widgets where they were.
    const holders = cards.map((el) => { const c = document.createComment('cpc'); el.before(c); return c; });
    sorted.forEach((it, i) => holders[i].replaceWith(it.el));
  }

  function banner() {
    if (document.getElementById('cpc-banner')) return;
    const slot = document.querySelector('.s-main-slot');
    if (!slot) return;
    const d = document.createElement('div');
    d.id = 'cpc-banner';
    d.className = 'cpc-banner';
    d.textContent = 'Sorted by price per ounce (weight & fluid), then price per count. Only the results on this page are reordered. ' +
      '* = Amazon’s unit price looked wrong and was recomputed from the title (hover a badge for details).';
    slot.before(d);
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      ensureOption();
      ensurePopoverItem();
      if (active) {
        document.querySelectorAll('.s-main-slot').forEach(sortSlot);
        banner();
      } else {
        // Amazon switches sorts without a full reload sometimes; drop our leftovers.
        document.querySelectorAll('#cpc-banner, .cpc-badge').forEach((el) => el.remove());
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
    if (location.href !== lastHref) { lastHref = location.href; active = computeActive(); apply(); }
  }, 500);

  apply();
})();

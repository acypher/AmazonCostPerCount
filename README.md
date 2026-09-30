# Amazon Sort by Price per Count / Ounce

A Chrome extension (Manifest V3) that adds **"Price per oz/count: Low to High"** to the
**Sort by:** pulldown on Amazon search-result pages (`https://www.amazon.com/s?k=...`).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
3. Search Amazon, open **Sort by:**, and pick **Price per oz/count: Low to High**.

After code changes, click the extension's reload icon in `chrome://extensions` and refresh the Amazon tab.

## What it does

- Choosing the option reloads the page (like Amazon's own sort options) and then reorders
  the results **on that page** cheapest-per-unit first. Amazon has no server-side unit-price
  sort, so only the ~48–60 results currently loaded can be reordered.
- Each card gets a badge with the unit price used (hover it to see where the number came from).
  An amber badge with `*` means Amazon's own unit price looked wrong and was recomputed.
- Order: items priced **per ounce** first (weight oz and fluid oz are merged; metric, pounds,
  gallons etc. are converted), then items priced **per count**, then any other Amazon unit
  (per sheet, per load, ...), then items with no usable price.
- The choice sticks for the tab while you page through the same search. A new search, or picking
  any of Amazon's own sort options, turns it off.

## How unit prices are decided (`src/unitprice.js`)

Amazon's displayed unit price (e.g. `($0.19/ounce)`) is used when it checks out against the
size and pack info in the title. Known Amazon mistakes that are corrected:

| Amazon shows | Example | What the extension uses |
|---|---|---|
| `/count` equal to the full price (whole package counted as 1) | "Jif Creamy Peanut Butter, 16 Oz. Jar" — $2.98 ($2.98/count) | $2.98 ÷ 16 oz |
| `/fl oz` for one can, ignoring the pack | "Bloom ... 7.5oz 12 Pack" — $17.98 ($2.40/fl oz) | $17.98 ÷ 90 fl oz |
| `/count` of cans in a multipack with a known size | "Soda, 12 Fl Oz Cans (Pack of 24)" — ($0.50/count) | price ÷ 288 fl oz |

Deliberately **not** converted: capacities that aren't contents — e.g. "13 Gallon Trash Bags,
120 Count" stays per count, "Brews 7.8 oz" coffee pods stay per count. A size is only multiplied by
an explicit pack expression ("Pack of 12", "12-Pack", "6pk", "x8", "12 (16 Oz.) Jars", "Case of 6"),
never by "servings".

When Amazon shows no unit price, the title's size (× pack) or count is used.

## Tests

```
node --test tests/*.test.js
```

Fixtures are real titles, prices and unit-price snippets captured from amazon.com in Sept 2026.

## Files

- `manifest.json` — MV3 manifest; content scripts only, no permissions requested.
- `src/unitprice.js` — pure parsing / unit-price / ordering logic (no DOM).
- `src/content.js` — pulldown integration, card reading, reordering, badges.
- `src/content.css` — badge and banner styles.

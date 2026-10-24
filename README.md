# Amazon Results Sort by CostPerCount

A browser extension (Manifest V3) that adds **"Price per oz/count"** to the
**Sort by:** pulldown on Amazon search-result pages (`https://www.amazon.com/s?k=...`).

## Install locally in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
3. Search Amazon, open **Sort by:**, and pick **Price per oz/count**.

After code changes, click the extension's reload icon in `chrome://extensions` and refresh the Amazon tab.

## What it does

Choose **Price per oz/count** to compare the products loaded on the current search
page. All classification runs locally, with no agent, AI service, or network calls.

- Razor blades and refills compare by item count; bottled water compares by fluid
  ounces. A bottle or box count is package information, not a second price comparison.
- Mixed searches show **Compare** radio buttons above **Max order size**. Detergent
  can offer pods/tablets per count, liquid/gel per fluid ounce, and powder per weight
  ounce. Weight and fluid volume never share a ranking or average.
- The selected comparison sorts first, lowest unit price first. Other forms appear
  in separate labeled groups, followed by uncertain products. Product carousels stay
  intact below the main results under **Additional product sections**, with Sponsored
  labels preserved.
- Each badge shows one meaningful unit price. The banner average and outlier marks
  use only the selected group. Amber marks a price corrected from title quantities;
  an asterisk marks an unusually high or low price within the selected comparison.
- **Max order size** and **Custom maximum** offer only the selected unit. Limits
  measure the whole order, including multipacks. Count limits must be whole numbers;
  weight and volume can be fractional. Limits filter the selected comparison only;
  other forms stay visible below. Each comparison remembers its own limit.
- Your comparison and limits persist through pagination and lazy loading in the same
  search. A new search or an Amazon sort clears the selection. Automatic defaults
  stay fixed while more results load, so the page does not change units unexpectedly.

## Classification and quantities

`src/comparison.js` identifies product form from the actual title, quantity wording,
and Amazon unit labels. Search terms supply context, without overriding contrary
product evidence. Pods containing liquid remain count items; powder described as a
“pods alternative” remains powder. Five blades in a cartridge describe its design,
not the number of refills purchased. Empty containers, accessories, ambiguous roll
sizes and unknown forms receive no invented comparison price.

Prices use the whole purchased quantity. Explicit total quantities take precedence
over per-container sizes. Multipacks are counted once; fluid ounces and weight
ounces remain distinct. Existing unit parsing is in `src/unitprice.js`.

Only products loaded on the current page can be compared. Missing or ambiguous
listing information may prevent classification; those products remain visible.

## Tests

```
node --test tests/*.test.js
```

Fixtures are real titles, prices and unit-price snippets captured from amazon.com in Sept 2026.

## Files

- `manifest.json` — MV3 manifest; content scripts only, no permissions requested.
- `src/unitprice.js` — pure parsing / unit-price / ordering logic (no DOM).
- `src/comparison.js` — local product-form classification and meaningful unit quantities.
- `src/content.js` — comparison controls, pulldown integration, grouping, badges.
- `src/content.css` — badge and banner styles.

## Publishing information

- [Store description](docs/description.md)
- [Privacy policy](docs/privacy.md)
- [Support](docs/support.md)
- Firefox's Manifest V3 add-on ID and no-data-collection declaration are in `manifest.json`.

# Amazon Results Sort by CostPerCount

A browser extension (Manifest V3) that adds **"Price per oz/count"** to the
**Sort by:** pulldown on Amazon search-result pages (`https://www.amazon.com/s?k=...`).

## Install locally in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
3. Search Amazon, open **Sort by:**, and pick **Price per oz/count**.

After code changes, click the extension's reload icon in `chrome://extensions` and refresh the Amazon tab.

## What it does

- Choosing the option reloads the page (like Amazon's own sort options) and then reorders
  the results **on that page** cheapest-per-unit first. Amazon has no server-side unit-price
  sort, so only the ~48–60 results currently loaded can be reordered.
- Each card gets a badge with the unit price used and an alternate price when available.
  Hover it to see the sources and ounces per count. The banner shows the mean cost
  for the leading unit and includes the other unit only when at least three results
  and at least 10% as many results as the leading unit have that price. A `*` beside
  either price means it is far less or far more than usual for that unit; hover for the direction.
  At least four comparable prices are needed, and a flagged price must be more than
  one standard deviation from the mean and less than half or more than twice it.
  An amber badge means Amazon's unit price disagreed with the title and was corrected.
- The extension tries to calculate **per ounce**, **per count**, and **ounces per count**
  for every listing. Missing information leaves the corresponding measure unavailable.
  When at least 60% of listings with a usable ounce or count price have a count price,
  **per count** leads; otherwise **per ounce** leads. Weight and fluid ounces are
  grouped, as before. Other units and unknowns follow.
- If a listing names an inner item count and an outer pack count, the two are
  multiplied. A small package count with an unusually large ounces-per-count ratio
  is treated as a package count rather than a comparable item count when at least
  three listings provide a reference ratio.
- While this sort is active, the **Max order size** sidebar facet limits the results
  shown on the current page. It offers count or ounce cutoffs that separate the
  sizes found on that page (for example, 50, 100, or 500 count). Ounces include
  the entire multipack; weight and fluid ounces use the same cutoffs. A chosen
  cutoff excludes listings whose size in that unit is unknown and stays selected
  across pages of the same search. **Any size** clears the limit.
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

The title's count or pack size is used to derive a per-count price even when Amazon
shows a per-ounce price. An Amazon per-count value can still be used when the title
does not give a count. Ounces per count is available when both prices can be derived.

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

## Publishing information

- [Store description](docs/description.md)
- [Privacy policy](docs/privacy.md)
- [Support](docs/support.md)
- Firefox's Manifest V3 add-on ID and no-data-collection declaration are in `manifest.json`.

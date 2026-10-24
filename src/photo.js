/* Pure, conservative package-photo evidence. No product-image guesses. */
(function (root) {
  'use strict';
  const factors = { l: ['volume', 33.8140227], ml: ['volume', 1 / 29.5735295625],
    'fl oz': ['volume', 1], g: ['weight', 1 / 28.349523125], kg: ['weight', 35.27396195],
    oz: ['weight', 1], lb: ['weight', 16] };
  function imageURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(url.hostname) ||
          !/^\/images\/I\/[a-zA-Z0-9+%_-]+(?:\.[a-zA-Z0-9_,+%_-]+)*\.(?:jpe?g|png)$/i.test(url.pathname)) return null;
      // The same public product image, at its original resolution.
      url.pathname = url.pathname.replace(/\._[^/]+_\.(jpe?g|png)$/i, '.$1');
      url.search = ''; url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function quantities(lines) {
    const found = [];
    for (const line of lines || []) {
      if (!(line.confidence >= 75)) continue;
      const text = String(line.text || '').replace(/\s+/g, ' ').trim();
      // Require an actual printed unit. "12 x 11" is never reinterpreted as 1 L.
      const re = /(?:^|[^\w.])(\d{1,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|m[lL]|[lL]|kg|g|oz|lbs?)(?![a-zA-Z0-9])/gi;
      let m;
      while ((m = re.exec(text))) {
        const packCount = Number(m[1]), amount = Number(m[2].replace(',', '.'));
        const unit = m[3].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').replace(/^lbs$/, 'lb').replace(/^floz$/, 'fl oz');
        const factor = factors[unit];
        if (!factor || packCount < 2 || packCount > 200 || !(amount > 0) || amount > 10000) continue;
        found.push({ key: factor[0], quantity: packCount * amount * factor[1], packCount,
          text: `${packCount} × ${amount} ${unit === 'l' ? 'L' : unit}`, confidence: line.confidence });
      }
    }
    return found;
  }
  function resolve(comparison, lines) {
    const evidence = comparison.quantityEvidence;
    if (!evidence || !['volume', 'weight'].includes(comparison.key)) return null;
    const seen = quantities(lines).filter(photo => photo.key === comparison.key);
    const accepted = seen.filter(photo =>
      photo.packCount === evidence.packCount && evidence.candidates.some(c =>
        Math.abs(c.quantity - photo.quantity) <= c.quantity * 0.03));
    // Conflicting package sizes can be a variant collage; never choose one.
    if (!accepted.length || seen.some(p => p.packCount !== accepted[0].packCount ||
        Math.abs(p.quantity - accepted[0].quantity) > accepted[0].quantity * 0.03)) return null;
    const photo = accepted.sort((a, b) => b.confidence - a.confidence)[0];
    return { ...comparison, quantity: photo.quantity, unit: comparison.unit && { ...comparison.unit,
      value: comparison.unit.value * comparison.quantity / photo.quantity,
      source: `Package photo: ${photo.text} (${Number(photo.quantity.toFixed(2))} ${comparison.key === 'volume' ? 'fl oz' : 'oz'} total); agrees with listing quantity`,
      corrected: true }, photo };
  }
  const api = { imageURL, quantities, resolve };
  root.CPCPhoto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

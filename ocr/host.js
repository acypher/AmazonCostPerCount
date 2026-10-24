/* All recognition runs locally. Only public Amazon product-image URLs accepted. */
'use strict';
let token, worker, busy = false, idle;
const amazon = 'https://www.amazon.com';
const asset = name => new URL(`vendor/${name}`, location.href).href;
function safeURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(u.hostname) &&
      /^\/images\/I\/[a-zA-Z0-9+%_-]+\.(?:jpe?g|png)$/i.test(u.pathname) && !u.search && !u.hash;
  } catch { return false; }
}
async function read(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let blob;
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok || !/^image\/(?:jpeg|png)/i.test(response.headers.get('content-type') || '') ||
        Number(response.headers.get('content-length')) > 12000000) throw new Error('Invalid image');
    // Bound downloads even when Content-Length is absent or inaccurate.
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 12000000) { await reader.cancel(); throw new Error('Image too large'); }
      chunks.push(part.value);
    }
    blob = new Blob(chunks, { type: response.headers.get('content-type') });
  } finally { clearTimeout(timeout); }
  const image = await createImageBitmap(blob);
  if (image.width * image.height > 20000000) { image.close(); throw new Error('Image too large'); }
  const scale = Math.min(1, 2560 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  if (!worker) worker = await Tesseract.createWorker('eng', 1, {
    workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-lstm.wasm.js'),
    langPath: asset(''), workerBlobURL: false, cacheMethod: 'none',
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const lines = (result.data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const output = lines.map(l => ({ text: l.text, confidence: l.confidence }));
  // White lettering on a colored band is often confused with background art.
  // Re-read up to three detected quantity lines after isolating light lettering.
  for (const line of lines.filter(l => /\d+\s*[x×]\s*\d/i.test(l.text) && l.confidence >= 50).slice(0, 3)) {
    const b = line.bbox, pad = 20;
    const left = Math.max(0, b.x0 - pad), top = Math.max(0, b.y0 - pad);
    const cut = document.createElement('canvas');
    cut.width = Math.min(canvas.width - left, b.x1 - left + pad);
    cut.height = Math.min(canvas.height - top, b.y1 - top + pad);
    const ctx = cut.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, left, top, cut.width, cut.height, 0, 0, cut.width, cut.height);
    const pixels = ctx.getImageData(0, 0, cut.width, cut.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) > 190 ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
    }
    ctx.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '7' });
    const focused = await worker.recognize(cut);
    output.push({ text: focused.data.text, confidence: focused.data.confidence });
  }
  return output;
}
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== amazon) return;
  const data = event.data;
  if (data?.type === 'cpc-photo-init' && typeof data.token === 'string' && !token) {
    token = data.token; parent.postMessage({ type: 'cpc-photo-ready', token }, amazon); return;
  }
  if (data?.type !== 'cpc-photo-read' || !token || data.token !== token || typeof data.id !== 'string' || !safeURL(data.url) || busy) return;
  busy = true; clearTimeout(idle);
  let lines = [];
  try { lines = await read(data.url); } catch (error) { console.warn('Package photo could not be read:', error.message); }
  finally {
    busy = false;
    parent.postMessage({ type: 'cpc-photo-result', token, id: data.id, lines }, amazon);
    idle = setTimeout(async () => { const old = worker; worker = null; if (old) await old.terminate(); }, 60000);
  }
});

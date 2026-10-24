/* On-demand, local OCR in an extension-origin frame. One worker, six images/page. */
(() => {
  'use strict';
  const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
  if (!runtime?.getURL) return;
  const Photo = globalThis.CPCPhoto;
  const cache = new Map();
  let used = 0, page = location.href, bridge, chain = Promise.resolve();
  function connect() {
    if (bridge) return bridge;
    bridge = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      frame.src = runtime.getURL('ocr/host.html');
      const origin = new URL(frame.src).origin;
      const token = crypto.randomUUID();
      const pending = new Map();
      const readyTimer = setTimeout(() => { frame.remove(); bridge = null; reject(new Error('Photo reader unavailable')); }, 15000);
      window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.token !== token) return;
        if (event.data.type === 'cpc-photo-ready') {
          clearTimeout(readyTimer);
          resolve(url => new Promise((done, fail) => {
            const id = crypto.randomUUID();
            const timeout = setTimeout(() => { pending.delete(id); fail(new Error('Photo reading timed out')); }, 45000);
            pending.set(id, result => { clearTimeout(timeout); done(result); });
            frame.contentWindow.postMessage({ type: 'cpc-photo-read', token, id, url }, origin);
          }));
        } else if (event.data.type === 'cpc-photo-result' && pending.has(event.data.id)) {
          pending.get(event.data.id)(event.data.lines || []); pending.delete(event.data.id);
        }
      });
      frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'cpc-photo-init', token }, origin), { once: true });
      document.documentElement.append(frame);
    });
    return bridge;
  }
  function check(signature, url) {
    if (page !== location.href) { page = location.href; used = 0; cache.clear(); }
    const safeURL = Photo.imageURL(url);
    if (!safeURL) return null;
    const key = `${signature}\n${safeURL}`;
    if (cache.has(key)) return cache.get(key);
    if (used >= 6) return null;
    used++;
    const promise = chain.then(async () => (await connect())(safeURL)).catch(() => []);
    chain = promise.then(() => {});
    cache.set(key, promise);
    return promise;
  }
  globalThis.CPCPhotoClient = { check };
})();

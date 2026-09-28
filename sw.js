/* =====================================================================
 * sw.js — service worker for "เวร IPD" v2 (SPEC §7)
 *
 *  - App shell: network-first (4 s timeout) so deployed updates reach users,
 *    falling back to the cached copy when offline.
 *  - CDN assets (Tailwind, html2canvas, Google Fonts): precached at install
 *    (the page loads them before this worker controls it), then network-first
 *    with the same timeout, so the app stays styled offline — even on the
 *    very first offline launch — and a CDN hiccup never sticks.
 *  - Everything else (the Apps Script API on script.google.com / *.googleusercontent.com)
 *    is NOT intercepted — plain network passthrough. Neither is any non-GET request.
 *  - Bump VERSION on every release: the old shell cache is deleted on activate.
 *    Cache Storage is shared by every app on the origin (all GitHub Pages sites of
 *    an account), so only this app's own "ipd-" caches (plus the v1 app's cache,
 *    by exact name) are ever deleted.
 * ===================================================================== */
const VERSION = 'ipd-shift-v2.1.0';
const SHELL = VERSION + '-shell';
const RUNTIME = 'ipd-runtime-v2';
const OWN_CACHE_PREFIX = 'ipd-';
const APP_SHELL = [
  './',
  './index.html',
  './config.js',
  './js/utils.js',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
/** Every URL index.html loads from a CDN (tests/sw.test.js checks that the lists match). */
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE_TIMEOUT_MS = 8000;
/** Cache of the original (v1) service worker — ours, known by exact name, safe to delete. */
const LEGACY_CACHES = ['rad-shift-v1'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // {cache:'reload'} bypasses the HTTP cache so a new SW never precaches stale files
    await cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })));
    await precacheCdn();
    await self.skipWaiting();
  })());
});

/**
 * Best effort: a CDN that cannot be reached now is simply cached by a later online visit.
 * Each fetch is capped so a hanging CDN can never stall installation (and thus updates).
 */
async function precacheCdn() {
  const cache = await caches.open(RUNTIME);
  await Promise.all(CDN_ASSETS.map(url => {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, PRECACHE_TIMEOUT_MS, null); });
    const put = fetch(new Request(url, { mode: 'no-cors' }))
      .then(res => (isCdnCacheable(res) ? cache.put(url, res) : null));
    return Promise.race([put, timeout]).catch(() => null).then(() => clearTimeout(timer));
  }));
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter(n => (n.indexOf(OWN_CACHE_PREFIX) === 0 && n !== SHELL && n !== RUNTIME)
      || LEGACY_CACHES.indexOf(n) >= 0);
    await Promise.all(stale.map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event, SHELL, isShellCacheable));
  } else if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(networkFirst(event, RUNTIME, isCdnCacheable));
  }
  // anything else: no respondWith → the browser handles it normally
});

function isShellCacheable(res) { return !!res && res.status === 200 && res.type === 'basic'; }
/** CDN files load as no-cors, i.e. opaque (status hidden); network-first keeps a bad copy from lasting. */
function isCdnCacheable(res) { return !!res && (res.ok || res.type === 'opaque'); }

/**
 * Network first (4 s), refresh the cached copy when `cacheable`, fall back to the cache.
 * waitUntil() is registered synchronously (during event dispatch) so the cache
 * update may finish even after the response has been handed to the page.
 */
function networkFirst(event, cacheName, cacheable) {
  const req = event.request;
  let updated;
  event.waitUntil(new Promise(resolve => { updated = resolve; }));
  const network = fetch(req).then(res => {
    if (cacheable(res)) {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(req, copy)).catch(() => {}).then(updated);
    } else updated();
    return res;
  }, err => { updated(); throw err; });
  network.catch(() => {});   // avoid an unhandled rejection when the timeout wins
  return respondNetworkFirst(req, network, cacheName);
}

async function respondNetworkFirst(req, network, cacheName) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS); });
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
  } catch (e) {
    // network error → try the cache below
  } finally {
    clearTimeout(timer);
  }

  const cached = await matchCached(await caches.open(cacheName), req);
  if (cached) return cached;
  try {
    return await network;   // slow network and nothing cached: keep waiting
  } catch (e) {
    return Response.error();
  }
}

async function matchCached(cache, req) {
  const hit = await cache.match(req);
  if (hit) return hit;
  if (req.mode === 'navigate') {
    return (await cache.match('./index.html')) || (await cache.match('./')) || (await cache.match(req, { ignoreSearch: true }));
  }
  return null;
}

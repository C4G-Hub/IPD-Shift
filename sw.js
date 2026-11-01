/* =====================================================================
 * sw.js — service worker for "เวร IPD" v2 (SPEC §7, R2 §3.5)
 *
 *  - App shell (same origin): stale-while-revalidate — answered from the cache at once (fast start, works
 *    offline) while the cached copy is refreshed in the background. A release reaches users through
 *    VERSION: the new sw.js precaches the new shell and takes over, and the page offers a reload.
 *  - CDN assets (html2canvas, Google Fonts): precached at install, then network-first (4 s timeout) with
 *    the cache as fallback, so the app stays usable offline and a CDN hiccup never sticks.
 *  - Not intercepted (plain network): the Apps Script API (script.google.com / *.googleusercontent.com),
 *    every non-GET request, and every URL with a `diag` query parameter (the connection check must reach
 *    the real network).
 *  - Bump VERSION on every release: the old shell cache is deleted on activate.
 *    Cache Storage is shared by every app on the origin (all GitHub Pages sites of
 *    an account), so only this app's own "ipd-" caches (plus the v1 app's cache,
 *    by exact name) are ever deleted.
 * ===================================================================== */
const VERSION = 'ipd-shift-v2.3.0';
const SHELL = VERSION + '-shell';
const RUNTIME = 'ipd-runtime-v3';      // v3: drops the Tailwind CDN script cached by v2.1
const OWN_CACHE_PREFIX = 'ipd-';
const APP_SHELL = [
  './',
  './index.html',
  './config.js',
  './css/tailwind.css',
  './js/utils.js',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
/** Every URL the page loads from a CDN (tests/sw.test.js checks index.html and js/app.js against this list). */
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
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
  if (url.searchParams.has('diag')) return;
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event));
  } else if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(networkFirst(event, RUNTIME, isCdnCacheable));
  }
  // anything else: no respondWith → the browser handles it normally
});

function isShellCacheable(res) { return !!res && res.status === 200 && res.type === 'basic'; }
/** CDN files load as no-cors, i.e. opaque (status hidden); network-first keeps a bad copy from lasting. */
function isCdnCacheable(res) { return !!res && (res.ok || res.type === 'opaque'); }

/**
 * Fetches the request and, when `cacheable`, stores the answer in `cacheName`. waitUntil() is registered
 * synchronously (during event dispatch) so the cache update may finish after the page got its response.
 */
function fetchAndCache(event, cacheName, cacheable) {
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
  network.catch(() => {});   // the cached answer may win: avoid an unhandled rejection
  return network;
}

/** The cached copy at once (refreshed in the background); without one the network, offline → index.html. */
function staleWhileRevalidate(event) {
  const req = event.request;
  const network = fetchAndCache(event, SHELL, isShellCacheable);
  return caches.open(SHELL)
    .then(cache => cache.match(req))
    .then(cached => cached || network.catch(() => navigationFallback(req)));
}

async function navigationFallback(req) {
  if (req.mode === 'navigate') {
    const cache = await caches.open(SHELL);
    const page = (await cache.match('./index.html')) || (await cache.match('./'));
    if (page) return page;
  }
  return Response.error();
}

/** Network first (4 s), refreshing the cached copy when `cacheable`, falling back to the cache. */
function networkFirst(event, cacheName, cacheable) {
  return respondNetworkFirst(event.request, fetchAndCache(event, cacheName, cacheable), cacheName);
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

  const cached = await (await caches.open(cacheName)).match(req);
  if (cached) return cached;
  try {
    return await network;   // slow network and nothing cached: keep waiting
  } catch (e) {
    return Response.error();
  }
}

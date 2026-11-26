/* =====================================================================
 * sw.js — service worker for "เวร IPD" (SPEC §7, R2 §3.5, R1a fix A-F1)
 *
 *  - Releases are atomic. The stylesheet and every local script of index.html carry the release in their URL
 *    (css/tailwind.css?v=3.1.0, js/app.js?v=3.1.0 …) and APP_SHELL lists exactly those URLs. As a safety net the
 *    inline boot guard of index.html also recognises a stylesheet left from v2.2 and reloads once the new one answers.
 *    A release reaches a device only through a new sw.js: its install precaches the whole shell in one `addAll` (all
 *    files or nothing), it takes over at once (skipWaiting + clients.claim) and the page shows "มีเวอร์ชันใหม่ — แตะเพื่อ
 *    โหลดใหม่".
 *  - App shell (the APP_SHELL URLs, query included): cache-first from this release's own precache, never
 *    revalidated file by file (the v2.3 worker did that, which could mix two releases in its cache). A shell URL
 *    that is somehow missing from the cache is fetched from the network and NOT stored.
 *  - config.js (the owner may edit it without a release): stale-while-revalidate in the shell cache.
 *  - Navigations to any other in-scope URL: the network; offline → the precached index.html.
 *  - Other same-origin files (old unversioned URLs, 512 px icons, …): not intercepted (plain network).
 *  - CDN assets (html2canvas, Google Fonts): precached at install (html2canvas in CORS mode, so the cached copy can
 *    pass the page's integrity check; the fonts CSS as no-cors like the page's <link>), then network-first (4 s
 *    timeout) with the cache as fallback, so the app stays usable offline and a CDN hiccup never sticks.
 *  - Not intercepted (plain network): the Apps Script API (script.google.com / *.googleusercontent.com),
 *    every non-GET request, and every URL with a `diag` query parameter (the connection check must reach
 *    the real network).
 *  - A release = change VERSION here AND the same number in index.html (?v= of the stylesheet and of every local script, BOOT_BUILD of
 *    the inline boot guard), js/api.js CLIENT_VERSION and js/app.js APP_BUILD; tests/sw.test.js fails
 *    when they disagree. The old shell cache is deleted on activate. Cache Storage is shared by every app on the
 *    origin (all GitHub Pages sites of an account), so only this app's own "ipd-" caches (plus the v1 app's cache,
 *    by exact name) are ever deleted.
 * ===================================================================== */
const VERSION = 'ipd-shift-v3.1.0';
const RELEASE = VERSION.slice('ipd-shift-v'.length);   // '3.1.0'
const V = '?v=' + RELEASE;                               // query of every versioned shell URL
const SHELL = VERSION + '-shell';
const RUNTIME = 'ipd-runtime-v4';      // v4: html2canvas is cached in CORS mode (v3 held an opaque copy)
const OWN_CACHE_PREFIX = 'ipd-';
const CONFIG_URL = './config.js';      // unversioned on purpose: revalidated (see the header)
/** Same-origin files of the app: the local files index.html references plus the logo picture (tests/sw.test.js checks it).
 *  icons/icon-512.png and icons/icon-maskable-512.png (manifest.json) are only read by the OS at install time: not precached. */
const APP_SHELL = [
  './',
  './index.html',
  CONFIG_URL,
  './css/tailwind.css' + V,
  './js/utils.js' + V,
  './js/api.js' + V,
  './js/ui-kit.js' + V,
  './js/plan-engine.js' + V,       // R2: the scheduling engine (window.PlanEngine, pure functions)
  './js/app.js' + V,
  './js/plan-data.js' + V,         // R2: the plan domain (getPlan, the only owner of plan data)
  './js/feat-profile.js' + V,      // R1b feature files (loaded after app.js, registered through App.register)
  './js/feat-approval.js' + V,
  './js/feat-roster.js' + V,       // R2 feature files
  './js/feat-plan-settings.js' + V,
  './js/feat-backup.js' + V,
  './manifest.json',
  './icons/icon-192.png',          // the logo the UI shows (login, rail, เมนู, what's new)
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
/** Every URL the page loads from a CDN (tests/sw.test.js checks index.html and js/app.js against this list). */
const CDN_ASSETS = [
  HTML2CANVAS_URL,
  'https://fonts.googleapis.com/css2?family=Mitr:wght@500;600&family=Sarabun:wght@400;500;600;700&display=swap'
];
/** CDN files the page loads with crossorigin (and an integrity check): precached in CORS mode. */
const CDN_CORS = [HTML2CANVAS_URL];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE_TIMEOUT_MS = 8000;
/** Cache of the original (v1) service worker — ours, known by exact name, safe to delete. */
const LEGACY_CACHES = ['rad-shift-v1'];

const shellUrls = APP_SHELL.map(u => new URL(u, self.location).href);
const configHref = new URL(CONFIG_URL, self.location).href;
const indexHref = new URL('./index.html', self.location).href;
const rootHref = new URL('./', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // all or nothing; {cache:'reload'} bypasses the HTTP cache so a new SW never precaches stale files
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
    const mode = CDN_CORS.indexOf(url) >= 0 ? 'cors' : 'no-cors';
    const put = fetch(new Request(url, { mode }))
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
    const href = url.href.split('#')[0];
    if (href === configHref) event.respondWith(staleWhileRevalidate(event));
    else if (shellUrls.indexOf(href) >= 0) event.respondWith(fromShell(req));
    else if (req.mode === 'navigate') event.respondWith(navigate(req, url));
    // any other same-origin file: no respondWith → plain network
  } else if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(networkFirst(event, RUNTIME, isCdnCacheable));
  }
  // anything else: no respondWith → the browser handles it normally
});

function isShellCacheable(res) { return !!res && res.status === 200 && res.type === 'basic'; }
/** The fonts CSS loads as no-cors, i.e. opaque (status hidden); network-first keeps a bad copy from lasting. */
function isCdnCacheable(res) { return !!res && (res.ok || res.type === 'opaque'); }

/** A shell file from this release's precache; never written back. Missing (should not happen) → the network. */
async function fromShell(req) {
  const hit = await (await caches.open(SHELL)).match(req);
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch (e) {
    return navigationFallback(req);
  }
}

/**
 * A navigation outside APP_SHELL: index.html with a query (e.g. ?source=pwa) is still the precached page of this
 * release; any other page comes from the network, offline the precached index.html.
 */
async function navigate(req, url) {
  const path = url.origin + url.pathname;
  if (path === indexHref || path === rootHref) {
    const page = await (await caches.open(SHELL)).match(path === rootHref ? rootHref : indexHref);
    if (page) return page;
  }
  try {
    return await fetch(req);
  } catch (e) {
    return navigationFallback(req);
  }
}

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

/** config.js only: the cached copy at once (refreshed in the background); without one the network. */
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
    const page = (await cache.match(indexHref)) || (await cache.match(rootHref));
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

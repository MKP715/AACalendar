/* =====================================================================
   AAGeek Events — service worker
   ---------------------------------------------------------------------
   Makes the app installable and usable offline.

     App page (navigations)  network-first, 4 s timeout, then the cached
                             copy — updates arrive whenever online, and the
                             app still opens with no connection.
     Own static files        stale-while-revalidate (icons, manifest).
     CDN libraries & fonts   stale-while-revalidate (Pico.css, ical.js,
                             Inter). Without ical.js cached the app cannot
                             parse anything offline, so these are precached.
     Everything else         untouched: the calendar feeds (Google, its CORS
                             proxies, and the NETA 65 Grapevine feed — the
                             app keeps its own cache of each in
                             localStorage), the Google embed, Drive images,
                             maps / Zoom links.

   Bump VERSION whenever a deploy changes any precached file. The page then
   offers "Update available — Reload" (see registerServiceWorker in
   index.html), and the old caches are dropped on activation.
   ===================================================================== */
'use strict';

const VERSION = 'v2';
const SHELL   = `aageek-shell-${VERSION}`;
const RUNTIME = 'aageek-runtime-v1';
const RUNTIME_MAX_ENTRIES = 60;
const NAV_TIMEOUT_MS = 4000;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

// Third-party files the page loads. Best-effort: a CDN hiccup at install
// time must not stop the worker installing.
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css',
  'https://cdn.jsdelivr.net/npm/ical.js@1.5.0/build/ical.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

// ------------------------------------------------------------------ install
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // cache: 'reload' so a new version never precaches a stale HTTP-cached copy.
    await shell.addAll(SHELL_URLS.map(u => new Request(u, { cache: 'reload' })));
    const runtime = await caches.open(RUNTIME);
    await Promise.all(CDN_URLS.map(u =>
      runtime.add(new Request(u, { mode: 'cors', credentials: 'omit' })).catch(() => {})));
  })());
  // No skipWaiting() here: a new version waits until the user accepts the
  // update prompt, so an open page never switches code underneath itself.
});

// ----------------------------------------------------------------- activate
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    for (const key of await caches.keys()) {
      if (key.startsWith('aageek-') && !keep.has(key)) await caches.delete(key);
    }
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* unsupported */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// -------------------------------------------------------------------- fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(navigate(event));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, req, SHELL));
    return;
  }
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req, RUNTIME));
  }
  // Anything else: let the browser handle it normally.
});

// The page itself: fresh from the network when possible, cached otherwise.
// Stored without its query string, so "./?view=calendar" (a manifest
// shortcut) is served from the same cached copy offline.
async function navigate(event) {
  const req = event.request;
  const key = stripSearch(req.url);
  const cache = await caches.open(SHELL);

  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const res = preloaded || await fetch(req);
    if (res && res.ok) event.waitUntil(cache.put(key, res.clone()));
    return res;
  })();

  try {
    return await withTimeout(network, NAV_TIMEOUT_MS);
  } catch {
    const cached = await cache.match(key) ||
                   await cache.match(req, { ignoreSearch: true }) ||
                   await cache.match('./index.html') ||
                   await cache.match('./');
    if (cached) return cached;
    // Nothing cached yet (first visit while offline): wait for the network.
    return network;
  }
}

async function staleWhileRevalidate(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  const refresh = fetch(req).then(async (res) => {
    // Opaque (no-cors) responses from the CDN are fine to keep; errors are not.
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      if (cacheName === RUNTIME) await trim(cache, RUNTIME_MAX_ENTRIES);
    }
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const res = await refresh;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

function stripSearch(href) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  return u.href;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); },
                 (e) => { clearTimeout(t); reject(e); });
  });
}

// Keep the runtime cache from growing without bound (font subsets, CDN
// version bumps). Oldest entries go first.
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

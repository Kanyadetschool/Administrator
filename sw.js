// ══════════════════════════════════════════════════════════════
// Kanyadet School Portal — Service Worker
// Strategy:
//   • HTML pages (this app + siblings)  → network-first, cache fallback
//   • Static assets (css/js/images/CDN) → cache-first (stale-while-revalidate)
//   • Firebase / Google API traffic     → never intercepted, goes straight
//     to network (SW cannot make RTDB/Firestore/Auth calls work offline —
//     that's handled by app-level caching, not here)
//
// IMPORTANT: bump CACHE_VERSION every time you deploy changes to any
// precached file, or returning users will keep seeing the old version.
// ══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v3'; // bumped: index.html updated with PWA "Install App" button
const SHELL_CACHE = `kanyadet-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `kanyadet-runtime-${CACHE_VERSION}`;

// Core files needed for the app shell to boot offline.
// Add/remove paths here to match your actual file layout.
const PRECACHE_URLS = [
  './',
  './index.html',
  './lunch.html',
  './food.html',
  './images/logo.png',
  './imgs/logo.png',
  './image-popup.js',
  './Report-Cards/css/swalOnly.css',
  // Pinned CDN libs (versioned URLs = safe to cache long-term)
  'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap',
  // Firebase SDK modules — REQUIRED just to boot the app (index.html imports
  // these directly). They live on gstatic.com/firebasejs, which is normally
  // in NEVER_INTERCEPT below since that domain also serves live Firebase
  // config data — so these 4 exact files are carved out as an explicit
  // exception (see ALWAYS_CACHE_EXACT) and precached here so a reload while
  // offline never depends on the browser's own (evictable) HTTP cache for
  // something this critical.
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
];

// Exact files that must be served from cache-first even though their
// domain is otherwise in NEVER_INTERCEPT — these are static SDK code, not
// live backend calls, so caching them is safe and actually necessary for
// the app to boot at all when offline.
const ALWAYS_CACHE_EXACT = new Set([
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
]);

// Domains that must ALWAYS go to the network untouched.
// (Auth, Firestore, Realtime Database, Google Sign-In popups, etc.)
const NEVER_INTERCEPT = [
  'googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'firebase.google.com',
  'gstatic.com/firebasejs',
  'accounts.google.com',
  'identitytoolkit',
];

function shouldBypass(url) {
  if (ALWAYS_CACHE_EXACT.has(url)) return false; // SDK code, not live backend traffic — safe & necessary to cache
  return NEVER_INTERCEPT.some(d => url.includes(d));
}

// ── INSTALL: precache the app shell ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll fails hard if ANY url 404s — use allSettled so one bad
      // path (e.g. a file that doesn't exist in your repo) doesn't
      // block the whole install.
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache skipped:', url, err.message))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: drop old cache versions ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: route requests ───────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes
  const url = request.url;

  if (shouldBypass(url)) return; // let Firebase/Google traffic pass straight through

  // HTML navigations → network-first, cache fallback, offline fallback last
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else (css/js/img/fonts/CDN libs) → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // last resort: try the root shell page so the app still boots
    const shellFallback = await caches.match('./index.html');
    if (shellFallback) return shellFallback;
    return new Response(
      '<h1>Offline</h1><p>This page has not been cached yet. Connect once online to enable offline access.</p>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.status === 200) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await networkFetch) || new Response('', { status: 504 });
}

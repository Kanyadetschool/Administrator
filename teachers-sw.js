const CACHE_VERSION = 'teachers-pwa-v2';
const APP_SHELL = [
  './teachers.html',
  './teachers-manifest.json',
  './images/logo.png',
  './teachers-sw.js'
];

// Only cache our own files and the Firebase SDK / fonts. Never cache API, auth or database traffic.
const CACHEABLE_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const isCacheable = (url) => url.origin === self.location.origin || CACHEABLE_HOSTS.includes(url.hostname);

// Clone synchronously (before the response is returned or read), then store the copy.
function stash(event, request, response) {
  if (!response || response.status !== 200) return;
  const copy = response.clone();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {})
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  // Pages: network first, fall back to cache, then to the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => { stash(event, request, response); return response; })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          return cached || caches.match('./teachers.html') || Response.error();
        })
    );
    return;
  }

  // Everything else: serve cache instantly, refresh it in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => { stash(event, request, response); return response; })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
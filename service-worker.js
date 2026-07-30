// service-worker.js
// Caches the app shell (HTML/CSS/JS/logo) so the exam system can still
// open and be used even with a weak or dropped internet connection.
// Bump CACHE_NAME any time you update index.html/styles.css/script.js
// so returning users get the new version instead of an old cached one.

const CACHE_NAME = 'exam-system-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './logo1.jpg'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: try the network first (so students/admins always get fresh
// results/data when online); fall back to the cached app shell when
// offline so the page still loads instead of showing a browser error.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only cache same-origin files (the app shell). Firebase and CDN
  // requests always go straight to the network, untouched.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

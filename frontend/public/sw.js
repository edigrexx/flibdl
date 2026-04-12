const CACHE_NAME = 'flibdl-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css?v=12',
  '/js/app.js?v=12',
  '/js/api.js',
  '/js/pwa.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: удаляем старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: Cache-first для статики, network-first для API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API запросы — всегда сеть (не кэшируем)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Статика — кэш сначала
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }).catch(() => {
      // Оффлайн fallback
      if (event.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});

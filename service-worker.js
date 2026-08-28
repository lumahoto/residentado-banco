importScripts('./version.js');
// v1.5.7: referencias QRV2 + simulacro realista en dos partes; sin cambios de datos, scheduler ni archivos críticos de sesión.

const CACHE = self.RESIDENTADO_BUILD?.cacheName || 'residentado-v1-5-7';
const ASSETS = [
  './',
  './index.html',
  './version.js',
  './styles.css',
  './app.js',
  './session-core.js',
  './session-storage.js',
  './question-parser.js',
  './w3-tools.js',
  './w4-data.js',
  './tts_catalog.json',
  './config.js',
  './pilot-data.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/questions/RM-2022-A-038.jpg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Nunca cachear Supabase ni CDN externos.

  if (event.request.mode === 'navigate') {
    // FIX-RELEASE-001: navegación network-first para evitar que una versión anterior oculte un hotfix.
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});

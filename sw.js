/* Service worker: red primero, caché de respaldo para jugar sin conexión. */
const VERSION = 'aj-v4';
const ARCHIVOS = ['./', './index.html', './style.css', './app.js', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

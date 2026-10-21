/* Service worker: red primero, caché de respaldo para jugar sin conexión.
 * GitHub Pages manda max-age=600, así que los pedidos saltean el caché HTTP del navegador:
 * la instalación baja los archivos frescos ('reload') y cada pedido revalida con el servidor ('no-cache'). */
const VERSION = 'aj-v1.5'; // subir junto con APP_VERSION en app.js
const ARCHIVOS = ['./', './index.html', './style.css', './app.js', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ARCHIVOS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const mismoOrigen = new URL(e.request.url).origin === location.origin;
  const pedido = mismoOrigen ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(pedido)
      .then((res) => {
        if (mismoOrigen && res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

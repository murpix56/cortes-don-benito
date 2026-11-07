// Service worker del mapa de cortes: guarda la aplicación para abrirla sin conexión.
// Los datos viven en el servidor (o en el dispositivo en modo de pruebas), no aquí.
const C = 'cortes-shell-20261108d';
const FILES = ['./', 'index.html', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'js/app.js', 'boot.js', 'js/util.js', 'js/store.js', 'js/net.js', 'js/importer.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;           // teselas, Overpass y servidor: red directa
  if (u.pathname.includes('/api/')) return;           // la API (datos privados) nunca se guarda en la caché del navegador
  // Red primero (siempre la última versión); caché si no hay conexión.
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(x => {
    if (x.ok) { const cp = x.clone(); caches.open(C).then(c => c.put(r, cp)); }
    return x;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});

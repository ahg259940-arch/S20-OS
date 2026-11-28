const CACHE = 'nexus-shell-v7';
const CACHE_PREFIX = 'nexus-shell-';
const SHELL = ['/', '/app.css?v=3.1', '/backup-crypto.js?v=3.0', '/layout-geometry.js?v=3.0', '/presentation.js?v=3.0', '/app.js?v=3.1', '/manifest.webmanifest', '/assets/nexus.svg', '/assets/nexus-192.png', '/assets/nexus-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/'))));
});

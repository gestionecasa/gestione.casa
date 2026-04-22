// sw.js — Service Worker per Hey Casa PWA
const CACHE = 'casa-v28';

// Solo risorse statiche pesanti — network-first per tutto il resto
const PRECACHE = [
  './assets/images/logo.png',
  './assets/images/icons/icon-192x192.png',
  './assets/images/icons/icon-512x512.png',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const ext = url.pathname.split('.').pop().toLowerCase();

  // Immagini → cache-first
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'].includes(ext)) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // HTML, JS, CSS, JSON → network-first (sempre aggiornati)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

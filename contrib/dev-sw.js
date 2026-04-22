// DEV MODE: unregister service workers and clear caches.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))),
      self.registration.unregister(),
    ])
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.navigate(client.url)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => new Response('Dev server non raggiungibile', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }))
  );
});

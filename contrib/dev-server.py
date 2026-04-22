#!/usr/bin/env python3
"""Dev server: no-cache headers + no-op service worker so every file change is live."""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Injected in place of sw.js — unregisters itself and clears all caches
DEV_SW = b"""\
// DEV MODE: no caching, pass all requests through
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
      self.registration.unregister()
    ])
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => new Response('Dev server non raggiungibile', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }))
  );
});
"""

NO_CACHE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma':        'no-cache',
    'Expires':       '0',
}


class DevHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        for k, v in NO_CACHE.items():
            self.send_header(k, v)
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/sw.js':
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(DEV_SW)))
            self.end_headers()
            self.wfile.write(DEV_SW)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        # suppress 304s to keep output clean
        if len(args) >= 2 and args[1] == '304':
            return
        super().log_message(fmt, *args)


os.chdir(ROOT)
print(f'\n  ⌂  Hey Casa DEV — http://localhost:{PORT}')
print('     Service worker disabled · no-cache headers active\n')
http.server.HTTPServer(('127.0.0.1', PORT), DevHandler).serve_forever()

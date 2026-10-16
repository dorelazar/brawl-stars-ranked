// Offline support. App files: cache first, refreshed in the background.
// Data files: network first so stats are always the latest, cache when offline.
// Brawler and map images: cache first (they rarely change).

const VERSION = 'v1';
const APP = `app-${VERSION}`;
const IMG = 'img-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/engine.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP && k !== IMG).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())),
    );
    return;
  }

  if (url.hostname.endsWith('brawlify.com') || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.open(IMG).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }).catch(() => Response.error()),
    );
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(APP).then(async c => {
        const hit = await c.match(req, { ignoreSearch: true });
        const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
        return hit || (await net) || Response.error();
      }),
    );
  }
});

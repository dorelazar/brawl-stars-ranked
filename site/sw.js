// Offline support and instant start.
// App files and data: served from cache right away, refreshed in the background
// (the draft timer doesn't wait for a slow connection; new versions show on the next open).
// Brawler and map images: cache first (they rarely change).

const VERSION = 'v3';
const APP = `app-${VERSION}`;
const IMG = 'img-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/engine.js', 'js/plan.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

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

  // Data: fresh stats when the connection is fine, the cached copy if it takes over 2.5 s.
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(caches.open(APP).then(async c => {
      const fresh = fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
      e.waitUntil(fresh.catch(() => {}));
      const slow = new Promise(r => setTimeout(r, 2500)).then(() => c.match(req, { ignoreSearch: true }));
      const hit = await Promise.race([fresh.catch(() => null), slow]);
      return hit || (await c.match(req, { ignoreSearch: true })) || fresh.catch(() => Response.error());
    }));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(caches.open(APP).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
      if (hit) {
        e.waitUntil(fresh.catch(() => {}));
        return hit;
      }
      return fresh.catch(() => Response.error());
    }));
  }
});

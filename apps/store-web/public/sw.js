/* global self, caches */
// Storefront service worker (Phase 10, frontend only): the app shell and static assets are
// served from the cache when offline; API calls always go to the network.
const CACHE = 'arabat-store-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/store/', '/store/manifest.webmanifest'])),
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/store/')) return;
  const isAsset = /\.(js|css|woff2?|svg|png|webmanifest)$/.test(url.pathname);
  event.respondWith(
    isAsset
      ? caches.match(event.request).then(
          (hit) =>
            hit ||
            fetch(event.request).then((res) => {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
              return res;
            }),
        )
      : fetch(event.request).catch(() => caches.match('/store/')),
  );
});

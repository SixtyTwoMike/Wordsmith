// Cache-first app-shell service worker. All user data lives in
// localStorage, so caching the shell makes the whole app work offline.

const CACHE = 'wordsmith-v8';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/model.js',
  'js/editor.js',
  'js/quickbar.js',
  'js/suggest.js',
  'js/store.js',
  'js/settings.js',
  'js/scripts.js',
  'js/switcher.js',
  'js/history.js',
  'js/navigator.js',
  'js/export.js',
  'js/characters.js',
  'js/profile.js',
  'js/zip.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});

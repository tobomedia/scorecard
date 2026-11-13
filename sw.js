// VERSION and the hashed file names below are stamped at deploy time by scripts/build.mjs.
// Don't edit them by hand.
const VERSION = 'scorecard-dev';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'assets/brand/logo.webp',
  'assets/fonts/roboto-condensed-latin-400-normal.woff2',
  'assets/fonts/roboto-condensed-latin-700-normal.woff2',
  'assets/paint/fill-grey.svg',
  'assets/paint/fill-lime.svg',
  'assets/paint/fill-red.svg',
  'assets/paint/fill-slate.svg',
  'assets/paint/fill-steel.svg',
  'assets/paint/fill-white.svg',
  'assets/paint/frame-grey.svg',
  'assets/paint/frame-lime.svg',
  'assets/paint/frame-red.svg',
  'assets/paint/frame-slate.svg',
  'assets/paint/frame-steel.svg',
  'assets/paint/frame-white.svg',
  'assets/paint/splat-a.svg',
  'assets/paint/splat-b.svg',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so we never store stale files
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first: the app must load at grounds with no signal.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
